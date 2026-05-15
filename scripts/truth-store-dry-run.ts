// Meridian — truth-store dry-run reconciliation.
//
// Reads from both the file and Neon backends and reports differences.
// Writes nothing. Safe to run on staging or production. Designed for the
// dual-mode soak window: run daily and confirm row counts + a sample of
// outcomes agree before flipping MERIDIAN_TRUTH_STORE=neon.
//
// Usage:
//   tsx scripts/truth-store-dry-run.ts                # default workspace=labortech
//   tsx scripts/truth-store-dry-run.ts --workspace=labortech
//   tsx scripts/truth-store-dry-run.ts --workspace=labortech --sample=5
//
// Exit code:
//   0  counts agree, sample agrees
//   1  mismatch detected
//   2  configuration error (e.g. DATABASE_URL missing)

import { config as loadEnv } from "node:process";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// Minimal env-file loader (matches scripts/check-truth-readiness.ts style)
// so this script works without `dotenv`.
function loadDotEnv(): void {
  void loadEnv;
  const root = process.cwd();
  for (const name of [".env.local", ".env"]) {
    const filePath = path.join(root, name);
    if (!existsSync(filePath)) continue;
    for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const noExport = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
      const eq = noExport.indexOf("=");
      if (eq <= 0) continue;
      const key = noExport.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;
      let value = noExport.slice(eq + 1).trim();
      const q = value[0];
      if ((q === "\"" || q === "'") && value.endsWith(q)) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

function parseArgs(argv: string[]): { workspace: string; sample: number } {
  let workspace = "labortech";
  let sample = 3;
  for (const arg of argv) {
    if (arg.startsWith("--workspace=")) workspace = arg.slice("--workspace=".length).trim();
    else if (arg.startsWith("--sample=")) {
      const n = Number(arg.slice("--sample=".length));
      if (Number.isFinite(n) && n >= 0) sample = Math.floor(n);
    }
  }
  return { workspace, sample };
}

async function main(): Promise<number> {
  loadDotEnv();
  const { workspace, sample } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error("[dry-run] DATABASE_URL not set — cannot read from Neon.");
    return 2;
  }

  // Import after env load so getNeonSql sees DATABASE_URL.
  const fileAdapter = await import("../lib/execution/executionOutcomeFileAdapter");
  const neonAdapter = await import("../lib/execution/executionOutcomeNeonAdapter");

  console.log(`[dry-run] workspace=${workspace} sample=${sample}`);

  const [fileRows, neonRows] = await Promise.all([
    fileAdapter.listDurableOutcomesFromFile(workspace),
    neonAdapter.listDurableOutcomesFromNeon(workspace).catch((err: unknown) => {
      console.error("[dry-run] Neon read failed:", err instanceof Error ? err.message : err);
      return [] as Awaited<ReturnType<typeof neonAdapter.listDurableOutcomesFromNeon>>;
    }),
  ]);

  console.log(`[dry-run] file_rows=${fileRows.length} neon_rows=${neonRows.length}`);

  const fileById = new Map(fileRows.map((row) => [row.eventId, row]));
  const neonById = new Map(neonRows.map((row) => [row.eventId, row]));

  const onlyInFile: string[] = [];
  const onlyInNeon: string[] = [];
  for (const id of fileById.keys()) if (!neonById.has(id)) onlyInFile.push(id);
  for (const id of neonById.keys()) if (!fileById.has(id)) onlyInNeon.push(id);

  const mismatches: Array<{ eventId: string; field: string; file: unknown; neon: unknown }> = [];
  for (const [id, fileRow] of fileById) {
    const neonRow = neonById.get(id);
    if (!neonRow) continue;
    const checks: Array<[string, unknown, unknown]> = [
      ["outcomeStatus", fileRow.outcomeStatus, neonRow.outcomeStatus],
      ["nextStatus", fileRow.nextStatus, neonRow.nextStatus],
      ["companyKey", fileRow.companyKey, neonRow.companyKey],
      ["operatorId", fileRow.operatorId, neonRow.operatorId],
    ];
    for (const [field, fileVal, neonVal] of checks) {
      if (fileVal !== neonVal) mismatches.push({ eventId: id, field, file: fileVal, neon: neonVal });
    }
  }

  if (onlyInFile.length > 0) {
    console.warn(`[dry-run] only_in_file count=${onlyInFile.length} sample=${onlyInFile.slice(0, sample).join(",")}`);
  }
  if (onlyInNeon.length > 0) {
    console.warn(`[dry-run] only_in_neon count=${onlyInNeon.length} sample=${onlyInNeon.slice(0, sample).join(",")}`);
  }
  if (mismatches.length > 0) {
    console.warn(`[dry-run] field_mismatches count=${mismatches.length}`);
    for (const m of mismatches.slice(0, sample)) {
      console.warn(
        `[dry-run] mismatch event=${m.eventId} field=${m.field} file=${JSON.stringify(m.file)} neon=${JSON.stringify(m.neon)}`,
      );
    }
  }

  const ok = onlyInFile.length === 0 && onlyInNeon.length === 0 && mismatches.length === 0;
  if (ok) {
    console.log("[dry-run] result=match");
    return 0;
  }
  console.log("[dry-run] result=mismatch");
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("[dry-run] unexpected error:", err);
  process.exit(2);
});
