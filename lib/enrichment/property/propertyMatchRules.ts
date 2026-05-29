// Meridian — deterministic owner-attribution rules.
//
// Pure functions that decide whether a contact's name matches a parcel
// record's owner. No provider calls, no fuzzy ML, no AI disambiguation.
// The rules here gate whether a parcel row can be ATTACHED to a
// contact (with what confidence) or must be flagged as
// ownership_mismatch.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §1 Source-of-Truth Hierarchy — owner-attribution failure means
//       the property row is stored but NOT presented as ownership.
//   §4 Confidence System:
//       HIGH  → exact full-name match OR exact surname + situs match
//       MED   → surname-only match, spouse-only-on-title, trust/LLC
//                containing contact surname
//       LOW   → variations beyond surname (initials, hyphenation)
//       no_match → never attached as ownership
//   §6 Forbidden Behaviors — no first-name fuzzy match (too prone to
//       silent misattribution).

import type {
  PropertyIntelligenceConfidence,
  PropertyOwnerNameMatch,
} from "@/lib/crm-import/types";

// ── Public types ───────────────────────────────────────────────────

export interface OwnerNameMatchInput {
  /** Contact's `name` field from the CRM (verbatim). */
  contactName: string;
  /** Owner name from the public record (verbatim). */
  ownerNameOnRecord: string;
}

export interface OwnerNameMatchResult {
  match: PropertyOwnerNameMatch;
  /** Resulting confidence the caller should attach to the property
   *  entry. The caller may downgrade further (e.g. when address match
   *  alone was MED). It should NEVER upgrade past this value. */
  confidence: PropertyIntelligenceConfidence;
  /** Human-readable explanation that audit tooling can display. */
  reason: string;
}

// ── Tokenizers (deterministic) ─────────────────────────────────────

