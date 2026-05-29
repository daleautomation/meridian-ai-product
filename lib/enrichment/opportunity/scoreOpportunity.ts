// Meridian — opportunity scoring (pure, deterministic, transparent).
//
// `scoreContactOpportunity(input)` consumes a fully-assembled scoring
// input (built by the future Commit 3 pipeline) and emits an
// OpportunitySignal with:
//   • Every factor listed in `priorityFactors` (applied + skipped + decayed)
//   • A summable `transparentPriorityScore` (sum of applied weights only)
//   • Tier (HIGH / MED / WEAK / REVIEW) with explicit cap reason when applied
//   • Every uncertainty named in `uncertaintyReasons`
//   • Provenance fields populated (source = "meridian_opportunity_v1", fetchedAt)
//
// Hard rules enforced here:
//   • No `Date.now()` — `input.now` is injected
//   • No `Math.random()`
//   • No LLM
//   • No hidden multipliers — every contribution comes from the WEIGHTS table
//   • Stale listing (> 60 days since listingObservedAt) decays both
//     `active_listing_found` and `listed_by_another_agent`
//   • Weak owner match → tier capped at REVIEW
//   • No actionable contact path → tier capped at WEAK
//   • Caps compose: when both apply, the lower-rank cap wins (WEAK < REVIEW)

import type {
  OpportunityFactorName,
  OpportunityScoringInput,
  OpportunitySignal,
  OpportunityTier,
  PriorityFactor,
  TierCapReason,
  UncertaintyReason,
} from "./types";

// ── Weights (the closed table) ──────────────────────────────────────
//
// Every weight is a constant. Two factors are recorded here but DO NOT
// contribute to the score (see SCORING_FACTORS):
//   • operator_preference_seller_bias — a workspace SORT preference, not
//     evidence about the contact. Surfaced via operatorPreferenceWeight
//     for ordering only. (Audit proved it changed 0 classifications.)
//   • contact_channel_present — reachability is a GATE (no actionable
//     channel → tier capped at WEAK), not a score contribution. Weight 0.

export const WEIGHTS: Record<OpportunityFactorName, number> = {
  prior_seller_relationship: 30,
  prior_buyer_relationship: 10,
  operator_preference_seller_bias: 15, // NOT scored — sort preference only
  active_listing_found: 35,
  listed_by_another_agent: 25,
  ownership_duration_over_7yr: 15,
  stale_relationship_over_12mo: 10,
  contact_channel_present: 0, // gate, not a score contribution
};

// Factors that actually contribute to transparentPriorityScore. Excludes
// operator_preference_seller_bias (sort-only) and contact_channel_present
// (a reachability gate).
export const SCORING_FACTORS: ReadonlySet<OpportunityFactorName> = new Set<OpportunityFactorName>([
  "prior_seller_relationship",
  "prior_buyer_relationship",
  "active_listing_found",
  "listed_by_another_agent",
  "ownership_duration_over_7yr",
  "stale_relationship_over_12mo",
]);

// Market / property evidence. An "Opportunity" tier (MED/HIGH) may only
// be reached when one of these is present. CRM-only contacts (no listing
// and no public-record source loaded) are capped at WEAK and handled by
// the relationship-intelligence classifier instead.
export const MARKET_EVIDENCE_FACTORS: ReadonlySet<OpportunityFactorName> = new Set<OpportunityFactorName>([
  "active_listing_found",
  "listed_by_another_agent",
  "ownership_duration_over_7yr",
]);

// ── Tier thresholds ────────────────────────────────────────────────

const HIGH_SCORE_FLOOR = 70;
const MED_SCORE_FLOOR = 40;

// ── Freshness windows ──────────────────────────────────────────────

const LISTING_FRESHNESS_DAYS = 60;
const STALE_RELATIONSHIP_MIN_DAYS = 365;
const OWNERSHIP_DURATION_MIN_YEARS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Tier ladder (for cap composition) ──────────────────────────────
// Higher rank = higher tier. Caps act as `tier <= cap` constraints,
// so when multiple caps fire we take the minimum rank.

const TIER_RANK: Record<OpportunityTier, number> = {
  HIGH: 3,
  MED: 2,
  REVIEW: 1,
  WEAK: 0,
};

function rankToTier(rank: number): OpportunityTier {
  if (rank >= TIER_RANK.HIGH) return "HIGH";
  if (rank >= TIER_RANK.MED) return "MED";
  if (rank >= TIER_RANK.REVIEW) return "REVIEW";
  return "WEAK";
}

