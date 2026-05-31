import type {
  CeoDecision,
  CheckResult,
  CheckStatus,
  HeartbeatRun,
  RegressionSummary,
} from "./types";
import { COVERAGE_LINE, NOT_COVERED_YET } from "./manifest";

function statusIcon(status: CheckStatus): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  return "!";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function overallHealth(run: HeartbeatRun): string {
  if (run.summary.failed === 0 && run.summary.errored === 0) {
    return `All ${run.summary.total} observer checks passed.`;
  }
  const parts: string[] = [];
  if (run.summary.failed > 0) parts.push(`${run.summary.failed} failed`);
  if (run.summary.errored > 0) parts.push(`${run.summary.errored} errored`);
  return `${run.summary.passed} of ${run.summary.total} checks passed (${parts.join(", ")}).`;
}

export function buildCeoDecisions(run: HeartbeatRun): CeoDecision[] {
  const decisions: CeoDecision[] = [];

  for (const check of run.checks) {
    if (check.status === "pass") continue;
    decisions.push({
      checkId: check.id,
      label: check.label,
      message:
        check.status === "fail"
          ? `${check.label} failed its observer check. Review the failure output and decide whether to pause related work or accept the regression.`
          : `${check.label} could not complete (runner error). Review logs and decide whether to retry or investigate tooling.`,
    });
  }

  return decisions;
}

function renderCeoDecisionsBlock(decisions: CeoDecision[]): string {
  if (decisions.length === 0) {
    return "No CEO decisions required — all observer checks passed.";
  }

  return decisions
    .map((d, i) => `${i + 1}. **${d.label}** — ${d.message}`)
    .join("\n");
}

function renderGreenBoard(run: HeartbeatRun): string {
  const header = "| Check | Status | Duration |";
  const divider = "| --- | --- | --- |";
  const rows = run.checks.map((check) => {
    const status =
      check.status === "pass"
        ? "PASS"
        : check.status === "fail"
          ? "FAIL"
          : "ERROR";
    return `| ${check.label} | ${statusIcon(check.status)} ${status} | ${formatDuration(check.durationMs)} |`;
  });
  return [header, divider, ...rows].join("\n");
}

export function buildRegressionSummary(
  run: HeartbeatRun,
  prior: HeartbeatRun | null,
): RegressionSummary {
  if (!prior) {
    return {
      isFirstRun: true,
      priorDate: null,
      deltas: [],
      newlyFailing: [],
      newlyPassing: [],
    };
  }

  const priorById = new Map(prior.checks.map((c) => [c.id, c]));
  const deltas: RegressionSummary["deltas"] = [];
  const newlyFailing: CheckResult[] = [];
  const newlyPassing: string[] = [];

  for (const check of run.checks) {
    const prev = priorById.get(check.id);
    if (!prev) continue;
    if (prev.status !== check.status) {
      deltas.push({
        id: check.id,
        label: check.label,
        previous: prev.status,
        current: check.status,
      });
      if (check.status !== "pass" && prev.status === "pass") {
        newlyFailing.push(check);
      }
      if (check.status === "pass" && prev.status !== "pass") {
        newlyPassing.push(check.label);
      }
    }
  }

  return {
    isFirstRun: false,
    priorDate: prior.date,
    deltas,
    newlyFailing,
    newlyPassing,
  };
}

function renderRegression(regression: RegressionSummary): string {
  if (regression.isFirstRun) {
    return "First heartbeat run — no prior baseline for regression comparison.";
  }

  if (regression.deltas.length === 0) {
    return `No status changes since ${regression.priorDate}. All checks held steady.`;
  }

  const lines = regression.deltas.map(
    (d) =>
      `- **${d.label}**: ${d.previous.toUpperCase()} → ${d.current.toUpperCase()}`,
  );

  if (regression.newlyPassing.length > 0) {
    lines.push(
      "",
      `Recovered: ${regression.newlyPassing.join(", ")}.`,
    );
  }

  return lines.join("\n");
}

function renderFailedDetails(run: HeartbeatRun): string {
  const failing = run.checks.filter((c) => c.status !== "pass");
  if (failing.length === 0) return "";

  const sections = failing.map((check) => {
    const tail = check.output.trim().split("\n").slice(-20).join("\n");
    return `### ${check.label} (${check.script})\n\n\`\`\`\n${tail || "(no output)"}\n\`\`\``;
  });

  return ["## Failure Details", "", ...sections].join("\n");
}

export function renderLatestMarkdown(
  run: HeartbeatRun,
  regression: RegressionSummary,
): string {
  const decisions = buildCeoDecisions(run);
  const runTime = new Date(run.runAt).toUTCString();

  return [
    `# Meridian Heartbeat — ${run.date}`,
    "",
    `_Observer-only · Read-only · Generated ${runTime}_`,
    "",
    "## CEO Decisions",
    "",
    renderCeoDecisionsBlock(decisions),
    "",
    "## Green Board",
    "",
    renderGreenBoard(run),
    "",
    `**Summary:** ${overallHealth(run)}`,
    "",
    "## Regression",
    "",
    renderRegression(regression),
    "",
    "## Coverage",
    "",
    COVERAGE_LINE,
    "",
    "## Role Boundaries",
    "",
    "- **Dylan** — CEO (decisions only)",
    "- **Meridian** — Operator (runs checks, writes reports)",
    "- **Heartbeat** — Observer (no fixes, no merges, no production writes)",
    "",
    renderFailedDetails(run),
  ].join("\n");
}

export function renderBriefTodayMarkdown(
  run: HeartbeatRun,
  regression: RegressionSummary,
): string {
  const decisions = buildCeoDecisions(run);

  const ceoSection =
    decisions.length === 0
      ? "Nothing needs your call today. All seven observer checks passed."
      : decisions
          .map((d) => `- ${d.message}`)
          .join("\n");

  const healthLines = run.checks.map((check) => {
    const word =
      check.status === "pass" ? "Healthy" : check.status === "fail" ? "Failed" : "Error";
    return `- **${check.label}** — ${word}`;
  });

  let whatChanged: string;
  if (regression.isFirstRun) {
    whatChanged =
      "This is the first heartbeat run. Future briefs will show what changed day over day.";
  } else if (regression.deltas.length === 0) {
    whatChanged = "No check status changes since the last run.";
  } else {
    whatChanged = regression.deltas
      .map(
        (d) =>
          `${d.label} moved from ${d.previous} to ${d.current}.`,
      )
      .join(" ");
  }

  const needsDylan =
    decisions.length === 0
      ? "Nothing — Meridian handled the observer pass."
      : decisions.map((d) => `- Decide on **${d.label}**: ${d.message}`).join("\n");

  return [
    "# Meridian Morning Brief",
    "",
    "## CEO Decisions",
    "",
    ceoSection,
    "",
    "## System Health",
    "",
    overallHealth(run),
    "",
    ...healthLines,
    "",
    "## What Changed",
    "",
    whatChanged,
    "",
    "## What Needs Dylan",
    "",
    needsDylan,
    "",
    "## Not Covered Yet",
    "",
    NOT_COVERED_YET.join(", ") + ".",
  ].join("\n");
}

export function renderHistoryJson(
  run: HeartbeatRun,
  regression: RegressionSummary,
): string {
  return JSON.stringify(
    {
      ...run,
      regression: {
        isFirstRun: regression.isFirstRun,
        priorDate: regression.priorDate,
        deltas: regression.deltas,
        newlyPassing: regression.newlyPassing,
        newlyFailing: regression.newlyFailing.map((c) => c.id),
      },
    },
    null,
    2,
  );
}
