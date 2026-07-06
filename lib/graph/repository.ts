// Meridian Command — Opportunity Graph repository (Neon/Postgres data access).
//
// Raw tagged-template SQL via the existing getNeonSql() client (no ORM), matching
// the house style in lib/state/*NeonAdapter.ts. All writes are idempotent upserts
// keyed on deterministic ids, so re-running the backfill is safe.
//
// This module requires Neon: getNeonSql() throws if DATABASE_URL is unset. Callers
// (backfill + validation scripts) gate on that. Nothing here runs during normal
// request handling in Phase 1 — it is populated offline by the backfill.

import { getNeonSql } from "@/lib/db/neon";
import type {
  GraphEdge,
  GraphNode,
  GraphProjection,
  IdentityLink,
  SourceRecord,
} from "./types";

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// ── Writes (idempotent upserts) ───────────────────────────────────────────────

export async function upsertSourceRecord(rec: SourceRecord): Promise<void> {
  const sql = getNeonSql();
  await sql`
    insert into source_records
      (source_record_id, source_system, source_type, source_id, workspace, payload, content_hash, observed_at)
    values
      (${rec.sourceRecordId}, ${rec.sourceSystem}, ${rec.sourceType}, ${rec.sourceId},
       ${rec.workspace}, ${json(rec.payload)}::jsonb, ${rec.contentHash}, ${rec.observedAt})
    on conflict (source_record_id) do update set
      payload = excluded.payload,
      content_hash = excluded.content_hash,
      observed_at = greatest(source_records.observed_at, excluded.observed_at)
  `;
}

export async function upsertNode(node: GraphNode): Promise<void> {
  const sql = getNeonSql();
  await sql`
    insert into graph_nodes
      (node_id, node_type, label, owner_scope, canonical_key, attributes, provenance, source_count, first_seen_at, last_seen_at)
    values
      (${node.nodeId}, ${node.nodeType}, ${node.label}, ${node.ownerScope}, ${node.canonicalKey},
       ${json(node.attributes)}::jsonb, ${json(node.provenance)}::jsonb, ${node.sourceCount},
       ${node.firstSeenAt}, ${node.lastSeenAt})
    on conflict (node_id) do update set
      label = excluded.label,
      attributes = excluded.attributes,
      provenance = excluded.provenance,
      source_count = excluded.source_count,
      first_seen_at = least(graph_nodes.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(graph_nodes.last_seen_at, excluded.last_seen_at)
  `;
}

export async function upsertEdge(edge: GraphEdge): Promise<void> {
  const sql = getNeonSql();
  await sql`
    insert into graph_edges
      (edge_id, src_node_id, dst_node_id, edge_type, directed, weight, attributes, evidence, first_observed_at, last_observed_at)
    values
      (${edge.edgeId}, ${edge.srcNodeId}, ${edge.dstNodeId}, ${edge.edgeType}, ${edge.directed},
       ${edge.weight}, ${json(edge.attributes)}::jsonb, ${json(edge.evidence)}::jsonb,
       ${edge.firstObservedAt}, ${edge.lastObservedAt})
    on conflict (edge_id) do update set
      weight = excluded.weight,
      attributes = excluded.attributes,
      evidence = excluded.evidence,
      first_observed_at = least(graph_edges.first_observed_at, excluded.first_observed_at),
      last_observed_at = greatest(graph_edges.last_observed_at, excluded.last_observed_at)
  `;
}

export async function upsertIdentity(link: IdentityLink): Promise<void> {
  const sql = getNeonSql();
  await sql`
    insert into identity_resolution
      (handle, handle_kind, node_id, confidence, resolved_by, first_seen_at, last_seen_at)
    values
      (${link.handle}, ${link.handleKind}, ${link.nodeId}, ${link.confidence}, ${link.resolvedBy}, now(), now())
    on conflict (handle) do update set
      node_id = excluded.node_id,
      confidence = excluded.confidence,
      resolved_by = excluded.resolved_by,
      last_seen_at = now()
  `;
}

/** Persist a full projection. Edges are written after nodes to satisfy FKs. */
export async function persistProjection(projection: GraphProjection): Promise<void> {
  for (const rec of projection.sources) await upsertSourceRecord(rec);
  for (const node of projection.nodes) await upsertNode(node);
  for (const edge of projection.edges) await upsertEdge(edge);
  for (const link of projection.identities) await upsertIdentity(link);
}

// ── Reads (used by the validation script and future scoring) ──────────────────

export async function countByNodeType(): Promise<Record<string, number>> {
  const sql = getNeonSql();
  const rows = (await sql`
    select node_type, count(*)::int as n from graph_nodes group by node_type
  `) as Array<{ node_type: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.node_type, r.n]));
}

export async function countByEdgeType(): Promise<Record<string, number>> {
  const sql = getNeonSql();
  const rows = (await sql`
    select edge_type, count(*)::int as n from graph_edges group by edge_type
  `) as Array<{ edge_type: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.edge_type, r.n]));
}

/** Count edges whose endpoints are missing — must be 0 for a healthy graph. */
export async function countOrphanEdges(): Promise<number> {
  const sql = getNeonSql();
  const rows = (await sql`
    select count(*)::int as n
    from graph_edges e
    where not exists (select 1 from graph_nodes n where n.node_id = e.src_node_id)
       or not exists (select 1 from graph_nodes n where n.node_id = e.dst_node_id)
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Count nodes with no provenance — must be 0 (everything must trace to a source). */
export async function countNodesWithoutProvenance(): Promise<number> {
  const sql = getNeonSql();
  const rows = (await sql`
    select count(*)::int as n from graph_nodes where jsonb_array_length(provenance) = 0
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** Do the graph tables exist yet? Lets the validator degrade gracefully. */
export async function graphTablesExist(): Promise<boolean> {
  const sql = getNeonSql();
  const rows = (await sql`
    select count(*)::int as n
    from information_schema.tables
    where table_schema = 'public'
      and table_name in ('graph_nodes','graph_edges','source_records','identity_resolution')
  `) as Array<{ n: number }>;
  return (rows[0]?.n ?? 0) === 4;
}
