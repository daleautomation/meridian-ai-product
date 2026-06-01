/**
 * Meridian Heartbeat — CEO Approval Queue (Phase 1, evidence-derived).
 *
 * Observer-only · Read-only · Pure derivation (no I/O).
 *
 * The queue is built ONLY from observed evidence already in hand:
 *   - heartbeat check results (HeartbeatRun)
 *   - evidence-first Workspace Health metrics (WorkspaceHealthReport)
 *
 * Every item traces to a fact. Nothing is invented. Meridian surfaces; Dylan decides.
 *
 * Tier 1 — minor / informational. Logged, needs no CEO action and triggers no system change.
 * Tier 2 — requires Dylan's approval. No autonomous execution, ever.
 *
 * Touches no scoring / CRM import logic / operator workflow / customer data / prod write path.
 */
import type { HeartbeatRun } from "./types";
import type { WorkspaceHealthReport, WorkspaceMetrics } from "./workspace-health";

export type ApprovalTier = 1 | 2;

export type ImpactCategory =
  | "Customer Data"
  | "CRM Changes"
  | "Revenue Logic"
  | "Scoring Logic"
  | "Operator Workflow"
  | "Production Infrastructure"
  | "Other";

export interface ApprovalQueueItem {
  tier: ApprovalTier;
  decision: string;
  whyApprovalRequired: string;
  workspace: string;
  category: ImpactCategory;
  dueDate: string | null;
  evidence: string[];
}

/** Deterministic mapping of a failing observer check to an impact category. */
function checkCategory(checkId: string): ImpactCategory {
  if (checkId === "contact-trust") return "CRM Changes";
  if (checkId === "personal-workspace") return "Operator Workflow";
  if (checkId === "auth") return "Production Infrastructure";
  if (checkId.startsWith("operational-events")) return "Operator Workflow";
  return "Other";
}

function fromChecks(run: HeartbeatRun): ApprovalQueueItem[] {
  const items: ApprovalQueueItem[] = [];
  for (const check of run.checks) {
    if (check.status === "pass") continue;
    const lastLine = check.output.trim().split("\n").slice(-1)[0] || "(no output)";
    items.push({
      tier: 2,
      decision: `Review failing observer check: ${check.label}`,
      whyApprovalRequired:
        "A failing observer check may indicate a regression. Deciding whether to pause related work or accept it is a CEO call.",
      workspace: "platform",
      category: checkCategory(check.id),
      dueDate: null,
      evidence: [
        `status: ${check.status}`,
        `exit code: ${check.exitCode ?? "n/a"}`,
        `last output line: ${lastLine}`,
      ],
    });
  }
  return items;
}

function fromWorkspace(ws: WorkspaceMetrics): ApprovalQueueItem[] {
  const items: ApprovalQueueItem[] = [];

  if (!ws.measurable) {
    // Tier 1 — logged fact, no action. (e.g. snapshot-source workspaces.)
    items.push({
      tier: 1,
      decision: `${ws.workspace} health not measured (${ws.source} source)`,
      whyApprovalRequired:
        "Logged for the record. Contact-level health is not derivable from this source in Phase 1 — no CEO action and no system change required.",
      workspace: ws.workspace,
      category: "Other",
      dueDate: null,
      evidence: ws.notes.length ? ws.notes : ["source is not a contact store"],
    });
    return items;
  }

  if ((ws.flatTrustDiscrepancyCount ?? 0) > 0) {
    items.push({
      tier: 2,
      decision: `Reconcile flat-field vs trust-layer discrepancies in ${ws.workspace}`,
      whyApprovalRequired:
        "Reconciliation touches CRM import normalization logic and customer data — Tier 2.",
      workspace: ws.workspace,
      category: "CRM Changes",
      dueDate: null,
      evidence: [`${ws.flatTrustDiscrepancyCount} record(s) where flat fields disagree with the trust layer`],
    });
  }

  if ((ws.trustConflictCount ?? 0) > 0) {
    items.push({
      tier: 2,
      decision: `Resolve recorded trust conflicts in ${ws.workspace}`,
      whyApprovalRequired: "Changing recorded trust state alters customer data — Tier 2.",
      workspace: ws.workspace,
      category: "Customer Data",
      dueDate: null,
      evidence: [`${ws.trustConflictCount} record(s) with conflictState ≠ none`],
    });
  }

  if ((ws.duplicateCount ?? 0) > 0) {
    items.push({
      tier: 2,
      decision: `Review ${ws.duplicateCount} probable duplicate record(s) in ${ws.workspace}`,
      whyApprovalRequired:
        "Merging or removing duplicates is a CRM write affecting customer data — Tier 2.",
      workspace: ws.workspace,
      category: "CRM Changes",
      dueDate: null,
      evidence: [`${ws.duplicateCount} duplicate(s) by ${ws.duplicateKey}`],
    });
  }

  if (typeof ws.recordDelta === "number" && ws.recordDelta < 0) {
    items.push({
      tier: 2,
      decision: `Investigate ${Math.abs(ws.recordDelta)} disappeared record(s) in ${ws.workspace}`,
      whyApprovalRequired:
        "Net record loss may indicate a data-integrity failure. Investigating may touch customer data — Tier 2.",
      workspace: ws.workspace,
      category: "Customer Data",
      dueDate: null,
      evidence: [`record delta ${ws.recordDelta} vs prior baseline`],
    });
  }

  if (ws.baselineMissing && typeof ws.recordCount === "number") {
    // Tier 1 — the read-only snapshot becomes the baseline. Logged, no action.
    items.push({
      tier: 1,
      decision: `Record-count baseline established for ${ws.workspace}`,
      whyApprovalRequired:
        "No prior baseline existed; today's read-only snapshot becomes the baseline. Logged; no CEO action required.",
      workspace: ws.workspace,
      category: "Other",
      dueDate: null,
      evidence: [`current record count: ${ws.recordCount}`],
    });
  }

  return items;
}

/** Build the evidence-derived approval queue. Tier 2 first, then Tier 1. */
export function buildApprovalQueue(
  run: HeartbeatRun,
  workspaceHealth: WorkspaceHealthReport | null,
): ApprovalQueueItem[] {
  const items: ApprovalQueueItem[] = [...fromChecks(run)];
  if (workspaceHealth) {
    for (const ws of workspaceHealth.workspaces) items.push(...fromWorkspace(ws));
  }
  return items.sort((a, b) => a.tier - b.tier);
}
