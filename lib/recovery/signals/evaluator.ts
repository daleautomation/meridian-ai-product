// Meridian — deterministic signal evaluation (T5).
//
// Pure functions only. `nowIso` is always passed in — never Date.now() here.
// Turns RecoverySignal[] into ScoreBreakdown and RankedCard outputs.

import {
  calculateDecayMultiplier,
  calculateDecayedWeight,
  clampScore,
  daysSinceObserved,
  inverseTimeRamp,
  isSignalUsableForScoring,
  normalizeSignalWeight,
  parseObservedAt,
} from "./decay";
import type {
  RampDefinition,
  RankedCard,
  RecoverySignal,
  ScoreBreakdown,
  SignalConfidence,
  SignalContribution,
  SourceTrustTier,
  WorkspaceSignalConfig,
} from "./types";
import { isWellFormedSignal } from "./types";

/** Contribution with disclosure fields preserved for brief rendering (T9). */
export interface EvaluatedSignalContribution extends SignalContribution {
  sourceTier: SourceTrustTier;
  evidenceLabel: string | null;
  explanation: string | null;
  sourceUrl: string | null;
  signalId: string;
}

const MAX_RANKED_CARDS = 20;

const TIER_SORT_RANK: Record<SourceTrustTier, number> = {
  HIGH: 0,
  MED: 1,
  WEAK: 2,
  BANNED: 3,
};

/**
 * Canonical source labels and prefixes from SIGNAL_TRUST_RULES.md §3.1.
 * Signals without evidenceUrl must use one of these (re-derivable in <60s).
 */
const KNOWN_DERIVABLE_SOURCE_PREFIXES: readonly string[] = [
  "county_recorder",
  "permit",
  "permit:",
  "sos:",
  "secretary_of_state",
  "google_places",
  "places:google",
  "crm:",
  "google_ads",
  "ads:google",
  "hunter.io",
  "noaa",
  "mls:",
  "tax_assessor",
  "osha",
  "epa",
  "linkedin",
] as const;

