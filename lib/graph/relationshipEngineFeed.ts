// Meridian Command — graph → relationship-engine feed (non-invasive).
//
// The existing lib/relationship-engine/* is a read-only projection skeleton whose
// repositories currently return []. This module is the durable data source it was
// waiting for: it reads the Opportunity Graph and returns a neutral, serializable
// feed the engine can project from.
//
// GUARDRAIL: this file imports NOTHING from lib/relationship-engine and modifies
// none of its 59 files. Wiring the engine's repositories to call buildGraphFeed()
// is a deliberate later step (Phase 2+). Phase 1 only makes the feed available so
// the engine can be fed instead of rebuilt.

import { getNeonSql } from "@/lib/db/neon";

export interface GraphFeedNode {
  nodeId: string;
  nodeType: string;
  label: string;
  attributes: Record<string, unknown>;
  lastSeenAt: string;
}

export interface GraphFeedEdge {
  srcNodeId: string;
  dstNodeId: string;
  edgeType: string;
  weight: number;
  lastObservedAt: string;
}

export interface GraphFeed {
  ownerScope: string;
  generatedAt: string;
  nodes: GraphFeedNode[];
  edges: GraphFeedEdge[];
}

/**
 * Build a neutral graph feed for a given owner scope. Deterministic ordering.
 * `generatedAt` is caller-supplied to preserve replayability (no Date.now()).
 */
export async function buildGraphFeed(
  ownerScope = "dylan",
  generatedAt = new Date(0).toISOString(),
): Promise<GraphFeed> {
  const sql = getNeonSql();

  const nodeRows = (await sql`
    select node_id, node_type, label, attributes, last_seen_at
    from graph_nodes
    where owner_scope = ${ownerScope}
    order by node_id asc
  `) as Array<{
    node_id: string;
    node_type: string;
    label: string;
    attributes: Record<string, unknown>;
    last_seen_at: string;
  }>;

  const edgeRows = (await sql`
    select e.src_node_id, e.dst_node_id, e.edge_type, e.weight, e.last_observed_at
    from graph_edges e
    join graph_nodes n on n.node_id = e.src_node_id
    where n.owner_scope = ${ownerScope}
    order by e.edge_id asc
  `) as Array<{
    src_node_id: string;
    dst_node_id: string;
    edge_type: string;
    weight: number;
    last_observed_at: string;
  }>;

  return {
    ownerScope,
    generatedAt,
    nodes: nodeRows.map((r) => ({
      nodeId: r.node_id,
      nodeType: r.node_type,
      label: r.label,
      attributes: r.attributes ?? {},
      lastSeenAt: r.last_seen_at,
    })),
    edges: edgeRows.map((r) => ({
      srcNodeId: r.src_node_id,
      dstNodeId: r.dst_node_id,
      edgeType: r.edge_type,
      weight: Number(r.weight),
      lastObservedAt: r.last_observed_at,
    })),
  };
}
