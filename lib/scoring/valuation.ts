// Meridian AI — source-aware valuation engine.
//
// Pure, deterministic. No I/O, no clocks for math (only for the output
// timestamp string), no randomness.
//
// PURPOSE
// The engines downstream (margin, signal, acquisition) used to treat the
// raw `marketPrice` field as truth. That's a lie when the data is stale,
// thinly comped, or pulled from a single sketchy listing. This module
// replaces that single-anchor assumption with an honest valuation:
//
//   1. It reports WHAT data it used, HOW recent it was, HOW MANY comps,
//      and HOW confident it is.
//   2. It produces a CONFIDENCE-ADJUSTED fair value — pulling the value
//      toward the conservative end of the band when evidence is weak.
//   3. It exposes a confidence score (0-100) so the acquisition engine
//      can become more conservative — lower ceiling, lower conviction,
//      narrower walk-away tolerance — when valuation is uncertain.
//
// HONESTY CONSTRAINTS
//   - Never claim "within 2% of market" unless every input genuinely
//     supports it (timestamp ≤ 24h, ≥5 comps, exact-match condition,
//     trustworthy platform).
//   - When data is missing, default DOWN, not up.
//   - The method string is plain English about what was actually done.
//
// This module is intentionally STATIC-EVIDENCE aware: with no live feed
// wired in, it labels its outputs as "comp-anchored static estimate" and
// reports MEDIUM/LOW confidence. When a real-time pipeline lands, the
// adapter only needs to populate listingTimestamp / compCount and the
// confidence math will lift accordingly — engine logic stays the same.

import type { Valuation, SourceQuality } from "@/lib/types";
import type {
  NormalizedWatchRecord,
  NormalizedRealEstateRecord,
  WatchCondition,
  RealEstateCondition,
  WatchComp,
  RealEstateComp,
} from "@/lib/ingestion/types";

// Platform → trust tier for source quality. Mirrors the trust engine's
// platform classification but is local to this module so the two can evolve
// independently (valuation cares about COMP integrity; trust cares about
// SELLER integrity).
const HIGH_QUALITY_PLATFORMS = new Set([
  "chrono24", "watchbox", "crown_and_caliber", "hodinkee_shop",
  "bobs_watches", "watchfinder", "watchcharts",
]);
const MEDIUM_QUALITY_PLATFORMS = new Set(["ebay", "watchuseek"]);
const LOW_QUALITY_PLATFORMS = new Set([
  "facebook_marketplace", "craigslist", "instagram_dm", "telegram", "unknown",
]);

// ── Recency math ──────────────────────────────────────────────────────────
// Pure: takes a reference "now" so the function stays deterministic during
// tests. Defaults to Date.now() at the call site (not inside the function).
function ageHours(timestamp: string | undefined, nowMs: number): number | null {
  if (!timestamp) return null;
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / (1000 * 60 * 60));
}

// Recency → 0-100 score. Fresh data is worth a lot; stale data quickly
// loses value. Unknown recency is penalized harder than 90-day-old data
// because the engine can't even bound the staleness.
function scoreRecency(hours: number | null): number {
  if (hours === null) return 25;          // unknown — heavy penalty
  if (hours <= 24) return 100;            // <1 day
  if (hours <= 72) return 90;             // <3 days
  if (hours <= 168) return 78;            // <1 week
  if (hours <= 720) return 60;            // <30 days
  if (hours <= 2160) return 40;           // <90 days
  return 20;                              // older than a quarter
}

function scoreCompCount(n: number | undefined): number {
  if (n === undefined || n === null) return 30;
  if (n >= 10) return 100;
  if (n >= 5) return 85;
  if (n >= 3) return 70;
  if (n >= 1) return 50;
  return 25;
}

function platformQualityScore(platform: string | undefined): number {
  if (!platform) return 40;
  if (HIGH_QUALITY_PLATFORMS.has(platform)) return 95;
  if (MEDIUM_QUALITY_PLATFORMS.has(platform)) return 65;
  if (LOW_QUALITY_PLATFORMS.has(platform)) return 25;
  return 50;
}

