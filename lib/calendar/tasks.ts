// Meridian AI — Calendar Command Center: task model + priority logic.
//
// Plain types and pure functions. No I/O. Mock seed lives at the bottom
// and re-anchors dates to "now" on each call so the demo week is always
// populated. When wiring to Google Calendar / Gmail / Airtable / CRM,
// replace getMockTasks with the real fetcher and keep the TaskItem shape.

// Canonical scoring brain — every helper below that ranks tasks
// delegates here. leadScore.ts only takes type-only imports from this
// file, so the runtime graph is acyclic.
import {
  scoreLeadTask as scoreLeadTaskCanonical,
  compareLeadTasks as compareLeadTasksCanonical,
} from "./leadScore";
// Trade-module + bucket classifier are pure config + pure rules. Used
// only inside buildTasksFromLeads to enrich generated tasks.
import { getTradeModule } from "../modules/tradeConfigs";
import { primaryBucketForLead } from "../modules/bucketClassifier";
import { computeScanStatus, diagnosticTaskTitle } from "../diagnostics/scanStatus";
import { getCanonicalPhone, getDialablePhoneDetails } from "../leads/phone";
import { isTerminalStatusValue, normalizeStatus } from "../crm/statusTaxonomy";
import {
  cleanIdentityValue as cleanKey,
  leadIdentityCandidates,
} from "../leads/identity";
// LABORTECH DEMO ROLLOUT — see lib/calendar/laborTechDemoSchedule.ts.
// Reversible via the flag inside that file; remove this import (and the
// call site at the end of buildTasksFromLeads) to drop the demo entirely.
import { applyLaborTechDemoSchedule } from "./laborTechDemoSchedule";

export type TaskCategory =
  | "priority"
  | "meeting"
  | "followup"
  | "revenue"
  | "product"
  | "admin"
  | "personal";

export type TaskPriority = "critical" | "high" | "medium" | "low";
export type TaskStatus = "todo" | "in_progress" | "done" | "blocked";
export type TaskSeverity = "high" | "medium" | "low";

export type DealConfidence = "high" | "medium" | "low";

export interface TaskItem {
  id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  startTime?: string;
  endTime?: string;
  revenueImpact?: number;
  riskIfMissed?: TaskSeverity;
  strategicImportance?: TaskSeverity;
  linkedPerson?: string;
  linkedCompany?: string;
  linkedLeadId?: string;
  companyKey?: string;
  crmKey?: string;
  notes?: string;
  nextAction?: string;
  /** 0..1, clamped to [0.05, 0.90]. Optional. */
  closeProbability?: number;
  dealConfidence?: DealConfidence;
  /** Probability-adjusted economic value: revenueImpact * closeProbability. */
  expectedValue?: number;
  /** True when outcome-learning nudged the base probability/confidence. */
  learningApplied?: boolean;
  /** Short headline reason from the learning layer (e.g. "Meeting booked"). */
  learningReason?: string;
  /** True when pattern learning further nudged the probability/confidence. */
  patternLearningApplied?: boolean;
  /** Short headline reason from the pattern layer. */
  patternLearningReason?: string;
  /** True when the workflow engine moved this task's effective priority. */
  workflowAdjusted?: boolean;
  /** Short reason for the workflow adjustment, surfaced inline. */
  workflowAdjustmentReason?: string;
  /** Priority before the workflow engine ran (preserved for explainability). */
  workflowOriginalPriority?: TaskPriority;
  /** Final clamped priority delta in [-1, +1]. */
  workflowPriorityDelta?: number;
  /** All workflow rule IDs that contributed to this task's adjustment. */
  workflowRuleIds?: string[];
  /** Highest-impact rule on this task (used for UI explanation). */
  workflowPrimaryRuleId?: string;
  /** Adapted weight multiplier applied to the primary rule (for audit). */
  workflowRuleWeightApplied?: number;
  /** True when an operator feedback event has been applied to this task. */
  feedbackApplied?: boolean;
  /** Short human-readable reason for the applied feedback. */
  feedbackReason?: string;
  /** Which feedback type was applied. */
  feedbackType?:
    | "accept_adjustment"
    | "override_adjustment"
    | "promote_task"
    | "defer_task";
  /** Trade module the task was generated under (roofing, hvac, …). */
  tradeId?: string;
  /** Display label for the trade module. */
  tradeLabel?: string;
  /** Service bucket within the trade (e.g. "website_conversion"). */
  serviceBucketId?: string;
  /** Display label for the service bucket. */
  serviceBucketLabel?: string;
  /** Why the classifier landed on this bucket. */
  serviceBucketReason?: string;
  /** John's selling angle for this bucket. */
  johnServiceAngle?: string;
  /** Suggested opener for outreach against this bucket. */
  suggestedOpeningLine?: string;
  /** Diagnostic-driven call script for this task (full pitch line). */
  callScript?: string;
  /** Top-1% Closer strategy attached for this lead, if available. */
  salesStrategy?: LeadLike["salesStrategy"];
  /** Compact close probability (0–100) lifted onto the task for the card. */
  closeProbability100?: number;
  /** Top LaborTech service need, used only for market-fit display calibration. */
  serviceNeed?: LeadLike["serviceNeed"];
  /** Team rep this task is assigned to (lib/scheduling/teamMembers.ts). */
  assignedRepId?: string;
  /** True when the slot was placed manually and must not be auto-moved. */
  slotLocked?: boolean;
  /** Stamped only when shared dial authority allows operational dialing. */
  phone?: string;
  phoneAuthority?: "dialable";
  email?: string;
  /** Verified-email enrichment metadata (mirrors NormalizedLead). */
  emailStatus?: string;
  verifiedEmail?: string;
  emailSource?: string;
  emailVerifiedAt?: string;
  emailConfidence?: string;
  /**
   * LaborTech premium scan attached during ingestion. Mirrors
   * NormalizedLead.laborTechScan but typed loosely here so this
   * file stays free of upward imports. Drives the View Scan report
   * + premium card copy.
   */
  laborTechScan?: LeadLike["laborTechScan"];
  /** Operator tier (CLOSE_NOW / STRONG / TEST) — stamped by the scheduler. */
  leadTier?: string;
}

export const TASK_CATEGORIES: Record<
  TaskCategory,
  { label: string; tint: string; glyph: string }
> = {
  priority: { label: "Priority", tint: "#DC2626", glyph: "◆" },
  meeting:  { label: "Meeting",  tint: "#2563EB", glyph: "◉" },
  followup: { label: "Follow Up", tint: "#7C3AED", glyph: "↻" },
  revenue:  { label: "Revenue",  tint: "#16A34A", glyph: "$" },
  product:  { label: "Product",  tint: "#0EA5E9", glyph: "▲" },
  admin:    { label: "Admin",    tint: "#64748B", glyph: "✓" },
  personal: { label: "Personal", tint: "#D97706", glyph: "●" },
};

export const CATEGORY_ORDER: TaskCategory[] = [
  "priority", "meeting", "followup", "revenue", "product", "admin", "personal",
];

