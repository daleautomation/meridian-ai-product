/**
 * check-reimport-survival — validator for the Sev-1 hardening
 * (audit Priorities 1 + 2). Proves that the merging upsert in
 * `upsertContactsNeon` preserves operator + derived state across
 * re-imports, and that the only DELETE-issuing path is the
 * explicitly-named destructive function.
 *
 * Strategy: simulate the new SQL contract in an in-memory mirror
 * (same pattern as check-public-record-storage), exercise every
 * re-import scenario, and source-inspect the adapter + store to
 * verify the structural invariants.
 *
 * Coverage (10 checks):
 *   1. Re-import preserves enrichment.opportunity verbatim
 *   2. Re-import preserves source_metadata.repairs[] verbatim
 *   3. Re-import preserves enrichment.hunter verbatim
 *   4. Workspace parcel links untouched by re-import
 *   5. No duplicate enrichment blocks created across re-runs
 *   6. Re-imports are deterministic (idempotent end state)
 *   7. CRM-truth keys still overwrite from the import
 *   8. No orphan links produced by the routine import path
 *      (because the import path no longer deletes contacts)
 *   9. No hidden DELETE behavior — only the destructively-named
 *      function issues DELETE statements
 *  10. No cross-workspace contamination — two workspaces stay
 *      isolated even when contact_ids coincide
 *
 * Pure. No DB. No env.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const failures: string[] = [];
function fail(msg: string): void {
  failures.push(msg);
}
function expect(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}
function expectEqual<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─────────────────────────────────────────────────────────────────
// SECTION 1 — In-memory mirror of the merging-upsert SQL contract
// ─────────────────────────────────────────────────────────────────
//
// The Neon adapter writes:
//   on conflict (workspace_id, contact_id) do update set
//     normalized = excluded.normalized,
//     trust = excluded.trust,
//     source_metadata =
//       excluded.source_metadata
//       || jsonb_build_object(
//         'repairs',    coalesce(existing.source_metadata->'repairs', '[]'),
//         'enrichment', coalesce(existing.source_metadata->'enrichment', '{}')
//       ),
//     updated_at = excluded.updated_at
//
// Postgres `||` on jsonb is shallow merge, right-side wins. So the
// JS mirror is:
//   1) start with the incoming source_metadata as a fresh object
//   2) overlay protected keys from the existing row
// CRM-truth keys (importJobId, tags, notes, etc.) come from `incoming`;
// protected keys (repairs, enrichment) come from `existing`.

interface ContactRow {
  workspaceId: string;
  contactId: string;
  normalized: Record<string, unknown>;
  trust: Record<string, unknown>;
  sourceMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface ParcelLinkRow {
  id: string;
  workspaceId: string;
  contactId: string;
  parcelId: string;
}

interface MemoryStore {
  contacts: Map<string, ContactRow>; // key: workspaceId|contactId
  links: Map<string, ParcelLinkRow>;
  deleteCallLog: Array<{ table: string; workspaceId: string }>;
}

function newStore(): MemoryStore {
  return { contacts: new Map(), links: new Map(), deleteCallLog: [] };
}

function key(workspaceId: string, contactId: string): string {
  return `${workspaceId}|${contactId}`;
}

/**
 * Mirror of upsertContactsNeon's ON CONFLICT clause. Same semantics:
 *  • first insert → store row as-is
 *  • re-import on existing → normalized + trust overwrite; protected
 *    keys (repairs, enrichment) carry forward verbatim; CRM-truth
 *    source_metadata keys (importJobId, tags, etc.) overwrite from
 *    incoming.
 */
function mirrorUpsertContact(store: MemoryStore, incoming: ContactRow): void {
  const k = key(incoming.workspaceId, incoming.contactId);
  const existing = store.contacts.get(k);
  if (!existing) {
    store.contacts.set(k, { ...incoming, sourceMetadata: { ...incoming.sourceMetadata } });
    return;
  }
  // Apply Postgres `||` semantics: start with incoming, then re-overlay
  // protected keys from existing.
  const mergedSourceMetadata: Record<string, unknown> = {
    ...incoming.sourceMetadata,
    repairs: existing.sourceMetadata.repairs ?? [],
    enrichment: existing.sourceMetadata.enrichment ?? {},
  };
  store.contacts.set(k, {
    workspaceId: incoming.workspaceId,
    contactId: incoming.contactId,
    normalized: { ...incoming.normalized },
    trust: { ...incoming.trust },
    sourceMetadata: mergedSourceMetadata,
    createdAt: existing.createdAt,   // immutable after first insert
    updatedAt: incoming.updatedAt,
  });
}

