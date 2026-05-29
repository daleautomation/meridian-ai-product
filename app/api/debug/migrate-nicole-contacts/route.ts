// Meridian — /api/debug/migrate-nicole-contacts
//
// ────────────────────────────────────────────────────────────────────
// ⚠️  DEBUG / ONE-TIME MIGRATION ENDPOINT — NOT FOR ROUTINE IMPORTS  ⚠️
// ────────────────────────────────────────────────────────────────────
//
// This endpoint accepts pre-formed `CrmContactRecord[]` objects from a
// stored JSON file and writes them straight through `upsertContacts`.
// It DOES NOT call `normalize.ts`. It DOES NOT detect column mappings.
// It DOES NOT run the assembly logic that produces full names from
// First/Last components or canonical addresses from Street/City/State/
// PostalCode components.
//
// On 2026-05-28 a re-import via this path produced the corpus shape:
//   • 1 surname out of 130 contacts
//   • 7 canonical addresses out of 130 contacts
// That outcome was a confirmation that this endpoint reads PRE-
// NORMALIZED data — it is a migration tool for promoting the file-
// storage-era JSON corpus into Neon, not a CRM-import path.
//
// Routine CRM imports MUST use the canonical pipeline:
//   POST /api/crm-import/preview   ← runs normalize.ts on the raw CSV
//   POST /api/crm-import/execute   ← persists via the JSONB-merging upsert
//
// This endpoint requires an explicit `acknowledge_pre_normalized: true`
// flag in the request body to prevent accidental routine use.
//
// Why an endpoint vs a script:
//   • Vercel runtime is the only process that holds the production
//     DATABASE_URL — running a CLI from a developer laptop only works
//     if .env.local mirrors production exactly. The endpoint lets an
//     admin push from any client (curl) into whatever DATABASE_URL the
//     LIVE runtime is currently using.
//   • Side-by-side with /api/debug/runtime-fingerprint the operator can
//     confirm exactly where the rows landed.
//
// Curl shape:
//   curl -X POST https://meridianai.work/api/debug/migrate-nicole-contacts \
//     --cookie "meridian_session=<dylan's cookie>" \
//     -H 'Content-Type: application/json' \
//     --data @data/crm-contacts/nicole-lonergan.json
//
// The body must be `{ contacts: CrmContactRecord[] }`. Every contact's
// `workspaceId` must equal `"nicole-lonergan"` — the endpoint refuses
// to migrate anything else, to prevent cross-workspace leakage from
// a typo or wrong file.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { applyAuthNoStoreHeaders } from "@/lib/auth/sessionCleanup";
import {
  getWorkspaceContactCounts,
  upsertContacts,
} from "@/lib/crm-import/store";
import {
  describeRuntimeFingerprint,
  logRuntimeBannerOnce,
} from "@/lib/diagnostics/runtimeFingerprint";
import { isAdminOperator } from "@/lib/workspaceAccess";
import type { CrmContactRecord } from "@/lib/crm-import/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const ENFORCED_WORKSPACE = "nicole-lonergan";

function isStringField(value: unknown): value is string {
  return typeof value === "string";
}

function isContactRecord(value: unknown): value is CrmContactRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    isStringField(r.id) &&
    isStringField(r.workspaceId) &&
    isStringField(r.name) &&
    isStringField(r.createdAt) &&
    isStringField(r.updatedAt) &&
    Array.isArray(r.tags) &&
    typeof r.dataTrust === "object"
  );
}