// ── Priority scoring ───────────────────────────────────────────────────
// scoreTask is now a thin compatibility wrapper. The canonical scoring
// brain lives in lib/calendar/leadScore.ts. Every Calendar surface
// (Execute Now, Capital Allocation, Top 3, weekly grid, taskScore)
// reads its numbers from one place. The signature here is preserved so
// any external caller that still imports `scoreTask` keeps working.

export function scoreTask(task: TaskItem, now: Date = new Date()): number {
  return scoreLeadTaskCanonical(task, { now }).taskScore;
}

export function rankTasks(tasks: TaskItem[], now: Date = new Date()): TaskItem[] {
  return [...tasks].sort((a, b) => compareLeadTasksCanonical(a, b, { now }));
}

export function isOverdue(t: TaskItem, now: Date = new Date()): boolean {
  if (t.status === "done") return false;
  const anchor = t.dueDate ?? t.endTime ?? null;
  if (!anchor) return false;
  return new Date(anchor).getTime() < now.getTime();
}

export function taskAnchorIso(t: TaskItem): string | null {
  return t.startTime ?? t.dueDate ?? null;
}

// ── Real-lead → TaskItem bridge ────────────────────────────────────────
// Pure converter from the lead/decision objects already rendered by the
// Lead Cards tab into Calendar Command Center tasks. No I/O, no fakery —
// reads only fields the engine already populates. Missing fields are
// tolerated; tasks are only generated when their triggering signal is
// present. IDs follow `lead-{leadId}-{kind}` so re-running the function
// over the same leads is idempotent and dedupes naturally.

export interface LeadLike {
  key?: string | number | null;
  id?: string | number | null;
  companyKey?: string | null;
  crmKey?: string | null;
  name?: string | null;
  companyName?: string | null;
  domain?: string | null;
  website?: string | null;
  resolvedBusinessUrl?: string | null;
  location?: string | null;
  score?: number | null;
  bucket?: string | null;
  opportunity_label?: string | null;
  forceAction?: boolean | null;
  recommendedAction?: string | null;
  nextAction?: string | null;
  /** Top-level email mirrored from NormalizedLead. May be set even
   *  when contacts.primaryEmail isn't (e.g. raw imports). */
  email?: string | null;
  contacts?: {
    primaryPhone?: string | null;
    primaryEmail?: string | null;
    contactName?: string | null;
  } | null;
  contactPaths?: Array<{
    method?: string | null;
    value?: string | null;
    source?: string | null;
    rank?: number | null;
    confidence?: string | null;
    verified?: boolean | null;
  }> | null;
  websiteProof?: {
    homepage_fetch_ok?: boolean | null;
    issues?: string[] | null;
    site_classification?: string | null;
  } | null;
  opportunityEstimate?: {
    opportunityEstimateBand?: string | null;
    opportunityRiskLevel?: string | null;
    opportunityEstimateConfidence?: string | null;
    revenueImpactSummary?: string[] | null;
  } | null;
  estimated_lost_leads?: string | null;
  // Evidence-based diagnostics (lib/diagnostics/leadDiagnostics.ts).
  // Optional — gracefully degrades when absent.
  diagnostics?: {
    findings?: Array<{
      type?: string | null;
      issue?: string | null;
      evidence?: string | null;
      impact?: string | null;
      confidence?: string | null;
    }> | null;
    topFinding?: {
      type?: string | null;
      issue?: string | null;
      evidence?: string | null;
      impact?: string | null;
      confidence?: string | null;
    } | null;
    summary?: string | null;
  } | null;
  // Optional service-need pitch the rep should read (set by the caller
  // from serviceNeedClassifier output).
  serviceNeed?: {
    suggestedPitch?: string | null;
    needScore?: number | null;
    urgency?: string | null;
    serviceId?: string | null;
    label?: string | null;
    reason?: string | null;
  } | null;
  // Operator tier classification stamped by the rolling scheduler.
  // CLOSE_NOW (top ~25%) / STRONG (middle ~50%) / TEST (bottom ~25%).
  leadTier?: string | null;
  // Verified-email enrichment metadata (mirrors NormalizedLead).
  emailStatus?: string | null;
  verifiedEmail?: string | null;
  emailSource?: string | null;
  emailVerifiedAt?: string | null;
  emailConfidence?: string | null;
  crm?: {
    status?: string | null;
  } | null;
  accountSnapshot?: {
    status?: string | null;
  } | null;
  // LaborTech premium scan (lib/scan/laborTechScan.ts). Stamped onto
  // the lead during ingestion. Loose shape so this file does not need
  // an upward import on the scan module.
  laborTechScan?: {
    qualified?: boolean | null;
    qualificationReason?: string | null;
    primaryPain?: string | null;
    painLevel?: string | null;
    primaryService?: string | null;
    serviceFit?: string | null;
    evidence?: string[] | null;
    businessImpact?: string[] | null;
    closeability?: { score?: number | null; label?: string | null; reason?: string | null } | null;
    urgency?: { label?: string | null; reason?: string | null } | null;
    salesAngle?: { opener?: string | null; objection?: string | null; rebuttal?: string | null } | null;
    recommendedAction?: string | null;
    reportSummary?: string | null;
    risks?: string[] | null;
  } | null;
  // Optional Top-1% Closer sales strategy (lib/sales/salesStrategy.ts).
  // Loose shape so any subset of fields can be present without breaking
  // older snapshots.
  salesStrategy?: {
    closeProbability?: number | null;
    confidence?: string | null;
    closeLabel?: string | null;
    primaryAngle?: {
      rank?: number | null;
      label?: string | null;
      issue?: string | null;
      evidence?: string | null;
      impact?: string | null;
      serviceId?: string | null;
      serviceLabel?: string | null;
      pitch?: string | null;
      pivotLine?: string | null;
    } | null;
    angles?: unknown[] | null;
    objections?: unknown[] | null;
    callPlan?: {
      opener?: string | null;
      discoveryQuestions?: string[] | null;
      positioning?: string | null;
      recommendedOffer?: string | null;
      nextBestAction?: string | null;
    } | null;
  } | null;
}

export interface PipelineEntryLike {
  status?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  contactName?: string | null;
  callAttempts?: number | null;
  consecutiveNoAnswers?: number | null;
}

export interface BuildTasksOptions {
  pipelineMap?: Record<string, PipelineEntryLike> | null;
  now?: Date;
  maxLeads?: number;
  /**
   * Per-lead probability/confidence nudges from outcomeLearning. Optional —
   * when omitted, the heuristic baseline is used unchanged.
   */
  learningAdjustments?: Record<string, LearningAdjustmentLike> | null;
  /**
   * Per-pattern adjustments from patternLearning. Applied after direct
   * learning, capped at ±0.10 total. Structural type to avoid an upward
   * import on patternLearning.ts.
   */
  patternAdjustments?: Record<string, PatternAdjustmentLike> | null;
  /**
   * Current client-side execution outcomes. Keys may be task ids or
   * company identity keys; task generation resolves both for back-compat.
   */
  executionOutcomeMap?: Record<string, ExecutionOutcomeLike> | null;
  /**
   * Trade module to apply when classifying leads into service buckets.
   * Falls back to lead.tradeId / lead.trade / lead.category, then to
   * "roofing" so existing single-trade callers are unaffected.
   */
  tradeId?: string;
}