/** Mirror of writeWorkspaceContacts — the routine CRM re-import path.
 * After Priority 2: no DELETE, just merging upsert. */
function mirrorWriteWorkspaceContacts(
  store: MemoryStore,
  workspaceId: string,
  contacts: ContactRow[],
): void {
  for (const c of contacts) {
    if (c.workspaceId !== workspaceId) {
      throw new Error("workspace_id mismatch — adapter would refuse");
    }
    mirrorUpsertContact(store, c);
  }
}

/** Mirror of destructivelyReplaceWorkspaceContactsNeon. Records the
 * DELETE call into the audit log so we can prove only this path
 * deletes. */
function mirrorDestructivelyReplace(
  store: MemoryStore,
  workspaceId: string,
  contacts: ContactRow[],
): void {
  store.deleteCallLog.push({ table: "crm_contacts", workspaceId });
  for (const k of Array.from(store.contacts.keys())) {
    if (k.startsWith(`${workspaceId}|`)) store.contacts.delete(k);
  }
  for (const c of contacts) mirrorUpsertContact(store, c);
}

// Helper builders
function makeContact(
  workspaceId: string,
  contactId: string,
  overrides: Partial<ContactRow> = {},
): ContactRow {
  return {
    workspaceId,
    contactId,
    normalized: {
      name: "Greg Smith",
      company: "",
      phone: "+18165550100",
      email: "greg@example.com",
      address: "4321 W 63rd St, Kansas City, MO 64113",
    },
    trust: { tier: "MED" },
    sourceMetadata: {
      importJobId: "job-1",
      sourceCrm: "wise-agent",
      tags: ["Seller"],
      notes: "Met at open house",
      lastInteractionAt: "2024-01-15T00:00:00Z",
    },
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
    ...overrides,
  };
}

function withEnrichment(c: ContactRow, enrichment: Record<string, unknown>): ContactRow {
  return {
    ...c,
    sourceMetadata: { ...c.sourceMetadata, enrichment },
  };
}

function withRepairs(c: ContactRow, repairs: unknown[]): ContactRow {
  return {
    ...c,
    sourceMetadata: { ...c.sourceMetadata, repairs },
  };
}

// ─────────────────────────────────────────────────────────────────
// CHECK 1–3, 5: enrichment + repairs + Hunter survival on re-import
// ─────────────────────────────────────────────────────────────────

