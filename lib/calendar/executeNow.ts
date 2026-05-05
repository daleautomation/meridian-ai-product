// Meridian AI — Execute Now + Capital Allocation decision layer.
//
// Pure, testable. Reads TaskItem[] (already produced by buildTasksFromLeads
// or getMockTasks) and answers two questions for the operator:
//
//   1. What is the single smartest action to take right now?
//   2. How should the next slice of capital + time be allocated?
//
// No I/O, no fakery. Reuses scoreTask from ./tasks for the deadline curve
// and only adds a thin per-axis breakdown plus label/copy logic on top.
// All weights are explicit so the formula stays transparent.

import type { TaskItem, TaskCategory } from "./tasks";
import { isOverdue } from "./tasks";
import {
  scoreLeadTask,
  economicValue as canonicalEconomicValue,
  urgencyScore as canonicalUrgencyScore,
} from "./leadScore";

// ── Public types ───────────────────────────────────────────────────────

export type ExecuteLabel = "EXECUTE NOW" | "NEXT BEST MOVE" | "MONITOR";
export type AllocationLabel = "DEPLOY NOW" | "BOOK CALL" | "VERIFY FIRST" | "MONITOR";
export type Confidence = "high" | "medium" | "low";

export interface ExecuteNowDecision {
  task: TaskItem | null;
  score: number;
  label: ExecuteLabel;
  reason: string;
  expectedUpside?: number;
  riskSummary: string;
  nextMove: string;
  linkedLeadId?: string;
  linkedCompany?: string;
}

export interface CapitalAllocationItem {
  task: TaskItem;
  allocationScore: number;
  allocationLabel: AllocationLabel;
  expectedUpside?: number;
  confidence: Confidence;
  reason: string;
  nextMove: string;
}

export interface DecisionOptions {
  now?: Date;
  /** Cap how many allocation items to consider/return. Default 3. */
  topN?: number;
}

// ── Canonical scoring wrappers ─────────────────────────────────────────
// All per-axis scoring math lives in lib/calendar/leadScore.ts. The
// helpers here are thin wrappers around scoreLeadTask so Execute Now
// and Capital Allocation read the exact same numbers as the rest of
// the Calendar surfaces.

export function economicValue(t: TaskItem): number {
  return canonicalEconomicValue(t);
}

export function executeScore(t: TaskItem, now: Date = new Date()): number {
  return scoreLeadTask(t, { now }).executeScore;
}

// ── Capital Allocation formula ─────────────────────────────────────────
// score = 0.40*economic     (expectedValue when present, else revenueImpact)
//       + 0.20*readiness
//       + 0.15*urgency
//       + 0.15*confidence    (blended: deal confidence + completeness)
//       + 0.10*strategic
//
// readiness: derived from category + presence of nextAction + status.
//   priority/revenue/followup with a clear nextAction → high
//   meeting → medium-high
//   product/admin (verify first) → low-medium
// confidence: blends task completeness and dealConfidence (when present).

// Confidence helper used by the allocation label classifier. The
// numeric scoring lives in leadScore.ts; this only converts task shape
// → "high"/"medium"/"low" for label rules.
function completenessConfidence(t: TaskItem): Confidence {
  const hasNext = !!(typeof t.nextAction === "string" && t.nextAction.trim().length > 0);
  const hasLink = !!t.linkedCompany;
  const hasRevenue = (t.revenueImpact ?? 0) > 0;
  if (hasNext && hasLink && hasRevenue) return "high";
  if (hasNext && hasLink) return "medium";
  return "low";
}

function confidenceFor(t: TaskItem): Confidence {
  // Prefer the deal-side confidence when the converter attached one;
  // otherwise fall back to task completeness.
  return t.dealConfidence ?? completenessConfidence(t);
}

export function allocationScore(t: TaskItem, now: Date = new Date()): number {
  return scoreLeadTask(t, { now }).allocationScore;
}

// ── Label rules ────────────────────────────────────────────────────────

function isVerifyFirstCategory(c: TaskCategory): boolean {
  return c === "admin" || c === "product";
}