/** Structural type matching patternLearning.PatternLearningAdjustment. */
export interface PatternAdjustmentLike {
  patternKey: string;
  probabilityDelta: number;
  confidenceDelta: -1 | 0 | 1;
  sampleSize: number;
  winSignals: number;
  lossSignals: number;
  reason: string;
}

/** Structural type matching outcomeLearning.LearningAdjustment. Kept loose
 * here so tasks.ts has no upward dependency on outcomeLearning.ts. */
export interface LearningAdjustmentLike {
  leadId: string;
  probabilityDelta: number;
  confidenceDelta: -1 | 0 | 1;
  reason: string;
  lastOutcomeAt?: string;
}

export interface ExecutionOutcomeLike {
  status?: string | null;
}

const FOLLOWUP_STATUSES = new Set([
  "CONTACTED", "CALLED", "VOICEMAIL", "EMAILED",
  "FOLLOW_UP", "INTERESTED", "QUALIFIED", "PITCHED",
]);

const TERMINAL_STATUSES = new Set([
  "CLOSED_WON",
  "CLOSED_LOST",
  "NOT_QUALIFIED",
  "DISQUALIFIED",
  "ARCHIVED",
]);

const OUTCOME_TO_PIPELINE_STATUS: Record<string, string> = {
  "Not Contacted": "",
  Called: "CONTACTED",
  Interested: "FOLLOW_UP",
  "Follow Up": "FOLLOW_UP",
  Qualified: "FOLLOW_UP",
  "Proposal Sent": "FOLLOW_UP",
  "Closed Won": "CLOSED_WON",
  "Closed Lost": "CLOSED_LOST",
  "Not Qualified": "NOT_QUALIFIED",
};

function normalizePipelineStatus(raw: string | null | undefined): string {
  const upper = (raw ?? "").toString().trim().toUpperCase();
  if (!upper) return "";
  if (upper === "DISQUALIFIED") return "NOT_QUALIFIED";
  const normalized = normalizeStatus(upper);
  return normalized === "NEW" && upper !== "NEW" ? upper : normalized;
}

function leadId(l: LeadLike): string | null {
  const raw = l.key ?? l.id ?? null;
  if (raw == null) return null;
  return String(raw);
}

function leadCompanyName(l: LeadLike): string | null {
  return cleanKey(l.name) ?? cleanKey(l.companyName);
}

function leadCompanyDomain(l: LeadLike): string | null {
  return cleanKey(l.domain) ?? cleanKey(l.website) ?? cleanKey(l.resolvedBusinessUrl);
}

function identityCandidates(l: LeadLike): string[] {
  return leadIdentityCandidates(l);
}

function resolvePipelineEntry(
  l: LeadLike,
  pipelineMap: Record<string, PipelineEntryLike>,
): { key: string | null; pipe: PipelineEntryLike | null } {
  const candidates = identityCandidates(l);
  for (const key of candidates) {
    if (pipelineMap[key]) return { key, pipe: pipelineMap[key] };
  }
  return { key: candidates[0] ?? null, pipe: null };
}

function resolveExecutionOutcomeStatus(
  l: LeadLike,
  outcomeMap: Record<string, ExecutionOutcomeLike> | null | undefined,
): string | null {
  if (!outcomeMap) return null;
  const id = leadId(l);
  const keys = [
    id ? `lead-${id}-call` : null,
    id ? `lead-${id}-followup` : null,
    ...identityCandidates(l),
  ].filter((key): key is string => !!key);
  for (const key of Array.from(new Set(keys))) {
    const status = outcomeMap[key]?.status;
    if (typeof status === "string" && status !== "Not Contacted") {
      return OUTCOME_TO_PIPELINE_STATUS[status] ?? normalizePipelineStatus(status);
    }
  }
  return null;
}

function isCallNow(l: LeadLike): boolean {
  return !!(
    l.forceAction ||
    l.bucket === "CALL NOW" ||
    l.opportunity_label === "CALL NOW" ||
    l.recommendedAction === "CALL NOW"
  );
}

function isToday(l: LeadLike): boolean {
  return !!(
    l.bucket === "TODAY" ||
    l.opportunity_label === "TODAY" ||
    l.recommendedAction === "TODAY"
  );
}

function hasContact(l: LeadLike): boolean {
  const c = l.contacts ?? {};
  return !!(getCanonicalPhone(l) || c.primaryEmail);
}

function hasWebsiteScan(l: LeadLike): boolean {
  return !!(l.websiteProof && l.websiteProof.homepage_fetch_ok);
}

function hasOpportunitySignal(l: LeadLike): boolean {
  const est = l.opportunityEstimate ?? null;
  if (!est) return false;
  return !!(est.opportunityEstimateBand || (est.revenueImpactSummary && est.revenueImpactSummary.length > 0));
}

// Parse the engine's band string ("$30K–$80K", "$30K-$80K/mo", "$2.5M")
// into a numeric magnitude. Returns the midpoint when a range is found,
// the single value otherwise. Undefined on no parseable number — never
// invents a value.
function parseDollarBand(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const re = /\$?\s*([\d.,]+)\s*([KkMm])?/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const raw = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const suffix = m[2]?.toUpperCase();
    const mult = suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
    nums.push(raw * mult);
    if (nums.length >= 2) break;
  }
  if (nums.length === 0) return undefined;
  if (nums.length >= 2) return Math.round((nums[0] + nums[1]) / 2);
  return Math.round(nums[0]);
}

function deriveRevenueImpact(l: LeadLike): number | undefined {
  const est = l.opportunityEstimate ?? null;
  const direct = parseDollarBand(est?.opportunityEstimateBand);
  if (direct) return direct;
  const summaryLine = est?.revenueImpactSummary?.find((s) => /\$/.test(s ?? ""));
  const fromSummary = parseDollarBand(summaryLine);
  if (fromSummary) return fromSummary;
  const legacy = parseDollarBand(l.estimated_lost_leads);
  return legacy;
}

// Push a Date forward to the next Mon–Fri. No-op on weekdays. Used
// by every function in this file that emits a calendar dueDate so a
// naive day offset (or a stale weekend value persisted from before
// the weekend-skip rule shipped) never lands on Sat/Sun. Mirrors the
// rule enforced by lib/scheduling/leadSchedule.ts and the override
// API's validateWeekdayIso — single source of weekend semantics
// across the whole platform.
function coerceWeekday(d: Date): Date {
  const out = new Date(d);
  while (true) {
    const dow = out.getDay();
    if (dow !== 0 && dow !== 6) break;
    out.setDate(out.getDate() + 1);
  }
  return out;
}

function isoOffsetDays(now: Date, days: number, hour = 17, minute = 0): string {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return coerceWeekday(d).toISOString();
}

