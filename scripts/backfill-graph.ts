// Meridian Command — Phase 1 Opportunity Graph backfill.
//
// Reads the existing JSON stores (read-only), runs the pure deterministic
// projection, and upserts the resulting nodes/edges/sources/identities into Neon.
// Idempotent: deterministic ids + upserts mean re-running converges, never
// duplicates. Mirrors the safety posture of scripts/backfill-phase1-neon.ts.
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/backfill-graph.ts               # dry-run (default)
//   DATABASE_URL=... MERIDIAN_BACKFILL_CONFIRM=true \
//     npx tsx scripts/backfill-graph.ts --execute                    # write
//   ... --allow-production   (required when NODE_ENV=production)

import { loadFileInputs } from "../lib/graph/fileInputs";
import { projectGraph } from "../lib/graph/projection";
import { persistProjection } from "../lib/graph/repository";
import { graphTablesExist } from "../lib/graph/repository";

function parseArgs(argv: string[]): { execute: boolean; allowProduction: boolean } {
  const known = new Set(["--dry-run", "--execute", "--allow-production"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  if (argv.includes("--dry-run") && argv.includes("--execute")) {
    throw new Error("Use either --dry-run or --execute, not both");
  }
  return {
    execute: argv.includes("--execute"),
    allowProduction:
      argv.includes("--allow-production") ||
      process.env.MERIDIAN_BACKFILL_ALLOW_PRODUCTION?.trim().toLowerCase() === "true",
  };
}

function requireDatabaseUrl(): void {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required for the graph backfill");
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error();
  } catch {
    throw new Error("DATABASE_URL must be a valid postgres:// URL");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase() ?? "(unset)";

  requireDatabaseUrl();
  if (nodeEnv === "production" && !args.allowProduction) {
    throw new Error("Blocked under NODE_ENV=production without --allow-production");
  }
  if (args.execute && process.env.MERIDIAN_BACKFILL_CONFIRM?.trim().toLowerCase() !== "true") {
    throw new Error("Write execution requires --execute and MERIDIAN_BACKFILL_CONFIRM=true");
  }

  // asOf is the deterministic fallback for records lacking their own timestamp.
  const asOf = process.env.MERIDIAN_GRAPH_AS_OF?.trim() || new Date().toISOString();
  const { inputs, counts } = await loadFileInputs(asOf);
  const projection = projectGraph(inputs);

  console.log("[backfill-graph] plan", {
    mode: args.execute ? "execute" : "dry-run",
    nodeEnv,
    asOf,
    inputs: counts,
    projected: {
      sources: projection.sources.length,
      nodes: projection.nodes.length,
      edges: projection.edges.length,
      identities: projection.identities.length,
    },
    nodesByType: tally(projection.nodes.map((n) => n.nodeType)),
    edgesByType: tally(projection.edges.map((e) => e.edgeType)),
  });

  if (!args.execute) {
    console.log("[backfill-graph] dry-run only — pass --execute (+ CONFIRM) to persist");
    return;
  }

  if (!(await graphTablesExist())) {
    throw new Error(
      "Graph tables not found. Apply db/schema/phase2-graph.sql first " +
        "(scripts/apply-graph-schema.ts --execute or psql -f).",
    );
  }

  const started = Date.now();
  await persistProjection(projection);
  console.log("[backfill-graph] complete", {
    persisted: {
      sources: projection.sources.length,
      nodes: projection.nodes.length,
      edges: projection.edges.length,
      identities: projection.identities.length,
    },
    durationMs: Date.now() - started,
  });
}

function tally(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

main().catch((err) => {
  console.error("[backfill-graph] failed", err);
  process.exitCode = 1;
});
