/**
 * Meridian Operations Center — runner.
 *
 * Runs the EXISTING validation scripts (package.json), plus read-only
 * git facts, and consolidates them into one operator snapshot:
 * BLOCKING / REVIEW / HEALTHY. Writes data/ops/ops-report.json and
 * prints a board. Reads nothing from Neon directly and changes no
 * product logic — it only shells out to checks that already exist.
 *
 * Usage:
 *   npm run ops              # run all checks, print board, write snapshot
 *   npm run ops -- --quiet   # write snapshot only
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { promises as fs } from "node:fs";
import fssync from "node:fs";
import path from "node:path";
import {
  OPS_CHECKS,
  classifyOverall,
  deploymentStatus,
  parseCrmAuditVerdict,
  resolveCheckStatus,
  summarizeCounts,
  type CheckOutcome,
  type OpsCheckResult,
  type OpsDeployment,
  type OpsReport,
} from "@/lib/ops/opsCenter";
import { saveOpsReport, OPS_REPORT_PATH } from "@/lib/ops/opsReportStore";

const ROOT = process.cwd();
const CHECK_TIMEOUT_MS = 120_000;

/** Populate process.env from .env.local (only keys not already set) so
 *  Neon-backed checks can run via a bare `npm run ops`. Read-only. */
function bootstrapEnv(): void {
  const p = path.join(ROOT, ".env.local");
  if (!fssync.existsSync(p)) return;
  for (const line of fssync.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    process.env[key] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}

function lastMeaningfulLine(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  // Prefer an explicit pass/summary line over raw JSON tails like "}".
  const summary = [...lines].reverse().find((l) => /passed|present|✓|PASSED|✗|FAIL|Usage:/i.test(l));
  return (summary ?? lines[lines.length - 1]).slice(0, 160);
}

function runNpmCheck(script: string): { outcome: CheckOutcome; detail: string; durationMs: number } {
  const start = Date.now();
  const opts: ExecSyncOptions = { cwd: ROOT, timeout: CHECK_TIMEOUT_MS, env: process.env, stdio: ["ignore", "pipe", "pipe"] };
  try {
    const out = execSync(`npm run --silent ${script}`, opts).toString();
    return { outcome: "PASS", detail: lastMeaningfulLine(out) || "passed", durationMs: Date.now() - start };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer; signal?: string };
    const stdout = e.stdout?.toString() ?? "";
    const stderr = e.stderr?.toString() ?? "";
    const combined = `${stdout}\n${stderr}`;
    const durationMs = Date.now() - start;
    if (/ERR_MODULE_NOT_FOUND|Cannot find module/.test(combined)) {
      return { outcome: "NEEDS_CONFIG", detail: "tooling missing — referenced script file not found", durationMs };
    }
    if (e.status === 2 || /Usage:/i.test(combined)) {
      return { outcome: "NEEDS_CONFIG", detail: lastMeaningfulLine(combined) || "requires arguments", durationMs };
    }
    if (e.signal === "SIGTERM") {
      return { outcome: "FAIL", detail: `timed out after ${CHECK_TIMEOUT_MS / 1000}s`, durationMs };
    }
    return { outcome: "FAIL", detail: lastMeaningfulLine(combined) || `exit ${e.status ?? "?"}`, durationMs };
  }
}

/**
 * Run a script (with optional `-- --customer=…`) and return its full
 * stdout for verdict parsing. crm:audit always exits 0; a nonzero exit
 * means it genuinely crashed (DB error, etc.) → reported as crashed.
 */
function runNpmRaw(
  script: string,
  extraArgs: string,
): { stdout: string; crashed: boolean; detail: string; durationMs: number } {
  const start = Date.now();
  const opts: ExecSyncOptions = { cwd: ROOT, timeout: CHECK_TIMEOUT_MS, env: process.env, stdio: ["ignore", "pipe", "pipe"] };
  const cmd = `npm run --silent ${script}${extraArgs ? ` -- ${extraArgs}` : ""}`;
  try {
    const out = execSync(cmd, opts).toString();
    return { stdout: out, crashed: false, detail: "", durationMs: Date.now() - start };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; signal?: string; status?: number };
    const stdout = e.stdout?.toString() ?? "";
    const stderr = e.stderr?.toString() ?? "";
    const detail =
      e.signal === "SIGTERM"
        ? `timed out after ${CHECK_TIMEOUT_MS / 1000}s`
        : lastMeaningfulLine(`${stdout}\n${stderr}`) || `exit ${e.status ?? "?"}`;
    return { stdout, crashed: true, detail, durationMs: Date.now() - start };
  }
}

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function computeDeployment(): OpsDeployment {
  const branch = git("branch --show-current") || "(detached)";
  const head = git("rev-parse --short HEAD") || "(unknown)";
  const aheadStr = git("rev-list --count origin/main..HEAD");
  const aheadOfMain = Number.parseInt(aheadStr || "0", 10) || 0;
  const ciConfigured =
    fssync.existsSync(path.join(ROOT, ".github", "workflows")) &&
    fssync.readdirSync(path.join(ROOT, ".github", "workflows")).some((f) => /\.ya?ml$/.test(f));
  const productionTracksMain = branch === "main" && aheadOfMain === 0;
  const noteParts: string[] = [];
  if (!ciConfigured) noteParts.push("no CI workflows");
  if (aheadOfMain > 0) noteParts.push(`${aheadOfMain} commits ahead of main (production may run an unmerged branch)`);
  const note = noteParts.join("; ") || "on main, CI present";
  return { branch, head, aheadOfMain, ciConfigured, productionTracksMain, note };
}