// ── Helpers ────────────────────────────────────────────────────────

function daysBetween(thenIso: string | null, now: Date): number | null {
  if (!thenIso) return null;
  const t = Date.parse(thenIso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

// ── Main scoring entry point ───────────────────────────────────────

export function scoreContactOpportunity(input: OpportunityScoringInput): OpportunitySignal {
  // Each `evaluate*` helper returns the canonical PriorityFactor row
  // for that factor — applied or skipped or decayed — with source
  // populated when applied and an empty string when skipped.

  const factors: PriorityFactor[] = [];
  let operatorPreferenceWeight = 0;

  // 1. prior_seller_relationship
  if (input.relationshipType === "prior_seller") {
    factors.push({
      name: "prior_seller_relationship",
      weight: WEIGHTS.prior_seller_relationship,
      applied: true,
      source: input.relationshipTypeSource || "crm:tag:Seller",
      evidenceLabel: "Tagged seller relationship in CRM",
    });
  } else {
    factors.push({
      name: "prior_seller_relationship",
      weight: WEIGHTS.prior_seller_relationship,
      applied: false,
      source: "",
      evidenceLabel: `relationshipType is ${input.relationshipType}`,
    });
  }

  // 2. prior_buyer_relationship
  if (input.relationshipType === "prior_buyer") {
    factors.push({
      name: "prior_buyer_relationship",
      weight: WEIGHTS.prior_buyer_relationship,
      applied: true,
      source: input.relationshipTypeSource || "crm:tag:Buyer",
      evidenceLabel: "Tagged buyer relationship in CRM",
    });
  } else {
    factors.push({
      name: "prior_buyer_relationship",
      weight: WEIGHTS.prior_buyer_relationship,
      applied: false,
      source: "",
      evidenceLabel: `relationshipType is ${input.relationshipType}`,
    });
  }

  // 3. operator_preference_seller_bias
  // Applies only when contact is a prior_seller AND workspace declared a
  // positive sellerBias. The contribution is input.operatorSellerBias
  // (not the WEIGHTS default) so each workspace's preference is visible.
  if (input.relationshipType === "prior_seller" && input.operatorSellerBias > 0) {
    operatorPreferenceWeight = input.operatorSellerBias;
    factors.push({
      name: "operator_preference_seller_bias",
      weight: input.operatorSellerBias,
      applied: true,
      source: "workspace:preferences.sellerBias",
      evidenceLabel: `Operator declared seller-side preference (+${input.operatorSellerBias})`,
    });
  } else {
    factors.push({
      name: "operator_preference_seller_bias",
      weight: input.operatorSellerBias || WEIGHTS.operator_preference_seller_bias,
      applied: false,
      source: "",
      evidenceLabel:
        input.relationshipType === "prior_seller"
          ? "Workspace has no sellerBias preference"
          : "Contact is not a prior_seller",
    });
  }

  // 4. active_listing_found — gated by status + freshness
  const isActiveStatus =
    input.currentListingStatus === "active" || input.currentListingStatus === "pending";
  const listingAgeDays = daysBetween(input.listingObservedAt, input.now);
  const listingIsFresh =
    listingAgeDays !== null && listingAgeDays <= LISTING_FRESHNESS_DAYS;
  const listingIsStale =
    listingAgeDays !== null && listingAgeDays > LISTING_FRESHNESS_DAYS;

  if (isActiveStatus && listingIsFresh && input.listingSource) {
    factors.push({
      name: "active_listing_found",
      weight: WEIGHTS.active_listing_found,
      applied: true,
      source: `${input.listingSource}${input.listingObservedAt ? " " + input.listingObservedAt.slice(0, 10) : ""}`,
      evidenceLabel: `Listing status ${input.currentListingStatus} observed ${listingAgeDays} days ago`,
    });
  } else if (isActiveStatus && listingIsStale) {
    factors.push({
      name: "active_listing_found",
      weight: WEIGHTS.active_listing_found,
      applied: false,
      decayed: true,
      source: input.listingSource ?? "",
      evidenceLabel: `Listing observed ${listingAgeDays} days ago (older than ${LISTING_FRESHNESS_DAYS}-day freshness window)`,
    });
  } else {
    factors.push({
      name: "active_listing_found",
      weight: WEIGHTS.active_listing_found,
      applied: false,
      source: "",
      evidenceLabel:
        input.listingSource === null
          ? "No listing source loaded"
          : `Listing status is ${input.currentListingStatus}`,
    });
  }

  // 5. listed_by_another_agent — depends on active_listing_found being
  // applied AND the agent match resolving to other_agent.
  const activeListingApplied = factors.find(
    (f) => f.name === "active_listing_found" && f.applied,
  );
  if (activeListingApplied && input.listingAgentMatch === "other_agent") {
    factors.push({
      name: "listed_by_another_agent",
      weight: WEIGHTS.listed_by_another_agent,
      applied: true,
      source: `${input.listingSource}${input.listingAgentName ? " agent:" + input.listingAgentName : ""}`,
      evidenceLabel: `Listing agent ${input.listingAgentName ?? "(named)"} is not the operator`,
    });
  } else if (
    isActiveStatus &&
    listingIsStale &&
    input.listingAgentMatch === "other_agent"
  ) {
    factors.push({
      name: "listed_by_another_agent",
      weight: WEIGHTS.listed_by_another_agent,
      applied: false,
      decayed: true,
      source: input.listingSource ?? "",
      evidenceLabel: "Listing is stale — listed-by-other factor decays with the listing",
    });
  } else {
    factors.push({
      name: "listed_by_another_agent",
      weight: WEIGHTS.listed_by_another_agent,
      applied: false,
      source: "",
      evidenceLabel: !activeListingApplied
        ? "No active listing applied — listed-by-other gated"
        : `Listing agent match is ${input.listingAgentMatch}`,
    });
  }

  // 6. ownership_duration_over_7yr
  if (
    input.ownershipDurationYears !== null &&
    input.ownershipDurationYears >= OWNERSHIP_DURATION_MIN_YEARS
  ) {
    factors.push({
      name: "ownership_duration_over_7yr",
      weight: WEIGHTS.ownership_duration_over_7yr,
      applied: true,
      source: input.publicRecordSource ?? "public_record",
      evidenceLabel: `Owned for ${input.ownershipDurationYears} years (>=7yr threshold)`,
    });
  } else {
    factors.push({
      name: "ownership_duration_over_7yr",
      weight: WEIGHTS.ownership_duration_over_7yr,
      applied: false,
      source: "",
      evidenceLabel:
        input.ownershipDurationYears === null
          ? "No ownership-duration on file"
          : `Ownership is ${input.ownershipDurationYears} years (under 7yr threshold)`,
    });
  }

  // 7. stale_relationship_over_12mo
  const lastTouchDays = daysBetween(input.lastInteractionAt, input.now);
  if (lastTouchDays !== null && lastTouchDays >= STALE_RELATIONSHIP_MIN_DAYS) {
    factors.push({
      name: "stale_relationship_over_12mo",
      weight: WEIGHTS.stale_relationship_over_12mo,
      applied: true,
      source: `crm:lastInteractionAt:${input.lastInteractionAt}`,
      evidenceLabel: `Last touch ${lastTouchDays} days ago (>=365 days)`,
    });
  } else {
    factors.push({
      name: "stale_relationship_over_12mo",
      weight: WEIGHTS.stale_relationship_over_12mo,
      applied: false,
      source: "",
      evidenceLabel:
        lastTouchDays === null
          ? "No last-interaction date on file"
          : `Last touch ${lastTouchDays} days ago (under 365-day threshold)`,
    });
  }

  // 8. contact_channel_present — a reachability GATE, not a score
  // contribution (weight 0). The no-actionable-channel cap below is the
  // enforcement; this row exists only so the signal documents
  // reachability transparently. Renamed from "verified_contact_path":
  // presence of a phone/email is NOT verification.
  if (input.hasActionableChannel) {
    factors.push({
      name: "contact_channel_present",
      weight: WEIGHTS.contact_channel_present,
      applied: true,
      source: input.contactPathSource ?? "crm:email_or_phone",
      evidenceLabel: "Contact has a phone or email on file (presence, not verified)",
    });
  } else {
    factors.push({
      name: "contact_channel_present",
      weight: WEIGHTS.contact_channel_present,
      applied: false,
      source: "",
      evidenceLabel: "No phone or email on file",
    });
  }

  // ── Sum of applied SCORING weights ───────────────────────────────
  // Only SCORING_FACTORS contribute. operator_preference_seller_bias and
  // contact_channel_present are listed in priorityFactors for
  // transparency but never added to the score.
  let transparentPriorityScore = 0;
  const revenueOpportunitySignals: OpportunityFactorName[] = [];
  for (const f of factors) {
    if (f.applied) {
      if (SCORING_FACTORS.has(f.name)) transparentPriorityScore += f.weight;
      revenueOpportunitySignals.push(f.name);
    }
  }

  // ── Tier resolution ─────────────────────────────────────────────
  // Step 1: score-derived tier
  let derivedRank: number;
  if (transparentPriorityScore >= HIGH_SCORE_FLOOR) derivedRank = TIER_RANK.HIGH;
  else if (transparentPriorityScore >= MED_SCORE_FLOOR) derivedRank = TIER_RANK.MED;
  else derivedRank = TIER_RANK.WEAK;

  // Step 2: apply caps. Each cap is "tier <= X" → rank <= TIER_RANK[X].
  // Compose by taking the minimum.
  let cappedRank = derivedRank;
  let tierCapReason: TierCapReason = null;
  // Market-evidence cap → WEAK (rank 0). An "Opportunity" (MED/HIGH)
  // may only be reached with listing or public-record evidence. A
  // contact scored purely on CRM relationship factors is capped at WEAK
  // and routed to the relationship-intelligence classifier instead.
  const hasMarketEvidence =
    factors.some((f) => f.applied && MARKET_EVIDENCE_FACTORS.has(f.name)) ||
    input.listingSource !== null ||
    input.publicRecordSource !== null;
  if (!hasMarketEvidence) {
    if (TIER_RANK.WEAK < cappedRank) {
      cappedRank = TIER_RANK.WEAK;
      tierCapReason = "no_market_evidence";
    }
  }

  // Weak-owner-match cap → REVIEW (rank 1)
  if (input.ownerMatchConfidence === "WEAK") {
    if (TIER_RANK.REVIEW < cappedRank) {
      cappedRank = TIER_RANK.REVIEW;
      tierCapReason = "weak_owner_match";
    }
  }
  // No-actionable-channel cap → WEAK (rank 0)
  if (!input.hasActionableChannel) {
    if (TIER_RANK.WEAK < cappedRank) {
      cappedRank = TIER_RANK.WEAK;
      tierCapReason = "no_actionable_channel";
    }
  }

  const priorityTier = rankToTier(cappedRank);

  // ── Uncertainty reasons ─────────────────────────────────────────
  const uncertaintyReasons: UncertaintyReason[] = [];
  if (input.ownerMatchConfidence === "WEAK") {
    uncertaintyReasons.push({ code: "owner_match_weak" });
  }
  if (
    input.matchedPropertyAddress !== null &&
    input.ownerMatchConfidence === null
  ) {
    uncertaintyReasons.push({ code: "owner_match_missing" });
  }
  if (isActiveStatus && listingIsStale) {
    uncertaintyReasons.push({
      code: "stale_listing",
      detail: `Listing observed ${listingAgeDays} days ago`,
    });
  }
  if (input.listingSource === null) {
    uncertaintyReasons.push({ code: "no_listing_source_loaded" });
  }
  if (input.publicRecordSource === null) {
    uncertaintyReasons.push({ code: "no_public_record_source_loaded" });
  }

  // ── Compose the signal ──────────────────────────────────────────
  const signal: OpportunitySignal = {
    source: "meridian_opportunity_v1",
    fetchedAt: input.now.toISOString(),
    contactId: input.contactId,
    contactName: input.contactName,
    relationshipType: input.relationshipType,
    relationshipTypeSource: input.relationshipTypeSource,
    operatorPreferenceWeight,
    matchedPropertyAddress: input.matchedPropertyAddress,
    parcelId: input.parcelId,
    ownerName: input.ownerName,
    ownerMatchConfidence: input.ownerMatchConfidence,
    ownershipDurationYears: input.ownershipDurationYears,
    lastSaleDate: input.lastSaleDate,
    publicRecordSource: input.publicRecordSource,
    currentListingStatus: input.currentListingStatus,
    listingAgentName: input.listingAgentName,
    listingAgentMatch: input.listingAgentMatch,
    listingSource: input.listingSource,
    listingObservedAt: input.listingObservedAt,
    revenueOpportunitySignals,
    priorityFactors: factors,
    uncertaintyReasons,
    transparentPriorityScore,
    priorityTier,
    tierCapReason,
  };
  return signal;
}
