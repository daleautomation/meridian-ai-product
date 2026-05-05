// Meridian — Unified Decision Engine.
//
// Single canonical projection of every operational decision Meridian
// makes about a lead. Composes the three existing layers:
//   • buildLeadSignals      → fired/missing/byCategory/scoringInputs
//   • buildStructuredServiceStrategy → primary/secondary/pitch/warnings
//   • computeLaborTechServiceFit  → opener / whyNow
// Plus the existing scheduling primitives (no scheduler rewrite).
//
// CRITICAL: this engine never invents data. It reuses outputs of the
// upstream layers and projects them into one decision object. Every
// downstream consumer (Operator Panel, Calendar cards, Today queue,
// AI Assistant, future automation agents) reads decision fields
// directly instead of re-deriving them.

import { buildLeadSignals, type LeadSignalsResult, type SignalCategory } from "./leadSignals";
import {
  buildStructuredServiceStrategy,
  computeLaborTechServiceFit,
  type ServiceStrategy,
  type ServiceFitId,
} from "../scan/serviceFit";

// ── Public types ────────────────────────────────────────────────────

export type ExecutionTier = "CLOSE_NOW" | "STRONG" | "TEST" | "QUEUED";
export type UrgencyLevel = "Critical" | "High" | "Medium" | "Low" | null;
export type ConfidenceLevel = "High" | "Medium" | "Low";
export type QueueBucket = "Day-1" | "Day-2+" | "Overflow" | null;

export interface LeadDecisionExecution {
  priorityRank: number;          // higher is more urgent (0–100)
  executionTier: ExecutionTier;
  executionScore: number;        // closeability × urgency, 0–100
  urgencyLevel: UrgencyLevel;
  confidenceLevel: ConfidenceLevel;
  recommendedToday: boolean;
}

export interface LeadDecisionActions {
  nextBestAction: string;
  primaryCTA: "Call" | "Email" | "Find contact" | "Pull deeper scan";
  shouldCall: boolean;
  shouldEmail: boolean;
  shouldDeepScan: boolean;
  shouldVerifyEmail: boolean;
  shouldDefer: boolean;
  shouldEscalate: boolean;
  shouldScheduleFollowup: boolean;
}

export interface LeadDecisionScheduling {
  recommendedDay: string | null;     // ISO date (YYYY-MM-DD)
  recommendedTime: string | null;    // HH:mm local
  recommendedWindow: "Morning" | "Midday" | "Afternoon" | null;
  recommendedCadence: "Today" | "This week" | "Next week" | "Backlog";
  queueBucket: QueueBucket;
  overflowEligible: boolean;
  noWeekendEligible: boolean;
  schedulingReason: string;
}

export interface LeadDecisionRouting {
  routeTo: "Operator" | "Inbound queue" | "Verification queue" | "Manager";
  routeReason: string;
  operatorType: "AE" | "SDR" | "Closer" | "Researcher";
  requiredSkillLevel: "Junior" | "Senior" | "Specialist";
}

export interface LeadDecisionReasoning {
  strongestSignals: string[];        // top fired signal labels
  strongestPain: string | null;
  strongestServiceFit: { id: ServiceFitId | null; label: string | null; score: number | null };
  blockers: string[];                // contact gaps, missing scan, etc.
  missingEvidence: string[];         // top missing-signal labels
  confidenceReasons: string[];
  whyNow: string | null;
}

export interface LeadDecisionAssistant {
  operatorSummary: string;
  nextActionPrompt: string;
  followupPrompt: string;
  callPrepPrompt: string;
  objectionPrepPrompt: string;
}

export interface LeadDecision {
  execution: LeadDecisionExecution;
  actions: LeadDecisionActions;
  scheduling: LeadDecisionScheduling;
  routing: LeadDecisionRouting;
  reasoning: LeadDecisionReasoning;
  assistant: LeadDecisionAssistant;
  raw: {
    signals: LeadSignalsResult;
    strategy: ServiceStrategy | null;
    // intelligence is referenced through the parent layer; we expose
    // a slot so consumers can attach it without a circular import.
    intelligence?: unknown;
  };
}

export interface BuildLeadDecisionOptions {
  industryId?: string;
  now?: Date;
}