function bandToQuality(score: number): SourceQuality {
  if (score >= 80) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

function confidenceLabelFor(score: number): string {
  if (score >= 85) return "high-confidence valuation";
  if (score >= 70) return "moderate-confidence valuation";
  if (score >= 50) return "low-confidence valuation";
  return "insufficient evidence for aggressive pricing";
}

// Dispersion band as a fraction of fair value. Lower confidence → wider band.
function dispersionPct(confidence: number): number {
  if (confidence >= 90) return 0.03;
  if (confidence >= 75) return 0.06;
  if (confidence >= 60) return 0.10;
  if (confidence >= 45) return 0.15;
  return 0.22;
}

// Confidence-adjusted shrinkage: when confidence is low we pull the working
// fair value DOWN toward the conservative side of the band. This is the
// single mechanism by which uncertainty turns into smaller ceilings.
function shrinkageFactor(confidence: number): number {
  if (confidence >= 90) return 1.00;
  if (confidence >= 75) return 0.985;
  if (confidence >= 60) return 0.965;
  if (confidence >= 45) return 0.94;
  return 0.90;
}

// ── Liquidity → fair-value haircut ────────────────────────────────────────
// Slow markets have wider bid-ask spreads and higher carrying costs. The
// haircut is intentionally small — it nudges fair value, never overpowers
// condition logic.
function watchLiquidityFairValueMult(liquidity: string | undefined): number {
  if (liquidity === "High") return 1.00;
  if (liquidity === "Med") return 0.985;
  if (liquidity === "Low") return 0.965;
  return 0.985; // unknown defaults to medium
}

function realEstateLiquidityFairValueMult(daysOnMarket: number | undefined): number {
  if (typeof daysOnMarket !== "number") return 0.99;
  if (daysOnMarket <= 21) return 1.00;
  if (daysOnMarket <= 60) return 0.99;
  if (daysOnMarket <= 120) return 0.98;
  return 0.97;
}

// ─────────────────────────────────────────────────────────────────────────
// WATCHES — STRUCTURED CONDITION
// ─────────────────────────────────────────────────────────────────────────
//
// The condition object can carry either structured enums OR image-derived
// numeric scores. The merge step turns numerics into enums when the enums
// are absent. This is the single hand-off point between the (future) image
// pipeline and the deterministic valuation engine.
//
// When BOTH enums and image scores exist on the same field, we DO NOT
// silently merge — we run a disagreement detector first (see
// detectWatchConditionDisagreement) and apply a confidence penalty for
// material disagreement.

function mergeWatchImageSignals(c: WatchCondition): WatchCondition {
  const out: WatchCondition = { ...c };
  const bandIdx = (n: number | undefined, thresholds: [number, number, number]): 0 | 1 | 2 | 3 | null => {
    if (typeof n !== "number") return null;
    if (n < thresholds[0]) return 0;
    if (n < thresholds[1]) return 1;
    if (n < thresholds[2]) return 2;
    return 3;
  };

  if (!out.caseCondition) {
    const i = bandIdx(c.caseWearScore, [15, 40, 70]);
    if (i !== null) out.caseCondition = (["mint","light_wear","moderate_wear","heavy_wear"] as const)[i];
  }
  if (!out.braceletCondition) {
    const i = bandIdx(c.braceletStretchScore, [15, 40, 70]);
    if (i !== null) out.braceletCondition = (["tight","light_stretch","moderate_stretch","heavy_stretch"] as const)[i];
  }
  if (!out.crystalCondition) {
    const i = bandIdx(c.crystalDamageScore, [10, 35, 65]);
    if (i !== null) out.crystalCondition = (["clean","minor_marks","scratched","damaged"] as const)[i];
  }
  if (!out.dialCondition) {
    const i = bandIdx(c.dialDamageScore, [10, 35, 65]);
    if (i !== null) out.dialCondition = (["clean","minor_imperfection","damaged","refinished_risk"] as const)[i];
  }
  if (!out.polishRisk && typeof c.polishLikelihood === "number") {
    const p = c.polishLikelihood;
    out.polishRisk = p < 15 ? "none" : p < 40 ? "light" : p < 70 ? "moderate" : "heavy";
  }
  return out;
}

// ── Condition disagreement detector ──────────────────────────────────────
//
// When BOTH a structured enum AND an image-derived score are present for
// the same condition slot, compare them. Disagreement means one side is
// lying — either the seller's text overstates the watch, or the image
// pipeline is hallucinating wear. Either way, the engine cannot be
// confident in the valuation.
//
// Severity is the count of band-distance points across all slots:
//   1 band apart  →  +1 (e.g. mint vs light_wear — within tolerance)
//   2 bands apart →  +3 (mint vs moderate_wear — material)
//   3 bands apart →  +6 (mint vs heavy_wear — egregious)
//
// Total severity → confidence penalty (capped at −25):
//   ≥10 → −25
//   ≥6  → −18
//   ≥3  → −10
//   ≥1  → −5
type DisagreementResult = { severity: number; penalty: number; notes: string[] };

function detectWatchConditionDisagreement(c: WatchCondition | undefined): DisagreementResult {
  if (!c) return { severity: 0, penalty: 0, notes: [] };
  let severity = 0;
  const notes: string[] = [];

  const bandDelta = (
    enumVal: string | undefined,
    enumOrder: readonly string[],
    score: number | undefined,
    thresholds: [number, number, number]
  ): number => {
    if (!enumVal || typeof score !== "number") return 0;
    const enumIdx = enumOrder.indexOf(enumVal);
    if (enumIdx < 0) return 0;
    const scoreIdx =
      score < thresholds[0] ? 0
        : score < thresholds[1] ? 1
        : score < thresholds[2] ? 2
        : 3;
    return Math.abs(enumIdx - scoreIdx);
  };

  const addPair = (
    label: string,
    enumVal: string | undefined,
    enumOrder: readonly string[],
    score: number | undefined,
    thresholds: [number, number, number]
  ) => {
    const d = bandDelta(enumVal, enumOrder, score, thresholds);
    if (d === 0) return;
    const w = d === 1 ? 1 : d === 2 ? 3 : 6;
    severity += w;
    notes.push(`${label} disagreement (${enumVal} vs image=${score})`);
  };

  addPair("case", c.caseCondition, ["mint","light_wear","moderate_wear","heavy_wear"] as const, c.caseWearScore, [15, 40, 70]);
  addPair("bracelet", c.braceletCondition, ["tight","light_stretch","moderate_stretch","heavy_stretch"] as const, c.braceletStretchScore, [15, 40, 70]);
  addPair("crystal", c.crystalCondition, ["clean","minor_marks","scratched","damaged"] as const, c.crystalDamageScore, [10, 35, 65]);
  addPair("dial", c.dialCondition, ["clean","minor_imperfection","damaged","refinished_risk"] as const, c.dialDamageScore, [10, 35, 65]);
  addPair("polish", c.polishRisk, ["none","light","moderate","heavy"] as const, c.polishLikelihood, [15, 40, 70]);

  const penalty =
    severity >= 10 ? 25 :
    severity >= 6 ? 18 :
    severity >= 3 ? 10 :
    severity >= 1 ? 5 : 0;

  return { severity, penalty, notes };
}

// Structured condition adjustment.
//
// Each populated sub-condition contributes a multiplier. Severe negative
// signals compound — e.g. heavy wear + dial damage + aftermarket parts
// stack into a steep haircut. A floor of 0.55 prevents pathological
// cases from going to zero.
//
// Returns:
//   mult            — value multiplier vs. clean comp anchor
//   band            — human-readable summary string
//   populatedCount  — how many sub-conditions were specified (drives confidence)
//   severityFlags   — count of severity-weighted negative signals
function watchConditionAdjust(c: WatchCondition | undefined): {
  mult: number;
  band: string;
  populatedCount: number;
  severityFlags: number;
} {
  if (!c) {
    return { mult: 0.92, band: "no condition data", populatedCount: 0, severityFlags: 0 };
  }
  const merged = mergeWatchImageSignals(c);

  let m = 1.0;
  let pop = 0;
  let sev = 0;
  const parts: string[] = [];

  if (merged.caseCondition) {
    pop++;
    if (merged.caseCondition === "mint") { m *= 1.03; parts.push("mint case"); }
    else if (merged.caseCondition === "light_wear") parts.push("light case wear");
    else if (merged.caseCondition === "moderate_wear") { m *= 0.96; parts.push("moderate case wear"); sev += 1; }
    else { m *= 0.88; parts.push("heavy case wear"); sev += 2; }
  }
  if (merged.braceletCondition) {
    pop++;
    if (merged.braceletCondition === "tight") parts.push("tight bracelet");
    else if (merged.braceletCondition === "light_stretch") { m *= 0.98; parts.push("light bracelet stretch"); }
    else if (merged.braceletCondition === "moderate_stretch") { m *= 0.95; parts.push("moderate bracelet stretch"); sev += 1; }
    else { m *= 0.90; parts.push("heavy bracelet stretch"); sev += 2; }
  }
  if (merged.crystalCondition) {
    pop++;
    if (merged.crystalCondition === "clean") parts.push("clean crystal");
    else if (merged.crystalCondition === "minor_marks") { m *= 0.99; parts.push("minor crystal marks"); }
    else if (merged.crystalCondition === "scratched") { m *= 0.97; parts.push("scratched crystal"); }
    else { m *= 0.92; parts.push("damaged crystal"); sev += 1; }
  }
  if (merged.dialCondition) {
    pop++;
    if (merged.dialCondition === "clean") parts.push("clean dial");
    else if (merged.dialCondition === "minor_imperfection") { m *= 0.97; parts.push("minor dial flaw"); }
    else if (merged.dialCondition === "damaged") { m *= 0.85; parts.push("damaged dial"); sev += 2; }
    else { m *= 0.78; parts.push("dial refinish risk"); sev += 3; }
  }
  if (merged.polishRisk) {
    pop++;
    if (merged.polishRisk === "none") parts.push("no polish");
    else if (merged.polishRisk === "light") { m *= 0.99; parts.push("light polish"); }
    else if (merged.polishRisk === "moderate") { m *= 0.96; parts.push("moderate polish"); sev += 1; }
    else { m *= 0.90; parts.push("heavy polish"); sev += 2; }
  }
  if (merged.completeness) {
    pop++;
    if (merged.completeness === "full_set") parts.push("full set");
    else if (merged.completeness === "papers_only") { m *= 0.96; parts.push("papers only"); }
    else if (merged.completeness === "box_only") { m *= 0.95; parts.push("box only"); }
    else { m *= 0.88; parts.push("naked"); sev += 1; }
  }
  if (merged.serviceStatus) {
    pop++;
    if (merged.serviceStatus === "recent_service") { m *= 1.03; parts.push("recent service"); }
    else if (merged.serviceStatus === "service_history") { m *= 1.01; parts.push("service history"); }
    else if (merged.serviceStatus === "unknown") parts.push("service unknown");
    else { m *= 0.94; parts.push("service overdue"); sev += 1; }
  }
  if (merged.aftermarketRisk) {
    pop++;
    if (merged.aftermarketRisk === "none") parts.push("OEM");
    else if (merged.aftermarketRisk === "possible") { m *= 0.94; parts.push("possible aftermarket parts"); sev += 1; }
    else { m *= 0.82; parts.push("likely aftermarket parts"); sev += 2; }
  }

  // Compounding severity stack penalty — three+ severe flags trigger an
  // additional small haircut. Prevents linear underselling of cumulative damage.
  if (sev >= 5) m *= 0.94;
  else if (sev >= 3) m *= 0.97;

  m = Math.max(0.55, m);

  return {
    mult: m,
    band: parts.length > 0 ? parts.join(" · ") : "no condition data",
    populatedCount: pop,
    severityFlags: sev,
  };
}

// Condition completeness → confidence component (0–100). Drives the
// "we don't know enough about this watch" arm of the confidence blend.
function watchConditionCompletenessScore(populated: number): number {
  if (populated >= 7) return 100;
  if (populated >= 5) return 85;
  if (populated >= 3) return 65;
  if (populated >= 1) return 40;
  return 15;
}

// ── Comp similarity (watches) ─────────────────────────────────────────────
//
// Each comp gets a similarity weight relative to the subject. Better
// comps count more; off-reference / wrong-condition / stale comps count
// less. The weighted average is the anchor; the weighted dispersion
// drives the market-efficiency penalty.

function watchCompSimilarityWeight(c: WatchComp): number {
  let w = 1.0;
  if (c.exactReferenceMatch === true) w *= 1.5;
  else if (c.exactReferenceMatch === false) w *= 0.4;
  if (typeof c.yearDelta === "number") {
    if (c.yearDelta === 0) w *= 1.2;
    else if (c.yearDelta <= 2) w *= 1.0;
    else if (c.yearDelta <= 5) w *= 0.8;
    else w *= 0.5;
  }
  if (c.completenessMatch === true) w *= 1.10;
  else if (c.completenessMatch === false) w *= 0.85;
  if (c.conditionMatch === true) w *= 1.20;
  else if (c.conditionMatch === false) w *= 0.70;
  if (c.serviceMatch === true) w *= 1.05;
  if (typeof c.ageHours === "number") {
    if (c.ageHours <= 24) w *= 1.20;
    else if (c.ageHours <= 168) w *= 1.00;
    else if (c.ageHours <= 720) w *= 0.85;
    else w *= 0.60;
  }
  // Platform quality (0-95) → 0.5–0.975 weight contribution.
  w *= 0.5 + platformQualityScore(c.sourcePlatform) / 200;
  return Math.max(0, w);
}

type WeightedCompResult = {
  price: number;          // weighted-average price (after outlier rejection)
  totalWeight: number;    // sum of similarity weights (0 = no usable comps)
  dispersion: number;     // weighted std-dev / weighted mean (0 = perfect agreement)
  effectiveCount: number; // ⌈totalWeight⌉, used as the new compCount
  removedOutliers: number;// comps rejected as outliers (>1.25× or <0.75× preliminary mean)
};

// ── Outlier rejection ─────────────────────────────────────────────────────
//
// Step 1: compute preliminary weighted mean across ALL comps.
// Step 2: drop any comp whose price is >1.25× or <0.75× the preliminary mean.
// Step 3: recompute weighted mean + dispersion on the kept set.
//
// This is deterministic — no statistical thresholds (z-score / IQR), just
// hard ratio bounds. Bad comps no longer poison the anchor.

// Min weight a comp must clear to influence the anchor. Comps below this
// are too dissimilar to be reliable signal — they would only add noise.
const COMP_MIN_WEIGHT = 0.30;

function weightedWatchCompPrice(comps: WatchComp[] | undefined): WeightedCompResult {
  if (!comps || comps.length === 0) {
    return { price: 0, totalWeight: 0, dispersion: 0, effectiveCount: 0, removedOutliers: 0 };
  }

  // ── EXACT-MATCH DOMINANCE ──
  // If any comp carries an exactReferenceMatch flag, restrict the kept set
  // to exact matches only. The other comps become rationale color, not
  // truth. This mirrors how a top operator reads the market: one true
  // exact-ref comp beats five "close enough" comps.
  const hasExact = comps.some((c) => c.exactReferenceMatch === true);
  const candidates = hasExact
    ? comps.filter((c) => c.exactReferenceMatch === true)
    : comps;

  // Preliminary pass — full weighted mean across candidates.
  let prelimW = 0;
  let prelimPW = 0;
  for (const c of candidates) {
    if (!Number.isFinite(c.price) || c.price <= 0) continue;
    const w = watchCompSimilarityWeight(c);
    prelimW += w;
    prelimPW += w * c.price;
  }
  if (prelimW <= 0) {
    return { price: 0, totalWeight: 0, dispersion: 0, effectiveCount: 0, removedOutliers: 0 };
  }
  const prelimMean = prelimPW / prelimW;
  const upper = prelimMean * 1.25;
  const lower = prelimMean * 0.75;

  // Final pass — drop outliers AND drop comps below the minimum weight floor.
  let totalW = 0;
  let totalPW = 0;
  let removed = 0;
  const kept: WatchComp[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.price) || c.price <= 0) continue;
    if (c.price > upper || c.price < lower) {
      removed++;
      continue;
    }
    const w = watchCompSimilarityWeight(c);
    if (w < COMP_MIN_WEIGHT) {
      removed++;
      continue;
    }
    totalW += w;
    totalPW += w * c.price;
    kept.push(c);
  }
  // If outlier + low-weight rejection ate every comp, fall back to
  // preliminary mean rather than returning zero.
  if (totalW <= 0) {
    return {
      price: Math.round(prelimMean),
      totalWeight: prelimW,
      dispersion: 0,
      effectiveCount: Math.max(1, Math.ceil(prelimW)),
      removedOutliers: removed,
    };
  }
  const mean = totalPW / totalW;
  let varSum = 0;
  for (const c of kept) {
    const w = watchCompSimilarityWeight(c);
    varSum += w * (c.price - mean) * (c.price - mean);
  }
  const variance = varSum / totalW;
  const stddev = Math.sqrt(variance);
  return {
    price: Math.round(mean),
    totalWeight: totalW,
    dispersion: mean > 0 ? stddev / mean : 0,
    effectiveCount: Math.max(1, Math.ceil(totalW)),
    removedOutliers: removed,
  };
}

