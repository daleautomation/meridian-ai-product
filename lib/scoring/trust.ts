// Meridian AI — trust & scam-filter scoring engine.
//
// Pure functions, no I/O, no external deps. Given a record's trust-related
// inputs (source platform, seller history, payment method, authenticity
// evidence, etc.) produces a trust score 0–100, a tier, hard/soft reject
// flags, and a list of human-readable reasons.
//
// The trust layer runs alongside the economic scoring engine. The adapter
// combines them: trust can only make a label WORSE, never better.
//
// Hard-reject signals (regardless of score):
//   - priceTooGoodToBeTrue flag set explicitly
//   - Counterfeit wording in title/notes (1:1, super clone, replica, etc.)
//   - Price anomaly: buyPrice < 60% of marketPrice
//   - Dangerous payment method with no escrow AND no auth guarantee

import type { BuySignal } from "@/lib/scoring/watches";

export type TrustTier = "TRUSTED" | "CAUTION" | "SOFT_REJECT" | "REJECTED";

export type TrustInputs = {
  title?: string;
  buyPrice?: number;
  marketPrice?: number;
  sourcePlatform?: string;
  sellerName?: string;
  sellerFeedbackScore?: number;     // percent, 0–100
  sellerFeedbackCount?: number;
  sellerAccountAgeMonths?: number;
  paymentMethod?: string;
  authenticityGuarantee?: boolean;
  escrowAvailable?: boolean;
  boxPapers?: string;               // "full_set" | "papers_only" | "box_only" | "neither"
  serviceHistory?: string | null;
  serialProvided?: boolean;
  listingQualityScore?: number;     // 0–10
  priceTooGoodToBeTrue?: boolean;
  notes?: string;
};

export type TrustResult = {
  score: number;        // 0–100
  tier: TrustTier;
  hardReject: boolean;
  reasons: string[];
};

const COUNTERFEIT_WORDING = [
  "1:1",
  "super clone",
  "superclone",
  "replica",
  "rep ",
  "noob factory",
  "aaa quality",
  "mirror quality",
  "vsf",
  "clean factory",
  "high quality copy",
];

const SAFE_PLATFORMS = new Set([
  "chrono24",
  "watchbox",
  "crown_and_caliber",
  "hodinkee_shop",
  "bobs_watches",
  "watchfinder",
  "european_watch_company",
]);
const MEDIUM_PLATFORMS = new Set(["ebay", "watchuseek", "watchcharts"]);
const RISKY_PLATFORMS = new Set([
  "facebook_marketplace",
  "craigslist",
  "instagram_dm",
  "telegram",
  "unknown",
]);

const SAFE_PAYMENTS = new Set(["credit_card", "paypal_goods", "escrow"]);
const WARNING_PAYMENTS = new Set([
  "paypal_friends_family",
  "venmo",
  "zelle",
]);
const DANGEROUS_PAYMENTS = new Set([
  "wire",
  "crypto",
  "western_union",
  "cash_only",
  "cashapp",
]);

const PRICE_ANOMALY_FLOOR = 0.60;