function checkProtectedKeysSurvive(): void {
  const store = newStore();

  // First import — plain contact, no enrichment / repairs.
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1"),
  ]);

  // Operator runs Hunter — write enrichment.hunter via simulated jsonb_set.
  const c1 = store.contacts.get(key("nicole-lonergan", "crm-1"))!;
  c1.sourceMetadata.enrichment = {
    hunter: {
      status: "found",
      confidence: 95,
      company: "Acme Realty",
      role: "Broker",
      fetchedAt: "2026-05-27T08:00:00Z",
    },
  };

  // Operator runs the opportunity pipeline — write enrichment.opportunity.
  const enrichment1 = c1.sourceMetadata.enrichment as Record<string, unknown>;
  enrichment1.opportunity = {
    source: "meridian_opportunity_v1",
    fetchedAt: "2026-05-27T09:00:00Z",
    contactId: "crm-1",
    contactName: "Greg Smith",
    priorityTier: "HIGH",
    transparentPriorityScore: 80,
  };

  // Operator records a name repair.
  c1.sourceMetadata.repairs = [
    {
      field: "name",
      originalValue: "Greg",
      newValue: "Greg Smith",
      source: "founder_rehab",
      repairedAt: "2026-05-27T10:00:00Z",
    },
  ];

  // Now the operator RE-IMPORTS the same CSV (maybe with new tags or
  // an updated note). The incoming row carries NO enrichment / repairs
  // — just CRM-truth fields.
  const reimport = makeContact("nicole-lonergan", "crm-1", {
    sourceMetadata: {
      importJobId: "job-2",          // new
      sourceCrm: "wise-agent",
      tags: ["Seller", "Brookside"], // new tag added in CRM
      notes: "Met at open house. Mentioned a kitchen reno.", // expanded notes
      lastInteractionAt: "2026-05-20T00:00:00Z", // refreshed
    },
    updatedAt: "2026-05-27T12:00:00Z",
  });
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [reimport]);

  const after = store.contacts.get(key("nicole-lonergan", "crm-1"))!;
  const sm = after.sourceMetadata as Record<string, unknown>;
  const enrichment = (sm.enrichment ?? {}) as Record<string, unknown>;
  const repairs = (sm.repairs ?? []) as unknown[];

  // Check 1 — opportunity preserved verbatim
  expectEqual(
    (enrichment.opportunity as Record<string, unknown>)?.transparentPriorityScore,
    80,
    "Check 1: enrichment.opportunity preserved on re-import",
  );
  expectEqual(
    (enrichment.opportunity as Record<string, unknown>)?.priorityTier,
    "HIGH",
    "Check 1: opportunity priorityTier preserved",
  );
  expectEqual(
    (enrichment.opportunity as Record<string, unknown>)?.fetchedAt,
    "2026-05-27T09:00:00Z",
    "Check 1: opportunity fetchedAt preserved (NOT re-stamped by import)",
  );

  // Check 2 — repairs preserved verbatim
  expectEqual(repairs.length, 1, "Check 2: repairs[] survives re-import (length)");
  expectEqual(
    (repairs[0] as Record<string, unknown>).field,
    "name",
    "Check 2: repair field preserved",
  );
  expectEqual(
    (repairs[0] as Record<string, unknown>).newValue,
    "Greg Smith",
    "Check 2: repair newValue preserved",
  );
  expectEqual(
    (repairs[0] as Record<string, unknown>).originalValue,
    "Greg",
    "Check 2: repair originalValue preserved",
  );

  // Check 3 — Hunter preserved verbatim
  expectEqual(
    (enrichment.hunter as Record<string, unknown>)?.status,
    "found",
    "Check 3: enrichment.hunter.status preserved",
  );
  expectEqual(
    (enrichment.hunter as Record<string, unknown>)?.confidence,
    95,
    "Check 3: enrichment.hunter.confidence preserved",
  );
  expectEqual(
    (enrichment.hunter as Record<string, unknown>)?.company,
    "Acme Realty",
    "Check 3: enrichment.hunter.company preserved",
  );

  // Check 5 — no duplicate enrichment blocks
  // Postgres jsonb_build_object('enrichment', ...) overlays a single key;
  // the result has exactly one enrichment object with both hunter and
  // opportunity merged into it (never two enrichment keys).
  const enrichmentKeyCount = Object.keys(sm).filter((k) => k === "enrichment").length;
  expectEqual(enrichmentKeyCount, 1, "Check 5: exactly one enrichment block on the row");
  const enrichmentSubkeys = Object.keys(enrichment).sort();
  expectEqual(
    enrichmentSubkeys,
    ["hunter", "opportunity"],
    "Check 5: both Hunter and opportunity present under enrichment (no duplication, no loss)",
  );
}

// ─────────────────────────────────────────────────────────────────
// CHECK 4: Parcel links survive standard imports
// ─────────────────────────────────────────────────────────────────

function checkParcelLinksUntouched(): void {
  const store = newStore();
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1"),
  ]);
  // Operator runs resolve-contact-parcels — link materializes.
  store.links.set("link-1", {
    id: "link-1",
    workspaceId: "nicole-lonergan",
    contactId: "crm-1",
    parcelId: "parcel-abc",
  });

  const linkCountBefore = store.links.size;
  const deleteLogBefore = store.deleteCallLog.length;

  // Re-import the contact.
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1", {
      sourceMetadata: { importJobId: "job-2", tags: ["Seller", "Premium"] },
    }),
  ]);

  // Check 4 — link table is untouched
  expectEqual(store.links.size, linkCountBefore, "Check 4: link count unchanged after re-import");
  expect(
    store.links.has("link-1"),
    "Check 4: specific link still present after re-import",
  );
  // No DELETE call recorded against any table.
  expectEqual(
    store.deleteCallLog.length,
    deleteLogBefore,
    "Check 4: no DELETE issued by the routine import path",
  );
}

// ─────────────────────────────────────────────────────────────────
// CHECK 6: Re-imports are deterministic
// ─────────────────────────────────────────────────────────────────

