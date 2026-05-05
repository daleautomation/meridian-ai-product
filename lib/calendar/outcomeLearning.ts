// Meridian AI — Outcome Learning.
//
// Lightweight, pure self-learning layer on top of the heuristic close
// probability. Reads OutcomeEvents (currently derived from pipelineMap)
// and produces conservative, capped per-lead probability + confidence
// adjustments. The base heuristic in lib/calendar/tasks remains the
// source of truth — this file only nudges it.
//
// No I/O, no persistence, no ML. Every function is deterministic and
// trivially testable.

import type { DealConfidence, PipelineEntryLike } from "./tasks";
import { normalizeScope, type IntelligenceScope } from "./intelligenceScope";

// ── Public types ───────────────────────────────────────────────────────

export type OutcomeType =
  | "task_completed"
  | "call_attempted"
  | "contacted"
  | "no_answer"
  | "followup_scheduled"
  | "meeting_booked"
  | "proposal_sent"
  | "deal_won"
  | "deal_lost"
  | "execute_now_ignored"
  | "workflow_adjustment_accepted"
  | "workflow_adjustment_overridden"
  | "user_promoted_task"
  | "user_deferred_task";

export interface OutcomeEvent {
  id: string;
  leadId: string;
  taskId?: string;
  type: OutcomeType;
  occurredAt: string;
  source?: "manual" | "pipeline" | "calendar" | "system";
  notes?: string;
  // Optional ownership fields. Tagged at derivation time so the event
  // is portable across user / client / tenant aggregation later. Every
  // field falls back to a stable string in normalizeScope() so no
  // downstream consumer needs to handle "missing tenant".
  userId?: string;
  tenantId?: string;
  clientId?: string;
  moduleId?: string;
  marketId?: string;
  tradeId?: string;
  nicheId?: string;
}

export interface LearningAdjustment {
  leadId: string;
  probabilityDelta: number;
  confidenceDelta: -1 | 0 | 1;
  reason: string;
  lastOutcomeAt?: string;
}

// ── Per-event scoring table ────────────────────────────────────────────

const OUTCOME_RULES: Record<
  OutcomeType,
  { delta: number; conf: -1 | 0 | 1; label: string }
> = {
  deal_won:             { delta:  0.20, conf:  1, label: "Deal won" },
  meeting_booked:       { delta:  0.12, conf:  1, label: "Meeting booked" },
  proposal_sent:        { delta:  0.10, conf:  1, label: "Proposal sent" },
  contacted:            { delta:  0.08, conf:  1, label: "Lead contacted" },
  followup_scheduled:   { delta:  0.05, conf:  0, label: "Follow-up scheduled" },
  task_completed:       { delta:  0.03, conf:  0, label: "Task completed" },
  call_attempted:       { delta:  0.02, conf:  0, label: "Call attempted" },
  no_answer:            { delta: -0.04, conf:  0, label: "No answer" },
  execute_now_ignored:  { delta: -0.05, conf:  0, label: "Execute Now ignored" },
  deal_lost:            { delta: -0.25, conf: -1, label: "Deal lost" },
  // Operator feedback signals — intentionally weak so they nudge but
  // never dominate hard deal outcomes.
  workflow_adjustment_accepted:  { delta:  0.04, conf: 0, label: "Workflow adjustment accepted" },
  workflow_adjustment_overridden:{ delta: -0.04, conf: 0, label: "Workflow adjustment overridden" },
  user_promoted_task:            { delta:  0.03, conf: 0, label: "Operator promoted task" },
  user_deferred_task:            { delta: -0.03, conf: 0, label: "Operator deferred task" },
};

// Caps applied to the *combined* per-lead delta.
const POSITIVE_CAP = 0.25;
const NEGATIVE_CAP = -0.30;

// Final probability clamp.
const PROB_MIN = 0.05;
const PROB_MAX = 0.90;

// ── Public scoring API ─────────────────────────────────────────────────

export function scoreOutcomeEvent(event: OutcomeEvent): LearningAdjustment {
  const rule = OUTCOME_RULES[event.type];
  return {
    leadId: event.leadId,
    probabilityDelta: rule.delta,
    confidenceDelta: rule.conf,
    reason: rule.label,
    lastOutcomeAt: event.occurredAt,
  };
}

// Exponential decay so recent outcomes weigh more than old ones.
//   weight = 0.5 ^ (daysSince / 30)   clamped to [0.05, 1].
// 0d → 1.0, 30d → 0.5, 60d → 0.25, 90d → 0.125, etc.
export function recencyWeight(occurredAt: string, now: Date = new Date()): number {
  if (!occurredAt) return 1;
  const ts = new Date(occurredAt).getTime();
  if (!Number.isFinite(ts)) return 1;
  const daysSince = Math.max(0, (now.getTime() - ts) / 86_400_000);
  const w = Math.pow(0.5, daysSince / 30);
  if (!Number.isFinite(w)) return 0.05;
  return Math.max(0.05, Math.min(1, w));
}

