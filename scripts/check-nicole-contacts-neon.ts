/**
 * Direct Neon diagnostic for the nicole-lonergan workspace.
 *
 * Reads DATABASE_URL (or POSTGRES_URL) from the current process env —
 * the caller is responsible for loading the correct env file, e.g.
 *
 *   npx dotenv -e .env.local -- npm run nicole-contacts:check
 *
 * The script bypasses every cache layer (no `lib/crm-import/store.ts`
 * memory map) and queries `crm_contacts` over a fresh Neon connection.
 * If the live UI shows "0 contacts" but this script reports >0, the
 * defect is in the read path. If this script reports 0, the defect is
 * in the write path (or you are pointed at the wrong database).
 *
 * Exit codes:
 *   0 — Nicole workspace has at least one contact in this database
 *   1 — Schema missing, connection failure, or 0 contacts for Nicole
 *   2 — DATABASE_URL / POSTGRES_URL not set
 */

import { neon } from "@neondatabase/serverless";

const WORKSPACE = "nicole-lonergan";

interface ContactRow {
  contact_id: string;
  workspace_id: string;
  normalized: unknown;
  source_metadata: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}

function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.host;
    const db = u.pathname.replace(/^\//, "") || "(none)";
    return `${u.protocol}//***@${host}/${db}`;
  } catch {
    return "(unparseable)";
  }
}

function pickUrl(): { url: string; envVar: "DATABASE_URL" | "POSTGRES_URL" } | null {
  const fromDb = process.env.DATABASE_URL?.trim();
  if (fromDb) return { url: fromDb, envVar: "DATABASE_URL" };
  const fromPg = process.env.POSTGRES_URL?.trim();
  if (fromPg) return { url: fromPg, envVar: "POSTGRES_URL" };
  return null;
}

async function main(): Promise<void> {
  const picked = pickUrl();
  if (!picked) {
    console.error(
      "[nicole-contacts:check] DATABASE_URL or POSTGRES_URL is not set in this process.",
    );
    console.error(
      "  Hint: run with dotenv to load .env.local:",
    );
    console.error(
      "    npx dotenv -e .env.local -- npm run nicole-contacts:check",
    );
    process.exit(2);
  }

  console.log("[nicole-contacts:check] connecting");
  console.log(`  env var:  ${picked.envVar}`);
  console.log(`  database: ${maskUrl(picked.url)}`);

  const sql = neon(picked.url);

  // 1. Does the table exist?
  let tableExists = false;
  try {
    const tableInfo = (await sql`
      select to_regclass('public.crm_contacts') as oid
    `) as Array<{ oid: string | null }>;
    tableExists = tableInfo[0]?.oid !== null;
  } catch (err) {
    console.error("[nicole-contacts:check] schema probe failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (!tableExists) {
    console.error("[nicole-contacts:check] crm_contacts table does NOT exist in this database.");
    console.error("  Fix: run `npx dotenv -e .env.local -- npm run crm:schema:init`");
    process.exit(1);
  }
  console.log("  schema:   crm_contacts table present");

  // 2. Distinct workspaces present.
  const distinct = (await sql`
    select workspace_id, count(*)::int as count
    from crm_contacts
    group by workspace_id
    order by workspace_id
  `) as Array<{ workspace_id: string; count: number }>;
  console.log("");
  console.log("Distinct workspaces present in crm_contacts:");
  if (distinct.length === 0) {
    console.log("  (table is empty — no rows for any workspace)");
  } else {
    for (const w of distinct) {
      const flag = w.workspace_id === WORKSPACE ? "  ←  Nicole" : "";
      console.log(`  ${w.workspace_id.padEnd(28)} ${String(w.count).padStart(6)}${flag}`);
    }
  }

  // 3. Nicole-specific row count.
  const countRows = (await sql`
    select count(*)::int as count
    from crm_contacts
    where workspace_id = ${WORKSPACE}
  `) as Array<{ count: number }>;
  const nicoleCount = countRows[0]?.count ?? 0;
  console.log("");
  console.log(`Nicole workspace (workspace_id = '${WORKSPACE}'):`);
  console.log(`  rows:     ${nicoleCount}`);

  if (nicoleCount === 0) {
    console.log("");
    console.error("[nicole-contacts:check] FAIL — Nicole workspace has 0 rows in this database.");
    console.error("");
    console.error("Diagnosis:");
    if (distinct.length === 0) {
      console.error("  • The crm_contacts table is empty entirely.");
      console.error("  • The import either never ran against this database OR the rows were");
      console.error("    written somewhere else (different DATABASE_URL? local file fallback?).");
    } else {
      const otherSlugs = distinct.map((d) => d.workspace_id).filter((s) => s !== WORKSPACE);
      console.error(
        `  • Other workspaces have rows (${otherSlugs.join(", ")}) but Nicole does not.`,
      );
      console.error("  • Most likely cause: import wrote to a different workspace_id");
      console.error("    (alias mismatch, case mismatch, or stale workspace selection).");
    }
    console.error("");
    console.error("Next:");
    console.error("  1. Confirm DATABASE_URL on Vercel matches the URL above (mask host).");
    console.error("  2. Run a fresh import from /personal/import while signed in as Nicole.");
    console.error("  3. Re-run this script; expect Nicole rows > 0.");
    process.exit(1);
  }

  // 4. Sample rows (first 5 by updated_at desc).
  const sample = (await sql`
    select contact_id, workspace_id, normalized, source_metadata, created_at, updated_at
    from crm_contacts
    where workspace_id = ${WORKSPACE}
    order by updated_at desc
    limit 5
  `) as ContactRow[];
  console.log("");
  console.log("Sample (first 5 by updated_at desc):");
  for (const row of sample) {
    const norm = (row.normalized ?? {}) as Record<string, unknown>;
    const name = typeof norm.name === "string" ? norm.name : "(no name)";
    const email = typeof norm.email === "string" ? norm.email : "";
    const company = typeof norm.company === "string" ? norm.company : "";
    const updated = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at);
    console.log(`  ${row.contact_id.padEnd(36)}  ${updated.slice(0, 19)}  ${name}${email ? ` <${email}>` : ""}${company ? ` — ${company}` : ""}`);
  }

  console.log("");
  console.log("[nicole-contacts:check] OK — Nicole workspace has", nicoleCount, "contact row(s) in", picked.envVar);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[nicole-contacts:check] crashed");
  console.error(message);
  process.exit(1);
});
