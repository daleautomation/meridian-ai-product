// Meridian AI — unified multi-source ingestion loader.
//
// Both verticals follow the same pattern:
//   1. Declare sources (path + type)
//   2. Load each source via the appropriate adapter
//   3. Merge into one dataset
//   4. Deduplicate (by title normalization)
//   5. Return unified records for scoring
//
// The engine doesn't know or care where the data came from.

import { loadWatchesFromFile } from "@/lib/ingestion/watches/loader";
import { loadRealEstateFromFile } from "@/lib/ingestion/realEstate/loader";
import { fetchRedditWatchExchange } from "@/lib/ingestion/watches/redditLive";
import type { NormalizedWatchRecord, NormalizedRealEstateRecord } from "@/lib/ingestion/types";
import type { WatchesLoadOptions } from "@/lib/ingestion/watches/loader";
import type { RealEstateLoadOptions } from "@/lib/ingestion/realEstate/loader";

export type SourceSpec = {
  path?: string;
  type: string; // "normalized" | "ebay" | "facebook" | "reddit" | "reddit_live" | "public-record" | "fsbo" | "scraped"
  ownerId?: string;
};

export type LoadOpportunitiesOptions = {
  vertical: "watches" | "real_estate";
  sources: SourceSpec[];
};

// ── Watches dedup: normalize title to a fuzzy key ──────────────────────
function watchDedupeKey(r: NormalizedWatchRecord): string {
  // Strip noise, lowercase, collapse whitespace → "rolex submariner 116610ln 2018"
  return (r.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Real estate dedup: normalize address ───────────────────────────────
function realEstateDedupeKey(r: NormalizedRealEstateRecord): string {
  // "6234 brookside blvd 64113"
  return `${(r.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim()} ${r.zip}`;
}

export async function loadWatchOpportunities(
  sources: SourceSpec[]
): Promise<NormalizedWatchRecord[]> {
  const all: NormalizedWatchRecord[] = [];

  for (const src of sources) {
    if (src.type === "reddit_live") {
      all.push(...await fetchRedditWatchExchange(src.ownerId));
      continue;
    }
    if (!src.path) continue;
    const opts: WatchesLoadOptions = {
      source: src.type as WatchesLoadOptions["source"],
      ownerId: src.ownerId,
    };
    const records = await loadWatchesFromFile(src.path, opts);
    all.push(...records);
  }

  // Deduplicate: keep the first occurrence (highest-priority source listed first)
  const seen = new Set<string>();
  return all.filter((r) => {
    const key = watchDedupeKey(r);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadRealEstateOpportunities(
  sources: SourceSpec[]
): Promise<NormalizedRealEstateRecord[]> {
  const all: NormalizedRealEstateRecord[] = [];

  for (const src of sources) {
    if (!src.path) continue;
    const opts: RealEstateLoadOptions = {
      source: src.type as RealEstateLoadOptions["source"],
    };
    const records = await loadRealEstateFromFile(src.path, opts);
    all.push(...records);
  }

  // Deduplicate by address + zip
  const seen = new Set<string>();
  return all.filter((r) => {
    const key = realEstateDedupeKey(r);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadOpportunities(
  options: LoadOpportunitiesOptions
): Promise<NormalizedWatchRecord[] | NormalizedRealEstateRecord[]> {
  if (options.vertical === "watches") {
    return loadWatchOpportunities(options.sources);
  }
  return loadRealEstateOpportunities(options.sources);
}
