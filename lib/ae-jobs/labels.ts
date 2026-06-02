import type { ChecklistKey, PipelineStage, RoleCategory } from "./types";

export const ROLE_LABELS: Record<RoleCategory, string> = {
  account_executive: "Account Executive",
  partner_account_manager: "Partner Account Manager",
  sales_engineer: "Sales Engineer",
  customer_success: "Customer Success / Implementation",
  other: "Other / exploratory",
};

export const STAGE_LABELS: Record<PipelineStage, string> = {
  prospecting: "Prospecting",
  applied: "Applied",
  recruiter_screen: "Recruiter screen",
  hiring_manager: "Hiring manager",
  interview: "Interview",
  case_study: "Case study",
  offer: "Offer",
  on_hold: "On hold",
  closed_lost: "Closed / passed",
};

export const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
  resume_tailored: "Resume tailored",
  applied: "Applied",
  recruiter_contacted: "Recruiter contacted",
  follow_up_sent: "Follow-up sent",
  interview_scheduled: "Interview scheduled",
  case_study_required: "Case study required",
  case_study_drafted: "Case study drafted",
  loom_recorded: "Loom recorded",
  thank_you_sent: "Thank-you sent",
};

export const emptyChecklist = (): Record<ChecklistKey, boolean> => ({
  resume_tailored: false,
  applied: false,
  recruiter_contacted: false,
  follow_up_sent: false,
  interview_scheduled: false,
  case_study_required: false,
  case_study_drafted: false,
  loom_recorded: false,
  thank_you_sent: false,
});
