// Meridian AI — Workflow Engine.
//
// Pure, deterministic adjustment layer that takes generated tasks and
// already-built operator insights, then nudges priority and ordering
// conservatively so execution surfaces (Execute Now, Capital Allocation,
// the weekly grid) reflect what the learning layer has been telling us
// — without hiding tasks, mutating the originals, or duplicating
// scoring logic from executeNow.ts.

import type { TaskItem, TaskPriority, TaskCategory } from "./tasks";
import type { OperatorInsight } from "./insightEngine";
import { scoreLeadTask } from "./leadScore";

// ── Public types ───────────────────────────────────────────────────────

export type WorkflowRuleId =
  | "high_ev_ready_action"
  | "due_now_followup"
  | "blocked_admin_cleanup"
  | "repeated_no_answer_cooling"
  | "verified_contact_elevation"
  | "diagnostic_below_revenue";

export const WORKFLOW_RULE_IDS: WorkflowRuleId[] = [
  "high_ev_ready_action",
  "due_now_followup",
  "blocked_admin_cleanup",
  "repeated_no_answer_cooling",
  "verified_contact_elevation",
  "diagnostic_below_revenue",
];

export interface WorkflowAdjustment {
  taskId: string;
  ruleId: WorkflowRuleId;
  priorityDelta: number;       // base delta before rule weight (-1 | +1)
  weightedDelta: number;       // priorityDelta * ruleWeight (numeric)
  ruleWeight: number;          // weight multiplier used (0.75..1.25)
  reason: string;
  source: "insight" | "learning" | "task_state";
}

export interface WorkflowEngineInput {
  tasks: TaskItem[];
  insights?: OperatorInsight[];
  now?: Date;
  ruleWeights?: Partial<Record<WorkflowRuleId, number>>;
}

export interface WorkflowEngineResult {
  tasks: TaskItem[];
  adjustments: WorkflowAdjustment[];
}

// ── Priority ladder ────────────────────────────────────────────────────

const PRIORITY_ORDER: TaskPriority[] = ["low", "medium", "high", "critical"];

function priorityIndex(p: TaskPriority): number {
  const i = PRIORITY_ORDER.indexOf(p);
  return i < 0 ? 0 : i;
}

function priorityFromIndex(i: number): TaskPriority {
  const clamped = Math.max(0, Math.min(PRIORITY_ORDER.length - 1, i));
  return PRIORITY_ORDER[clamped];
}

function clampDelta(delta: number): number {
  if (delta > 1) return 1;
  if (delta < -1) return -1;
  return delta;
}

// ── Predicates over tasks/insights ─────────────────────────────────────

function hasNextAction(t: TaskItem): boolean {
  return !!(t.nextAction && t.nextAction.trim().length > 0);
}

function isReadyRevenueLikeCategory(c: TaskCategory): boolean {
  return c === "priority" || c === "revenue" || c === "followup" || c === "meeting";
}

function dueAnchor(t: TaskItem): string | null {
  return t.startTime ?? t.dueDate ?? null;
}

function isDueNowOrOverdue(t: TaskItem, now: Date): boolean {
  const anchor = dueAnchor(t);
  if (!anchor) return false;
  const ms = new Date(anchor).getTime();
  if (!Number.isFinite(ms)) return false;
  // "Today/overdue" = within the next 24h or already past.
  return ms - now.getTime() <= 24 * 3_600_000;
}

function reasonsContain(t: TaskItem, needles: string[]): boolean {
  const haystack = `${t.learningReason ?? ""} ${t.patternLearningReason ?? ""}`.toLowerCase();
  return needles.some((n) => haystack.includes(n.toLowerCase()));
}

function insightMatches(
  insights: OperatorInsight[] | undefined,
  category: OperatorInsight["category"],
  needles: string[],
): OperatorInsight | undefined {
  if (!insights) return undefined;
  const lowered = needles.map((n) => n.toLowerCase());
  return insights.find((i) => {
    if (i.category !== category) return false;
    const hay = `${i.title} ${i.message}`.toLowerCase();
    return lowered.some((n) => hay.includes(n));
  });
}

function hasMissingContactSignal(t: TaskItem): boolean {
  const text = `${t.title ?? ""} ${t.nextAction ?? ""}`.toLowerCase();
  return text.includes("missing contact") || text.includes("contact info");
}

// ── Build adjustments ──────────────────────────────────────────────────

const WEIGHT_MIN = 0.75;
const WEIGHT_MAX = 1.25;

function clampWeight(w: number | undefined): number {
  if (typeof w !== "number" || !Number.isFinite(w)) return 1;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
}

