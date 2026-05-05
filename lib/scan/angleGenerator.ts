// Meridian — dynamic sales-angle generator.
//
// Replaces templated "Call now and lead with the X angle" copy with
// per-lead one-liners selected from typed variation pools and
// parameterized by evidence + trade. Pure / deterministic — same
// lead always yields the same angle so the operator's call list is
// stable across renders.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import type { Finding, LeadDiagnostics } from "@/lib/diagnostics/leadDiagnostics";

export type AngleType =
  | "conversion"   // website / quote-path leak
  | "competition"  // direct comparison vs market
  | "credibility"  // trust signals
  | "visibility"   // SEO / map-pack / paid
  | "urgency";    // timing / seasonality

export type SalesAngle = {
  type: AngleType;
  /** 0..100 — how confidently this angle applies to this lead. */
  strength: number;
  /** 1–2 sentences of context — used in Deep Report. */
  narrative: string;
  /** Single-sentence operator-facing line — used on cards / panel. */
  oneLiner: string;
  /** Concrete opener the rep can read verbatim on the call. */
  opener: string;
};

// ── Deterministic hash so a lead always picks the same template ─────

function hashLead(lead: NormalizedLead): number {
  const seed = `${lead.id ?? ""}|${lead.companyName ?? ""}`;
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// Safe template picker:
//   • returns undefined when the pool is missing/empty (caller falls
//     back instead of throwing — one bad pool can't take out the
//     whole ingestion batch);
//   • normalizes the variant index for negative values (the previous
//     `(variant + idx * 7) | 0` could produce a negative int32 for
//     high hashes, which made `pool[neg] === undefined` and broke
//     downstream `tmpl(input)` calls).
function pickFrom<T>(pool: T[] | undefined, variant: number): T | undefined {
  if (!Array.isArray(pool) || pool.length === 0) return undefined;
  const v = Number.isFinite(variant) ? Math.trunc(variant) : 0;
  const idx = ((v % pool.length) + pool.length) % pool.length;
  return pool[idx];
}

// ── Trade-tone overlays ─────────────────────────────────────────────

type TradeTone = {
  noun: string;     // jobs / installs / repairs / services
  buyer: string;    // homeowner / property owner / facility manager
  pressure: string; // demand / damage / season
  tradeName: string;
};

function tradeTone(lead: NormalizedLead): TradeTone {
  switch (lead.moduleId) {
    case "hvac":
      return { noun: "service calls", buyer: "homeowner", pressure: "seasonal demand", tradeName: "HVAC" };
    case "roofing":
      return { noun: "roofing jobs", buyer: "homeowner", pressure: "storm damage", tradeName: "roofing" };
    case "painting":
      return { noun: "projects", buyer: "homeowner", pressure: "visual trust", tradeName: "painting" };
    case "carpentry":
      return { noun: "builds", buyer: "homeowner", pressure: "portfolio expectation", tradeName: "carpentry" };
    case "plumbing":
      return { noun: "service calls", buyer: "homeowner", pressure: "emergency response", tradeName: "plumbing" };
    case "electrical":
      return { noun: "service calls", buyer: "homeowner", pressure: "reliability + safety", tradeName: "electrical" };
    default:
      return { noun: "jobs", buyer: "customer", pressure: "demand", tradeName: lead.moduleId ?? "trade" };
  }
}

// ── Template pools ──────────────────────────────────────────────────
//
// Each angle type has multiple template builders. A builder takes
// the lead + tone + a "context" (number we vary on, e.g. reviewCount)
// and returns { oneLiner, opener, narrative }. The hash variant picks
// which builder to use, so leads with the same primaryPain still
// vary their phrasing + framing.

type TemplateInput = {
  lead: NormalizedLead;
  tone: TradeTone;
  reviewCount: number | null;
  rating: number | null;
  location: string | null;
};
type TemplateOutput = { oneLiner: string; opener: string; narrative: string };
type Template = (i: TemplateInput) => TemplateOutput;

// ── CONVERSION (website / quote path) ──
const CONVERSION_TEMPLATES: Template[] = [
  ({ tone, location }) => ({
    oneLiner: location
      ? `The Google listing pulls ${tone.noun} in ${location}, but there's no site behind it — quote requests are bouncing before they land.`
      : `The listing pulls ${tone.noun}, but there's no site behind it — quote requests are bouncing before they land.`,
    opener: `Hey, I noticed your Google listing is active, but I couldn't find a verified website behind it. Are quote requests coming through Google, or mostly phone calls?`,
    narrative:
      `Active listing without a destination is the most expensive leak in the trade — every channel above the funnel pays out, but the form is missing. The fastest dollar is a single quote-path page wired into the listing.`,
  }),
  ({ tone }) => ({
    oneLiner: `The phone may catch the big ${tone.noun}, but the smaller bookings — the ones that fill the calendar — are leaking through a missing quote path.`,
    opener: `Quick question — when a customer wants to book a smaller job, do they call you directly or fill out something online? I want to understand where the calendar fills from.`,
    narrative:
      `Small-ticket ${tone.noun} convert best when the customer can act in 30 seconds. Without a quote form, those decisions cool overnight and the customer calls whoever surfaces tomorrow morning instead.`,
  }),
  ({ tone, location }) => ({
    oneLiner: location
      ? `You're already winning the search for ${tone.tradeName} in ${location}; the gap is what happens after the click.`
      : `You're already winning the search for ${tone.tradeName}; the gap is what happens after the click.`,
    opener: `Looking at how you show up in search, you're doing the hard part right. What I want to talk about is the 10 seconds after a customer clicks through — that's where most of the quote requests are getting lost.`,
    narrative:
      `Demand is already there. The conversion path is the bottleneck — same impressions, half the bookings. A clean quote page typically lifts inbound by 20–40% inside 60 days without changing ad spend.`,
  }),
  ({ tone }) => ({
    oneLiner: `Without a verified site, every paid or organic visit pays out and then disappears — there's nowhere for the ${tone.buyer} to leave a number.`,
    opener: `When someone searches your name, where do you want them to land? Right now there's nothing there, which means anyone shopping you against a competitor is making the call without ever talking to you.`,
    narrative:
      `Search visits without a destination are paid traffic with no exit. The competitor that ranks just under you keeps the visit, the form fill, and the eventual job.`,
  }),
];

// ── COMPETITION (review gap, direct comparisons) ──
const COMPETITION_TEMPLATES: Template[] = [
  ({ reviewCount, tone }) => ({
    oneLiner: reviewCount !== null
      ? `The crews showing up next to you in the local pack have triple your ${reviewCount} reviews — ${tone.buyer}s are filtering you out before they ever click.`
      : `The crews showing up next to you in the local pack have triple your review count — buyers are filtering you out before they ever click.`,
    opener: `When a homeowner is comparing three ${tone.tradeName} companies, the first cut is review count and recency. Have you looked at where you sit on that list against your nearest competitor?`,
    narrative:
      `Local-pack rank correlates almost linearly with review count and recency. Two competitors at 200+ reviews capture the click before the third option is ever considered, regardless of price or work quality.`,
  }),
  ({ tone }) => ({
    oneLiner: `On a Saturday morning when the ${tone.buyer} needs ${tone.tradeName} now, they call whoever has the most recent reviews. That math stays brutal until volume changes.`,
    opener: `In your service area, who's the loudest online — the company a homeowner would recognize from Google? I want to compare your visibility against theirs and find the gap that's costing you the most.`,
    narrative:
      `Urgency calls go to social proof. The crew with the most recent positive reviews wins those at the moment of intent, every time, without any pricing conversation.`,
  }),
  ({ rating, reviewCount }) => ({
    oneLiner: rating !== null && reviewCount !== null
      ? `${rating} stars on ${reviewCount} reviews puts you in the second cut for most comparison shoppers — same skill, different perception.`
      : `Comparison shoppers are filtering on count + recency before they read a single review — that's the gap to close.`,
    opener: `Walk me through what you're doing for reviews today. I ask because the math at your count vs the top crews is the single biggest lever before any spend goes up.`,
    narrative:
      `Review count is a perception lever, not a quality lever. Same craftsmanship at 280 reviews reads as "established", at 30 reads as "new" — independent of when the business actually started.`,
  }),
];

// ── CREDIBILITY (trust signals) ──
const CREDIBILITY_TEMPLATES: Template[] = [
  ({ tone }) => ({
    oneLiner: `Trust gets decided in the first 10 seconds — and right now those 10 seconds are working against you when a ${tone.buyer} compares options.`,
    opener: `When someone finds you online and they've never heard of you before, the first 10 seconds is everything. What do you want them to see in those 10 seconds?`,
    narrative:
      `Cold buyers vet on visible signals: review count, recent activity, photos, a real site. Any one missing pushes them to the next option. The fix is usually three changes, not thirty.`,
  }),
  ({ tone, reviewCount }) => ({
    oneLiner: reviewCount !== null
      ? `${reviewCount} reviews is real work, but without a site or active posting cadence behind it, ${tone.buyer}s aren't finishing the trust loop before they call someone else.`
      : `The work is real — the perception layer just hasn't caught up yet. That's the gap to fix first.`,
    opener: `Let me ask you something — when a customer wants to verify you before they book, where do they go? I'm trying to understand the journey before the call.`,
    narrative:
      `Quality without a perception layer underperforms in cold acquisition. Reps describe this as "we do the work, but we don't get the call" — usually it's a narrow, fixable trust gap.`,
  }),
  ({ tone }) => ({
    oneLiner: `Right now, the moment a ${tone.buyer} second-guesses, they have nothing to confirm you with. That hesitation is the leak.`,
    opener: `Quick frame — when someone hesitates between you and a competitor, what's the thing they look at to make the call? That's what I want to make undeniable.`,
    narrative:
      `Hesitation is where leads cool. Closing it requires a single source the buyer can land on and feel certain — site, recent reviews, or a simple "as seen on" panel.`,
  }),
];

// ── VISIBILITY (SEO / map-pack / paid) ──
const VISIBILITY_TEMPLATES: Template[] = [
  ({ tone, location }) => ({
    oneLiner: location
      ? `The people hunting for ${tone.tradeName} in ${location} aren't seeing you — they're seeing the next guy.`
      : `The people hunting for ${tone.tradeName} aren't seeing you — they're seeing the next guy.`,
    opener: `When someone in your area Googles "${tone.tradeName} near me," who shows up? That's the conversation — because right now it's not you, and that's the bulk of the demand.`,
    narrative:
      `Local pack ownership is winner-take-most. The top three results capture roughly 70% of the click volume; if you're outside that, your inbound is a thin slice of the total demand pool.`,
  }),
  ({ tone }) => ({
    oneLiner: `Three competitors own the map pack right now. That's three calls a day you're not getting that should be yours.`,
    opener: `I want to walk you through who's currently sitting in the top three for the queries that drive your work — and then we can talk about how to take one of those slots.`,
    narrative:
      `Map-pack rank is a 60–90 day lever, not a year-long one. Reviews + targeted local landing pages typically displace one of the top three within a quarter when consistently executed.`,
  }),
  ({ tone, location }) => ({
    oneLiner: location
      ? `In ${location}, the queries that turn into ${tone.noun} aren't surfacing you. The work's there — the door isn't.`
      : `The queries that actually turn into ${tone.noun} aren't surfacing you. The work's there — the door isn't.`,
    opener: `Tell me what jobs you most want to win — what types of work, what neighborhoods. Once I know what you're hunting, I can show you exactly which queries you're missing.`,
    narrative:
      `Visibility is solvable per-query. Most trades have 8–12 high-intent searches that drive the bulk of profitable work; ranking for even half of them shifts the calendar.`,
  }),
];

// ── URGENCY (timing / seasonality) ──
const URGENCY_TEMPLATES: Template[] = [
  ({ tone }) => ({
    oneLiner: `Heat's coming. Every week without a clean booking path is ${tone.noun} going to whoever's faster online.`,
    opener: `${tone.tradeName.charAt(0).toUpperCase() + tone.tradeName.slice(1)} demand spikes in the next 6–10 weeks. The question I want to talk through is whether you're set up to catch that wave or watch it go past.`,
    narrative:
      `Seasonal demand peaks compound: every week of the early season the customer cycle accelerates, and the company with the cleanest path wins disproportionate market share that holds through the off-season.`,
  }),
  ({ tone, location }) => ({
    oneLiner: location
      ? `Storm season's already moving through ${location}. Demand spikes for 6–10 weeks; the question is who captures it.`
      : `Storm season's already moving through the metro. Demand spikes for 6–10 weeks; the question is who captures it.`,
    opener: `When the storm cells move through, calls bunch in 48-hour windows. Are you set up to absorb that, or are most of those calls going somewhere else right now?`,
    narrative:
      `Storm-driven demand is binary: either the operations stack catches it or the demand evaporates to a competitor in 24–72 hours. The entire season's economics ride on that capture.`,
  }),
  ({ tone }) => ({
    oneLiner: `The season's already turning. Every day without a clear quote path is ${tone.noun} that should be on your calendar going to someone with less crew than you.`,
    opener: `The window to fix the funnel before peak is narrow. I'd rather talk now than in 6 weeks when both of us are out of leverage.`,
    narrative:
      `Pre-peak fixes compound for the entire season. Mid-peak fixes recover only the remaining weeks. The economics differ by 3–5x.`,
  }),
];

// ── Safe fallback angle ───────────────────────────────────────────────
//
// Returned when:
//   • a template pool is empty / undefined, OR
//   • the picked template isn't a function (defensive — should be
//     impossible after the pickFrom fix, but never trust input), OR
//   • an unexpected error fires while building any angle.
//
// Always produces a valid SalesAngle so the rep still has a one-liner
// to read instead of seeing the lead crash out of the schedule.
function fallbackAngle(
  type: AngleType,
  input: TemplateInput,
): SalesAngle {
  const { tone, location } = input;
  const where = location ? ` in ${location}` : "";
  switch (type) {
    case "conversion":
      return {
        type, strength: 50,
        oneLiner: `${tone.tradeName.charAt(0).toUpperCase() + tone.tradeName.slice(1)} demand${where} is real — the conversion path is the bottleneck worth fixing first.`,
        opener: `Walk me through what happens after a ${tone.buyer} finds you online — that's where I want to focus.`,
        narrative: `Demand isn't the problem. The path between interest and a booked job is where the leak sits.`,
      };
    case "competition":
      return {
        type, strength: 50,
        oneLiner: `Comparison shoppers are filtering on signals you can directly improve — that's the lever.`,
        opener: `Who do ${tone.buyer}s usually compare you against, and what's the thing they pick on?`,
        narrative: `Same skill, different perception. Closing the perception gap is faster than closing a quality gap.`,
      };
    case "credibility":
      return {
        type, strength: 50,
        oneLiner: `Trust gets decided in the first 10 seconds online — that surface is what we'd tighten first.`,
        opener: `When a ${tone.buyer} finds you cold, what do you want them to see right away?`,
        narrative: `Trust gates the call. Fix the trust surface and the calendar fills.`,
      };
    case "visibility":
      return {
        type, strength: 50,
        oneLiner: `The customers searching for ${tone.tradeName}${where} aren't surfacing you — that's the door we'd open.`,
        opener: `When someone searches for ${tone.tradeName} near them, who shows up? That's the conversation I want to have.`,
        narrative: `Local visibility is winner-take-most. One slot gained = a meaningful share of monthly demand.`,
      };
    case "urgency":
      return {
        type, strength: 50,
        oneLiner: `The window's narrow — fixing the booking path now compounds for the rest of the season.`,
        opener: `Pre-peak fixes pay out for the whole season. Mid-peak fixes only recover what's left. I'd rather talk now.`,
        narrative: `Seasonal economics reward early fixes by 3–5x vs. mid-season ones.`,
      };
  }
}

// ── Angle resolution ──────────────────────────────────────────────────

function topAngleTypeFor(top: Finding | null, lead: NormalizedLead): AngleType {
  if (!top) {
    if (lead.moduleId === "hvac" || lead.moduleId === "roofing") return "urgency";
    return "competition";
  }
  switch (top.type) {
    case "website":
    case "conversion":
      return "conversion";
    case "reviews":
      return "competition";
    case "seo":
      return "visibility";
    case "content":
      return "credibility";
    case "opportunity":
      return "visibility";
    default:
      return "conversion";
  }
}

function poolFor(type: AngleType): Template[] {
  let raw: unknown[];
  switch (type) {
    case "conversion":  raw = CONVERSION_TEMPLATES; break;
    case "competition": raw = COMPETITION_TEMPLATES; break;
    case "credibility": raw = CREDIBILITY_TEMPLATES; break;
    case "visibility":  raw = VISIBILITY_TEMPLATES; break;
    case "urgency":     raw = URGENCY_TEMPLATES; break;
    default: raw = [];
  }
  // Runtime filter — drops anything that isn't actually a function so
  // a malformed entry (object literal, missing arrow `=>`, accidental
  // function-call result, etc.) can never reach pickFrom and cause
  // the "tmpl is not a function" failure mode.
  if (!Array.isArray(raw)) return [];
  const safe = raw.filter((item): item is Template => typeof item === "function");
  if (safe.length !== raw.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[angle-generator] invalid template removed type="${type}" ` +
      `kept=${safe.length} of ${raw.length}`,
    );
  }
  return safe;
}

function strengthFor(type: AngleType, top: Finding | null, lead: NormalizedLead): number {
  const base =
    top?.confidence === "high" ? 80
    : top?.confidence === "medium" ? 65
    : top?.confidence === "low" ? 50
    : 45;
  let bump = 0;
  if (type === "urgency" && (lead.moduleId === "hvac" || lead.signals.stormArea === true)) bump += 10;
  if (type === "conversion" && (lead.signals.hasWebsite === false || !lead.website)) bump += 10;
  if (type === "competition" && typeof lead.signals.reviewCount === "number" && lead.signals.reviewCount < 30) bump += 8;
  return Math.max(0, Math.min(100, base + bump));
}

/**
 * Internal — may throw. Always invoked through the top-level
 * `generateAngles` safe wrapper below so an unexpected error
 * (anywhere: pool resolution, hash math, template build) cannot
 * propagate out and crash lead ingestion.
 */
function unsafeGenerateAngles(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
  topFinding: Finding | null,
): SalesAngle[] {
  const tone = tradeTone(lead);
  const rating = typeof lead.signals.rating === "number" ? lead.signals.rating : null;
  const reviewCount = typeof lead.signals.reviewCount === "number" ? lead.signals.reviewCount : null;
  const location = lead.location ?? null;
  const variant = hashLead(lead);
  const input: TemplateInput = { lead, tone, reviewCount, rating, location };

  // Decide ordered angle types: primary based on top finding, then
  // 1–2 secondaries based on other signals to give the rep options.
  const primaryType = topAngleTypeFor(topFinding, lead);
  const ordered: AngleType[] = [primaryType];
  // Add complementary types — varied so two leads with the same
  // primary get different secondaries.
  const secondaryPool: AngleType[] = ["competition", "credibility", "visibility", "urgency", "conversion"];
  const offset = variant % secondaryPool.length;
  for (let i = 0; i < secondaryPool.length && ordered.length < 3; i++) {
    const candidate = secondaryPool[(offset + i) % secondaryPool.length];
    if (candidate === primaryType) continue;
    // Skip urgency for non-seasonal trades when there's no real timing signal.
    if (
      candidate === "urgency"
      && lead.moduleId !== "hvac"
      && lead.moduleId !== "roofing"
      && lead.signals.stormArea !== true
      && lead.signals.emergencyServiceGap !== true
    ) continue;
    ordered.push(candidate);
  }

  const out: SalesAngle[] = [];
  ordered.forEach((type, idx) => {
    try {
      const pool = poolFor(type);
      // Different angle-type pools shouldn't pick template index 0
      // every time. Use unsigned-safe arithmetic so the pickFrom
      // index stays non-negative for any lead hash.
      const tmplVariant = (variant >>> 0) + idx * 7;
      const tmpl = pickFrom(pool, tmplVariant);
      // Defensive guard. After the pickFrom fix this should never
      // fire, but a non-function template (empty pool / corrupted
      // data) must not throw — it must fall back gracefully.
      if (typeof tmpl !== "function") {
        // eslint-disable-next-line no-console
        console.warn(
          `[angle-generator] missing template for type="${type}" lead="${lead.companyName ?? lead.id}" — using fallback`,
        );
        out.push(fallbackAngle(type, input));
        return;
      }
      const built = tmpl(input);
      out.push({
        type,
        strength: strengthFor(type, topFinding, lead),
        narrative: built.narrative,
        oneLiner: built.oneLiner,
        opener: built.opener,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[angle-generator] template build failed type="${type}" lead="${lead.companyName ?? lead.id}":`,
        err instanceof Error ? err.message : err,
      );
      out.push(fallbackAngle(type, input));
    }
  });

  // Always return at least one valid angle. If the loop produced
  // nothing (shouldn't happen, but pinning the contract is cheap),
  // fall back to a primary-type fallback so downstream code that
  // reads angles[0] never sees undefined.
  if (out.length === 0) {
    out.push(fallbackAngle(primaryType, input));
  }

  // Cap at 3 angles — primary plus at most 2 alternatives.
  return out.slice(0, 3);
}

