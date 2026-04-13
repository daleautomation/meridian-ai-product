// Meridian AI — Facebook Marketplace watch listing → NormalizedWatchRecord.
//
// Facebook listings are informal: short titles, sparse descriptions, no
// structured condition data, no authenticity guarantee. Trust defaults are
// conservative — the trust engine already penalizes this platform (-15).
//
// The adapter's job is to extract whatever signal exists and flag what's
// missing so downstream engines can discount appropriately.

import type {
  NormalizedWatchRecord,
  RawFacebookMarketplaceListing,
} from "@/lib/ingestion/types";
import { guessTag, extractYear, parseBoxPapersFromText } from "./shared";
import {
  computeFreshnessScore,
  computeDescriptionQuality,
  detectDistressSignals,
  computeEngagementScore,
} from "./qualityFilters";

function estimateAccountAgeMonths(joinedDate: string | undefined): number | undefined {
  if (!joinedDate) return undefined;
  const joined = new Date(joinedDate).getTime();
  if (!Number.isFinite(joined)) return undefined;
  return Math.max(0, Math.round((Date.now() - joined) / (1000 * 60 * 60 * 24 * 30)));
}

function normalizeCondition(raw: string | undefined): string {
  if (!raw) return "Pre-owned";
  const t = raw.toLowerCase();
  if (t.includes("new") || t.includes("unworn") || t.includes("bnib")) return "New";
  if (t.includes("like new") || t.includes("excellent") || t.includes("mint")) return "Like New";
  if (t.includes("good") || t.includes("great")) return "Good";
  if (t.includes("fair") || t.includes("worn")) return "Fair";
  return "Pre-owned";
}

export function normalizeFacebookListing(
  raw: RawFacebookMarketplaceListing,
  ownerId: string = "dylan"
): NormalizedWatchRecord {
  const id = `fb-${raw.listingId}`;
  const tag = guessTag(raw.title);
  const year = extractYear(raw.title);
  const condition = normalizeCondition(raw.condition);
  const subParts = [year, condition, raw.location].filter(
    (s): s is string => Boolean(s)
  );

  const desc = raw.description || "";
  const boxPapers = parseBoxPapersFromText(`${raw.title} ${desc}`);
  const serialProvided = /serial/i.test(desc);

  const descQuality = computeDescriptionQuality(desc, raw.title);
  const freshness = computeFreshnessScore(raw.listedAt);
  const distress = detectDistressSignals(raw.title, desc, undefined);
  const engagement = computeEngagementScore({
    views: raw.views,
    saves: raw.saves,
  });

  return {
    id,
    ownerId,
    title: raw.title,
    sub: subParts.join(" · "),
    tag,
    buyPrice: raw.priceUsd,
    marketPrice: raw.estimatedMarketUsd,
    liquidity: "Med",
    sourcePlatform: "facebook_marketplace",
    sellerName: raw.seller.name,
    sellerFeedbackScore: raw.seller.rating != null
      ? raw.seller.rating * 20 // 0-5 stars → 0-100 scale
      : undefined,
    sellerFeedbackCount: undefined, // FB doesn't expose transaction count
    sellerAccountAgeMonths: estimateAccountAgeMonths(raw.seller.joinedDate),
    paymentMethod: raw.shippingAvailable ? "paypal_goods" : "cash_local",
    authenticityGuarantee: false,
    escrowAvailable: false,
    boxPapers,
    serviceHistory: null,
    serialProvided,
    listingQualityScore: descQuality.listingQualityScore,
    priceTooGoodToBeTrue: false,
    listingUrl: `https://www.facebook.com/marketplace/item/${raw.listingId}/`,
    notes: desc ? desc.slice(0, 240) : undefined,
    listingTimestamp: raw.listedAt,
    freshnessScore: freshness,
    descriptionQualityDetail: descQuality.detail,
    distressSignals: distress,
    engagementSignals: {
      views: raw.views,
      saves: raw.saves,
      engagementScore: engagement || undefined,
    },
  };
}

export function normalizeFacebookListings(
  raws: RawFacebookMarketplaceListing[],
  ownerId?: string
): NormalizedWatchRecord[] {
  return raws.map((r) => normalizeFacebookListing(r, ownerId));
}
