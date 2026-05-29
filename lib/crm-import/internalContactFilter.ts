// Meridian — internal-diagnostic-contact filter.
//
// Some workspaces accumulated rows from internal persistence /
// integration test runs that ran with DATABASE_URL set. The rows are
// real DB rows but represent zero operator value — they are named
// "Persist Check" with `persist@example.com`, ids prefixed
// `crm-persist-check-`, etc. They must never appear on a
// customer-visible priority surface, but we will NOT auto-delete them:
// production data deletion is a separate, manual operation.
//
// This module is the single source of truth for "is this row an
// internal diagnostic artifact?". Patterns are exact / anchored so a
// real customer named, say, "Persistence Pierre" cannot be hidden by
// accident.

import type { CrmContactRecord } from "./types";

const INTERNAL_NAMES = new Set(["persist check", "persist-check"]);
const INTERNAL_EMAILS = new Set([
  "persist@example.com",
  "sample@example.com",
  "test@example.com",
]);
const INTERNAL_CONTACT_ID_PREFIXES = ["crm-persist-check"];
const INTERNAL_SOURCE_CRMS = new Set(["test"]);

function lowerOrEmpty(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * True when the row is a known internal diagnostic artifact. Pure.
 * Same input → same output. Never AI-generated or fuzzy matched.
 */
export function isInternalDiagnosticContact(contact: CrmContactRecord): boolean {
  const id = lowerOrEmpty(contact.id);
  for (const prefix of INTERNAL_CONTACT_ID_PREFIXES) {
    if (id.startsWith(prefix)) return true;
  }

  const name = lowerOrEmpty(contact.name);
  if (INTERNAL_NAMES.has(name)) return true;

  const email = lowerOrEmpty(contact.email);
  if (email && INTERNAL_EMAILS.has(email)) return true;

  const normalizedEmail = lowerOrEmpty(contact.normalizedEmail);
  if (normalizedEmail && INTERNAL_EMAILS.has(normalizedEmail)) return true;

  const sourceCrm = lowerOrEmpty(contact.sourceCrm);
  if (sourceCrm && INTERNAL_SOURCE_CRMS.has(sourceCrm)) return true;

  return false;
}

/**
 * Convenience: drop every internal diagnostic row from a list.
 * Preserves input order; pure.
 */
export function filterOutInternalDiagnosticContacts(
  contacts: readonly CrmContactRecord[],
): CrmContactRecord[] {
  return contacts.filter((c) => !isInternalDiagnosticContact(c));
}