/**
 * Public — never throws. Wraps the unsafe generator so any failure
 * (broken pool, malformed template, hash math, etc.) becomes a
 * single fallback angle. Lead ingestion never crashes on angle
 * generation, regardless of what's in the pools.
 */
export function generateAngles(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
  topFinding: Finding | null,
): SalesAngle[] {
  try {
    const result = unsafeGenerateAngles(lead, diagnostics, topFinding);
    if (Array.isArray(result) && result.length > 0) return result;
    // Empty/invalid result — synthesize one fallback so the contract
    // (always at least one angle) holds.
    const tone = tradeTone(lead);
    const input: TemplateInput = {
      lead,
      tone,
      reviewCount: typeof lead.signals?.reviewCount === "number" ? lead.signals.reviewCount : null,
      rating: typeof lead.signals?.rating === "number" ? lead.signals.rating : null,
      location: lead.location ?? null,
    };
    const primaryType = topAngleTypeFor(topFinding, lead);
    return [fallbackAngle(primaryType, input)];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[angle-generator] safe fallback for lead="${lead?.companyName ?? lead?.id ?? "?"}":`,
      err instanceof Error ? err.message : err,
    );
    // Last-resort fallback — minimal but still a valid SalesAngle so
    // the operator panel + calendar card never see undefined.
    let tone: TradeTone;
    try { tone = tradeTone(lead); }
    catch { tone = { noun: "jobs", buyer: "customer", pressure: "demand", tradeName: "trade" }; }
    const input: TemplateInput = {
      lead,
      tone,
      reviewCount: null,
      rating: null,
      location: lead?.location ?? null,
    };
    let primaryType: AngleType = "conversion";
    try { primaryType = topAngleTypeFor(topFinding, lead); }
    catch { primaryType = "conversion"; }
    return [fallbackAngle(primaryType, input)];
  }
}