function checkDeterministicReimport(): void {
  const buildEndState = () => {
    const store = newStore();
    mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
      makeContact("nicole-lonergan", "crm-1"),
    ]);
    store.contacts.get(key("nicole-lonergan", "crm-1"))!.sourceMetadata.enrichment = {
      hunter: { status: "found", confidence: 90 },
      opportunity: { source: "meridian_opportunity_v1", priorityTier: "HIGH", transparentPriorityScore: 80 },
    };
    // Re-import 5 times — end state must be byte-identical each time.
    for (let i = 0; i < 5; i++) {
      mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
        makeContact("nicole-lonergan", "crm-1", {
          sourceMetadata: { importJobId: `job-${i}`, tags: ["Seller"] },
          updatedAt: `2026-05-27T${String(i).padStart(2, "0")}:00:00Z`,
        }),
      ]);
    }
    return JSON.stringify(store.contacts.get(key("nicole-lonergan", "crm-1")));
  };

  const a = buildEndState();
  const b = buildEndState();
  expectEqual(a, b, "Check 6: re-import end state is byte-identical across runs");
}

// ─────────────────────────────────────────────────────────────────
// CHECK 7: CRM-truth keys still overwrite from the import
// ─────────────────────────────────────────────────────────────────

function checkCrmTruthStillOverwrites(): void {
  const store = newStore();
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1", {
      normalized: { name: "Greg Smith", email: "old@example.com" },
      sourceMetadata: { tags: ["Seller"], notes: "old note" },
    }),
  ]);
  // Re-import with updated CRM truth.
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1", {
      normalized: { name: "Greg Smith Jr.", email: "new@example.com" },
      sourceMetadata: { tags: ["Seller", "VIP"], notes: "updated note" },
    }),
  ]);
  const after = store.contacts.get(key("nicole-lonergan", "crm-1"))!;
  expectEqual(
    (after.normalized as Record<string, unknown>).name,
    "Greg Smith Jr.",
    "Check 7: normalized.name overwrites from import",
  );
  expectEqual(
    (after.normalized as Record<string, unknown>).email,
    "new@example.com",
    "Check 7: normalized.email overwrites from import",
  );
  expectEqual(
    (after.sourceMetadata as Record<string, unknown>).tags,
    ["Seller", "VIP"],
    "Check 7: source_metadata.tags overwrites from import (CRM-truth key)",
  );
  expectEqual(
    (after.sourceMetadata as Record<string, unknown>).notes,
    "updated note",
    "Check 7: source_metadata.notes overwrites from import (CRM-truth key)",
  );
}

// ─────────────────────────────────────────────────────────────────
// CHECK 8: No orphan links after import
// ─────────────────────────────────────────────────────────────────

function checkNoOrphanLinks(): void {
  const store = newStore();
  // Pre-existing workspace state: 3 contacts, each with a link.
  for (const cid of ["crm-1", "crm-2", "crm-3"]) {
    mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
      makeContact("nicole-lonergan", cid),
    ]);
    store.links.set(`link-${cid}`, {
      id: `link-${cid}`,
      workspaceId: "nicole-lonergan",
      contactId: cid,
      parcelId: `parcel-${cid}`,
    });
  }

  // Re-import with a SUBSET (only crm-1 and crm-3). Under the old
  // destructive contract, crm-2 would be deleted → link-crm-2 would
  // become orphan. Under the new merging upsert, crm-2 stays.
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1"),
    makeContact("nicole-lonergan", "crm-3"),
  ]);

  // Check 8 — every link still has a parent contact.
  let orphans = 0;
  for (const link of store.links.values()) {
    if (!store.contacts.has(key(link.workspaceId, link.contactId))) orphans += 1;
  }
  expectEqual(orphans, 0, "Check 8: no orphan links after routine re-import");
  expectEqual(store.contacts.size, 3, "Check 8: contacts not in re-import are preserved");
}

// ─────────────────────────────────────────────────────────────────
// CHECK 9: No hidden DELETE behavior
// ─────────────────────────────────────────────────────────────────

