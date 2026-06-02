// AE Job OS — career calendar event contract (manual/demo sync; no Gmail).

import type { JobOpportunity } from "./types";

export const CALENDAR_CONTRACT_VERSION = "ae-job-calendar-v1";

export const CALENDAR_STATUS_MESSAGE =
  "Career calendar sync ready — manual/demo mode (no Google Calendar API yet)";

export const CAREER_EVENT_TYPES = [
  "recruiter_call",
  "interview",
  "panel_interview",
  "hiring_manager",
  "case_study_review",
  "offer_discussion",
] as const;

export type CareerEventType = (typeof CAREER_EVENT_TYPES)[number];

/** One job-related calendar event from iCal, manual import, or future API sync. */
export interface CareerCalendarEvent {
  contractVersion: typeof CALENDAR_CONTRACT_VERSION;
  /** Stable idempotency key (UID or provider event id). */
  eventId: string;
  company: string;
  role: string;
  eventType: CareerEventType;
  startDateTime: string;
  endDateTime: string;
  notes: string;
  matchedOpportunityId?: string;
}

export interface CalendarSyncBatch {
  events: CareerCalendarEvent[];
  syncedAt: string;
  source: "manual-import" | "ics-file" | "demo";
}

export interface CalendarSyncResult {
  imported: number;
  skipped: number;
  opportunitiesUpdated: number;
  errors: string[];
}

export const INTERVIEW_EVENT_TYPES = new Set<CareerEventType>([
  "interview",
  "panel_interview",
  "hiring_manager",
]);

export const CAREER_EVENT_TYPE_LABELS: Record<CareerEventType, string> = {
  recruiter_call: "Recruiter call",
  interview: "Interview",
  panel_interview: "Panel interview",
  hiring_manager: "Hiring manager",
  case_study_review: "Case study review",
  offer_discussion: "Offer discussion",
};

function normalizeCompany(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRole(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Match calendar event → pipeline opportunity (id → company+role → unique company). */
export function findMatchingOpportunityForCalendar(
  opportunities: JobOpportunity[],
  event: CareerCalendarEvent,
): JobOpportunity | null {
  const byId = new Map(opportunities.map((o) => [o.id, o]));

  if (event.matchedOpportunityId) {
    const explicit = byId.get(event.matchedOpportunityId);
    if (explicit) return explicit;
  }

  const companyNorm = normalizeCompany(event.company);
  if (!companyNorm) return null;

  const roleNorm = event.role ? normalizeRole(event.role) : null;
  const companyMatches = opportunities.filter(
    (o) => normalizeCompany(o.company) === companyNorm,
  );

  if (roleNorm) {
    const exactRole = companyMatches.find(
      (o) => normalizeRole(o.roleTitle) === roleNorm,
    );
    if (exactRole) return exactRole;
  }

  if (companyMatches.length === 1) {
    return companyMatches[0];
  }

  return null;
}

function hoursFromNow(baseIso: string, hours: number): string {
  return new Date(new Date(baseIso).getTime() + hours * 3_600_000).toISOString();
}

/** Sample interview events for local demo / contract testing. */
export function buildDemoCalendarBatch(syncedAt = new Date().toISOString()): CalendarSyncBatch {
  return {
    source: "demo",
    syncedAt,
    events: [
      {
        contractVersion: CALENDAR_CONTRACT_VERSION,
        eventId: "demo-calendar-clipboard-hm-001",
        company: "Clipboard",
        role: "Territory Account Executive",
        eventType: "hiring_manager",
        startDateTime: hoursFromNow(syncedAt, 36),
        endDateTime: hoursFromNow(syncedAt, 37),
        notes: "HM screen — review territory patch plan and QBR examples.",
        matchedOpportunityId: "opp-clipboard-ae",
      },
      {
        contractVersion: CALENDAR_CONTRACT_VERSION,
        eventId: "demo-calendar-safetyculture-panel-001",
        company: "SafetyCulture",
        role: "Partner Account Manager",
        eventType: "panel_interview",
        startDateTime: hoursFromNow(syncedAt, 20),
        endDateTime: hoursFromNow(syncedAt, 21.5),
        notes: "Panel loop — partner ecosystem motion + first 90-day plan.",
        matchedOpportunityId: "opp-safetyculture-pam",
      },
      {
        contractVersion: CALENDAR_CONTRACT_VERSION,
        eventId: "demo-calendar-ronco-recruiter-001",
        company: "Ronco",
        role: "Project Engineer",
        eventType: "recruiter_call",
        startDateTime: hoursFromNow(syncedAt, 72),
        endDateTime: hoursFromNow(syncedAt, 72.5),
        notes: "Intro call with Rachel — referral status check-in.",
      },
    ],
  };
}
