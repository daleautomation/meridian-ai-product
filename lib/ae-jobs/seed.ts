import { emptyChecklist } from "./labels";
import type { JobOpportunity } from "./types";

const now = new Date().toISOString();

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Starter pipeline — replace via UI/API or future email ingestion. */
export function seedOpportunities(): JobOpportunity[] {
  return [
    {
      id: "opp-ramp-ae",
      company: "Ramp",
      roleTitle: "Account Executive — Mid-Market",
      roleCategory: "account_executive",
      stage: "interview",
      lastTouchpoint: daysAgo(2),
      nextAction: "Prep HM round: 3 discovery stories + Ramp wedge",
      followUpDate: daysFromNow(0),
      priority: "high",
      notes: "Recruiter: Maya. HM round Thu 2pm ET.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
        applied: true,
        recruiter_contacted: true,
        follow_up_sent: true,
        interview_scheduled: true,
      },
      updatedAt: now,
      source: "manual",
    },
    {
      id: "opp-notion-pam",
      company: "Notion",
      roleTitle: "Partner Account Manager",
      roleCategory: "partner_account_manager",
      stage: "case_study",
      lastTouchpoint: daysAgo(1),
      nextAction: "Finish partner GTM case study draft",
      followUpDate: daysFromNow(1),
      priority: "high",
      notes: "Case due EOD Wed. Template in Notion doc.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
        applied: true,
        recruiter_contacted: true,
        interview_scheduled: true,
        case_study_required: true,
        case_study_drafted: false,
      },
      updatedAt: now,
      source: "manual",
    },
    {
      id: "opp-datadog-se",
      company: "Datadog",
      roleTitle: "Sales Engineer — Commercial",
      roleCategory: "sales_engineer",
      stage: "recruiter_screen",
      lastTouchpoint: daysAgo(4),
      nextAction: "Send follow-up to recruiter after screen",
      followUpDate: daysFromNow(0),
      priority: "high",
      notes: "Recruiter screen Mon — waiting on HM scheduling.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
        applied: true,
        recruiter_contacted: true,
        interview_scheduled: false,
      },
      updatedAt: now,
      source: "manual",
    },
    {
      id: "opp-gong-ae",
      company: "Gong",
      roleTitle: "Account Executive — Enterprise",
      roleCategory: "account_executive",
      stage: "applied",
      lastTouchpoint: daysAgo(6),
      nextAction: "LinkedIn connect with hiring manager",
      followUpDate: daysFromNow(2),
      priority: "medium",
      notes: "Applied via Greenhouse. No recruiter reply yet.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
        applied: true,
      },
      updatedAt: now,
      source: "manual",
    },
    {
      id: "opp-rippling-cs",
      company: "Rippling",
      roleTitle: "Implementation Manager",
      roleCategory: "customer_success",
      stage: "prospecting",
      lastTouchpoint: daysAgo(10),
      nextAction: "Tailor resume for implementation narrative",
      followUpDate: daysFromNow(3),
      priority: "medium",
      notes: "Warm intro from former colleague — draft outreach.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: false,
      },
      updatedAt: now,
      source: "manual",
    },
    {
      id: "opp-figma-explore",
      company: "Figma",
      roleTitle: "GTM — exploratory",
      roleCategory: "other",
      stage: "on_hold",
      lastTouchpoint: daysAgo(14),
      nextAction: "Revisit after Ramp/Notion loops close",
      followUpDate: null,
      priority: "low",
      notes: "Informal coffee chat — no active req.",
      checklist: {
        ...emptyChecklist(),
        recruiter_contacted: true,
      },
      updatedAt: now,
      source: "manual",
    },
    {
      id: "opp-hubspot-ae",
      company: "HubSpot",
      roleTitle: "Account Executive — SMB",
      roleCategory: "account_executive",
      stage: "closed_lost",
      lastTouchpoint: daysAgo(21),
      nextAction: "Archive — passed after final round",
      followUpDate: null,
      priority: "low",
      notes: "Feedback: wanted more SaaS AE tenure.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
        applied: true,
        recruiter_contacted: true,
        interview_scheduled: true,
        thank_you_sent: true,
      },
      updatedAt: now,
      source: "manual",
    },
  ];
}
