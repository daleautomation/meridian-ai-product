// Meridian CRM import — safe-merge field resolution.
//
// When the identity resolver decides an incoming row matches an
// existing contact, this module computes the merged record. Rules
// designed to preserve operator and CRM truth:
//
//   • CRM-truth fields (name, company, phone, email, address) — prefer
//     the non-blank side. Incoming wins when both are non-blank
//     (caller may have updated the CRM). NEVER overwrite a non-empty
//     existing value with a blank incoming value.
//   • Tags — union the two sets (no duplicates).
//   • Notes — keep whichever is richer (longer non-empty string).
//     Operator-typed notes are T1 truth; we don't truncate them.
//   • lastInteractionAt — take the LATER of the two.
//   • createdAt — preserve the EXISTING (oldest) created-at. This is
//     the contact's relationship-history anchor.
//   • importJobId / sourceCrm / updatedAt — take incoming (this import
//     is the latest write).
//   • Trust + relationship score — take incoming (recomputed against
//     the merged input).
//   • Repairs + enrichment — handled at the persistence layer by the
//     JSONB-merging upsert (`upsertContactsNeon`). Never touched here.
//
// Pure: no I/O, no Date.now(). Same inputs → same output.

import type { CrmContactRecord } from "./types";

function preferNonBlank<T extends string | null>(incoming: T, existing: T): T {
  // Non-blank existing AND blank incoming → keep existing.
  const incomingHasValue = typeof incoming === "string" && incoming.trim().length > 0;
  const existingHasValue = typeof existing === "string" && existing.trim().length > 0;
  if (incomingHasValue) return incoming;
  if (existingHasValue) return existing;
  return incoming; // both blank — either is fine
}

function richer(a: string | null, b: string | null): string | null {
  const aTrim = a?.trim() ?? "";
  const bTrim = b?.trim() ?? "";
  if (!aTrim && !bTrim) return null;
  if (aTrim.length >= bTrim.length) return a;
  return b;
}

function unionTags(a: ReadonlyArray<string>, b: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of [...a, ...b]) {
    const t = tag.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export interface MergeContactsInput {
  incoming: CrmContactRecord;
  existing: CrmContactRecord;
}

/**
 * Compute the merged contact record. The result keeps the existing
 * row's `id` and `createdAt` (so the upsert on `(workspace_id,
 * contact_id)` updates the right row), takes incoming-overlayed-by-
 * existing-on-blank for CRM-truth fields, unions tags, takes richer
 * notes, takes later lastInteraction, and lets the persistence layer
 * preserve enrichment + repairs via the JSONB-merging upsert.
 */
export function mergeContactRecords(input: MergeContactsInput): CrmContactRecord {
  const { incoming, existing } = input;
  if (incoming.workspaceId !== existing.workspaceId) {
    throw new Error("mergeContactRecords: workspaceId mismatch — refusing to merge across tenants");
  }
  const name = preferNonBlank(incoming.name, existing.name);
  const company = preferNonBlank(incoming.company, existing.company);
  const phone = preferNonBlank(incoming.phone, existing.phone);
  const email = preferNonBlank(incoming.email, existing.email);
  const address = preferNonBlank(incoming.address, existing.address);
  const normalizedPhone = preferNonBlank(incoming.normalizedPhone, existing.normalizedPhone);
  const normalizedEmail = preferNonBlank(incoming.normalizedEmail, existing.normalizedEmail);
  const normalizedCompany = preferNonBlank(incoming.normalizedCompany, existing.normalizedCompany);
  const normalizedName = preferNonBlank(incoming.normalizedName, existing.normalizedName);
  const notes = richer(incoming.notes, existing.notes);
  const tags = unionTags(existing.tags ?? [], incoming.tags ?? []);
  const lastInteractionAt = laterIso(incoming.lastInteractionAt, existing.lastInteractionAt);

  return {
    // Preserve identity + history anchors.
    id: existing.id,
    workspaceId: existing.workspaceId,
    createdAt: existing.createdAt,
    // CRM-truth fields, merged.
    name,
    company,
    phone,
    email,
    address,
    notes,
    tags,
    lastInteractionAt,
    // Normalized derivations, merged.
    normalizedPhone,
    normalizedEmail,
    normalizedCompany,
    normalizedName,
    // This-import metadata.
    importJobId: incoming.importJobId,
    sourceCrm: incoming.sourceCrm,
    updatedAt: incoming.updatedAt,
    // Trust + score recomputed at write time; take incoming.
    dataTrust: incoming.dataTrust,
    relationshipScore: incoming.relationshipScore,
    scoreMetadata: incoming.scoreMetadata,
    // Enrichment + repairs are preserved by the JSONB-merging upsert
    // at the persistence layer (see crmContactsNeonAdapter.ts:
    // upsertContactsNeon ON CONFLICT clause). DO NOT touch here.
    enrichment: existing.enrichment ?? incoming.enrichment,
    repairs: existing.repairs ?? incoming.repairs,
    originalImport: existing.originalImport ?? incoming.originalImport,
  };
}

/** Internal hooks for the validator suite. Do not use in product code. */
export const __internal__ = { preferNonBlank, richer, unionTags, laterIso };
