// Meridian AI — eBay-style watch listing → NormalizedWatchRecord.
//
// Pure deterministic transform. Defaults are conservative for trust:
//   - liquidity = "Med" (let the curator upgrade if they know the reference)
//   - paymentMethod = "paypal_goods" (eBay default; safe but not maximum trust)
//   - escrowAvailable = false (eBay doesn't escrow)
//   - serialProvided = whatever the listing says, default false
//
// Heuristics:
//   - Tag from title (Sport/Tool/Dress/Vintage)
//   - Year from title (4-digit pattern in 1900-2030)
//   - Listing quality from feedback × auth × box+papers signals

import type {
  NormalizedWatchRecord,
  RawEbayWatchListing,
} from "@/lib/ingestion/types";

const SPORT_KEYWORDS = [
  "submariner",
  "gmt",
  "daytona",
  "explorer",
  "sea-dweller",
  "yacht-master",
  "royal oak",
  "nautilus",
  "aquanaut",
  "black bay",
  "pelagos",
  "speedmaster",
];
const DRESS_KEYWORDS = [
  "calatrava",
  "cellini",
  "santos",
  "tank",
  "saxonia",
  "1815",
  "datejust",
  "day-date",
  "patrimony",
];
const VINTAGE_KEYWORDS = ["vintage", "1960", "1970", "1980", "no-date"];

function guessTag(title: string): string {
  const t = title.toLowerCase();
  if (VINTAGE_KEYWORDS.some((k) => t.includes(k))) return "Vintage";
  if (SPORT_KEYWORDS.some((k) => t.includes(k))) return "Sport";
  if (DRESS_KEYWORDS.some((k) => t.includes(k))) return "Dress";
  if (t.includes("speedmaster") || t.includes("chronograph")) return "Tool";
  return "Sport";
}

function extractYear(title: string): string | null {
  const m = title.match(/\b(19\d{2}|20[0-2]\d)\b/);
  return m ? m[1] : null;
}

function normalizeBoxPapers(
  raw: RawEbayWatchListing["hasBoxAndPapers"]
): string {
  if (raw === true || raw === "full_set") return "full_set";
  if (raw === "box_only") return "box_only";
  if (raw === "papers_only") return "papers_only";
  return "neither";
}

function estimateListingQuality(raw: RawEbayWatchListing): number {
  let score = 5;
  if (raw.seller.feedbackPercent && raw.seller.feedbackPercent >= 99.5) score += 2;
  else if (raw.seller.feedbackPercent && raw.seller.feedbackPercent >= 98) score += 1;
  if (raw.seller.feedbackCount && raw.seller.feedbackCount >= 1000) score += 1;
  if (raw.authenticityGuarantee) score += 1;
  if (raw.hasBoxAndPapers === true || raw.hasBoxAndPapers === "full_set") score += 1;
  if (raw.seller.topRated) score += 1;
  if (raw.description && raw.description.length > 200) score += 0.5;
  return Math.min(10, Math.round(score));
}

export function normalizeEbayListing(
  raw: RawEbayWatchListing,
  ownerId: string = "dylan"
): NormalizedWatchRecord {
  const id = `ebay-${raw.itemId}`;
  const tag = guessTag(raw.title);
  const year = extractYear(raw.title);
  const subParts = [
    year,
    raw.condition,
    raw.itemLocation,
  ].filter((s): s is string => Boolean(s));
  const sub = subParts.join(" · ");

  return {
    id,
    ownerId,
    title: raw.title,
    sub,
    tag,
    buyPrice: raw.priceUsd,
    marketPrice: raw.estimatedMarketUsd,
    liquidity: "Med",
    sourcePlatform: "ebay",
    sellerName: raw.seller.username,
    sellerFeedbackScore: raw.seller.feedbackPercent,
    sellerFeedbackCount: raw.seller.feedbackCount,
    sellerAccountAgeMonths: raw.seller.accountAgeMonths,
    paymentMethod: "paypal_goods",
    authenticityGuarantee: raw.authenticityGuarantee ?? false,
    escrowAvailable: false,
    boxPapers: normalizeBoxPapers(raw.hasBoxAndPapers),
    serviceHistory: raw.serviceHistory ?? null,
    serialProvided: raw.serialProvided ?? false,
    listingQualityScore: estimateListingQuality(raw),
    priceTooGoodToBeTrue: false,
    notes: raw.description ? raw.description.slice(0, 240) : undefined,
  };
}

export function normalizeEbayListings(
  raws: RawEbayWatchListing[],
  ownerId?: string
): NormalizedWatchRecord[] {
  return raws.map((r) => normalizeEbayListing(r, ownerId));
}
