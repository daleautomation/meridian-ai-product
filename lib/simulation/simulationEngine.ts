// Meridian — Synthetic Operational Pressure Simulator: engine.
//
// Top-level orchestrator. Consumes real Meridian intelligence
// (closeability, urgency, service-fit, decision-engine outputs) and
// projects realistic operational pressure forward in simulated time.
//
// CRITICAL: this engine is read-only against production data. It
// never mutates a real task, lead, executionOutcome, or schedule.
// Simulation state lives in its own namespaced WeakMap + localStorage
// key (see simulationState.ts).

import { computeLaborTechServiceFit } from "../scan/serviceFit";
import {
  OPERATOR_PROFILES,
  stageFor,
  weightsFor,
  TERMINAL_OUTCOMES,
  type OperatorProfileId,
  type OperatorProfile,
  type SimulationOutcomeId,
} from "./simulationProfiles";
import {
  createRng,
  modulateWeights,
  sampleOutcome,
  applyOutcomeToLeadState,
  decayLeadDaily,
  type IntelligenceModifiers,
} from "./simulationOutcomes";
import {
  namespacedSimId,
  writeSimulationRun,
  type SimulationLeadState,
  type SimulationRun,
  type SimulationOperatorState,
  type SimulationTimelineEvent,
} from "./simulationState";

// ── Configuration ──────────────────────────────────────────────────

export interface SimulationConfig {
  runId?: string;
  seed?: number;
  operatorProfile?: OperatorProfileId;
  /** Real task list to seed the simulation from (read-only). */
  tasks: any[];
  /** ISO date for simulated day 0. Defaults to today. */
  anchorIso?: string;
  /** Calls per day cap (defaults to operator profile's capacity). */
  dailyCallCapacity?: number;
}