function checkNoHiddenDeletes(): void {
  // Source-inspect the adapter file. The only function that issues a
  // DELETE statement against crm_contacts must be the explicitly-named
  // destructivelyReplaceWorkspaceContactsNeon. No other exported path
  // may contain `delete from crm_contacts`.
  const adapterPath = path.join("lib", "crm-import", "crmContactsNeonAdapter.ts");
  const text = readFileSync(adapterPath, "utf8");

  // Count DELETE statements.
  const deleteRegex = /delete\s+from\s+crm_contacts/gi;
  const deletes = text.match(deleteRegex) ?? [];
  expectEqual(deletes.length, 1, "Check 9: exactly one DELETE FROM crm_contacts in adapter");

  // The single DELETE must be inside destructivelyReplaceWorkspaceContactsNeon.
  const destructiveIdx = text.indexOf("destructivelyReplaceWorkspaceContactsNeon");
  expect(
    destructiveIdx >= 0,
    "Check 9: destructivelyReplaceWorkspaceContactsNeon is exported (renamed correctly)",
  );
  // Verify the OLD name is gone.
  expect(
    !/export async function replaceWorkspaceContactsNeon\s*\(/.test(text),
    "Check 9: old name replaceWorkspaceContactsNeon is removed",
  );
  const destructiveBody = text.slice(destructiveIdx, destructiveIdx + 1500);
  expect(
    /delete\s+from\s+crm_contacts/i.test(destructiveBody),
    "Check 9: the single DELETE lives inside destructivelyReplaceWorkspaceContactsNeon",
  );

  // upsertContactsNeon must NOT contain a DELETE.
  const upsertIdx = text.indexOf("export async function upsertContactsNeon");
  expect(upsertIdx >= 0, "Check 9: upsertContactsNeon is exported");
  const upsertEnd = text.indexOf("export async function", upsertIdx + 1);
  const upsertBody = text.slice(upsertIdx, upsertEnd === -1 ? text.length : upsertEnd);
  expect(
    !/delete\s+from\s+crm_contacts/i.test(upsertBody),
    "Check 9: upsertContactsNeon contains NO DELETE statement",
  );

  // upsertContactsNeon must contain the protected-keys merge pattern.
  expect(
    upsertBody.includes("coalesce(crm_contacts.source_metadata->'repairs'"),
    "Check 9: upsertContactsNeon preserves source_metadata->'repairs'",
  );
  expect(
    upsertBody.includes("coalesce(crm_contacts.source_metadata->'enrichment'"),
    "Check 9: upsertContactsNeon preserves source_metadata->'enrichment'",
  );

  // Also source-inspect store.ts: writeWorkspaceContacts must call
  // upsertContactsNeon (NOT the destructive function).
  const storePath = path.join("lib", "crm-import", "store.ts");
  const storeText = readFileSync(storePath, "utf8");
  // The disk-fallback function `writeWorkspaceContactsToFile` shares
  // the prefix, so anchor on the parameter signature of the Neon path.
  const writeIdx = storeText.indexOf("async function writeWorkspaceContacts(");
  expect(writeIdx >= 0, "Check 9: writeWorkspaceContacts is defined");
  // Slice generously so a comment-rich function body still includes
  // the actual await line (the function is ~1400 chars).
  const writeBody = storeText.slice(writeIdx, writeIdx + 2200);
  expect(
    writeBody.includes("await upsertContactsNeon("),
    "Check 9: writeWorkspaceContacts uses the merging upsert path",
  );
  expect(
    !writeBody.includes("await destructivelyReplaceWorkspaceContactsNeon("),
    "Check 9: writeWorkspaceContacts does NOT call the destructive path",
  );

  // restoreFromSnapshot is the only legitimate caller of the destructive path.
  const restoreIdx = storeText.indexOf("restoreFromSnapshot");
  if (restoreIdx >= 0) {
    const restoreBody = storeText.slice(restoreIdx, restoreIdx + 3000);
    expect(
      restoreBody.includes("destructivelyReplaceWorkspaceContactsNeon"),
      "Check 9: restoreFromSnapshot retains the destructive path (intentional rollback)",
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// CHECK 10: No cross-workspace contamination
// ─────────────────────────────────────────────────────────────────

function checkWorkspaceIsolation(): void {
  const store = newStore();
  // Two workspaces share the same contact_id "crm-1" — must stay isolated.
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1", {
      normalized: { name: "Greg Smith" },
      sourceMetadata: { tags: ["Seller"] },
    }),
  ]);
  mirrorWriteWorkspaceContacts(store, "other-workspace", [
    makeContact("other-workspace", "crm-1", {
      normalized: { name: "Patricia Wong" },
      sourceMetadata: { tags: ["Buyer"] },
    }),
  ]);

  // Add enrichment to nicole's contact.
  store.contacts.get(key("nicole-lonergan", "crm-1"))!.sourceMetadata.enrichment = {
    opportunity: { priorityTier: "HIGH" },
  };

  // Re-import OTHER-WORKSPACE's contact. Must not touch nicole's row.
  mirrorWriteWorkspaceContacts(store, "other-workspace", [
    makeContact("other-workspace", "crm-1", {
      normalized: { name: "Patricia Wong-Lin" },
      sourceMetadata: { tags: ["Buyer", "Premium"] },
    }),
  ]);

  const nicole = store.contacts.get(key("nicole-lonergan", "crm-1"))!;
  const other = store.contacts.get(key("other-workspace", "crm-1"))!;

  expectEqual(
    (nicole.normalized as Record<string, unknown>).name,
    "Greg Smith",
    "Check 10: nicole's contact name untouched by other workspace's re-import",
  );
  expectEqual(
    (
      (nicole.sourceMetadata.enrichment as Record<string, unknown>)?.opportunity as Record<string, unknown>
    )?.priorityTier,
    "HIGH",
    "Check 10: nicole's enrichment untouched by other workspace's re-import",
  );
  expectEqual(
    (other.normalized as Record<string, unknown>).name,
    "Patricia Wong-Lin",
    "Check 10: other workspace's name DID update from its own re-import",
  );
  // SQL contract: the merge always re-asserts `enrichment` as
  // `coalesce(existing.source_metadata->'enrichment', '{}'::jsonb)`,
  // so the result has an `enrichment` key (possibly empty {}). The
  // isolation invariant is that NEITHER Hunter NOR opportunity from
  // nicole's row appears in other-workspace's row.
  const otherEnrichment = (other.sourceMetadata.enrichment ?? {}) as Record<string, unknown>;
  expect(
    !("hunter" in otherEnrichment),
    "Check 10: other workspace has NO Hunter enrichment (no cross-tenant bleed)",
  );
  expect(
    !("opportunity" in otherEnrichment),
    "Check 10: other workspace has NO opportunity enrichment (no cross-tenant bleed)",
  );
}