function emit(
  out: WorkflowAdjustment[],
  taskId: string,
  ruleId: WorkflowRuleId,
  baseDelta: number,
  reason: string,
  source: WorkflowAdjustment["source"],
  ruleWeights: Partial<Record<WorkflowRuleId, number>> | undefined,
): void {
  const ruleWeight = clampWeight(ruleWeights?.[ruleId]);
  out.push({
    taskId,
    ruleId,
    priorityDelta: baseDelta,
    weightedDelta: baseDelta * ruleWeight,
    ruleWeight,
    reason,
    source,
  });
}

export function buildWorkflowAdjustments(input: WorkflowEngineInput): WorkflowAdjustment[] {
  const now = input.now ?? new Date();
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const insights = Array.isArray(input.insights) ? input.insights : undefined;
  const ruleWeights = input.ruleWeights;

  const out: WorkflowAdjustment[] = [];

  // Pre-compute for rule F: count of "ready revenue actions" with EV.
  const readyRevenueWithEv = tasks.filter(
    (t) =>
      (t.category === "revenue" || t.category === "priority") &&
      typeof t.expectedValue === "number" &&
      t.expectedValue > 0 &&
      hasNextAction(t) &&
      t.status !== "done",
  );

  // Insight gates for rules D and E.
  const noAnswerInsight = insightMatches(insights, "followup", [
    "no-answer", "no answer",
  ]);
  const verifiedContactInsight = insightMatches(insights, "conversion", [
    "verified contact", "verified-contact",
  ]);

  for (const t of tasks) {
    if (!t || !t.id) continue;

    // A. Elevate high expected-value ready actions.
    if (
      typeof t.expectedValue === "number" &&
      t.expectedValue > 0 &&
      hasNextAction(t) &&
      isReadyRevenueLikeCategory(t.category) &&
      (t.priority === "high" || t.priority === "medium")
    ) {
      emit(out, t.id, "high_ev_ready_action", +1,
        "Elevated because expected value is measurable and the next action is clear.",
        "task_state", ruleWeights);
    }

    // B. Elevate due-now follow-ups.
    if (
      t.category === "followup" &&
      isDueNowOrOverdue(t, now) &&
      (t.status === "todo" || t.status === "in_progress")
    ) {
      emit(out, t.id, "due_now_followup", +1,
        "Elevated because follow-up timing is active now.",
        "task_state", ruleWeights);
    }

    // C. Deprioritize blocked admin cleanup from prime order.
    if (
      t.category === "admin" &&
      hasMissingContactSignal(t) &&
      (t.priority === "high" || t.priority === "critical")
    ) {
      emit(out, t.id, "blocked_admin_cleanup", -1,
        "Moved behind ready actions because contact data is still missing.",
        "task_state", ruleWeights);
    }

    // D. Deprioritize repeated no-answer patterns (insight-gated).
    if (
      noAnswerInsight &&
      (t.category === "priority" || t.category === "followup") &&
      reasonsContain(t, ["no answer", "no-answer", "repeated"])
    ) {
      emit(out, t.id, "repeated_no_answer_cooling", -1,
        "Moved into structured follow-up because recent attempts are cooling.",
        "insight", ruleWeights);
    }

    // E. Elevate verified-contact pattern (insight-gated).
    if (
      verifiedContactInsight &&
      hasNextAction(t) &&
      (t.category === "priority" || t.category === "followup" || t.category === "revenue") &&
      (t.dealConfidence === "medium" || t.dealConfidence === "high")
    ) {
      emit(out, t.id, "verified_contact_elevation", +1,
        "Elevated because verified-contact leads are showing stronger progression.",
        "insight", ruleWeights);
    }

    // F. Keep diagnostics below ready revenue actions.
    if (
      t.category === "product" &&
      t.priority === "critical" &&
      readyRevenueWithEv.length >= 2
    ) {
      emit(out, t.id, "diagnostic_below_revenue", -1,
        "Kept below ready revenue actions while still preserving diagnostic priority.",
        "task_state", ruleWeights);
    }
  }

  return out;
}

// ── Apply adjustments ──────────────────────────────────────────────────