function classifyAllocation(t: TaskItem, now: Date): AllocationLabel {
  const overdue = isOverdue(t, now);
  const urgent = overdue || canonicalUrgencyScore(t, now) >= 75;
  const hasNext = !!(typeof t.nextAction === "string" && t.nextAction.trim().length > 0);
  const conf = confidenceFor(t);

  // Verify-first: missing data / diagnostic categories — unless escalated
  // to critical, they belong in VERIFY FIRST.
  if (isVerifyFirstCategory(t.category)) {
    if (t.priority === "critical") {
      return hasNext && conf !== "low" ? "DEPLOY NOW" : "VERIFY FIRST";
    }
    return "VERIFY FIRST";
  }

  // Meeting-style or call/followup with a clear nextAction → BOOK CALL
  // when the natural next move is a conversation.
  if (t.category === "meeting") {
    return urgent ? "DEPLOY NOW" : "BOOK CALL";
  }

  // Priority + revenue + urgency + clear next step → DEPLOY NOW.
  if (hasNext && conf !== "low" && (urgent || t.priority === "critical")) {
    return "DEPLOY NOW";
  }

  // Followup / call task without urgency → BOOK CALL when there is a
  // concrete operator next step.
  if ((t.category === "followup" || t.category === "priority") && hasNext) {
    return "BOOK CALL";
  }

  return "MONITOR";
}

// ── Reason / risk / next-move copy ─────────────────────────────────────
//
// Plain operator language, no generic CRM copy, no negative framing
// unless the task itself is overdue or high-risk-if-missed.

function reasonFor(t: TaskItem, now: Date): string {
  const overdue = isOverdue(t, now);
  const urgent = overdue || canonicalUrgencyScore(t, now) >= 75;
  const rev = t.revenueImpact;
  const ev = t.expectedValue;
  const prob = t.closeProbability;
  const parts: string[] = [];

  if (overdue) parts.push("Overdue");
  else if (urgent) parts.push("Due today");

  if (t.priority === "critical") parts.push("critical priority");
  else if (t.priority === "high") parts.push("high priority");

  if (ev && ev > 0 && rev && rev > 0 && typeof prob === "number") {
    parts.push(
      `$${Math.round(ev).toLocaleString()} expected value from $${Math.round(rev).toLocaleString()} upside at ${Math.round(prob * 100)}% close probability`,
    );
  } else if (rev && rev > 0) {
    parts.push(`~$${Math.round(rev).toLocaleString()} on the table`);
  }
  if (t.strategicImportance === "high") parts.push("strategically important");

  if (parts.length === 0) {
    return t.notes || "Best move available right now given current pipeline state.";
  }
  // Capitalize first part already; join rest comma-separated.
  return parts.join(" · ");
}

function riskCopyFor(t: TaskItem, now: Date): string {
  const overdue = isOverdue(t, now);
  if (t.riskIfMissed === "high") {
    if (overdue) return "Already overdue — every additional hour reduces close odds.";
    return "Delay may cool the opportunity or surface a competing bid.";
  }
  if (t.riskIfMissed === "medium") {
    return "Skipping today pushes the opportunity into a slower lane.";
  }
  return "Low downside if deferred, but value is highest right now.";
}

function nextMoveFor(t: TaskItem): string {
  if (typeof t.nextAction === "string" && t.nextAction.trim().length > 0) return t.nextAction.trim();
  switch (t.category) {
    case "priority": return "Open the lead and call with the angle the card carries.";
    case "revenue":  return "Move this lead toward proposal, paid setup, or booked call.";
    case "followup": return "Confirm interest and lock the next concrete commitment.";
    case "meeting":  return "Hold the meeting and exit with a written next step.";
    case "product":  return "Open the scan card; the next step is on the task itself.";
    case "admin":    return "Find verified phone, email, owner, and website before outreach.";
    case "personal": return "Honor the commitment.";
    default:         return "Take the next concrete step.";
  }
}

// ── Public entry points ────────────────────────────────────────────────