function callDueIso(l: LeadLike, now: Date): string {
  // Respect a server-attached schedule (lib/scheduling/leadSchedule.ts).
  // Falls back to the legacy "EOD today / tomorrow" rule when absent.
  // In both paths the result passes through coerceWeekday so a stale
  // weekend `scheduledFor` from an older snapshot is corrected on the fly.
  const explicit = (l as { scheduledFor?: string }).scheduledFor;
  if (typeof explicit === "string" && explicit.length > 0) {
    const ms = new Date(explicit).getTime();
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      d.setHours(17, 0, 0, 0);
      return coerceWeekday(d).toISOString();
    }
  }
  // CALL NOW or forceAction → end of today. Otherwise tomorrow EOD.
  if (l.forceAction || isCallNow(l)) return isoOffsetDays(now, 0, 17);
  if (isToday(l) || (l.score ?? 0) >= 70) return isoOffsetDays(now, 0, 18);
  return isoOffsetDays(now, 1, 17);
}

function followupDueIso(
  l: LeadLike, pipe: PipelineEntryLike | undefined, now: Date,
): string {
  const explicit = pipe?.nextActionDate;
  if (explicit) {
    const ms = new Date(explicit).getTime();
    if (Number.isFinite(ms)) return coerceWeekday(new Date(ms)).toISOString();
  }
  if (l.forceAction) return isoOffsetDays(now, 0, 17);
  if (isCallNow(l) || (l.score ?? 0) >= 75) return isoOffsetDays(now, 1, 17);
  return isoOffsetDays(now, 2, 17);
}

function strategicFromScore(score: number | null | undefined): TaskSeverity {
  const s = score ?? 0;
  if (s >= 70) return "high";
  if (s >= 45) return "medium";
  return "low";
}

function riskFromLead(l: LeadLike): TaskSeverity {
  if (l.forceAction || isCallNow(l)) return "high";
  if (isToday(l)) return "medium";
  return "low";
}

function callPriority(l: LeadLike): TaskPriority {
  const rev = deriveRevenueImpact(l) ?? 0;
  if (l.forceAction || isCallNow(l) || rev >= 50_000) return "critical";
  if (isToday(l) || (l.score ?? 0) >= 70) return "high";
  if ((l.score ?? 0) >= 50) return "medium";
  return "low";
}

function revenuePriority(rev: number, l: LeadLike): TaskPriority {
  if (rev >= 100_000 || l.forceAction) return "critical";
  if (rev >= 25_000 || isCallNow(l)) return "high";
  return "medium";
}

function topIssue(l: LeadLike): string | null {
  const issues = l.websiteProof?.issues ?? [];
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0];
    return typeof first === "string" ? first : null;
  }
  return null;
}

// Defensive string coercion — engine output can occasionally surface
// `nextAction` / `nextAction.label` as objects from older snapshot
// shapes. We never want a non-string slipping into TaskItem.nextAction.
function safeStr(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 ? s : undefined;
  }
  if (v && typeof v === "object") {
    const obj = v as { label?: unknown; text?: unknown; type?: unknown };
    if (typeof obj.label === "string" && obj.label.trim()) return obj.label.trim();
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim();
    if (typeof obj.type === "string" && obj.type.trim()) return obj.type.trim();
  }
  return undefined;
}

function leadDisplayName(l: LeadLike): string {
  return (l.name && l.name.trim()) || (l.companyName && l.companyName.trim()) || l.domain || "Unnamed lead";
}

// ── Close probability + deal confidence ────────────────────────────────
// Conservative, evidence-only. Starts low and adds points only when a real
// signal is present on the lead/pipeline. Clamped to [0.05, 0.90] so we
// never claim certainty in either direction.

const CLOSE_PROB_MIN = 0.05;
const CLOSE_PROB_MAX = 0.90;

function clampProb(n: number): number {
  if (!Number.isFinite(n)) return CLOSE_PROB_MIN;
  return Math.max(CLOSE_PROB_MIN, Math.min(CLOSE_PROB_MAX, n));
}

export function deriveCloseProbability(
  l: LeadLike,
  pipe?: PipelineEntryLike,
): number {
  let p = 0.20; // conservative baseline

  if (l.forceAction || isCallNow(l)) p += 0.20;
  if (isToday(l) || (l.score ?? 0) >= 70) p += 0.10;

  const score = l.score ?? 0;
  if (score >= 75) p += 0.15;
  else if (score >= 60) p += 0.08;

  if (hasContact(l)) p += 0.08;
  else p -= 0.12;

  if (hasWebsiteScan(l)) p += 0.05;
  else p -= 0.08;

  if (hasOpportunitySignal(l)) p += 0.05;

  const oc = (l.opportunityEstimate?.opportunityEstimateConfidence ?? "").toUpperCase();
  if (oc === "HIGH") p += 0.08;
  else if (oc === "MEDIUM") p += 0.04;

  const risk = (l.opportunityEstimate?.opportunityRiskLevel ?? "").toUpperCase();
  if (risk === "HIGH") p -= 0.08;

  const noAns = pipe?.consecutiveNoAnswers ?? 0;
  if (noAns > 0) p -= Math.min(0.12, noAns * 0.04);

  return clampProb(p);
}

export function deriveDealConfidence(
  l: LeadLike,
): DealConfidence {
  const signals = [
    hasContact(l),
    hasWebsiteScan(l),
    hasOpportunitySignal(l),
    (l.score ?? 0) >= 65,
  ].filter(Boolean).length;
  if (signals === 4) return "high";
  if (signals >= 2) return "medium";
  return "low";
}

export function deriveExpectedValue(
  revenueImpact: number | undefined,
  closeProbability: number | undefined,
): number | undefined {
  if (!revenueImpact || revenueImpact <= 0) return undefined;
  if (!Number.isFinite(closeProbability ?? NaN)) return undefined;
  return Math.round(revenueImpact * (closeProbability as number));
}

// ── Internal: apply learning adjustment to base prob/conf ──────────────
// These mirror the public helpers in outcomeLearning.ts but are duplicated
// here as small private helpers to keep tasks.ts free of an upward import
// (outcomeLearning.ts imports from tasks.ts). They use the same clamps.

function applyProbAdjustment(
  base: number,
  adj: LearningAdjustmentLike | undefined | null,
): number {
  const b = Number.isFinite(base) ? base : CLOSE_PROB_MIN;
  if (!adj) return Math.max(CLOSE_PROB_MIN, Math.min(CLOSE_PROB_MAX, b));
  const out = b + adj.probabilityDelta;
  return Math.max(CLOSE_PROB_MIN, Math.min(CLOSE_PROB_MAX, out));
}

function applyConfAdjustment(
  base: DealConfidence,
  adj: LearningAdjustmentLike | undefined | null,
): DealConfidence {
  if (!adj || adj.confidenceDelta === 0) return base;
  return stepConf(base, adj.confidenceDelta);
}

function stepConf(base: DealConfidence, delta: -1 | 0 | 1): DealConfidence {
  if (delta === 0) return base;
  const order: DealConfidence[] = ["low", "medium", "high"];
  const idx = order.indexOf(base);
  if (idx < 0) return base;
  if (delta > 0 && idx < order.length - 1) return order[idx + 1];
  if (delta < 0 && idx > 0) return order[idx - 1];
  return base;
}

