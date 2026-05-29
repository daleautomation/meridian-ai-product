// Meridian — CRM record integrity classifier.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §1 Source-of-Truth Hierarchy — operator-visible trust must reflect
//       the actual quality of T1–T3 CRM data. Strong data looks strong;
//       weak data looks weak.
//   §4 Confidence System — HIGH/MED/WEAK tiers map directly onto the
//       constitution's confidence ladder. LOW is reserved for derived
//       intelligence; CRM rows themselves never produce "LOW," only
//       WEAK or absent.
//   §5 Deterministic Signal Rules — pure function, same input → same
//       output, no Date.now() leaked.
//   §6 Forbidden Behaviors — no AI scoring. No hidden weights.
//
// This module classifies a single CrmContactRecord into a deterministic
// trust tier with named reasons. The audit layer surfaces the
// distribution; the eligibility layer consumes the tier; the workspace
// renders weak rows as visibly weak.

import { isInternalDiagnosticContact } from "./internalContactFilter";
import type { CrmContactRecord } from "./types";

// ── Public types ───────────────────────────────────────────────────

export type CrmIntegrityTier = "HIGH" | "MED" | "WEAK";

export interface CrmIntegrityReport {
  tier: CrmIntegrityTier;
  /** Ordered, deterministic list of positive signals on this row. */
  strengths: string[];
  /** Ordered, deterministic list of named gaps on this row. */
  gaps: string[];
  /** True when the row is an internal diagnostic artifact and should be
   *  hidden from all operator surfaces. */
  isInternalDiagnostic: boolean;
  /** Convenience: does this row have an actionable contact channel? */
  hasActionableChannel: boolean;
  /** Convenience: is the row's email on a personal-mail domain? */
  hasBusinessDomain: boolean;
  /** Convenience: does the CRM carry a surname? */
  hasSurname: boolean;
}

// ── Personal-mail domain set (matches enrich-nicole-hunter.ts) ─────

const PERSONAL_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "outlook.com",
  "msn.com",
  "live.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mac.com",
  "me.com",
  "ymail.com",
]);

// ── Helpers ────────────────────────────────────────────────────────

