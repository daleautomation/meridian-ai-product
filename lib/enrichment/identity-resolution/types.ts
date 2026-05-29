// Meridian — Public-Record Intelligence Architecture v1, Commit B
//
// Deterministic identity resolution between CRM contacts and canonical
// parcel + ownership snapshots. Types only. The resolver function lives
// in ./resolveContactParcel.ts.
//
// Constitution §1: contact identity is T1–T3 CRM truth; ownership
// claims are T5 public record. The resolver writes a link with
// confidence; the renderer never silently presents WEAK / mismatch as
// ownership.
// Constitution §5: deterministic. No fuzzy AI. No probabilistic guess.
// Constitution §6: refuses first-name-only matches.

import type {
  LinkMatchConfidence,
  LinkMatchReason,
} from "@/lib/enrichment/public-records/canonicalStorage/types";
import type { PropertyOwnerNameMatch } from "@/lib/crm-import/types";

/** Tier returned by the resolver. */
export type ResolutionTier = "HIGH" | "MED" | "WEAK" | "NO_MATCH";

/** Why a resolution needs operator review before being acted upon. */
export type ResolutionReviewReason =
  | "trust_or_llc_owner"
  | "surname_only_match"
  | "ownership_mismatch"
  | "stale_observation";

/**
 * How the parcel was located. Affects the confidence ladder.
 *   "parcel_id" — caller had a verified parcel id (rare for v1; CRM
 *                 contacts don't carry parcel ids today)
 *   "address"   — caller looked up by canonicalPropertyKey (default)
 */
export type AddressMatchStrength = "parcel_id" | "address";

export interface ResolutionContactInput {
  contactId: string;
  /** Verbatim contact name from CRM. */
  contactName: string;
  /** Raw contact address (audit). Caller has already canonicalized for lookup. */
  contactAddress: string | null;
}

export interface ResolutionParcelInput {
  parcelId: string;
  countyCode: string;
  propertyKey: string;
  situsAddress: string;
}

export interface ResolutionSnapshotInput {
  snapshotId: string;
  /** Verbatim owner name from the public-record snapshot. */
  ownerName: string;
  /** ISO-8601 when the snapshot was observed by the source. */
  observedAt: string;
}

export interface ResolveContactParcelInput {
  contact: ResolutionContactInput;
  /** Null when caller could not find any parcel matching the contact. */
  parcel: ResolutionParcelInput | null;
  /** Null when no snapshot exists for the parcel yet. */
  snapshot: ResolutionSnapshotInput | null;
  /** How the parcel was located. Default "address". */
  matchedBy?: AddressMatchStrength;
}

export interface ContactParcelResolution {
  contactId: string;
  /** Null when NO_MATCH (no parcel input). */
  parcelId: string | null;
  /** Null when NO_MATCH or no snapshot was available. */
  snapshotId: string | null;

  tier: ResolutionTier;

  /**
   * Link confidence written to the WorkspaceContactParcelLink row.
   * Null when tier === "NO_MATCH" (no link is created).
   */
  matchConfidence: LinkMatchConfidence | null;

  /**
   * Match reason written to the link row. Null when tier === "NO_MATCH".
   */
  matchReason: LinkMatchReason | null;

  /** Verbatim outcome from classifyOwnerNameMatch. */
  ownerNameMatch: PropertyOwnerNameMatch | null;
  ownerNameMatchReason: string;

  /** Strength of the address join (echoes input.matchedBy). */
  addressMatchStrength: AddressMatchStrength | null;

  /** Why this resolution needs operator review (may be empty). */
  reviewReasons: ReadonlyArray<ResolutionReviewReason>;

  /**
   * Operator-readable, deterministic explanation that the audit / link
   * preview surfaces. Composed from inputs; banned-phrase-clean.
   */
  explanation: string;
}

/** Tunables. All optional; defaults documented at each callsite. */
export interface ResolveContactParcelOptions {
  /** Logical "now" used for stale-observation detection. Defaults to new Date(). */
  now?: Date;
  /**
   * Days past observedAt that mark a snapshot "stale" for review purposes.
   * Default 540 (≈ 18 months — matches docs/public-record-intelligence-architecture.md §5.3).
   */
  staleThresholdDays?: number;
}
