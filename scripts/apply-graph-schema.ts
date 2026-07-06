// Apply the Phase 0/1 Opportunity Graph schema (db/schema/phase2-graph.sql) to Neon.
//
// The schema is additive and idempotent, so this is safe to re-run. The Neon HTTP
// driver executes one statement per request, so we strip the begin/commit wrapper
// and run each statement individually (idempotency makes partial application safe).
//
// Usage:
//   DATABASE_URL=... npx tsx scripts/apply-graph-schema.ts            # dry-run (prints plan)
//   DATABASE_URL=... npx tsx scripts/apply-graph-schema.ts --execute  # apply
//
// Prefer psql for production: psql "$DIRECT_DATABASE_URL" -f db/schema/phase2-graph.sql

import { promises as fs } from "node:fs";
import path from "node:path";
import { getNeonSql } from "../lib/db/neon";

const SCHEMA_PATH = path.join(process.cwd(), "db", "schema", "phase2-graph.sql");

function splitStatements(sql: string): string[] {
  // Strip comments FIRST (line-level and inline) so semicolons inside comment
  // prose don't fracture statements. This file has no `--` inside string
  // literals, so cutting each line at its first `--` is safe.
  const withoutComments = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");

  return withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const lower = s.toLowerCase();
      return lower !== "begin" && lower !== "commit";
    });
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const raw = await fs.readFile(SCHEMA_PATH, "utf8");
  const statements = splitStatements(raw);

  console.log("[apply-graph-schema]", {
    schema: "db/schema/phase2-graph.sql",
    statements: statements.length,
    mode: execute ? "execute" : "dry-run",
  });

  if (!execute) {
    statements.forEach((s, i) => {
      const head = s.split("\n")[0].slice(0, 80);
      console.log(`  [${String(i + 1).padStart(2, "0")}] ${head}`);
    });
    console.log("[apply-graph-schema] dry-run only — pass --execute to apply");
    return;
  }

  const sql = getNeonSql({ direct: true });
  let applied = 0;
  for (const statement of statements) {
    await sql.query(statement);
    applied += 1;
  }
  console.log("[apply-graph-schema] complete", { applied });
}

main().catch((err) => {
  console.error("[apply-graph-schema] failed", err);
  process.exitCode = 1;
});