function isKnownDerivableSource(source: string): boolean {
  const normalized = source.trim().toLowerCase();
  if (!normalized) return false;
  return KNOWN_DERIVABLE_SOURCE_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

function sourceInWorkspaceCatalog(
  source: string,
  config: WorkspaceSignalConfig,
): boolean {
  const normalized = source.trim().toLowerCase();
  return config.signals.some(
    (def) =>
      def.source.trim().toLowerCase() === normalized ||
      normalized.startsWith(def.source.trim().toLowerCase()),
  );
}

function passesEvidenceGate(
  signal: RecoverySignal,
  config: WorkspaceSignalConfig,
): boolean {
  if (signal.evidenceUrl !== null && signal.evidenceUrl.trim().length > 0) {
    return true;
  }
  if (isKnownDerivableSource(signal.source)) return true;
  if (sourceInWorkspaceCatalog(signal.source, config)) return true;
  return false;
}

function isExcludedFromScoring(signal: RecoverySignal, nowIso: string): boolean {
  if (signal.sourceTier === "BANNED" || signal.status === "banned") return true;
  if (signal.status === "excluded") return true;
  if (!isWellFormedSignal(signal)) return true;
  if (!isSignalUsableForScoring(signal, nowIso)) return true;
  return false;
}

function matchesWorkspace(signal: RecoverySignal, config: WorkspaceSignalConfig): boolean {
  if (!signal.workspaceSlug) return true;
  return signal.workspaceSlug === config.slug;
}

function resolveRamp(
  signal: RecoverySignal,
  config: WorkspaceSignalConfig,
): RampDefinition | null {
  return config.ramps?.[signal.name] ?? null;
}

function computeDecayApplied(
  signal: RecoverySignal,
  nowIso: string,
  ramp: RampDefinition | null,
): number {
  if (ramp) {
    return inverseTimeRamp(signal.observedAt, ramp, nowIso);
  }
  const observedMs = parseObservedAt(signal.observedAt);
  const days = daysSinceObserved(observedMs, nowIso);
  return calculateDecayMultiplier(days, signal.halfLifeDays);
}

function formatExplanation(
  template: string | undefined,
  signal: RecoverySignal,
  nowIso: string,
): string | null {
  if (!template) return signal.explanation ?? null;
  const observedMs = parseObservedAt(signal.observedAt);
  const daysSince = daysSinceObserved(observedMs, nowIso);
  const daysText =
    daysSince === null ? "unknown" : String(Math.floor(daysSince));
  return template
    .replace(/\{observedAt\}/g, signal.observedAt)
    .replace(/\{recordId\}/g, signal.recordId)
    .replace(/\{daysSince\}/g, daysText);
}

function lookupConfigMeta(
  signal: RecoverySignal,
  config: WorkspaceSignalConfig,
  nowIso: string,
): { evidenceLabel: string | null; explanation: string | null } {
  const def = config.signals.find((d) => d.name === signal.name) as
    | { evidenceLabel?: string; explanationTemplate?: string }
    | undefined;
  const evidenceLabel =
    signal.evidenceLabel ?? def?.evidenceLabel ?? null;
  const explanation =
    signal.explanation ??
    formatExplanation(def?.explanationTemplate, signal, nowIso);
  return {
    evidenceLabel: typeof evidenceLabel === "string" ? evidenceLabel : null,
    explanation: typeof explanation === "string" ? explanation : null,
  };
}

/**
 * Evaluate one signal at `nowIso`. Returns null when banned, excluded, fails
 * evidence gate, or produces zero contribution.
 */
export function evaluateSignal(
  signal: RecoverySignal,
  nowIso: string,
  workspaceConfig: WorkspaceSignalConfig,
): EvaluatedSignalContribution | null {
  if (!matchesWorkspace(signal, workspaceConfig)) return null;
  if (isExcludedFromScoring(signal, nowIso)) return null;
  if (!passesEvidenceGate(signal, workspaceConfig)) return null;

  const weight = normalizeSignalWeight(signal.weight);
  const ramp = resolveRamp(signal, workspaceConfig);
  const decayApplied = computeDecayApplied(signal, nowIso, ramp);
  const contribution = calculateDecayedWeight(weight, decayApplied);
  if (contribution <= 0) return null;

  const meta = lookupConfigMeta(signal, workspaceConfig, nowIso);

  return {
    signalId: signal.id,
    name: signal.name,
    weight,
    contribution,
    observedAt: signal.observedAt,
    decayApplied,
    source: signal.source,
    recordId: signal.recordId,
    evidenceUrl: signal.evidenceUrl,
    confidence: signal.confidence,
    sourceTier: signal.sourceTier,
    evidenceLabel: meta.evidenceLabel,
    explanation: meta.explanation,
    sourceUrl: signal.sourceUrl ?? null,
  };
}

/**
 * Evaluate all signals for one lead and build a score breakdown.
 */
export function evaluateSignals(
  signals: RecoverySignal[],
  nowIso: string,
  workspaceConfig: WorkspaceSignalConfig,
  leadKey: string,
): ScoreBreakdown {
  const contributions: EvaluatedSignalContribution[] = [];
  for (const signal of signals) {
    const evaluated = evaluateSignal(signal, nowIso, workspaceConfig);
    if (evaluated) contributions.push(evaluated);
  }
  return buildScoreBreakdown(contributions, leadKey, nowIso);
}

/**
 * Aggregate per-signal contributions into a bounded total score.
 */
export function buildScoreBreakdown(
  contributions: readonly SignalContribution[],
  leadKey: string,
  nowIso: string,
): ScoreBreakdown {
  const sorted = sortContributions(contributions);
  const rawTotal = sorted.reduce((sum, c) => sum + c.contribution, 0);
  return {
    leadKey,
    totalScore: clampScore(rawTotal),
    contributions: sorted,
    evaluatedAt: nowIso,
  };
}

function contributionTier(contrib: SignalContribution): SourceTrustTier {
  const extended = contrib as EvaluatedSignalContribution;
  if (extended.sourceTier) return extended.sourceTier;
  return contrib.confidence;
}

function contributionSignalId(contrib: SignalContribution): string {
  const extended = contrib as EvaluatedSignalContribution;
  return extended.signalId ?? contrib.recordId;
}

/**
 * Sort contributions: score desc, tier HIGH > MED > WEAK, name asc, id asc.
 */
export function sortContributions(
  contributions: readonly SignalContribution[],
): SignalContribution[] {
  return [...contributions].sort((a, b) => {
    if (b.contribution !== a.contribution) {
      return b.contribution - a.contribution;
    }
    const tierA = TIER_SORT_RANK[contributionTier(a)];
    const tierB = TIER_SORT_RANK[contributionTier(b)];
    if (tierA !== tierB) return tierA - tierB;
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return contributionSignalId(a).localeCompare(contributionSignalId(b));
  });
}

/**
 * True when at least one contribution is HIGH confidence with positive score.
 */
export function hasHighConfidenceSignal(
  contributions: readonly SignalContribution[],
): boolean {
  return contributions.some(
    (c) => c.confidence === "HIGH" && c.contribution > 0,
  );
}

/**
 * True when no HIGH or MED signals are usable for scoring at `nowIso`.
 */
export function hasOnlyWeakSignals(
  signals: readonly RecoverySignal[],
  nowIso: string,
  workspaceConfig: WorkspaceSignalConfig,
): boolean {
  let hasUsableHighOrMed = false;
  for (const signal of signals) {
    if (!matchesWorkspace(signal, workspaceConfig)) continue;
    if (isExcludedFromScoring(signal, nowIso)) continue;
    if (!passesEvidenceGate(signal, workspaceConfig)) continue;
    if (signal.confidence === "HIGH" || signal.confidence === "MED") {
      hasUsableHighOrMed = true;
      break;
    }
  }
  return !hasUsableHighOrMed;
}

/**
 * Pick the headline signal name per §3: HIGH may headline; MED only with HIGH
 * on the same card; WEAK never headlines.
 */
export function selectHeadlineSignal(
  contributions: readonly SignalContribution[],
): string | null {
  const sorted = sortContributions(contributions);
  const hasHigh = hasHighConfidenceSignal(contributions);

  for (const contrib of sorted) {
    if (contrib.contribution <= 0) continue;
    if (contrib.confidence === "WEAK") continue;
    if (contrib.confidence === "MED" && !hasHigh) continue;
    return contrib.name;
  }
  return null;
}

function breakdownToRankedCard(
  breakdown: ScoreBreakdown,
  signals: readonly RecoverySignal[],
  workspaceConfig: WorkspaceSignalConfig,
  nowIso: string,
): RankedCard {
  const weakOnly = hasOnlyWeakSignals(signals, nowIso, workspaceConfig);
  return {
    leadKey: breakdown.leadKey,
    score: breakdown.totalScore,
    contributions: breakdown.contributions,
    headlineSignal: selectHeadlineSignal(breakdown.contributions),
    weakOnly,
  };
}

function deriveLeadKey(signals: readonly RecoverySignal[]): string {
  for (const signal of signals) {
    const payload = signal.payload;
    if (payload && typeof payload.leadKey === "string" && payload.leadKey.trim()) {
      return payload.leadKey.trim();
    }
  }
  return signals[0]?.recordId ?? "unknown";
}

/**
 * Evaluate one lead's raw signals into a ranked card.
 */
export function evaluateLead(
  rawSignals: RecoverySignal[],
  workspaceConfig: WorkspaceSignalConfig,
  now: string,
  leadKey?: string,
): RankedCard {
  const key = leadKey?.trim() || deriveLeadKey(rawSignals);
  const breakdown = evaluateSignals(rawSignals, now, workspaceConfig, key);
  return breakdownToRankedCard(breakdown, rawSignals, workspaceConfig, now);
}

/**
 * Sort ranked cards by score descending, then leadKey ascending.
 */
export function rankCardsByScore(cards: readonly RankedCard[]): RankedCard[] {
  return [...cards].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.leadKey.localeCompare(b.leadKey);
  });
}

/**
 * Rank all leads for a workspace. Returns at most 20 cards (may be fewer).
 */
export function rankLeads(
  allSignalsByLead: Readonly<Record<string, readonly RecoverySignal[]>>,
  workspaceConfig: WorkspaceSignalConfig,
  now: string,
): RankedCard[] {
  const cards: RankedCard[] = [];
  for (const [leadKey, signals] of Object.entries(allSignalsByLead)) {
    const card = evaluateLead([...signals], workspaceConfig, now, leadKey);
    if (card.score > 0 || card.contributions.length > 0) {
      cards.push(card);
    }
  }
  return rankCardsByScore(cards).slice(0, MAX_RANKED_CARDS);
}
