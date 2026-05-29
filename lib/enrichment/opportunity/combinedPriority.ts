// Meridian — Combined Priority Architecture
//
//   Relationship Intelligence
//   + Market Intelligence (when evidence exists)
//   + Operator Preferences (sort-only tiebreaker)
//   = Priority
//
// Pure: no I/O, no Date.now() — caller injects `now`. Deterministic.
//
// CRM-only contacts are ranked by relationship class + CRM strength.
// Enriched contacts with market evidence may also surface an
// opportunity tier — but ONLY when listing or public-record evidence
// exists. The opportunity engine is preserved; this module composes
// its output with relationship classification for workspace ranking
// and UI display.

import {
  buildPriorityContext,
  type PriorityContext,
} from "@/lib/personal-workspace/priorityContext";
import {
  classifyRelationship,
  type RelationshipClass,
  type RelationshipClassification,
  type RelationshipClassificationInput,
} from "./relationshipClassification";
import { MARKET_EVIDENCE_FACTORS } from "./scoreOpportunity";
import type { OpportunityFactorName, OpportunitySignal, OpportunityTier } from "./types";

/** Relationship-class ranking (higher surfaces first). */
export const CLASS_RANK: Record<RelationshipClass, number> = {
  past_seller_reconnect: 4,
  seller_history_verify_recency: 3,
  sphere_reengagement: 2,
  cold_relationship: 1,
  not_reachable: 0,
};

/** Opportunity-tier ranking for enriched contacts (higher surfaces first). */
export const OPPORTUNITY_TIER_RANK: Record<OpportunityTier, number> = {
  HIGH: 3,
  MED: 2,
  REVIEW: 1,
  WEAK: 0,
};

const MARKET_FACTOR_LABEL: Partial<Record<OpportunityFactorName, string>> = {
  active_listing_found: "Active listing",
  listed_by_another_agent: "Listed by another agent",
  ownership_duration_over_7yr: "Ownership duration signal",
};

export interface MarketOpportunityDisplay {
  label: string;
  tier: OpportunityTier;
  score: number;
  summary: string;
  context: PriorityContext;
}

export interface CombinedPrioritySortKey {
  classRank: number;
  opportunityTierRank: number;
  operatorPreferenceWeight: number;
  strengthTiebreaker: number;
}

export interface CombinedPriority {
  classification: RelationshipClassification;
  reachabilityStatus: "Reachable" | "Not Reachable";
  lastInteractionRecency: string;
  marketOpportunity: MarketOpportunityDisplay | null;
  sortKey: CombinedPrioritySortKey;
}

export interface BuildCombinedPriorityInput {
  relationship: RelationshipClassificationInput;
  opportunity?: OpportunitySignal | null;
  /** CRM baseline strength (0–100) for tiebreaking within a class. */
  strengthTiebreaker?: number;
}

/**
 * True when an OpportunitySignal carries listing or public-record
 * evidence — the gate for showing opportunity labels in the UI.
 */
export function hasMarketEvidence(signal: OpportunitySignal): boolean {
  if (signal.tierCapReason === "no_market_evidence") return false;
  return (
    signal.priorityFactors.some((f) => f.applied && MARKET_EVIDENCE_FACTORS.has(f.name))
    || signal.publicRecordSource !== null
    || signal.listingSource !== null
  );
}

/** Primary market-evidence label for UI display. Null when no evidence. */
export function marketOpportunityLabel(signal: OpportunitySignal): string | null {
  if (!hasMarketEvidence(signal)) return null;
  const applied = signal.priorityFactors
    .filter((f) => f.applied && MARKET_EVIDENCE_FACTORS.has(f.name))
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
  if (applied.length > 0) {
    return MARKET_FACTOR_LABEL[applied[0].name] ?? applied[0].evidenceLabel;
  }
  if (signal.publicRecordSource) return "Public-record evidence";
  if (signal.listingSource) return "Active listing";
  return null;
}

/** Plain-language recency string from staleDays. */
export function formatInteractionRecency(staleDays: number | null): string {
  if (staleDays === null) return "No last-contact date on file";
  if (staleDays === 0) return "Last contact today";
  if (staleDays === 1) return "Last contact yesterday";
  if (staleDays >= 365) return `Last contact ${staleDays} days ago (≥ 12 months)`;
  return `Last contact ${staleDays} days ago`;
}

export function reachabilityStatusLabel(reachable: boolean): "Reachable" | "Not Reachable" {
  return reachable ? "Reachable" : "Not Reachable";
}

function buildMarketOpportunityDisplay(
  signal: OpportunitySignal,
): MarketOpportunityDisplay | null {
  const label = marketOpportunityLabel(signal);
  if (!label) return null;
  const context = buildPriorityContext(signal);
  const summary = [
    context.tier,
    String(context.score),
    label,
    context.grounding.address,
  ].filter(Boolean).join(" · ");
  return {
    label,
    tier: signal.priorityTier,
    score: signal.transparentPriorityScore,
    summary,
    context,
  };
}

/**
 * Compose relationship classification + optional market opportunity +
 * operator preference into a single priority view for workspace ranking
 * and UI consumption.
 */
export function buildCombinedPriority(input: BuildCombinedPriorityInput): CombinedPriority {
  const classification = classifyRelationship(input.relationship);
  const strengthTiebreaker = input.strengthTiebreaker ?? 0;
  const opportunity = input.opportunity ?? null;
  const marketOpportunity =
    opportunity && hasMarketEvidence(opportunity)
      ? buildMarketOpportunityDisplay(opportunity)
      : null;

  return {
    classification,
    reachabilityStatus: reachabilityStatusLabel(classification.reachable),
    lastInteractionRecency: formatInteractionRecency(classification.staleDays),
    marketOpportunity,
    sortKey: {
      classRank: CLASS_RANK[classification.label],
      opportunityTierRank: marketOpportunity
        ? OPPORTUNITY_TIER_RANK[marketOpportunity.tier]
        : 0,
      operatorPreferenceWeight: opportunity?.operatorPreferenceWeight ?? 0,
      strengthTiebreaker,
    },
  };
}

/**
 * Compare two CombinedPriority sort keys. Returns positive when `b`
 * should sort above `a` (descending priority).
 */
export function compareCombinedPriority(a: CombinedPriority, b: CombinedPriority): number {
  const ka = a.sortKey;
  const kb = b.sortKey;
  if (kb.classRank !== ka.classRank) return kb.classRank - ka.classRank;
  if (kb.opportunityTierRank !== ka.opportunityTierRank) {
    return kb.opportunityTierRank - ka.opportunityTierRank;
  }
  if (kb.operatorPreferenceWeight !== ka.operatorPreferenceWeight) {
    return kb.operatorPreferenceWeight - ka.operatorPreferenceWeight;
  }
  return kb.strengthTiebreaker - ka.strengthTiebreaker;
}
