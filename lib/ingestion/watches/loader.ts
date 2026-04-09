// Meridian AI — watches file loader.
//
// Reads JSON or CSV. Auto-detects format by extension. Caller specifies the
// source format ("normalized" | "ebay") to choose normalization. Defaults to
// "normalized" so the existing data/watches.json continues to work.
//
// Supports bulk loading (100+ records) deterministically — pure transforms,
// no streaming. For very large files, swap to streaming later.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/ingestion/csvParser";
import {
  normalizeEbayListings,
} from "@/lib/ingestion/watches/ebayAdapter";
import type {
  NormalizedWatchRecord,
  RawEbayWatchListing,
} from "@/lib/ingestion/types";

export type WatchesLoadOptions = {
  source?: "normalized" | "ebay";
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

  // "normalized" — assume the file already matches NormalizedWatchRecord shape
  return raw as NormalizedWatchRecord[];
}