export function getExecuteNowDecision(
  tasks: TaskItem[] | null | undefined,
  options: DecisionOptions = {},
): ExecuteNowDecision {
  const now = options.now ?? new Date();

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return {
      task: null,
      score: 0,
      label: "MONITOR",
      reason: "No capital-first action is ready yet.",
      riskSummary: "No risk because no action is pending.",
      nextMove: "Keep enriching the lead list and complete diagnostics.",
    };
  }

  // Rank by execute score; break ties by overdue first, then by economic
  // value (expectedValue when present, else revenueImpact).
  const ranked = [...tasks]
    .filter((t) => t.status !== "done")
    .map((t) => ({ t, s: executeScore(t, now) }))
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      const ao = isOverdue(a.t, now) ? 1 : 0;
      const bo = isOverdue(b.t, now) ? 1 : 0;
      if (bo !== ao) return bo - ao;
      return economicValue(b.t) - economicValue(a.t);
    });

  const top = ranked[0];
  if (!top) {
    return {
      task: null,
      score: 0,
      label: "MONITOR",
      reason: "No capital-first action is ready yet.",
      riskSummary: "No risk because no action is pending.",
      nextMove: "Keep enriching the lead list and complete diagnostics.",
    };
  }

  const t = top.t;
  const score = top.s;
  const overdue = isOverdue(t, now);
  const urgent = overdue || canonicalUrgencyScore(t, now) >= 75;
  const hasNext = !!(typeof t.nextAction === "string" && t.nextAction.trim().length > 0);

  // Label rules:
  //   EXECUTE NOW: top score >= 65, has clear nextAction, urgent or critical,
  //                with at least one strong signal (revenue/strategic/risk).
  //   NEXT BEST MOVE: valuable but not urgent enough.
  //   MONITOR: nothing strong.
  const strongSignal =
    economicValue(t) > 0 ||
    t.strategicImportance === "high" ||
    t.riskIfMissed === "high";

  let label: ExecuteLabel;
  if (hasNext && strongSignal && (urgent || t.priority === "critical") && score >= 60) {
    label = "EXECUTE NOW";
  } else if (score >= 40) {
    label = "NEXT BEST MOVE";
  } else {
    label = "MONITOR";
  }

  // Compose the public reason from the canonical LeadScoreResult.reason
  // (so the wording stays consistent with the rest of the surface) plus
  // any task-specific EV/probability detail that the local copy adds.
  const canonicalReason = scoreLeadTask(t, { now }).reason;
  const localReason = reasonFor(t, now);
  const reason = localReason && localReason !== canonicalReason
    ? `${canonicalReason} · ${localReason}`
    : canonicalReason;

  return {
    task: t,
    score,
    label,
    reason,
    expectedUpside: t.revenueImpact,
    riskSummary: riskCopyFor(t, now),
    nextMove: nextMoveFor(t),
    linkedLeadId: t.linkedLeadId,
    linkedCompany: t.linkedCompany,
  };
}

export function rankCapitalAllocation(
  tasks: TaskItem[] | null | undefined,
  options: DecisionOptions = {},
): CapitalAllocationItem[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  const now = options.now ?? new Date();
  const topN = options.topN ?? 3;

  const items: CapitalAllocationItem[] = tasks
    .filter((t) => t.status !== "done")
    .map((t) => {
      const score = allocationScore(t, now);
      const conf = confidenceFor(t);
      return {
        task: t,
        allocationScore: score,
        allocationLabel: classifyAllocation(t, now),
        expectedUpside: t.revenueImpact,
        confidence: conf,
        reason: reasonFor(t, now),
        nextMove: nextMoveFor(t),
      };
    })
    .sort((a, b) => b.allocationScore - a.allocationScore);

  // De-duplicate by task id (defensive — buildTasksFromLeads already
  // produces unique ids, but the public API should be safe to call on
  // arbitrary input).
  const seen = new Set<string>();
  const unique: CapitalAllocationItem[] = [];
  for (const it of items) {
    if (seen.has(it.task.id)) continue;
    seen.add(it.task.id);
    unique.push(it);
    if (unique.length >= topN) break;
  }
  return unique;
}
