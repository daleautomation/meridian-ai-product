// Meridian — Brookside public-record ingestion: public surface.
//
// Combines the CSV adapter, parcel index, and Wise Agent enrichment input
// into one clean entry point for the brief generator. The combiner is the
// only function the brief generator should call after parsing a Wise Agent
// row — it merges public-record-backed ownership / collateral facts into
// the row-derived `PropertyEnrichmentInput` without inventing new claims.

import type {
  OwnershipRecord,
  PropertyEnrichmentInput,
  PropertyRecord,
} from "@/lib/enrichment/property/types";

import { buildParcelIndex as _buildParcelIndex } from "./parcelMatcher";
import type {
  ParcelIndex,
  ParcelMatch,
  PublicRecord,
} from "./types";

export {
  parsePublicRecordCsv,
  parsePublicRecordRows,
} from "./csvAdapter";
export {
  buildParcelIndex,
  lookupMatch,
  type LookupQuery,
} from "./parcelMatcher";
export {
  cleanString,
  isProvenanceRejection,
  parseIsoDate,
  requirePublicRecordProvenance,
  type ProvenanceFailure,
  type ProvenanceOk,
} from "./provenance";
export type {
  ParcelIndex,
  ParcelMatch,
  ParcelMatchConfidence,
  ParcelMatchType,
  PublicRecord,
  PublicRecordAssessedValue,
  PublicRecordCsvRow,
  PublicRecordIngestResult,
  PublicRecordRejection,
  PublicRecordRejectionCode,
} from "./types";

/**
 * Merge a parcel match into a row-derived `PropertyEnrichmentInput`.
 *
 * Rules (in this order):
 *  1. If `base` is null AND `match` is null → return null.
 *  2. If `base` is null but `match` is HIGH (parcelId) → synthesize a
 *     PropertyEnrichmentInput from the public record alone.
 *  3. If `base` exists and `match` exists, replace `base.property` with
 *     the public record's `PropertyRecord` (its provenance is the
 *     stronger source of truth) and use the public record's `ownership`
 *     when `base.ownership` is null. CRM-only ownership never overrides
 *     a recorder-backed `ownership` block.
 *  4. Optional collateral (assessedValueChange anchor, etc.) is not
 *     inferred — the combiner does not invent a prior assessed value.
 *  5. Stale-relationship + prior-transaction-count + priorClientClosedAt
 *     are preserved from `base` unchanged so CRM-side timing is not lost.
 *
 * No new signals are created here; signal generation continues to happen
 * in `lib/enrichment/property/sellerTiming.ts`.
 */
export function combineEnrichmentWithPublicRecord(
  base: PropertyEnrichmentInput | null,
  match: ParcelMatch | null,
): PropertyEnrichmentInput | null {
  if (!base && !match) return null;

  if (!base && match) {
    return synthesizeFromPublicRecord(match.publicRecord);
  }

  if (base && !match) return base;

  // base && match
  const baseInput = base as PropertyEnrichmentInput;
  const record = (match as ParcelMatch).publicRecord;

  // Public record's PropertyRecord is the stronger property identity.
  const property: PropertyRecord = {
    ...record.property,
    // Preserve the address line from whichever side normalized cleaner —
    // both went through canonicalPropertyKey, so equality is already proven
    // for the cases we care about. The public-record normalized address is
    // the canonical form (situsAddress).
  };

  // Ownership: prefer recorder-backed ownership when available; never
  // demote a recorder-backed `ownership` to a CRM-derived one.
  const ownership: OwnershipRecord | null =
    record.ownership ?? baseInput.ownership ?? null;

  return {
    ...baseInput,
    property,
    ownership,
  };
}

function synthesizeFromPublicRecord(record: PublicRecord): PropertyEnrichmentInput {
  return {
    property: record.property,
    ownership: record.ownership,
    permits: undefined,
    mortgageReleases: undefined,
    neighborhoodTransfers: null,
    assessedValueChange: null,
    priorTransactionCount: null,
    staleRelationshipObservedAt: null,
    priorClientClosedAt: null,
  };
}

/** Convenience: build the index from a freshly parsed ingest result. */
export function buildIndexFromIngest(ingest: {
  records: readonly PublicRecord[];
}): ParcelIndex {
  return _buildParcelIndex(ingest.records);
}
