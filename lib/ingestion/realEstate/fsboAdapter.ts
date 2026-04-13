// Meridian AI — FSBO / Craigslist-style listing → NormalizedRealEstateRecord.
//
// Owner-sold listings are informal, low-trust, sparse metadata. But they're
// where mispriced deals live — sellers without agents often price emotionally,
// not analytically.

import type { DecisionLabelType } from "@/lib/types";
import type {
  NormalizedRealEstateRecord,
  RawFsboListing,
} from "@/lib/ingestion/types";
import {
  computeFreshnessScore,
  detectDistressSignals,
  computeDescriptionQuality,
} from "./qualityFilters";

const MAO_PERCENTAGE = 0.70;

function formatUsd(n: number | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function deriveRisk(desc: string | undefined, condition: string | undefined): string {
  const text = `${desc || ""} ${condition || ""}`.toLowerCase();
  if (/foundation|structural|fire|flood|mold|asbestos/i.test(text)) return "High";
  if (/roof|hvac|plumbing|electrical|needs work|fixer/i.test(text)) return "Medium";
  if (/dated|cosmetic|tlc/i.test(text)) return "Low-Med";
  return "Low";
}

function deriveLabel(score: number): { label: string; labelType: DecisionLabelType } {
  if (score >= 8.5) return { label: "ACT NOW", labelType: "green" };
  if (score >= 7.0) return { label: "STRONG BUY", labelType: "green" };
  if (score >= 5.0) return { label: "MONITOR", labelType: "amber" };
  return { label: "PASS", labelType: "red" };
}

function extractRiskFlags(desc: string | undefined, condition: string | undefined): string[] {
  const text = `${desc || ""} ${condition || ""}`.toLowerCase();
  const flags: string[] = [];
  if (/foundation/i.test(text)) flags.push("Foundation concerns noted");
  if (/roof/i.test(text)) flags.push("Roof condition flagged");
  if (/hvac|furnace/i.test(text)) flags.push("HVAC may need attention");
  if (/plumbing/i.test(text)) flags.push("Plumbing concerns");
  if (/as.is/i.test(text)) flags.push("Sold as-is — no repairs");
  if (/needs work|fixer|handyman/i.test(text)) flags.push("Significant rehab likely");
  if (flags.length === 0) flags.push("No inspection data — FSBO risk");
  return flags.slice(0, 4);
}

export function normalizeFsboListing(
  raw: RawFsboListing
): NormalizedRealEstateRecord | null {
  const ask = raw.askingPrice;
  const arv = raw.arvEstimate ?? 0;
  if (ask <= 0) return null;

  const rehab = raw.estimatedRehabCost ?? 0;
  const mao = arv > 0 ? Math.max(0, Math.round(arv * MAO_PERCENTAGE - rehab)) : 0;
  const equityRatio = arv > 0 ? (arv - ask) / arv : 0;

  const riskFlags = extractRiskFlags(raw.description, raw.condition);
  const risk = deriveRisk(raw.description, raw.condition);
  const riskMult = risk === "High" ? 0.4 : risk === "Medium" ? 0.7 : risk === "Low-Med" ? 0.85 : 1.0;

  const baseScore = arv > 0 ? Math.min(equityRatio * 22, 10) : 3;
  const score = Math.max(0, Math.round(baseScore * riskMult * 10) / 10);
  const { label, labelType } = deriveLabel(score);

  const tag = equityRatio >= 0.35 ? "Equity Play" : equityRatio >= 0.20 ? "Flip" : "BRRRR";
  const id = raw.listingId || `fsbo-${raw.address.zip}-${raw.address.street.replace(/\s+/g, "-")}`;

  const distress = detectDistressSignals(raw.title, raw.description, riskFlags);
  const freshness = computeFreshnessScore(raw.listedAt);
  const descQuality = computeDescriptionQuality(raw.description, raw.title);

  const nextAction = score >= 8.5
    ? `Contact seller directly. FSBO = no agent commission. Submit at $${ask.toLocaleString("en-US")}.`
    : score >= 7.0
    ? `Drive by property. If condition matches, engage seller.`
    : score >= 5.0
    ? `Monitor — re-check in 2 weeks for price drop.`
    : `No action — math doesn't work.`;

  return {
    id,
    zip: raw.address.zip,
    title: raw.address.street,
    sub: `${raw.address.city}, ${raw.address.state} ${raw.address.zip}`,
    score,
    label,
    labelType,
    tag,
    arv: formatUsd(arv) || "Unknown",
    mao: formatUsd(mao) || "Unknown",
    ask: formatUsd(ask),
    risk,
    nextAction,
    riskFactors: riskFlags,
    thesis: distress.detected
      ? `FSBO with distress signals (${distress.keywords.slice(0, 2).join(", ")}). Owner-sold = no commission, potential mispricing.`
      : `FSBO listing — owner-sold with no agent. Verify ARV independently.`,
    listingTimestamp: raw.listedAt,
    sourcePlatform: "fsbo",
    sellerType: "owner",
    freshnessScore: freshness,
    listingQualityScore: descQuality.listingQualityScore,
    distressSignals: distress,
    descriptionQualityDetail: descQuality.detail,
  };
}

export function normalizeFsboListings(
  raws: RawFsboListing[]
): NormalizedRealEstateRecord[] {
  return raws
    .map(normalizeFsboListing)
    .filter((r): r is NormalizedRealEstateRecord => r !== null);
}