const STATUS_GLYPH = { HEALTHY: "✓", REVIEW: "▲", BLOCKING: "✗" } as const;

async function main(): Promise<void> {
  const quiet = process.argv.includes("--quiet");
  bootstrapEnv();
  const hasNeon = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

  const results: OpsCheckResult[] = [];
  for (const def of OPS_CHECKS) {
    let outcome: CheckOutcome;
    let detail: string;
    let durationMs: number | undefined;
    let statusOverride: OpsCheckResult["status"] | undefined;
    if (def.needsNeon && !hasNeon) {
      outcome = "SKIPPED";
      detail = "skipped — DATABASE_URL not set (verification incomplete)";
    } else if (!def.npmScript) {
      outcome = "SKIPPED";
      detail = "no runner";
    } else if (def.kind === "verdict") {
      // Live-data signal: run the script, then map its OWN verdict to a
      // status (crm:audit always exits 0). Status comes from the parser,
      // never the exit code.
      const arg = def.customerArg ? `--customer=${def.customerArg}` : "";
      if (!quiet) process.stderr.write(`  running ${def.npmScript} ${arg} (verdict) …\n`);
      const r = runNpmRaw(def.npmScript, arg);
      durationMs = r.durationMs;
      if (r.crashed) {
        // Could not verify → fail safe to REVIEW (never HEALTHY).
        outcome = "NEEDS_CONFIG";
        detail = `${def.npmScript} could not run: ${r.detail}`;
        statusOverride = "REVIEW";
      } else {
        const v = parseCrmAuditVerdict(r.stdout);
        outcome = v.outcome;
        detail = v.detail;
        statusOverride = v.status;
      }
    } else {
      if (!quiet) process.stderr.write(`  running ${def.npmScript} …\n`);
      const r = runNpmCheck(def.npmScript);
      outcome = r.outcome;
      detail = r.detail;
      durationMs = r.durationMs;
    }
    results.push({
      id: def.id,
      label: def.label,
      category: def.category,
      outcome,
      status: statusOverride ?? resolveCheckStatus(def, outcome),
      detail,
      durationMs,
    });
  }

  const deployment = computeDeployment();
  const depStatus = deploymentStatus(deployment);
  const overall = classifyOverall(results, depStatus);
  const counts = summarizeCounts(results, depStatus);
  const report: OpsReport = {
    generatedAt: new Date().toISOString(),
    overall,
    counts,
    deployment,
    checks: results,
  };

  const where = await saveOpsReport(report);

  if (!quiet) {
    const bar = "─".repeat(60);
    console.log(`\n${bar}`);
    console.log(`  MERIDIAN OPERATIONS CENTER — ${overall}`);
    console.log(`  ${counts.blocking} blocking · ${counts.review} review · ${counts.healthy} healthy`);
    console.log(bar);
    const order = ["BLOCKING", "REVIEW", "HEALTHY"] as const;
    const byCat: Record<string, OpsCheckResult[]> = {};
    for (const r of results) (byCat[r.category] = byCat[r.category] || []).push(r);
    for (const status of order) {
      const rows = results.filter((r) => r.status === status);
      if (!rows.length) continue;
      console.log(`\n  ${STATUS_GLYPH[status]} ${status}`);
      for (const r of rows) console.log(`    [${r.category}] ${r.label} — ${r.detail}`);
    }
    console.log(`\n  ${STATUS_GLYPH[depStatus]} DEPLOYMENT (${depStatus})`);
    console.log(`    branch ${deployment.branch} @ ${deployment.head} — ${deployment.note}`);
    console.log(`\n  snapshot: ${where}`);
    console.log(`${bar}\n`);
  }

  // Exit nonzero on BLOCKING so this can also gate CI if desired.
  process.exit(overall === "BLOCKING" ? 1 : 0);
}

main().catch((err) => {
  console.error("[ops-center] runner error:", err);
  process.exit(1);
});
