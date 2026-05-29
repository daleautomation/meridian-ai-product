// Meridian — Public-Record Intelligence Architecture v1, Commit A
//
// Idempotent schema bootstrap for the three canonical tables:
//   • public_parcels                  (workspace-agnostic)
//   • public_ownership_snapshots      (workspace-agnostic, append-only)
//   • workspace_contact_parcel_links  (workspace-scoped)
//
// Mirrors the pattern from initCrmContactsSchema.ts: a single module-
// scoped flag avoids re-running DDL on every adapter call. Re-runs are
// no-ops due to `if not exists`.
//
// Constitution §6.11 (workspace isolation) — only the link table
// carries a workspace_id. Parcels + snapshots are derived from public
// records and are explicitly not tenant data.

import { neon } from "@neondatabase/serverless";
import { getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";

let schemaReady: boolean | null = null;

export async function ensurePublicRecordsSchema(): Promise<void> {
  if (schemaReady) return;
  const url = getCrmDatabaseUrl();
  if (!url) {
    throw new Error("Public-records Postgres URL is not configured");
  }

  const sql = neon(url);

  // ── public_parcels ────────────────────────────────────────────
  await sql`
    create table if not exists public_parcels (
      id                        text primary key,
      county_code               text not null,
      source_parcel_id          text not null,
      property_key              text not null,
      situs_address             text not null,
      first_observed_at         timestamptz not null,
      last_observed_at          timestamptz not null,
      estimated_property_type   text,
      created_at                timestamptz not null default now(),
      updated_at                timestamptz not null default now()
    )
  `;
  // Natural-key uniqueness — defends against id-truncation collisions
  // and makes ON CONFLICT (county_code, source_parcel_id) usable.
  await sql`
    create unique index if not exists public_parcels_natural_key_uq
      on public_parcels (county_code, source_parcel_id)
  `;
  // Canonical-address lookup (the CRM × MLS × county join axis).
  await sql`
    create index if not exists public_parcels_property_key_idx
      on public_parcels (property_key)
  `;
  await sql`
    create index if not exists public_parcels_county_idx
      on public_parcels (county_code)
  `;

  // ── public_ownership_snapshots — append-only ─────────────────
  await sql`
    create table if not exists public_ownership_snapshots (
      id                     text primary key,
      parcel_id              text not null references public_parcels(id),
      owner_name             text not null,
      mailing_address        text,
      ownership_start_date   date,
      last_transfer_date     date,
      assessed_value         numeric,
      source                 text not null,
      source_snapshot_id     text not null,
      observed_at            timestamptz not null,
      raw_source_row         jsonb not null,
      created_at             timestamptz not null default now()
    )
  `;
  // Chronological lookup: most-recent-first per parcel.
  await sql`
    create index if not exists public_ownership_snapshots_parcel_observed_idx
      on public_ownership_snapshots (parcel_id, observed_at desc)
  `;
  // Audit by source batch.
  await sql`
    create index if not exists public_ownership_snapshots_source_idx
      on public_ownership_snapshots (source)
  `;
  await sql`
    create index if not exists public_ownership_snapshots_source_snapshot_idx
      on public_ownership_snapshots (source_snapshot_id)
  `;

  // ── workspace_contact_parcel_links — workspace-scoped ────────
  await sql`
    create table if not exists workspace_contact_parcel_links (
      id                       text primary key,
      workspace_id             text not null,
      contact_id               text not null,
      parcel_id                text not null references public_parcels(id),
      owner_snapshot_id        text not null references public_ownership_snapshots(id),
      match_confidence         text not null,
      match_reason             text not null,
      link_created_at          timestamptz not null,
      link_last_verified_at    timestamptz not null,
      link_superseded_at       timestamptz,
      superseded_by_link_id    text,
      created_at               timestamptz not null default now()
    )
  `;
  // Workspace-scoped query path (constitution §6.11).
  await sql`
    create index if not exists wcpl_workspace_contact_idx
      on workspace_contact_parcel_links (workspace_id, contact_id)
  `;
  // Active-link lookup (partial index for the hot read path).
  await sql`
    create index if not exists wcpl_active_idx
      on workspace_contact_parcel_links (workspace_id, contact_id)
      where link_superseded_at is null
  `;
  // Supersession-chain traversal.
  await sql`
    create index if not exists wcpl_superseded_by_idx
      on workspace_contact_parcel_links (superseded_by_link_id)
      where superseded_by_link_id is not null
  `;
  // Workspace-scoped parcel lookup (audit: which contacts in this
  // workspace are linked to a given parcel).
  await sql`
    create index if not exists wcpl_workspace_parcel_idx
      on workspace_contact_parcel_links (workspace_id, parcel_id)
  `;

  schemaReady = true;
}

export function __resetPublicRecordsSchemaReadyForTests(): void {
  schemaReady = null;
}
