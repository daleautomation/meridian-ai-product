// Meridian CRM import — identity-key derivation for stable, content-
// derived contact IDs.
//
// The single root cause of duplicate bloat (Nicole workspace 130 → 228
// after re-import) was contact_id derivation from rowIndex:
//   newContactId(workspaceId, row.rowIndex)
// When a re-import had even one row of difference (added, removed,
// reordered), rowIndexes shifted, contact_ids changed, and every shifted
// row became a new contact_id → new INSERT instead of UPDATE.
//
// The fix is a two-part rule applied at execute time:
//   1. Look up existing contacts by IDENTITY signals (email, phone,
//      name + canonical address) and REUSE their ID for the upsert.
//   2. For contacts that genuinely don't exist yet, mint a stable ID
//      derived from the strongest identity signal in the row.
//
// Re-importing the same CSV after this fix is byte-stable: every row
// either matches an existing contact (ID preserved) or hashes to the
// same new ID it would have hashed to on the prior run.

import { createHash } from "node:crypto";
import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import type { CrmContactRecord, NormalizedCrmContact } from "./types";

const ID_HEX_LENGTH = 12;

/** Pluggable lens — same shape across NormalizedCrmContact and the persisted CrmContactRecord. */
export interface IdentitySignals {
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  normalizedName: string | null;
  address: string | null;
}

function signalsFromRow(row: NormalizedCrmContact): IdentitySignals {
  return {
    normalizedEmail: row.normalizedEmail,
    normalizedPhone: row.normalizedPhone,
    normalizedName: row.normalizedName,
    address: row.address,
  };
}

function signalsFromExisting(c: CrmContactRecord): IdentitySignals {
  return {
    normalizedEmail: c.normalizedEmail,
    normalizedPhone: c.normalizedPhone,
    normalizedName: c.normalizedName,
    address: c.address,
  };
}

/**
 * Canonical address key from a raw address string, or null when the
 * address is missing or too weak to canonicalize.
 */
function canonicalAddrKey(address: string | null): string | null {
  if (!address || !address.trim()) return null;
  try {
    const normalized = normalizeAddress(address);
    if (detectWeakAddress(normalized)) return null;
    return canonicalPropertyKey(normalized);
  } catch {
    return null;
  }
}

/**
 * Same-person rule for name + address matches:
 *   • both sides have a non-empty normalized name
 *   • both sides have a canonicalizable address
 *   • the addresses canonicalize to the same key
 *   • the surnames (last whitespace-delimited token) match
 *
 * The surname check defends against false merges when two unrelated
 * people share a household-canonical address (rare but possible —
 * roommates with the same first name) AND when only first names match
 * (e.g. "Greg" in two CRMs).
 */
function nameAndAddressMatch(a: IdentitySignals, b: IdentitySignals): boolean {
  if (!a.normalizedName || !b.normalizedName) return false;
  const aKey = canonicalAddrKey(a.address);
  const bKey = canonicalAddrKey(b.address);
  if (!aKey || !bKey || aKey !== bKey) return false;

  const aTokens = a.normalizedName.split(/\s+/).filter(Boolean);
  const bTokens = b.normalizedName.split(/\s+/).filter(Boolean);
  if (aTokens.length < 2 || bTokens.length < 2) return false;
  return aTokens[aTokens.length - 1] === bTokens[bTokens.length - 1];
}

export type IdentityMatchReason =
  | "email"
  | "phone"
  | "name_and_address"
  | null;

export interface IdentityResolution {
  reason: IdentityMatchReason;
  existing: CrmContactRecord | null;
}

/**
 * Resolve an incoming row against the existing workspace contacts.
 *
 * Order of precedence (strongest signal wins):
 *   1. Exact normalized-email match
 *   2. Exact normalized-phone match
 *   3. Name + canonical address match (surnames must agree)
 *
 * Returns the matched existing record (and the match reason) when one
 * exists; otherwise returns null + null.
 *
 * NEVER matches on:
 *   • first-name alone
 *   • normalized name alone (cross-import drift makes this unsafe)
 *   • address alone
 *   • company alone
 */
export function resolveExistingContact(
  row: IdentitySignals,
  existing: ReadonlyArray<CrmContactRecord>,
): IdentityResolution {
  if (row.normalizedEmail) {
    const match = existing.find(
      (c) => c.normalizedEmail && c.normalizedEmail === row.normalizedEmail,
    );
    if (match) return { reason: "email", existing: match };
  }
  if (row.normalizedPhone) {
    const match = existing.find(
      (c) => c.normalizedPhone && c.normalizedPhone === row.normalizedPhone,
    );
    if (match) return { reason: "phone", existing: match };
  }
  const match = existing.find((c) => nameAndAddressMatch(row, signalsFromExisting(c)));
  if (match) return { reason: "name_and_address", existing: match };
  return { reason: null, existing: null };
}

/**
 * Convenience for the import pipeline: pass a NormalizedCrmContact
 * directly.
 */
export function resolveExistingContactForRow(
  row: NormalizedCrmContact,
  existing: ReadonlyArray<CrmContactRecord>,
): IdentityResolution {
  return resolveExistingContact(signalsFromRow(row), existing);
}

/**
 * Mint a stable contact_id from the strongest available identity
 * signal. The same row content produces the same id across runs.
 *
 * Order of precedence:
 *   1. email
 *   2. phone
 *   3. name + canonical address
 *   4. normalized name alone — produces a stable id BUT this contact
 *      will collide with any other no-channel/no-address row of the
 *      same name. That's the cost of importing a row with no
 *      stable identity.
 *   5. genuinely identityless row — falls back to the import job +
 *      rowIndex (operator-visible bloat risk).
 */
export function mintContactId(
  workspaceId: string,
  row: NormalizedCrmContact,
  fallbackContext: { importJobId: string },
): { id: string; basis: "email" | "phone" | "name_and_address" | "name" | "rowindex" } {
  const sig = signalsFromRow(row);

  if (sig.normalizedEmail) {
    return {
      id: hashedId(workspaceId, ["email", sig.normalizedEmail]),
      basis: "email",
    };
  }
  if (sig.normalizedPhone) {
    return {
      id: hashedId(workspaceId, ["phone", sig.normalizedPhone]),
      basis: "phone",
    };
  }
  const addrKey = canonicalAddrKey(sig.address);
  if (sig.normalizedName && addrKey) {
    return {
      id: hashedId(workspaceId, ["name_addr", sig.normalizedName, addrKey]),
      basis: "name_and_address",
    };
  }
  if (sig.normalizedName) {
    return {
      id: hashedId(workspaceId, ["name", sig.normalizedName]),
      basis: "name",
    };
  }
  // Last resort: row position + import job. Operator sees this in the
  // operational dry-run report and can decide whether to import.
  return {
    id: hashedId(workspaceId, ["row", fallbackContext.importJobId, String(row.rowIndex)]),
    basis: "rowindex",
  };
}

function hashedId(workspaceId: string, parts: ReadonlyArray<string>): string {
  const h = createHash("sha256");
  h.update("contact ");
  h.update(workspaceId);
  for (const p of parts) {
    h.update(" ");
    h.update(p);
  }
  return `crm-${workspaceId}-${h.digest("hex").slice(0, ID_HEX_LENGTH)}`;
}

/** Internal hooks for the validator suite. Do not use in product code. */
export const __internal__ = {
  signalsFromRow,
  signalsFromExisting,
  canonicalAddrKey,
  nameAndAddressMatch,
};