export async function POST(req: Request) {
  logRuntimeBannerOnce();
  const user = await getSession();
  if (!user) {
    return applyAuthNoStoreHeaders(
      NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    );
  }
  if (!isAdminOperator(user)) {
    return applyAuthNoStoreHeaders(
      NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 }),
    );
  }

  const fingerprint = describeRuntimeFingerprint();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return applyAuthNoStoreHeaders(
      NextResponse.json({ ok: false, error: "Invalid JSON body", fingerprint }, { status: 400 }),
    );
  }

  const bodyContacts =
    body && typeof body === "object" && Array.isArray((body as { contacts?: unknown }).contacts)
      ? ((body as { contacts: unknown[] }).contacts as unknown[])
      : null;

  if (!bodyContacts) {
    return applyAuthNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          error: "Body must be { contacts: CrmContactRecord[] }",
          fingerprint,
        },
        { status: 400 },
      ),
    );
  }

  // ── DEBUG-ONLY GUARD ─────────────────────────────────────────────
  // This endpoint reads pre-normalized contacts and bypasses
  // normalize.ts. It is NOT a routine CRM import path. The caller MUST
  // explicitly acknowledge that the data they are POSTing has already
  // been normalized — otherwise the call is rejected and the operator
  // is redirected to the canonical /api/crm-import/preview path.
  const ack =
    body && typeof body === "object"
      ? (body as { acknowledge_pre_normalized?: unknown }).acknowledge_pre_normalized
      : undefined;
  if (ack !== true) {
    return applyAuthNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          error:
            "This is a DEBUG migration endpoint that bypasses normalize.ts. " +
            "Routine CRM imports must use /api/crm-import/preview followed by " +
            "/api/crm-import/execute. If you are intentionally promoting the " +
            "file-storage-era JSON corpus into Neon, add " +
            '`"acknowledge_pre_normalized": true` to the request body.',
          fingerprint,
          canonicalImportPath: {
            preview: "/api/crm-import/preview",
            execute: "/api/crm-import/execute",
          },
        },
        { status: 400 },
      ),
    );
  }

  const validContacts: CrmContactRecord[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  for (let i = 0; i < bodyContacts.length; i++) {
    const c = bodyContacts[i];
    if (!isContactRecord(c)) {
      rejected.push({ index: i, reason: "not a well-formed CrmContactRecord" });
      continue;
    }
    if (c.workspaceId !== ENFORCED_WORKSPACE) {
      rejected.push({
        index: i,
        reason: `workspaceId="${c.workspaceId}" must equal "${ENFORCED_WORKSPACE}"`,
      });
      continue;
    }
    validContacts.push(c);
  }

  if (validContacts.length === 0) {
    return applyAuthNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          error: "No valid contacts to migrate",
          fingerprint,
          rejected,
        },
        { status: 400 },
      ),
    );
  }

  let upsertResult;
  try {
    upsertResult = await upsertContacts(validContacts);
  } catch (err) {
    return applyAuthNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          fingerprint,
          rejected,
        },
        { status: 500 },
      ),
    );
  }

  let contactCountAfterMigration: number | null = null;
  let readBackError: string | null = null;
  try {
    const counts = await getWorkspaceContactCounts([ENFORCED_WORKSPACE]);
    const entry = counts.workspaces.find((w) => w.workspaceId === ENFORCED_WORKSPACE);
    contactCountAfterMigration = entry?.count ?? null;
    readBackError = entry?.error ?? null;
  } catch (err) {
    readBackError = err instanceof Error ? err.message : String(err);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[debug/migrate-nicole-contacts] commit=${fingerprint.commitShort} ` +
      `dbHost=${fingerprint.dbHost ?? "(none)"} ` +
      `received=${bodyContacts.length} valid=${validContacts.length} ` +
      `rejected=${rejected.length} inserted=${upsertResult.inserted} ` +
      `updated=${upsertResult.updated} ` +
      `contactCountAfterMigration=${contactCountAfterMigration ?? "(error)"} ` +
      `readBackError=${readBackError ?? "none"}`,
  );

  return applyAuthNoStoreHeaders(
    NextResponse.json({
      ok: true,
      fingerprint,
      received: bodyContacts.length,
      valid: validContacts.length,
      rejected,
      inserted: upsertResult.inserted,
      updated: upsertResult.updated,
      contactCountAfterMigration,
      readBackError,
    }),
  );
}