// ── Market efficiency ─────────────────────────────────────────────────────
//
// When the market is dense and tight, visible upside has likely already
// been arbitraged. The penalty is intentionally modest — it nudges the
// engine toward humility in efficient markets without blocking legitimate
// fast opportunities.
function marketEfficiencyPenalty(args: {
  effectiveCount: number;
  dispersion: number;
  liquidity?: string;
}): { penalty: number; note: string } {
  const { effectiveCount, dispersion, liquidity } = args;
  if (effectiveCount < 5 || dispersion <= 0) return { penalty: 0, note: "" };
  if (dispersion < 0.04 && liquidity === "High") {
    return { penalty: 8, note: "efficient market — visible upside likely arbitraged" };
  }
  if (dispersion < 0.04) {
    return { penalty: 5, note: "tight comp dispersion — limited edge" };
  }
  if (dispersion < 0.06) {
    return { penalty: 3, note: "moderately efficient market" };
  }
  return { penalty: 0, note: "" };
}

// ── Valuation fragility ──────────────────────────────────────────────────
//
// "Fragility" is distinct from confidence. Confidence answers "are we sure
// this fair value is right?". Fragility answers "how many critical
// assumptions are doing all the work?". A valuation can be high-confidence
// AND fragile (e.g. one excellent comp with no condition data — confidence
// is high because the data is good, but fragility is high because if that
// one comp is wrong, we have nothing else).
//
// Fragility folds into confidence as a secondary penalty AND surfaces its
// dominant-assumption flags into the rationale. Top operators always know
// "what assumption is doing the most work" — this models that.