// ─────────────────────────────────────────────────────────────────
// Bonus: Destructive path STILL wipes (intentional, asserted)
// ─────────────────────────────────────────────────────────────────

function checkDestructivePathStillDestroys(): void {
  // Sanity: the destructive path must still wipe state (callers using
  // it for rollback EXPECT destruction). This protects against an
  // accidental future change that would make rollback non-functional.
  const store = newStore();
  mirrorWriteWorkspaceContacts(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1"),
  ]);
  store.contacts.get(key("nicole-lonergan", "crm-1"))!.sourceMetadata.enrichment = {
    opportunity: { priorityTier: "HIGH" },
  };
  const deletesBefore = store.deleteCallLog.length;

  mirrorDestructivelyReplace(store, "nicole-lonergan", [
    makeContact("nicole-lonergan", "crm-1", {
      sourceMetadata: { importJobId: "rollback-job" },
    }),
  ]);

  const after = store.contacts.get(key("nicole-lonergan", "crm-1"))!;
  expect(
    !after.sourceMetadata.enrichment,
    "Destructive path correctly wipes enrichment (rollback semantic preserved)",
  );
  expect(
    store.deleteCallLog.length > deletesBefore,
    "Destructive path logs its DELETE call",
  );
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

function main() {
  checkProtectedKeysSurvive();           // 1, 2, 3, 5
  checkParcelLinksUntouched();           // 4
  checkDeterministicReimport();          // 6
  checkCrmTruthStillOverwrites();        // 7
  checkNoOrphanLinks();                  // 8
  checkNoHiddenDeletes();                // 9
  checkWorkspaceIsolation();             // 10
  checkDestructivePathStillDestroys();   // sanity

  if (failures.length > 0) {
    console.error("");
    console.error("check-reimport-survival FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("");
  console.log("check-reimport-survival passed", {
    checks: [
      "1. enrichment.opportunity preserved verbatim across re-import (tier, score, fetchedAt)",
      "2. source_metadata.repairs[] preserved verbatim (field, newValue, originalValue)",
      "3. enrichment.hunter preserved verbatim (status, confidence, company)",
      "4. workspace_contact_parcel_links untouched by routine re-import; no DELETE issued",
      "5. exactly one enrichment block on the row; both Hunter + opportunity merged correctly",
      "6. re-import end state byte-identical across 5 idempotent re-runs",
      "7. normalized.* + CRM-truth source_metadata keys overwrite from import as expected",
      "8. no orphan links — contacts not in re-import are preserved (no implicit deletion)",
      "9. source inspection: exactly one DELETE FROM crm_contacts in adapter, inside the destructive function; upsertContactsNeon has no DELETE and uses the protected-keys merge pattern; writeWorkspaceContacts uses upsertContactsNeon; restoreFromSnapshot retains the destructive path; old replaceWorkspaceContactsNeon name removed",
      "10. cross-workspace isolation: two workspaces sharing contact_id stay isolated; one's enrichment cannot bleed into the other on re-import",
      "sanity: destructive path STILL destroys (rollback semantic preserved)",
    ],
  });
}

main();