// ── Pattern adjustment (inlined to avoid circular import) ──────────────
// patternLearning.ts imports LeadLike/PipelineEntryLike *from this file*,
// so we cannot import it back. The shape of patternAdjustments is the
// public contract — we only need to know which patterns the lead carries
// and which adjustments apply. Pattern derivation logic is duplicated as
// a tiny private helper here. Kept intentionally minimal.

const PATTERN_DELTA_CAP_LOCAL = 0.10;
const FOLLOWUP_STYLE_STATUSES_LOCAL = new Set([
  "CONTACTED", "CALLED", "VOICEMAIL", "EMAILED",
  "FOLLOW_UP", "INTERESTED", "QUALIFIED", "PITCHED",
]);

function leadPatternKeys(l: LeadLike, pipe?: PipelineEntryLike): string[] {
  const keys: string[] = [];
  const c = l.contacts ?? {};
  keys.push(c.primaryPhone || c.primaryEmail ? "has_contact" : "missing_contact");
  keys.push(l.websiteProof?.homepage_fetch_ok ? "has_website_scan" : "missing_website_scan");
  const score = l.score ?? 0;
  if (score >= 75) keys.push("high_score");
  else if (score >= 60) keys.push("medium_score");
  else keys.push("low_score");
  const isCallNow =
    !!l.forceAction ||
    l.bucket === "CALL NOW" ||
    l.opportunity_label === "CALL NOW" ||
    l.recommendedAction === "CALL NOW";
  if (isCallNow) keys.push("call_now");
  const isToday =
    l.bucket === "TODAY" ||
    l.opportunity_label === "TODAY" ||
    l.recommendedAction === "TODAY";
  if (isToday) keys.push("today_priority");
  const est = l.opportunityEstimate ?? null;
  const hasRevenue = !!(est && (est.opportunityEstimateBand ||
    (est.revenueImpactSummary && est.revenueImpactSummary.length > 0)));
  keys.push(hasRevenue ? "has_revenue_estimate" : "missing_revenue_estimate");
  if ((est?.opportunityEstimateConfidence ?? "").toUpperCase() === "HIGH") keys.push("high_confidence_estimate");
  if ((est?.opportunityRiskLevel ?? "").toUpperCase() === "HIGH") keys.push("high_risk_estimate");
  if (pipe) {
    if ((pipe.consecutiveNoAnswers ?? 0) >= 2) keys.push("repeated_no_answer");
    if (FOLLOWUP_STYLE_STATUSES_LOCAL.has((pipe.status ?? "").toUpperCase())) {
      keys.push("contacted_progress");
    }
  }
  return keys;
}

function applyPatternAdjustment(
  l: LeadLike,
  patternAdjustments: Record<string, PatternAdjustmentLike> | null | undefined,
  pipe: PipelineEntryLike | undefined,
): { probabilityDelta: number; confidenceDelta: -1 | 0 | 1; reason: string } | null {
  if (!patternAdjustments) return null;
  const keys = leadPatternKeys(l, pipe);
  let probSum = 0;
  let confSum = 0;
  const matched: PatternAdjustmentLike[] = [];
  for (const k of keys) {
    const adj = patternAdjustments[k];
    if (!adj) continue;
    matched.push(adj);
    probSum += adj.probabilityDelta;
    confSum += adj.confidenceDelta;
  }
  if (matched.length === 0) return null;
  let probabilityDelta = probSum;
  if (probabilityDelta > PATTERN_DELTA_CAP_LOCAL) probabilityDelta = PATTERN_DELTA_CAP_LOCAL;
  else if (probabilityDelta < -PATTERN_DELTA_CAP_LOCAL) probabilityDelta = -PATTERN_DELTA_CAP_LOCAL;
  const confidenceDelta: -1 | 0 | 1 = confSum > 0 ? 1 : confSum < 0 ? -1 : 0;
  matched.sort((a, b) => Math.abs(b.probabilityDelta) - Math.abs(a.probabilityDelta));
  const headline = matched[0];
  const reason = matched.length === 1
    ? headline.reason
    : `${headline.reason} (+ ${matched.length - 1} more pattern${matched.length - 1 === 1 ? "" : "s"}).`;
  return { probabilityDelta, confidenceDelta, reason };
}

