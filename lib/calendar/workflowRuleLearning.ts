// Meridian AI — Workflow Rule Learning.
//
// Pure, deterministic rule-trust learner. Reads the persisted feedback
// stream and the current (or recent) task list, links each feedback
// event to the rule that produced its task's adjustment, then nudges
// per-rule weight multipliers in a small bounded range. No I/O, no ML.
//
// Bounded range: [0.75, 1.25]. Neutral weight: 1.0.
// Minimum 3 linked feedback signals before a rule weight moves.

import type { TaskItem } from "./tasks";
import type { WorkflowFeedbackEvent } from "./workflowFeedback";
import type { WorkflowRuleId } from "./workflowEngine";
import { WORKFLOW_RULE_IDS } from "./workflowEngine";

// ── Public types ───────────────────────────────────────────────────────

export interface WorkflowRuleStats {
  ruleId: WorkflowRuleId;
  accepts: number;
  overrides: number;
  promotes: number;
  defers: number;
  totalSignals: number;
  trustScore: number;       // -1 to +1
  weightMultiplier: number; // 0.75 to 1.25
  reason: string;
}

export interface WorkflowRuleLearningResult {
  ruleWeights: Record<WorkflowRuleId, number>;
  stats: Record<WorkflowRuleId, WorkflowRuleStats>;
}

// ── Constants ──────────────────────────────────────────────────────────

const WEIGHT_MIN = 0.75;
const WEIGHT_MAX = 1.25;
const TRUST_TO_WEIGHT_GAIN = 0.15;
const MIN_SIGNALS = 3;

// ── Helpers ────────────────────────────────────────────────────────────

function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 1;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
}

function neutralStats(ruleId: WorkflowRuleId): WorkflowRuleStats {
  return {
    ruleId,
    accepts: 0,
    overrides: 0,
    promotes: 0,
    defers: 0,
    totalSignals: 0,
    trustScore: 0,
    weightMultiplier: 1,
    reason: "Not enough feedback yet.",
  };
}

function emptyResult(): WorkflowRuleLearningResult {
  const ruleWeights = {} as Record<WorkflowRuleId, number>;
  const stats = {} as Record<WorkflowRuleId, WorkflowRuleStats>;
  for (const id of WORKFLOW_RULE_IDS) {
    ruleWeights[id] = 1;
    stats[id] = neutralStats(id);
  }
  return { ruleWeights, stats };
}

// ── Main builder ───────────────────────────────────────────────────────

export function buildWorkflowRuleLearning(
  feedbackEvents: WorkflowFeedbackEvent[] | null | undefined,
  tasks?: TaskItem[] | null,
): WorkflowRuleLearningResult {
  const result = emptyResult();
  if (!Array.isArray(feedbackEvents) || feedbackEvents.length === 0) {
    return result;
  }

  // Build a taskId → primary rule lookup. Fall back to the full ruleIds
  // list when no primary is recorded — every rule that fired on the
  // task gets equal credit for the feedback signal.
  const taskRules = new Map<string, WorkflowRuleId[]>();
  if (Array.isArray(tasks)) {
    for (const t of tasks) {
      if (!t?.id) continue;
      const primary = t.workflowPrimaryRuleId as WorkflowRuleId | undefined;
      if (primary && WORKFLOW_RULE_IDS.includes(primary)) {
        taskRules.set(t.id, [primary]);
        continue;
      }
      const all = (t.workflowRuleIds ?? []).filter((r): r is WorkflowRuleId =>
        WORKFLOW_RULE_IDS.includes(r as WorkflowRuleId),
      );
      if (all.length > 0) taskRules.set(t.id, all);
    }
  }

  for (const f of feedbackEvents) {
    if (!f?.taskId) continue;
    const ruleIds = taskRules.get(f.taskId);
    if (!ruleIds || ruleIds.length === 0) continue;

    // For accept/override the feedback only credits a rule if the task
    // was actually workflow-adjusted (which is implicit: only adjusted
    // tasks have a primary/all rule list set).
    // For promote/defer the same rule is credited so the operator's
    // direct manual nudge informs rule trust.
    for (const ruleId of ruleIds) {
      const s = result.stats[ruleId];
      if (!s) continue;
      switch (f.type) {
        case "accept_adjustment":   s.accepts   += 1; break;
        case "override_adjustment": s.overrides += 1; break;
        case "promote_task":        s.promotes  += 1; break;
        case "defer_task":          s.defers    += 1; break;
        default: break;
      }
    }
  }

  // Reduce → trust score → weight.
  for (const ruleId of WORKFLOW_RULE_IDS) {
    const s = result.stats[ruleId];
    const positive = s.accepts + s.promotes;
    const negative = s.overrides + s.defers;
    s.totalSignals = positive + negative;

    if (s.totalSignals === 0) {
      s.trustScore = 0;
      s.weightMultiplier = 1;
      s.reason = "Not enough feedback yet.";
    } else {
      s.trustScore = (positive - negative) / s.totalSignals;
      if (s.totalSignals < MIN_SIGNALS) {
        s.weightMultiplier = 1;
        s.reason = "Not enough feedback yet.";
      } else {
        s.weightMultiplier = clampWeight(1 + s.trustScore * TRUST_TO_WEIGHT_GAIN);
        if (s.trustScore > 0.05) s.reason = "Operators usually accept this rule.";
        else if (s.trustScore < -0.05) s.reason = "Operators often override this rule.";
        else s.reason = "Feedback is mixed — keeping neutral.";
      }
    }

    result.ruleWeights[ruleId] = s.weightMultiplier;
  }

  return result;
}

// ── Public lookups ─────────────────────────────────────────────────────

export function getRuleWeight(
  ruleWeights: Partial<Record<WorkflowRuleId, number>> | null | undefined,
  ruleId: WorkflowRuleId,
): number {
  if (!ruleWeights) return 1;
  const w = ruleWeights[ruleId];
  return clampWeight(typeof w === "number" ? w : 1);
}

export function explainRuleWeight(
  stats: Record<WorkflowRuleId, WorkflowRuleStats> | null | undefined,
  ruleId: WorkflowRuleId,
): string | undefined {
  if (!stats) return undefined;
  const s = stats[ruleId];
  if (!s) return undefined;
  return s.reason;
}
