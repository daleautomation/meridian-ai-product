// Meridian AI — Reddit r/WatchExchange listing → NormalizedWatchRecord.
//
// r/WatchExchange posts follow a semi-structured convention:
//   Title: [WTS] Brand Model Ref $Price
//   Body:  Markdown with condition details, box/papers, payment methods
//
// Community norms require detailed posts, so description quality typically
// scores higher than Facebook. Seller trust is derived from karma + account
// age as proxies for feedback count + account age.

import type {
  NormalizedWatchRecord,
  RawRedditWatchExchangeListing,
} from "@/lib/ingestion/types";
import { guessTag, extractYear, parseBoxPapersFromText } from "./shared";
import {
  computeFreshnessScore,
  computeDescriptionQuality,
  detectDistressSignals,
  computeEngagementScore,
} from "./qualityFilters";

/**
 * Parse price from r/WatchExchange title or body.
 * Handles: $4,800 | $4800 | 4800 | 8.5k | 8k | USD 8500 | asking 4800
 */
function extractPrice(text: string): number | undefined {
  // $4,800 or $4800
  const dollar = text.match(/\$\s?([\d,]+)/);
  if (dollar) {
    const p = parseInt(dollar[1].replace(/,/g, ""), 10);
    if (Number.isFinite(p) && p > 50) return p;
  }
  // 8.5k or 8k (case-insensitive)
  const kMatch = text.match(/\b(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const p = Math.round(parseFloat(kMatch[1]) * 1000);
    if (Number.isFinite(p) && p > 50) return p;
  }
  // USD 8500 or 8500 USD
  const usd = text.match(/(?:USD\s*(\d[\d,]*))|(?:(\d[\d,]*)\s*USD)/i);
  if (usd) {
    const p = parseInt((usd[1] || usd[2]).replace(/,/g, ""), 10);
    if (Number.isFinite(p) && p > 50) return p;
  }
  // "asking NNNN" / "price NNNN"
  const asking = text.match(/(?:asking|price|sale)\s*:?\s*\$?([\d,]+)/i);
  if (asking) {
    const p = parseInt(asking[1].replace(/,/g, ""), 10);
    if (Number.isFinite(p) && p > 50) return p;
  }
  // Bare 4+ digit number as last resort (only in title context)
  const bare = text.match(/\b(\d{4,6})\b/);
  if (bare) {
    const p = parseInt(bare[1], 10);
    // Only accept if in plausible watch price range ($100–$500k)
    if (p >= 100 && p <= 500000) return p;
  }
  return undefined;
}

function parsePrice(title: string, body: string): number | undefined {
  return extractPrice(title) ?? extractPrice(body);
}

/**
 * Detect payment method from post body.
 * Community typically accepts PayPal F&F, Zelle, wire, Venmo.
 * Return the safest method mentioned.
 */
function detectPaymentMethod(body: string): string {
  const t = body.toLowerCase();
  // Ordered by safety (most protective first)
  if (/paypal\s*(g&s|goods)/i.test(t)) return "paypal_goods";
  if (/paypal/i.test(t)) return "paypal_ff"; // F&F is default on r/WatchExchange
  if (/zelle/i.test(t)) return "zelle";
  if (/venmo/i.test(t)) return "venmo";
  if (/wire/i.test(t)) return "wire";
  if (/crypto|btc|bitcoin/i.test(t)) return "crypto";
  return "paypal_ff"; // community default
}

// Reference number pattern: 4-6 digit alphanumeric (e.g., 126610LN, 210.30, WSSA0029)
const REF_PATTERN = /\b\d{3,6}[A-Z]{0,4}\b|\b\d{3}\.\d{2}\b/;
// Full model name: brand + known model in title
const MODEL_PATTERN = /\b(submariner|speedmaster|nautilus|daytona|gmt.?master|royal oak|santos|seamaster|aquanaut|calatrava|pelagos|black bay|explorer|datejust|day.?date|reverso|portugieser|pilot|navitimer|superocean)\b/i;

export function normalizeRedditListing(
  raw: RawRedditWatchExchangeListing,
  ownerId: string = "dylan"
): NormalizedWatchRecord {
  const id = `reddit-${raw.postId}`;
  // Strip [WTS] / [WTT] prefix from title for clean display
  const cleanTitle = raw.title.replace(/^\[(?:WTS|WTT|WTB)\]\s*/i, "").trim();
  const tag = guessTag(cleanTitle);
  const year = extractYear(cleanTitle);

  // When body is empty (gallery posts), fall back to title for signal extraction
  const textForParsing = raw.body || cleanTitle;

  const price = raw.priceUsd ?? parsePrice(raw.title, raw.body);
  const boxPapers = parseBoxPapersFromText(textForParsing);
  const serialProvided = /serial/i.test(textForParsing);
  const paymentMethod = detectPaymentMethod(textForParsing);

  const subParts = [year, raw.flair?.toUpperCase()].filter(
    (s): s is string => Boolean(s)
  );

  const descQuality = computeDescriptionQuality(raw.body, cleanTitle);

  // Boost listing quality when the title carries strong identifiers.
  // Reference number alone is sufficient (+1). Model name only counts if
  // paired with at least one corroborating signal (ref, price, or condition
  // keywords) — prevents vague titles like "nice submariner watch" from
  // getting boosted. Total boost capped at +2.
  let lqs = descQuality.listingQualityScore;
  let boost = 0;
  const titleHasRef = REF_PATTERN.test(cleanTitle);
  const titleHasModel = MODEL_PATTERN.test(cleanTitle);
  const titleHasPrice = /\$\s?[\d,]+|\b\d+(?:\.\d+)?\s*k\b|\bUSD\s*\d/i.test(cleanTitle);
  const titleHasCondition = /\b(mint|bnib|lnib|excellent|full set|like new|unworn|near new)\b/i.test(cleanTitle);

  if (titleHasRef) boost += 1;
  if (titleHasModel && (titleHasRef || titleHasPrice || titleHasCondition)) boost += 1;
  lqs = Math.min(10, lqs + Math.min(2, boost));

  const freshness = computeFreshnessScore(raw.timestamp);
  const distress = detectDistressSignals(cleanTitle, raw.body, undefined);
  const engagement = computeEngagementScore({
    views: undefined, // Reddit doesn't expose view count publicly
    saves: undefined,
    comments: raw.commentCount,
  });

  return {
    id,
    ownerId,
    title: cleanTitle,
    sub: subParts.join(" · ") || "r/WatchExchange",
    tag,
    buyPrice: price,
    marketPrice: raw.estimatedMarketUsd,
    liquidity: "Med",
    sourcePlatform: "reddit_watchexchange",
    sellerName: raw.author,
    sellerFeedbackScore: undefined, // no direct equivalent
    sellerFeedbackCount: raw.authorKarma != null
      ? Math.min(500, Math.round(raw.authorKarma / 100)) // rough proxy
      : undefined,
    sellerAccountAgeMonths: raw.authorAccountAgeDays != null
      ? Math.round(raw.authorAccountAgeDays / 30)
      : undefined,
    paymentMethod,
    authenticityGuarantee: false,
    escrowAvailable: false,
    boxPapers,
    serviceHistory: /servic(e|ed)|overhaul/i.test(textForParsing)
      ? "mentioned in listing"
      : null,
    serialProvided,
    listingQualityScore: lqs,
    priceTooGoodToBeTrue: false,
    listingUrl: `https://www.reddit.com/r/Watchexchange/comments/${raw.postId}/`,
    notes: (raw.body || cleanTitle).slice(0, 240),
    listingTimestamp: raw.timestamp,
    freshnessScore: freshness,
    descriptionQualityDetail: descQuality.detail,
    distressSignals: distress,
    engagementSignals: {
      comments: raw.commentCount,
      engagementScore: engagement || undefined,
    },
  };
}

export function normalizeRedditListings(
  raws: RawRedditWatchExchangeListing[],
  ownerId?: string
): NormalizedWatchRecord[] {
  return raws
    .filter((r) => {
      // Only ingest [WTS] posts, not [WTB] or [WTT]
      const flair = (r.flair || r.title).toUpperCase();
      return flair.includes("WTS") || (!flair.includes("WTB") && !flair.includes("WTT"));
    })
    .map((r) => normalizeRedditListing(r, ownerId));
}