export interface SimulationDayResult {
  day: number;
  iso: string;
  callsAttempted: number;
  outcomes: Record<SimulationOutcomeId, number>;
  callbacksFired: number;
  callbacksScheduled: number;
  followupsFired: number;
  newWonRevenue: number;
  backlogSize: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function readIntelligenceModifiers(task: any): IntelligenceModifiers {
  const fit = task ? computeLaborTechServiceFit(task) : null;
  const scan = task?.laborTechScan ?? null;
  const closeability = typeof scan?.closeability?.score === "number" ? scan.closeability.score : 50;
  const urgencyRaw = scan?.urgency?.label;
  const urgency =
    urgencyRaw === "Critical" || urgencyRaw === "High" || urgencyRaw === "Medium" || urgencyRaw === "Low"
      ? urgencyRaw
      : null;
  const serviceFit = fit ? (fit.scores[fit.primaryService] ?? 50) : 50;
  const phone = task?.phone ?? task?.contacts?.primaryPhone ?? null;
  const verifiedEmail = task?.verifiedEmail ?? null;
  return {
    closeability,
    urgency,
    serviceFit,
    hasPhone: !!phone,
    hasVerifiedEmail: !!verifiedEmail,
  };
}

function makeInitialLeadState(runId: string, task: any): SimulationLeadState {
  const intel = readIntelligenceModifiers(task);
  const closeProb = Math.min(1, Math.max(0, intel.closeability / 100));
  const fitBoost = Math.min(1, Math.max(0, intel.serviceFit / 100));
  const responseBase = (closeProb * 0.6 + fitBoost * 0.4);
  return {
    leadId: String(task?.id ?? task?.linkedLeadId ?? "unknown"),
    simId: namespacedSimId(runId, String(task?.id ?? "unknown")),
    simulatedOutcome: null,
    callAttempts: 0,
    callbackProbability: 0.20 + closeProb * 0.30,
    closeProbability: closeProb,
    urgencyDecay: 1.0,
    followupWindow: null,
    operatorConfidence: 0.5,
    responseLikelihood: responseBase,
    nextRecommendedAction: "Initial call",
    simulatedRevenue: 0,
    timelineEvents: [],
  };
}

function makeOperatorState(profile: OperatorProfile): SimulationOperatorState {
  return {
    profileId: profile.id,
    callsToday: 0,
    callsTotal: 0,
    fatigue: 0,
    backlogSize: 0,
  };
}

function dayPlusDays(anchorIso: string, day: number): string {
  const d = new Date(anchorIso);
  d.setHours(0, 0, 0, 0);
  let dayOffset = 0;
  let added = 0;
  while (added < day) {
    dayOffset++;
    const probe = new Date(d);
    probe.setDate(d.getDate() + dayOffset);
    const dow = probe.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    added++;
  }
  const final = new Date(d);
  final.setDate(d.getDate() + dayOffset);
  return final.toISOString();
}

function emptyOutcomeCounter(): Record<SimulationOutcomeId, number> {
  return {
    no_answer: 0, interested: 0, callback_requested: 0, wrong_number: 0,
    qualified: 0, proposal_sent: 0, closed_won: 0, closed_lost: 0, ghosted: 0,
  };
}

// ── Engine ────────────────────────────────────────────────────────

export function startSimulation(config: SimulationConfig): SimulationRun {
  const runId = config.runId ?? `sim-${Date.now()}`;
  const seed = typeof config.seed === "number" ? config.seed : 42;
  const profile = OPERATOR_PROFILES[config.operatorProfile ?? "average_rep"];
  const anchorIso = config.anchorIso ?? new Date().toISOString();

  const leads: Record<string, SimulationLeadState> = {};
  for (const task of config.tasks ?? []) {
    if (!task || !task.id) continue;
    const state = makeInitialLeadState(runId, task);
    leads[state.simId] = state;
  }

  const run: SimulationRun = {
    runId,
    seed,
    startedAtIso: new Date().toISOString(),
    anchorIso,
    day: 0,
    leads,
    operator: makeOperatorState(profile),
    metrics: {
      totalCalls: 0,
      totalContacts: 0,
      totalQualified: 0,
      totalProposalsSent: 0,
      totalClosedWon: 0,
      totalClosedLost: 0,
      totalGhosted: 0,
      totalCallbacks: 0,
      callbacksPending: 0,
      queuePressure: Object.keys(leads).length,
      simulatedRevenue: 0,
      leadDecayCount: 0,
      daysSimulated: 0,
    },
    events: [{
      day: 0,
      iso: anchorIso,
      kind: "lead_ingested",
      payload: { count: Object.keys(leads).length, profile: profile.id, seed },
    }],
  };

  return run;
}

// Pick the next leads to call today. Reads sim state + real intel.
// Pure: returns a sorted array of simIds.
function pickCallQueueForDay(
  run: SimulationRun,
  taskById: Record<string, any>,
  profile: OperatorProfile,
  rng: () => number,
): string[] {
  const candidates: Array<{ simId: string; score: number }> = [];
  for (const [simId, state] of Object.entries(run.leads)) {
    if (state.simulatedOutcome && TERMINAL_OUTCOMES.has(state.simulatedOutcome)) continue;
    // Followup-window gate: if a followup is scheduled for a future day,
    // skip until that day arrives.
    if (typeof state.followupWindow === "number" && state.followupWindow > 0) continue;
    const task = taskById[state.leadId];
    const intel = readIntelligenceModifiers(task);
    // Score = closeability × urgency factor × (1 + callback boost) × decay.
    const urgencyMult =
      intel.urgency === "Critical" ? 1.4
      : intel.urgency === "High"   ? 1.2
      : intel.urgency === "Low"    ? 0.85 : 1.0;
    const score = (intel.closeability / 100) * urgencyMult
      * (1 + state.callbackProbability * 0.5)
      * (0.5 + state.urgencyDecay * 0.5);
    candidates.push({ simId, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  // Operator may skip a fraction of low-priority leads (bottom third).
  const cutoff = Math.floor(candidates.length * 2 / 3);
  const filtered = candidates.filter((c, i) => {
    if (i < cutoff) return true;
    return rng() > profile.skipLowPriorityRate;
  });

  // Cap at operator's daily capacity (lower if heavy fatigue).
  const fatigueDrag = Math.max(0.4, 1 - run.operator.fatigue);
  const cap = Math.max(1, Math.floor(profile.dailyCallCapacity * fatigueDrag));
  return filtered.slice(0, cap).map((c) => c.simId);
}

export function advanceOneDay(
  run: SimulationRun,
  taskById: Record<string, any>,
): SimulationDayResult {
  const profile = OPERATOR_PROFILES[run.operator.profileId];
  const rng = createRng(run.seed + run.day);
  const queue = pickCallQueueForDay(run, taskById, profile, rng);
  const dayIso = dayPlusDays(run.anchorIso, run.day);
  const outcomes = emptyOutcomeCounter();
  let callsAttempted = 0;
  let callbacksFired = 0;
  let callbacksScheduled = 0;
  let followupsFired = 0;
  let newWonRevenue = 0;

  for (const simId of queue) {
    const before = run.leads[simId];
    if (!before) continue;
    if (before.simulatedOutcome && TERMINAL_OUTCOMES.has(before.simulatedOutcome)) continue;

    const task = taskById[before.leadId];
    const intel = readIntelligenceModifiers(task);
    const stage = stageFor(before.callAttempts, before.simulatedOutcome);
    const baseWeights = weightsFor(stage);
    const tunedWeights = modulateWeights(baseWeights, intel, profile, before);
    // Operator fatigue adds a no-answer/ghosted drag.
    const fatigueWeights = { ...tunedWeights };
    const fatigueDrag = 1 + run.operator.fatigue * 0.4;
    fatigueWeights.no_answer *= fatigueDrag;
    fatigueWeights.ghosted   *= fatigueDrag;

    const outcome = sampleOutcome(fatigueWeights, rng);
    const after = applyOutcomeToLeadState(before, {
      outcome,
      intel,
      operator: profile,
      day: run.day,
      iso: dayIso,
    });

    run.leads[simId] = after;
    callsAttempted++;
    outcomes[outcome] += 1;
    if (outcome !== "no_answer" && outcome !== "wrong_number") {
      run.metrics.totalContacts++;
    }
    if (outcome === "qualified") run.metrics.totalQualified++;
    if (outcome === "proposal_sent") run.metrics.totalProposalsSent++;
    if (outcome === "closed_won") {
      run.metrics.totalClosedWon++;
      newWonRevenue += after.simulatedRevenue;
    }
    if (outcome === "closed_lost") run.metrics.totalClosedLost++;
    if (outcome === "ghosted") run.metrics.totalGhosted++;
    if (outcome === "callback_requested") {
      callbacksScheduled++;
      run.metrics.totalCallbacks++;
    }

    // Was this a followup or a callback firing?
    if (before.callAttempts > 0) followupsFired++;
    if (before.callbackProbability > 0.5) callbacksFired++;

    run.operator.callsToday++;
    run.operator.callsTotal++;
    run.operator.fatigue = Math.min(1, run.operator.fatigue + profile.fatigueRate);
  }

  // End-of-day decay across all active leads.
  let backlog = 0;
  let pending = 0;
  let decayed = 0;
  for (const [simId, state] of Object.entries(run.leads)) {
    const next = decayLeadDaily(state);
    run.leads[simId] = next;
    if (!next.simulatedOutcome || !TERMINAL_OUTCOMES.has(next.simulatedOutcome)) {
      backlog++;
      if (typeof next.followupWindow === "number" && next.followupWindow > 0) pending++;
      if (next.urgencyDecay <= 0.2 && state.urgencyDecay > 0.2) decayed++;
    }
  }

  // Overnight: operator fatigue partially recovers; daily call counter resets.
  run.operator.callsToday = 0;
  run.operator.fatigue = Math.max(0, run.operator.fatigue * 0.6);
  run.operator.backlogSize = backlog;
  run.metrics.totalCalls += callsAttempted;
  run.metrics.callbacksPending = pending;
  run.metrics.queuePressure = backlog;
  run.metrics.simulatedRevenue += newWonRevenue;
  run.metrics.leadDecayCount += decayed;
  run.metrics.daysSimulated++;

  run.events.push({
    day: run.day,
    iso: dayIso,
    kind: "outcome_recorded",
    payload: { callsAttempted, outcomes, newWonRevenue, backlog },
  });

  run.day += 1;
  return {
    day: run.day - 1,
    iso: dayIso,
    callsAttempted,
    outcomes,
    callbacksFired,
    callbacksScheduled,
    followupsFired,
    newWonRevenue,
    backlogSize: backlog,
  };
}

export function advanceDays(
  run: SimulationRun,
  taskById: Record<string, any>,
  days: number,
): SimulationDayResult[] {
  const out: SimulationDayResult[] = [];
  for (let i = 0; i < days; i++) {
    out.push(advanceOneDay(run, taskById));
    // Stop early if every lead is terminal.
    const allTerminal = Object.values(run.leads).every(
      (l) => l.simulatedOutcome && TERMINAL_OUTCOMES.has(l.simulatedOutcome),
    );
    if (allTerminal) break;
  }
  return out;
}

// ── 30-day stress test ─────────────────────────────────────────────

export interface StressTestSummary {
  runId: string;
  seed: number;
  profile: OperatorProfileId;
  totalLeadsIngested: number;
  daysSimulated: number;
  callsAttempted: number;
  contacts: number;
  qualified: number;
  proposalsSent: number;
  closedWon: number;
  closedLost: number;
  ghosted: number;
  callbacksScheduled: number;
  callbacksPending: number;
  queuePressureFinal: number;
  simulatedRevenue: number;
  leadsDecayed: number;
  contactRate: number;
  qualificationRate: number;
  closeRate: number;
  daily: SimulationDayResult[];
}

/**
 * Runs a deterministic 30-day stress test against the supplied
 * production task list. Read-only over `tasks`; never mutates.
 *
 *   • Day 0: ingest all tasks
 *   • Day 0–29: each weekday operator works the queue
 *     within capacity, follow-ups + callbacks fire, leads decay
 *   • Optional weekly re-ingestion via `weeklyIngestion`
 */
export function run30DayStressTest(
  tasks: any[],
  options: {
    seed?: number;
    operatorProfile?: OperatorProfileId;
    /** Optional callback that returns extra tasks for week N (1, 2, 3). */
    weeklyIngestion?: (weekIndex: number) => any[];
    persist?: boolean;
  } = {},
): StressTestSummary {
  const run = startSimulation({
    runId: `sim-30day-${options.seed ?? 42}`,
    seed: options.seed ?? 42,
    operatorProfile: options.operatorProfile ?? "average_rep",
    tasks,
  });

  const taskById: Record<string, any> = {};
  for (const t of tasks) if (t && t.id) taskById[String(t.id)] = t;

  const daily: SimulationDayResult[] = [];
  for (let day = 0; day < 30; day++) {
    // Optional weekly ingestion at end of weeks 1, 2, 3 (5 weekdays per week).
    if (day > 0 && day % 5 === 0 && typeof options.weeklyIngestion === "function") {
      const weekIndex = Math.floor(day / 5);
      const extra = options.weeklyIngestion(weekIndex);
      for (const t of extra ?? []) {
        if (!t || !t.id) continue;
        taskById[String(t.id)] = t;
        const state = makeInitialLeadState(run.runId, t);
        run.leads[state.simId] = state;
      }
      run.events.push({
        day,
        iso: dayPlusDays(run.anchorIso, day),
        kind: "lead_ingested",
        payload: { count: (extra ?? []).length, week: weekIndex },
      });
    }
    daily.push(advanceOneDay(run, taskById));
  }

  if (options.persist) writeSimulationRun(run);

  const totalLeads = Object.keys(run.leads).length;
  const contactRate = run.metrics.totalCalls > 0 ? run.metrics.totalContacts / run.metrics.totalCalls : 0;
  const qualificationRate = totalLeads > 0 ? run.metrics.totalQualified / totalLeads : 0;
  const closeRate = totalLeads > 0 ? run.metrics.totalClosedWon / totalLeads : 0;

  return {
    runId: run.runId,
    seed: run.seed,
    profile: run.operator.profileId,
    totalLeadsIngested: totalLeads,
    daysSimulated: run.metrics.daysSimulated,
    callsAttempted: run.metrics.totalCalls,
    contacts: run.metrics.totalContacts,
    qualified: run.metrics.totalQualified,
    proposalsSent: run.metrics.totalProposalsSent,
    closedWon: run.metrics.totalClosedWon,
    closedLost: run.metrics.totalClosedLost,
    ghosted: run.metrics.totalGhosted,
    callbacksScheduled: run.metrics.totalCallbacks,
    callbacksPending: run.metrics.callbacksPending,
    queuePressureFinal: run.metrics.queuePressure,
    simulatedRevenue: run.metrics.simulatedRevenue,
    leadsDecayed: run.metrics.leadDecayCount,
    contactRate,
    qualificationRate,
    closeRate,
    daily,
  };
}

// Re-exports for callers that only need the engine surface.
export { OPERATOR_PROFILES } from "./simulationProfiles";
export { createRng } from "./simulationOutcomes";
export type { SimulationLeadState, SimulationRun } from "./simulationState";
export type { SimulationOutcomeId, OperatorProfileId } from "./simulationProfiles";
