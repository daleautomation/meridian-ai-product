// Meridian AI — Market Intelligence.
//
// Pure context-aware learning layer. Splits the merged event/feedback
// pool into a "local" market profile (exact module + market + trade +
// niche) and an optional "broader" profile (same module + trade, all
// markets) so a single tenant's KC roofing can learn differently than
// Dallas HVAC, watch flips, or real-estate investors.
//
// No I/O, no ML, no fakery. The local profile always dominates; broader
// data is only used as a gentle seed when local evidence is light.

import type { OutcomeEvent } from "./outcomeLearning";
import type { TaskItem, LeadLike } from "./tasks";
import type { WorkflowFeedbackEvent } from "./workflowFeedback";
import type {
  PatternLearningAdjustment,
} from "./patternLearning";
import { buildPatternLearning } from "./patternLearning";
import type {
  WorkflowRuleId,
  WorkflowEngineInput,
} from "./workflowEngine";
import { WORKFLOW_RULE_IDS } from "./workflowEngine";
import {
  buildWorkflowRuleLearning,
  type WorkflowRuleStats,
} from "./workflowRuleLearning";
import {
  normalizeScope,
  type IntelligenceScope,
} from "./intelligenceScope";

// ── Public types ───────────────────────────────────────────────────────

export interface MarketContext {
  tenantId: string;
  clientId: string;
  moduleId: string;
  marketId: string;
  tradeId: string;
  nicheId: string;
}

export type MarketBlendMode = "local_only" | "blended" | "broader_seed" | "no_evidence";

