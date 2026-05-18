// Meridian AI — Pattern Learning.
//
// Transparent, capped, no-ML pattern intelligence. Reads OutcomeEvents
// (current + persisted) and the current lead set, buckets each lead into
// a small fixed set of explainable patterns, and emits a per-pattern
// probability/confidence nudge based on observed win/loss signals.
//
// Pattern learning is intentionally weaker than direct per-lead outcome
// learning — capped at ±0.10 total, and only fires once a pattern has
// at least 3 observations. Every adjustment carries a sampleSize and a
// reason so the UI can always explain why a recommendation moved.

import type { OutcomeEvent, OutcomeType } from "./outcomeLearning";
import type { LeadLike, PipelineEntryLike } from "./tasks";
import { getDialablePhoneDetails } from "../leads/phone";

// ── Public types ───────────────────────────────────────────────────────

export interface LeadPattern {
  key: string;
  label: string;
  reason: string;
}

export interface PatternLearningAdjustment {
  patternKey: string;
  probabilityDelta: number;
  confidenceDelta: -1 | 0 | 1;
  sampleSize: number;
  winSignals: number;
  lossSignals: number;
  reason: string;
}

export interface PatternLearningOptions {
  /** Future hook for now-anchored decay; unused today. */
  now?: Date;
  /** Minimum sample size before a pattern adjustment is emitted. */
  minSampleSize?: number;
  /** Map leadId → pipeline entry to detect repeated_no_answer / contacted_progress. */
  pipelineMap?: Record<string, PipelineEntryLike> | null;
}

// ── Outcome polarity ───────────────────────────────────────────────────

const POSITIVE_OUTCOMES = new Set<OutcomeType>([
  "contacted",
  "followup_scheduled",
  "meeting_booked",
  "proposal_sent",
  "deal_won",
  "task_completed",
]);

const NEGATIVE_OUTCOMES = new Set<OutcomeType>([
  "no_answer",
  "execute_now_ignored",
  "deal_lost",
]);

// ── Pattern derivation ─────────────────────────────────────────────────

const PATTERN_DEFS: Record<string, { label: string; reason: string }> = {
  has_contact:               { label: "Has verified contact",        reason: "Lead has at least one verified phone or email." },
  missing_contact:           { label: "Missing contact info",        reason: "No verified phone or email on file." },
  has_website_scan:          { label: "Has website scan",            reason: "Live website scan has run successfully." },
  missing_website_scan:      { label: "Missing website scan",        reason: "No verified live website scan on file." },
  high_score:                { label: "High score",                  reason: "Lead score is in the top tier (≥75)." },
  medium_score:              { label: "Medium score",                reason: "Lead score is in the mid tier (60–74)." },
  low_score:                 { label: "Low score",                   reason: "Lead score is below the mid tier." },
  call_now:                  { label: "Engine: CALL NOW",            reason: "Engine flagged this lead as CALL NOW." },
  today_priority:            { label: "Engine: TODAY",               reason: "Engine flagged this lead as TODAY priority." },
  has_revenue_estimate:      { label: "Has revenue estimate",        reason: "Opportunity estimate produced a revenue band." },
  missing_revenue_estimate:  { label: "Missing revenue estimate",    reason: "No usable revenue estimate on file." },
  high_confidence_estimate:  { label: "High-confidence estimate",    reason: "Estimate confidence reported as HIGH." },
  high_risk_estimate:        { label: "High-risk estimate",          reason: "Opportunity risk level reported as HIGH." },
  repeated_no_answer:        { label: "Repeated no-answer",          reason: "Pipeline shows multiple consecutive no-answers." },
  contacted_progress:        { label: "Contacted progress",          reason: "Pipeline already past initial contact." },
};

const FOLLOWUP_STYLE_STATUSES = new Set([
  "CONTACTED", "CALLED", "VOICEMAIL", "EMAILED",
  "FOLLOW_UP", "INTERESTED", "QUALIFIED", "PITCHED",
]);