export function buildTasksFromLeads(
  leads: LeadLike[] | null | undefined,
  options: BuildTasksOptions = {},
): TaskItem[] {
  // eslint-disable-next-line no-console
  console.log(
    `[debug-tasks] buildTasksFromLeads input=${Array.isArray(leads) ? leads.length : 0} ` +
    `tradeId="${options.tradeId ?? ""}" maxLeads=${options.maxLeads ?? "default"}`,
  );
  if (!Array.isArray(leads) || leads.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[debug-tasks] tasksCreated=0 reason="empty_leads_input"`);
    return [];
  }

  const now = options.now ?? new Date();
  const pipelineMap = options.pipelineMap ?? {};
  const cap = typeof options.maxLeads === "number" ? options.maxLeads : 60;
  const subset = leads.slice(0, cap);

  const out: TaskItem[] = [];
  const seen = new Set<string>();
  const seenCompanyKeys = new Set<string>();
  const push = (t: TaskItem) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    out.push(t);
  };

  for (const l of subset) {
    const id = leadId(l);
    if (!id) continue;

    const { key: operationalCompanyKey, pipe } = resolvePipelineEntry(l, pipelineMap);
    const crmStatus = normalizePipelineStatus(
      pipe?.status ?? l.accountSnapshot?.status ?? l.crm?.status,
    );
    const outcomeStatus = resolveExecutionOutcomeStatus(l, options.executionOutcomeMap);
    const status = outcomeStatus ?? crmStatus;
    if (TERMINAL_STATUSES.has(status) || isTerminalStatusValue(status)) continue;
    if (operationalCompanyKey && seenCompanyKeys.has(operationalCompanyKey)) continue;
    if (operationalCompanyKey) seenCompanyKeys.add(operationalCompanyKey);

    const company = leadDisplayName(l);
    const person = l.contacts?.contactName ?? pipe?.contactName ?? undefined;
    const pipeEntry = pipe ?? undefined;
    const rev = deriveRevenueImpact(l);
    const issue = topIssue(l);
    const strategic = strategicFromScore(l.score);
    const risk = riskFromLead(l);
    const baseProb = deriveCloseProbability(l, pipeEntry);
    const baseConf = deriveDealConfidence(l);

    // Outcome-learning adjustment, if any, is applied as a clamped nudge
    // on top of the heuristic baseline. Heuristic remains source of truth.
    const adj =
      options.learningAdjustments?.[id]
      ?? (operationalCompanyKey ? options.learningAdjustments?.[operationalCompanyKey] : undefined);
    const directProb = applyProbAdjustment(baseProb, adj);
    const directConf = applyConfAdjustment(baseConf, adj);
    const learningApplied =
      !!adj && (adj.probabilityDelta !== 0 || adj.confidenceDelta !== 0);
    const learningReason = learningApplied ? adj!.reason : undefined;

    // Pattern-learning nudge — capped at ±0.10. Always applied after
    // direct learning so per-lead outcomes dominate pattern inference.
    const patternResult = applyPatternAdjustment(l, options.patternAdjustments, pipeEntry);
    const closeProbability = patternResult
      ? Math.max(CLOSE_PROB_MIN, Math.min(CLOSE_PROB_MAX, directProb + patternResult.probabilityDelta))
      : directProb;
    const dealConfidence = patternResult
      ? stepConf(directConf, patternResult.confidenceDelta)
      : directConf;
    const patternLearningApplied =
      !!patternResult && (patternResult.probabilityDelta !== 0 || patternResult.confidenceDelta !== 0);
    const patternLearningReason = patternLearningApplied ? patternResult!.reason : undefined;

    const expectedValue = deriveExpectedValue(rev, closeProbability);
    const dialablePhone = getDialablePhoneDetails(l);
    // Plain email — falls back to the top-level `lead.email` so leads
    // imported without a contacts overlay still surface their email
    // on every task. Verified-email enrichment fields are spread in
    // baseLink alongside, so the same email-data shape reaches every
    // task category (call / followup / contact / revenue / admin).
    const email = l.contacts?.primaryEmail || l.email || null;
    const baseLink = {
      linkedLeadId: id,
      linkedCompany: company,
      ...(operationalCompanyKey ? { companyKey: operationalCompanyKey, crmKey: operationalCompanyKey } : {}),
      ...(person ? { linkedPerson: person } : {}),
      ...(typeof l.location === "string" && l.location ? { linkedLocation: l.location } : {}),
      ...(dialablePhone ? { phone: dialablePhone.phone, phoneAuthority: "dialable" as const } : {}),
      ...(email ? { email } : {}),
      // Verified-email enrichment metadata — propagated to EVERY task
      // via baseLink so LeadEmailAction renders consistently across
      // Today / All Leads / History regardless of task category.
      ...(typeof l.verifiedEmail === "string" && l.verifiedEmail.length > 0 ? { verifiedEmail: l.verifiedEmail } : {}),
      ...(typeof l.emailSource === "string" && l.emailSource.length > 0 ? { emailSource: l.emailSource } : {}),
      ...(typeof l.emailConfidence === "string" && l.emailConfidence.length > 0 ? { emailConfidence: l.emailConfidence } : {}),
      ...(typeof l.emailStatus === "string" && l.emailStatus.length > 0 ? { emailStatus: l.emailStatus } : {}),
      ...(typeof l.emailVerifiedAt === "string" && l.emailVerifiedAt.length > 0 ? { emailVerifiedAt: l.emailVerifiedAt } : {}),
      ...((l as unknown as { assignedRepId?: string }).assignedRepId
        ? { assignedRepId: (l as unknown as { assignedRepId: string }).assignedRepId }
        : {}),
      ...((l as unknown as { slotLocked?: boolean }).slotLocked === true ? { slotLocked: true } : {}),
    };
    // Trade module + service bucket enrichment. One core engine — trade
    // is config. Resolution order: options.tradeId (when not "all") →
    // lead.tradeId / lead.trade / lead.category → "roofing".
    // The synthetic "all" selection must never be stamped as a real
    // task tradeId — that would erase each lead's actual trade.
    const optionTradeId = options.tradeId === "all" ? undefined : options.tradeId;
    const leadTradeRaw =
      optionTradeId ??
      (l as unknown as { tradeId?: string; trade?: string; category?: string }).tradeId ??
      (l as unknown as { tradeId?: string; trade?: string; category?: string }).trade ??
      (l as unknown as { tradeId?: string; trade?: string; category?: string }).category ??
      "roofing";
    const tradeModule = getTradeModule(leadTradeRaw);
    let bucketFields: {
      tradeId: string;
      tradeLabel: string;
      serviceBucketId?: string;
      serviceBucketLabel?: string;
      serviceBucketReason?: string;
      johnServiceAngle?: string;
      suggestedOpeningLine?: string;
    } = {
      tradeId: tradeModule.id,
      tradeLabel: tradeModule.label,
    };
    try {
      const primary = primaryBucketForLead(
        l as unknown as Parameters<typeof primaryBucketForLead>[0],
        tradeModule.id,
      );
      if (primary) {
        const bucketCfg = tradeModule.serviceBuckets.find((b) => b.id === primary.bucketId);
        if (bucketCfg) {
          bucketFields = {
            tradeId: tradeModule.id,
            tradeLabel: tradeModule.label,
            serviceBucketId: bucketCfg.id,
            serviceBucketLabel: bucketCfg.label,
            serviceBucketReason: primary.reasons[0] ?? bucketCfg.description,
            johnServiceAngle: bucketCfg.johnServiceAngle,
            suggestedOpeningLine: bucketCfg.suggestedOpeningLine,
          };
        }
      }
    } catch {
      // Classifier is best-effort. Failure must not break task generation.
    }

    // Probability/confidence ride on every generated task. expectedValue is
    // only set when a revenueImpact is actually present.
    const probFields = {
      closeProbability,
      dealConfidence,
      ...(expectedValue != null ? { expectedValue } : {}),
      ...(learningApplied ? { learningApplied: true } : {}),
      ...(learningReason ? { learningReason } : {}),
      ...(patternLearningApplied ? { patternLearningApplied: true } : {}),
      ...(patternLearningReason ? { patternLearningReason } : {}),
      ...bucketFields,
    };
    // Display-only intelligence payload. Keep it on non-call tasks too
    // so the UI does not fall back to ambiguous probability labels or
    // hide Assist Mode just because the selected task is contact/revenue.
    const displayInsightFields = {
      ...(l.laborTechScan ? { laborTechScan: l.laborTechScan } : {}),
      ...(l.salesStrategy ? { salesStrategy: l.salesStrategy } : {}),
      ...(l.serviceNeed ? { serviceNeed: l.serviceNeed } : {}),
      ...(typeof l.salesStrategy?.closeProbability === "number"
        ? { closeProbability100: l.salesStrategy.closeProbability }
        : {}),
    };

    const isContacted = FOLLOWUP_STATUSES.has(status);

    // TEMP: force at least one call task per non-contacted lead
    // while the pipeline is being verified end-to-end. The original
    // gate (isCallNow / isToday / score >= 70 / rev >= 25k) stays
    // alongside it but the OR keeps every admitted lead visible.
    if (!isContacted) {
      // Sales-strategy-aware action text. Prefer the rank-1 angle so
      // every card opens with a closer-grade lead-with line. Falls
      // back to the diagnostic top finding, then to engine-flagged
      // issue, then to a generic validation step.
      const strategy = l.salesStrategy ?? null;
      const primary = strategy?.primaryAngle ?? null;
      const topFinding = l.diagnostics?.topFinding ?? null;
      const strategyAction = primary && primary.label && primary.evidence
        ? `Lead with: ${primary.label} — ${primary.evidence}`
        : null;
      const findingAction = topFinding && topFinding.issue && topFinding.evidence
        ? `Lead with: ${topFinding.issue} — ${topFinding.evidence}`
        : null;
      const fallbackAction = issue
        ? `Lead with: ${issue}.`
        : "Open the lead card; the angle and evidence live there.";
      // Premium scan copy takes precedence — it's the proof-bar artifact
      // and contains the rep-ready opener + recommended action.
      const scan = l.laborTechScan ?? null;
      const scanAction =
        scan?.recommendedAction
          ? scan.recommendedAction
          : scan?.primaryPain
            ? `Lead with: ${scan.primaryPain}.`
            : null;
      const actionText =
        scanAction
        || strategyAction
        || safeStr(l.nextAction)
        || findingAction
        || fallbackAction;
      const callScript =
        scan?.salesAngle?.opener
        || primary?.pitch
        || (l.serviceNeed?.suggestedPitch ?? "")
        || undefined;
      // Per-task diagnostic log (one line per call task created).
      // eslint-disable-next-line no-console
      console.log(
        `[calendar-diagnostics] lead=${company} action="${actionText}"`,
      );
      push({
        id: `lead-${id}-call`,
        title: `Call ${company}`,
        category: "priority",
        priority: callPriority(l),
        status: "todo",
        dueDate: callDueIso(l, now),
        ...(rev ? { revenueImpact: rev } : {}),
        riskIfMissed: risk,
        strategicImportance: strategic,
        ...baseLink,
        notes: topFinding && topFinding.issue && topFinding.impact
          ? `${topFinding.issue}: ${topFinding.impact}`
          : issue
            ? `Engine flagged: ${issue}.`
            : `Score ${l.score ?? "?"} · bucket ${l.bucket ?? l.opportunity_label ?? "n/a"}.`,
        nextAction: actionText,
        ...(callScript ? { callScript } : {}),
        ...(strategy ? { salesStrategy: strategy } : {}),
        ...(scan ? { laborTechScan: scan } : {}),
        ...(l.serviceNeed ? { serviceNeed: l.serviceNeed } : {}),
        ...(typeof l.leadTier === "string" ? { leadTier: l.leadTier } : {}),
        // Email-enrichment fields (verifiedEmail / emailSource /
        // emailConfidence / emailStatus / emailVerifiedAt) now flow
        // through baseLink so they reach every task category, not
        // just the call task.
        ...(typeof strategy?.closeProbability === "number" ? { closeProbability100: strategy.closeProbability } : {}),
        ...probFields,
      });
    }

    // B. Follow-up task — when the lead is already in a contacted-style status.
    if (isContacted) {
      const noAnswers = pipe?.consecutiveNoAnswers ?? 0;
      const followPriority: TaskPriority =
        l.forceAction || noAnswers >= 3 ? "critical"
        : noAnswers >= 1 || isCallNow(l) ? "high"
        : "medium";
      push({
        id: `lead-${id}-followup`,
        title: `Follow up with ${company}`,
        category: "followup",
        priority: followPriority,
        status: "todo",
        dueDate: followupDueIso(l, pipeEntry, now),
        ...(rev ? { revenueImpact: rev } : {}),
        riskIfMissed: risk,
        strategicImportance: strategic,
        ...baseLink,
        notes: pipe?.nextAction
          ? `Pipeline status: ${status}. Next action on file: ${pipe.nextAction}.`
          : `Pipeline status: ${status}.`,
        nextAction: safeStr(pipe?.nextAction)
          || safeStr(l.nextAction)
          || (l.laborTechScan?.recommendedAction
            ? l.laborTechScan.recommendedAction
            : issue
              ? `Reference ${issue} and confirm next step.`
              : "Confirm interest and lock the next concrete commitment."),
        ...(l.laborTechScan ? { laborTechScan: l.laborTechScan } : {}),
        ...(l.serviceNeed ? { serviceNeed: l.serviceNeed } : {}),
        ...(typeof l.leadTier === "string" ? { leadTier: l.leadTier } : {}),
        ...probFields,
      });
    }

    // C. Revenue task — when there is a parseable dollar magnitude on file.
    if (rev && rev > 0 && hasOpportunitySignal(l)) {
      push({
        id: `lead-${id}-revenue`,
        title: `Advance revenue opportunity: ${company}`,
        category: "revenue",
        priority: revenuePriority(rev, l),
        status: "todo",
        dueDate: isoOffsetDays(now, isCallNow(l) ? 1 : 3, 17),
        revenueImpact: rev,
        riskIfMissed: risk,
        strategicImportance: "high",
        ...baseLink,
        notes: `Estimated value: ~$${Math.round(rev).toLocaleString()}.`,
        nextAction: "Move this lead toward proposal, paid setup, or booked call.",
        ...displayInsightFields,
        ...probFields,
      });
    }

    // D. Diagnostic / scan task — only when the scan model says one
    // is required AND the lead is not already outreach-ready. Reads
    // the real scan status (lib/diagnostics/scanStatus.ts) so the
    // card title, notes, and next action describe the actual work.
    {
      const scan = computeScanStatus(l);
      // Always emit one diagnostic line per lead so the operator can
      // audit scan readiness in the dev log, even when the card itself
      // is suppressed.
      // eslint-disable-next-line no-console
      console.log(
        `[scan-status] lead="${company}" status=${scan.status} readiness=${scan.readiness} ` +
        `sources=${scan.scannedSources.join(",") || "none"}` +
        (scan.missingSources.length > 0 ? ` missing=${scan.missingSources.join(",")}` : ""),
      );
      // Skip the card entirely when the lead is fully outreach-ready —
      // a "Scan complete" card would just be noise on the calendar.
      const shouldEmit = scan.status !== "completed";
      if (shouldEmit) {
        const cardTitle = diagnosticTaskTitle(company, scan);
        const notesParts: string[] = [];
        if (scan.scannedSources.length > 0) notesParts.push(`Sources checked: ${scan.scannedSources.join(", ")}.`);
        if (scan.missingSources.length > 0) notesParts.push(`Missing: ${scan.missingSources.join(", ")}.`);
        if (scan.topIssues.length > 0) notesParts.push(`Top issue: ${scan.topIssues[0]}.`);
        const taskCategory: TaskCategory =
          scan.status === "blocked" ? "admin" : "product";
        push({
          id: `lead-${id}-diagnostic`,
          title: cardTitle,
          category: taskCategory,
          priority: ((l.score ?? 0) >= 60 || isCallNow(l)) ? "high" : "medium",
          status: "todo",
          dueDate: isoOffsetDays(now, 2, 17),
          riskIfMissed: "medium",
          strategicImportance: strategic,
          ...baseLink,
          notes: notesParts.length > 0 ? notesParts.join(" ") : `Scan status: ${scan.status}.`,
          nextAction: scan.nextAction,
          ...displayInsightFields,
          closeProbability,
          dealConfidence,
          ...bucketFields,
        });
      }
    }

    // E. Contact-info task — no phone and no email.
    if (!hasContact(l)) {
      push({
        id: `lead-${id}-contact`,
        title: `Find missing contact info: ${company}`,
        category: "admin",
        priority: ((l.score ?? 0) >= 65 || isCallNow(l)) ? "high" : "medium",
        status: "todo",
        dueDate: isoOffsetDays(now, 1, 17),
        riskIfMissed: "medium",
        strategicImportance: strategic,
        ...baseLink,
        notes: "Lead has no primary phone or email on file.",
        nextAction: "Find verified phone, email, owner, and website before outreach.",
        ...displayInsightFields,
        closeProbability,
        dealConfidence,
        ...bucketFields,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[debug-tasks] tasksCreated=${out.length} fromLeads=${subset.length} ` +
    `tradeId="${options.tradeId ?? ""}"`,
  );
  // ── LABORTECH DEMO ROLLOUT ──
  // Applies a deterministic Day-1 → Day-N reschedule of call tasks,
  // anchored to Thursday May 7. Pure / reversible: gated on
  // LABORTECH_DEMO_ROLLOUT_ENABLED inside the helper. To remove,
  // delete this import + call (or flip the flag in the helper file).
  return applyLaborTechDemoSchedule(out);
}

