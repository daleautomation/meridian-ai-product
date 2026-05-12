import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

const ROOT = process.cwd();
const ENV_FILES = [".env", ".env.local"];
const REQUIRED_PHASE1_TABLES = [
  "idempotency_keys",
  "execution_outcomes",
  "execution_outcome_latest",
  "company_current_state",
  "domain_events",
] as const;

type CheckStatus = "pass" | "fail" | "skip";

type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
  blocker?: string;
};

type TableCount = {
  tableName: string;
  rowCount: number;
};

function parseEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (!existsSync(filePath)) return values;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const equalsAt = normalized.indexOf("=");
    if (equalsAt <= 0) continue;

    const key = normalized.slice(0, equalsAt).trim();
    let value = normalized.slice(equalsAt + 1).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const quote = value[0];
    if ((quote === "\"" || quote === "'") && value[value.length - 1] === quote) {
      value = value.slice(1, -1);
      if (quote === "\"") {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\"/g, "\"")
          .replace(/\\\\/g, "\\");
      }
    } else {
      const commentAt = value.search(/\s#/);
      if (commentAt >= 0) value = value.slice(0, commentAt).trim();
    }

    values[key] = value;
  }
  return values;
}

function loadLocalEnv(): void {
  const merged: Record<string, string> = {};
  for (const file of ENV_FILES) {
    Object.assign(merged, parseEnvFile(path.join(ROOT, file)));
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function postgresUrl(value: string | undefined, name: string): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = value?.trim();
  if (!trimmed) return { ok: false, reason: `${name} is not set` };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return { ok: false, reason: `${name} must use postgres:// or postgresql://` };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, reason: `${name} must be a valid Postgres connection URL` };
  }
}

function maskSegment(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  if (value.length <= 6) return `${value[0]}***${value[value.length - 1]}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function describeDatabaseUrl(value: string): { host: string; database: string } {
  const parsed = new URL(value);
  const hostParts = parsed.hostname.split(".");
  const host = hostParts.length > 1
    ? [maskSegment(hostParts[0]), ...hostParts.slice(1)].join(".")
    : maskSegment(parsed.hostname);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(none)";
  return { host, database: maskSegment(database) };
}

function truthStoreCheck(): Check {
  const raw = process.env.MERIDIAN_TRUTH_STORE?.trim().toLowerCase();
  if (!raw) {
    return {
      name: "MERIDIAN_TRUTH_STORE",
      status: "pass",
      detail: "unset; app defaults to file mode",
    };
  }
  if (raw === "file") {
    return {
      name: "MERIDIAN_TRUTH_STORE",
      status: "pass",
      detail: "explicitly set to file",
    };
  }
  return {
    name: "MERIDIAN_TRUTH_STORE",
    status: "fail",
    detail: `set to ${raw}`,
    blocker: "Keep MERIDIAN_TRUTH_STORE=file or unset until Neon write mode is intentionally enabled.",
  };
}

function envCheck(name: "DATABASE_URL" | "DIRECT_DATABASE_URL", neededFor: string): { check: Check; value?: string } {
  const result = postgresUrl(process.env[name], name);
  if (!result.ok) {
    return {
      check: {
        name,
        status: "fail",
        detail: `${result.reason}; needed for ${neededFor}`,
        blocker: `${name} must be set to a valid Postgres URL before Phase 1 readiness can pass.`,
      },
    };
  }
  return {
    value: result.value,
    check: {
      name,
      status: "pass",
      detail: `configured for ${neededFor}: ${JSON.stringify(describeDatabaseUrl(result.value))}`,
    },
  };
}

function quoteIdent(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe table identifier: ${value}`);
  }
  return `"${value}"`;
}

async function tableExistenceCheck(databaseUrl: string): Promise<{ check: Check; existingTables: Set<string> }> {
  const sql = neon(databaseUrl, { readOnly: true });
  const rows = await sql.query(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [REQUIRED_PHASE1_TABLES],
  ) as Array<{ table_name: string }>;
  const existingTables = new Set(rows.map((row) => row.table_name));
  const missingTables = REQUIRED_PHASE1_TABLES.filter((table) => !existingTables.has(table));

  if (missingTables.length > 0) {
    return {
      existingTables,
      check: {
        name: "Phase 1 tables exist",
        status: "fail",
        detail: `missing: ${missingTables.join(", ")}`,
        blocker: `Create the missing Phase 1 table(s): ${missingTables.join(", ")}.`,
      },
    };
  }
  return {
    existingTables,
    check: {
      name: "Phase 1 tables exist",
      status: "pass",
      detail: REQUIRED_PHASE1_TABLES.join(", "),
    },
  };
}

