// Meridian AI — Canonical Lead Scoring.
//
// One brain. Every Calendar surface (Execute Now, Capital Allocation,
// Top 3, weekly grid ordering, taskScore) reads its numbers from this
// file. All other scoring helpers in tasks.ts / executeNow.ts /
// workflowEngine.ts have been collapsed into thin wrappers around
// scoreLeadTask(task).
//
// Pure: no React, no I/O, no localStorage, no UI imports.

import type { TaskItem, TaskPriority, TaskSeverity, DealConfidence } from "./tasks";

// ── Public types ───────────────────────────────────────────────────────

export interface LeadScoreContext {
  now?: Date;
}

export interface LeadScoreBreakdown {
  priorityScore: number;
  economicScore: number;
  urgencyScore: number;
  closeProbabilityScore: number;
  strategicScore: number;
  riskScore: number;
  confidenceScore: number;
  actionabilityScore: number;
}

export interface LeadScoreResult {
  executeScore: number;
  allocationScore: number;
  taskScore: number;
  urgencyScore: number;
  economicValue: number;
  expectedValue?: number;
  revenueImpact?: number;
  closeProbability?: number;
  priorityRank: number;
  confidence: "high" | "medium" | "low";
  reason: string;
  breakdown: LeadScoreBreakdown;
}

// ── Constants ──────────────────────────────────────────────────────────

