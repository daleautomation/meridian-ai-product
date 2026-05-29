// Meridian — CRM-only relationship intelligence classification.
//
// This REPLACES the opportunity SCORE for the CRM-only case. The
// opportunity engine (scoreOpportunity.ts) is preserved for
// property/listing/public-record ("market") signals; it now caps every
// CRM-only contact at WEAK (no market evidence). The judgement an
// operator actually needs for a relationship book — "who is this and
// why might I reach out?" — comes from this rule-based classifier
// instead of a pseudo-quantitative 0–100 score.
//
// Pure: no I/O, no Date.now() (caller injects `now`), no inference.
//
// Honesty rules baked in:
//   • These are RELATIONSHIP labels, never "Opportunity" / "Hot Lead" /
//     "Seller Signal". Those words require market evidence and live in
//     the opportunity engine, gated behind active_listing_found /
//     listed_by_another_agent / ownership_duration_over_7yr /
//     public-record evidence.
//   • "Reachable" means a phone/email string exists — NOT that it was
//     verified. Reachability is a gate, not a score contribution.
//   • Recency is explicit: a seller with no last-contact date is NOT
//     treated the same as a recently-active one.

const STALE_RELATIONSHIP_MIN_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SELLER_TAG = /\bseller\b/i;
const BUYER_TAG = /\bbuyer\b/i;
const SPHERE_TAG = /center of influence|\bsphere\b|\bcoi\b|referr|advocate|partner/i;

export type RelationshipClass =
  | "past_seller_reconnect"
  | "seller_history_verify_recency"
  | "sphere_reengagement"
  | "cold_relationship"
  | "not_reachable";

export const RELATIONSHIP_DISPLAY_LABEL: Record<RelationshipClass, string> = {
  past_seller_reconnect: "Past Seller Reconnect",
  seller_history_verify_recency: "Seller History (Verify Recency)",
  sphere_reengagement: "Sphere Reengagement",
  cold_relationship: "Cold Relationship",
  not_reachable: "Not Reachable",
};

export interface RelationshipClassificationInput {
  tags: string[];
  /** A phone string exists on the contact (presence, not verification). */
  hasPhone: boolean;
  /** An email string exists on the contact (presence, not verification). */
  hasEmail: boolean;
  lastInteractionAt: string | null;
  now: Date;
}

export interface RelationshipClassification {
  label: RelationshipClass;
  displayLabel: string;
  /** contact_channel_present — the gate. False → not_reachable. */
  reachable: boolean;
  /** Days since last interaction, or null when no date is on file. */
  staleDays: number | null;
  /** Plain-language, provenance-tagged reasons (CRM-only). */
  reasons: string[];
  /** Confidence in the CLASSIFICATION (not a market prediction). */
  confidence: "medium" | "low";
}

function daysSince(thenIso: string | null, now: Date): number | null {
  if (!thenIso) return null;
  const t = Date.parse(thenIso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now.getTime() - t) / MS_PER_DAY);
}

/**
 * Classify a CRM contact into a relationship-intelligence bucket.
 * Deterministic; first matching rule wins. Never emits opportunity
 * language.
 */
export function classifyRelationship(
  input: RelationshipClassificationInput,
): RelationshipClassification {
  const reachable = input.hasPhone || input.hasEmail;
  const staleDays = daysSince(input.lastInteractionAt, input.now);
  const tags = input.tags ?? [];
  const tagStr = tags.join(" ");
  const isSeller = SELLER_TAG.test(tagStr);
  const isBuyer = BUYER_TAG.test(tagStr);
  const isSphere = SPHERE_TAG.test(tagStr);
  const channelReason = input.hasPhone && input.hasEmail
    ? "phone + email on file"
    : input.hasPhone ? "phone on file" : input.hasEmail ? "email on file" : "no phone or email on file";

  // ── Gate: not reachable ──────────────────────────────────────────
  if (!reachable) {
    return {
      label: "not_reachable",
      displayLabel: RELATIONSHIP_DISPLAY_LABEL.not_reachable,
      reachable: false,
      staleDays,
      reasons: ["No phone or email on file — cannot be actioned"],
      confidence: "low",
    };
  }

  const recencyReason =
    staleDays === null
      ? "no last-contact date on file"
      : staleDays >= STALE_RELATIONSHIP_MIN_DAYS
        ? `last contact ${staleDays} days ago (>= 12 months)`
        : `last contact ${staleDays} days ago`;

  // ── Prior seller ─────────────────────────────────────────────────
  if (isSeller) {
    if (input.lastInteractionAt === null) {
      return {
        label: "seller_history_verify_recency",
        displayLabel: RELATIONSHIP_DISPLAY_LABEL.seller_history_verify_recency,
        reachable: true,
        staleDays,
        reasons: [
          "Tagged seller relationship in CRM (crm:tag:Seller)",
          "No last-contact date on file — verify recency before outreach",
          channelReason,
        ],
        confidence: "low",
      };
    }
    return {
      label: "past_seller_reconnect",
      displayLabel: RELATIONSHIP_DISPLAY_LABEL.past_seller_reconnect,
      reachable: true,
      staleDays,
      reasons: [
        "Tagged seller relationship in CRM (crm:tag:Seller)",
        recencyReason,
        channelReason,
      ],
      confidence: "medium",
    };
  }

  // ── Buyer / sphere / center-of-influence ─────────────────────────
  if (isBuyer || isSphere) {
    return {
      label: "sphere_reengagement",
      displayLabel: RELATIONSHIP_DISPLAY_LABEL.sphere_reengagement,
      reachable: true,
      staleDays,
      reasons: [
        isSphere ? "Center-of-influence / sphere contact" : "Tagged buyer relationship in CRM (crm:tag:Buyer)",
        recencyReason,
        channelReason,
      ],
      confidence: "low",
    };
  }

  // ── Fallback: a reachable contact with no strong relationship tag ─
  return {
    label: "cold_relationship",
    displayLabel: RELATIONSHIP_DISPLAY_LABEL.cold_relationship,
    reachable: true,
    staleDays,
    reasons: ["No seller/buyer/sphere tag in CRM", recencyReason, channelReason],
    confidence: "low",
  };
}
