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
  source?: "manual" | "email_ingestion";
}

export interface AeJobsStoreFile {
  version: 1;
  ownerId: string;
  opportunities: JobOpportunity[];
  lastIngestedAt: string | null;
}

export type AeJobsViewId = "today" | "pipeline" | "by_role";

export interface AeJobsWorkspaceModel {
  generatedAt: string;
  owner: { id: string; name: string };
  opportunities: JobOpportunity[];
  todayActions: TodayAction[];
  summary: {
    total: number;
    byCategory: Record<RoleCategory, number>;
    highPriority: number;
    interviewsThisWeek: number;
  };
  roleLabels: Record<RoleCategory, string>;
  stageLabels: Record<PipelineStage, string>;
  checklistLabels: Record<ChecklistKey, string>;
  ingestion: {
    wired: boolean;
    contractVersion: string;
    lastIngestedAt: string | null;
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
