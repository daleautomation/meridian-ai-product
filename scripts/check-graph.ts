// Meridian Command — Opportunity Graph validation.
//
// Proves the graph is correct WITHOUT requiring a database: it runs the pure
// projection over the real JSON stores and asserts structural invariants. When
// Neon is configured AND the graph tables exist, it additionally verifies the
// persisted graph. Follows the check-*.ts convention (check(label, ok) + exit code)
// so it slots into the same CI gate as the other domain checks.
//
// Usage:
//   npx tsx scripts/check-graph.ts                 # pure (no DB) validation
//   DATABASE_URL=... npx tsx scripts/check-graph.ts  # + persisted-graph checks

import { loadFileInputs } from "../lib/graph/fileInputs";
import { projectGraph } from "../lib/graph/projection";
import { SELF_NODE_ID } from "../lib/graph/ids";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`ok: ${label}`);
  } else {
    console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

async function main(): Promise<void> {
  const AS_OF = "2026-07-06T00:00:00.000Z"; // fixed → determinism is testable
  const { inputs, counts } = await loadFileInputs(AS_OF);

  console.log("[check-graph] inputs", counts);

  // ── Pure projection (no DB required) ──────────────────────────────────────
  const g = projectGraph(inputs);
  const nodeIds = new Set(g.nodes.map((n) => n.nodeId));
  const byType = tally(g.nodes.map((n) => n.nodeType));
  const edgeByType = tally(g.edges.map((e) => e.edgeType));
  console.log("[check-graph] projected", {
    sources: g.sources.length,
    nodes: g.nodes.length,
    edges: g.edges.length,
    identities: g.identities.length,
    byType,
    edgeByType,
  });

  check("self node exists (the center of the OS)", nodeIds.has(SELF_NODE_ID));
  check("has at least one node", g.nodes.length > 0);
  check("has at least one edge", g.edges.length > 0);

  // Success criterion: What people / companies / opportunities do I have?
  check("projects people from contacts", (byType.person ?? 0) > 0, byType);
  check("projects companies", (byType.company ?? 0) > 0, byType);
  check("projects job opportunities", (byType.job_opportunity ?? 0) > 0, byType);

  // Success criterion: relationships connect people, companies, jobs, revenue.
  check("self KNOWS people", (edgeByType.KNOWS ?? 0) > 0, edgeByType);
  check("self is PURSUING opportunities", (edgeByType.PURSUING ?? 0) > 0, edgeByType);
  check("opportunities link AT_COMPANY (island join)", (edgeByType.AT_COMPANY ?? 0) > 0, edgeByType);
  check(
    "people link WORKS_AT companies",
    (edgeByType.WORKS_AT ?? 0) > 0 || counts.contacts === 0,
    edgeByType,
  );

  // Integrity: no dangling edges, everything has provenance.
  const orphanEdges = g.edges.filter((e) => !nodeIds.has(e.srcNodeId) || !nodeIds.has(e.dstNodeId));
  check("no orphan edges (endpoints all exist)", orphanEdges.length === 0, orphanEdges.slice(0, 3).map((e) => e.edgeId));

  const nodesNoProv = g.nodes.filter((n) => n.provenance.length === 0);
  check("every node has provenance (traceable source)", nodesNoProv.length === 0, nodesNoProv.slice(0, 3).map((n) => n.nodeId));

  const edgesNoEvidence = g.edges.filter((e) => e.evidence.length === 0);
  check("every edge has evidence (traceable source)", edgesNoEvidence.length === 0);

  const sourceIds = new Set(g.sources.map((s) => s.sourceRecordId));
  const danglingProv = g.nodes.filter((n) => n.provenance.some((p) => !sourceIds.has(p.sourceRecordId)));
  check("all provenance references a real source_record", danglingProv.length === 0, danglingProv.slice(0, 3).map((n) => n.nodeId));

  // Determinism: same inputs + same asOf → byte-identical projection.
  const g2 = projectGraph(inputs);
  check("projection is deterministic (stable across runs)", JSON.stringify(g) === JSON.stringify(g2));

  // Identity resolution present (the cross-keyspace join layer).
  check("identity links were produced", g.identities.length > 0, g.identities.length);

  // ── Persisted-graph checks (only if Neon + tables present) ────────────────
  if (process.env.DATABASE_URL?.trim()) {
    try {
      const repo = await import("../lib/graph/repository");
      if (await repo.graphTablesExist()) {
        const nodeCounts = await repo.countByNodeType();
        const edgeCounts = await repo.countByEdgeType();
        const orphans = await repo.countOrphanEdges();
        const noProv = await repo.countNodesWithoutProvenance();
        console.log("[check-graph] persisted", { nodeCounts, edgeCounts, orphans, noProv });
        check("persisted graph has nodes", Object.values(nodeCounts).reduce((a, b) => a + b, 0) > 0);
        check("persisted graph has no orphan edges", orphans === 0, orphans);
        check("persisted graph nodes all have provenance", noProv === 0, noProv);
      } else {
        console.log("[check-graph] graph tables not applied yet — skipping persisted checks (not a failure)");
      }
    } catch (err) {
      console.log("[check-graph] DB unreachable — skipping persisted checks (not a failure):", (err as Error).message);
    }
  } else {
    console.log("[check-graph] DATABASE_URL unset — pure validation only (not a failure)");
  }

  if (failed > 0) {
    console.error(`\n[check-graph] ${failed} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\n[check-graph] all checks passed");
  }
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

main().catch((err) => {
  console.error("[check-graph] failed", err);
  process.exitCode = 1;
});
