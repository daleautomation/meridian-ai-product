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

/** Dylan's active pipeline — used when no persisted store exists. */
export function seedOpportunities(): JobOpportunity[] {
  return [
    {
      id: "opp-clipboard-ae",
      company: "Clipboard",
      roleTitle: "Territory Account Executive",
      roleCategory: "account_executive",
      stage: "case_study",
      lastTouchpoint: daysAgo(2),
      nextAction: "Record and submit Loom case study for territory AE loop",
      followUpDate: daysFromNow(0),
      priority: "high",
      notes: "Case study / Loom stage. Territory AE focus — finish draft then record Loom.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
        applied: true,
        recruiter_contacted: true,
        interview_scheduled: true,
        case_study_required: true,
        case_study_drafted: true,
        loom_recorded: false,
      },
      updatedAt: now,
      source: "manual",
      sourceEmailSubject: null,
      sourceSender: null,
      confidence: null,
      prepRequired: true,
    },
    {
      id: "opp-safetyculture-pam",
      company: "SafetyCulture",
      roleTitle: "Partner Account Manager",
      roleCategory: "partner_account_manager",
      stage: "prospecting",
      lastTouchpoint: daysAgo(3),
      nextAction: "Send PAM outreach — evaluating fit and partner motion",
      followUpDate: daysFromNow(0),
      priority: "high",
      notes: "Evaluating / outreach stage. Research partner ecosystem before first touch.",
      checklist: {
        ...emptyChecklist(),
        resume_tailored: true,
      },
      updatedAt: now,
      source: "manual",
      sourceEmailSubject: null,
      sourceSender: null,
      confidence: null,
      prepRequired: true,
    },
    {
      id: "opp-ronco-pe",
      company: "Ronco",
      roleTitle: "Project Engineer",
      roleCategory: "other",
      stage: "on_hold",
      lastTouchpoint: daysAgo(5),
      nextAction: "Wait for Rachel / operations response on referral",
      followUpDate: daysFromNow(4),
      priority: "medium",
      notes: "Referred in — exploratory. Ball with Rachel / ops; follow up if no reply by end of week.",
      checklist: {
        ...emptyChecklist(),
        recruiter_contacted: true,
      },
      updatedAt: now,
      source: "manual",
      sourceEmailSubject: null,
      sourceSender: null,
      confidence: null,
      waitingOnReply: true,
    },
  ];
}