export function applyWorkflowAdjustments(
  tasks: TaskItem[],
  adjustments: WorkflowAdjustment[],
): TaskItem[] {
  if (!Array.isArray(tasks)) return [];
  if (!Array.isArray(adjustments) || adjustments.length === 0) {
    return tasks.map((t) => ({ ...t }));
  }

  // Sum per-task weighted deltas + accumulate per-rule contributions so
  // the surfaced reason is the rule that contributed most in absolute
  // weighted magnitude.
  interface Slot {
    weighted: number;
    contributions: {
      ruleId: WorkflowRuleId;
      reason: string;
      weighted: number;
      ruleWeight: number;
    }[];
  }
  const byTask = new Map<string, Slot>();
  for (const a of adjustments) {
    if (!a || !a.taskId) continue;
    const slot = byTask.get(a.taskId) ?? { weighted: 0, contributions: [] };
    slot.weighted += a.weightedDelta;
    slot.contributions.push({
      ruleId: a.ruleId,
      reason: a.reason,
      weighted: a.weightedDelta,
      ruleWeight: a.ruleWeight,
    });
    byTask.set(a.taskId, slot);
  }

  return tasks.map((t) => {
    const slot = byTask.get(t.id);
    if (!slot) return { ...t };

    // Round summed weighted delta to {-1, 0, +1} so a single rule never
    // moves more than one tier and the visible delta stays an integer.
    let intDelta = 0;
    if (slot.weighted >= 0.5) intDelta = 1;
    else if (slot.weighted <= -0.5) intDelta = -1;
    intDelta = clampDelta(intDelta);

    const originalIdx = priorityIndex(t.priority);
    const nextIdx = Math.max(0, Math.min(PRIORITY_ORDER.length - 1, originalIdx + intDelta));
    const effectiveDelta = nextIdx - originalIdx; // -1 | 0 | +1
    const newPriority = priorityFromIndex(nextIdx);

    if (effectiveDelta === 0) {
      // No effective priority change — leave the task untouched. Insight/
      // ordering nudges that don't change tier are intentionally silent
      // so the UI hint only fires when something actually moved.
      return { ...t };
    }

    // Primary rule = largest absolute weighted contribution in the same
    // direction as the effective delta.
    const dirAligned = slot.contributions.filter((c) =>
      effectiveDelta > 0 ? c.weighted > 0 : c.weighted < 0,
    );
    const ranked = (dirAligned.length > 0 ? dirAligned : slot.contributions)
      .slice()
      .sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted));
    const primary = ranked[0];

    const ruleIds = Array.from(new Set(slot.contributions.map((c) => c.ruleId)));

    return {
      ...t,
      priority: newPriority,
      workflowAdjusted: true,
      workflowAdjustmentReason: primary?.reason ?? "Workflow adjusted by current insights.",
      workflowOriginalPriority: t.workflowOriginalPriority ?? t.priority,
      workflowPriorityDelta: effectiveDelta,
      workflowRuleIds: ruleIds,
      workflowPrimaryRuleId: primary?.ruleId,
      workflowRuleWeightApplied: primary?.ruleWeight,
    };
  });
}

// ── Re-rank ────────────────────────────────────────────────────────────
// Stable sort preserves original order on ties via the index closure.

function compareTasks(a: TaskItem, b: TaskItem, now: Date): number {
  // Canonical re-rank: adjusted priority tier first, then the canonical
  // taskScore / executeScore / allocationScore / urgencyScore chain so
  // every Calendar surface agrees with the workflow output.
  const pa = priorityIndex(a.priority);
  const pb = priorityIndex(b.priority);
  if (pa !== pb) return pb - pa;

  const sa = scoreLeadTask(a, { now });
  const sb = scoreLeadTask(b, { now });
  if (sb.taskScore !== sa.taskScore) return sb.taskScore - sa.taskScore;
  if (sb.executeScore !== sa.executeScore) return sb.executeScore - sa.executeScore;
  if (sb.allocationScore !== sa.allocationScore) return sb.allocationScore - sa.allocationScore;
  if (sb.urgencyScore !== sa.urgencyScore) return sb.urgencyScore - sa.urgencyScore;

  return 0;
}

function rerankTasks(tasks: TaskItem[], now: Date): TaskItem[] {
  const indexed = tasks.map((t, i) => ({ t, i }));
  indexed.sort((x, y) => {
    const c = compareTasks(x.t, y.t, now);
    if (c !== 0) return c;
    return x.i - y.i;
  });
  return indexed.map((p) => p.t);
}

// ── Public top-level entry ─────────────────────────────────────────────

export function optimizeWorkflow(input: WorkflowEngineInput): WorkflowEngineResult {
  const now = input.now ?? new Date();
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const adjustments = buildWorkflowAdjustments({ ...input, now });
  const adjusted = applyWorkflowAdjustments(tasks, adjustments);
  const sorted = rerankTasks(adjusted, now);
  return { tasks: sorted, adjustments };
}
