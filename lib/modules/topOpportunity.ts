// Meridian AI — Top Opportunity selector + script generator.
//
// Picks the strongest lead inside a service angle and produces a short,
// operator-ready brief: why it matters, value posture, recommended
// action, and a 1–2 line script. No new data sources, no fakery — only
// fields the lead already carries (Google Places signals, scan output,
// or engine decisions).

import {
  classifyLeadIntoBuckets,
  type BucketClassification,
  type ClassifierLeadLike,
} from "./bucketClassifier";
import { type TradeId } from "./tradeConfigs";

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

function leadName(l: AngleLeadLike): string {
  return (typeof l.name === "string" && l.name.trim()) ||
    (typeof l.companyName === "string" && l.companyName.trim()) ||
    "Unnamed";
}

function hasWebsite(l: AngleLeadLike): boolean {
  return !!(l.website || l.websiteUrl || l.domain || l.resolvedBusinessUrl);
}

function hasPhone(l: AngleLeadLike): boolean {
  return !!(l.phone || l.contacts?.primaryPhone);
}

function reviewsOf(l: AngleLeadLike): number | null {
  if (typeof l.reviewCount === "number") return l.reviewCount;
  if (typeof l.reviews === "number") return l.reviews;
  return null;
}

// ── Public types ──────────────────────────────────────────────────────

export interface AngleLeadLike extends ClassifierLeadLike {
  id?: string | number | null;
  key?: string | number | null;
  placeId?: string | null;
  companyName?: string | null;
  websiteUrl?: string | null;
  score?: number | null;
  forceAction?: boolean | null;
  bucket?: string | null;
  recommendedAction?: string | null;
  expectedValue?: number | null;
  revenueImpact?: number | null;
}

export type TopOpportunityAction = "call" | "email" | "fix_contact" | "verify";

export interface TopOpportunity {
  bucketId: string;
  lead: AngleLeadLike;
  why: string;
  value: string;
  action: TopOpportunityAction;
  actionLabel: string;
  script: string;
}

// ── Top-lead picker ───────────────────────────────────────────────────

export function getTopLeadForAngle(
  bucketId: string,
  leads: AngleLeadLike[] | null | undefined,
  tradeId: TradeId,
): { lead: AngleLeadLike; classification: BucketClassification | null } | null {
  if (!Array.isArray(leads) || leads.length === 0) return null;

  // For each lead, run the classifier and find the matching bucket
  // entry. Score it on:
  //   3 × bucket-match confidence (high=3, medium=2, low=1)
  //     + log-scaled lead.score
  //     + small reviewCount bonus
  //     + 4-pt boost for force-action / call-now leads
  //     + 2-pt boost when the bucket is the lead's primary classification
  // No fabrication — every input is already on the lead.
  let best: { lead: AngleLeadLike; classification: BucketClassification | null; rank: number } | null = null;

  for (const lead of leads) {
    if (!lead) continue;
    const all = classifyLeadIntoBuckets(lead, tradeId);
    const match = all.find((c) => c.bucketId === bucketId) ?? null;
    const isPrimary = all[0]?.bucketId === bucketId;
    const confRank = match ? CONFIDENCE_RANK[match.confidence] : 0;
    const reasonBoost = match ? Math.min(3, match.reasons.length) : 0;

    const score = typeof lead.score === "number" ? lead.score : 0;
    const reviews = reviewsOf(lead) ?? 0;
    const ratingPenalty = typeof lead.rating === "number" && lead.rating > 0 && lead.rating < 4.0 ? 1 : 0;

    const rank =
      confRank * 3 +
      reasonBoost +
      (lead.forceAction ? 4 : 0) +
      (lead.recommendedAction === "CALL NOW" || lead.bucket === "CALL NOW" ? 3 : 0) +
      (isPrimary ? 2 : 0) +
      Math.log10(Math.max(1, score) + 1) * 1.5 +
      Math.min(2, reviews / 50) +
      ratingPenalty;

    if (!best || rank > best.rank) {
      best = { lead, classification: match, rank };
    }
  }

  if (!best) return null;
  return { lead: best.lead, classification: best.classification };
}

// ── Why + Value + Action copy ─────────────────────────────────────────

function whyFromClassification(
  classification: BucketClassification | null,
  lead: AngleLeadLike,
): string {
  if (classification && classification.reasons.length > 0) {
    // Take 1–2 strongest reasons, joined as one direct clause.
    return classification.reasons.slice(0, 2).join(" · ");
  }
  if (!hasWebsite(lead)) return "No website on the listing — you sell the fix.";
  const reviews = reviewsOf(lead);
  if (typeof reviews === "number" && reviews < 25) return `Only ${reviews} reviews — buyers stall here.`;
  if (typeof lead.rating === "number" && lead.rating > 0 && lead.rating < 4.3) {
    return `Rating ${lead.rating} below the trust line buyers compare against.`;
  }
  return "Strongest match in this angle right now.";
}

function valueFor(lead: AngleLeadLike): string {
  const ev = typeof lead.expectedValue === "number" && lead.expectedValue > 0 ? lead.expectedValue : null;
  const upside = typeof lead.revenueImpact === "number" && lead.revenueImpact > 0 ? lead.revenueImpact : null;
  if (ev) {
    return `~$${Math.round(ev).toLocaleString()} on the table${upside ? ` · $${Math.round(upside).toLocaleString()} upside` : ""}`;
  }
  if (upside) {
    return `~$${Math.round(upside).toLocaleString()} upside`;
  }
  return "Ready to close.";
}

function actionFor(lead: AngleLeadLike): { action: TopOpportunityAction; actionLabel: string } {
  // Always default to call. Only fall back when no phone exists.
  if (hasPhone(lead)) {
    return { action: "call", actionLabel: "Call this now" };
  }
  if (lead.email || lead.contacts?.primaryEmail) {
    return { action: "email", actionLabel: "Email this now" };
  }
  return { action: "fix_contact", actionLabel: "Find the number" };
}

// ── Script generator ──────────────────────────────────────────────────
// Single source of truth lives in lib/leads/scriptEngine. This module
// delegates so per-bucket "Next Deal" surfaces and the CallNowBar
// always read identical openers.

import { generateCallScript } from "../leads/scriptEngine";

// ── Public top-level entry ────────────────────────────────────────────

export function buildTopOpportunity(
  bucketId: string,
  leads: AngleLeadLike[] | null | undefined,
  tradeId: TradeId,
): TopOpportunity | null {
  const top = getTopLeadForAngle(bucketId, leads, tradeId);
  if (!top) return null;
  const { lead, classification } = top;
  const action = actionFor(lead);
  return {
    bucketId,
    lead,
    why: whyFromClassification(classification, lead),
    value: valueFor(lead),
    action: action.action,
    actionLabel: action.actionLabel,
    script: generateCallScript(lead, bucketId, tradeId).opener,
  };
}