async function tableEmptyCheck(databaseUrl: string, existingTables: Set<string>): Promise<{ check: Check; counts: TableCount[] }> {
  const counts: TableCount[] = [];
  const missingTables = REQUIRED_PHASE1_TABLES.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    return {
      counts,
      check: {
        name: "Phase 1 tables are empty",
        status: "skip",
        detail: `skipped because table(s) are missing: ${missingTables.join(", ")}`,
        blocker: "Table emptiness cannot be verified until all required Phase 1 tables exist.",
      },
    };
  }

  const sql = neon(databaseUrl, { readOnly: true });
  for (const tableName of REQUIRED_PHASE1_TABLES) {
    const rows = await sql.query(
      `select count(*)::int as row_count from public.${quoteIdent(tableName)}`,
    ) as Array<{ row_count: number | string }>;
    counts.push({ tableName, rowCount: Number(rows[0]?.row_count ?? 0) });
  }

  const nonEmptyTables = counts.filter((item) => item.rowCount > 0);
  if (nonEmptyTables.length > 0) {
    return {
      counts,
      check: {
        name: "Phase 1 tables are empty",
        status: "fail",
        detail: nonEmptyTables.map((item) => `${item.tableName}=${item.rowCount}`).join(", "),
        blocker: "Phase 1 Neon tables must be empty before the initial file-to-Neon backfill.",
      },
    };
  }
  return {
    counts,
    check: {
      name: "Phase 1 tables are empty",
      status: "pass",
      detail: counts.map((item) => `${item.tableName}=0`).join(", "),
    },
  };
}

function printSummary(checks: Check[], counts: TableCount[]): void {
  const passed = checks.filter((check) => check.status === "pass").length;
  const score = Math.round((passed / checks.length) * 100);
  const blockers = checks.flatMap((check) => check.blocker ? [`${check.name}: ${check.blocker}`] : []);

  console.log("[truth-readiness] checks");
  for (const check of checks) {
    const marker = check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "SKIP";
    console.log(`- ${marker} ${check.name}: ${check.detail}`);
  }
  if (counts.length > 0) {
    console.log("[truth-readiness] tableCounts", Object.fromEntries(counts.map((item) => [item.tableName, item.rowCount])));
  }
  console.log("[truth-readiness] readiness", {
    score: `${score}/100`,
    passed,
    total: checks.length,
    status: blockers.length === 0 ? "ready" : "blocked",
  });
  if (blockers.length > 0) {
    console.log("[truth-readiness] blockers");
    for (const blocker of blockers) console.log(`- ${blocker}`);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();

  const checks: Check[] = [];
  const truthCheck = truthStoreCheck();
  const database = envCheck("DATABASE_URL", "read-only Phase 1 schema verification");
  const directDatabase = envCheck("DIRECT_DATABASE_URL", "Phase 1 backfill safety checks");
  checks.push(truthCheck, database.check, directDatabase.check);

  let counts: TableCount[] = [];
  if (database.value) {
    try {
      const tableCheck = await tableExistenceCheck(database.value);
      checks.push(tableCheck.check);
      const emptyCheck = await tableEmptyCheck(database.value, tableCheck.existingTables);
      checks.push(emptyCheck.check);
      counts = emptyCheck.counts;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      checks.push({
        name: "Phase 1 database read",
        status: "fail",
        detail: reason,
        blocker: "Fix the Neon connection or schema permissions before running the backfill.",
      });
      checks.push({
        name: "Phase 1 tables are empty",
        status: "skip",
        detail: "skipped because database read failed",
        blocker: "Table emptiness cannot be verified until the database read succeeds.",
      });
    }
  } else {
    checks.push({
      name: "Phase 1 tables exist",
      status: "skip",
      detail: "skipped because DATABASE_URL is unavailable",
      blocker: "Set DATABASE_URL before checking Phase 1 tables.",
    });
    checks.push({
      name: "Phase 1 tables are empty",
      status: "skip",
      detail: "skipped because DATABASE_URL is unavailable",
      blocker: "Set DATABASE_URL before checking table emptiness.",
    });
  }

  printSummary(checks, counts);
  if (checks.some((check) => check.status !== "pass")) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[truth-readiness] failed", err);
  process.exitCode = 1;
});
