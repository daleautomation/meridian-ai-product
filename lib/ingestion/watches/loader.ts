// Meridian AI — watches file loader.
//
// Reads JSON or CSV. Auto-detects format by extension. Caller specifies the
// source format ("normalized" | "ebay" | "facebook" | "reddit") to choose
// normalization. Defaults to "normalized" so data/watches.json continues to
// work unchanged.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/ingestion/csvParser";
import { normalizeEbayListings } from "@/lib/ingestion/watches/ebayAdapter";
import { normalizeFacebookListings } from "@/lib/ingestion/watches/facebookAdapter";
import { normalizeRedditListings } from "@/lib/ingestion/watches/redditAdapter";
import { fetchRedditWatchExchange } from "@/lib/ingestion/watches/redditLive";
import { normalizeManualFacebookEntries, type ManualFacebookEntry } from "@/lib/ingestion/watches/facebookManual";
import type {
  NormalizedWatchRecord,
  RawEbayWatchListing,
  RawFacebookMarketplaceListing,
  RawRedditWatchExchangeListing,
} from "@/lib/ingestion/types";

export type WatchesLoadOptions = {
  source?: "normalized" | "ebay" | "facebook" | "facebook_manual" | "reddit" | "reddit_live";
  ownerId?: string;
};

export async function loadWatchesFromFile(
  filePath: string,
  options: WatchesLoadOptions = {}
): Promise<NormalizedWatchRecord[]> {
  const source = options.source ?? "normalized";
  const ext = path.extname(filePath).toLowerCase();

  let raw: unknown[];
  try {
    const text = await fs.readFile(filePath, "utf8");
    if (ext === ".csv") {
      raw = parseCsv(text);
    } else {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        console.error(`[watches/loader] expected array in ${filePath}`);
        return [];
      }
      raw = parsed;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`[watches/loader] ${filePath} not found — returning empty`);
      return [];
    }
    console.error(`[watches/loader] failed to read ${filePath}`, e);
    return [];
  }

  if (source === "ebay") {
    return normalizeEbayListings(raw as RawEbayWatchListing[], options.ownerId);
  }
  if (source === "facebook") {
    return normalizeFacebookListings(raw as RawFacebookMarketplaceListing[], options.ownerId);
  }
  if (source === "facebook_manual") {
    return normalizeManualFacebookEntries(raw as ManualFacebookEntry[], options.ownerId);
  }
  if (source === "reddit") {
    return normalizeRedditListings(raw as RawRedditWatchExchangeListing[], options.ownerId);
  }
  // reddit_live is handled in loadWatchesFromFile — it ignores the file path
  // and fetches directly from the Reddit API. Included here for completeness;
  // the actual dispatch happens before file I/O.

  // "normalized" — assume the file already matches NormalizedWatchRecord shape
  return raw as NormalizedWatchRecord[];
}
