// Meridian — Public-Record Intelligence Architecture v1, Commit C
//
// Pure structured rendering of an OpportunitySignal for operator
// consumption. Produces:
//   • the priority tier + transparent score
//   • the top applied factors (names + source string)
//   • property grounding (address, owner name, ownership duration)
//   • ownership source + observedAt date
//   • uncertainty / review flags as a labeled list
//
// Outputs are calm, structured, source-grounded. The constitution
// forbids hype framing — no "hot lead", "likely motivated", "high
// seller intent", "ready to transact", "AI believes". Every string
// either names a factual fact or names an uncertainty.

import type {
  OpportunitySignal,
  OpportunityTier,
  PriorityFactor,
  UncertaintyReason,
} from "@/lib/enrichment/opportunity/types";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export interface PriorityContextFactorLine {
  name: string;
  weight: number;
  source: string;
  evidenceLabel: string;
}

export interface PriorityContextGrounding {
  /** Full situs address from the parcel; null when no link. */
  address: string | null;
  /** Owner-of-record name from the latest snapshot; null when no link. */
  ownerName: string | null;
  /** Floor years (e.g. 14). Null when no public record on file. */
  ownershipDurationYears: number | null;
  /** Source string (e.g. "us-mo-jackson_manual_2026-05-27"); null otherwise. */
  publicRecordSource: string | null;
  /** ISO-8601 observation date on the snapshot — when the source observed this fact. */
  observedAt: string | null;
}

export interface PriorityContext {
  /** The priority tier — HIGH / MED / WEAK / REVIEW. */
  tier: OpportunityTier;
  /** Transparent sum of applied weights. */
  score: number;
  /** Tier-cap reason, when one fired. */
  capReason: string | null;
  /** Up to N applied factors, sorted by weight desc, ties broken by name. */
  topFactors: PriorityContextFactorLine[];
  /** Property grounding extracted from the signal. */
  grounding: PriorityContextGrounding;
  /** Uncertainty / review flag short labels. */
  reviewFlags: string[];
  /** Verbatim source provenance from the signal. */
  source: string;
  fetchedAt: string;
}

export interface PriorityContextOptions {
  /** Cap on top-applied factor count. Default 5. */
  topFactorLimit?: number;
}

function topAppliedFactors(
  factors: ReadonlyArray<PriorityFactor>,
  limit: number,
): PriorityContextFactorLine[] {
  const applied = factors.filter((f) => f.applied);
  // Stable sort: weight desc, then name asc.
  applied.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return applied.slice(0, limit).map((f) => ({
    name: f.name,
    weight: f.weight,
    source: f.source,
    evidenceLabel: f.evidenceLabel,
  }));
}

function uncertaintyShortLabel(u: UncertaintyReason): string {
  // Friendly labels — calm, source-honest, no inflated language.
  switch (u.code) {
    case "owner_match_weak":
      return "owner match weak — verify before acting";
    case "owner_match_missing":
      return "owner name unknown";
    case "ambiguous_parcel":
      return "address matches multiple parcels";
    case "stale_listing":
      return "listing older than freshness window";
    case "no_listing_source_loaded":
      return "no MLS source loaded yet";
    case "no_public_record_source_loaded":
      return "no public record on file";
    default:
      return u.code;
  }
}

/**
 * Build a structured PriorityContext from an OpportunitySignal. Pure.
 * Same input → same output.
 */
export function buildPriorityContext(
  signal: OpportunitySignal,
  options: PriorityContextOptions = {},
): PriorityContext {
  const topFactorLimit = options.topFactorLimit ?? 5;

  return {
    tier: signal.priorityTier,
    score: signal.transparentPriorityScore,
    capReason: signal.tierCapReason,
    topFactors: topAppliedFactors(signal.priorityFactors, topFactorLimit),
    grounding: {
      address: signal.matchedPropertyAddress,
      ownerName: signal.ownerName,
      ownershipDurationYears: signal.ownershipDurationYears,
      publicRecordSource: signal.publicRecordSource,
      // OpportunitySignal does not carry the snapshot's observedAt directly
      // (only fetchedAt of the score). Callers wanting the snapshot date
      // should join through workspace_contact_parcel_links.owner_snapshot_id.
      observedAt: null,
    },
    reviewFlags: signal.uncertaintyReasons.map(uncertaintyShortLabel),
    source: signal.source,
    fetchedAt: signal.fetchedAt,
  };
}

/**
 * One-line operator-readable summary suitable for an opener evidence
 * string or a workspace context badge. Calm, structured, no hype.
 *
 * Examples:
 *   "HIGH · 75 · prior_seller_relationship · 4321 W 63rd St · owned 7+ yrs · public_record"
 *   "MED · 50 · prior_buyer_relationship · address unknown · public record on file"
 *   "REVIEW · 50 · ownership match weak — verify"
 */
export function summarizePriorityContext(ctx: PriorityContext): string {
  const parts: string[] = [];
  parts.push(ctx.tier);
  parts.push(String(ctx.score));
  if (ctx.topFactors.length > 0) parts.push(ctx.topFactors[0].name);
  if (ctx.grounding.address) parts.push(ctx.grounding.address);
  if (ctx.grounding.ownershipDurationYears !== null) {
    const yrs = ctx.grounding.ownershipDurationYears;
    parts.push(yrs >= 7 ? "owned 7+ yrs" : `owned ${yrs} yr${yrs === 1 ? "" : "s"}`);
  }
  if (ctx.capReason) parts.push(`cap: ${ctx.capReason}`);
  if (ctx.reviewFlags.length > 0) parts.push(ctx.reviewFlags.join(" · "));
  return parts.join(" · ");
}

/**
 * Compute ownership-duration years from a YYYY-MM-DD ownership start
 * date and a logical "now". Exported separately so callers can use the
 * same rule when building grounding fields outside this module.
 */
export function ownershipDurationYearsFor(
  ownershipStartDate: string | null,
  now: Date,
): number | null {
  if (!ownershipStartDate) return null;
  const t = Date.parse(ownershipStartDate);
  if (!Number.isFinite(t)) return null;
  const yrs = (now.getTime() - t) / MS_PER_YEAR;
  if (!Number.isFinite(yrs) || yrs < 0) return null;
  return Math.floor(yrs);
}
