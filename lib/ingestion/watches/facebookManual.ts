// Meridian AI — manual Facebook Marketplace ingestion helper.
//
// Quick copy-paste: paste a title, price, description, location → get a
// fully normalized watch record through the existing FB adapter pipeline.
//
// Input format (data/sources/watches.facebook.manual.json):
//   [{ "title": "...", "price": 4200, "description": "...", "location": "..." }, ...]
//
// Everything else is inferred or defaulted conservatively.

import type {
  NormalizedWatchRecord,
  RawFacebookMarketplaceListing,
} from "@/lib/ingestion/types";
import { normalizeFacebookListings } from "./facebookAdapter";

export type ManualFacebookEntry = {
  title: string;
  price: number;
  description?: string;
  location?: string;
  marketPrice?: number;    // optional — if you know what it's worth
  seller?: string;         // optional — seller name
  condition?: string;      // optional — "good", "like new", etc.
};

let counter = 0;

function toRaw(entry: ManualFacebookEntry): RawFacebookMarketplaceListing {
  counter++;
  return {
    listingId: `manual-${Date.now()}-${counter}`,
    title: entry.title,
    description: entry.description,
    priceUsd: entry.price,
    location: entry.location,
    listedAt: new Date().toISOString(),
    seller: {
      name: entry.seller ?? "FB Seller",
    },
    condition: entry.condition,
    estimatedMarketUsd: entry.marketPrice,
  };
}

export function normalizeManualFacebookEntries(
  entries: ManualFacebookEntry[],
  ownerId?: string
): NormalizedWatchRecord[] {
  const raws = entries.map(toRaw);
  return normalizeFacebookListings(raws, ownerId);
}