// ── Helpers ─────────────────────────────────────────────────────────

const NOT_ENOUGH = "Not enough evidence yet";
const NEEDS_SCAN = "Needs deeper scan";

function tierFromCloseability(c: number | null): ExecutionTier {
  if (typeof c !== "number") return "QUEUED";
  if (c >= 80) return "CLOSE_NOW";
  if (c >= 60) return "STRONG";
  if (c >= 40) return "TEST";
  return "QUEUED";
}

function windowFromHour(hour: number): "Morning" | "Midday" | "Afternoon" {
  if (hour < 12) return "Morning";
  if (hour < 14) return "Midday";
  return "Afternoon";
}

function isWeekendIso(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

function pickString(...vals: any[]): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

// ── Builder ─────────────────────────────────────────────────────────

export function buildLeadDecision(
  task: any,
  options: BuildLeadDecisionOptions = {},
): LeadDecision {
  const lead = task ?? {};
  const industryId = options.industryId ?? "labortech";

  // Read every upstream layer once. No work is duplicated.
  const signals = buildLeadSignals(lead, { industryId });
  const fit = signals.raw.scan ? computeLaborTechServiceFit(lead) : null;
  const strategy = signals.raw.scan ? buildStructuredServiceStrategy(lead) : null;

  const phone = pickString(lead.phone, lead.phoneNumber, lead?.contacts?.primaryPhone);
  const email = pickString(lead.verifiedEmail, lead.email, lead?.contacts?.primaryEmail);
  const verifiedEmail = pickString(lead.verifiedEmail);
  const status = typeof lead.status === "string" ? lead.status : null;
  const blocked = status === "blocked";

  const closeability = signals.scoringInputs.closeability.score;
  const urgencyLabel = signals.scoringInputs.urgency.label as UrgencyLevel;
  const opportunityScore = signals.scoringInputs.opportunity.score ?? 0;
  const tier: ExecutionTier = signals.scoringInputs.opportunity.tier;
  const confidenceLevel: ConfidenceLevel = signals.scoringInputs.confidence.level;

  const isHotUrgency = urgencyLabel === "Critical" || urgencyLabel === "High";
  const recommendedToday = !blocked && (
    tier === "CLOSE_NOW" ||
    (tier === "STRONG" && isHotUrgency)
  );

  // ── execution ────────────────────────────────────────────────────
  const execution: LeadDecisionExecution = {
    priorityRank: opportunityScore,
    executionTier: tier,
    executionScore: opportunityScore,
    urgencyLevel: urgencyLabel,
    confidenceLevel,
    recommendedToday,
  };

  // ── actions ──────────────────────────────────────────────────────
  const hasScan = !!signals.raw.scan;
  const shouldCall = !blocked && !!phone;
  const shouldEmail = !blocked && (!phone || !!verifiedEmail) && !!email;
  const shouldDeepScan = !hasScan;
  const shouldVerifyEmail = !blocked && !verifiedEmail && !email && hasScan;
  const shouldDefer = blocked || (!shouldCall && !shouldEmail && !shouldVerifyEmail && !shouldDeepScan);
  const shouldEscalate = !!(blocked && hasScan && opportunityScore >= 75);
  const shouldScheduleFollowup = (status === "in_progress") ||
    (urgencyLabel === "Medium" && !shouldCall && !shouldEmail);

  const nextBestAction = (() => {
    if (!hasScan) return NEEDS_SCAN;
    if (blocked) return "Lead is blocked — resolve contact info before any outreach.";
    if (shouldCall && isHotUrgency) return "Call now — urgency is high. Lead with the opening angle.";
    if (shouldCall) return "Call today and lead with the opening angle.";
    if (shouldEmail) return "Send the opening angle via email today.";
    if (shouldVerifyEmail) return "Run Hunter to verify a contact email before reaching out.";
    return "Find a phone or verified email before reaching out.";
  })();

  const primaryCTA: LeadDecisionActions["primaryCTA"] = (() => {
    if (shouldCall) return "Call";
    if (shouldEmail) return "Email";
    if (shouldVerifyEmail) return "Find contact";
    return "Pull deeper scan";
  })();

  const actions: LeadDecisionActions = {
    nextBestAction,
    primaryCTA,
    shouldCall,
    shouldEmail,
    shouldDeepScan,
    shouldVerifyEmail,
    shouldDefer,
    shouldEscalate,
    shouldScheduleFollowup,
  };

  // ── scheduling ───────────────────────────────────────────────────
  // Mirror the existing scheduler's decisions instead of recomputing.
  // Reads task.dueDate (the master plan stamps this) and projects
  // window/cadence/bucket. Scheduler is NOT changed in this pass.
  const dueIso = typeof lead.dueDate === "string" ? lead.dueDate : null;
  const dueDate = dueIso ? new Date(dueIso) : null;
  const recommendedDay = dueDate && !Number.isNaN(dueDate.getTime())
    ? dueDate.toISOString().slice(0, 10)
    : null;
  const recommendedTime = dueDate && !Number.isNaN(dueDate.getTime())
    ? `${String(dueDate.getHours()).padStart(2, "0")}:${String(dueDate.getMinutes()).padStart(2, "0")}`
    : null;
  const recommendedWindow = dueDate && !Number.isNaN(dueDate.getTime())
    ? windowFromHour(dueDate.getHours())
    : null;
  const onWeekend = isWeekendIso(dueIso);
  const queueBucket: QueueBucket = (() => {
    if (typeof closeability !== "number") return null;
    if (closeability >= 75) return "Day-1";
    if (closeability >= 50) return "Day-2+";
    return "Overflow";
  })();
  const recommendedCadence: LeadDecisionScheduling["recommendedCadence"] = (() => {
    if (recommendedToday) return "Today";
    if (queueBucket === "Day-1") return "Today";
    if (queueBucket === "Day-2+") return "This week";
    if (queueBucket === "Overflow") return "Backlog";
    if (status === "in_progress") return "This week";
    return "Backlog";
  })();
  const schedulingReason = (() => {
    if (!hasScan) return NEEDS_SCAN;
    if (blocked) return "Blocked — held out of scheduling until contact resolves.";
    if (recommendedToday) return `Day-1 priority: ${tier} tier × ${urgencyLabel ?? "Medium"} urgency.`;
    if (queueBucket === "Day-1") return "Closeability ≥ 75 — earns a Day-1 slot.";
    if (queueBucket === "Day-2+") return "Closeability ≥ 50 — slots within the working week.";
    if (queueBucket === "Overflow") return "Closeability below the working-week threshold — overflow.";
    return "Awaiting scheduling input.";
  })();
  const scheduling: LeadDecisionScheduling = {
    recommendedDay,
    recommendedTime,
    recommendedWindow,
    recommendedCadence,
    queueBucket,
    overflowEligible: queueBucket === "Overflow",
    noWeekendEligible: !onWeekend,
    schedulingReason,
  };

  // ── routing ──────────────────────────────────────────────────────
  const routing: LeadDecisionRouting = (() => {
    if (!hasScan) {
      return { routeTo: "Verification queue", routeReason: "No scan attached — needs research before operator handoff.", operatorType: "Researcher", requiredSkillLevel: "Junior" };
    }
    if (blocked) {
      return { routeTo: "Verification queue", routeReason: "Contact is blocked — needs verification.", operatorType: "Researcher", requiredSkillLevel: "Junior" };
    }
    if (tier === "CLOSE_NOW") {
      return { routeTo: "Operator", routeReason: "CLOSE_NOW tier — route to a closer immediately.", operatorType: "Closer", requiredSkillLevel: "Senior" };
    }
    if (tier === "STRONG") {
      return { routeTo: "Operator", routeReason: "STRONG tier — route to an AE.", operatorType: "AE", requiredSkillLevel: "Senior" };
    }
    if (tier === "TEST") {
      return { routeTo: "Operator", routeReason: "TEST tier — appropriate for SDR-level outreach.", operatorType: "SDR", requiredSkillLevel: "Junior" };
    }
    return { routeTo: "Inbound queue", routeReason: "Below TEST threshold — keep in inbound queue.", operatorType: "SDR", requiredSkillLevel: "Junior" };
  })();

  // ── reasoning ────────────────────────────────────────────────────
  const strongestSignals = signals.signals.fired
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map((s) => s.label);
  const strongestPain = pickString(
    signals.recommendations.strongestPain,
    signals.raw.scan?.primaryPain,
    signals.raw.scan?.headline,
  );
  const blockers: string[] = [];
  if (!hasScan) blockers.push("No scan attached");
  if (blocked) blockers.push(`Status: ${status}`);
  if (!phone && !email) blockers.push("No phone or verified email");
  if (!phone && email && !verifiedEmail) blockers.push("Email present but unverified");
  const missingEvidence = signals.evidence.gaps.slice(0, 5);
  const reasoning: LeadDecisionReasoning = {
    strongestSignals,
    strongestPain,
    strongestServiceFit: {
      id: signals.scoringInputs.serviceFit.primary,
      label: fit?.primaryServiceLabel ?? null,
      score: signals.scoringInputs.serviceFit.score,
    },
    blockers,
    missingEvidence,
    confidenceReasons: signals.scoringInputs.confidence.reasons.slice(),
    whyNow: fit?.whyNow ?? null,
  };

  // ── assistant ────────────────────────────────────────────────────
  const company = signals.identity.companyName ?? "this lead";
  const operatorSummary = hasScan
    ? `${company} — ${fit?.primaryServiceLabel ?? "no clear primary service"}; closeability ${closeability ?? "—"}, urgency ${urgencyLabel ?? "—"}, ${tier}.`
    : `${company} — ${NEEDS_SCAN}.`;
  const nextActionPrompt = hasScan
    ? `What should I do FIRST on ${company}? Tie it to the strongest fired signal and the urgency tier.`
    : NEEDS_SCAN;
  const followupPrompt = hasScan
    ? `Draft a follow-up cadence for ${company} assuming today's call goes to voicemail.`
    : NEEDS_SCAN;
  const callPrepPrompt = hasScan
    ? `Prep me for a call with ${company}: opener, expected objection, single discovery question.`
    : NEEDS_SCAN;
  const objectionPrepPrompt = hasScan
    ? `What's the most likely objection on ${company}, and what's the strongest one-line counter?`
    : NEEDS_SCAN;
  const assistant: LeadDecisionAssistant = {
    operatorSummary,
    nextActionPrompt,
    followupPrompt,
    callPrepPrompt,
    objectionPrepPrompt,
  };

  return {
    execution,
    actions,
    scheduling,
    routing,
    reasoning,
    assistant,
    raw: { signals, strategy },
  };
}

// ── Cached accessor ─────────────────────────────────────────────────

const DECISION_CACHE = new WeakMap<object, LeadDecision>();

export function getLeadDecision(task: any, opts?: BuildLeadDecisionOptions): LeadDecision {
  if (task && typeof task === "object") {
    const cached = DECISION_CACHE.get(task);
    if (cached) return cached;
    const built = buildLeadDecision(task, opts);
    DECISION_CACHE.set(task, built);
    return built;
  }
  return buildLeadDecision(task, opts);
}

// ── Dev helper ──────────────────────────────────────────────────────

export interface LeadDecisionSummary {
  executionTier: ExecutionTier;
  priorityRank: number;
  nextBestAction: string;
  strongestPain: string | null;
  recommendedWindow: "Morning" | "Midday" | "Afternoon" | null;
  shouldCall: boolean;
  shouldEmail: boolean;
  confidenceLevel: ConfidenceLevel;
}

export function summarizeLeadDecision(task: any): LeadDecisionSummary {
  const d = buildLeadDecision(task);
  return {
    executionTier: d.execution.executionTier,
    priorityRank: d.execution.priorityRank,
    nextBestAction: d.actions.nextBestAction,
    strongestPain: d.reasoning.strongestPain,
    recommendedWindow: d.scheduling.recommendedWindow,
    shouldCall: d.actions.shouldCall,
    shouldEmail: d.actions.shouldEmail,
    confidenceLevel: d.execution.confidenceLevel,
  };
}

// Suppress unused-import lint guard while keeping the type imported
// for future expansion (per-category routing rules).
type _SignalCategory = SignalCategory;
