// Meridian AI — ingestion-time quality filters for watch listings.
//
// Pure functions, no I/O. Compute source-quality signals at ingest time so
// downstream engines (valuation confidence, trust) have richer inputs.
//
// These are FILTERS, not SCORES. They measure listing quality, not deal
// quality. A high-distress, low-description-quality listing from Facebook
// may be a better deal than a polished Chrono24 listing — the engine decides
// that. These filters just surface the raw signals.

import type { NormalizedWatchRecord } from "@/lib/ingestion/types";

// ── FRESHNESS ──────────────────────────────────────────────────────────
// How recently was this listed? Fresh listings = less picked over.
// Mirrors the valuation engine's recency curve but computed once at ingest.

export function computeFreshnessScore(
  listingTimestamp: string | undefined
): number {
  if (!listingTimestamp) return 25; // unknown age → conservative
  const ageMs = Date.now() - new Date(listingTimestamp).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 25;
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 95;
  if (ageHours <= 72) return 85;
  if (ageHours <= 168) return 72;   // 1 week
  if (ageHours <= 336) return 58;   // 2 weeks
  if (ageHours <= 720) return 42;   // 1 month
  if (ageHours <= 2160) return 28;  // 3 months
  return 15;
}

// ── DESCRIPTION QUALITY ────────────────────────────────────────────────
// How informative is the listing? Poor descriptions often hide opportunity
// (seller doesn't know what they have) or risk (deliberate vagueness).

export function computeDescriptionQuality(
  description: string | undefined,
  title: string
): {
  listingQualityScore: number; // 0-10 for backward compat with trust engine
  detail: NonNullable<NormalizedWatchRecord["descriptionQualityDetail"]>;
} {
  const text = `${title} ${description || ""}`;
  const descLen = (description || "").length;

  // Length: empty → 0, 50 chars → 25, 200 → 65, 500+ → 100
  const lengthScore = Math.min(100, Math.round((descLen / 500) * 100));

  // Specificity: reference numbers, caliber, year, brand+model pairs
  let specificityScore = 0;
  if (/\b\d{4,6}[A-Z]?\b/.test(text)) specificityScore += 30; // reference number
  if (/\bcal(iber|\.)\s*\d/i.test(text)) specificityScore += 25; // caliber
  if (/\b(19|20)\d{2}\b/.test(text)) specificityScore += 15; // year
  if (/\b(rolex|omega|patek|tudor|cartier|seiko|grand seiko|iwc|breitling|panerai|ap|audemars)\b/i.test(text))
    specificityScore += 15; // known brand
  if (/\b(submariner|speedmaster|nautilus|daytona|gmt|royal oak|santos|calatrava)\b/i.test(text))
    specificityScore += 15; // known model
  specificityScore = Math.min(100, specificityScore);

  // Completeness: mentions of box, papers, service, serial, condition details
  let completenessScore = 0;
  const t = text.toLowerCase();
  if (/box|inner|outer/i.test(t)) completenessScore += 20;
  if (/papers|card|warranty|certificate/i.test(t)) completenessScore += 20;
  if (/servic(e|ed)|overhaul/i.test(t)) completenessScore += 20;
  if (/serial/i.test(t)) completenessScore += 15;
  if (/condition|wear|scratch|polish|mint|pristine/i.test(t)) completenessScore += 15;
  if (/dial|bezel|crystal|bracelet|strap/i.test(t)) completenessScore += 10;
  completenessScore = Math.min(100, completenessScore);

  // Composite: weighted average → 0-10 scale
  const composite =
    lengthScore * 0.3 + specificityScore * 0.4 + completenessScore * 0.3;
  const listingQualityScore = Math.min(10, Math.round(composite / 10));

  return {
    listingQualityScore,
    detail: { lengthScore, specificityScore, completenessScore },
  };
}

// ── DISTRESS SIGNAL DETECTION ──────────────────────────────────────────
// Motivated sellers = higher-variance pricing. These are the deals
// efficient marketplaces miss.

const URGENCY_KEYWORDS = [
  "must sell",
  "need gone",
  "quick sale",
  "urgent",
  "asap",
  "today only",
  "moving sale",
  "leaving country",
  "deployed",
  "need sold",
  "selling fast",
];

const FINANCIAL_KEYWORDS = [
  "bills",
  "need cash",
  "tuition",
  "downsizing",
  "divorce",
  "liquidating",
  "estate sale",
  "estate",
  "medical",
  "emergency",
];

const PRICING_KEYWORDS = [
  "priced to sell",
  "below market",
  "steal",
  "obo",
  "or best offer",
  "make offer",
  "negotiable",
  "open to offers",
  "best offer",
  "price drop",
  "reduced",
  "lowered",
];

export function detectDistressSignals(
  title: string,
  description: string | undefined,
  notes: string | undefined
): NonNullable<NormalizedWatchRecord["distressSignals"]> {
  const text = `${title} ${description || ""} ${notes || ""}`.toLowerCase();
  const matched: string[] = [];

  let score = 0;
  for (const kw of URGENCY_KEYWORDS) {
    if (text.includes(kw)) {
      matched.push(kw);
      score += 20; // urgency keywords weighted higher
    }
  }
  for (const kw of FINANCIAL_KEYWORDS) {
    if (text.includes(kw)) {
      matched.push(kw);
      score += 15;
    }
  }
  for (const kw of PRICING_KEYWORDS) {
    if (text.includes(kw)) {
      matched.push(kw);
      score += 10;
    }
  }

  return {
    detected: matched.length > 0,
    keywords: matched,
    score: Math.min(100, score),
  };
}

// ── ENGAGEMENT SIGNALS ─────────────────────────────────────────────────
// Low engagement on a fresh listing = less competition = opportunity.
// High engagement = demand validation but crowded.

export function computeEngagementScore(signals: {
  views?: number;
  saves?: number;
  comments?: number;
}): number {
  const { views = 0, saves = 0, comments = 0 } = signals;
  if (views === 0 && saves === 0 && comments === 0) return 0; // no data

  // Normalize each signal to 0-100 with diminishing returns
  const viewScore = Math.min(100, Math.round(Math.sqrt(views) * 5));
  const saveScore = Math.min(100, Math.round(Math.sqrt(saves) * 15));
  const commentScore = Math.min(100, Math.round(Math.sqrt(comments) * 20));

  return Math.min(
    100,
    Math.round(viewScore * 0.4 + saveScore * 0.35 + commentScore * 0.25)
  );
}