export function computeTrust(input: TrustInputs): TrustResult {
  const reasons: string[] = [];
  let score = 50; // neutral baseline
  let hardReject = false;

  // ── HARD REJECT RULES ─────────────────────────────────────────────────

  if (input.priceTooGoodToBeTrue === true) {
    hardReject = true;
    reasons.push("flagged as too-good-to-be-true");
  }

  const haystack = `${input.title ?? ""} ${input.notes ?? ""}`.toLowerCase();
  for (const phrase of COUNTERFEIT_WORDING) {
    if (haystack.includes(phrase)) {
      hardReject = true;
      reasons.push(`counterfeit wording detected ("${phrase.trim()}")`);
      break;
    }
  }

  if (
    typeof input.buyPrice === "number" &&
    typeof input.marketPrice === "number" &&
    input.marketPrice > 0 &&
    input.buyPrice / input.marketPrice < PRICE_ANOMALY_FLOOR
  ) {
    hardReject = true;
    reasons.push(
      `price anomaly (${Math.round((input.buyPrice / input.marketPrice) * 100)}% of market)`
    );
  }

  if (
    input.paymentMethod &&
    DANGEROUS_PAYMENTS.has(input.paymentMethod) &&
    input.escrowAvailable !== true &&
    input.authenticityGuarantee !== true
  ) {
    hardReject = true;
    reasons.push(
      `unsafe payment (${input.paymentMethod}) with no escrow or auth guarantee`
    );
  }

  // ── ADDITIVE TRUST POINTS ─────────────────────────────────────────────

  if (input.sourcePlatform) {
    const p = input.sourcePlatform.toLowerCase();
    if (SAFE_PLATFORMS.has(p)) score += 20;
    else if (MEDIUM_PLATFORMS.has(p)) score += 8;
    else if (RISKY_PLATFORMS.has(p)) {
      score -= 15;
      reasons.push(`risky platform (${p})`);
    }
  }

  if (typeof input.sellerFeedbackScore === "number") {
    if (input.sellerFeedbackScore >= 99.5) score += 12;
    else if (input.sellerFeedbackScore >= 98) score += 6;
    else if (input.sellerFeedbackScore < 95) {
      score -= 10;
      reasons.push(`seller feedback ${input.sellerFeedbackScore}% below 95%`);
    }
  }

  if (typeof input.sellerFeedbackCount === "number") {
    if (input.sellerFeedbackCount >= 1000) score += 8;
    else if (input.sellerFeedbackCount >= 100) score += 4;
    else if (input.sellerFeedbackCount < 25) {
      score -= 8;
      reasons.push(`only ${input.sellerFeedbackCount} feedback ratings`);
    }
  }

  if (typeof input.sellerAccountAgeMonths === "number") {
    if (input.sellerAccountAgeMonths >= 24) score += 8;
    else if (input.sellerAccountAgeMonths >= 12) score += 4;
    else if (input.sellerAccountAgeMonths < 3) {
      score -= 15;
      reasons.push(`seller account only ${input.sellerAccountAgeMonths} months old`);
    }
  }

  if (input.paymentMethod) {
    if (SAFE_PAYMENTS.has(input.paymentMethod)) {
      score += 8;
    } else if (WARNING_PAYMENTS.has(input.paymentMethod)) {
      score -= 5;
      reasons.push(`payment method (${input.paymentMethod}) lacks buyer protection`);
    } else if (DANGEROUS_PAYMENTS.has(input.paymentMethod) && !hardReject) {
      score -= 15;
      reasons.push(`unsafe payment method (${input.paymentMethod})`);
    }
  }

  if (input.authenticityGuarantee === true) score += 12;
  else if (input.authenticityGuarantee === false) score -= 5;

  if (input.escrowAvailable === true) score += 8;

  if (input.boxPapers === "full_set") score += 6;
  else if (input.boxPapers === "papers_only" || input.boxPapers === "box_only") score += 2;
  else if (input.boxPapers === "neither") {
    score -= 6;
    reasons.push("no box or papers");
  }

  if (input.serviceHistory) score += 4;

  if (input.serialProvided === true) score += 6;
  else if (input.serialProvided === false) {
    score -= 8;
    reasons.push("no serial number provided");
  }

  if (typeof input.listingQualityScore === "number") {
    score += Math.round((input.listingQualityScore - 5) * 1.5);
    if (input.listingQualityScore < 4) {
      reasons.push("low listing quality");
    }
  }

  // ── CLAMP & TIER ──────────────────────────────────────────────────────

  score = Math.max(0, Math.min(100, Math.round(score)));

  let tier: TrustTier;
  if (hardReject) tier = "REJECTED";
  else if (score < 50) tier = "SOFT_REJECT";
  else if (score < 70) tier = "CAUTION";
  else tier = "TRUSTED";

  return { score, tier, hardReject, reasons };
}

// Trust can only WORSEN a label, never improve it. Severity order:
//   STRONG BUY < BUY < MONITOR < PASS < AVOID
const SEVERITY: Record<BuySignal, number> = {
  "STRONG BUY": 0,
  "BUY": 1,
  "MONITOR": 2,
  "PASS": 3,
  "AVOID": 4,
};

function worseOf(a: BuySignal, b: BuySignal): BuySignal {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export function applyTrustDowngrade(
  current: BuySignal,
  trust: TrustResult
): BuySignal {
  if (trust.tier === "REJECTED") return "AVOID";
  if (trust.tier === "SOFT_REJECT") return worseOf(current, "PASS");
  if (trust.tier === "CAUTION") {
    // Downgrade by one tier, capped at MONITOR (caution doesn't auto-PASS)
    if (current === "STRONG BUY") return "BUY";
    if (current === "BUY") return "MONITOR";
    return current;
  }
  return current;
}

export function formatTrustLine(trust: TrustResult): string {
  if (trust.tier === "TRUSTED" && trust.reasons.length === 0) {
    return `Trust: ${trust.score}/100 · trusted`;
  }
  const tierLabel =
    trust.tier === "REJECTED"
      ? "REJECTED"
      : trust.tier === "SOFT_REJECT"
      ? "SOFT REJECT"
      : trust.tier === "CAUTION"
      ? "CAUTION"
      : "trusted";
  const issues = trust.reasons.length > 0 ? ` · ${trust.reasons.join("; ")}` : "";
  return `Trust: ${trust.score}/100 · ${tierLabel}${issues}`;
}