const PRIORITY_W: Record<TaskPriority, number> = {
  critical: 100,
  high: 75,
  medium: 45,
  low: 20,
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const SEVERITY_W: Record<TaskSeverity, number> = {
  high: 100,
  medium: 50,
  low: 15,
};

const CONF_W: Record<DealConfidence, number> = {
  high: 90,
  medium: 65,
  low: 35,
};

const ECONOMIC_NORMALIZER = Math.sqrt(100_000);
const NEUTRAL_PROB_FALLBACK = 35;
const MISSING_CONFIDENCE = 50;

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function roundScore(n: number): number {
  return Math.round(clamp01_100(n));
}

// ── Per-axis scorers ───────────────────────────────────────────────────

export function priorityRank(p: TaskPriority): number {
  return PRIORITY_RANK[p] ?? 0;
}

function priorityScoreOf(p: TaskPriority): number {
  return PRIORITY_W[p] ?? 0;
}

export function economicValue(t: TaskItem): number {
  if (typeof t.expectedValue === "number" && t.expectedValue > 0) return t.expectedValue;
  if (typeof t.revenueImpact === "number" && t.revenueImpact > 0) return t.revenueImpact;
  return 0;
}

function economicScoreOf(t: TaskItem): number {
  const v = economicValue(t);
  if (v <= 0) return 0;
  // Square-root curve so $250K registers strongly without flattening
  // smaller, still-meaningful items. Soft cap at 100.
  return clamp01_100((Math.sqrt(v) / ECONOMIC_NORMALIZER) * 100);
}

export function urgencyScore(t: TaskItem, now: Date = new Date()): number {
  const anchorIso = t.startTime ?? t.dueDate ?? null;
  if (!anchorIso) return 20;
  const ms = new Date(anchorIso).getTime() - now.getTime();
  if (!Number.isFinite(ms)) return 20;
  if (ms < 0) return 100;                            // overdue
  const hours = ms / 3_600_000;
  // "Today" boundary uses local-day heuristic via 24h proxy.
  if (hours < 6)  return 90;                         // due today / next few hours
  if (hours < 24) return 80;                         // within 24h
  if (hours < 48) return 65;                         // within 48h
  if (hours < 168) return 40;                        // within 7d
  return 20;
}

function closeProbabilityScoreOf(t: TaskItem): number {
  if (typeof t.closeProbability !== "number" || !Number.isFinite(t.closeProbability)) {
    return NEUTRAL_PROB_FALLBACK;
  }
  return clamp01_100(Math.max(0, Math.min(1, t.closeProbability)) * 100);
}

function strategicScoreOf(t: TaskItem): number {
  if (!t.strategicImportance) return 50;
  return SEVERITY_W[t.strategicImportance] ?? 50;
}

function riskScoreOf(t: TaskItem): number {
  if (!t.riskIfMissed) return 50;
  return SEVERITY_W[t.riskIfMissed] ?? 50;
}

export function confidenceScore(t: TaskItem): number {
  if (!t.dealConfidence) return MISSING_CONFIDENCE;
  return CONF_W[t.dealConfidence] ?? MISSING_CONFIDENCE;
}

function hasTrustedPhone(t: TaskItem): boolean {
  return !!(t.phone && t.phoneAuthority === "dialable");
}

function hasVerifiedEmail(t: TaskItem): boolean {
  return !!(t.verifiedEmail || (t.email && t.emailConfidence && t.emailConfidence.toLowerCase() === "high"));
}

function isCallWork(t: TaskItem): boolean {
  return typeof t.id === "string" && t.id.endsWith("-call");
}

function actionabilityScoreOf(t: TaskItem): number {
  if (hasTrustedPhone(t)) return 100;
  if (hasVerifiedEmail(t)) return 70;
  if (t.email) return 55;
  if (typeof t.id === "string" && t.id.endsWith("-contact")) return 35;
  return 15;
}

function deriveConfidence(t: TaskItem): "high" | "medium" | "low" {
  if (t.dealConfidence) return t.dealConfidence;
  const cs = confidenceScore(t);
  if (cs >= 80) return "high";
  if (cs >= 50) return "medium";
  return "low";
}

// ── Reason copy (short, deterministic) ─────────────────────────────────

function reasonFor(t: TaskItem, b: LeadScoreBreakdown): string {
  const parts: string[] = [];
  if (b.urgencyScore >= 100) parts.push("Overdue");
  else if (b.urgencyScore >= 80) parts.push("Active timing");
  if (t.priority === "critical") parts.push("critical priority");
  else if (t.priority === "high") parts.push("high priority");
  if (b.economicScore >= 35) parts.push("measurable expected value");
  if (b.strategicScore >= 80) parts.push("strategically important");
  if (parts.length === 0) {
    return "Best move available right now given current pipeline state.";
  }
  return parts.join(" · ");
}

// ── Public entry ───────────────────────────────────────────────────────

export function scoreLeadTask(
  task: TaskItem,
  context: LeadScoreContext = {},
): LeadScoreResult {
  const now = context.now ?? new Date();

  const breakdown: LeadScoreBreakdown = {
    priorityScore:        priorityScoreOf(task.priority),
    economicScore:        economicScoreOf(task),
    urgencyScore:         urgencyScore(task, now),
    closeProbabilityScore: closeProbabilityScoreOf(task),
    strategicScore:       strategicScoreOf(task),
    riskScore:            riskScoreOf(task),
    confidenceScore:      confidenceScore(task),
    actionabilityScore:   actionabilityScoreOf(task),
  };

  if (isCallWork(task) && !hasTrustedPhone(task)) {
    breakdown.priorityScore = Math.min(breakdown.priorityScore, hasVerifiedEmail(task) ? 55 : 35);
    breakdown.urgencyScore = Math.min(breakdown.urgencyScore, hasVerifiedEmail(task) ? 60 : 40);
    breakdown.riskScore = Math.min(breakdown.riskScore, 50);
  }

  const executeScore = roundScore(
    breakdown.priorityScore         * 0.20 +
    breakdown.economicScore         * 0.20 +
    breakdown.urgencyScore          * 0.18 +
    breakdown.closeProbabilityScore * 0.10 +
    breakdown.strategicScore        * 0.10 +
    breakdown.riskScore             * 0.07 +
    breakdown.actionabilityScore    * 0.15,
  );

  const allocationScore = roundScore(
    breakdown.economicScore         * 0.25 +
    breakdown.closeProbabilityScore * 0.18 +
    breakdown.urgencyScore          * 0.12 +
    breakdown.confidenceScore       * 0.12 +
    breakdown.strategicScore        * 0.13 +
    breakdown.actionabilityScore    * 0.20,
  );

  let taskScore = roundScore(
    breakdown.priorityScore  * 0.30 +
    breakdown.urgencyScore   * 0.18 +
    breakdown.economicScore  * 0.17 +
    breakdown.strategicScore * 0.13 +
    breakdown.riskScore      * 0.10 +
    breakdown.actionabilityScore * 0.12,
  );
  if (isCallWork(task) && !hasTrustedPhone(task)) {
    taskScore = Math.min(taskScore, hasVerifiedEmail(task) ? 62 : 48);
  }

  return {
    executeScore,
    allocationScore,
    taskScore,
    urgencyScore: breakdown.urgencyScore,
    economicValue: economicValue(task),
    expectedValue: task.expectedValue,
    revenueImpact: task.revenueImpact,
    closeProbability: task.closeProbability,
    priorityRank: priorityRank(task.priority),
    confidence: deriveConfidence(task),
    reason: reasonFor(task, breakdown),
    breakdown,
  };
}

export function scoreLeadTasks(
  tasks: TaskItem[] | null | undefined,
  context: LeadScoreContext = {},
): Array<{ task: TaskItem; score: LeadScoreResult }> {
  if (!Array.isArray(tasks)) return [];
  return tasks.map((task) => ({ task, score: scoreLeadTask(task, context) }));
}

// Comparator suitable for Array.prototype.sort (descending by canonical
// importance). Stable on full ties — the caller can preserve original
// order with an indexed sort wrapper if needed.
export function compareLeadTasks(
  a: TaskItem,
  b: TaskItem,
  context: LeadScoreContext = {},
): number {
  const sa = scoreLeadTask(a, context);
  const sb = scoreLeadTask(b, context);
  if (sb.taskScore !== sa.taskScore) return sb.taskScore - sa.taskScore;
  if (sb.executeScore !== sa.executeScore) return sb.executeScore - sa.executeScore;
  if (sb.allocationScore !== sa.allocationScore) return sb.allocationScore - sa.allocationScore;
  if (sb.breakdown.actionabilityScore !== sa.breakdown.actionabilityScore) {
    return sb.breakdown.actionabilityScore - sa.breakdown.actionabilityScore;
  }
  if (sb.urgencyScore !== sa.urgencyScore) return sb.urgencyScore - sa.urgencyScore;
  return 0;
}
