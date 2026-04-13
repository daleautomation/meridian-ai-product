// Meridian AI — ingestion-time quality filters for real estate listings.
//
// Pure functions, no I/O. Compute source-quality signals at ingest time.
// These are FILTERS, not SCORES — they measure listing quality and seller
// motivation, not deal quality. The engine decides that downstream.

import type { NormalizedRealEstateRecord } from "@/lib/ingestion/types";

// ── FRESHNESS ──────────────────────────────────────────────────────────

export function computeFreshnessScore(
  listingTimestamp: string | undefined
): number {
  if (!listingTimestamp) return 25;
  const ageMs = Date.now() - new Date(listingTimestamp).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 25;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 90;
  if (ageHours <= 168) return 78;     // 1 week
  if (ageHours <= 336) return 65;     // 2 weeks
  if (ageHours <= 720) return 50;     // 1 month
  if (ageHours <= 2160) return 35;    // 3 months
  return 18;
}

// ── DAYS ON MARKET SIGNAL ──────────────────────────────────────────────
// Stale = motivated. Fresh = competitive. Both are signals.

export function computeDomSignal(dom: number | undefined): "fresh" | "normal" | "stale" | "very_stale" {
  if (dom == null) return "normal";
  if (dom <= 7) return "fresh";
  if (dom <= 30) return "normal";
  if (dom <= 90) return "stale";
  return "very_stale";
}

// ── PRICE REDUCTION DETECTION ──────────────────────────────────────────

export function detectPriceReductions(
  priceHistory: { date: string; price: number }[] | undefined,
  currentAsk: number | undefined
): { count: number; totalDropPct: number; originalPrice: number | undefined } {
  if (!priceHistory || priceHistory.length < 2) {
    return { count: 0, totalDropPct: 0, originalPrice: undefined };
  }
  // Sort by date ascending
  const sorted = [...priceHistory].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const original = sorted[0].price;
  let drops = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].price < sorted[i - 1].price) drops++;
  }
  const latest = currentAsk ?? sorted[sorted.length - 1].price;
  const totalDropPct = original > 0 ? ((original - latest) / original) * 100 : 0;
  return { count: drops, totalDropPct: Math.max(0, totalDropPct), originalPrice: original };
}

// ── DISTRESS SIGNAL DETECTION ──────────────────────────────────────────

const RE_URGENCY_KEYWORDS = [
  "must sell",
  "motivated seller",
  "motivated",
  "bring offers",
  "bring all offers",
  "make offer",
  "quick close",
  "fast close",
  "immediate possession",
  "relocating",
  "transferred",
];

const RE_CONDITION_KEYWORDS = [
  "as-is",
  "as is",
  "needs work",
  "needs updating",
  "needs rehab",
  "handyman special",
  "investor special",
  "fixer upper",
  "fixer-upper",
  "tlc",
  "sold as-is",
  "cosmetic",
  "deferred maintenance",
];

const RE_FINANCIAL_KEYWORDS = [
  "price reduced",
  "price reduction",
  "reduced",
  "below market",
  "below appraisal",
  "priced to sell",
  "estate sale",
  "foreclosure",
  "bank owned",
  "reo",
  "short sale",
  "divorce",
  "probate",
  "tax sale",
  "auction",
];

export function detectDistressSignals(
  title: string,
  description: string | undefined,
  riskFlags: string[] | undefined
): NonNullable<NormalizedRealEstateRecord["distressSignals"]> {
  const text = `${title} ${description || ""} ${(riskFlags || []).join(" ")}`.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const kw of RE_URGENCY_KEYWORDS) {
    if (text.includes(kw)) { matched.push(kw); score += 18; }
  }
  for (const kw of RE_CONDITION_KEYWORDS) {
    if (text.includes(kw)) { matched.push(kw); score += 12; }
  }
  for (const kw of RE_FINANCIAL_KEYWORDS) {
    if (text.includes(kw)) { matched.push(kw); score += 15; }
  }

  return { detected: matched.length > 0, keywords: matched, score: Math.min(100, score) };
}

// ── DESCRIPTION QUALITY ────────────────────────────────────────────────

export function computeDescriptionQuality(
  description: string | undefined,
  title: string
): {
  listingQualityScore: number;
  detail: NonNullable<NormalizedRealEstateRecord["descriptionQualityDetail"]>;
} {
  const text = `${title} ${description || ""}`;
  const descLen = (description || "").length;

  const lengthScore = Math.min(100, Math.round((descLen / 400) * 100));

  let specificityScore = 0;
  if (/\b\d{3,4}\s*sq\s*ft/i.test(text)) specificityScore += 20;
  if (/\b\d+\s*(bed|br|bedroom)/i.test(text)) specificityScore += 15;
  if (/\b\d+(\.\d)?\s*(bath|ba)/i.test(text)) specificityScore += 15;
  if (/\b(19|20)\d{2}\b/.test(text)) specificityScore += 10;     // year built
  if (/\b(garage|basement|attic|deck|patio|pool)\b/i.test(text)) specificityScore += 15;
  if (/\$([\d,]+)/i.test(text)) specificityScore += 10;           // price mentioned
  if (/\b(hvac|roof|foundation|plumbing|electrical)\b/i.test(text)) specificityScore += 15;
  specificityScore = Math.min(100, specificityScore);

  let completenessScore = 0;
  const t = text.toLowerCase();
  if (/sqft|square\s*f/i.test(t)) completenessScore += 20;
  if (/lot\s*(size|area|\d)/i.test(t)) completenessScore += 15;
  if (/school/i.test(t)) completenessScore += 10;
  if (/garage|parking/i.test(t)) completenessScore += 10;
  if (/updated|renovated|remodel/i.test(t)) completenessScore += 15;
  if (/basement|crawl/i.test(t)) completenessScore += 10;
  if (/roof|hvac|furnace|water heater/i.test(t)) completenessScore += 20;
  completenessScore = Math.min(100, completenessScore);

  const composite =
    lengthScore * 0.3 + specificityScore * 0.4 + completenessScore * 0.3;
  const listingQualityScore = Math.min(10, Math.round(composite / 10));

  return {
    listingQualityScore,
    detail: { lengthScore, specificityScore, completenessScore },
  };
}
