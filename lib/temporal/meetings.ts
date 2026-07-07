// Meridian — Temporal Intelligence Engine: meeting reasoning.
//
// Two jobs, both deterministic:
//   1. parseMeetingTime — pull an actual meeting datetime out of invite text like
//      "… @ Tue Jun 9, 2026 1:30pm - 2pm (CDT)". This is the gap that let the
//      SoftDoes interview go unseen: its invite never matched the naive
//      "^invitation:" check, so no meeting was ever recorded.
//   2. classifyMeeting — decide a meeting's lifecycle. A past meeting is COMPLETED
//      only if post-meeting evidence exists (a reply, "great meeting", a follow-up);
//      otherwise, once the grace window passes, it is MISSED. Never left "scheduled".

import type { MeetingLifecycle, MeetingState } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** How long after a meeting ends before "no evidence yet" becomes MISSED. */
export const MEETING_GRACE_MS = 6 * HOUR;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Hours to ADD to a local time to reach UTC (i.e. -(UTC offset)). */
const TZ_TO_UTC_ADD: Record<string, number> = {
  edt: 4, est: 5, cdt: 5, cst: 6, mdt: 6, mst: 7, pdt: 7, pst: 8, utc: 0, gmt: 0,
};

function to24h(h: number, ampm: string): number {
  const pm = ampm.toLowerCase() === "pm";
  if (pm) return h === 12 ? 12 : h + 12;
  return h === 12 ? 0 : h; // am
}

export interface ParsedMeetingTime {
  startMs: number;
  endMs: number | null;
  tz: string | null;
  raw: string;
}

/**
 * Extract a meeting datetime from free text (an invite subject/snippet). Matches
 * "[Wkd] Mon D, YYYY h[:mm]am/pm [- h[:mm]am/pm] [(TZ)]". Timezone is honoured when
 * present; otherwise Central (America/Chicago, CDT) is assumed and flagged via tz=null.
 * Returns null when no confident datetime is present.
 */
export function parseMeetingTime(text: string): ParsedMeetingTime | null {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ");
  // Month Day, Year  Hour[:min]am/pm  [ - Hour[:min]am/pm ]  [ (TZ) ]
  const re = new RegExp(
    "(" + Object.keys(MONTHS).join("|") + ")[a-z]*\\.?\\s+" + // month
    "(\\d{1,2}),?\\s+" + // day
    "(\\d{4})\\s+" + // year
    "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)" + // start time
    "(?:\\s*(?:-|to|–)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm))?" + // optional end time
    "(?:\\s*\\(?([A-Za-z]{2,4})\\)?)?", // optional tz
    "i",
  );
  const m = re.exec(t);
  if (!m) return null;

  const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  const startH = to24h(Number(m[4]), m[6]);
  const startMin = m[5] ? Number(m[5]) : 0;
  const tzToken = (m[10] ?? "").toLowerCase();
  const tzAdd = tzToken in TZ_TO_UTC_ADD ? TZ_TO_UTC_ADD[tzToken] : TZ_TO_UTC_ADD.cdt;
  const tz = tzToken in TZ_TO_UTC_ADD ? tzToken.toUpperCase() : null;

  const startMs = Date.UTC(year, month, day, startH + tzAdd, startMin);
  let endMs: number | null = null;
  if (m[7]) {
    const endH = to24h(Number(m[7]), m[9]);
    const endMin = m[8] ? Number(m[8]) : 0;
    endMs = Date.UTC(year, month, day, endH + tzAdd, endMin);
  }
  return { startMs, endMs, tz, raw: m[0] };
}

export interface MeetingInput {
  id: string;
  startMs: number;
  endMs: number | null;
  status?: string; // "confirmed" | "cancelled" | "tentative"
  source: string;
}

/** Text that, if seen AFTER a meeting, confirms it happened. */
const COMPLETION_LANGUAGE = [
  "great meeting", "great to meet", "great chat", "great talking", "great call",
  "thanks for meeting", "thanks for the call", "thanks for the time", "thanks for your time",
  "nice to meet", "good to meet", "enjoyed our", "enjoyed the", "following up on our",
  "as discussed", "recap", "next steps",
];

export function hasCompletionLanguage(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return COMPLETION_LANGUAGE.some((p) => t.includes(p));
}

/**
 * Classify one meeting. `evidenceAfter` are timestamps (ms) of any communication
 * that happened after the meeting ended — their existence marks the meeting
 * completed. Without them, once the grace window passes, the meeting is MISSED.
 */
export function classifyMeeting(m: MeetingInput, evidenceAfterMs: number[], nowMs: number): MeetingState {
  const scheduledFor = new Date(m.startMs).toISOString();
  const endsAt = m.endMs !== null ? new Date(m.endMs).toISOString() : null;
  const daysUntil = Math.floor((m.startMs - nowMs) / DAY);
  const endRef = m.endMs ?? m.startMs;
  const hasFollowUpEvidence = evidenceAfterMs.some((ts) => ts > endRef);

  const base = (lifecycle: MeetingLifecycle, reason: string): MeetingState => ({
    id: m.id, scheduledFor, endsAt, lifecycle, source: m.source, hasFollowUpEvidence, daysUntil, reason,
  });

  const status = (m.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "canceled") return base("cancelled", "Marked cancelled at the source.");

  if (m.startMs > nowMs) {
    return base("scheduled", `Scheduled ${Math.abs(daysUntil)}d out.`);
  }
  // Past meeting.
  if (hasFollowUpEvidence) {
    return base("completed", "Communication occurred after the meeting — completed.");
  }
  if (nowMs < endRef + MEETING_GRACE_MS) {
    return base("awaiting_follow_up", "Meeting time passed; within the grace window — awaiting confirmation.");
  }
  const daysAgo = Math.floor((nowMs - endRef) / DAY);
  return base("missed", `Meeting time passed ${daysAgo}d ago with no completion evidence — flagged MISSED.`);
}
