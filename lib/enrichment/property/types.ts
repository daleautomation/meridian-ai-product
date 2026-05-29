// Property ownership and seller-timing types for Brookside enrichment.
// Every field that enters a signal must trace to provenance at build time.

import type { NormalizedAddress } from "@/lib/enrichment/address";
import type { SignalConfidence } from "@/lib/recovery/signals/types";

/** Source trace for a single enriched field. */
export interface FieldProvenance {
  source: string;
  recordId: string;
  observedAt: string;
  confidence: SignalConfidence;
  evidenceUrl?: string | null;
  evidenceLabel?: string | null;
}

export type EstimatedPropertyType =
  | "single_family"
  | "condo"
  | "townhouse"
  | "multi_family"
  | "unknown";

export type EstimatedOccupancy = "owner_occupied" | "tenant_occupied" | "unknown";

/** County-recorder or assessor-backed property facts. */
export interface PropertyRecord {
  propertyKey: string;
  normalizedAddress: NormalizedAddress;
  parcelId: string | null;
  provenance: FieldProvenance;
}

export interface OwnershipRecord {
  propertyKey: string;
  ownerName: string | null;
  ownershipStartDate: string | null;
  ownershipDurationYears: number | null;
  lastTransferDate: string | null;
  estimatedPropertyType: EstimatedPropertyType;
  estimatedOccupancy: EstimatedOccupancy;
  provenance: FieldProvenance;
}

/** Deterministic seller-timing observation before RecoverySignal mapping. */
export interface PropertySignal {
  kind: SellerTimingSignalKind;
  propertyKey: string;
  observedAt: string;
  recordId: string;
  source: string;
  confidence: SignalConfidence;
  evidenceUrl: string | null;
  evidenceLabel: string;
  explanation: string;
  evidence: Record<string, unknown>;
}

export type SellerTimingSignalKind =
  | "long_term_owner"
  | "ownership_duration"
  | "likely_repeat_seller"
  | "refinancing_activity"
  | "permit_activity"
  | "neighborhood_turnover"
  | "equity_growth_window"
  | "downsizing_indicator"
  | "stale_relationship_plus_property_match";

export interface SellerTimingSignal extends PropertySignal {
  kind: SellerTimingSignalKind;
}

/** Verified inputs for deterministic seller-timing builders. */
export interface PropertyEnrichmentInput {
  property: PropertyRecord;
  ownership: OwnershipRecord | null;
  /** Recorded mortgage satisfaction / release filings. */
  mortgageReleases?: readonly {
    recordId: string;
    observedAt: string;
    evidenceUrl?: string | null;
  }[];
  /** Building permits tied to the parcel. */
  permits?: readonly {
    recordId: string;
    observedAt: string;
    evidenceUrl?: string | null;
  }[];
  /** Nearby parcel transfers in a fixed lookback window. */
  neighborhoodTransfers?: {
    count: number;
    windowDays: number;
    observedAt: string;
    recordId: string;
    evidenceUrl?: string | null;
  } | null;
  /** Assessor value change — only when both values are sourced. */
  assessedValueChange?: {
    priorValue: number;
    currentValue: number;
    observedAt: string;
    recordId: string;
    source: string;
    evidenceUrl?: string | null;
  } | null;
  /** CRM: count of prior closed transactions with this contact. */
  priorTransactionCount?: number | null;
  /** CRM stale-relationship touch timestamp (pairs with property match). */
  staleRelationshipObservedAt?: string | null;
  /** CRM prior client closing date. */
  priorClientClosedAt?: string | null;
}

/** Maps internal seller-timing kinds to workspace signal names. */
export const SELLER_TIMING_TO_WORKSPACE_SIGNAL: Record<
  SellerTimingSignalKind,
  string | null
> = {
  long_term_owner: "long_term_owner",
  ownership_duration: "ownership_duration",
  likely_repeat_seller: "repeat_client_probability",
  refinancing_activity: "refinancing_signal",
  permit_activity: "permit_activity",
  neighborhood_turnover: "neighborhood_velocity_alignment",
  equity_growth_window: "property_turnover_alignment",
  downsizing_indicator: "property_turnover_alignment",
  stale_relationship_plus_property_match: "stale_relationship",
};
