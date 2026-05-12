import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { getRawTruthStoreMode, getTruthStoreMode } from "../lib/truth/types";

const ROOT = process.cwd();
const ENV_FILES = [".env", ".env.local"];
const REQUIRED_PHASE1_TABLES = [
  "idempotency_keys",
  "execution_outcomes",
  "execution_outcome_latest",
  "company_current_state",
  "domain_events",
] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORE_DIRS = new Set([".git", ".next", "node_modules"]);
const NEON_SQL_ALLOWED = new Set([
  "lib/db/neon.ts",
  "lib/execution/executionOutcomeNeonAdapter.ts",
  "lib/state/companyCurrentStateNeonAdapter.ts",
  "lib/tracking/eventNeonAdapter.ts",
  "scripts/backfill-phase1-neon.ts",
  "scripts/check-truth-readiness.ts",
  "scripts/truth-audit.ts",
  "scripts/truth-barriers.ts",
]);
const NEON_WRITE_ALLOWED = new Set([
  "lib/execution/serverOutcomeStore.ts",
  "lib/state/companySnapshotStore.ts",
  "lib/tracking/eventLog.ts",
  "scripts/backfill-phase1-neon.ts",
  "scripts/truth-audit.ts",
  "scripts/truth-barriers.ts",
]);

type Status = "pass" | "warn" | "fail" | "skip";