export interface MarketLearningProfile {
  contextKey: string;
  eventCount: number;
  patternAdjustments: Record<string, PatternLearningAdjustment>;
  ruleStats: Record<WorkflowRuleId, WorkflowRuleStats>;
  ruleWeights: Record<WorkflowRuleId, number>;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface MarketDifference {
  id: string;
  type: "pattern" | "rule";
  key: string;
  direction: "stronger_local" | "weaker_local" | "neutral";
  localValue: number;
  broaderValue: number;
  evidenceCount: number;
  message: string;
}

export interface MarketComparison {
  local: MarketLearningProfile;
  broader?: MarketLearningProfile;
  differences: MarketDifference[];
}

export interface MarketAwareLearningInput {
  events: OutcomeEvent[];
  leads: LeadLike[];
  feedbackEvents?: WorkflowFeedbackEvent[];
  tasks?: TaskItem[];
  scope: IntelligenceScope;
  broaderEvents?: OutcomeEvent[];
  broaderFeedbackEvents?: WorkflowFeedbackEvent[];
}

export interface MarketAwareLearningResult {
  context: MarketContext;
  contextKey: string;
  blendMode: MarketBlendMode;
  patternAdjustments: Record<string, PatternLearningAdjustment>;
  ruleWeights: Record<WorkflowRuleId, number>;
  marketDifferences: MarketDifference[];
  localEventCount: number;
  broaderEventCount: number;
  marketConfidence: "high" | "medium" | "low";
}

// ── Constants ──────────────────────────────────────────────────────────

const LOCAL_ONLY_THRESHOLD = 10;          // ≥ this → local only.
const BROADER_BLEND_RATIO  = 0.30;        // max influence of broader pool.
const PATTERN_DELTA_CAP    = 0.10;        // mirrors patternLearning cap.
const RULE_WEIGHT_MIN      = 0.75;
const RULE_WEIGHT_MAX      = 1.25;
const MIN_DIFF_EVIDENCE    = 3;

// ── Helpers ────────────────────────────────────────────────────────────

export function marketContextFromScope(scope: IntelligenceScope): MarketContext {
  const n = normalizeScope(scope);
  return {
    tenantId: n.tenantId,
    clientId: n.clientId,
    moduleId: n.moduleId,
    marketId: n.marketId,
    tradeId:  n.tradeId,
    nicheId:  n.nicheId,
  };
}

export function marketContextKey(c: MarketContext): string {
  return `module:${c.moduleId}|market:${c.marketId}|trade:${c.tradeId}|niche:${c.nicheId}`;
}

function clampPatternDelta(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(-PATTERN_DELTA_CAP, Math.min(PATTERN_DELTA_CAP, n));
}

function clampRuleWeight(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(RULE_WEIGHT_MIN, Math.min(RULE_WEIGHT_MAX, n));
}

function emptyRuleWeights(): Record<WorkflowRuleId, number> {
  const out = {} as Record<WorkflowRuleId, number>;
  for (const id of WORKFLOW_RULE_IDS) out[id] = 1;
  return out;
}

// ── Filter events to a market context ──────────────────────────────────

export type MarketFilterMode = "exact" | "module_trade";

export function filterEventsForMarket<T extends Pick<OutcomeEvent, "moduleId" | "marketId" | "tradeId" | "nicheId">>(
  events: T[] | null | undefined,
  context: MarketContext,
  mode: MarketFilterMode = "exact",
): T[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  if (mode === "exact") {
    return events.filter((e) =>
      e.moduleId === context.moduleId &&
      e.marketId === context.marketId &&
      e.tradeId  === context.tradeId  &&
      e.nicheId  === context.nicheId,
    );
  }
  // module_trade: same module + trade, any market/niche.
  return events.filter((e) =>
    e.moduleId === context.moduleId &&
    e.tradeId  === context.tradeId,
  );
}

// Same idea for feedback events, which share the OutcomeEvent ownership
// shape via the cross-feed converter. Filter here is structural so an
// upstream caller can pass either shape.
function filterFeedbackForMarket(
  feedback: WorkflowFeedbackEvent[] | undefined,
  events: OutcomeEvent[],
): WorkflowFeedbackEvent[] {
  if (!Array.isArray(feedback) || feedback.length === 0) return [];
  if (events.length === 0) return feedback;
  // Keep feedback whose taskId or leadId is referenced by any event in
  // the filtered pool. This is a conservative gate: feedback unrelated
  // to the local market never reshapes local rule weights.
  const taskIds = new Set<string>();
  const leadIds = new Set<string>();
  for (const e of events) {
    if (e.taskId) taskIds.add(e.taskId);
    if (e.leadId) leadIds.add(e.leadId);
  }
  return feedback.filter(
    (f) =>
      (f.taskId && taskIds.has(f.taskId)) ||
      (f.leadId && leadIds.has(f.leadId)),
  );
}

// ── Build a single profile ─────────────────────────────────────────────

export function buildMarketLearningProfile(
  events: OutcomeEvent[],
  leads: LeadLike[],
  feedbackEvents: WorkflowFeedbackEvent[],
  tasks: TaskItem[] | undefined,
  context: MarketContext,
): MarketLearningProfile {
  const patternAdjustments = buildPatternLearning(events, leads, {});
  const ruleLearning = buildWorkflowRuleLearning(feedbackEvents, tasks ?? null);

  const eventCount = events.length;
  let confidence: MarketLearningProfile["confidence"];
  let reason: string;
  if (eventCount >= LOCAL_ONLY_THRESHOLD) {
    confidence = "high";
    reason = "Enough local outcomes to trust local learning.";
  } else if (eventCount >= 3) {
    confidence = "medium";
    reason = "Some local evidence — broader pool will gently fill gaps.";
  } else {
    confidence = "low";
    reason = "Local evidence is light.";
  }

  return {
    contextKey: marketContextKey(context),
    eventCount,
    patternAdjustments,
    ruleStats: ruleLearning.stats,
    ruleWeights: ruleLearning.ruleWeights,
    confidence,
    reason,
  };
}

// ── Compare two profiles ───────────────────────────────────────────────

const PATTERN_LABELS: Record<string, string> = {
  has_contact:              "verified-contact",
  missing_contact:          "missing-contact",
  has_website_scan:         "verified-scan",
  missing_website_scan:     "missing-scan",
  high_score:               "high-score",
  medium_score:             "mid-score",
  low_score:                "low-score",
  call_now:                 "CALL NOW",
  today_priority:           "TODAY-priority",
  has_revenue_estimate:     "revenue-tagged",
  missing_revenue_estimate: "estimateless",
  high_confidence_estimate: "high-confidence-estimate",
  high_risk_estimate:       "high-risk-estimate",
  repeated_no_answer:       "repeated no-answer",
  contacted_progress:       "contacted-progress",
};

function patternLabel(key: string): string {
  return PATTERN_LABELS[key] ?? key.replace(/_/g, " ");
}

const RULE_LABELS: Record<WorkflowRuleId, string> = {
  high_ev_ready_action:        "high-EV ready actions",
  due_now_followup:            "due-now follow-ups",
  blocked_admin_cleanup:       "blocked admin cleanup",
  repeated_no_answer_cooling:  "repeated no-answer cooling",
  verified_contact_elevation:  "verified-contact elevation",
  diagnostic_below_revenue:    "diagnostics below revenue",
};

export function compareMarketProfiles(
  local: MarketLearningProfile,
  broader?: MarketLearningProfile,
): MarketDifference[] {
  if (!broader) return [];
  const diffs: MarketDifference[] = [];

  // Pattern differences.
  const patternKeys = new Set<string>([
    ...Object.keys(local.patternAdjustments),
    ...Object.keys(broader.patternAdjustments),
  ]);
  for (const key of patternKeys) {
    const l = local.patternAdjustments[key];
    const b = broader.patternAdjustments[key];
    const lv = l?.probabilityDelta ?? 0;
    const bv = b?.probabilityDelta ?? 0;
    const evidence = (l?.sampleSize ?? 0) + (b?.sampleSize ?? 0);
    if (evidence < MIN_DIFF_EVIDENCE) continue;
    const gap = lv - bv;
    if (Math.abs(gap) < 0.02) continue;
    const direction = gap > 0 ? "stronger_local" : "weaker_local";
    const label = patternLabel(key);
    diffs.push({
      id: `market-diff-pattern-${key}`,
      type: "pattern",
      key,
      direction,
      localValue: lv,
      broaderValue: bv,
      evidenceCount: evidence,
      message:
        direction === "stronger_local"
          ? `This market is responding better to ${label} leads than the broader pool.`
          : `This market is showing weaker movement on ${label} leads than the broader pool.`,
    });
  }

  // Rule differences.
  for (const ruleId of WORKFLOW_RULE_IDS) {
    const ls = local.ruleStats[ruleId];
    const bs = broader.ruleStats[ruleId];
    const lv = local.ruleWeights[ruleId] ?? 1;
    const bv = broader.ruleWeights[ruleId] ?? 1;
    const evidence = (ls?.totalSignals ?? 0) + (bs?.totalSignals ?? 0);
    if (evidence < MIN_DIFF_EVIDENCE) continue;
    const gap = lv - bv;
    if (Math.abs(gap) < 0.03) continue;
    const direction = gap > 0 ? "stronger_local" : "weaker_local";
    const label = RULE_LABELS[ruleId];
    diffs.push({
      id: `market-diff-rule-${ruleId}`,
      type: "rule",
      key: ruleId,
      direction,
      localValue: lv,
      broaderValue: bv,
      evidenceCount: evidence,
      message:
        direction === "stronger_local"
          ? `${label} are trusted more in this market than in the broader pool.`
          : `${label} are trusted less in this market than in the broader pool.`,
    });
  }

  // Stable ordering: largest absolute gap first.
  diffs.sort((a, b) =>
    Math.abs(b.localValue - b.broaderValue) -
    Math.abs(a.localValue - a.broaderValue),
  );

  return diffs;
}

// ── Blend ──────────────────────────────────────────────────────────────

function blendPatternAdjustments(
  local: Record<string, PatternLearningAdjustment>,
  broader: Record<string, PatternLearningAdjustment>,
  ratio: number,
): Record<string, PatternLearningAdjustment> {
  const out: Record<string, PatternLearningAdjustment> = {};
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(broader)]);
  const localShare = 1 - ratio;
  const broaderShare = ratio;

  for (const k of keys) {
    const l = local[k];
    const b = broader[k];
    if (l && !b) {
      out[k] = l;
      continue;
    }
    if (!l && b) {
      // Broader-only signal: scale by broaderShare so it can never push
      // beyond the broader cap.
      out[k] = {
        ...b,
        probabilityDelta: clampPatternDelta(b.probabilityDelta * broaderShare),
        reason: `${b.reason} (broader-pool seed at ${(broaderShare * 100).toFixed(0)}% influence).`,
      };
      continue;
    }
    if (l && b) {
      const blendedProb = clampPatternDelta(
        l.probabilityDelta * localShare + b.probabilityDelta * broaderShare,
      );
      const blendedConf: -1 | 0 | 1 =
        l.confidenceDelta + b.confidenceDelta > 0
          ? 1
          : l.confidenceDelta + b.confidenceDelta < 0
            ? -1
            : 0;
      out[k] = {
        ...l,
        probabilityDelta: blendedProb,
        confidenceDelta: blendedConf,
        sampleSize: l.sampleSize + b.sampleSize,
        winSignals: l.winSignals + b.winSignals,
        lossSignals: l.lossSignals + b.lossSignals,
        reason: `${l.reason} Blended with broader pool at ${(broaderShare * 100).toFixed(0)}% influence.`,
      };
    }
  }
  return out;
}