type FragilityResult = { score: number; flags: string[] };

function computeWatchFragility(args: {
  effectiveCompCount: number;
  conditionPopulated: number;
  conditionMult: number;
  disagreementSeverity: number;
  liquidity: string | undefined;
  dispersion: number;
  recencyHours: number | null;
  hasComps: boolean;
}): FragilityResult {
  const flags: string[] = [];
  let s = 0;

  if (args.effectiveCompCount <= 1) {
    s += 22;
    flags.push("single-comp dependency");
  }
  if (args.conditionPopulated < 3) {
    s += 16;
    flags.push("thin condition evidence");
  }
  // Optimistic condition (multiplier ≥ 1.0) on thin evidence is the
  // single most dangerous valuation pattern — it means the engine is
  // adding value while admitting it doesn't know much.
  if (args.conditionMult >= 1.0 && args.conditionPopulated < 5) {
    s += 14;
    flags.push("optimistic condition on thin data");
  }
  if (args.disagreementSeverity > 0) {
    s += 18;
    flags.push("condition signals disagree");
  }
  if (args.liquidity === "Low") {
    s += 8;
    flags.push("low-liquidity exit");
  }
  if (args.dispersion > 0.10) {
    s += 10;
    flags.push("wide comp scatter");
  }
  if (!args.hasComps && (args.recencyHours === null || args.recencyHours > 720)) {
    s += 12;
    flags.push("no live feed and stale anchor");
  }

  return { score: Math.min(100, s), flags };
}

function computeRealEstateFragility(args: {
  effectiveCompCount: number;
  conditionPopulated: number;
  haircut: number;
  daysOnMarket: number | undefined;
  dispersion: number;
  recencyHours: number | null;
  hasComps: boolean;
  arvDoesAllWork: boolean;
}): FragilityResult {
  const flags: string[] = [];
  let s = 0;

  if (args.effectiveCompCount <= 1) {
    s += 18;
    flags.push("single-comp dependency");
  }
  if (args.conditionPopulated < 2) {
    s += 18;
    flags.push("thin condition evidence");
  }
  // ARV doing all the work — no comps, no condition data, no DOM signal
  if (args.arvDoesAllWork) {
    s += 16;
    flags.push("ARV is the only anchor");
  }
  if (args.haircut < 0.10 && args.conditionPopulated < 3) {
    s += 10;
    flags.push("optimistic rehab estimate on thin data");
  }
  if (typeof args.daysOnMarket === "number" && args.daysOnMarket > 90) {
    s += 8;
    flags.push("stale listing (DOM > 90)");
  }
  if (args.dispersion > 0.10) {
    s += 10;
    flags.push("wide comp scatter");
  }
  if (!args.hasComps && (args.recencyHours === null || args.recencyHours > 2160)) {
    s += 8;
    flags.push("no live feed");
  }

  return { score: Math.min(100, s), flags };
}

