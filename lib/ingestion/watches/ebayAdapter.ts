// Meridian AI — eBay-style watch listing → NormalizedWatchRecord.
//
// Pure deterministic transform. Defaults are conservative for trust:
//   - liquidity = "Med" (let the curator upgrade if they know the reference)
//   - paymentMethod = "paypal_goods" (eBay default; safe but not maximum trust)
//   - escrowAvailable = false (eBay doesn't escrow)
//   - serialProvided = whatever the listing says, default false

import type {
  NormalizedWatchRecord,
  RawEbayWatchListing,
} from "@/lib/ingestion/types";
import { guessTag, extractYear, normalizeBoxPapers } from "./shared";
import {
  computeFreshnessScore,
  computeDescriptionQuality,
  detectDistressSignals,
} from "./qualityFilters";

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

  const desc = raw.description || "";
  const descQuality = computeDescriptionQuality(desc, raw.title);
  const freshness = computeFreshnessScore(undefined); // eBay bulk dumps lack per-item timestamps
  const distress = detectDistressSignals(raw.title, desc, undefined);

  // Boost listing quality for eBay-specific structured trust signals
  let lqs = descQuality.listingQualityScore;
  if (raw.seller.feedbackPercent && raw.seller.feedbackPercent >= 99.5) lqs = Math.min(10, lqs + 1);
  if (raw.seller.feedbackCount && raw.seller.feedbackCount >= 1000) lqs = Math.min(10, lqs + 1);
  if (raw.authenticityGuarantee) lqs = Math.min(10, lqs + 1);
  if (raw.seller.topRated) lqs = Math.min(10, lqs + 1);

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
    listingQualityScore: lqs,
    priceTooGoodToBeTrue: false,
    listingUrl: raw.listingUrl,
    notes: desc ? desc.slice(0, 240) : undefined,
    freshnessScore: freshness,
    descriptionQualityDetail: descQuality.detail,
    distressSignals: distress,
  };
}

export function normalizeEbayListings(
  raws: RawEbayWatchListing[],
  ownerId?: string
): NormalizedWatchRecord[] {
  return raws.map((r) => normalizeEbayListing(r, ownerId));
}
