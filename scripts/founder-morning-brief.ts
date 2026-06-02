/**
 * Founder Morning Brief — revenue-first daily prioritization for Dylan.
 *
 * Not a repo report. Answers: "What is the highest leverage use of Dylan today?"
 * Reads repo/ops evidence read-only; outputs markdown.
 *
 * Usage:
 *   npm run founder:brief              # use cached ops snapshot if present
 *   npm run founder:brief -- --refresh # run npm run ops --quiet first
 *   npm run founder:brief -- --dry-run # stdout only, no file write
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import fssync from "node:fs";
import path from "node:path";

import {
  composeBrief,
  type BriefEvidence,
  type GitEvidence,
  type OpsEvidence,
  type WeeklyStateEvidence,
} from "@/lib/founder-brief/composeBrief";
import { isoWeekId } from "@/lib/personal-workspace/weeklyState";
import { loadOpsReport } from "@/lib/ops/opsReportStore";
import { MERIDIAN_DATA_DIR } from "@/lib/meridianDataPaths";

const ROOT = process.cwd();
const BRIEF_DIR = path.join(MERIDIAN_DATA_DIR, "founder-brief");
const PRIMARY_CUSTOMER = "nicole-lonergan";
const OPS_STALE_MS = 24 * 60 * 60 * 1000;

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function collectGit(): GitEvidence {
  const branch = git("branch --show-current") || "(detached)";
  const head = git("rev-parse --short HEAD") || "(unknown)";
  const aheadStr = git("rev-list --count origin/main..HEAD");
  const aheadOfMain = Number.parseInt(aheadStr || "0", 10) || 0;

  let changedPaths: string[] = [];
  const porcelain = git("status --porcelain");
  if (porcelain) {
    changedPaths = porcelain
      .split("\n")
      .map((line) => {
        const rest = line.slice(3).trim();
        // Handle renames "old -> new"
        const arrow = rest.indexOf(" -> ");
        return arrow >= 0 ? rest.slice(arrow + 4) : rest;
      })
      .filter(Boolean);
  }

  const recentCommits = git('log -5 --format="%s"')
    .split("\n")
    .map((s) => s.replace(/^"|"$/g, "").trim())
    .filter(Boolean);

  return {
    branch,
    head,
    aheadOfMain,
    dirty: changedPaths.length > 0,
    changedPaths,
    recentCommits,
  };
}

async function collectWeekly(now: Date): Promise<WeeklyStateEvidence> {
  const currentWeekId = isoWeekId(now);
  const snapshotPath = path.join(MERIDIAN_DATA_DIR, "weekly-state", PRIMARY_CUSTOMER, `${currentWeekId}.json`);
  let snapshotExists = false;
  let snapshotAgeHours: number | null = null;

  try {
    const stat = await fs.stat(snapshotPath);
    snapshotExists = stat.isFile();
    if (snapshotExists) {
      snapshotAgeHours = (now.getTime() - stat.mtimeMs) / (60 * 60 * 1000);
    }
  } catch {
    snapshotExists = false;
  }

  return {
    customer: PRIMARY_CUSTOMER,
    currentWeekId,
    snapshotExists,
    snapshotAgeHours,
  };
}

async function collectOps(now: Date): Promise<OpsEvidence> {
  const report = await loadOpsReport();
  if (!report) {
    return {
      present: false,
      generatedAt: null,
      stale: false,
      overall: null,
      counts: null,
      deployment: null,
      checks: [],
    };
  }

  const generatedMs = Date.parse(report.generatedAt);
  const stale = Number.isFinite(generatedMs) && now.getTime() - generatedMs > OPS_STALE_MS;

  return {
    present: true,
    generatedAt: report.generatedAt,
    stale,
    overall: report.overall,
    counts: report.counts,
    deployment: report.deployment,
    checks: report.checks,
  };
}

async function collectDocs(): Promise<BriefEvidence["docs"]> {
  const founderRunbook = fssync.existsSync(path.join(ROOT, "docs/founder-monday-runbook.md"));
  const productBifurcation = fssync.existsSync(path.join(ROOT, "docs/product-bifurcation-correction.md"));
  return { founderRunbook, productBifurcation };
}

function runOpsQuiet(): void {
  execSync("npm run --silent ops -- --quiet", {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    timeout: 600_000,
  });
}

function formatDateLabel(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main(): Promise<void> {
  const refresh = process.argv.includes("--refresh");
  const dryRun = process.argv.includes("--dry-run");
  const now = new Date();

  if (refresh) {
    process.stderr.write("Refreshing ops snapshot (npm run ops --quiet)…\n");
    try {
      runOpsQuiet();
    } catch {
      process.stderr.write("Warning: ops refresh failed — composing from last snapshot if available.\n");
    }
  }

  const evidence: BriefEvidence = {
    dateLabel: formatDateLabel(now),
    dayOfWeek: now.getDay(),
    git: collectGit(),
    ops: await collectOps(now),
    weekly: await collectWeekly(now),
    docs: await collectDocs(),
  };

  const { markdown } = composeBrief(evidence);

  if (dryRun) {
    process.stdout.write(markdown);
    return;
  }

  await fs.mkdir(BRIEF_DIR, { recursive: true });
  const datedPath = path.join(BRIEF_DIR, `${evidence.dateLabel}.md`);
  const latestPath = path.join(BRIEF_DIR, "latest.md");
  await fs.writeFile(datedPath, markdown, "utf8");
  await fs.writeFile(latestPath, markdown, "utf8");

  process.stdout.write(`Founder Morning Brief written:\n  ${datedPath}\n  ${latestPath}\n`);
}

main().catch((err) => {
  console.error("[founder-morning-brief] error:", err);
  process.exit(1);
});
