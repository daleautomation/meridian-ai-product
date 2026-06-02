// AE Job Operating System — domain types for Dylan's career pipeline.

export const ROLE_CATEGORIES = [
  "account_executive",
  "partner_account_manager",
  "sales_engineer",
  "customer_success",
  "other",
] as const;

export type RoleCategory = (typeof ROLE_CATEGORIES)[number];

export const PIPELINE_STAGES = [
  "prospecting",
  "applied",
  "recruiter_screen",
  "hiring_manager",
  "interview",
  "case_study",
  "offer",
  "on_hold",
  "closed_lost",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CHECKLIST_KEYS = [
  "resume_tailored",
  "applied",
  "recruiter_contacted",
  "follow_up_sent",
  "interview_scheduled",
  "case_study_required",
  "case_study_drafted",
  "loom_recorded",
  "thank_you_sent",
] as const;

export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export type OpportunityChecklist = Record<ChecklistKey, boolean>;

export type OpportunitySource = "manual" | "email_ingestion" | "json_import";

export const NEEDS_DYLAN_CATEGORIES = [
  "loom_due",
  "follow_up_overdue",
  "waiting_on_reply",
  "prep_required",
  "interview_reminder_48h",
  "interview_reminder_24h",
] as const;

export type NeedsDylanCategory = (typeof NEEDS_DYLAN_CATEGORIES)[number];

export interface JobOpportunity {
  id: string;
  company: string;
  roleTitle: string;
  roleCategory: RoleCategory;
  stage: PipelineStage;
  lastTouchpoint: string;
  nextAction: string;
  followUpDate: string | null;
  priority: Priority;
  notes: string;
  checklist: OpportunityChecklist;
  updatedAt: string;
  source?: OpportunitySource;
  /** Last known email subject when ingested from Gmail/Claude. */
  sourceEmailSubject?: string | null;
  /** Last known sender when ingested from Gmail/Claude. */
  sourceSender?: string | null;
  /** Parser confidence 0–1; null for manual entries. */
  confidence?: number | null;
  /** Explicit flag: ball is in someone else's court. */
  waitingOnReply?: boolean;
  /** Explicit flag: interview or case prep still needed. */
  prepRequired?: boolean;
}

export interface IngestionResultCounts {
  processed: number;
  skipped: number;
  updated: number;
  unmatched: number;
  errors: string[];
}

export interface AeJobsStoreFile {
  version: 1;
  ownerId: string;
  opportunities: JobOpportunity[];
  lastIngestedAt: string | null;
  /** Idempotency keys for ingested email events. */
  seenEventIds?: string[];
  /** Result counts from the most recent ingest batch. */
  lastIngestionResult?: IngestionResultCounts | null;
}

export type AeJobsViewId = "today" | "pipeline" | "by_role";

export interface NeedsDylanItem {
  opportunityId: string;
  company: string;
  roleTitle: string;
  category: NeedsDylanCategory;
  categoryLabel: string;
  nextAction: string;
  followUpDate: string | null;
  priority: Priority;
  roleCategory: RoleCategory;
}

export interface AeJobsWorkspaceModel {
  generatedAt: string;
  owner: { id: string; name: string };
  opportunities: JobOpportunity[];
  todayActions: TodayAction[];
  needsDylan: NeedsDylanItem[];
  summary: {
    total: number;
    byCategory: Record<RoleCategory, number>;
    highPriority: number;
    interviewsThisWeek: number;
  };
  roleLabels: Record<RoleCategory, string>;
  stageLabels: Record<PipelineStage, string>;
  checklistLabels: Record<ChecklistKey, string>;
  needsDylanLabels: Record<NeedsDylanCategory, string>;
  ingestion: {
    wired: boolean;
    contractVersion: string;
    lastIngestedAt: string | null;
    statusMessage: string;
  };
}

export interface TodayAction {
  opportunityId: string;
  company: string;
  roleTitle: string;
  nextAction: string;
  followUpDate: string | null;
  priority: Priority;
  roleCategory: RoleCategory;
}

export interface CareerHealthSummary {
  total: number;
  byCategory: Record<RoleCategory, number>;
  activeInterviews: number;
  caseStudiesInProgress: number;
  waitingOnReplyCount: number;
  followUpsDueCount: number;
}

export type WaitingOnReason =
  | "waiting_on_recruiter"
  | "waiting_on_hiring_manager"
  | "waiting_on_interview_scheduling"
  | "waiting_on_offer_decision"
  | "waiting_on_reply";

export interface WaitingOnItem {
  opportunityId: string;
  company: string;
  roleTitle: string;
  reason: WaitingOnReason;
  reasonLabel: string;
  lastTouchpoint: string;
  daysWaiting: number;
}

export type UpcomingItemKind =
  | "interview"
  | "follow_up"
  | "case_study_deadline"
  | "loom_deadline";

export interface UpcomingItem {
  date: string;
  company: string;
  roleTitle: string;
  actionRequired: string;
  kind: UpcomingItemKind;
  kindLabel: string;
  opportunityId: string;
}

export interface TopOpportunityItem {
  opportunityId: string;
  company: string;
  roleTitle: string;
  stage: PipelineStage;
  stageLabel: string;
  priority: Priority;
  recommendedNextAction: string;
  rank: number;
}

export interface SuggestedNextMove {
  headline: string;
  explanation: string;
  opportunityId: string | null;
}

export interface MorningBriefHero {
  todayLabel: string;
  todayIso: string;
  activeOpportunities: number;
  needsDylanCount: number;
  waitingOnCount: number;
  upcomingEventsCount: number;
}

export interface ExecuteNowItem {
  opportunityId: string;
  company: string;
  roleTitle: string;
  action: string;
  dueDate: string | null;
  priority: Priority;
  category: NeedsDylanCategory;
}

export interface QuickAction {
  id: string;
  label: string;
  href: string;
}

export interface CareerMomentum {
  applicationsInProgress: number;
  interviewsActive: number;
  followUpsDue: number;
  waitingOnResponse: number;
}

export interface CareerBriefIngestionMeta {
  wired: false;
  contractVersion: string;
  statusMessage: string;
  lastIngestedAt: string | null;
  lastResult: IngestionResultCounts | null;
}

export interface CareerBriefCalendarMeta {
  contractVersion: string;
  statusMessage: string;
  lastSyncedAt: string | null;
  eventsImported: number;
  upcomingInterviews: number;
}

export interface CareerBriefModel {
  generatedAt: string;
  owner: { id: string; name: string };
  morningBrief: MorningBriefHero;
  executeNow: ExecuteNowItem[];
  quickActions: QuickAction[];
  careerMomentum: CareerMomentum;
  health: CareerHealthSummary;
  needsDylanToday: NeedsDylanItem[];
  waitingOn: WaitingOnItem[];
  upcoming: UpcomingItem[];
  topOpportunities: TopOpportunityItem[];
  suggestedNextMove: SuggestedNextMove;
  roleLabels: Record<RoleCategory, string>;
  stageLabels: Record<PipelineStage, string>;
  ingestion: CareerBriefIngestionMeta;
  calendar: CareerBriefCalendarMeta;
}
