import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { getRawTruthStoreMode, getTruthStoreMode } from "../lib/truth/types";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORE_DIRS = new Set([".git", ".next", "node_modules"]);

type Check = {
  name: string;
  status: "pass" | "fail";
  detail: string;
  blocker?: string;
};

type SourceFile = {
  file: string;
  text: string;
};

const MUTATION_ENTRY_POINTS = [
  {
    file: "lib/execution/executionOutcomeNeonAdapter.ts",
    name: "insertOutcome",
    operation: "execution outcome insert",
  },
  {
    file: "lib/execution/executionOutcomeNeonAdapter.ts",
    name: "upsertDurableOutcomeRecordToNeon",
    operation: "execution outcome upsert",
  },
  {
    file: "lib/execution/executionOutcomeNeonAdapter.ts",
    name: "recordDurableOutcomeToNeon",
    operation: "execution outcome record",
  },
  {
    file: "lib/tracking/eventNeonAdapter.ts",
    name: "writeEventToNeon",
    operation: "domain event write",
  },
  {
    file: "lib/state/companyCurrentStateNeonAdapter.ts",
    name: "upsertSnapshotToNeon",
    operation: "company snapshot upsert",
  },
  {
    file: "lib/state/companyCurrentStateNeonAdapter.ts",
    name: "recordToolResultToNeon",
    operation: "company snapshot recordToolResult",
  },
  {
    file: "lib/state/companyCurrentStateNeonAdapter.ts",
    name: "setStatusToNeon",
    operation: "company snapshot setStatus",
  },
  {
    file: "lib/state/companyCurrentStateNeonAdapter.ts",
    name: "setNextActionToNeon",
    operation: "company snapshot setNextAction",
  },
] as const;

const GET_NEON_SQL_ALLOWED = new Set([
  "lib/db/neon.ts",
  "lib/execution/executionOutcomeNeonAdapter.ts",
  "lib/state/companyCurrentStateNeonAdapter.ts",
  "lib/tracking/eventNeonAdapter.ts",
  "scripts/backfill-phase1-neon.ts",
  "scripts/truth-audit.ts",
  "scripts/truth-barriers.ts",
]);

const DML_ALLOWED = new Set([
  "lib/execution/executionOutcomeNeonAdapter.ts",
  "lib/state/companyCurrentStateNeonAdapter.ts",
  "lib/tracking/eventNeonAdapter.ts",
]);

const WRITE_HELPER_ALLOWED = new Set([
  "lib/execution/serverOutcomeStore.ts",
  "lib/state/companySnapshotStore.ts",
  "lib/tracking/eventLog.ts",
  "scripts/backfill-phase1-neon.ts",
  "scripts/truth-audit.ts",
  "scripts/truth-barriers.ts",
]);

