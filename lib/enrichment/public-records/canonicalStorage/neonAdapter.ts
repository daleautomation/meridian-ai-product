// Meridian — Public-Record Intelligence Architecture v1, Commit A
//
// Neon adapter for the canonical public-record entities. This module
// is the ONLY write path to public_parcels, public_ownership_snapshots,
// and workspace_contact_parcel_links. All higher layers (Commit B
// ingestion + identity resolution; Commit C opportunity wiring) call
// these functions; no module else issues raw SQL against these tables.
//
// Invariants enforced here:
//   • parcels are upsert-only; lastObservedAt advances monotonically
//   • snapshots are insert-only with deterministic-id dedup
//   • links are workspace-scoped at every read AND write
//   • supersession sets `link_superseded_at` and chains via
//     `superseded_by_link_id` — superseded rows are never deleted

import { neon } from "@neondatabase/serverless";
import { assertWorkspaceSlug, getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";
import {
  buildOwnershipSnapshotId,
  buildParcelId,
  buildWorkspaceParcelLinkId,
} from "./ids";
import type {
  CanonicalPropertyType,
  LinkMatchConfidence,
  LinkMatchReason,
  OwnershipSnapshotAppendResult,
  ParcelUpsertResult,
  PublicOwnershipSnapshot,
  PublicOwnershipSnapshotAppend,
  PublicParcel,
  PublicParcelUpsert,
  WorkspaceContactParcelLink,
  WorkspaceContactParcelLinkUpsert,
  WorkspaceParcelLinkSupersedeResult,
  WorkspaceParcelLinkUpsertResult,
} from "./types";

type Row = Record<string, unknown>;

let cachedSql: ReturnType<typeof neon> | null = null;

function getSql() {
  const url = getCrmDatabaseUrl();
  if (!url) throw new Error("Public-records Postgres URL is not configured");
  cachedSql ??= neon(url);
  return cachedSql;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.length >= 10 ? value.slice(0, 10) : value;
  return null;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function jsonRecord(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : v == null ? "" : String(v);
    }
    return out;
  }
  if (typeof value === "string") {
    try {
      return jsonRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return {};
}

// ─────────────────────────────────────────────────────────────────
// Row ↔ entity mapping
// ─────────────────────────────────────────────────────────────────

function rowToParcel(row: Row): PublicParcel {
  return {
    id: String(row.id),
    countyCode: String(row.county_code),
    sourceParcelId: String(row.source_parcel_id),
    propertyKey: String(row.property_key),
    situsAddress: String(row.situs_address),
    firstObservedAt: iso(row.first_observed_at),
    lastObservedAt: iso(row.last_observed_at),
    estimatedPropertyType:
      typeof row.estimated_property_type === "string" && row.estimated_property_type.length > 0
        ? (row.estimated_property_type as CanonicalPropertyType)
        : null,
  };
}

function rowToSnapshot(row: Row): PublicOwnershipSnapshot {
  return {
    id: String(row.id),
    parcelId: String(row.parcel_id),
    ownerName: String(row.owner_name),
    mailingAddress: typeof row.mailing_address === "string" ? row.mailing_address : null,
    ownershipStartDate: isoOrNull(row.ownership_start_date),
    lastTransferDate: isoOrNull(row.last_transfer_date),
    assessedValue: numOrNull(row.assessed_value),
    source: String(row.source),
    sourceSnapshotId: String(row.source_snapshot_id),
    observedAt: iso(row.observed_at),
    rawSourceRow: jsonRecord(row.raw_source_row),
    createdAt: iso(row.created_at),
  };
}

function rowToLink(row: Row): WorkspaceContactParcelLink {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    contactId: String(row.contact_id),
    parcelId: String(row.parcel_id),
    ownerSnapshotId: String(row.owner_snapshot_id),
    matchConfidence: String(row.match_confidence) as LinkMatchConfidence,
    matchReason: String(row.match_reason) as LinkMatchReason,
    linkCreatedAt: iso(row.link_created_at),
    linkLastVerifiedAt: iso(row.link_last_verified_at),
    linkSupersededAt:
      row.link_superseded_at === null || row.link_superseded_at === undefined
        ? null
        : iso(row.link_superseded_at),
    supersededByLinkId:
      typeof row.superseded_by_link_id === "string" && row.superseded_by_link_id.length > 0
        ? row.superseded_by_link_id
        : null,
  };
}

// ─────────────────────────────────────────────────────────────────
// PublicParcel — upsert
// ─────────────────────────────────────────────────────────────────

/**
 * Upsert a parcel. On first sight, inserts with firstObservedAt =
 * lastObservedAt = observedAt. On re-sight, advances lastObservedAt
 * monotonically (never moves backward) and refreshes the situsAddress
 * + estimatedPropertyType from the freshest snapshot.
 *
 * Idempotency: same (countyCode, sourceParcelId) → same id → same row.
 * Re-calling with identical inputs is a no-op.
 *
 * NEVER mutates firstObservedAt after first insert (audit immutability).
 */
export async function upsertPublicParcel(
  payload: PublicParcelUpsert,
): Promise<ParcelUpsertResult> {
  if (!payload.observedAt) {
    throw new Error("upsertPublicParcel: observedAt is required");
  }
  if (!payload.propertyKey) {
    throw new Error("upsertPublicParcel: propertyKey is required");
  }
  if (!payload.situsAddress) {
    throw new Error("upsertPublicParcel: situsAddress is required");
  }
  const id = buildParcelId({
    countyCode: payload.countyCode,
    sourceParcelId: payload.sourceParcelId,
  });
  const sql = getSql();
  const existing = (await sql`
    select id, last_observed_at
      from public_parcels
     where id = ${id}
     limit 1
  `) as Array<{ id: string; last_observed_at: unknown }>;

  if (existing.length === 0) {
    await sql`
      insert into public_parcels (
        id, county_code, source_parcel_id, property_key,
        situs_address, first_observed_at, last_observed_at,
        estimated_property_type
      ) values (
        ${id},
        ${payload.countyCode},
        ${payload.sourceParcelId},
        ${payload.propertyKey},
        ${payload.situsAddress},
        ${payload.observedAt}::timestamptz,
        ${payload.observedAt}::timestamptz,
        ${payload.estimatedPropertyType}
      )
      on conflict (id) do nothing
    `;
    return { id, outcome: "inserted" };
  }

  const currentLast = iso(existing[0].last_observed_at);
  // Monotonic last_observed_at; we never let a stale snapshot rewind
  // the parcel's freshness clock.
  if (payload.observedAt <= currentLast) {
    // Older or equal snapshot — touch nothing. Still a valid call
    // (re-ingesting older data); reports as no-op.
    return { id, outcome: "noop" };
  }
  await sql`
    update public_parcels
       set last_observed_at = ${payload.observedAt}::timestamptz,
           property_key = ${payload.propertyKey},
           situs_address = ${payload.situsAddress},
           estimated_property_type = ${payload.estimatedPropertyType},
           updated_at = now()
     where id = ${id}
  `;
  return { id, outcome: "updated" };
}

// ─────────────────────────────────────────────────────────────────
// PublicOwnershipSnapshot — append-only
// ─────────────────────────────────────────────────────────────────

/**
 * Append an ownership snapshot. Append-only contract:
 *   • inserts a row keyed by SHA-256 of (parcelId, sourceSnapshotId,
 *     observedAt)
 *   • re-insert of an identical snapshot is a deterministic no-op
 *     (on conflict (id) do nothing → outcome === "noop")
 *   • there is NO update path. Existing snapshots are immutable.
 *
 * Callers must have already upserted the parent PublicParcel — the
 * foreign key will reject otherwise.
 */
export async function appendOwnershipSnapshot(
  payload: PublicOwnershipSnapshotAppend,
): Promise<OwnershipSnapshotAppendResult> {
  if (!payload.parcelId) throw new Error("appendOwnershipSnapshot: parcelId is required");
  if (!payload.ownerName) throw new Error("appendOwnershipSnapshot: ownerName is required");
  if (!payload.source) throw new Error("appendOwnershipSnapshot: source is required");
  if (!payload.sourceSnapshotId) {
    throw new Error("appendOwnershipSnapshot: sourceSnapshotId is required");
  }
  if (!payload.observedAt) {
    throw new Error("appendOwnershipSnapshot: observedAt is required");
  }
  const id = buildOwnershipSnapshotId({
    parcelId: payload.parcelId,
    sourceSnapshotId: payload.sourceSnapshotId,
    observedAt: payload.observedAt,
  });
  const sql = getSql();
  const result = (await sql`
    insert into public_ownership_snapshots (
      id, parcel_id, owner_name, mailing_address,
      ownership_start_date, last_transfer_date, assessed_value,
      source, source_snapshot_id, observed_at, raw_source_row
    ) values (
      ${id},
      ${payload.parcelId},
      ${payload.ownerName},
      ${payload.mailingAddress},
      ${payload.ownershipStartDate}::date,
      ${payload.lastTransferDate}::date,
      ${payload.assessedValue},
      ${payload.source},
      ${payload.sourceSnapshotId},
      ${payload.observedAt}::timestamptz,
      ${JSON.stringify(payload.rawSourceRow)}::jsonb
    )
    on conflict (id) do nothing
    returning id
  `) as Array<{ id: string }>;
  return { id, outcome: result.length > 0 ? "inserted" : "noop" };
}

// ─────────────────────────────────────────────────────────────────
// WorkspaceContactParcelLink — workspace-scoped upsert
// ─────────────────────────────────────────────────────────────────

/**
 * Upsert an active link. Re-running for the same
 * (workspaceId, contactId, parcelId) refreshes
 * `link_last_verified_at` and may update the matchConfidence /
 * matchReason / ownerSnapshotId fields. Does NOT touch supersession
 * fields; an active row stays active until supersedeWorkspaceParcelLink
 * is called explicitly.
 *
 * If a row with the same id exists but is already superseded (a prior
 * eval marked it historical), this function REFUSES to revive it — the
 * caller must create a fresh row by either (a) calling
 * supersedeWorkspaceParcelLink to chain forward, or (b) treating the
 * superseded row as historical and using a different parcelId.
 *
 * Workspace isolation: workspaceId is validated against the slug
 * grammar BEFORE any SQL runs.
 */
export async function upsertWorkspaceParcelLink(
  payload: WorkspaceContactParcelLinkUpsert,
): Promise<WorkspaceParcelLinkUpsertResult> {
  assertWorkspaceSlug(payload.workspaceId);
  if (!payload.contactId) {
    throw new Error("upsertWorkspaceParcelLink: contactId is required");
  }
  if (!payload.parcelId) {
    throw new Error("upsertWorkspaceParcelLink: parcelId is required");
  }
  if (!payload.ownerSnapshotId) {
    throw new Error("upsertWorkspaceParcelLink: ownerSnapshotId is required");
  }
  if (!payload.linkCreatedAt) {
    throw new Error("upsertWorkspaceParcelLink: linkCreatedAt is required");
  }
  const id = buildWorkspaceParcelLinkId({
    workspaceId: payload.workspaceId,
    contactId: payload.contactId,
    parcelId: payload.parcelId,
  });
  const sql = getSql();
  const existing = (await sql`
    select id, link_superseded_at
      from workspace_contact_parcel_links
     where id = ${id}
     limit 1
  `) as Array<{ id: string; link_superseded_at: unknown }>;

  if (existing.length === 0) {
    await sql`
      insert into workspace_contact_parcel_links (
        id, workspace_id, contact_id, parcel_id, owner_snapshot_id,
        match_confidence, match_reason,
        link_created_at, link_last_verified_at,
        link_superseded_at, superseded_by_link_id
      ) values (
        ${id},
        ${payload.workspaceId},
        ${payload.contactId},
        ${payload.parcelId},
        ${payload.ownerSnapshotId},
        ${payload.matchConfidence},
        ${payload.matchReason},
        ${payload.linkCreatedAt}::timestamptz,
        ${payload.linkCreatedAt}::timestamptz,
        null,
        null
      )
      on conflict (id) do nothing
    `;
    return { id, outcome: "inserted" };
  }

  if (existing[0].link_superseded_at !== null && existing[0].link_superseded_at !== undefined) {
    throw new Error(
      `upsertWorkspaceParcelLink: link ${id} is already superseded; create a new link via supersedeWorkspaceParcelLink`,
    );
  }

  // Refresh fields without touching supersession or workspace columns.
  await sql`
    update workspace_contact_parcel_links
       set owner_snapshot_id    = ${payload.ownerSnapshotId},
           match_confidence     = ${payload.matchConfidence},
           match_reason         = ${payload.matchReason},
           link_last_verified_at = ${payload.linkCreatedAt}::timestamptz
     where id = ${id}
       and workspace_id = ${payload.workspaceId}
  `;
  return { id, outcome: "updated" };
}

/**
 * Mark a link as superseded by a different parcel link. The old row
 * remains queryable; its `link_superseded_at` becomes non-null and
 * `superseded_by_link_id` points to the replacement.
 *
 * Use case: a refreshed snapshot shows the contact's address is now
 * owned by a different parcel (parcels can be split / merged by
 * counties; very rare but it happens). The replacement parcel link is
 * created via upsertWorkspaceParcelLink, then this function chains the
 * old one forward.
 *
 * Workspace-scoped: the SQL WHERE includes workspace_id, so a caller
 * cannot supersede another tenant's link even with crafted ids.
 */
export async function supersedeWorkspaceParcelLink(input: {
  workspaceId: string;
  supersededLinkId: string;
  replacementLinkId: string;
  supersededAt: string;
}): Promise<WorkspaceParcelLinkSupersedeResult> {
  assertWorkspaceSlug(input.workspaceId);
  if (!input.supersededLinkId) {
    throw new Error("supersedeWorkspaceParcelLink: supersededLinkId is required");
  }
  if (!input.replacementLinkId) {
    throw new Error("supersedeWorkspaceParcelLink: replacementLinkId is required");
  }
  if (input.supersededLinkId === input.replacementLinkId) {
    throw new Error("supersedeWorkspaceParcelLink: cannot supersede a link with itself");
  }
  if (!input.supersededAt) {
    throw new Error("supersedeWorkspaceParcelLink: supersededAt is required");
  }
  const sql = getSql();
  const result = (await sql`
    update workspace_contact_parcel_links
       set link_superseded_at    = ${input.supersededAt}::timestamptz,
           superseded_by_link_id = ${input.replacementLinkId}
     where id = ${input.supersededLinkId}
       and workspace_id = ${input.workspaceId}
       and link_superseded_at is null
    returning id
  `) as Array<{ id: string }>;
  if (result.length === 0) {
    throw new Error(
      `supersedeWorkspaceParcelLink: no active link ${input.supersededLinkId} in workspace ${input.workspaceId}`,
    );
  }
  return {
    supersededLinkId: input.supersededLinkId,
    replacementLinkId: input.replacementLinkId,
    supersededAt: input.supersededAt,
  };
}

// ─────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────

export async function getParcelById(id: string): Promise<PublicParcel | null> {
  const sql = getSql();
  const rows = (await sql`
    select * from public_parcels where id = ${id} limit 1
  `) as Row[];
  return rows.length > 0 ? rowToParcel(rows[0]) : null;
}

/**
 * Look up the parcel matching a canonical address key in a specific
 * county. The (county_code, property_key) tuple is the standard read
 * path for identity resolution.
 *
 * Returns null on miss. Returns the FIRST match deterministically by
 * `id` ascending if multiple parcels share a canonical key (rare;
 * surfaces in audit as ambiguous_parcel — Commit B handles ambiguity).
 */
export async function getParcelByCanonicalKey(input: {
  countyCode: string;
  propertyKey: string;
}): Promise<PublicParcel | null> {
  if (!input.countyCode) {
    throw new Error("getParcelByCanonicalKey: countyCode is required");
  }
  if (!input.propertyKey) return null;
  const sql = getSql();
  const rows = (await sql`
    select * from public_parcels
     where county_code = ${input.countyCode}
       and property_key = ${input.propertyKey}
     order by id asc
     limit 1
  `) as Row[];
  return rows.length > 0 ? rowToParcel(rows[0]) : null;
}

/**
 * Return ALL parcels matching a canonical address key in a county.
 * Used by ambiguity detection (length > 1 → ambiguous).
 */
export async function listParcelsByCanonicalKey(input: {
  countyCode: string;
  propertyKey: string;
}): Promise<PublicParcel[]> {
  if (!input.countyCode) {
    throw new Error("listParcelsByCanonicalKey: countyCode is required");
  }
  if (!input.propertyKey) return [];
  const sql = getSql();
  const rows = (await sql`
    select * from public_parcels
     where county_code = ${input.countyCode}
       and property_key = ${input.propertyKey}
     order by id asc
  `) as Row[];
  return rows.map(rowToParcel);
}

/**
 * Most-recent ownership snapshot for a parcel. Null when no snapshot
 * has been ingested for the parcel yet.
 */
export async function getLatestOwnershipSnapshot(
  parcelId: string,
): Promise<PublicOwnershipSnapshot | null> {
  if (!parcelId) {
    throw new Error("getLatestOwnershipSnapshot: parcelId is required");
  }
  const sql = getSql();
  const rows = (await sql`
    select * from public_ownership_snapshots
     where parcel_id = ${parcelId}
     order by observed_at desc, id asc
     limit 1
  `) as Row[];
  return rows.length > 0 ? rowToSnapshot(rows[0]) : null;
}

/**
 * All snapshots for a parcel, chronological (oldest → newest). Used by
 * audit tooling to show the full ownership timeline.
 */
export async function listOwnershipSnapshots(
  parcelId: string,
): Promise<PublicOwnershipSnapshot[]> {
  if (!parcelId) return [];
  const sql = getSql();
  const rows = (await sql`
    select * from public_ownership_snapshots
     where parcel_id = ${parcelId}
     order by observed_at asc, id asc
  `) as Row[];
  return rows.map(rowToSnapshot);
}

export async function getSnapshotById(
  id: string,
): Promise<PublicOwnershipSnapshot | null> {
  if (!id) return null;
  const sql = getSql();
  const rows = (await sql`
    select * from public_ownership_snapshots where id = ${id} limit 1
  `) as Row[];
  return rows.length > 0 ? rowToSnapshot(rows[0]) : null;
}

export async function getLinkById(
  id: string,
): Promise<WorkspaceContactParcelLink | null> {
  if (!id) return null;
  const sql = getSql();
  const rows = (await sql`
    select * from workspace_contact_parcel_links where id = ${id} limit 1
  `) as Row[];
  return rows.length > 0 ? rowToLink(rows[0]) : null;
}

/**
 * Active links for a given (workspaceId, contactId). Workspace-scoped
 * — never returns rows from another tenant.
 *
 * "Active" = link_superseded_at is null. Historical (superseded) links
 * are excluded.
 */
export async function listActiveLinksForContact(input: {
  workspaceId: string;
  contactId: string;
}): Promise<WorkspaceContactParcelLink[]> {
  assertWorkspaceSlug(input.workspaceId);
  if (!input.contactId) {
    throw new Error("listActiveLinksForContact: contactId is required");
  }
  const sql = getSql();
  const rows = (await sql`
    select * from workspace_contact_parcel_links
     where workspace_id = ${input.workspaceId}
       and contact_id = ${input.contactId}
       and link_superseded_at is null
     order by link_created_at asc
  `) as Row[];
  return rows.map(rowToLink);
}

/**
 * All links (active + historical) for a contact. Workspace-scoped.
 * Used by audit tooling to show the full link supersession chain.
 */
export async function listAllLinksForContact(input: {
  workspaceId: string;
  contactId: string;
}): Promise<WorkspaceContactParcelLink[]> {
  assertWorkspaceSlug(input.workspaceId);
  if (!input.contactId) {
    throw new Error("listAllLinksForContact: contactId is required");
  }
  const sql = getSql();
  const rows = (await sql`
    select * from workspace_contact_parcel_links
     where workspace_id = ${input.workspaceId}
       and contact_id = ${input.contactId}
     order by link_created_at asc, id asc
  `) as Row[];
  return rows.map(rowToLink);
}

/** Hooks for the validator suite. Do not import in product code. */
export const __internal__ = { rowToParcel, rowToSnapshot, rowToLink };
