// Meridian AI — Global Intelligence (internal diagnostics only).
//
// Pure cross-market discovery layer. Groups already-stamped outcome and
// feedback events by their market context (module + market + trade +
// niche), runs the existing per-market learners on each group, and
// classifies each pattern + rule as universal / market_specific /
// emerging / noisy.
//
// This file is read-only intelligence: it does not change pattern
// adjustments, rule weights, insights, task order, or memory. It exists
// purely so internal diagnostics can answer "what transfers, what is
// local, what is too noisy to trust yet?"

import type { OutcomeEvent } from "./outcomeLearning";
import type { LeadLike, TaskItem } from "./tasks";
import type { WorkflowFeedbackEvent } from "./workflowFeedback";
import {
  buildPatternLearning,
  type PatternLearningAdjustment,
} from "./patternLearning";
import {
  buildWorkflowRuleLearning,
  type WorkflowRuleStats,
} from "./workflowRuleLearning";
import {
  WORKFLOW_RULE_IDS,
  type WorkflowRuleId,
} from "./workflowEngine";
import { SCOPE_FALLBACKS } from "./intelligenceScope";

// ── Public types ───────────────────────────────────────────────────────

export type GlobalSignalClass =
  | "universal"
  | "market_specific"
  | "emerging"
  | "noisy";

export interface GlobalPatternSignal {
  key: string;
  classification: GlobalSignalClass;
  marketsObserved: number;
  totalEvidence: number;
  averageValue: number;
  variance: number;
  strongestMarketKey?: string;
  weakestMarketKey?: string;
  reason: string;
}

export interface GlobalRuleSignal {
  ruleId: string;
  classification: GlobalSignalClass;
  marketsObserved: number;
  totalEvidence: number;
  averageWeight: number;
  variance: number;
  strongestMarketKey?: string;
  weakestMarketKey?: string;
  reason: string;
}

export interface GlobalIntelligenceInput {
  events: OutcomeEvent[];
  leads: LeadLike[];
  feedbackEvents?: WorkflowFeedbackEvent[];
  tasks?: TaskItem[];
  minMarkets?: number;
  minEvidencePerMarket?: number;
}