export interface CombineLearningOptions {
  now?: Date;
  useRecencyWeighting?: boolean;
}

export function combineLearningAdjustments(
  events: OutcomeEvent[],
  options: CombineLearningOptions = {},
): Record<string, LearningAdjustment> {
  const out: Record<string, LearningAdjustment> = {};
  const now = options.now ?? new Date();
  const useDecay = !!options.useRecencyWeighting;

  for (const ev of events) {
    if (!ev || !ev.leadId) continue;
    const rule = OUTCOME_RULES[ev.type];
    if (!rule) continue;

    const w = useDecay ? recencyWeight(ev.occurredAt, now) : 1;
    const weightedDelta = rule.delta * w;
    // Confidence delta is a direction signal; recency only suppresses it
    // when a long-cold event would otherwise flip a tier.
    const weightedConfRaw = rule.conf * w;
    const weightedConf: -1 | 0 | 1 =
      weightedConfRaw >= 0.5 ? 1 : weightedConfRaw <= -0.5 ? -1 : 0;

    const existing = out[ev.leadId];
    if (!existing) {
      out[ev.leadId] = {
        leadId: ev.leadId,
        probabilityDelta: weightedDelta,
        confidenceDelta: weightedConf,
        reason: rule.label,
        lastOutcomeAt: ev.occurredAt,
      };
      continue;
    }

    existing.probabilityDelta += weightedDelta;

    // Confidence delta saturates at ±1 but tracks the running net direction
    // so applyLearningToConfidence can move at most one step.
    const nextConf = existing.confidenceDelta + weightedConf;
    existing.confidenceDelta =
      nextConf > 0 ? 1 : nextConf < 0 ? -1 : 0;

    // Reason: keep the highest-magnitude rule's label (after weighting) so
    // the UI hint reads like the headline outcome.
    if (Math.abs(weightedDelta) >= POSITIVE_CAP ||
        Math.abs(weightedDelta) > Math.abs(existing.probabilityDelta - weightedDelta)) {
      existing.reason = rule.label;
    }

    if (
      ev.occurredAt &&
      (!existing.lastOutcomeAt || ev.occurredAt > existing.lastOutcomeAt)
    ) {
      existing.lastOutcomeAt = ev.occurredAt;
    }
  }

  // Apply combined caps.
  for (const k of Object.keys(out)) {
    const a = out[k];
    if (a.probabilityDelta > POSITIVE_CAP) a.probabilityDelta = POSITIVE_CAP;
    else if (a.probabilityDelta < NEGATIVE_CAP) a.probabilityDelta = NEGATIVE_CAP;
  }

  return out;
}

export function applyLearningToProbability(
  baseProbability: number,
  adjustment: LearningAdjustment | undefined | null,
): number {
  const base = Number.isFinite(baseProbability) ? baseProbability : PROB_MIN;
  if (!adjustment) {
    return Math.max(PROB_MIN, Math.min(PROB_MAX, base));
  }
  const adjusted = base + adjustment.probabilityDelta;
  return Math.max(PROB_MIN, Math.min(PROB_MAX, adjusted));
}

export function applyLearningToConfidence(
  baseConfidence: DealConfidence,
  adjustment: LearningAdjustment | undefined | null,
): DealConfidence {
  if (!adjustment || adjustment.confidenceDelta === 0) return baseConfidence;
  const order: DealConfidence[] = ["low", "medium", "high"];
  const idx = order.indexOf(baseConfidence);
  if (idx < 0) return baseConfidence;
  if (adjustment.confidenceDelta > 0 && idx < order.length - 1) return order[idx + 1];
  if (adjustment.confidenceDelta < 0 && idx > 0) return order[idx - 1];
  return baseConfidence;
}

// ── Pipeline → OutcomeEvent[] ──────────────────────────────────────────
// Pure derivation from the pipelineMap already in OperatorConsole. Uses
// only fields that already exist on the snapshot record. No persistence
// of its own — every render rebuilds the view of "what has happened".

const STATUS_TO_OUTCOME: Record<string, OutcomeType> = {
  CONTACTED:    "contacted",
  CALLED:       "call_attempted",
  VOICEMAIL:    "no_answer",
  EMAILED:      "contacted",
  FOLLOW_UP:    "followup_scheduled",
  INTERESTED:   "contacted",
  QUALIFIED:    "meeting_booked",
  PITCHED:      "proposal_sent",
  CLOSED_WON:   "deal_won",
  CLOSED_LOST:  "deal_lost",
  DISQUALIFIED: "deal_lost",
};