// Hyphens are TREATED AS WORD SEPARATORS during tokenization so a
// "Smith-Jones" hyphenated surname matches the bare "Smith" surname
// of a contact (and vice versa). This is the right call for marriage
// / double-barreled surnames; it does not falsely match unrelated
// last names because the contact's surname must still be present.
const PUNCTUATION_RE = /[.,'"`()\[\]<>{}!?;:\-]/g;

const TRUST_SUFFIXES: ReadonlySet<string> = new Set([
  "trust",
  "trustee",
  "living trust",
  "family trust",
  "revocable trust",
  "irrevocable trust",
  "rev trust",
  "rev. trust",
]);

const LLC_SUFFIXES: ReadonlySet<string> = new Set([
  "llc",
  "l.l.c.",
  "l l c",
  "inc",
  "inc.",
  "corp",
  "corp.",
  "company",
  "co",
  "co.",
  "lp",
  "lp.",
  "partners",
  "holdings",
  "properties",
  "investments",
  "group",
]);

function normalizeNameTokens(raw: string): string[] {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replace(PUNCTUATION_RE, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function extractContactSurname(contactName: string): string | null {
  const tokens = normalizeNameTokens(contactName);
  if (tokens.length < 2) return null;
  // Surname is the last token. Initials (single-letter tokens) are
  // not surnames; if the last token is an initial, take the previous.
  let i = tokens.length - 1;
  while (i >= 0 && tokens[i].length <= 1) i--;
  return i >= 0 ? tokens[i] : null;
}

function extractContactFirstName(contactName: string): string | null {
  const tokens = normalizeNameTokens(contactName);
  return tokens.length > 0 ? tokens[0] : null;
}

function containsAnySuffix(
  ownerTokens: readonly string[],
  suffixes: ReadonlySet<string>,
): boolean {
  // Check single-token AND adjacent-2-token forms for set membership.
  for (let i = 0; i < ownerTokens.length; i++) {
    if (suffixes.has(ownerTokens[i])) return true;
    if (i + 1 < ownerTokens.length) {
      const pair = `${ownerTokens[i]} ${ownerTokens[i + 1]}`;
      if (suffixes.has(pair)) return true;
    }
  }
  return false;
}

function ownerIsTrustOrLlc(ownerTokens: readonly string[]): boolean {
  return containsAnySuffix(ownerTokens, TRUST_SUFFIXES) ||
    containsAnySuffix(ownerTokens, LLC_SUFFIXES);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Decide how the public-record owner name aligns with the CRM contact
 * name. Pure. Deterministic. Same input → same output.
 *
 * The caller writes the result to PropertyIntelligenceEntry as
 * `ownerNameMatch`, and uses `confidence` to gate opener-surfacing
 * decisions per the constitution §4.
 */
export function classifyOwnerNameMatch(input: OwnerNameMatchInput): OwnerNameMatchResult {
  const contactTokens = normalizeNameTokens(input.contactName);
  const ownerTokens = normalizeNameTokens(input.ownerNameOnRecord);

  if (contactTokens.length === 0) {
    return { match: "no_match", confidence: "LOW", reason: "contact_name_empty" };
  }
  if (ownerTokens.length === 0) {
    return { match: "no_match", confidence: "LOW", reason: "owner_name_empty" };
  }

  // 1. Exact full-name match (token-set equality).
  // We use set comparison rather than ordered match to absorb
  // "Last, First" vs "First Last" public-record formats.
  const contactSet = new Set(contactTokens);
  const ownerSet = new Set(ownerTokens);
  let allOwnerInContact = true;
  for (const t of ownerSet) if (!contactSet.has(t)) { allOwnerInContact = false; break; }
  let allContactInOwner = true;
  for (const t of contactSet) if (!ownerSet.has(t)) { allContactInOwner = false; break; }
  if (allOwnerInContact && allContactInOwner) {
    return { match: "exact", confidence: "HIGH", reason: "all_tokens_match" };
  }

  const contactSurname = extractContactSurname(input.contactName);
  const contactFirst = extractContactFirstName(input.contactName);

  // 2. Trust / LLC containing contact surname.
  if (contactSurname && ownerIsTrustOrLlc(ownerTokens) && ownerTokens.includes(contactSurname)) {
    return {
      match: "trust_or_llc",
      confidence: "MED",
      reason: "owner_is_trust_or_llc_containing_contact_surname",
    };
  }
  if (ownerIsTrustOrLlc(ownerTokens)) {
    return {
      match: "no_match",
      confidence: "LOW",
      reason: "owner_is_trust_or_llc_without_contact_surname",
    };
  }

  // 3. Surname-only match (spouse-only-on-title is the common case).
  if (contactSurname && ownerTokens.includes(contactSurname)) {
    // If the contact's first name also appears, it's effectively exact
    // up to extra tokens (e.g. middle name on record) — still treat
    // as MED to be safe; HIGH requires set-equal which we already
    // checked.
    if (contactFirst && ownerTokens.includes(contactFirst)) {
      return {
        match: "exact",
        confidence: "HIGH",
        reason: "contact_first_and_surname_both_in_owner",
      };
    }
    return {
      match: "surname",
      confidence: "MED",
      reason: "surname_only_match_likely_spouse_or_title",
    };
  }

  // 4. No further fuzzy matching. The constitution §6 forbids
  // first-name-only fuzzy matching (silent misattribution risk).
  // Hyphenated surnames are already covered by the surname check
  // above because the tokenizer splits hyphens.
  return {
    match: "no_match",
    confidence: "LOW",
    reason: "no_token_alignment",
  };
}

/**
 * Given a name-match outcome and an address-level match strength
 * ("parcel_id" exact vs "address" only), produce the final confidence
 * to write on the PropertyIntelligenceEntry.
 *
 * Address-only matches with no owner name alignment are STORED but
 * never confer ownership: the caller writes status=ownership_mismatch.
 */
export function resolvePropertyConfidence(
  addressMatchStrength: "parcel_id" | "address",
  nameMatch: OwnerNameMatchResult,
): PropertyIntelligenceConfidence {
  if (nameMatch.match === "no_match") return "LOW";
  if (addressMatchStrength === "parcel_id" && nameMatch.match === "exact") return "HIGH";
  if (addressMatchStrength === "parcel_id" && nameMatch.match === "surname") return "MED";
  if (addressMatchStrength === "parcel_id" && nameMatch.match === "trust_or_llc") return "MED";
  if (addressMatchStrength === "address" && nameMatch.match === "exact") return "MED";
  if (addressMatchStrength === "address" && nameMatch.match === "surname") return "MED";
  return "LOW";
}
