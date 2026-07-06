// Meridian Command — bridge detected Gmail opportunities into the Opportunity Graph.
//
// Reuses the built graph layer (lib/graph): deterministic ids, the GraphProjection
// shape, and the idempotent Neon repository. A Gmail opportunity enriches the graph
// with a real person node, a company node, and a self→KNOWS→person edge carrying
// live stage/momentum attributes — provenance = source system "gmail".
//
// Only runs when Postgres is reachable; the file staging store is the primary,
// always-written output.

import {
  companyNodeIdFromName,
  personNodeId,
  provenance,
  sha256,
  sourceRecordId,
  SELF_NODE_ID,
  SELF_OWNER,
} from "@/lib/graph/ids";
import type { GraphEdge, GraphNode, GraphProjection, SourceRecord } from "@/lib/graph/types";
import { graphTablesExist, persistProjection } from "@/lib/graph/repository";
import type { DetectedOpportunity } from "./types";

export function projectGmailOpportunities(
  opps: DetectedOpportunity[],
  asOf: string,
): GraphProjection {
  const sources = new Map<string, SourceRecord>();
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const self: GraphNode = {
    nodeId: SELF_NODE_ID, nodeType: "self", label: "Dylan", ownerScope: SELF_OWNER,
    canonicalKey: SELF_OWNER, attributes: { role: "owner" },
    provenance: [provenance("gmail", "self", SELF_OWNER)], sourceCount: 1,
    firstSeenAt: asOf, lastSeenAt: asOf,
  };
  nodes.set(self.nodeId, self);

  for (const opp of opps) {
    const srcId = sourceRecordId("gmail", "opportunity", opp.key);
    const prov = provenance("gmail", "opportunity", opp.key);
    if (!sources.has(srcId)) {
      sources.set(srcId, {
        sourceRecordId: srcId, sourceSystem: "gmail", sourceType: "opportunity",
        sourceId: opp.key, workspace: SELF_OWNER,
        payload: opp as unknown as Record<string, unknown>,
        contentHash: sha256(JSON.stringify(opp)), observedAt: asOf,
      });
    }
    const observedAt = opp.lastOutboundAt ?? opp.lastInboundAt ?? asOf;
    const primaryEmail = opp.people[0] ?? null;

    // Person node — carries the live opportunity state as attributes.
    if (primaryEmail) {
      const personId = personNodeId({ email: primaryEmail, company: opp.company });
      nodes.set(personId, {
        nodeId: personId, nodeType: "person", label: primaryEmail, ownerScope: SELF_OWNER,
        canonicalKey: personId.slice("person:".length),
        attributes: {
          email: primaryEmail, company: opp.company,
          gmailStage: opp.stage, gmailStatus: opp.status, momentum: opp.momentum,
          waitingOn: opp.waitingOn, nextAction: opp.nextAction, confidence: opp.confidence,
          lastInboundAt: opp.lastInboundAt, lastOutboundAt: opp.lastOutboundAt,
        },
        provenance: [prov], sourceCount: 1, firstSeenAt: observedAt, lastSeenAt: observedAt,
      });
      edges.set(`${SELF_NODE_ID}|KNOWS|${personId}`, {
        edgeId: `${SELF_NODE_ID}|KNOWS|${personId}`, srcNodeId: SELF_NODE_ID, dstNodeId: personId,
        edgeType: "KNOWS", directed: false, weight: 0.5,
        attributes: { via: "gmail", stage: opp.stage, momentum: opp.momentum },
        evidence: [prov], firstObservedAt: observedAt, lastObservedAt: observedAt,
      });

      // Company node + person WORKS_AT company.
      const compId = companyNodeIdFromName(opp.company);
      nodes.set(compId, {
        nodeId: compId, nodeType: "company", label: opp.company, ownerScope: SELF_OWNER,
        canonicalKey: compId.slice("company:".length),
        attributes: { origin: "gmail", domain: opp.companyDomain, kind: opp.kind },
        provenance: [prov], sourceCount: 1, firstSeenAt: observedAt, lastSeenAt: observedAt,
      });
      edges.set(`${personId}|WORKS_AT|${compId}`, {
        edgeId: `${personId}|WORKS_AT|${compId}`, srcNodeId: personId, dstNodeId: compId,
        edgeType: "WORKS_AT", directed: true, weight: 0.5, attributes: {},
        evidence: [prov], firstObservedAt: observedAt, lastObservedAt: observedAt,
      });
    }
  }

  return {
    sources: [...sources.values()],
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    identities: [],
  };
}

/** Persist to the graph only if the graph tables exist. Returns what happened. */
export async function persistGmailToGraph(
  opps: DetectedOpportunity[],
  asOf: string,
): Promise<{ persisted: boolean; reason?: string; nodes: number; edges: number }> {
  if (!process.env.DATABASE_URL?.trim()) {
    return { persisted: false, reason: "DATABASE_URL unset", nodes: 0, edges: 0 };
  }
  if (!(await graphTablesExist())) {
    return { persisted: false, reason: "graph tables not applied", nodes: 0, edges: 0 };
  }
  const projection = projectGmailOpportunities(opps, asOf);
  await persistProjection(projection);
  return { persisted: true, nodes: projection.nodes.length, edges: projection.edges.length };
}