export function computeWatchValuation(
  rec: NormalizedWatchRecord,
  nowMs: number = Date.now()
): Valuation {
  // ── 1. ANCHOR — weighted comps preferred over a single marketPrice ──
  const weighted = weightedWatchCompPrice(rec.comps);
  const anchorFromComps = weighted.totalWeight > 0;
  const anchor = anchorFromComps
    ? weighted.price
    : typeof rec.marketPrice === "number" ? rec.marketPrice : 0;

  const effectiveCompCount = anchorFromComps
    ? weighted.effectiveCount
    : rec.compCount ?? 0;
  const dispersion = anchorFromComps ? weighted.dispersion : 0;

  // ── 2. COMPONENT CONFIDENCE SCORES ──
  const recencyHours = ageHours(rec.listingTimestamp, nowMs);
  const recScore = scoreRecency(recencyHours);
  const compScore = scoreCompCount(effectiveCompCount);
  const platScore = platformQualityScore(rec.sourcePlatform);

  // Listing fidelity — quality + serial-provided + image/text agreement proxy.
  let descriptionScore = 50;
  if (typeof rec.listingQualityScore === "number") {
    descriptionScore = Math.round(rec.listingQualityScore * 10);
  }
  if (rec.serialProvided === true) descriptionScore += 10;
  else if (rec.serialProvided === false) descriptionScore -= 15;
  descriptionScore = Math.max(0, Math.min(100, descriptionScore));

  // ── 3. CONDITION + DISAGREEMENT ──
  const condition = watchConditionAdjust(rec.condition);
  const condCompletenessScore = watchConditionCompletenessScore(condition.populatedCount);
  const disagreement = detectWatchConditionDisagreement(rec.condition);

  // ── 4. CONFIDENCE BLEND ──
  // Reweighted to give condition completeness real weight (25%). Condition
  // evidence that is thin or missing now materially drops confidence — exactly
  // as the operator brief requires.
  const rawConfidence =
    recScore * 0.25 +
    compScore * 0.25 +
    platScore * 0.15 +
    descriptionScore * 0.10 +
    condCompletenessScore * 0.25;

  const efficiency = marketEfficiencyPenalty({
    effectiveCount: effectiveCompCount,
    dispersion,
    liquidity: rec.liquidity,
  });

  // Tightening from strong evidence — high comp count + tight dispersion +
  // complete condition + recent data means the band CAN narrow further.
  const tightBonus =
    effectiveCompCount >= 5 &&
    dispersion > 0 && dispersion < 0.05 &&
    condition.populatedCount >= 5 &&
    recScore >= 78 &&
    disagreement.severity === 0
      ? 4
      : 0;

  // ── 4b. FRAGILITY (independent of confidence) ──
  const fragility = computeWatchFragility({
    effectiveCompCount,
    conditionPopulated: condition.populatedCount,
    conditionMult: condition.mult,
    disagreementSeverity: disagreement.severity,
    liquidity: rec.liquidity,
    dispersion,
    recencyHours,
    hasComps: anchorFromComps,
  });
  // Fragility folds into confidence as a secondary penalty (capped at −20).
  const fragilityPenalty = Math.min(20, Math.round(fragility.score / 5));

  const confidence = Math.round(
    Math.max(0, Math.min(100, rawConfidence - efficiency.penalty - disagreement.penalty - fragilityPenalty + tightBonus))
  );

  // ── 5. FAIR VALUE ──
  // Pipeline: anchor → condition multiplier → liquidity haircut → confidence shrinkage.
  const conditionAdjustedMarket = Math.round(anchor * condition.mult);
  const liquidityMult = watchLiquidityFairValueMult(rec.liquidity);
  const liquidityAdjusted = Math.round(conditionAdjustedMarket * liquidityMult);
  const fair = Math.round(liquidityAdjusted * shrinkageFactor(confidence));

  // Band width: max of confidence-based band and observed comp dispersion.
  // Single-comp dependency forces a wider band regardless of confidence.
  const confBand = dispersionPct(confidence);
  const fragilityBandFloor = effectiveCompCount <= 1 ? 0.08 : 0;
  const band = Math.max(confBand, dispersion, fragilityBandFloor);
  const low = Math.round(fair * (1 - band));
  const high = Math.round(fair * (1 + band));

  const quality = bandToQuality(confidence);

  // ── 6. METHOD + RATIONALE ──
  const method = anchorFromComps
    ? `weighted comp anchor (${effectiveCompCount} effective comp${effectiveCompCount === 1 ? "" : "s"}, ${weighted.removedOutliers} outlier${weighted.removedOutliers === 1 ? "" : "s"} dropped, dispersion ${(dispersion * 100).toFixed(1)}%) + structured condition adjustment`
    : recencyHours !== null && recencyHours <= 168
    ? `single-source live listing + structured condition adjustment (no comp set)`
    : `comp-anchored static estimate (no live feed; ${recencyHours === null ? "no observation timestamp" : `${Math.round(recencyHours)}h old`})`;

  const rationaleParts = [
    `Anchored on ${anchorFromComps ? `${effectiveCompCount} weighted comps` : (rec.sourcePlatform ?? "unknown source")}`,
    `recency ${recencyHours === null ? "unknown" : `${Math.round(recencyHours)}h`}`,
    `condition fields: ${condition.populatedCount}/8 (${condition.band})`,
    weighted.removedOutliers > 0 ? `outliers/low-similarity removed: ${weighted.removedOutliers}` : null,
    disagreement.penalty > 0 ? `condition disagreement −${disagreement.penalty} (${disagreement.notes.join("; ")})` : null,
    liquidityMult < 1.00 ? `liquidity haircut ${((1 - liquidityMult) * 100).toFixed(1)}% (${rec.liquidity ?? "unknown"})` : null,
    efficiency.penalty > 0 ? `efficiency penalty −${efficiency.penalty} (${efficiency.note})` : null,
    fragility.score > 20 ? `fragility ${fragility.score}/100 −${fragilityPenalty} (${fragility.flags.join("; ")})` : null,
    tightBonus > 0 ? `evidence tightening +${tightBonus}` : null,
    `→ ${confidenceLabelFor(confidence)}`,
  ].filter((x): x is string => x !== null);
  const rationale = rationaleParts.join(" · ");

  return {
    valuationTimestamp: new Date(nowMs).toISOString(),
    sourceRecencyHours: recencyHours,
    sourceQuality: quality,
    confidenceScore: confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    compCount: effectiveCompCount,
    valuationMethod: method,
    estimatedFairValue: fair,
    valuationLow: low,
    valuationHigh: high,
    rationale,
    estimatedMarketValue: conditionAdjustedMarket,
    conditionBand: condition.band,
    fragilityScore: fragility.score,
    fragilityFlags: fragility.flags,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// REAL ESTATE — STRUCTURED CONDITION
// ─────────────────────────────────────────────────────────────────────────

// Image-signal merge: numeric image scores fill in missing structured enums.
function mergeRealEstateImageSignals(c: RealEstateCondition): RealEstateCondition {
  const out: RealEstateCondition = { ...c };
  const wearBand = (n: number | undefined) =>
    typeof n === "number"
      ? n < 20 ? "turnkey"
        : n < 50 ? "dated"
        : n < 75 ? "worn"
        : "distressed"
      : undefined;
  if (!out.exteriorCondition) out.exteriorCondition = wearBand(c.exteriorWearScore);
  if (!out.interiorCondition) out.interiorCondition = wearBand(c.interiorWearScore);
  if (!out.kitchenBathCondition && typeof c.kitchenBathUpdateScore === "number") {
    const k = c.kitchenBathUpdateScore;
    out.kitchenBathCondition =
      k >= 75 ? "updated" : k >= 50 ? "dated" : k >= 25 ? "partial_rehab" : "full_rehab";
  }
  if (!out.systemsCondition && typeof c.systemsVisualRisk === "number") {
    const s = c.systemsVisualRisk;
    out.systemsCondition = s < 20 ? "modern" : s < 50 ? "aging" : s < 75 ? "end_of_life" : "failed";
  }
  if (!out.structuralRisk && typeof c.structuralVisualRisk === "number") {
    const s = c.structuralVisualRisk;
    out.structuralRisk = s < 15 ? "none" : s < 40 ? "minor" : s < 70 ? "moderate" : "major";
  }
  return out;
}

// Structured condition → multiplicative haircut against ARV.
//
// Returns a haircut (the share of ARV that condition pulls out) plus the
// completeness count and a rolled-up summary band. This replaces the old
// risk-band-only haircut with a deterministic per-system aggregation.
function realEstateConditionAdjust(
  cond: RealEstateCondition | undefined,
  risk: string | undefined,
  riskFactors: string[] | undefined
): { haircut: number; band: string; populatedCount: number; severityFlags: number } {
  // Base haircut from risk band — preserves backward compatibility for
  // records that don't carry structured condition.
  const r = (risk ?? "").toLowerCase();
  let base = 0.18;
  if (r === "low") base = 0.10;
  else if (r === "low-med") base = 0.15;
  else if (r === "medium") base = 0.22;
  else if (r === "high") base = 0.32;

  // Heavy structural flags add 2% each — same rule as before.
  const heavyFlagPattern = /foundation|structural|roof|electrical|plumbing|hvac|mold|sewer/i;
  const heavyCount = (riskFactors ?? []).filter((f) => heavyFlagPattern.test(f)).length;
  let h = base + heavyCount * 0.02;

  let pop = 0;
  let sev = 0;
  const parts: string[] = [];

  if (!cond) {
    return {
      haircut: Math.min(0.4, h),
      band: "risk-band only (no structured condition)",
      populatedCount: 0,
      severityFlags: 0,
    };
  }
  const merged = mergeRealEstateImageSignals(cond);

  const exteriorH: Record<string, number> = { turnkey: 0, dated: 0.02, worn: 0.05, distressed: 0.10 };
  const interiorH: Record<string, number> = { turnkey: 0, dated: 0.03, worn: 0.06, distressed: 0.12 };
  const kbH: Record<string, number> = { updated: 0, dated: 0.03, partial_rehab: 0.06, full_rehab: 0.10 };
  const systemsH: Record<string, number> = { modern: 0, aging: 0.02, end_of_life: 0.06, failed: 0.10 };
  const structH: Record<string, number> = { none: 0, minor: 0.02, moderate: 0.06, major: 0.14 };
  const rehabH: Record<string, number> = { light_cosmetic: 0, moderate_rehab: 0.04, heavy_rehab: 0.08 };
  const occH: Record<string, number> = {
    vacant: -0.005, owner_occupied: 0, tenant_in_place: 0.015, estate_sale: 0.005, flipper_owned: 0.02,
  };

  if (merged.exteriorCondition) { pop++; h += exteriorH[merged.exteriorCondition]; parts.push(`exterior ${merged.exteriorCondition}`); if (merged.exteriorCondition === "distressed") sev += 1; }
  if (merged.interiorCondition) { pop++; h += interiorH[merged.interiorCondition]; parts.push(`interior ${merged.interiorCondition}`); if (merged.interiorCondition === "distressed") sev += 1; }
  if (merged.kitchenBathCondition) { pop++; h += kbH[merged.kitchenBathCondition]; parts.push(`kit/bath ${merged.kitchenBathCondition}`); if (merged.kitchenBathCondition === "full_rehab") sev += 1; }
  if (merged.systemsCondition) { pop++; h += systemsH[merged.systemsCondition]; parts.push(`systems ${merged.systemsCondition}`); if (merged.systemsCondition === "failed") sev += 2; else if (merged.systemsCondition === "end_of_life") sev += 1; }
  if (merged.structuralRisk) { pop++; h += structH[merged.structuralRisk]; parts.push(`structural ${merged.structuralRisk}`); if (merged.structuralRisk === "major") sev += 3; else if (merged.structuralRisk === "moderate") sev += 1; }
  if (merged.rehabLevel) { pop++; h += rehabH[merged.rehabLevel]; parts.push(`rehab ${merged.rehabLevel}`); if (merged.rehabLevel === "heavy_rehab") sev += 1; }
  if (merged.occupancyFriction) { pop++; h += occH[merged.occupancyFriction]; parts.push(`occupancy ${merged.occupancyFriction}`); }

  // Compounding severity stack — three+ severe flags compound the haircut.
  if (sev >= 5) h += 0.04;
  else if (sev >= 3) h += 0.02;

  h = Math.max(0.05, Math.min(0.5, h));

  return {
    haircut: h,
    band: parts.length > 0 ? parts.join(" · ") : "risk-band only",
    populatedCount: pop,
    severityFlags: sev,
  };
}

function realEstateConditionCompletenessScore(populated: number): number {
  if (populated >= 6) return 100;
  if (populated >= 4) return 80;
  if (populated >= 2) return 55;
  if (populated >= 1) return 35;
  return 20;
}

// ── Comp similarity (real estate) ─────────────────────────────────────────
function realEstateCompSimilarityWeight(c: RealEstateComp): number {
  let w = 1.0;
  if (c.sameZip === true) w *= 1.4;
  else if (c.sameZip === false) w *= 0.55;
  if (c.conditionSimilar === true) w *= 1.25;
  else if (c.conditionSimilar === false) w *= 0.70;
  if (c.rehabSimilar === true) w *= 1.15;
  else if (c.rehabSimilar === false) w *= 0.80;
  if (c.saleType === "sold") w *= 1.20;
  else if (c.saleType === "pending") w *= 1.00;
  else if (c.saleType === "active") w *= 0.75;
  if (typeof c.daysOnMarket === "number") {
    if (c.daysOnMarket <= 14) w *= 1.10;
    else if (c.daysOnMarket <= 60) w *= 1.00;
    else w *= 0.85;
  }
  if (typeof c.ageHours === "number") {
    if (c.ageHours <= 720) w *= 1.10;       // <30 days
    else if (c.ageHours <= 2160) w *= 0.90; // <90 days
    else w *= 0.65;
  }
  if (typeof c.sqftDeltaPct === "number") {
    if (c.sqftDeltaPct <= 0.10) w *= 1.10;
    else if (c.sqftDeltaPct <= 0.25) w *= 0.90;
    else w *= 0.65;
  }
  return Math.max(0, w);
}

function weightedRealEstateCompPrice(comps: RealEstateComp[] | undefined): WeightedCompResult {
  if (!comps || comps.length === 0) {
    return { price: 0, totalWeight: 0, dispersion: 0, effectiveCount: 0, removedOutliers: 0 };
  }
  // Preliminary pass.
  let prelimW = 0;
  let prelimPW = 0;
  for (const c of comps) {
    if (!Number.isFinite(c.price) || c.price <= 0) continue;
    const w = realEstateCompSimilarityWeight(c);
    prelimW += w;
    prelimPW += w * c.price;
  }
  if (prelimW <= 0) {
    return { price: 0, totalWeight: 0, dispersion: 0, effectiveCount: 0, removedOutliers: 0 };
  }
  const prelimMean = prelimPW / prelimW;
  const upper = prelimMean * 1.25;
  const lower = prelimMean * 0.75;

  // Final pass — drop outliers AND drop comps below the minimum weight floor.
  let totalW = 0;
  let totalPW = 0;
  let removed = 0;
  const kept: RealEstateComp[] = [];
  for (const c of comps) {
    if (!Number.isFinite(c.price) || c.price <= 0) continue;
    if (c.price > upper || c.price < lower) {
      removed++;
      continue;
    }
    const w = realEstateCompSimilarityWeight(c);
    if (w < COMP_MIN_WEIGHT) {
      removed++;
      continue;
    }
    totalW += w;
    totalPW += w * c.price;
    kept.push(c);
  }
  if (totalW <= 0) {
    return {
      price: Math.round(prelimMean),
      totalWeight: prelimW,
      dispersion: 0,
      effectiveCount: Math.max(1, Math.ceil(prelimW)),
      removedOutliers: removed,
    };
  }
  const mean = totalPW / totalW;
  let varSum = 0;
  for (const c of kept) {
    const w = realEstateCompSimilarityWeight(c);
    varSum += w * (c.price - mean) * (c.price - mean);
  }
  const variance = varSum / totalW;
  const stddev = Math.sqrt(variance);
  return {
    price: Math.round(mean),
    totalWeight: totalW,
    dispersion: mean > 0 ? stddev / mean : 0,
    effectiveCount: Math.max(1, Math.ceil(totalW)),
    removedOutliers: removed,
  };
}

export type RealEstateValuationInput = {
  rec: NormalizedRealEstateRecord;
  askUsd: number;
  arvUsd: number;
  /** Optional pre-parsed MAO from the dataset; used for the rationale only. */
  maoUsd?: number;
};

export function computeRealEstateValuation(
  input: RealEstateValuationInput,
  nowMs: number = Date.now()
): Valuation {
  const { rec, arvUsd } = input;

  // ── 1. ANCHOR — weighted comps if available, otherwise ARV ──
  const weighted = weightedRealEstateCompPrice(rec.comps);
  const anchorFromComps = weighted.totalWeight > 0;
  const arvAnchor = anchorFromComps ? weighted.price : arvUsd;
  const effectiveCompCount = anchorFromComps
    ? weighted.effectiveCount
    : rec.compCount ?? 0;
  const dispersion = anchorFromComps ? weighted.dispersion : 0;

  // ── 2. COMPONENT CONFIDENCE SCORES ──
  const recencyHours = ageHours(rec.listingTimestamp, nowMs);
  const recScore = scoreRecency(recencyHours);
  const compScore = scoreCompCount(effectiveCompCount);

  // DOM as a freshness proxy when no listing timestamp exists.
  let domScore = 60;
  if (typeof rec.daysOnMarket === "number") {
    if (rec.daysOnMarket <= 7) domScore = 95;
    else if (rec.daysOnMarket <= 21) domScore = 80;
    else if (rec.daysOnMarket <= 60) domScore = 60;
    else if (rec.daysOnMarket <= 120) domScore = 45;
    else domScore = 30;
  }

  // Editorial completeness — base presence of ARV/MAO.
  let editorialScore = 60;
  if (arvUsd > 0) editorialScore += 10;
  if (input.maoUsd && input.maoUsd > 0) editorialScore += 10;
  editorialScore = Math.max(0, Math.min(100, editorialScore));

  // ── 3. STRUCTURED CONDITION ──
  const condition = realEstateConditionAdjust(rec.condition, rec.risk, rec.riskFactors);
  const condCompletenessScore = realEstateConditionCompletenessScore(condition.populatedCount);

  // ── 4. CONFIDENCE BLEND ──
  // Condition completeness gets 25%; missing structured condition materially
  // drops confidence (matches the operator brief).
  const rawConfidence =
    recScore * 0.20 +
    compScore * 0.25 +
    domScore * 0.15 +
    editorialScore * 0.15 +
    condCompletenessScore * 0.25;

  // Market efficiency — same shape as the watches engine, gated on
  // effective comp count + dispersion.
  let efficiencyPenalty = 0;
  let efficiencyNote = "";
  if (effectiveCompCount >= 5 && dispersion > 0) {
    if (dispersion < 0.04) {
      efficiencyPenalty = 6;
      efficiencyNote = "tight comp dispersion — limited investor edge";
    } else if (dispersion < 0.06) {
      efficiencyPenalty = 3;
      efficiencyNote = "moderately efficient submarket";
    }
  }

  const tightBonus =
    effectiveCompCount >= 5 &&
    dispersion > 0 && dispersion < 0.05 &&
    condition.populatedCount >= 4 &&
    recScore >= 78
      ? 4
      : 0;

  // ── 4b. FRAGILITY ──
  const arvDoesAllWork =
    !anchorFromComps && condition.populatedCount === 0 && typeof rec.daysOnMarket !== "number";
  const fragility = computeRealEstateFragility({
    effectiveCompCount,
    conditionPopulated: condition.populatedCount,
    haircut: condition.haircut,
    daysOnMarket: rec.daysOnMarket,
    dispersion,
    recencyHours,
    hasComps: anchorFromComps,
    arvDoesAllWork,
  });
  const fragilityPenalty = Math.min(20, Math.round(fragility.score / 5));

  const confidence = Math.round(
    Math.max(0, Math.min(100, rawConfidence - efficiencyPenalty - fragilityPenalty + tightBonus))
  );

  // ── 5. FAIR VALUE ──
  // Pipeline: ARV anchor → condition haircut → liquidity (DOM) haircut → confidence shrinkage.
  const asIs = Math.round(arvAnchor * (1 - condition.haircut));
  const liquidityMult = realEstateLiquidityFairValueMult(rec.daysOnMarket);
  const liquidityAdjusted = Math.round(asIs * liquidityMult);
  const fair = Math.round(liquidityAdjusted * shrinkageFactor(confidence));

  // Band width: max of confidence-based band, observed comp dispersion, and
  // a fragility-driven floor when relying on a single comp.
  const confBand = dispersionPct(confidence);
  const fragilityBandFloor = effectiveCompCount <= 1 ? 0.08 : 0;
  const bandPct = Math.max(confBand, dispersion, fragilityBandFloor);
  const low = Math.round(fair * (1 - bandPct));
  const high = Math.round(fair * (1 + bandPct));

  const quality = bandToQuality(confidence);
  const method = anchorFromComps
    ? `weighted local comp set (${effectiveCompCount} effective comps, ${weighted.removedOutliers} outlier${weighted.removedOutliers === 1 ? "" : "s"} dropped, dispersion ${(dispersion * 100).toFixed(1)}%) + structured condition haircut`
    : recencyHours !== null && recencyHours <= 720
    ? `editorial ARV anchor + structured condition haircut (DOM ${rec.daysOnMarket ?? "unknown"})`
    : `editorial ARV anchor + structured condition haircut (no live comp feed)`;

  const rationaleParts = [
    `Anchor ${anchorFromComps ? `${effectiveCompCount} weighted comps` : `ARV $${arvUsd.toLocaleString("en-US")}`}`,
    `condition haircut ${(condition.haircut * 100).toFixed(0)}% (${condition.populatedCount}/7 fields, ${condition.band})`,
    weighted.removedOutliers > 0 ? `outliers/low-similarity removed: ${weighted.removedOutliers}` : null,
    `DOM ${rec.daysOnMarket ?? "?"}`,
    liquidityMult < 1.00 ? `liquidity haircut ${((1 - liquidityMult) * 100).toFixed(1)}% (DOM-based)` : null,
    efficiencyPenalty > 0 ? `efficiency penalty −${efficiencyPenalty} (${efficiencyNote})` : null,
    fragility.score > 20 ? `fragility ${fragility.score}/100 −${fragilityPenalty} (${fragility.flags.join("; ")})` : null,
    tightBonus > 0 ? `evidence tightening +${tightBonus}` : null,
    `→ ${confidenceLabelFor(confidence)}`,
  ].filter((x): x is string => x !== null);
  const rationale = rationaleParts.join(" · ");

  return {
    valuationTimestamp: new Date(nowMs).toISOString(),
    sourceRecencyHours: recencyHours,
    sourceQuality: quality,
    confidenceScore: confidence,
    confidenceLabel: confidenceLabelFor(confidence),
    compCount: effectiveCompCount,
    valuationMethod: method,
    estimatedFairValue: fair,
    valuationLow: low,
    valuationHigh: high,
    rationale,
    estimatedAsIsValue: asIs,
    estimatedARV: arvUsd,
    fragilityScore: fragility.score,
    fragilityFlags: fragility.flags,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CONFIDENCE → EXECUTION BEHAVIOR (shared)
// ─────────────────────────────────────────────────────────────────────────
//
// The single source of truth for "how does uncertainty become caution".
// Both compute*Acquisition functions read this so the rules can't drift.

export type ConfidenceAdjustment = {
  ceilingMultiplier: number;       // applied to maxBuy (≤1.0)
  walkAwayBufferPct: number;       // replaces the 0.02 default in walk-away
  convictionMultiplier: number;    // applied to score before recording (≤1.0)
  blockAggressive: boolean;        // if true, AGGRESSIVE collapses to CONTROLLED
  forceMonitor: boolean;           // if true, signal cannot exceed MONITOR
  note: string;
};

export function confidenceToExecution(confidence: number): ConfidenceAdjustment {
  if (confidence >= 85) {
    return {
      ceilingMultiplier: 1.00,
      walkAwayBufferPct: 0.02,
      convictionMultiplier: 1.00,
      blockAggressive: false,
      forceMonitor: false,
      note: "High confidence — execution at full ladder",
    };
  }
  if (confidence >= 70) {
    return {
      ceilingMultiplier: 0.98,
      walkAwayBufferPct: 0.015,
      convictionMultiplier: 0.95,
      blockAggressive: false,
      forceMonitor: false,
      note: "Moderate confidence — small ceiling and walk-away tightening",
    };
  }
  if (confidence >= 55) {
    return {
      ceilingMultiplier: 0.95,
      walkAwayBufferPct: 0.01,
      convictionMultiplier: 0.85,
      blockAggressive: true,
      forceMonitor: false,
      note: "Low-moderate confidence — no aggressive posture, conservative ceiling",
    };
  }
  if (confidence >= 40) {
    return {
      ceilingMultiplier: 0.90,
      walkAwayBufferPct: 0.005,
      convictionMultiplier: 0.70,
      blockAggressive: true,
      forceMonitor: true,
      note: "Low confidence — capped at MONITOR, ceiling materially reduced",
    };
  }
  return {
    ceilingMultiplier: 0.85,
    walkAwayBufferPct: 0,
    convictionMultiplier: 0.55,
    blockAggressive: true,
    forceMonitor: true,
    note: "Insufficient evidence — block aggressive execution, valuation cannot be trusted",
  };
}
