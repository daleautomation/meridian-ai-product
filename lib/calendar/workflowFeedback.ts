// Meridian AI — Workflow Feedback.
//
// Pure converter from operator feedback gestures (accept / override /
// promote / defer) into stable WorkflowFeedbackEvents and the matching
// OutcomeEvents that flow back into outcomeLearning. Also applies
// already-recorded feedback to a task list without mutating originals.
//
// No I/O, no React, no state. Persistence lives in workflowFeedbackMemory.

import type { OutcomeEvent, OutcomeType } from "./outcomeLearning";
import type { TaskItem, TaskPriority } from "./tasks";
import { normalizeScope, type IntelligenceScope } from "./intelligenceScope";

// ── Public types ───────────────────────────────────────────────────────

export type WorkflowFeedbackType =
  | "accept_adjustment"
  | "override_adjustment"
  | "promote_task"
  | "defer_task";

export interface WorkflowFeedbackEvent {
  id: string;
  taskId: string;
  leadId?: string;
  type: WorkflowFeedbackType;
  occurredAt: string;
  reason?: string;
}

const FEEDBACK_TO_OUTCOME: Record<WorkflowFeedbackType, OutcomeType> = {
  accept_adjustment:    "workflow_adjustment_accepted",
  override_adjustment:  "workflow_adjustment_overridden",
  promote_task:         "user_promoted_task",
  defer_task:           "user_deferred_task",
};

const FEEDBACK_REASON: Record<WorkflowFeedbackType, string> = {
  accept_adjustment:   "Operator accepted the workflow adjustment.",
  override_adjustment: "Operator restored original priority.",
  promote_task:        "Operator promoted this task.",
  defer_task:          "Operator deferred this task.",
};

// ── Helpers ────────────────────────────────────────────────────────────

const PRIORITY_LADDER: TaskPriority[] = ["low", "medium", "high", "critical"];

function priorityIdx(p: TaskPriority): number {
  const i = PRIORITY_LADDER.indexOf(p);
  return i < 0 ? 0 : i;
}

function priorityFromIdx(i: number): TaskPriority {
  const c = Math.max(0, Math.min(PRIORITY_LADDER.length - 1, i));
  return PRIORITY_LADDER[c];
}

function ymd(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ── Public API ─────────────────────────────────────────────────────────

export function createWorkflowFeedbackEvent(
  task: TaskItem | null | undefined,
  type: WorkflowFeedbackType,
  reason?: string,
  now: Date = new Date(),
): WorkflowFeedbackEvent | null {
  if (!task || !task.id) return null;
  const day = ymd(now);
  return {
    id: `workflow-feedback-${task.id}-${type}-${day}`,
    taskId: task.id,
    ...(task.linkedLeadId ? { leadId: task.linkedLeadId } : {}),
    type,
    occurredAt: now.toISOString(),
    ...(reason ? { reason } : {}),
  };
}

export function workflowFeedbackToOutcomeEvent(
  feedback: WorkflowFeedbackEvent | null | undefined,
  scope?: IntelligenceScope | null,
): OutcomeEvent | null {
  if (!feedback || !feedback.leadId) return null;
  const outcomeType = FEEDBACK_TO_OUTCOME[feedback.type];
  if (!outcomeType) return null;
  const tag = normalizeScope(scope);
  const day = feedback.occurredAt
    ? feedback.occurredAt.slice(0, 10).replace(/-/g, "")
    : ymd(new Date());
  return {
    id: `outcome-${feedback.leadId}-${outcomeType}-${feedback.taskId}-${day}`,
    leadId: feedback.leadId,
    taskId: feedback.taskId,
    type: outcomeType,
    occurredAt: feedback.occurredAt,
    source: "calendar",
    ...(feedback.reason ? { notes: feedback.reason } : {}),
    userId: tag.userId,
    tenantId: tag.tenantId,
    clientId: tag.clientId,
    moduleId: tag.moduleId,
    marketId: tag.marketId,
    tradeId: tag.tradeId,
    nicheId: tag.nicheId,
  };
}

// ── Apply feedback to tasks ────────────────────────────────────────────

export function applyFeedbackToTasks(
  tasks: TaskItem[],
  feedbackEvents: WorkflowFeedbackEvent[] | null | undefined,
): TaskItem[] {
  if (!Array.isArray(tasks)) return [];
  if (!Array.isArray(feedbackEvents) || feedbackEvents.length === 0) {
    return tasks.map((t) => ({ ...t }));
  }

  // Most-recent feedback per task wins.
  const latestByTask = new Map<string, WorkflowFeedbackEvent>();
  for (const f of feedbackEvents) {
    if (!f || !f.taskId) continue;
    const existing = latestByTask.get(f.taskId);
    if (!existing || (f.occurredAt ?? "") > (existing.occurredAt ?? "")) {
      latestByTask.set(f.taskId, f);
    }
  }

  return tasks.map((t) => {
    const f = latestByTask.get(t.id);
    if (!f) return { ...t };
    const reason = f.reason ?? FEEDBACK_REASON[f.type] ?? "Operator feedback applied.";

    switch (f.type) {
      case "accept_adjustment":
        return {
          ...t,
          feedbackApplied: true,
          feedbackReason: reason,
          feedbackType: f.type,
        };

      case "override_adjustment": {
        const restored = t.workflowOriginalPriority ?? t.priority;
        return {
          ...t,
          priority: restored,
          // Adjustment metadata stays for audit, but the priority is
          // back to its pre-engine value.
          feedbackApplied: true,
          feedbackReason: reason,
          feedbackType: f.type,
        };
      }

      case "promote_task": {
        const idx = priorityIdx(t.priority);
        const next = priorityFromIdx(idx + 1);
        return {
          ...t,
          priority: next,
          feedbackApplied: true,
          feedbackReason: reason,
          feedbackType: f.type,
        };
      }

      case "defer_task": {
        const idx = priorityIdx(t.priority);
        const next = priorityFromIdx(idx - 1);
        return {
          ...t,
          priority: next,
          feedbackApplied: true,
          feedbackReason: reason,
          feedbackType: f.type,
        };
      }

      default:
        return { ...t };
    }
  });
}
