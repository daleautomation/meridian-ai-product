#!/usr/bin/env tsx
/**
 * Meridian Heartbeat v2 — Phase 1 observer runner.
 *
 * Observer-only · Read-only · Writes only to generated/heartbeat/
 */
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE1_CHECKS } from "./manifest";
import {
  buildRegressionSummary,
  renderBriefTodayMarkdown,
  renderHistoryJson,
  renderLatestMarkdown,
} from "./report";
import { collectWorkspaceHealth, type WorkspaceHealthReport } from "./workspace-health";
import { buildApprovalQueue, type ApprovalQueueItem } from "./approval-queue";
import { buildDailyWorkflow, type DailyWorkflow } from "./daily-workflow";
import type { CheckResult, CheckStatus, HeartbeatRun } from "./types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTPUT_DIR = path.join(ROOT, "generated/heartbeat");
const HISTORY_DIR = path.join(OUTPUT_DIR, "history");

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function runCheck(script: string): Omit<CheckResult, "id" | "label" | "description"> & {
  script: string;
} {
  const start = Date.now();
  const result = spawnSync("npm", ["run", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env },
    maxBuffer: 10 * 1024 * 1024,
  });
  const durationMs = Date.now() - start;

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();

  let status: CheckStatus;
  let exitCode: number | null = result.status;

  if (result.error) {
    status = "error";
    exitCode = null;
  } else if (exitCode === 0) {
    status = "pass";
  } else {
    status = "fail";
  }

  return { script, status, exitCode, durationMs, output };
}

async function ensureOutputDirs(): Promise<void> {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
}

async function loadPriorRun(today: string): Promise<HeartbeatRun | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(HISTORY_DIR);
  } catch {
    return null;
  }

  const priorFiles = entries
    .filter((f) => f.endsWith(".json") && f.slice(0, 10) < today)
    .sort()
    .reverse();

  for (const file of priorFiles) {
    try {
      const raw = await fs.readFile(path.join(HISTORY_DIR, file), "utf8");
      return JSON.parse(raw) as HeartbeatRun;
    } catch {
      continue;
    }
  }

  return null;
}

async function writeOutputs(
  run: HeartbeatRun,
  regression: ReturnType<typeof buildRegressionSummary>,
  workspaceHealth: WorkspaceHealthReport | null,
  approvalQueue: ApprovalQueueItem[],
  workflow: DailyWorkflow,
): Promise<void> {
  const latest = renderLatestMarkdown(run, regression, workspaceHealth, approvalQueue, workflow);
  const brief = renderBriefTodayMarkdown(run, regression, workspaceHealth, approvalQueue, workflow);
  const history = renderHistoryJson(run, regression);

  await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, "latest.md"), latest, "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, `${run.date}.md`), latest, "utf8"),
    fs.writeFile(path.join(HISTORY_DIR, `${run.date}.json`), history, "utf8"),
    fs.writeFile(path.join(OUTPUT_DIR, "brief-today.md"), brief, "utf8"),
  ]);
}

async function main(): Promise<void> {
  const date = todayDate();
  const runAt = new Date().toISOString();

  console.log("Meridian Heartbeat v2 — Phase 1 (observer-only)");
  console.log(`Run date: ${date}`);
  console.log(`Checks: ${PHASE1_CHECKS.length}`);
  console.log("");

  await ensureOutputDirs();

  const checks: CheckResult[] = PHASE1_CHECKS.map((def) => {
    process.stdout.write(`→ ${def.label} (${def.script})… `);
    const result = runCheck(def.script);
    const icon = result.status === "pass" ? "✓" : result.status === "fail" ? "✗" : "!";
    console.log(`${icon} ${result.durationMs}ms`);
    return { ...def, ...result };
  });

  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
    errored: checks.filter((c) => c.status === "error").length,
  };

  const run: HeartbeatRun = { runAt, date, checks, summary };
  const prior = await loadPriorRun(date);
  const regression = buildRegressionSummary(run, prior);

  // Evidence-first workspace health: reads data/**, writes only its baseline snapshot.
  const workspaceHealth = await collectWorkspaceHealth(ROOT);

  // CEO Approval Queue: pure derivation from observed evidence. No execution.
  const approvalQueue = buildApprovalQueue(run, workspaceHealth);

  // CEO Daily Workflow: synthesizes priorities/blocked/opportunities from evidence.
  const workflow = buildDailyWorkflow(run, workspaceHealth, approvalQueue);

  await writeOutputs(run, regression, workspaceHealth, approvalQueue, workflow);

  console.log("");
  console.log(`Summary: ${summary.passed}/${summary.total} passed`);
  console.log(`Reports → generated/heartbeat/latest.md`);
  console.log(`Brief   → generated/heartbeat/brief-today.md`);

  if (summary.failed > 0 || summary.errored > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Heartbeat runner failed:", err);
  process.exit(1);
});