function rel(filePath: string): string {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
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

async function readSources(): Promise<SourceFile[]> {
  const files = await listSourceFiles();
  return Promise.all(files.map(async (filePath) => ({
    file: rel(filePath),
    text: await fs.readFile(filePath, "utf8"),
  })));
}

function sourceFor(sources: SourceFile[], file: string): string {
  return sources.find((source) => source.file === file)?.text ?? "";
}

function mutationEntryChecks(sources: SourceFile[]): Check[] {
  return MUTATION_ENTRY_POINTS.map((entry) => {
    const text = sourceFor(sources, entry.file);
    const hasEntry = text.includes(entry.name);
    const hasBarrierImport = text.includes("assertNeonMutationAllowed");
    const hasOperation = text.includes(`"${entry.operation}"`);
    if (hasEntry && hasBarrierImport && hasOperation) {
      return {
        name: "Mutation entry barrier",
        status: "pass",
        detail: `${entry.file}:${entry.name} guarded by mutation barrier`,
      };
    }
    return {
      name: "Mutation entry barrier",
      status: "fail",
      detail: `${entry.file}:${entry.name} missing barrier operation ${entry.operation}`,
      blocker: `Add assertNeonMutationAllowed before mutation work in ${entry.name}.`,
    };
  });
}

function directSqlChecks(sources: SourceFile[]): Check[] {
  const checks: Check[] = [];
  const getNeonSqlBypasses = sources
    .filter((source) => source.text.includes("getNeonSql("))
    .map((source) => source.file)
    .filter((file) => !GET_NEON_SQL_ALLOWED.has(file));
  checks.push(getNeonSqlBypasses.length === 0
    ? {
        name: "getNeonSql boundary",
        status: "pass",
        detail: "getNeonSql usage is confined to approved adapters and operator scripts",
      }
    : {
        name: "getNeonSql boundary",
        status: "fail",
        detail: `unexpected getNeonSql usage: ${getNeonSqlBypasses.join(", ")}`,
        blocker: "Route Neon SQL access through approved adapters or read-only operator scripts.",
      });

  const directNeonClients = sources
    .filter((source) => source.file !== "lib/db/neon.ts")
    .filter((source) => source.file !== "scripts/truth-barriers.ts")
    .filter((source) => /\bneon\s*\(/.test(source.text))
    .filter((source) => !source.text.includes("readOnly: true"))
    .map((source) => source.file);
  checks.push(directNeonClients.length === 0
    ? {
        name: "Direct Neon client policy",
        status: "pass",
        detail: "direct neon() clients outside lib/db/neon.ts are read-only",
      }
    : {
        name: "Direct Neon client policy",
        status: "fail",
        detail: `direct writable-looking neon() clients: ${directNeonClients.join(", ")}`,
        blocker: "Use getNeonSql plus the mutation barrier for writes, or neon(..., { readOnly: true }) for operator reads.",
      });

  const dmlPattern = /\b(insert\s+into|update\s+[a-z_][a-z0-9_]*|delete\s+from|do\s+update\s+set)\b/i;
  const dmlBypasses = sources
    .filter((source) => source.text.includes("getNeonSql(") || source.text.includes("@neondatabase/serverless"))
    .filter((source) => dmlPattern.test(source.text))
    .map((source) => source.file)
    .filter((file) => !DML_ALLOWED.has(file) && !file.startsWith("scripts/truth-"));
  checks.push(dmlBypasses.length === 0
    ? {
        name: "DML location policy",
        status: "pass",
        detail: "Neon DML is confined to approved Neon adapter files",
      }
    : {
        name: "DML location policy",
        status: "fail",
        detail: `DML-like SQL outside approved adapters: ${dmlBypasses.join(", ")}`,
        blocker: "Move Neon mutation SQL behind an approved adapter and assertNeonMutationAllowed.",
      });
  return checks;
}

function writeHelperChecks(sources: SourceFile[]): Check[] {
  const writePattern = /\b(recordDurableOutcomeToNeon|upsertDurableOutcomeRecordToNeon|writeEventToNeon|upsertSnapshotToNeon|recordToolResultToNeon|setStatusToNeon|setNextActionToNeon)\b/;
  const bypasses = sources
    .filter((source) => writePattern.test(source.text))
    .map((source) => source.file)
    .filter((file) => !WRITE_HELPER_ALLOWED.has(file) && !file.endsWith("NeonAdapter.ts"));
  return [bypasses.length === 0
    ? {
        name: "Write helper boundary",
        status: "pass",
        detail: "Neon write helpers are only called by gated facades, adapters, or the guarded backfill script",
      }
    : {
        name: "Write helper boundary",
        status: "fail",
        detail: `unexpected Neon write helper calls: ${bypasses.join(", ")}`,
        blocker: "Remove direct route/job calls to Neon write helpers.",
      }];
}

function backfillChecks(sources: SourceFile[]): Check[] {
  const packageJson = readFileSync(path.join(ROOT, "package.json"), "utf8");
  const backfill = sourceFor(sources, "scripts/backfill-phase1-neon.ts");
  const checks: Check[] = [];
  checks.push(packageJson.includes("\"truth:backfill:dry\": \"tsx scripts/backfill-phase1-neon.ts --dry-run\"")
    ? {
        name: "Dry-run command",
        status: "pass",
        detail: "truth:backfill:dry explicitly passes --dry-run",
      }
    : {
        name: "Dry-run command",
        status: "fail",
        detail: "truth:backfill:dry is not explicitly dry-run",
        blocker: "Make truth:backfill:dry pass --dry-run.",
      });
  checks.push(backfill.includes("DRY RUN ONLY") && backfill.includes("WRITE EXECUTION ENABLED")
    ? {
        name: "Backfill execution logging",
        status: "pass",
        detail: "backfill logs dry-run and write-execution modes explicitly",
      }
    : {
        name: "Backfill execution logging",
        status: "fail",
        detail: "backfill execution mode logs are missing",
        blocker: "Add explicit DRY RUN ONLY and WRITE EXECUTION ENABLED logs.",
      });
  checks.push(backfill.includes("assertNeonMutationAllowed") && backfill.includes("MERIDIAN_BACKFILL_CONFIRM")
    ? {
        name: "Backfill mutation barrier",
        status: "pass",
        detail: "live backfill is guarded by central mutation barrier and backfill confirmation",
      }
    : {
        name: "Backfill mutation barrier",
        status: "fail",
        detail: "backfill barrier or confirmation is missing",
        blocker: "Guard live backfill execution with assertNeonMutationAllowed and MERIDIAN_BACKFILL_CONFIRM.",
      });
  return checks;
}

function printReport(checks: Check[]): void {
  const blockers = checks.flatMap((check) => check.blocker ? [`${check.name}: ${check.blocker}`] : []);
  const passed = checks.filter((check) => check.status === "pass").length;
  const score = Math.round((passed / checks.length) * 100);
  console.log("[truth-barriers] mutation barrier summary");
  console.log(`coverageScore=${score}/100 status=${blockers.length === 0 ? "ready" : "blocked"}`);
  console.log(`mode=${getTruthStoreMode()} rawMode=${getRawTruthStoreMode() ?? "(unset)"}`);
  console.log("[truth-barriers] mutationEntryPoints");
  for (const entry of MUTATION_ENTRY_POINTS) {
    console.log(`- ${entry.file}:${entry.name} (${entry.operation})`);
  }
  console.log("[truth-barriers] checks");
  for (const check of checks) {
    console.log(`- ${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
  }
  console.log("[truth-barriers] blockers");
  if (blockers.length === 0) {
    console.log("- none");
  } else {
    for (const blocker of blockers) console.log(`- ${blocker}`);
  }
}

async function main(): Promise<void> {
  const sources = await readSources();
  const checks = [
    ...mutationEntryChecks(sources),
    ...directSqlChecks(sources),
    ...writeHelperChecks(sources),
    ...backfillChecks(sources),
  ];
  printReport(checks);
  if (checks.some((check) => check.status === "fail")) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[truth-barriers] failed", err);
  process.exitCode = 1;
});
