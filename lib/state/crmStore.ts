// Meridian AI — CRM Activity Store.
//
// Structured activity log for the deal pipeline. Each entry is a typed
// CRM activity with outcome, note, strategic recommendation, and calendar
// compatibility. Persisted as JSON, keyed by company key.
//
// This is the single source of truth for all outreach activity. The
// companySnapshotStore's dealActions field is updated in parallel for
// backward compatibility, but this store is the canonical CRM record.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";

// ── Types ──────────────────────────────────────────────────────────────

export type ActivityType =
  | "call" | "voicemail" | "email" | "text" | "meeting"
  | "proposal_sent" | "close_attempt" | "closed_won" | "closed_lost" | "note";

export type ActivityOutcome =
  | "connected" | "no_answer" | "left_vm" | "interested" | "not_interested"
  | "meeting_booked" | "proposal_requested" | "negotiating"
  | "closed_won" | "closed_lost" | "follow_up_needed" | null;

export type CloseRecommendation = "close" | "negotiate" | "follow_up" | "hold" | "walk_away";

export type NoteTag = "call_note" | "objection" | "negotiation" | "internal" | "meeting_recap";

export type CrmActivity = {
  id: string;
  companyKey: string;
  companyName: string;
  performedAt: string;        // ISO datetime
  activityType: ActivityType;
  performedBy: string;
  outcome: ActivityOutcome;
  note: string;
  summary?: string;           // AI-cleaned version of note
  noteTag?: NoteTag;
  nextAction?: string;
  nextActionDate?: string;    // ISO date — calendar compatible
  strategicRecommendation?: CloseRecommendation;
  closeConfidence?: number;   // 0-100
  metadata?: Record<string, unknown>;
};

export type CompanyCrmSummary = {
  companyKey: string;
  companyName: string;
  lastContactedAt: string | null;
  lastOutcome: ActivityOutcome;
  currentCloseRecommendation: CloseRecommendation;
  currentCloseStage: string;
  totalTouches: number;
  totalCalls: number;
  totalEmails: number;
  totalMeetings: number;
  notesCount: number;
  nextAction: string | null;
  nextActionDate: string | null;
  closedAt: string | null;
  closedValue: string | null;
};

export type CalendarEvent = {
  id: string;
  companyKey: string;
  companyName: string;
  eventType: ActivityType | "follow_up_due";
  date: string;               // ISO date (YYYY-MM-DD)
  time?: string;              // HH:MM if available
  outcome?: ActivityOutcome;
  note: string;
  isOverdue: boolean;
  isClosed: boolean;
};

// ── Store ──────────────────────────────────────────────────────────────

const STORE_PATH = path.join(process.cwd(), "data", "crmActivities.json");
const MAX_ACTIVITIES_PER_COMPANY = 200;

let writeQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

type StoreShape = Record<string, CrmActivity[]>; // keyed by companyKey

async function readAll(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as StoreShape;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[crmStore] read failed", e);
    return {};
  }
}

async function writeAll(data: StoreShape): Promise<void> {
  await safeWriteJson(STORE_PATH, data);
}

// ── Public API ─────────────────────────────────────────────────────────

export async function logActivity(
  activity: Omit<CrmActivity, "id">
): Promise<CrmActivity> {
  return serialize(async () => {
    const all = await readAll();
    const entry: CrmActivity = { ...activity, id: crypto.randomUUID() };
    const list = all[activity.companyKey] ?? [];
    list.push(entry);
    all[activity.companyKey] = list.slice(-MAX_ACTIVITIES_PER_COMPANY);
    await writeAll(all);
    return entry;
  });
}