function blendRuleWeights(
  local: Record<WorkflowRuleId, number>,
  broader: Record<WorkflowRuleId, number>,
  ratio: number,
): Record<WorkflowRuleId, number> {
  const out = emptyRuleWeights();
  const localShare = 1 - ratio;
  const broaderShare = ratio;
  for (const id of WORKFLOW_RULE_IDS) {
    const lv = local[id] ?? 1;
    const bv = broader[id] ?? 1;
    out[id] = clampRuleWeight(lv * localShare + bv * broaderShare);
  }
  return out;
}

// ── Public top-level entry ─────────────────────────────────────────────

export function buildMarketAwareLearning(
  input: MarketAwareLearningInput,
): MarketAwareLearningResult {
  const context = marketContextFromScope(input.scope);
  const contextKey = marketContextKey(context);

  // Local pool: exact module + market + trade + niche.
  const localEvents = filterEventsForMarket(input.events, context, "exact");
  const localFeedback = filterFeedbackForMarket(input.feedbackEvents, localEvents);
  const localProfile = buildMarketLearningProfile(
    localEvents,
    input.leads,
    localFeedback,
    input.tasks,
    context,
  );

  // Broader pool: same module + trade, all markets.
  const broaderRaw = input.broaderEvents ?? input.events;
  const broaderEvents = filterEventsForMarket(broaderRaw, context, "module_trade")
    // Avoid double-counting local events inside the broader pool.
    .filter((e) =>
      e.marketId !== context.marketId || e.nicheId !== context.nicheId,
    );
  const broaderFeedback = filterFeedbackForMarket(
    input.broaderFeedbackEvents ?? input.feedbackEvents,
    broaderEvents,
  );
  const broaderProfile = broaderEvents.length > 0
    ? buildMarketLearningProfile(
        broaderEvents,
        input.leads,
        broaderFeedback,
        input.tasks,
        context,
      )
    : undefined;

  // Decide blend mode.
  let blendMode: MarketBlendMode;
  let patternAdjustments: Record<string, PatternLearningAdjustment>;
  let ruleWeights: Record<WorkflowRuleId, number>;

  if (localProfile.eventCount >= LOCAL_ONLY_THRESHOLD) {
    blendMode = "local_only";
    patternAdjustments = localProfile.patternAdjustments;
    ruleWeights = localProfile.ruleWeights;
  } else if (localProfile.eventCount > 0 && broaderProfile) {
    blendMode = "blended";
    patternAdjustments = blendPatternAdjustments(
      localProfile.patternAdjustments,
      broaderProfile.patternAdjustments,
      BROADER_BLEND_RATIO,
    );
    ruleWeights = blendRuleWeights(
      localProfile.ruleWeights,
      broaderProfile.ruleWeights,
      BROADER_BLEND_RATIO,
    );
  } else if (localProfile.eventCount === 0 && broaderProfile) {
    // Local has nothing — use broader as a gentle seed at the same
    // capped ratio so we never let global learning fully drive local.
    blendMode = "broader_seed";
    patternAdjustments = blendPatternAdjustments(
      {},
      broaderProfile.patternAdjustments,
      BROADER_BLEND_RATIO,
    );
    ruleWeights = blendRuleWeights(
      emptyRuleWeights(),
      broaderProfile.ruleWeights,
      BROADER_BLEND_RATIO,
    );
  } else {
    blendMode = "no_evidence";
    patternAdjustments = localProfile.patternAdjustments;
    ruleWeights = localProfile.ruleWeights;
  }

  const marketDifferences = compareMarketProfiles(localProfile, broaderProfile);

  return {
    context,
    contextKey,
    blendMode,
    patternAdjustments,
    ruleWeights,
    marketDifferences,
    localEventCount: localProfile.eventCount,
    broaderEventCount: broaderProfile?.eventCount ?? 0,
    marketConfidence: localProfile.confidence,
  };
}

// Small helper to satisfy the public API contract while keeping
// WorkflowEngineInput's optional rule-weight shape happy.
export function ruleWeightsForEngine(
  result: MarketAwareLearningResult,
): NonNullable<WorkflowEngineInput["ruleWeights"]> {
  return result.ruleWeights;
}
