// Meridian — Public-Record Intelligence Architecture v1, Commit B
//
// Read-only audit helpers for the canonical public-record substrate.
// Used by scripts/crm-audit.ts. No writes. Workspace-scoped at the
// link layer; parcels + snapshots are public records.

import { neon } from "@neondatabase/serverless";
import { assertWorkspaceSlug, getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";

export interface PublicRecordsSubstrateCounts {
  schemaInitialized: boolean;
  totalParcels: number;
  parcelsByCounty: Record<string, number>;
  totalSnapshots: number;
  distinctSources: number;
  snapshotsBySource: Record<string, number>;
  oldestSnapshot: string | null;
  newestSnapshot: string | null;
}

export interface ActiveLinkSummary {
  contactId: string;
  matchConfidence: "HIGH" | "MED" | "WEAK";
  matchReason: string;
  parcelId: string;
}

export interface WorkspaceLinkAudit {
  totalActiveLinks: number;
  totalSupersededLinks: number;
  linksByConfidence: { HIGH: number; MED: number; WEAK: number };
  linksByMatchReason: Record<string, number>;
  staleObservationLinks: number;
  ownershipMismatchLinks: number;
  trustOrLlcLinks: number;
  surnameOnlyLinks: number;
}

function sqlClient() {
  const url = getCrmDatabaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

type SqlClient = ReturnType<typeof sqlClient>;

async function tableExists(sql: SqlClient, name: string): Promise<boolean> {
  const rows = (await sql`
    select 1 as ok
      from information_schema.tables
     where table_name = ${name}
     limit 1
  `) as Array<{ ok: number }>;
  return rows.length > 0;
}

export async function readSubstrateCounts(): Promise<PublicRecordsSubstrateCounts> {
  const sql = sqlClient();
  const hasParcels = await tableExists(sql, "public_parcels");
  const hasSnapshots = await tableExists(sql, "public_ownership_snapshots");
  if (!hasParcels || !hasSnapshots) {
    return {
      schemaInitialized: false,
      totalParcels: 0,
      parcelsByCounty: {},
      totalSnapshots: 0,
      distinctSources: 0,
      snapshotsBySource: {},
      oldestSnapshot: null,
      newestSnapshot: null,
    };
  }

  const totalParcels = ((await sql`select count(*)::int as n from public_parcels`) as Array<{ n: number }>)[0]?.n ?? 0;
  const parcelsByCountyRows = (await sql`
    select county_code, count(*)::int as n
      from public_parcels
     group by county_code
     order by county_code
  `) as Array<{ county_code: string; n: number }>;
  const parcelsByCounty: Record<string, number> = {};
  for (const r of parcelsByCountyRows) parcelsByCounty[r.county_code] = r.n;

  const totalSnapshots = ((await sql`select count(*)::int as n from public_ownership_snapshots`) as Array<{ n: number }>)[0]?.n ?? 0;
  const distinctSources = ((await sql`select count(distinct source)::int as n from public_ownership_snapshots`) as Array<{ n: number }>)[0]?.n ?? 0;
  const snapshotsBySourceRows = (await sql`
    select source, count(*)::int as n
      from public_ownership_snapshots
     group by source
     order by source
  `) as Array<{ source: string; n: number }>;
  const snapshotsBySource: Record<string, number> = {};
  for (const r of snapshotsBySourceRows) snapshotsBySource[r.source] = r.n;

  const minMax = (await sql`
    select min(observed_at) as oldest, max(observed_at) as newest
      from public_ownership_snapshots
  `) as Array<{ oldest: unknown; newest: unknown }>;
  const toIso = (v: unknown): string | null => {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "string") return v;
    return null;
  };

  return {
    schemaInitialized: true,
    totalParcels,
    parcelsByCounty,
    totalSnapshots,
    distinctSources,
    snapshotsBySource,
    oldestSnapshot: minMax[0] ? toIso(minMax[0].oldest) : null,
    newestSnapshot: minMax[0] ? toIso(minMax[0].newest) : null,
  };
}

const DEFAULT_STALE_DAYS = 540;

/**
 * One-shot fetch of every active workspace_contact_parcel_link for a
 * workspace, indexed by contact_id. Used by the grounding-quality audit
 * to avoid a per-contact round trip.
 *
 * Returns an empty map when the substrate is not yet initialized.
 */
export async function readActiveLinksByContactId(
  workspaceId: string,
): Promise<Map<string, ActiveLinkSummary>> {
  assertWorkspaceSlug(workspaceId);
  const sql = sqlClient();
  const hasLinks = await tableExists(sql, "workspace_contact_parcel_links");
  if (!hasLinks) return new Map();
  const rows = (await sql`
    select contact_id, match_confidence, match_reason, parcel_id
      from workspace_contact_parcel_links
     where workspace_id = ${workspaceId}
       and link_superseded_at is null
  `) as Array<{
    contact_id: string;
    match_confidence: string;
    match_reason: string;
    parcel_id: string;
  }>;
  const map = new Map<string, ActiveLinkSummary>();
  for (const r of rows) {
    map.set(r.contact_id, {
      contactId: r.contact_id,
      matchConfidence: r.match_confidence as "HIGH" | "MED" | "WEAK",
      matchReason: r.match_reason,
      parcelId: r.parcel_id,
    });
  }
  return map;
}

export async function readWorkspaceLinkAudit(
  workspaceId: string,
  staleThresholdDays: number = DEFAULT_STALE_DAYS,
): Promise<WorkspaceLinkAudit> {
  assertWorkspaceSlug(workspaceId);
  const sql = sqlClient();
  const hasLinks = await tableExists(sql, "workspace_contact_parcel_links");
  if (!hasLinks) {
    return {
      totalActiveLinks: 0,
      totalSupersededLinks: 0,
      linksByConfidence: { HIGH: 0, MED: 0, WEAK: 0 },
      linksByMatchReason: {},
      staleObservationLinks: 0,
      ownershipMismatchLinks: 0,
      trustOrLlcLinks: 0,
      surnameOnlyLinks: 0,
    };
  }

  const active = ((await sql`
    select count(*)::int as n
      from workspace_contact_parcel_links
     where workspace_id = ${workspaceId}
       and link_superseded_at is null
  `) as Array<{ n: number }>)[0]?.n ?? 0;
  const superseded = ((await sql`
    select count(*)::int as n
      from workspace_contact_parcel_links
     where workspace_id = ${workspaceId}
       and link_superseded_at is not null
  `) as Array<{ n: number }>)[0]?.n ?? 0;

  const byConfidenceRows = (await sql`
    select match_confidence, count(*)::int as n
      from workspace_contact_parcel_links
     where workspace_id = ${workspaceId}
       and link_superseded_at is null
     group by match_confidence
  `) as Array<{ match_confidence: string; n: number }>;
  const linksByConfidence = { HIGH: 0, MED: 0, WEAK: 0 };
  for (const r of byConfidenceRows) {
    if (r.match_confidence === "HIGH") linksByConfidence.HIGH = r.n;
    else if (r.match_confidence === "MED") linksByConfidence.MED = r.n;
    else if (r.match_confidence === "WEAK") linksByConfidence.WEAK = r.n;
  }

  const byReasonRows = (await sql`
    select match_reason, count(*)::int as n
      from workspace_contact_parcel_links
     where workspace_id = ${workspaceId}
       and link_superseded_at is null
     group by match_reason
  `) as Array<{ match_reason: string; n: number }>;
  const linksByMatchReason: Record<string, number> = {};
  for (const r of byReasonRows) linksByMatchReason[r.match_reason] = r.n;

  // Stale: snapshot observed_at older than threshold relative to now.
  const stale = ((await sql`
    select count(*)::int as n
      from workspace_contact_parcel_links L
      join public_ownership_snapshots S on S.id = L.owner_snapshot_id
     where L.workspace_id = ${workspaceId}
       and L.link_superseded_at is null
       and S.observed_at < now() - (${staleThresholdDays} || ' days')::interval
  `) as Array<{ n: number }>)[0]?.n ?? 0;

  const ownershipMismatch = linksByMatchReason["ownership_mismatch"] ?? 0;
  const trustOrLlc = linksByMatchReason["trust_or_llc"] ?? 0;
  const surnameOnly = linksByMatchReason["surname"] ?? 0;

  return {
    totalActiveLinks: active,
    totalSupersededLinks: superseded,
    linksByConfidence,
    linksByMatchReason,
    staleObservationLinks: stale,
    ownershipMismatchLinks: ownershipMismatch,
    trustOrLlcLinks: trustOrLlc,
    surnameOnlyLinks: surnameOnly,
  };
}
