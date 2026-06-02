// AE Job OS — deterministic calendar → pipeline + Career Brief projections.

import {
  CALENDAR_CONTRACT_VERSION,
  CAREER_EVENT_TYPE_LABELS,
  findMatchingOpportunityForCalendar,
  INTERVIEW_EVENT_TYPES,
  type CalendarSyncBatch,
  type CalendarSyncResult,
  type CareerCalendarEvent,
  type CareerEventType,
} from "./calendar";
import type {
  JobOpportunity,
  NeedsDylanItem,
  Priority,
  UpcomingItem,
  UpcomingItemKind,
} from "./types";

const MS_48H = 48 * 3_600_000;
const MS_24H = 24 * 3_600_000;

export const CALENDAR_REMINDER_LABELS = {
  interview_reminder_48h: "Interview in 48h",
  interview_reminder_24h: "Interview in 24h",
} as const;

export type CalendarReminderCategory = keyof typeof CALENDAR_REMINDER_LABELS;

export interface CalendarBriefMeta {
  contractVersion: string;
  statusMessage: string;
  lastSyncedAt: string | null;
  eventsImported: number;
  upcomingInterviews: number;
}

function parseMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function todayIso(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isDueThisWeek(dateIso: string, nowMs: number): boolean {
  const date = dateIso.slice(0, 10);
  const today = todayIso(nowMs);
  const weekEnd = addDays(today, 7);
  return date >= today && date <= weekEnd;
}

function upcomingKindForEventType(eventType: CareerEventType): UpcomingItemKind {
  if (INTERVIEW_EVENT_TYPES.has(eventType)) return "interview";
  if (eventType === "case_study_review") return "case_study_deadline";
  return "follow_up";
}

function actionForCalendarEvent(event: CareerCalendarEvent): string {
  const label = CAREER_EVENT_TYPE_LABELS[event.eventType];
  const note = event.notes.trim();
  return note ? `${label}: ${note}` : `Prepare for ${label.toLowerCase()}`;
}

/** In-memory enrichment for Career Brief (does not persist). */
export function enrichOpportunitiesFromCalendar(
  opportunities: JobOpportunity[],
  events: CareerCalendarEvent[],
): JobOpportunity[] {
  const next = opportunities.map((o) => ({
    ...o,
    checklist: { ...o.checklist },
  }));

  for (const event of events) {
    if (!INTERVIEW_EVENT_TYPES.has(event.eventType)) continue;
    const match = findMatchingOpportunityForCalendar(next, event);
    if (!match) continue;

    const idx = next.findIndex((o) => o.id === match.id);
    if (idx < 0) continue;

    const opp = next[idx];
    const startDate = event.startDateTime.slice(0, 10);
    opp.checklist.interview_scheduled = true;
    opp.prepRequired = true;
    if (!opp.followUpDate || opp.followUpDate.slice(0, 10) > startDate) {
      opp.followUpDate = startDate;
    }
    const calendarLine = `[calendar] ${CAREER_EVENT_TYPE_LABELS[event.eventType]} ${event.startDateTime.slice(0, 16)}`;
    if (!opp.notes.includes(calendarLine)) {
      opp.notes = opp.notes.trim() ? `${opp.notes.trim()}\n${calendarLine}` : calendarLine;
    }
    next[idx] = opp;
  }

  return next;
}

/** Persist calendar checklist / prep updates onto matched opportunities. */
export function applyCalendarOpportunityUpdates(
  opportunities: JobOpportunity[],
  events: CareerCalendarEvent[],
  syncedAt: string,
): { opportunities: JobOpportunity[]; opportunitiesUpdated: number } {
  let updated = 0;
  const enriched = enrichOpportunitiesFromCalendar(opportunities, events);

  for (let i = 0; i < opportunities.length; i += 1) {
    const before = opportunities[i];
    const after = enriched[i];
    const changed =
      before.checklist.interview_scheduled !== after.checklist.interview_scheduled ||
      before.prepRequired !== after.prepRequired ||
      before.followUpDate !== after.followUpDate ||
      before.notes !== after.notes;
    if (changed) {
      updated += 1;
      enriched[i] = { ...after, updatedAt: syncedAt };
    }
  }

  return { opportunities: enriched, opportunitiesUpdated: updated };
}

export function applyCalendarSync(
  existingEvents: CareerCalendarEvent[],
  opportunities: JobOpportunity[],
  batch: CalendarSyncBatch,
  seenEventIds: Set<string>,
): {
  events: CareerCalendarEvent[];
  opportunities: JobOpportunity[];
  result: CalendarSyncResult;
} {
  const result: CalendarSyncResult = {
    imported: 0,
    skipped: 0,
    opportunitiesUpdated: 0,
    errors: [],
  };

  const mergedEvents = [...existingEvents];

  for (const event of batch.events) {
    if (event.contractVersion !== CALENDAR_CONTRACT_VERSION) {
      result.errors.push(`Unsupported contract: ${event.contractVersion}`);
      continue;
    }
    if (seenEventIds.has(event.eventId)) {
      result.skipped += 1;
      continue;
    }
    seenEventIds.add(event.eventId);
    mergedEvents.push(event);
    result.imported += 1;
  }

  const { opportunities: updatedOpps, opportunitiesUpdated } = applyCalendarOpportunityUpdates(
    opportunities,
    mergedEvents,
    batch.syncedAt,
  );
  result.opportunitiesUpdated = opportunitiesUpdated;

  return { events: mergedEvents, opportunities: updatedOpps, result };
}

export function countUpcomingInterviewEvents(
  events: CareerCalendarEvent[],
  nowMs: number,
): number {
  const today = todayIso(nowMs);
  const weekEnd = addDays(today, 7);
  return events.filter((e) => {
    if (!INTERVIEW_EVENT_TYPES.has(e.eventType)) return false;
    const date = e.startDateTime.slice(0, 10);
    return date >= today && date <= weekEnd;
  }).length;
}

export function buildCalendarBriefMeta(
  events: CareerCalendarEvent[],
  lastSyncedAt: string | null,
  statusMessage: string,
  nowMs = Date.now(),
): CalendarBriefMeta {
  return {
    contractVersion: CALENDAR_CONTRACT_VERSION,
    statusMessage,
    lastSyncedAt,
    eventsImported: events.length,
    upcomingInterviews: countUpcomingInterviewEvents(events, nowMs),
  };
}

export function buildCalendarUpcomingItems(
  events: CareerCalendarEvent[],
  opportunities: JobOpportunity[],
  nowMs = Date.now(),
): UpcomingItem[] {
  const items: UpcomingItem[] = [];

  for (const event of events) {
    const date = event.startDateTime.slice(0, 10);
    if (!isDueThisWeek(date, nowMs)) continue;

    const match = findMatchingOpportunityForCalendar(opportunities, event);
    const kind = upcomingKindForEventType(event.eventType);

    items.push({
      date,
      company: event.company,
      roleTitle: event.role,
      actionRequired: actionForCalendarEvent(event),
      kind,
      kindLabel:
        kind === "interview"
          ? CAREER_EVENT_TYPE_LABELS[event.eventType]
          : kind === "case_study_deadline"
            ? "Case study review"
            : CAREER_EVENT_TYPE_LABELS[event.eventType],
      opportunityId: match?.id ?? `calendar:${event.eventId}`,
    });
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.opportunityId}:${item.kind}:${item.date}:${item.actionRequired}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function reminderWindow(
  startMs: number,
  nowMs: number,
): CalendarReminderCategory | null {
  if (nowMs >= startMs) return null;
  const until = startMs - nowMs;
  const after48 = startMs - MS_48H;
  const after24 = startMs - MS_24H;
  if (nowMs >= after48 && nowMs < after24) return "interview_reminder_48h";
  if (nowMs >= after24 && nowMs < startMs) return "interview_reminder_24h";
  if (until > MS_48H) return null;
  return null;
}

export function buildCalendarReminderItems(
  events: CareerCalendarEvent[],
  opportunities: JobOpportunity[],
  nowMs = Date.now(),
): NeedsDylanItem[] {
  const items: NeedsDylanItem[] = [];

  for (const event of events) {
    if (!INTERVIEW_EVENT_TYPES.has(event.eventType)) continue;
    const category = reminderWindow(parseMs(event.startDateTime), nowMs);
    if (!category) continue;

    const match = findMatchingOpportunityForCalendar(opportunities, event);
    const priority: Priority =
      category === "interview_reminder_24h" ? "high" : "medium";
    const label = CAREER_EVENT_TYPE_LABELS[event.eventType];

    items.push({
      opportunityId: match?.id ?? `calendar:${event.eventId}`,
      company: event.company,
      roleTitle: event.role,
      category,
      categoryLabel: CALENDAR_REMINDER_LABELS[category],
      nextAction:
        category === "interview_reminder_48h"
          ? `48h until ${label} — complete interview prep`
          : `24h until ${label} — final prep and logistics check`,
      followUpDate: event.startDateTime.slice(0, 10),
      priority,
      roleCategory: match?.roleCategory ?? "other",
    });
  }

  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.opportunityId}:${item.category}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.followUpDate ?? "").localeCompare(b.followUpDate ?? ""));
}
