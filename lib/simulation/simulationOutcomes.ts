// Meridian — Synthetic Operational Pressure Simulator: outcomes.
//
// Outcome sampler. Reads real intelligence (closeability, urgency,
// service-fit) and weights the outcome distribution accordingly,
// then samples via a seeded RNG.
//
// Pure / deterministic when paired with the seeded RNG.

import {
  weightsFor,
  stageFor,
  TERMINAL_OUTCOMES,
  type SimulationOutcomeId,
  type OperatorProfile,
  type OutcomeWeights,
} from "./simulationProfiles";
import type { SimulationLeadState } from "./simulationState";

// ── Seeded RNG (Mulberry32) ─────────────────────────────────────────
//
// Deterministic, fast, well-distributed. Same seed → same stream.

export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Weight modifiers from real intelligence ─────────────────────────
//
// The simulator NEVER overrides the underlying scoring engines. It
// reads their outputs and modulates the outcome distribution so a
// hot lead is more likely to close, a stale lead more likely to
// ghost, etc.

export interface IntelligenceModifiers {
  /** 0–100 from scan.closeability.score. Defaults to 50 when missing. */
  closeability: number;
  /** "Critical" | "High" | "Medium" | "Low" | null. */
  urgency: "Critical" | "High" | "Medium" | "Low" | null;
  /** 0–95 from service-fit confidence score. Defaults to 50. */
  serviceFit: number;
  /** Whether the lead has a phone number. */
  hasPhone: boolean;
  /** Whether the lead has any verified email. */
  hasVerifiedEmail: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Apply real-intelligence + operator-profile modifiers to the base
 * weights for the current call stage. Pure projection — never
 * mutates the input weights.
 */
export function modulateWeights(
  base: OutcomeWeights,
  intel: IntelligenceModifiers,
  operator: OperatorProfile,
  leadState: SimulationLeadState,
): OutcomeWeights {
  const out: OutcomeWeights = { ...base };

  // Closeability lift: high close → boost interested/qualified/won,
  // shrink ghosted/closed_lost. Range: 0..100 → multiplier 0.6..1.6.
  const closeMult = clamp(0.6 + (intel.closeability / 100) * 1.0, 0.6, 1.6);
  out.interested        *= closeMult;
  out.qualified         *= closeMult;
  out.proposal_sent     *= closeMult;
  out.closed_won        *= closeMult * operator.closeMultiplier;
  out.ghosted           *= 1 / closeMult;
  out.closed_lost       *= 1 / Math.max(0.6, closeMult * 0.85);

  // Service fit lift: high fit → more interested/qualified, less
  // closed_lost. Mirrors closeability but smaller magnitude.
  const fitMult = clamp(0.7 + (intel.serviceFit / 100) * 0.6, 0.7, 1.4);
  out.interested        *= fitMult;
  out.qualified         *= fitMult;
  out.closed_lost       *= 1 / Math.max(0.7, fitMult * 0.9);

  // Urgency lift: hot urgency → more callbacks, less ghosted.
  const urgencyMult =
    intel.urgency === "Critical" ? 1.4
    : intel.urgency === "High"   ? 1.2
    : intel.urgency === "Low"    ? 0.85
    : 1.0;
  out.callback_requested *= urgencyMult;
  out.interested         *= urgencyMult;
  out.ghosted            *= 1 / urgencyMult;

  // Contact quality: no phone → more no_answer + wrong_number.
  if (!intel.hasPhone) {
    out.no_answer    *= 1.6;
    out.wrong_number *= 1.4;
    out.interested   *= 0.5;
    out.qualified    *= 0.5;
  }
  // Operator contact lift reduces no-answer rate.
  out.no_answer *= 1 / operator.contactMultiplier;

  // Operator fatigue: high fatigue lifts no_answer + ghosted slightly
  // (the operator misdials, calls late, follows up sloppy).
  // Read fatigue from operator state separately at sample time.

  // Lead-state evolution: each prior call attempt slightly increases
  // ghosted probability and decreases interested probability — leads
  // that have been worked multiple times are harder to convert.
  const attemptDrag = clamp(1 + leadState.callAttempts * 0.10, 1, 2.5);
  out.ghosted     *= attemptDrag;
  out.interested  *= 1 / Math.sqrt(attemptDrag);

  // Urgency decay drags the call toward ghosted/closed_lost.
  const decayDrag = clamp(1 + (1 - leadState.urgencyDecay) * 1.2, 1, 2.5);
  out.ghosted        *= decayDrag;
  out.closed_lost    *= decayDrag;
  out.interested     *= 1 / decayDrag;

  return out;
}

/**
 * Normalize weights to a CDF and sample one outcome via the rng.
 */
export function sampleOutcome(weights: OutcomeWeights, rng: () => number): SimulationOutcomeId {
  const entries = Object.entries(weights) as Array<[SimulationOutcomeId, number]>;
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
  if (total <= 0) return "no_answer";
  const r = rng() * total;
  let cumulative = 0;
  for (const [outcome, w] of entries) {
    cumulative += Math.max(0, w);
    if (r <= cumulative) return outcome;
  }
  return "no_answer";
}

// ── Apply outcome to lead state ────────────────────────────────────
//
// Pure projection: returns a NEW lead state. Never mutates input.

export interface ApplyOutcomeContext {
  outcome: SimulationOutcomeId;
  intel: IntelligenceModifiers;
  operator: OperatorProfile;
  day: number;
  iso: string;
}

export function applyOutcomeToLeadState(
  current: SimulationLeadState,
  ctx: ApplyOutcomeContext,
): SimulationLeadState {
  const next: SimulationLeadState = {
    ...current,
    simulatedOutcome: ctx.outcome,
    callAttempts: current.callAttempts + 1,
    timelineEvents: [
      ...current.timelineEvents,
      {
        day: ctx.day,
        iso: ctx.iso,
        kind: "outcome_recorded",
        payload: { outcome: ctx.outcome },
      },
    ],
  };

  switch (ctx.outcome) {
    case "no_answer":
      next.callbackProbability = clamp(current.callbackProbability * 0.85, 0, 1);
      next.closeProbability    = clamp(current.closeProbability * 0.95, 0, 1);
      next.followupWindow      = 2;
      next.nextRecommendedAction = "Follow up in 2 days";
      next.responseLikelihood  = clamp(current.responseLikelihood * 0.85, 0, 1);
      break;
    case "interested":
      next.callbackProbability = clamp(current.callbackProbability + 0.20, 0, 1);
      next.closeProbability    = clamp(current.closeProbability + 0.10, 0, 1);
      next.followupWindow      = 1;
      next.operatorConfidence  = clamp(current.operatorConfidence + 0.10, 0, 1);
      next.nextRecommendedAction = "Send proposal";
      next.responseLikelihood  = clamp(current.responseLikelihood + 0.10, 0, 1);
      break;
    case "callback_requested":
      next.callbackProbability = clamp(current.callbackProbability + 0.30, 0, 1);
      next.followupWindow      = 1;
      next.nextRecommendedAction = "Honor callback time";
      break;
    case "wrong_number":
      next.callbackProbability = 0;
      next.closeProbability    = 0;
      next.followupWindow      = null;
      next.urgencyDecay        = 0;
      next.nextRecommendedAction = "Verify contact info";
      next.responseLikelihood  = 0;
      break;
    case "qualified":
      next.callbackProbability = clamp(current.callbackProbability + 0.15, 0, 1);
      next.closeProbability    = clamp(current.closeProbability + 0.20, 0, 1);
      next.followupWindow      = 2;
      next.operatorConfidence  = clamp(current.operatorConfidence + 0.15, 0, 1);
      next.nextRecommendedAction = "Send proposal";
      break;
    case "proposal_sent":
      next.closeProbability    = clamp(current.closeProbability + 0.15, 0, 1);
      next.followupWindow      = 3;
      next.operatorConfidence  = clamp(current.operatorConfidence + 0.10, 0, 1);
      next.nextRecommendedAction = "Follow up on proposal";
      break;
    case "closed_won": {
      next.closeProbability    = 1;
      next.followupWindow      = null;
      next.operatorConfidence  = 1;
      next.nextRecommendedAction = "Move to delivery";
      // Synthetic revenue based on closeability + service fit.
      const baseRevenue = 4000 + (ctx.intel.closeability + ctx.intel.serviceFit) * 60;
      next.simulatedRevenue = Math.round(baseRevenue);
      break;
    }
    case "closed_lost":
      next.closeProbability    = 0;
      next.followupWindow      = null;
      next.urgencyDecay        = 0;
      next.nextRecommendedAction = "Lead closed lost";
      break;
    case "ghosted":
      next.callbackProbability = clamp(current.callbackProbability * 0.5, 0, 1);
      next.closeProbability    = clamp(current.closeProbability * 0.6, 0, 1);
      next.urgencyDecay        = clamp(current.urgencyDecay * 0.5, 0, 1);
      next.followupWindow      = 5;
      next.nextRecommendedAction = "Long-cycle follow-up";
      next.responseLikelihood  = clamp(current.responseLikelihood * 0.6, 0, 1);
      break;
  }

  return next;
}

// ── Daily decay ───────────────────────────────────────────────────
//
// At end-of-day, every active lead loses a small amount of urgency.
// Closed leads are unaffected.

export function decayLeadDaily(state: SimulationLeadState): SimulationLeadState {
  if (state.simulatedOutcome && TERMINAL_OUTCOMES.has(state.simulatedOutcome)) return state;
  const next: SimulationLeadState = {
    ...state,
    urgencyDecay: Math.max(0, state.urgencyDecay - 0.04),
    callbackProbability: Math.max(0, state.callbackProbability - 0.02),
  };
  if (typeof state.followupWindow === "number" && state.followupWindow > 0) {
    next.followupWindow = state.followupWindow - 1;
  }
  return next;
}

export { stageFor, weightsFor, TERMINAL_OUTCOMES };