export async function getTimeline(companyKey: string): Promise<CrmActivity[]> {
  const all = await readAll();
  return (all[companyKey] ?? []).sort(
    (a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()
  );
}

export async function getCompanySummary(
  companyKey: string,
  companyName: string
): Promise<CompanyCrmSummary> {
  const activities = await getTimeline(companyKey);
  const last = activities[0] ?? null;

  let totalCalls = 0, totalEmails = 0, totalMeetings = 0, notesCount = 0;
  let closedAt: string | null = null;
  for (const a of activities) {
    if (a.activityType === "call" || a.activityType === "voicemail") totalCalls++;
    if (a.activityType === "email" || a.activityType === "text") totalEmails++;
    if (a.activityType === "meeting") totalMeetings++;
    if (a.activityType === "note") notesCount++;
    if ((a.activityType === "closed_won" || a.activityType === "closed_lost") && !closedAt) {
      closedAt = a.performedAt;
    }
  }

  // Derive close recommendation from recent activity
  const recommendation = deriveCloseRecommendation(activities);

  // Find most recent next action
  let nextAction: string | null = null;
  let nextActionDate: string | null = null;
  for (const a of activities) {
    if (a.nextAction) { nextAction = a.nextAction; nextActionDate = a.nextActionDate ?? null; break; }
  }

  return {
    companyKey,
    companyName,
    lastContactedAt: last?.performedAt ?? null,
    lastOutcome: last?.outcome ?? null,
    currentCloseRecommendation: recommendation,
    currentCloseStage: deriveCloseStage(activities),
    totalTouches: activities.filter((a) => a.activityType !== "note").length,
    totalCalls,
    totalEmails,
    totalMeetings,
    notesCount,
    nextAction,
    nextActionDate,
    closedAt,
    closedValue: null, // filled by caller from snapshot value estimate
  };
}

export async function getAllActivities(): Promise<CrmActivity[]> {
  const all = await readAll();
  const flat: CrmActivity[] = [];
  for (const list of Object.values(all)) flat.push(...list);
  flat.sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime());
  return flat;
}

export async function getCalendarEvents(
  startDate: string,
  endDate: string
): Promise<CalendarEvent[]> {
  const all = await readAll();
  const events: CalendarEvent[] = [];
  const today = new Date().toISOString().split("T")[0];

  for (const [companyKey, activities] of Object.entries(all)) {
    for (const a of activities) {
      const date = a.performedAt.split("T")[0];
      if (date >= startDate && date <= endDate) {
        events.push({
          id: a.id,
          companyKey,
          companyName: a.companyName,
          eventType: a.activityType,
          date,
          time: a.performedAt.split("T")[1]?.substring(0, 5),
          outcome: a.outcome,
          note: a.note?.substring(0, 80) ?? "",
          isOverdue: false,
          isClosed: a.activityType === "closed_won" || a.activityType === "closed_lost",
        });
      }
      // Follow-up due events
      if (a.nextActionDate && a.nextActionDate >= startDate && a.nextActionDate <= endDate) {
        events.push({
          id: `fu-${a.id}`,
          companyKey,
          companyName: a.companyName,
          eventType: "follow_up_due",
          date: a.nextActionDate,
          note: a.nextAction ?? "Follow up",
          isOverdue: a.nextActionDate <= today,
          isClosed: false,
        });
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

// ── Close recommendation engine ────────────────────────────────────────

function deriveCloseRecommendation(activities: CrmActivity[]): CloseRecommendation {
  if (activities.length === 0) return "follow_up";

  const recent = activities.slice(0, 5);
  const hasInterest = recent.some((a) => a.outcome === "interested" || a.outcome === "meeting_booked" || a.outcome === "proposal_requested");
  const hasNegotiation = recent.some((a) => a.outcome === "negotiating");
  const hasNotInterested = recent.some((a) => a.outcome === "not_interested");
  const hasClosed = recent.some((a) => a.outcome === "closed_won" || a.outcome === "closed_lost");
  const consecutiveNoAnswer = countConsecutiveNoAnswer(activities);

  if (hasClosed) return "hold";
  if (hasNotInterested) return "walk_away";
  if (hasNegotiation) return "negotiate";
  if (hasInterest) return "close";
  if (consecutiveNoAnswer >= 4) return "walk_away";
  if (consecutiveNoAnswer >= 2) return "follow_up";
  return "follow_up";
}

function deriveCloseStage(activities: CrmActivity[]): string {
  if (activities.length === 0) return "Not started";
  const recent = activities[0];
  if (recent.outcome === "closed_won") return "Closed Won";
  if (recent.outcome === "closed_lost") return "Closed Lost";
  if (recent.outcome === "negotiating") return "Negotiating";
  if (recent.outcome === "proposal_requested" || recent.activityType === "proposal_sent") return "Proposal";
  if (recent.outcome === "meeting_booked" || recent.activityType === "meeting") return "Meeting";
  if (recent.outcome === "interested") return "Interested";
  if (recent.outcome === "connected") return "Connected";
  if (recent.outcome === "no_answer" || recent.outcome === "left_vm") return "Attempting contact";
  return "Outreach started";
}

function countConsecutiveNoAnswer(activities: CrmActivity[]): number {
  let count = 0;
  for (const a of activities) {
    if (a.activityType === "note") continue;
    if (a.outcome === "no_answer" || a.outcome === "left_vm") count++;
    else break;
  }
  return count;
}
