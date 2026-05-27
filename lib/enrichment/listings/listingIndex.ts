// Meridian — listing index.
//
// Pure, deterministic O(1) lookup keyed by canonical property key.
// No fuzzy matching. No "close enough" address logic. If two records
// share a property key, the LAST one wins and the key is reported on
// `duplicatePropertyKeys` so the audit can surface the conflict.

import type {
  ListingIndex,
  ListingRecord,
} from "./types";

/**
 * Build an O(1) lookup index from a batch of normalized listing
 * records. Same input → byte-identical index (Maps preserve insertion
 * order; duplicate-key arrays are sorted to drop dependency on input
 * order for the audit field).
 */
export function buildListingIndex(records: readonly ListingRecord[]): ListingIndex {
  const byPropertyKey = new Map<string, ListingRecord>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const key = record.propertyKey;
    if (!key) continue;
    if (byPropertyKey.has(key)) {
      duplicates.add(key);
    }
    byPropertyKey.set(key, record);
  }
  return {
    byPropertyKey,
    size: byPropertyKey.size,
    duplicatePropertyKeys: [...duplicates].sort(),
  };
}

/**
 * Look up a listing by canonical property key. Returns null on miss.
 * The caller is responsible for computing the propertyKey via
 * lib/enrichment/address/canonicalPropertyKey() so the lookup key
 * matches what the adapter persisted.
 *
 * Case-insensitive contract: callers should normalize the propertyKey
 * to lowercase. canonicalPropertyKey() already does this; the lookup
 * does NOT secondarily lower-case, because doing so would silently
 * accept mismatched keys and weaken the determinism guarantee.
 */
export function lookupListingByAddress(
  index: ListingIndex,
  propertyKey: string | null | undefined,
): ListingRecord | null {
  if (!propertyKey) return null;
  const key = propertyKey.trim();
  if (key.length === 0) return null;
  return index.byPropertyKey.get(key) ?? null;
}
