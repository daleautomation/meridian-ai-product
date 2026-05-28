// Meridian — opportunity scoring types.
//
// Pure types for the transparent weighted opportunity model.
// Constitution-aligned: every score is a sum of named factors, every
// factor has a source string, every uncertainty is named.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §2 Provenance Requirements — every PriorityFactor carries
//      `source`, `evidenceLabel`; every OpportunitySignal carries
//      `source`, `fetchedAt`.
//   §4 Confidence System — HIGH / MED / WEAK + REVIEW (the "needs
//      operator confirmation before acting" tier).
//   §5 Deterministic Signal Rules — types contain no inference.
//   §6 Forbidden Behaviors — no predictive percentage, no intent
//      labels, no hidden multipliers. Weights are constants.

import type { CurrentListingStatus, ListingAgentMatch } from "@/lib/enrichment/listings/types";

// ── Relationship type (derived from CRM tags) ──────────────────────

export type RelationshipType =
  | "prior_seller"
  | "prior_buyer"
  | "sphere"
  | "referral"
  | "unknown";

// ── Owner-name match confidence (from property layer) ──────────────
// Mirrors the existing OwnerNameMatchResult.confidence ladder but
// expressed for the opportunity layer's consumption.

export type OwnerMatchConfidence = "HIGH" | "MED" | "WEAK" | null;

// ── Opportunity tier ───────────────────────────────────────────────
//
// Tier semantics (rank from lowest to highest priority):
//   WEAK   — low signal, do not pursue
//   REVIEW — potentially valuable but a verification step is needed
//            before acting (typically: weak owner match)
//   MED    — secondary priority
//   HIGH   — top priority this week

export type OpportunityTier = "HIGH" | "MED" | "WEAK" | "REVIEW";

// ── Named, weighted factors (the complete closed set) ──────────────

export type OpportunityFactorName =
  | "prior_seller_relationship"
  | "prior_buyer_relationship"
  | "operator_preference_seller_bias"
  | "active_listing_found"
  | "listed_by_another_agent"
  | "ownership_duration_over_7yr"
  | "stale_relationship_over_12mo"
  | "verified_contact_path";

export interface PriorityFactor {
  name: OpportunityFactorName;
  /** Numeric contribution this factor would add when applied. When
   *  `applied` is false the contribution to the total is 0; the weight
   *  here documents what would have applied. */
  weight: number;
  applied: boolean;
  /** True when the factor was eligible by its primary condition but
   *  was decayed by a freshness window (e.g. stale listing > 60 days).
   *  Decayed factors contribute 0. */
  decayed?: boolean;
  /** Provenance for the input that caused this factor to fire.
   *  Examples: "crm:tag:Seller", "workspace:nicole-lonergan",
   *  "heartland_mls_export 2026-05-15", "public_record 2010-11-15".
   *  Empty string when applied is false. */
  source: string;
  evidenceLabel: string;
}

// ── Uncertainty (visible in every OpportunitySignal) ───────────────

export type UncertaintyCode =
  | "owner_match_weak"
  | "owner_match_missing"
  | "ambiguous_parcel"
  | "stale_listing"
  | "no_listing_source_loaded"
  | "no_public_record_source_loaded";

export interface UncertaintyReason {
  code: UncertaintyCode;
  detail?: string;
}

// ── Why a tier cap was applied ─────────────────────────────────────

export type TierCapReason = "weak_owner_match" | "no_actionable_channel" | null;

// ── Main signal ────────────────────────────────────────────────────

export interface OpportunitySignal {
  // Provenance (constitution §2 — non-optional)
  source: "meridian_opportunity_v1";
  fetchedAt: string; // ISO-8601 UTC

  // Identity
  contactId: string;
  contactName: string;
  relationshipType: RelationshipType;
  relationshipTypeSource: string; // e.g. "crm:tag:Seller" or "crm:none"
  operatorPreferenceWeight: number; // actual weight applied (0 when none)

  // Property linkage (optional)
  matchedPropertyAddress: string | null;
  parcelId: string | null;
  ownerName: string | null;
  ownerMatchConfidence: OwnerMatchConfidence;
  ownershipDurationYears: number | null;
  lastSaleDate: string | null;
  /**
   * Source string for the public record that backed the ownership
   * fields above. Equals input.publicRecordSource. Null when no
   * public-record substrate was loaded for this contact. Carried
   * through to the signal so consumers can show provenance without
   * walking the factor list. Constitution §2.
   */
  publicRecordSource: string | null;

  // Listing context (optional)
  currentListingStatus: CurrentListingStatus;
  listingAgentName: string | null;
  listingAgentMatch: ListingAgentMatch;
  listingSource: string | null;
  listingObservedAt: string | null;

  // Scoring breakdown
  revenueOpportunitySignals: OpportunityFactorName[]; // names of factors that applied
  priorityFactors: PriorityFactor[]; // every factor — applied + skipped + decayed
  uncertaintyReasons: UncertaintyReason[];
  transparentPriorityScore: number; // sum of applied weights
  priorityTier: OpportunityTier;
  tierCapReason: TierCapReason;
}

// ── Scoring input (the pipeline supplies this in Commit 3) ─────────

export interface OpportunityScoringInput {
  contactId: string;
  contactName: string;

  // Derived elsewhere (relationshipType.ts handles this)
  relationshipType: RelationshipType;
  relationshipTypeSource: string;

  // From workspace.preferences.sellerBias — 0 when no preference is set.
  // Becomes the operator_preference_seller_bias factor weight when the
  // contact is a prior_seller AND this is > 0.
  operatorSellerBias: number;

  // Property linkage (null when no public-record source was loaded)
  matchedPropertyAddress: string | null;
  parcelId: string | null;
  ownerName: string | null;
  ownerMatchConfidence: OwnerMatchConfidence;
  ownershipDurationYears: number | null;
  lastSaleDate: string | null;
  publicRecordSource: string | null;

  // Listing linkage (status="unknown" + null fields when no listings source)
  currentListingStatus: CurrentListingStatus;
  listingAgentName: string | null;
  listingAgentMatch: ListingAgentMatch;
  listingSource: string | null;
  listingObservedAt: string | null;

  // CRM identity + contactability
  hasActionableChannel: boolean;
  contactPathSource: string | null; // e.g. "crm:email" or "crm:phone"

  // For stale-relationship factor
  lastInteractionAt: string | null;

  // Injected for determinism
  now: Date;
}
