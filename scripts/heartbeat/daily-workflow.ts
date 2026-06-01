/**
 * Meridian Heartbeat — CEO Daily Workflow (Phase 1, evidence-derived).
 *
 * Observer-only · Read-only · Pure derivation (no I/O).
 *
 * Synthesizes the surfaces already produced — heartbeat results, Workspace Health,
 * and the Approval Queue — into a single CEO operating view:
 *   - Today's Priorities      (ranked actions, each traced to an evidence source)
 *   - Blocked Items           (what cannot proceed, and what would unblock it)
 *   - Revenue Opportunities   (reachable-contact facts only — no projected revenue)
 *   - Daily Workflow summary  (at-a-glance counts)
 *
 * Hard rule: no AI-generated priorities. Every priority/blocker/opportunity traces
 * to a measured fact in Workspace Health, the Approval Queue, or a Heartbeat finding.
 *
 * Touches no scoring / CRM import logic / operator workflow / customer data / prod write path.
 */
import type { HeartbeatRun } from "./types";
import type { WorkspaceHealthReport } from "./workspace-health";
import type { ApprovalQueueItem } from "./approval-queue";

export interface Priority {
  rank: number;
  title: string;
  whySurfaced: string;
  workspace: string;
  suggestedNextStep: string;
  evidence: string[];
  source: "Heartbeat" | "Approval Queue" | "Workspace Health";
}

export interface BlockedItem {
  title: string;
  reason: string;
  workspace: string;
  blockedOn: string;
  evidence: string[];
}

export interface RevenueOpportunity {
  title: string;
  workspace: string;
  suggestedNextStep: string;
  evidence: string[];
}

export interface DailyWorkflow {
  summary: {
    approvalsAwaiting: number;
    priorities: number;
    blocked: number;
    opportunities: number;
    checksPassing: string;
  };
  priorities: Priority[];
  blocked: BlockedItem[];
  opportunities: RevenueOpportunity[];
}

/** Ranked actions. Heartbeat failures first (system), then Tier 2 approvals. */
function buildPriorities(
  run: HeartbeatRun,
  approvalQueue: ApprovalQueueItem[],
): Priority[] {
  const priorities: Priority[] = [];
  let rank = 1;

  // 1 · Heartbeat failures — highest severity (a broken check blocks dependent work).
  for (const check of run.checks) {
    if (check.status === "pass") continue;
    const lastLine = check.output.trim().split("\n").slice(-1)[0] || "(no output)";
    priorities.push({
      rank: rank++,
      title: `Failing observer check: ${check.label}`,
      whySurfaced: "A Heartbeat observer check is not passing.",
      workspace: "platform",
      suggestedNextStep:
        "Investigate the failure before dependent work; decide whether to pause or accept it.",
      evidence: [`status: ${check.status}`, `exit code: ${check.exitCode ?? "n/a"}`, lastLine],
      source: "Heartbeat",
    });
  }

  // 2 · Tier 2 approvals — each traces (via the queue) to a Workspace Health fact.
  for (const item of approvalQueue) {
    if (item.tier !== 2) continue;
    priorities.push({
      rank: rank++,
      title: item.decision,
      whySurfaced: item.whyApprovalRequired,
      workspace: item.workspace,
      suggestedNextStep: "Review the evidence, then approve or decline. No action runs until you decide.",
      evidence: item.evidence,
      source: "Approval Queue",
    });
  }

  return priorities;
}

/** What cannot proceed — blocked on a missing prerequisite, not on a decision. */
function buildBlocked(workspaceHealth: WorkspaceHealthReport | null): BlockedItem[] {
  const blocked: BlockedItem[] = [];
  if (!workspaceHealth) return blocked;

  for (const ws of workspaceHealth.workspaces) {
    if (!ws.measurable) {
      blocked.push({
        title: `${ws.workspace} contact-level health`,
        reason: "The Phase 1 probe cannot read this source as a contact store.",
        workspace: ws.workspace,
        blockedOn: "a probe that reads this source (a Tier 2 build requiring CEO approval)",
        evidence: ws.notes.length ? ws.notes : ["source is not a contact store"],
      });
      continue;
    }
    if (ws.baselineMissing && typeof ws.recordCount === "number") {
      blocked.push({
        title: `Record-count trend for ${ws.workspace}`,
        reason: "No prior baseline exists yet.",
        workspace: ws.workspace,
        blockedOn: "a second heartbeat run (today's snapshot becomes the baseline)",
        evidence: [`current record count: ${ws.recordCount}`],
      });
    }
  }

  return blocked;
}

/** Reachable-contact facts only. No projected revenue, no invented opportunities. */
function buildOpportunities(
  workspaceHealth: WorkspaceHealthReport | null,
): RevenueOpportunity[] {
  const opportunities: RevenueOpportunity[] = [];
  if (!workspaceHealth) return opportunities;

  for (const ws of workspaceHealth.workspaces) {
    if (!ws.measurable || !ws.coverage || !ws.recordCount) continue;
    const { withEmail, withPhone } = ws.coverage;
    if (withEmail === 0 && withPhone === 0) continue;
    opportunities.push({
      title: `Outreach-ready contacts in ${ws.workspace}`,
      workspace: ws.workspace,
      suggestedNextStep: "Consider prioritized outreach — your call. Meridian does not contact anyone.",
      evidence: [
        `email-reachable: ${withEmail}`,
        `phone-reachable: ${withPhone}`,
        `of ${ws.recordCount} record(s)`,
      ],
    });
  }

  return opportunities;
}

export function buildDailyWorkflow(
  run: HeartbeatRun,
  workspaceHealth: WorkspaceHealthReport | null,
  approvalQueue: ApprovalQueueItem[],
): DailyWorkflow {
  const priorities = buildPriorities(run, approvalQueue);
  const blocked = buildBlocked(workspaceHealth);
  const opportunities = buildOpportunities(workspaceHealth);

  return {
    summary: {
      approvalsAwaiting: approvalQueue.filter((i) => i.tier === 2).length,
      priorities: priorities.length,
      blocked: blocked.length,
      opportunities: opportunities.length,
      checksPassing: `${run.summary.passed}/${run.summary.total}`,
    },
    priorities,
    blocked,
    opportunities,
  };
}