type Check = {
  name: string;
  status: Status;
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

function describeDatabaseUrl(value: string): string {
  const parsed = new URL(value);
  const hostParts = parsed.hostname.split(".");
  const host = hostParts.length > 1
    ? [maskSegment(hostParts[0]), ...hostParts.slice(1)].join(".")
    : maskSegment(parsed.hostname);
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(none)";
  return `${host}/${maskSegment(database)}`;
}

function quoteIdent(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe table identifier: ${value}`);
  return `"${value}"`;
}

async function listSourceFiles(dir = ROOT): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(fullPath);
  }
  return files;
}

function rel(filePath: string): string {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

async function readSourceFiles(): Promise<Array<{ file: string; text: string }>> {
  const files = await listSourceFiles();
  return Promise.all(files.map(async (filePath) => ({
    file: rel(filePath),
    text: await fs.readFile(filePath, "utf8"),
  })));
}

function modeChecks(): Check[] {
  const raw = getRawTruthStoreMode();
  const mode = getTruthStoreMode();
  const checks: Check[] = [];

  if (raw === null) {
    checks.push({
      name: "Mode gating",
      status: "pass",
      detail: "MERIDIAN_TRUTH_STORE is unset; app resolves to file mode",
    });
  } else if (raw === "file") {
    checks.push({
      name: "Mode gating",
      status: "pass",
      detail: "MERIDIAN_TRUTH_STORE=file; app resolves to file mode",
    });
  } else if (raw === "dual" || raw === "neon") {
    checks.push({
      name: "Mode gating",
      status: "fail",
      detail: `MERIDIAN_TRUTH_STORE=${raw}`,
      blocker: "Do not enable dual or Neon mode before Phase 1 backfill readiness is clean.",
    });
  } else {
    checks.push({
      name: "Mode gating",
      status: "warn",
      detail: `MERIDIAN_TRUTH_STORE=${raw} is non-canonical and resolves to file mode`,
    });
  }

  const databaseUrl = postgresUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const directDatabaseUrl = postgresUrl(process.env.DIRECT_DATABASE_URL, "DIRECT_DATABASE_URL");
  const neonEnvPresent = Boolean(process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim());
  if (mode === "file" && neonEnvPresent) {
    checks.push({
      name: "Env safety",
      status: "warn",
      detail: "Neon env vars are configured while file mode remains active; runtime guards keep writes disabled",
    });
  } else {
    checks.push({
      name: "Env safety",
      status: "pass",
      detail: mode === "file" ? "No Neon env vars are active in file mode" : "Neon env vars are expected for enabled mode",
    });
  }

  checks.push(databaseUrl.ok
    ? {
        name: "DATABASE_URL",
        status: "pass",
        detail: `valid Postgres URL (${describeDatabaseUrl(databaseUrl.value)})`,
      }
    : {
        name: "DATABASE_URL",
        status: "fail",
        detail: databaseUrl.reason,
        blocker: "Set DATABASE_URL before verifying Phase 1 table readiness or dry-run backfill safety.",
      });
  checks.push(directDatabaseUrl.ok
    ? {
        name: "DIRECT_DATABASE_URL",
        status: "pass",
        detail: `valid Postgres URL (${describeDatabaseUrl(directDatabaseUrl.value)})`,
      }
    : {
        name: "DIRECT_DATABASE_URL",
        status: "fail",
        detail: directDatabaseUrl.reason,
        blocker: "Set DIRECT_DATABASE_URL before Phase 1 backfill dry-run/execute safety checks.",
      });
  return checks;
}

function adapterSelectionChecks(sources: Array<{ file: string; text: string }>): Check[] {
  const requiredSnippets: Array<{ file: string; snippet: string; detail: string }> = [
    {
      file: "lib/execution/serverOutcomeStore.ts",
      snippet: "if (mode === \"file\") return recordDurableOutcomeToFile(input);",
      detail: "execution outcomes write to file adapter first in file mode",
    },
    {
      file: "lib/tracking/eventLog.ts",
      snippet: "if (mode === \"file\") return writeEventToFile(event);",
      detail: "event log writes to file adapter first in file mode",
    },
    {
      file: "lib/state/companySnapshotStore.ts",
      snippet: "if (mode === \"file\") return recordToolResultToFile(company, result);",
      detail: "company snapshots write to file adapter first in file mode",
    },
    {
      file: "lib/state/companySnapshotStore.ts",
      snippet: "if (mode === \"file\") return setStatusToFile(company, change);",
      detail: "status updates write to file adapter first in file mode",
    },
    {
      file: "lib/state/companySnapshotStore.ts",
      snippet: "if (mode === \"file\") return setNextActionToFile(company, update);",
      detail: "next-action updates write to file adapter first in file mode",
    },
  ];
  return requiredSnippets.map((item) => {
    const source = sources.find((entry) => entry.file === item.file);
    if (source?.text.includes(item.snippet)) {
      return { name: "Adapter selection", status: "pass", detail: item.detail };
    }
    return {
      name: "Adapter selection",
      status: "fail",
      detail: `${item.file} missing expected file-mode branch`,
      blocker: `Restore explicit file-mode routing in ${item.file}.`,
    };
  });
}

function bypassChecks(sources: Array<{ file: string; text: string }>): Check[] {
  const checks: Check[] = [];
  const sqlBypasses = sources
    .filter((entry) => entry.text.includes("getNeonSql(") || entry.text.includes("@neondatabase/serverless"))
    .map((entry) => entry.file)
    .filter((file) => !NEON_SQL_ALLOWED.has(file));
  checks.push(sqlBypasses.length === 0
    ? {
        name: "No direct Neon SQL bypass",
        status: "pass",
        detail: "Neon SQL clients are confined to adapters and read-only/operator scripts",
      }
    : {
        name: "No direct Neon SQL bypass",
        status: "fail",
        detail: `unexpected direct Neon SQL usage: ${sqlBypasses.join(", ")}`,
        blocker: "Route runtime Neon access through gated truth-store facades or approved operator scripts.",
      });

  const writePattern = /\b(recordDurableOutcomeToNeon|upsertDurableOutcomeRecordToNeon|writeEventToNeon|upsertSnapshotToNeon|recordToolResultToNeon|setStatusToNeon|setNextActionToNeon)\b/;
  const writeBypasses = sources
    .filter((entry) => writePattern.test(entry.text))
    .map((entry) => entry.file)
    .filter((file) => !NEON_WRITE_ALLOWED.has(file) && !file.endsWith("NeonAdapter.ts"));
  checks.push(writeBypasses.length === 0
    ? {
        name: "No accidental Neon write bypass",
        status: "pass",
        detail: "Neon write helpers are only called by gated facades or the guarded backfill script",
      }
    : {
        name: "No accidental Neon write bypass",
        status: "fail",
        detail: `unexpected Neon write helper usage: ${writeBypasses.join(", ")}`,
        blocker: "Remove direct Neon write helper calls outside approved gated paths.",
      });

  const packageJson = readFileSync(path.join(ROOT, "package.json"), "utf8");
  checks.push(packageJson.includes("\"truth:backfill:dry\": \"tsx scripts/backfill-phase1-neon.ts --dry-run\"")
    ? {
        name: "Backfill dry-run command",
        status: "pass",
        detail: "truth:backfill:dry explicitly passes --dry-run",
      }
    : {
        name: "Backfill dry-run command",
        status: "fail",
        detail: "truth:backfill:dry is not explicitly dry-run",
        blocker: "Make truth:backfill:dry pass --dry-run before any operator use.",
      });

  const backfill = sources.find((entry) => entry.file === "scripts/backfill-phase1-neon.ts")?.text ?? "";
  checks.push(backfill.includes("MERIDIAN_BACKFILL_CONFIRM") && backfill.includes("argv.includes(\"--execute\")")
    ? {
        name: "Live backfill guard",
        status: "pass",
        detail: "live backfill requires --execute plus MERIDIAN_BACKFILL_CONFIRM=true",
      }
    : {
        name: "Live backfill guard",
        status: "fail",
        detail: "backfill execute confirmation guard was not found",
        blocker: "Restore explicit execute confirmation before live Neon writes are possible.",
      });

  if ((sources.find((entry) => entry.file === "app/api/pipeline/reset/route.ts")?.text ?? "").includes("companySnapshots.json")) {
    checks.push({
      name: "Architectural concern",
      status: "warn",
      detail: "pipeline reset mutates file snapshots directly; safe for file mode, but it will not clear Neon state after cutover",
    });
  }
  checks.push({
    name: "Phase 1 file fallback",
    status: "warn",
    detail: "profile, notes, paid presence, contact preferences, and deal actions intentionally remain file-only outside Phase 1 Neon coverage",
  });
  return checks;
}

async function tableReadinessChecks(databaseUrl: string | undefined): Promise<{ checks: Check[]; counts: TableCount[] }> {
  if (!databaseUrl) {
    return {
      counts: [],
      checks: [
        {
          name: "Phase 1 tables exist",
          status: "skip",
          detail: "skipped because DATABASE_URL is unavailable",
          blocker: "Set DATABASE_URL before verifying required Phase 1 tables.",
        },
        {
          name: "Phase 1 tables are empty",
          status: "skip",
          detail: "skipped because DATABASE_URL is unavailable",
          blocker: "Set DATABASE_URL before verifying pre-backfill table emptiness.",
        },
      ],
    };
  }

  const sql = neon(databaseUrl, { readOnly: true });
  try {
    const rows = await sql.query(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [REQUIRED_PHASE1_TABLES],
    ) as Array<{ table_name: string }>;
    const existing = new Set(rows.map((row) => row.table_name));
    const missing = REQUIRED_PHASE1_TABLES.filter((table) => !existing.has(table));
    if (missing.length > 0) {
      return {
        counts: [],
        checks: [
          {
            name: "Phase 1 tables exist",
            status: "fail",
            detail: `missing: ${missing.join(", ")}`,
            blocker: `Create missing Phase 1 table(s): ${missing.join(", ")}.`,
          },
          {
            name: "Phase 1 tables are empty",
            status: "skip",
            detail: "skipped because required tables are missing",
            blocker: "Table emptiness cannot be verified until all Phase 1 tables exist.",
          },
        ],
      };
    }

    const counts: TableCount[] = [];
    for (const tableName of REQUIRED_PHASE1_TABLES) {
      const countRows = await sql.query(
        `select count(*)::int as row_count from public.${quoteIdent(tableName)}`,
      ) as Array<{ row_count: number | string }>;
      counts.push({ tableName, rowCount: Number(countRows[0]?.row_count ?? 0) });
    }
    const nonEmpty = counts.filter((item) => item.rowCount > 0);
    return {
      counts,
      checks: [
        {
          name: "Phase 1 tables exist",
          status: "pass",
          detail: REQUIRED_PHASE1_TABLES.join(", "),
        },
        nonEmpty.length > 0
          ? {
              name: "Phase 1 tables are empty",
              status: "fail",
              detail: nonEmpty.map((item) => `${item.tableName}=${item.rowCount}`).join(", "),
              blocker: "Phase 1 tables must be empty before the initial file-to-Neon backfill.",
            }
          : {
              name: "Phase 1 tables are empty",
              status: "pass",
              detail: counts.map((item) => `${item.tableName}=0`).join(", "),
            },
      ],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      counts: [],
      checks: [
        {
          name: "Phase 1 database read",
          status: "fail",
          detail: reason,
          blocker: "Fix the Neon connection or schema permissions before dry-run backfill.",
        },
        {
          name: "Phase 1 tables are empty",
          status: "skip",
          detail: "skipped because database read failed",
          blocker: "Table emptiness cannot be verified until the database read succeeds.",
        },
      ],
    };
  }
}

function readinessScore(checks: Check[]): number {
  const total = checks.length;
  const points = checks.reduce((sum, check) => {
    if (check.status === "pass") return sum + 1;
    if (check.status === "warn") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((points / total) * 100);
}

function printReport(checks: Check[], counts: TableCount[]): void {
  const blockers = checks.flatMap((check) => check.blocker ? [`${check.name}: ${check.blocker}`] : []);
  const warnings = checks.filter((check) => check.status === "warn").map((check) => `${check.name}: ${check.detail}`);
  const unsafe = checks.filter((check) => check.name.includes("bypass") && check.status === "fail");
  const score = readinessScore(checks);
  const status = blockers.length === 0 ? "ready" : "blocked";

  console.log("[truth-audit] operational summary");
  console.log(`readinessScore=${score}/100 status=${status}`);
  console.log(`mode=${getTruthStoreMode()} rawMode=${getRawTruthStoreMode() ?? "(unset)"}`);
  console.log(`phase1DryRunBackfill=${blockers.length === 0 ? "safe" : "blocked"}`);
  console.log("");
  console.log("[truth-audit] checks");
  for (const check of checks) {
    const marker = check.status.toUpperCase().padEnd(4, " ");
    console.log(`- ${marker} ${check.name}: ${check.detail}`);
  }
  if (counts.length > 0) {
    console.log("[truth-audit] tableCounts", Object.fromEntries(counts.map((item) => [item.tableName, item.rowCount])));
  }
  console.log("");
  console.log("[truth-audit] blockers");
  if (blockers.length === 0) {
    console.log("- none");
  } else {
    for (const blocker of blockers) console.log(`- ${blocker}`);
  }
  console.log("[truth-audit] unsafeCodePaths");
  if (unsafe.length === 0) {
    console.log("- none found for MERIDIAN_TRUTH_STORE unset/file runtime paths");
  } else {
    for (const item of unsafe) console.log(`- ${item.detail}`);
  }
  console.log("[truth-audit] architecturalConcerns");
  if (warnings.length === 0) {
    console.log("- none");
  } else {
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const sources = await readSourceFiles();
  const databaseUrl = postgresUrl(process.env.DATABASE_URL, "DATABASE_URL");
  const tableReadiness = await tableReadinessChecks(databaseUrl.ok ? databaseUrl.value : undefined);
  const checks = [
    ...modeChecks(),
    ...adapterSelectionChecks(sources),
    ...bypassChecks(sources),
    ...tableReadiness.checks,
  ];

  printReport(checks, tableReadiness.counts);
  if (checks.some((check) => check.blocker)) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[truth-audit] failed", err);
  process.exitCode = 1;
});
