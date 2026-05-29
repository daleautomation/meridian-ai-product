// Meridian — Brookside public-record ingestion: deterministic parcel matching.
//
// Builds an O(1) lookup index from a batch of public records. Two lookup
// paths in fixed order of precedence:
//   1. `parcelId` — exact match → HIGH-confidence match
//   2. canonical `propertyKey` (address) — exact match → MED-confidence match
//
// No fuzzy matching, no scoring tricks. If both sides agree the match is
// HIGH; if only address agrees it is MED; otherwise no match.

import type {
  ParcelIndex,
  ParcelMatch,
  PublicRecord,
} from "./types";

/** Build the lookup index from a batch of public records. */
export function buildParcelIndex(records: readonly PublicRecord[]): ParcelIndex {
  const byParcelId = new Map<string, PublicRecord>();
  const byPropertyKey = new Map<string, PublicRecord>();

  for (const record of records) {
    const parcelId = record.property.parcelId;
    if (parcelId && !byParcelId.has(parcelId)) {
      byParcelId.set(parcelId, record);
    }
    const propertyKey = record.property.propertyKey;
    if (propertyKey && !byPropertyKey.has(propertyKey)) {
      byPropertyKey.set(propertyKey, record);
    }
  }

  return {
    byParcelId,
    byPropertyKey,
    size: records.length,
  };
}

export interface LookupQuery {
  parcelId?: string | null;
  propertyKey?: string | null;
}

/**
 * Resolve a lookup query against the index. Returns `null` when neither a
 * parcelId nor a propertyKey match. parcelId takes precedence.
 */
export function lookupMatch(
  index: ParcelIndex,
  query: LookupQuery,
): ParcelMatch | null {
  const parcelId = query.parcelId?.trim();
  if (parcelId) {
    const hit = index.byParcelId.get(parcelId);
    if (hit) {
      return {
        publicRecord: hit,
        matchType: "parcel_id",
        matchConfidence: "HIGH",
      };
    }
  }

  const propertyKey = query.propertyKey?.trim();
  if (propertyKey) {
    const hit = index.byPropertyKey.get(propertyKey);
    if (hit) {
      return {
        publicRecord: hit,
        matchType: "address",
        matchConfidence: "MED",
      };
    }
  }

  return null;
}
