// Meridian — deterministic CRM-tag → RelationshipType classifier.
//
// Pure. Deterministic. No fuzzy matching. No AI inference.
//
// Precedence rules (constitution §1 — explicit hierarchy):
//   1. Seller-style tag → prior_seller   (HIGHEST — seller beats buyer)
//   2. Buyer-style tag  → prior_buyer
//   3. Sphere-style tag → sphere
//   4. Referral tag     → referral
//   5. Otherwise        → unknown
//
// The function also returns a `relationshipTypeSource` string carrying
// the exact tag that produced the classification, so the audit and
// the opportunity signal can cite real CRM evidence.

import type { RelationshipType } from "./types";

interface ClassifierResult {
  relationshipType: RelationshipType;
  relationshipTypeSource: string; // e.g. "crm:tag:Seller" or "crm:none"
}

// ── Tag patterns (mirror openerBuilder TAG_PATTERNS shape, no
// runtime import to keep the opportunity layer independent) ────────

const SELLER_PATTERNS: readonly RegExp[] = [
  /^past_?seller$/,
  /^seller$/,
  /^seller_?(client|past)$/,
  /^sold_with_us$/,
  /^listing_?past$/,
];

const BUYER_PATTERNS: readonly RegExp[] = [
  /^past_?buyer$/,
  /^buyer$/,
  /^buyer_?(client|past)$/,
  /^bought_with_us$/,
];

const SPHERE_PATTERNS: readonly RegExp[] = [
  /^sphere$/,
  /^soi$/,
  /^sphere_?of_?influence$/,
  /^personal_?network$/,
  /^center_of_influence$/,
  /^coi$/,
];

const REFERRAL_PATTERNS: readonly RegExp[] = [
  /^referral_?source$/,
  /^referral$/,
  /^referrer$/,
  /^referred_by$/,
];

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function matchTag(
  tags: readonly string[],
  patterns: readonly RegExp[],
): string | null {
  for (const raw of tags) {
    const norm = normalizeTag(raw);
    if (norm.length === 0) continue;
    for (const p of patterns) {
      if (p.test(norm)) return raw;
    }
  }
  return null;
}

/**
 * Classify a contact's relationship type from their CRM tags.
 *
 * Precedence (deterministic — first match wins):
 *   seller → buyer → sphere → referral → unknown
 *
 * `relationshipTypeSource` carries:
 *   - `crm:tag:<verbatim-tag>` when a tag matched
 *   - `crm:none`                when no tags or no match
 *
 * Pure. Same input → byte-identical output.
 */
export function classifyRelationshipType(
  tags: readonly string[] | null | undefined,
): ClassifierResult {
  const safeTags = Array.isArray(tags) ? tags : [];
  if (safeTags.length === 0) {
    return { relationshipType: "unknown", relationshipTypeSource: "crm:none" };
  }

  // Seller wins over buyer per the constitution-aligned business rule:
  // when both tags are present (operator may have set both on a contact
  // who bought one property and sold another), the seller relationship
  // is treated as the dominant one because seller-side opportunities
  // carry higher operator value for the Brookside-style workspace.
  const sellerMatch = matchTag(safeTags, SELLER_PATTERNS);
  if (sellerMatch) {
    return {
      relationshipType: "prior_seller",
      relationshipTypeSource: `crm:tag:${sellerMatch}`,
    };
  }

  const buyerMatch = matchTag(safeTags, BUYER_PATTERNS);
  if (buyerMatch) {
    return {
      relationshipType: "prior_buyer",
      relationshipTypeSource: `crm:tag:${buyerMatch}`,
    };
  }

  // Transaction-style tags (seller/buyer) beat generic sphere/referral
  // tags. Only check sphere/referral when no transaction tag matched.
  const sphereMatch = matchTag(safeTags, SPHERE_PATTERNS);
  if (sphereMatch) {
    return {
      relationshipType: "sphere",
      relationshipTypeSource: `crm:tag:${sphereMatch}`,
    };
  }

  const referralMatch = matchTag(safeTags, REFERRAL_PATTERNS);
  if (referralMatch) {
    return {
      relationshipType: "referral",
      relationshipTypeSource: `crm:tag:${referralMatch}`,
    };
  }

  return { relationshipType: "unknown", relationshipTypeSource: "crm:none" };
}