function trim(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function emailDomain(email: string | null | undefined): string | null {
  const e = trim(email).toLowerCase();
  const at = e.indexOf("@");
  if (at < 0 || at === e.length - 1) return null;
  return e.slice(at + 1);
}

function tokensOf(name: string | null | undefined): readonly string[] {
  return trim(name)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function looksParseable(address: string | null | undefined): boolean {
  const a = trim(address);
  if (a.length < 8) return false;
  // Must have a digit (street number) and either a 5-digit ZIP or a
  // 2-letter state abbreviation. Same heuristic the property layer
  // uses for confidence MED+.
  const hasDigit = /\d/.test(a);
  const hasZip = /\b\d{5}\b/.test(a);
  const hasStateLike = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i.test(a);
  return hasDigit && (hasZip || hasStateLike);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Classify a single CRM record into HIGH / MED / WEAK with named
 * strengths and gaps. Pure. Deterministic.
 *
 * Tiering rules:
 *   HIGH — full name (surname present) + business-domain email +
 *          parseable address + at least one actionable channel
 *   MED  — at least 3 of: surname / business-domain / parseable address
 *          / actionable channel
 *   WEAK — fewer than 3 strengths, or any single critical gap
 *          (no name, no actionable channel + no address)
 */
export function classifyCrmIntegrity(contact: CrmContactRecord): CrmIntegrityReport {
  const strengths: string[] = [];
  const gaps: string[] = [];

  const isInternalDiagnostic = isInternalDiagnosticContact(contact);

  // Surname detection — token count ≥ 2 with a non-initial last token.
  const nameTokens = tokensOf(contact.name);
  const lastToken = nameTokens.length > 0 ? nameTokens[nameTokens.length - 1] : "";
  const hasSurname = nameTokens.length >= 2 && lastToken.length > 1;
  if (hasSurname) strengths.push("full_name_on_file");
  else if (nameTokens.length === 1) gaps.push("missing_surname");
  else gaps.push("no_name");

  // Email + domain classification.
  const domain = emailDomain(contact.email) ?? emailDomain(contact.normalizedEmail);
  const hasBusinessDomain = domain !== null && !PERSONAL_MAIL_DOMAINS.has(domain);
  if (domain && hasBusinessDomain) strengths.push("business_domain_email");
  else if (domain) gaps.push(`personal_domain_email:${domain}`);
  else gaps.push("no_email");

  // Phone presence.
  const hasPhone = !!(trim(contact.phone) || trim(contact.normalizedPhone));
  if (hasPhone) strengths.push("phone_on_file");
  else gaps.push("no_phone");

  // Parseable address.
  const parseableAddress = looksParseable(contact.address);
  if (parseableAddress) strengths.push("parseable_address");
  else if (trim(contact.address)) gaps.push("address_unparseable");
  else gaps.push("no_address");

  // Actionable channel = phone OR email (any email — personal counts
  // as actionable even if it can't be Hunter-enriched).
  const hasActionableChannel = hasPhone || !!domain;
  if (!hasActionableChannel) gaps.push("no_actionable_channel");

  // Last interaction on file.
  if (trim(contact.lastInteractionAt)) strengths.push("last_touch_on_file");
  else gaps.push("no_last_interaction");

  // Notes presence (human or automation — quality is judged elsewhere).
  if (trim(contact.notes)) strengths.push("notes_on_file");

  // Tier resolution — count strengths, then check critical-gap overrides.
  let tier: CrmIntegrityTier;
  if (
    hasSurname &&
    hasBusinessDomain &&
    parseableAddress &&
    hasActionableChannel
  ) {
    tier = "HIGH";
  } else if (
    [hasSurname, hasBusinessDomain, parseableAddress, hasActionableChannel].filter(Boolean).length >= 3
  ) {
    tier = "MED";
  } else {
    tier = "WEAK";
  }

  // Critical override: a row with no name and no actionable channel is
  // WEAK regardless of other strengths — it cannot be acted on.
  if (nameTokens.length === 0 && !hasActionableChannel) {
    tier = "WEAK";
  }

  return {
    tier,
    strengths: Object.freeze([...strengths]) as unknown as string[],
    gaps: Object.freeze([...gaps]) as unknown as string[],
    isInternalDiagnostic,
    hasActionableChannel,
    hasBusinessDomain,
    hasSurname,
  };
}

/**
 * Bucket counts for a list of CRM records. Pure. Convenient for
 * audit scripts.
 */
export function summarizeCrmIntegrity(
  contacts: readonly CrmContactRecord[],
): {
  total: number;
  visible: number;
  internalDiagnostic: number;
  high: number;
  med: number;
  weak: number;
  topGaps: Array<[string, number]>;
} {
  let high = 0;
  let med = 0;
  let weak = 0;
  let internalDiagnostic = 0;
  const gapCounts = new Map<string, number>();
  for (const c of contacts) {
    const r = classifyCrmIntegrity(c);
    if (r.isInternalDiagnostic) {
      internalDiagnostic += 1;
      continue;
    }
    if (r.tier === "HIGH") high += 1;
    else if (r.tier === "MED") med += 1;
    else weak += 1;
    for (const g of r.gaps) {
      // Normalize personal-domain gaps to a single bucket so the audit
      // doesn't list 13 separate per-domain entries.
      const key = g.startsWith("personal_domain_email:") ? "personal_domain_email" : g;
      gapCounts.set(key, (gapCounts.get(key) ?? 0) + 1);
    }
  }
  const topGaps = [...gapCounts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: contacts.length,
    visible: contacts.length - internalDiagnostic,
    internalDiagnostic,
    high,
    med,
    weak,
    topGaps,
  };
}