function pat(key: keyof typeof PATTERN_DEFS): LeadPattern {
  const d = PATTERN_DEFS[key];
  return { key, label: d.label, reason: d.reason };
}

export function deriveLeadPatterns(
  l: LeadLike,
  pipe?: PipelineEntryLike,
): LeadPattern[] {
  const out: LeadPattern[] = [];

  const c = l.contacts ?? {};
  const hasPhone = !!getDialablePhoneDetails(l);
  const hasEmail = !!c.primaryEmail;
  if (hasPhone || hasEmail) out.push(pat("has_contact"));
  else out.push(pat("missing_contact"));

  const scanOk = !!l.websiteProof?.homepage_fetch_ok;
  if (scanOk) out.push(pat("has_website_scan"));
  else out.push(pat("missing_website_scan"));

  const score = l.score ?? 0;
  if (score >= 75) out.push(pat("high_score"));
  else if (score >= 60) out.push(pat("medium_score"));
  else out.push(pat("low_score"));

  const isCallNow =
    hasPhone &&
    (
      !!l.forceAction ||
      l.bucket === "CALL NOW" ||
      l.opportunity_label === "CALL NOW" ||
      l.recommendedAction === "CALL NOW"
    );
  if (isCallNow) out.push(pat("call_now"));

  const isToday =
    l.bucket === "TODAY" ||
    l.opportunity_label === "TODAY" ||
    l.recommendedAction === "TODAY";
  if (isToday) out.push(pat("today_priority"));

  const est = l.opportunityEstimate ?? null;
  const hasRevenue = !!(est && (est.opportunityEstimateBand ||
    (est.revenueImpactSummary && est.revenueImpactSummary.length > 0)));
  if (hasRevenue) out.push(pat("has_revenue_estimate"));
  else out.push(pat("missing_revenue_estimate"));

  const oc = (est?.opportunityEstimateConfidence ?? "").toUpperCase();
  if (oc === "HIGH") out.push(pat("high_confidence_estimate"));

  const risk = (est?.opportunityRiskLevel ?? "").toUpperCase();
  if (risk === "HIGH") out.push(pat("high_risk_estimate"));

  if (pipe) {
    const noAns = pipe.consecutiveNoAnswers ?? 0;
    if (noAns >= 2) out.push(pat("repeated_no_answer"));
    const status = (pipe.status ?? "").toUpperCase();
    if (FOLLOWUP_STYLE_STATUSES.has(status)) out.push(pat("contacted_progress"));
  }

  return out;
}

// ── Pattern → adjustment ───────────────────────────────────────────────

const PATTERN_DELTA_CAP = 0.10;
const PATTERN_DELTA_MULTIPLIER = 0.08;

function leadId(l: LeadLike): string | null {
  const raw = l.key ?? l.id ?? null;
  return raw == null ? null : String(raw);
}