export interface GlobalIntelligenceResult {
  patternSignals: GlobalPatternSignal[];
  ruleSignals: GlobalRuleSignal[];
  universalPatternKeys: string[];
  marketSpecificPatternKeys: string[];
  noisyPatternKeys: string[];
  emergingPatternKeys: string[];
  universalRuleIds: string[];
  marketSpecificRuleIds: string[];
  noisyRuleIds: string[];
  emergingRuleIds: string[];
  diagnostics: {
    marketsAnalyzed: number;
    totalEvents: number;
    totalFeedbackEvents: number;
  };
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_MIN_MARKETS = 2;
const DEFAULT_MIN_EVIDENCE_PER_MARKET = 3;

const UNIVERSAL_VAR_MAX = 0.0025;
const UNIVERSAL_AVG_MIN = 0.025;
const SAME_SIGN_RATIO   = 0.75;

const SPECIFIC_VAR_MIN  = 0.0025;
const SPECIFIC_RANGE_MIN = 0.05;

const NOISY_AVG_MAX = 0.015;
const EMERGING_MIN_TOTAL = 3;

// ── Market grouping ────────────────────────────────────────────────────
// Market key format intentionally excludes userId / clientId / tenantId.
// Global discovery is about transferable operating patterns, not user
// identity. Missing fields fall back to default-* strings so an event
// never disappears from grouping.

function eventMarketKey(e: Pick<OutcomeEvent, "moduleId" | "marketId" | "tradeId" | "nicheId">): string {
  const moduleId = e.moduleId ?? SCOPE_FALLBACKS.moduleId;
  const marketId = e.marketId ?? SCOPE_FALLBACKS.marketId;
  const tradeId  = e.tradeId  ?? SCOPE_FALLBACKS.tradeId;
  const nicheId  = e.nicheId  ?? SCOPE_FALLBACKS.nicheId;
  return `module:${moduleId}|market:${marketId}|trade:${tradeId}|niche:${nicheId}`;
}

export function groupEventsByMarket(
  events: OutcomeEvent[] | null | undefined,
): Record<string, OutcomeEvent[]> {
  const out: Record<string, OutcomeEvent[]> = {};
  if (!Array.isArray(events)) return out;
  for (const e of events) {
    if (!e) continue;
    const k = eventMarketKey(e);
    (out[k] ??= []).push(e);
  }
  return out;
}

export function groupFeedbackByMarket(
  feedbackEvents: WorkflowFeedbackEvent[] | null | undefined,
  events: OutcomeEvent[] | null | undefined,
): Record<string, WorkflowFeedbackEvent[]> {
  const out: Record<string, WorkflowFeedbackEvent[]> = {};
  if (!Array.isArray(feedbackEvents)) return out;

  // Build a taskId/leadId → marketKey lookup from outcome events. This
  // is the only honest way to attribute feedback to a market without
  // adding new persistence fields.
  const taskIdToMarket = new Map<string, string>();
  const leadIdToMarket = new Map<string, string>();
  if (Array.isArray(events)) {
    for (const e of events) {
      if (!e) continue;
      const k = eventMarketKey(e);
      if (e.taskId) taskIdToMarket.set(e.taskId, k);
      if (e.leadId) leadIdToMarket.set(e.leadId, k);
    }
  }

  for (const f of feedbackEvents) {
    if (!f) continue;
    const k =
      (f.taskId && taskIdToMarket.get(f.taskId)) ||
      (f.leadId && leadIdToMarket.get(f.leadId)) ||
      undefined;
    if (!k) continue;
    (out[k] ??= []).push(f);
  }
  return out;
}

// ── Numeric helpers ────────────────────────────────────────────────────

function variance(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  let acc = 0;
  for (const v of values) {
    const d = v - mean;
    acc += d * d;
  }
  return acc / values.length;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

interface MarketObservation {
  marketKey: string;
  value: number;
  evidence: number;
}

function classify(
  observations: MarketObservation[],
  minMarkets: number,
  minEvidencePerMarket: number,
): {
  classification: GlobalSignalClass;
  averageValue: number;
  variance: number;
  totalEvidence: number;
  marketsObserved: number;
  strongestMarketKey?: string;
  weakestMarketKey?: string;
  reason: string;
} {
  const marketsObserved = observations.length;
  const values = observations.map((o) => o.value);
  const totalEvidence = observations.reduce((s, o) => s + o.evidence, 0);
  const averageValue = average(values);
  const v = variance(values, averageValue);

  let strongestMarketKey: string | undefined;
  let weakestMarketKey: string | undefined;
  if (marketsObserved >= 2) {
    const sortedHigh = [...observations].sort((a, b) => b.value - a.value);
    const sortedLow  = [...observations].sort((a, b) => a.value - b.value);
    strongestMarketKey = sortedHigh[0]?.marketKey;
    weakestMarketKey = sortedLow[0]?.marketKey;
  } else if (marketsObserved === 1) {
    strongestMarketKey = observations[0].marketKey;
    weakestMarketKey = observations[0].marketKey;
  }

  const requiredTotal = minMarkets * minEvidencePerMarket;
  const sameSignCount = values.filter((x) =>
    averageValue >= 0 ? x >= 0 : x <= 0,
  ).length;
  const sameSignRatio = marketsObserved > 0 ? sameSignCount / marketsObserved : 0;

  // Universal: enough markets, enough evidence, low variance, sizable
  // signal, and the same direction in ≥75% of observed markets.
  if (
    marketsObserved >= minMarkets &&
    totalEvidence >= requiredTotal &&
    Math.abs(averageValue) >= UNIVERSAL_AVG_MIN &&
    v <= UNIVERSAL_VAR_MAX &&
    sameSignRatio >= SAME_SIGN_RATIO
  ) {
    return {
      classification: "universal",
      averageValue, variance: v, totalEvidence, marketsObserved,
      strongestMarketKey, weakestMarketKey,
      reason: `Stable across ${marketsObserved} markets with ${totalEvidence} signals; same direction in ${(sameSignRatio * 100).toFixed(0)}% of markets.`,
    };
  }

  // Market-specific: enough markets, enough evidence, but real
  // disagreement between strongest and weakest market.
  if (marketsObserved >= minMarkets && totalEvidence >= requiredTotal) {
    const range =
      observations.length >= 2
        ? Math.max(...values) - Math.min(...values)
        : 0;
    if (v > SPECIFIC_VAR_MIN && range >= SPECIFIC_RANGE_MIN) {
      return {
        classification: "market_specific",
        averageValue, variance: v, totalEvidence, marketsObserved,
        strongestMarketKey, weakestMarketKey,
        reason: `Differs across markets — strongest vs weakest gap is ${range.toFixed(3)} over ${marketsObserved} markets.`,
      };
    }
  }

  // Noisy: enough total evidence but signal is weak or split.
  if (
    totalEvidence >= requiredTotal &&
    (Math.abs(averageValue) < NOISY_AVG_MAX || (sameSignRatio < 0.5 && marketsObserved >= 2))
  ) {
    return {
      classification: "noisy",
      averageValue, variance: v, totalEvidence, marketsObserved,
      strongestMarketKey, weakestMarketKey,
      reason: `Weak or split signal — average magnitude ${Math.abs(averageValue).toFixed(3)} across ${marketsObserved} markets.`,
    };
  }

  // Emerging: at least the minimum total evidence, but not yet enough
  // markets or aggregate evidence for a stronger classification.
  if (totalEvidence >= EMERGING_MIN_TOTAL) {
    return {
      classification: "emerging",
      averageValue, variance: v, totalEvidence, marketsObserved,
      strongestMarketKey, weakestMarketKey,
      reason: `Showing up with ${totalEvidence} signals across ${marketsObserved} market${marketsObserved === 1 ? "" : "s"}; not enough yet to classify.`,
    };
  }

  // Default to emerging when below threshold; never universal/specific.
  return {
    classification: "emerging",
    averageValue, variance: v, totalEvidence, marketsObserved,
    strongestMarketKey, weakestMarketKey,
    reason: "Not enough evidence to classify.",
  };
}

// ── Public top-level entry ─────────────────────────────────────────────

export function buildGlobalIntelligence(
  input: GlobalIntelligenceInput,
): GlobalIntelligenceResult {
  const minMarkets = Math.max(1, input.minMarkets ?? DEFAULT_MIN_MARKETS);
  const minEvidencePerMarket = Math.max(
    1, input.minEvidencePerMarket ?? DEFAULT_MIN_EVIDENCE_PER_MARKET,
  );
  const events = Array.isArray(input.events) ? input.events : [];
  const leads = Array.isArray(input.leads) ? input.leads : [];
  const feedback = Array.isArray(input.feedbackEvents) ? input.feedbackEvents : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];

  const eventsByMarket = groupEventsByMarket(events);
  const feedbackByMarket = groupFeedbackByMarket(feedback, events);

  const marketKeys = Object.keys(eventsByMarket);

  // Per-market profiles.
  const patternByMarket: Record<string, Record<string, PatternLearningAdjustment>> = {};
  const ruleStatsByMarket: Record<string, Record<WorkflowRuleId, WorkflowRuleStats>> = {};
  for (const k of marketKeys) {
    patternByMarket[k] = buildPatternLearning(eventsByMarket[k], leads, {});
    const fb = feedbackByMarket[k] ?? [];
    ruleStatsByMarket[k] = buildWorkflowRuleLearning(fb, tasks ?? null).stats;
  }

  // ── Pattern observations ─────────────────────────────────────────────
  const patternKeys = new Set<string>();
  for (const k of marketKeys) {
    for (const pk of Object.keys(patternByMarket[k])) patternKeys.add(pk);
  }

  const patternSignals: GlobalPatternSignal[] = [];
  for (const pkey of patternKeys) {
    const obs: MarketObservation[] = [];
    for (const mk of marketKeys) {
      const adj = patternByMarket[mk][pkey];
      if (!adj || adj.sampleSize < minEvidencePerMarket) continue;
      obs.push({
        marketKey: mk,
        value: adj.probabilityDelta,
        evidence: adj.sampleSize,
      });
    }
    if (obs.length === 0) continue;
    const c = classify(obs, minMarkets, minEvidencePerMarket);
    patternSignals.push({
      key: pkey,
      classification: c.classification,
      marketsObserved: c.marketsObserved,
      totalEvidence: c.totalEvidence,
      averageValue: c.averageValue,
      variance: c.variance,
      strongestMarketKey: c.strongestMarketKey,
      weakestMarketKey: c.weakestMarketKey,
      reason: c.reason,
    });
  }

  // ── Rule observations ────────────────────────────────────────────────
  const ruleSignals: GlobalRuleSignal[] = [];
  for (const ruleId of WORKFLOW_RULE_IDS) {
    const obs: MarketObservation[] = [];
    for (const mk of marketKeys) {
      const stats = ruleStatsByMarket[mk]?.[ruleId];
      if (!stats || stats.totalSignals < minEvidencePerMarket) continue;
      obs.push({
        marketKey: mk,
        value: stats.weightMultiplier - 1, // centered around 0
        evidence: stats.totalSignals,
      });
    }
    if (obs.length === 0) continue;
    const c = classify(obs, minMarkets, minEvidencePerMarket);
    ruleSignals.push({
      ruleId,
      classification: c.classification,
      marketsObserved: c.marketsObserved,
      totalEvidence: c.totalEvidence,
      averageWeight: c.averageValue + 1,   // surface as weight again (≈1 ± delta)
      variance: c.variance,
      strongestMarketKey: c.strongestMarketKey,
      weakestMarketKey: c.weakestMarketKey,
      reason: c.reason,
    });
  }

  const pickKeys = (
    arr: GlobalPatternSignal[],
    cls: GlobalSignalClass,
  ): string[] => arr.filter((s) => s.classification === cls).map((s) => s.key);
  const pickRuleIds = (
    arr: GlobalRuleSignal[],
    cls: GlobalSignalClass,
  ): string[] => arr.filter((s) => s.classification === cls).map((s) => s.ruleId);

  return {
    patternSignals,
    ruleSignals,
    universalPatternKeys:      pickKeys(patternSignals, "universal"),
    marketSpecificPatternKeys: pickKeys(patternSignals, "market_specific"),
    noisyPatternKeys:          pickKeys(patternSignals, "noisy"),
    emergingPatternKeys:       pickKeys(patternSignals, "emerging"),
    universalRuleIds:          pickRuleIds(ruleSignals, "universal"),
    marketSpecificRuleIds:     pickRuleIds(ruleSignals, "market_specific"),
    noisyRuleIds:              pickRuleIds(ruleSignals, "noisy"),
    emergingRuleIds:           pickRuleIds(ruleSignals, "emerging"),
    diagnostics: {
      marketsAnalyzed: marketKeys.length,
      totalEvents: events.length,
      totalFeedbackEvents: feedback.length,
    },
  };
}