// ── Mock seed ──────────────────────────────────────────────────────────
// Builds a week of tasks anchored to "now". Replace with a real fetcher
// (Google Calendar / Gmail / Airtable / CRM) when integrations land.

export function getMockTasks(): TaskItem[] {
  const at = (offset: number, h = 9, m = 0): string => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return coerceWeekday(d).toISOString();
  };

  return [
    {
      id: "t-001",
      title: "Call Margaret Chen — adjuster meeting Thursday",
      category: "priority",
      priority: "critical",
      status: "todo",
      dueDate: at(-1, 17),
      revenueImpact: 18500,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedPerson: "Margaret Chen",
      linkedCompany: "Chen Residence — 4218 Walnut St",
      nextAction: "Call before adjuster arrives Thursday AM",
    },
    {
      id: "t-002",
      title: "Send capability deck to Pinnacle Office Park",
      category: "revenue",
      priority: "high",
      status: "todo",
      dueDate: at(0, 14),
      revenueImpact: 67000,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedCompany: "Pinnacle Office Park",
      nextAction: "Email PM with deck + site walk request",
    },
    {
      id: "t-003",
      title: "Sales standup",
      category: "meeting",
      priority: "medium",
      status: "todo",
      startTime: at(0, 9, 0),
      endTime:   at(0, 9, 30),
      riskIfMissed: "low",
      strategicImportance: "medium",
    },
    {
      id: "t-004",
      title: "Inspection — Thompson residence",
      category: "meeting",
      priority: "high",
      status: "todo",
      startTime: at(0, 11, 0),
      endTime:   at(0, 12, 30),
      revenueImpact: 24200,
      strategicImportance: "high",
      riskIfMissed: "high",
      linkedPerson: "David Thompson",
      linkedCompany: "Thompson Residence",
      nextAction: "Bring measuring kit + sample swatches",
    },
    {
      id: "t-005",
      title: "Follow up: Robert Martinez (active leak)",
      category: "followup",
      priority: "high",
      status: "todo",
      dueDate: at(0, 16),
      revenueImpact: 4800,
      riskIfMissed: "medium",
      strategicImportance: "medium",
      linkedPerson: "Robert Martinez",
      nextAction: "Confirm Tuesday 8am repair window",
    },
    {
      id: "t-006",
      title: "Review LaborTech contract terms",
      category: "admin",
      priority: "medium",
      status: "todo",
      dueDate: at(0, 17),
      riskIfMissed: "medium",
      strategicImportance: "medium",
    },
    {
      id: "t-007",
      title: "School pickup — Sam",
      category: "personal",
      priority: "high",
      status: "todo",
      startTime: at(0, 15, 15),
      endTime:   at(0, 15, 45),
      riskIfMissed: "high",
      strategicImportance: "low",
    },
    {
      id: "t-008",
      title: "EBR with Meridian Health Systems",
      category: "meeting",
      priority: "high",
      status: "todo",
      startTime: at(1, 10, 0),
      endTime:   at(1, 11, 0),
      revenueImpact: 320000,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedCompany: "Meridian Health Systems",
      nextAction: "Confirm slides + pull latest usage chart",
    },
    {
      id: "t-009",
      title: "Pricing tier rev — internal review",
      category: "product",
      priority: "medium",
      status: "in_progress",
      dueDate: at(1, 17),
      riskIfMissed: "medium",
      strategicImportance: "high",
    },
    {
      id: "t-010",
      title: "Quote follow-up: Thompson",
      category: "followup",
      priority: "high",
      status: "todo",
      dueDate: at(1, 18),
      revenueImpact: 24200,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedCompany: "Thompson Residence",
    },
    {
      id: "t-011",
      title: "Renewal call: Thornfield Capital",
      category: "revenue",
      priority: "critical",
      status: "todo",
      startTime: at(2, 13, 0),
      endTime:   at(2, 13, 30),
      revenueImpact: 48000,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedCompany: "Thornfield Capital",
      nextAction: "Loop in Solutions before call",
    },
    {
      id: "t-012",
      title: "Submit Q2 expense report",
      category: "admin",
      priority: "low",
      status: "todo",
      dueDate: at(2, 17),
      riskIfMissed: "low",
      strategicImportance: "low",
    },
    {
      id: "t-013",
      title: "Site walk — Pinnacle Office Park",
      category: "meeting",
      priority: "high",
      status: "todo",
      startTime: at(3, 10, 0),
      endTime:   at(3, 11, 30),
      revenueImpact: 67000,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedCompany: "Pinnacle Office Park",
    },
    {
      id: "t-014",
      title: "Roadmap review with engineering",
      category: "product",
      priority: "medium",
      status: "todo",
      startTime: at(3, 14, 0),
      endTime:   at(3, 15, 0),
      riskIfMissed: "medium",
      strategicImportance: "high",
    },
    {
      id: "t-015",
      title: "Vertex Partners ROI model — VP review",
      category: "revenue",
      priority: "high",
      status: "in_progress",
      dueDate: at(4, 17),
      revenueImpact: 60000,
      riskIfMissed: "high",
      strategicImportance: "high",
      linkedCompany: "Vertex Partners",
    },
    {
      id: "t-016",
      title: "Family dinner",
      category: "personal",
      priority: "medium",
      status: "todo",
      startTime: at(4, 19, 0),
      endTime:   at(4, 21, 0),
      riskIfMissed: "medium",
      strategicImportance: "low",
    },
    {
      id: "t-017",
      title: "Weekly retro",
      category: "meeting",
      priority: "low",
      status: "todo",
      startTime: at(5, 16, 0),
      endTime:   at(5, 16, 45),
      riskIfMissed: "low",
      strategicImportance: "medium",
    },
    {
      id: "t-018",
      title: "Plan next week's call sweep",
      category: "priority",
      priority: "medium",
      status: "todo",
      dueDate: at(6, 17),
      riskIfMissed: "medium",
      strategicImportance: "medium",
    },
  ];
}
