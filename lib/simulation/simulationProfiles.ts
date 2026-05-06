// Meridian — Synthetic Operational Pressure Simulator: profiles.
//
// Operator behavior profiles + outcome-distribution priors. These are
// MULTIPLIERS applied on top of the real intelligence engines; they
// never replace the real signals. The simulator asks: "given a lead
// with this real closeability/urgency/service-fit, what is LIKELY to
// happen when an operator with this profile works it?"
//
// Pure / deterministic when paired with a seeded RNG.

export type SimulationOutcomeId =
  | "no_answer"
  | "interested"
  | "callback_requested"
  | "wrong_number"
  | "qualified"
  | "proposal_sent"
  | "closed_won"
  | "closed_lost"
  | "ghosted";

export type OperatorProfileId =
  | "aggressive_closer"
  | "average_rep"
  | "inconsistent_rep"
  | "high_followup_rep"
  | "low_energy_rep";

export interface OperatorProfile {
  id: OperatorProfileId;
  label: string;
  /** Lift on close-rate (multiplied into base closeability). 1.0 = neutral. */
  closeMultiplier: number;
  /** Lift on contact rate (no-answer probability is divided by this). */
  contactMultiplier: number;
  /** Probability the operator follows up the same day on a callback. */
  followupRate: number;
  /** Calls/day the operator can sustain (caps daily execution). */
  dailyCallCapacity: number;
  /** Probability the operator skips a low-priority lead in the queue. */
  skipLowPriorityRate: number;
  /** How quickly fatigue accumulates per call (0 = none, 1 = strong). */
  fatigueRate: number;
}

export const OPERATOR_PROFILES: Record<OperatorProfileId, OperatorProfile> = {
  aggressive_closer:  { id: "aggressive_closer",  label: "Aggressive Closer",  closeMultiplier: 1.25, contactMultiplier: 1.10, followupRate: 0.85, dailyCallCapacity: 22, skipLowPriorityRate: 0.20, fatigueRate: 0.04 },
  average_rep:        { id: "average_rep",        label: "Average Rep",        closeMultiplier: 1.00, contactMultiplier: 1.00, followupRate: 0.65, dailyCallCapacity: 18, skipLowPriorityRate: 0.10, fatigueRate: 0.06 },
  inconsistent_rep:   { id: "inconsistent_rep",   label: "Inconsistent Rep",   closeMultiplier: 0.85, contactMultiplier: 0.90, followupRate: 0.45, dailyCallCapacity: 15, skipLowPriorityRate: 0.25, fatigueRate: 0.10 },
  high_followup_rep:  { id: "high_followup_rep",  label: "High-Followup Rep",  closeMultiplier: 1.05, contactMultiplier: 1.00, followupRate: 0.95, dailyCallCapacity: 17, skipLowPriorityRate: 0.05, fatigueRate: 0.05 },
  low_energy_rep:     { id: "low_energy_rep",     label: "Low-Energy Rep",     closeMultiplier: 0.75, contactMultiplier: 0.85, followupRate: 0.35, dailyCallCapacity: 12, skipLowPriorityRate: 0.30, fatigueRate: 0.12 },
};

// ── Outcome distribution priors ─────────────────────────────────────
//
// Read by simulationOutcomes.ts. These are RAW WEIGHTS before
// closeability / urgency / service-fit / operator profile modifiers
// adjust them. Sum need not equal 1; the simulator normalizes.

export interface OutcomeWeights {
  no_answer: number;
  interested: number;
  callback_requested: number;
  wrong_number: number;
  qualified: number;
  proposal_sent: number;
  closed_won: number;
  closed_lost: number;
  ghosted: number;
}

// First-call defaults — most outcomes go nowhere on attempt 1.
export const FIRST_CALL_WEIGHTS: OutcomeWeights = {
  no_answer:          45,
  interested:         15,
  callback_requested: 12,
  wrong_number:       4,
  qualified:          7,
  proposal_sent:      3,
  closed_won:         1,
  closed_lost:        5,
  ghosted:            8,
};

// Follow-up call defaults — leads that survive to attempt 2+ have
// higher conversion + lower no-answer rates (the easy ones already
// bounced off via wrong_number / closed_lost / ghosted).
export const FOLLOWUP_CALL_WEIGHTS: OutcomeWeights = {
  no_answer:          25,
  interested:         18,
  callback_requested: 8,
  wrong_number:       1,
  qualified:          16,
  proposal_sent:      11,
  closed_won:         6,
  closed_lost:        7,
  ghosted:            8,
};

// Proposal-stage call defaults — only fires on attempt 3+ when prior
// outcome was qualified / proposal_sent.
export const PROPOSAL_STAGE_WEIGHTS: OutcomeWeights = {
  no_answer:          15,
  interested:         10,
  callback_requested: 5,
  wrong_number:       0,
  qualified:          8,
  proposal_sent:      18,
  closed_won:         22,
  closed_lost:        14,
  ghosted:            8,
};

// ── Stage transitions ──────────────────────────────────────────────

export type CallStage = "first" | "followup" | "proposal";

export function stageFor(callAttempts: number, lastOutcome: SimulationOutcomeId | null): CallStage {
  if (callAttempts === 0) return "first";
  if (lastOutcome === "qualified" || lastOutcome === "proposal_sent") return "proposal";
  return "followup";
}

export function weightsFor(stage: CallStage): OutcomeWeights {
  if (stage === "first") return FIRST_CALL_WEIGHTS;
  if (stage === "proposal") return PROPOSAL_STAGE_WEIGHTS;
  return FOLLOWUP_CALL_WEIGHTS;
}

// Terminal outcomes — the lead exits the queue.
export const TERMINAL_OUTCOMES: ReadonlySet<SimulationOutcomeId> = new Set([
  "closed_won",
  "closed_lost",
  "wrong_number",
  "ghosted",
]);