const FOLLOWUP_STYLE_STATUSES = new Set([
  "CONTACTED", "CALLED", "VOICEMAIL", "EMAILED",
  "FOLLOW_UP", "INTERESTED", "QUALIFIED", "PITCHED",
]);

function lastActionAt(pipe: PipelineEntryLike): string {
  // Several snapshot shapes carry the timestamp under different keys;
  // fall back to "now" if none are present so the event still has a time.
  // PipelineEntryLike is intentionally permissive — read defensively.
  const anyPipe = pipe as unknown as Record<string, unknown>;
  const candidates = [
    anyPipe.lastActionAt,
    (anyPipe.lastAction as { performedAt?: string } | null | undefined)?.performedAt,
    anyPipe.nextActionDate,
  ].filter((v): v is string => typeof v === "string" && v.length > 0);
  return candidates[0] ?? new Date().toISOString();
}

export interface DeriveOutcomeOptions {
  scope?: IntelligenceScope;
}

export function deriveOutcomeEventsFromPipelineMap(
  pipelineMap: Record<string, PipelineEntryLike> | null | undefined,
  options: DeriveOutcomeOptions = {},
): OutcomeEvent[] {
  if (!pipelineMap) return [];
  const out: OutcomeEvent[] = [];
  const tag = normalizeScope(options.scope);

  const stamp = <T extends Omit<OutcomeEvent, "userId" | "tenantId" | "clientId" | "moduleId" | "marketId" | "tradeId" | "nicheId">>(e: T): OutcomeEvent => ({
    ...e,
    userId: tag.userId,
    tenantId: tag.tenantId,
    clientId: tag.clientId,
    moduleId: tag.moduleId,
    marketId: tag.marketId,
    tradeId: tag.tradeId,
    nicheId: tag.nicheId,
  });

  for (const leadId of Object.keys(pipelineMap)) {
    const pipe = pipelineMap[leadId];
    if (!pipe) continue;

    const status = (pipe.status ?? "").toUpperCase();
    const occurredAt = lastActionAt(pipe);

    // Status → outcome.
    const statusOutcome = STATUS_TO_OUTCOME[status];
    if (statusOutcome) {
      out.push(stamp({
        id: `outcome-${leadId}-${statusOutcome}`,
        leadId,
        type: statusOutcome,
        occurredAt,
        source: "pipeline",
      }));
    }

    // Call attempts on the lead — independent of status, conservative +0.02.
    const callAttempts = pipe.callAttempts ?? 0;
    if (callAttempts > 0) {
      out.push(stamp({
        id: `outcome-${leadId}-call-attempts`,
        leadId,
        type: "call_attempted",
        occurredAt,
        source: "pipeline",
        notes: `${callAttempts} call attempt${callAttempts === 1 ? "" : "s"}`,
      }));
    }

    // No-answer streak — single -0.04 event regardless of count (the cap
    // is what limits compounding pessimism).
    const noAnswers = pipe.consecutiveNoAnswers ?? 0;
    if (noAnswers > 0) {
      out.push(stamp({
        id: `outcome-${leadId}-no-answer`,
        leadId,
        type: "no_answer",
        occurredAt,
        source: "pipeline",
        notes: `${noAnswers} consecutive no-answer${noAnswers === 1 ? "" : "s"}`,
      }));
    }

    // Scheduled follow-up date on a contacted-style status.
    if (FOLLOWUP_STYLE_STATUSES.has(status) && pipe.nextActionDate) {
      out.push(stamp({
        id: `outcome-${leadId}-followup-scheduled`,
        leadId,
        type: "followup_scheduled",
        occurredAt: pipe.nextActionDate,
        source: "pipeline",
      }));
    }
  }

  return out;
}

// ── Stale Execute Now helper (Option B) ────────────────────────────────
// Pure helper — returns an OutcomeEvent if the same Execute Now
// recommendation has persisted unchanged across mounts. No persistence
// here; callers can wire localStorage or CRM later without touching
// scoring logic.

export function deriveIgnoredExecuteNowEvent(
  previousExecuteTaskId: string | null | undefined,
  currentExecuteTask: { id: string; linkedLeadId?: string } | null | undefined,
  now: Date = new Date(),
): OutcomeEvent | null {
  if (!previousExecuteTaskId || !currentExecuteTask) return null;
  if (previousExecuteTaskId !== currentExecuteTask.id) return null;
  const leadId = currentExecuteTask.linkedLeadId;
  if (!leadId) return null;
  return {
    id: `outcome-${leadId}-execute_now_ignored`,
    leadId,
    taskId: currentExecuteTask.id,
    type: "execute_now_ignored",
    occurredAt: now.toISOString(),
    source: "calendar",
  };
}