export function buildPatternLearning(
  events: OutcomeEvent[] | null | undefined,
  leads: LeadLike[] | null | undefined,
  options: PatternLearningOptions = {},
): Record<string, PatternLearningAdjustment> {
  const out: Record<string, PatternLearningAdjustment> = {};
  if (!Array.isArray(events) || !Array.isArray(leads)) return out;
  const minSample = options.minSampleSize ?? 3;
  const pipelineMap = options.pipelineMap ?? {};

  // Map leadId → patterns so we can credit each event to every pattern
  // its lead carries.
  const leadIdToPatterns = new Map<string, string[]>();
  for (const l of leads) {
    const id = leadId(l);
    if (!id) continue;
    const pipe = pipelineMap[id];
    leadIdToPatterns.set(id, deriveLeadPatterns(l, pipe).map((p) => p.key));
  }

  // Tally win/loss signals per pattern.
  const tallies: Record<string, { wins: number; losses: number }> = {};
  for (const ev of events) {
    if (!ev?.leadId) continue;
    const patterns = leadIdToPatterns.get(ev.leadId);
    if (!patterns) continue;
    const isWin = POSITIVE_OUTCOMES.has(ev.type);
    const isLoss = NEGATIVE_OUTCOMES.has(ev.type);
    if (!isWin && !isLoss) continue;
    for (const k of patterns) {
      const t = (tallies[k] ??= { wins: 0, losses: 0 });
      if (isWin) t.wins += 1;
      else t.losses += 1;
    }
  }

  for (const k of Object.keys(tallies)) {
    const { wins, losses } = tallies[k];
    const total = wins + losses;
    if (total < minSample) continue;
    const rawRate = (wins - losses) / total;
    let probabilityDelta = rawRate * PATTERN_DELTA_MULTIPLIER;
    if (probabilityDelta > PATTERN_DELTA_CAP) probabilityDelta = PATTERN_DELTA_CAP;
    else if (probabilityDelta < -PATTERN_DELTA_CAP) probabilityDelta = -PATTERN_DELTA_CAP;

    let confidenceDelta: -1 | 0 | 1 = 0;
    if (total >= 5 && rawRate > 0.35) confidenceDelta = 1;
    else if (total >= 5 && rawRate < -0.35) confidenceDelta = -1;

    const def = PATTERN_DEFS[k];
    const trendWord = rawRate > 0.05 ? "progressing" : rawRate < -0.05 ? "stalling" : "neutral";
    out[k] = {
      patternKey: k,
      probabilityDelta,
      confidenceDelta,
      sampleSize: total,
      winSignals: wins,
      lossSignals: losses,
      reason: def
        ? `${def.label}: ${wins}W / ${losses}L over ${total} signals (${trendWord}).`
        : `${k}: ${wins}W / ${losses}L over ${total} signals.`,
    };
  }

  return out;
}

// ── Apply pattern learning to a single lead ────────────────────────────
// Sums the per-pattern deltas for the patterns this lead carries, caps
// the result at ±PATTERN_DELTA_CAP, and emits a single combined
// adjustment for the lead. The combined confidence delta saturates at
// ±1 in the direction of the strongest contributing pattern.

export interface AppliedPatternAdjustment {
  probabilityDelta: number;
  confidenceDelta: -1 | 0 | 1;
  reason: string;
  patternKeys: string[];
}

export function applyPatternLearningToLead(
  lead: LeadLike,
  adjustments: Record<string, PatternLearningAdjustment> | null | undefined,
  pipe?: PipelineEntryLike,
): AppliedPatternAdjustment | null {
  if (!adjustments) return null;
  const patterns = deriveLeadPatterns(lead, pipe);
  if (patterns.length === 0) return null;

  let probSum = 0;
  let confSum = 0;
  const matched: PatternLearningAdjustment[] = [];

  for (const p of patterns) {
    const adj = adjustments[p.key];
    if (!adj) continue;
    matched.push(adj);
    probSum += adj.probabilityDelta;
    confSum += adj.confidenceDelta;
  }

  if (matched.length === 0) return null;

  let probabilityDelta = probSum;
  if (probabilityDelta > PATTERN_DELTA_CAP) probabilityDelta = PATTERN_DELTA_CAP;
  else if (probabilityDelta < -PATTERN_DELTA_CAP) probabilityDelta = -PATTERN_DELTA_CAP;

  const confidenceDelta: -1 | 0 | 1 = confSum > 0 ? 1 : confSum < 0 ? -1 : 0;

  // Reason: pick the strongest single pattern (largest absolute delta).
  matched.sort((a, b) => Math.abs(b.probabilityDelta) - Math.abs(a.probabilityDelta));
  const headline = matched[0];
  const reason = matched.length === 1
    ? headline.reason
    : `${headline.reason} (+ ${matched.length - 1} more pattern${matched.length - 1 === 1 ? "" : "s"}).`;

  return {
    probabilityDelta,
    confidenceDelta,
    reason,
    patternKeys: matched.map((m) => m.patternKey),
  };
}
