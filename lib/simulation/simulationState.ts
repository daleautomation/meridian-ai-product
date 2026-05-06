// Meridian — Synthetic Operational Pressure Simulator: state.
//
// Isolated simulation state. NEVER reads or writes the production
// task / lead / outcome maps. Persistence is opt-in via a localStorage
// key that is namespaced separately from the real execution-outcome
// key.

import type {
  SimulationOutcomeId,
  OperatorProfileId,
} from "./simulationProfiles";

export interface SimulationTimelineEvent {
  day: number;            // simulated day index (0-based from run start)
  iso: string;            // simulated ISO timestamp
  kind:
    | "call_attempted"
    | "outcome_recorded"
    | "callback_scheduled"
    | "callback_fired"
    | "followup_scheduled"
    | "followup_fired"
    | "lead_ingested"
    | "lead_decayed"
    | "lead_terminal";
  payload?: Record<string, unknown>;
}

export interface SimulationLeadState {
  /** Underlying real task id — read-only reference. */
  leadId: string;
  /** Namespaced sim-only id: `sim::${runId}::${leadId}` */
  simId: string;
  /** Current simulated outcome (latest). */
  simulatedOutcome: SimulationOutcomeId | null;
  /** Total call attempts in this run. */
  callAttempts: number;
  /** Probability the lead would callback (decays over time). */
  callbackProbability: number;
  /** Probability the lead would close (modified by outcome history). */
  closeProbability: number;
  /** Urgency decay factor (1.0 = full urgency, 0 = decayed away). */
  urgencyDecay: number;
  /** Days until next scheduled follow-up; null = not scheduled. */
  followupWindow: number | null;
  /** Operator confidence in this lead (0–1). Affects skip rates. */
  operatorConfidence: number;
  /** Probability the lead would respond to a touch (combined channel). */
  responseLikelihood: number;
  /** Next recommended action label, projected from current state. */
  nextRecommendedAction: string;
  /** Closed-won revenue captured for this lead in this run, USD. */
  simulatedRevenue: number;
  /** Append-only event log. */
  timelineEvents: SimulationTimelineEvent[];
}

export interface SimulationOperatorState {
  profileId: OperatorProfileId;
  /** Calls completed in the current simulated day (resets daily). */
  callsToday: number;
  /** Cumulative calls across the run. */
  callsTotal: number;
  /** Fatigue level 0–1 (decays slightly overnight). */
  fatigue: number;
  /** Backlog size — leads carried into the next day. */
  backlogSize: number;
}

export interface SimulationRun {
  runId: string;
  seed: number;
  startedAtIso: string;
  /** Calendar anchor (IngestionBatch anchor used for the first week). */
  anchorIso: string;
  /** Simulated day cursor (0-based from anchor). */
  day: number;
  /** Per-lead simulated state. Keyed by sim id. */
  leads: Record<string, SimulationLeadState>;
  /** Operator state. */
  operator: SimulationOperatorState;
  /** Aggregate metrics rolled forward each day. */
  metrics: {
    totalCalls: number;
    totalContacts: number;          // calls that actually connected (anything except no_answer + wrong_number)
    totalQualified: number;
    totalProposalsSent: number;
    totalClosedWon: number;
    totalClosedLost: number;
    totalGhosted: number;
    totalCallbacks: number;
    callbacksPending: number;
    queuePressure: number;          // active leads carried over per day
    simulatedRevenue: number;
    leadDecayCount: number;         // leads whose urgency decayed below threshold
    daysSimulated: number;
  };
  /** Append-only run-level event log. */
  events: SimulationTimelineEvent[];
}

// ── Storage ─────────────────────────────────────────────────────────
//
// Namespaced separately from the production execution-outcome layer.
// Real execution outcomes live at `meridian.executionOutcomes.v1`;
// simulation runs live here. They never collide.

export const SIMULATION_RUN_STORAGE_KEY = "meridian.simulation.runs.v1";

export function readSimulationRuns(): Record<string, SimulationRun> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SIMULATION_RUN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSimulationRun(run: SimulationRun): void {
  if (typeof window === "undefined") return;
  try {
    const all = readSimulationRuns();
    all[run.runId] = run;
    window.localStorage.setItem(SIMULATION_RUN_STORAGE_KEY, JSON.stringify(all));
  } catch { /* fail silent */ }
}

export function clearSimulationRuns(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SIMULATION_RUN_STORAGE_KEY);
  } catch { /* fail silent */ }
}

export function namespacedSimId(runId: string, leadId: string): string {
  return `sim::${runId}::${leadId}`;
}
