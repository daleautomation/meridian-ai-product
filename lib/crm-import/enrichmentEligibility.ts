// Meridian — shared enrichment eligibility rules.
//
// Single source of truth for "should we even try to enrich this row?"
// Lifts the per-script gating that lived inside enrich-nicole-hunter.ts
// (no_email / personal_domain / no_last_name) into a deterministic
// module so every future enrichment script (Property, future providers)
// uses the same canonical reason vocabulary.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §2 Provenance Requirements — canonical reason strings only.
//   §6.10 Hunter taught us that wasted-call patterns produce noise;
//          this module prevents calls that the provider would reject.
//   §11 Future Expansion Rules — adding a new provider requires
//          declaring its eligibility predicate, not duplicating the
//          gating logic per-script.

import { classifyCrmIntegrity } from "./integrity";
import type { CrmContactRecord } from "./types";

// ── Canonical eligibility reasons (closed vocabulary) ─────────────

export type EnrichmentSkipReason =
  | "internal_diagnostic"
  | "no_email"
  | "no_name"
  | "no_last_name"
  | "personal_domain"
  | "no_address"
  | "address_unparseable"
  | "duplicate_entity"
  | "weak_record";

export interface EnrichmentEligibility {
  eligible: boolean;
  skipReason: EnrichmentSkipReason | null;
  detail: string | null;
}

// ── Personal-mail domains (mirrored from integrity.ts) ────────────

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

function emailDomain(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at < 0 || at === e.length - 1) return null;
  return e.slice(at + 1);
}

function tokensOf(name: string | null | undefined): readonly string[] {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

// ── Hunter eligibility ─────────────────────────────────────────────
//
// Mirrors what enrich-nicole-hunter.ts learned the hard way:
//   1. Must not be an internal diagnostic row.
//   2. Must have an email.
//   3. Email domain must not be a personal mailbox provider.
//   4. Must have first AND last name (Hunter requires last_name; a
//      single-token CRM name produces guaranteed HTTP 400).

export function classifyHunterEligibility(
  contact: CrmContactRecord,
): EnrichmentEligibility {
  const integrity = classifyCrmIntegrity(contact);
  if (integrity.isInternalDiagnostic) {
    return { eligible: false, skipReason: "internal_diagnostic", detail: null };
  }

  const email = (contact.email ?? contact.normalizedEmail ?? "").trim();
  if (!email) {
    return { eligible: false, skipReason: "no_email", detail: null };
  }
  const domain = emailDomain(email);
  if (!domain) {
    return { eligible: false, skipReason: "no_email", detail: "malformed_email" };
  }
  if (PERSONAL_MAIL_DOMAINS.has(domain)) {
    return { eligible: false, skipReason: "personal_domain", detail: domain };
  }

  const tokens = tokensOf(contact.name);
  if (tokens.length === 0) {
    return { eligible: false, skipReason: "no_name", detail: null };
  }
  if (tokens.length < 2 || tokens[tokens.length - 1].length <= 1) {
    return { eligible: false, skipReason: "no_last_name", detail: null };
  }

  return { eligible: true, skipReason: null, detail: null };
}

// ── Property eligibility ───────────────────────────────────────────
//
// Mirrors what Property Layer Phase 1 measured: contact needs a
// parseable address AND a surname (parcel matching requires
// owner-name attribution to avoid silent misattribution).

export function classifyPropertyEligibility(
  contact: CrmContactRecord,
): EnrichmentEligibility {
  const integrity = classifyCrmIntegrity(contact);
  if (integrity.isInternalDiagnostic) {
    return { eligible: false, skipReason: "internal_diagnostic", detail: null };
  }

  const address = (contact.address ?? "").trim();
  if (!address) {
    return { eligible: false, skipReason: "no_address", detail: null };
  }

  // Reuse integrity's address-parseability heuristic by simply checking
  // for digit + ZIP-or-state. Repeated here to avoid coupling this
  // module's eligibility check to the property normalizer's confidence
  // ladder.
  const hasDigit = /\d/.test(address);
  const hasZip = /\b\d{5}\b/.test(address);
  const hasStateLike = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i.test(address);
  if (!hasDigit || !(hasZip || hasStateLike)) {
    return { eligible: false, skipReason: "address_unparseable", detail: null };
  }

  const tokens = tokensOf(contact.name);
  if (tokens.length === 0) {
    return { eligible: false, skipReason: "no_name", detail: null };
  }
  if (tokens.length < 2 || tokens[tokens.length - 1].length <= 1) {
    return { eligible: false, skipReason: "no_last_name", detail: null };
  }

  return { eligible: true, skipReason: null, detail: null };
}

/**
 * Summarize eligibility across a contact list. Pure. Convenient for
 * the crm:audit script.
 */
export function summarizeEnrichmentEligibility(
  contacts: readonly CrmContactRecord[],
): {
  hunter: Record<string, number>;
  property: Record<string, number>;
} {
  const hunter: Record<string, number> = { eligible: 0 };
  const property: Record<string, number> = { eligible: 0 };
  for (const c of contacts) {
    const h = classifyHunterEligibility(c);
    if (h.eligible) hunter.eligible += 1;
    else if (h.skipReason) hunter[h.skipReason] = (hunter[h.skipReason] ?? 0) + 1;
    const p = classifyPropertyEligibility(c);
    if (p.eligible) property.eligible += 1;
    else if (p.skipReason) property[p.skipReason] = (property[p.skipReason] ?? 0) + 1;
  }
  return { hunter, property };
}
