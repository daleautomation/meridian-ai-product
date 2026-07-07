// Meridian — Temporal Intelligence Engine: the core reasoner.
//
// computeTemporalProfile is the ONE place elapsed time becomes meaning. Given a
// relationship's raw anchors (comms, meetings, promised replies) and a reference
// `now`, it derives every duration, the aging band, the time-only heat, the full
// deadline list (overdue + upcoming), the meeting lifecycle, decay risk, a recovery
// estimate, and an ordinal impact score. Pure + deterministic — `now` is injected,
// never read from the clock — so scans are reproducible and testable.

import type { Confidence, MomentumState, OpportunityStage, WaitingOn } from "@/lib/gmail/types";
import { classifyMeeting, type MeetingInput } from "./meetings";
import { inferExpectedResponse } from "./deadlines";
import type {
  AgingBand,
  DecayRisk,
  MeetingState,
  TemporalDeadline,
  TemporalProfile,
  TimeHeat,
} from "./types";

const DAY = 86_400_000;

// ── Thresholds (aging engine) — will become adaptive from outcomes later ──────
export const AGING_THRESHOLDS = { green: 3, yellow: 7, orange: 14, red: 29 } as const; // black = 30+
export const HEAT_THRESHOLDS = { fresh: 3, warming: 7, cooling: 14, stale: 30, dormant: 60 } as const;
export const UPCOMING_HORIZON_DAYS = 7; // a deadline within this many days is "upcoming"
export const MEETING_PREP_LEAD_DAYS = 1; // prep is due this many days before a meeting

function dayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/** Whole-day difference (a − b), calendar-day aligned. Positive = a is later. */
function dayDiff(aMs: number, bMs: number): number {
  return Math.round((dayStart(aMs) - dayStart(bMs)) / DAY);
}
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const maxMs = (...xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.max(...v) : null;
};

export function agingBandOf(daysSinceActivity: number | null): AgingBand {
  if (daysSinceActivity === null) return "black";
  if (daysSinceActivity <= AGING_THRESHOLDS.green) return "green";
  if (daysSinceActivity <= AGING_THRESHOLDS.yellow) return "yellow";
  if (daysSinceActivity <= AGING_THRESHOLDS.orange) return "orange";
  if (daysSinceActivity <= AGING_THRESHOLDS.red) return "red";
  return "black";
}

export function timeHeatOf(daysSinceActivity: number | null): TimeHeat {
  if (daysSinceActivity === null) return "dead";
  if (daysSinceActivity <= HEAT_THRESHOLDS.fresh) return "fresh";
  if (daysSinceActivity <= HEAT_THRESHOLDS.warming) return "warming";
  if (daysSinceActivity <= HEAT_THRESHOLDS.cooling) return "cooling";
  if (daysSinceActivity <= HEAT_THRESHOLDS.stale) return "stale";
  if (daysSinceActivity <= HEAT_THRESHOLDS.dormant) return "dormant";
  return "dead";
}

const KIND_IMPACT: Record<string, number> = { career: 30, sales: 30, consulting: 26, partnership: 22, referral: 18, unknown: 10 };
const STAGE_IMPACT: Partial<Record<OpportunityStage, number>> = {
  meeting_scheduled: 24, meeting_completed: 24, waiting_on_me: 22, follow_up_due: 22,
  active_pipeline: 20, waiting_on_them: 18, replied: 16, discovered: 14, contacted: 14,
  stalled: 12, watch: 6, rejected: 2, closed_lost: 2, closed_won: 4,
};
const MOMENTUM_IMPACT: Record<MomentumState, number> = { accelerating: 20, warm: 16, cooling: 10, cold: 6, dead: 2 };
const CONFIDENCE_IMPACT: Record<Confidence, number> = { high: 12, medium: 8, low: 4, unknown: 2 };

export function impactScoreOf(kind: string, stage: OpportunityStage, momentum: MomentumState, confidence: Confidence): number {
  const s = (KIND_IMPACT[kind] ?? 10) + (STAGE_IMPACT[stage] ?? 8) + MOMENTUM_IMPACT[momentum] + CONFIDENCE_IMPACT[confidence];
  return Math.max(0, Math.min(100, s));
}

/** Estimated recovery chance for an overdue/missed opportunity. Heuristic decay —
 *  labelled as an estimate everywhere it surfaces, never a calibrated forecast. */
export function recoveryProbabilityOf(daysOverdue: number, engagement: string | undefined): number {
  const base = 0.6 * Math.exp(-daysOverdue / 40) + 0.05;
  const prior = engagement === "two_way" ? 1.0
    : engagement === "owner_initiated" || engagement === "inbound_qualified" ? 0.85
    : 0.7;
  return Math.max(0.02, Math.min(0.95, Math.round(base * prior * 100) / 100));
}

function decayRiskOf(aging: AgingBand, missed: boolean, daysOverdue: number): DecayRisk {
  if (missed || daysOverdue >= 21) return daysOverdue >= 30 ? "lost" : "high";
  switch (aging) {
    case "green": return daysOverdue > 0 ? "low" : "none";
    case "yellow": return "low";
    case "orange": return "moderate";
    case "red": return "high";
    case "black": return "lost";
  }
}

export interface TemporalInput {
  createdAtMs: number | null;
  lastInboundMs: number | null;
  lastOutboundMs: number | null;
  /** Communications, for meeting-completion evidence + last inbound text. */
  comms: Array<{ ts: number; direction: "inbound" | "outbound" | null; text?: string }>;
  meetings: MeetingInput[];
  stage: OpportunityStage;
  momentum: MomentumState;
  kind: string;
  confidence: Confidence;
  waitingOn: WaitingOn;
  engagement?: string;
  statusChangedAtMs: number | null;
  lastReminderSentMs?: number | null;
}

/** Where a follow-up is due, centrally (moved out of the belief engine so all
 *  surfaces agree). Owner-owed moves are due immediately; their-court threads get
 *  a grace window; terminal stages have no follow-up. */
function followUpDueMsFor(stage: OpportunityStage, lastMeaningfulMs: number | null): number | null {
  if (lastMeaningfulMs === null) return null;
  switch (stage) {
    case "waiting_on_me":
    case "follow_up_due":
      return lastMeaningfulMs; // due now / overdue from their last contact
    case "waiting_on_them":
    case "meeting_completed":
      return lastMeaningfulMs + 4 * DAY;
    case "meeting_scheduled":
    case "contacted":
    case "discovered":
    case "replied":
      return lastMeaningfulMs + 3 * DAY;
    case "stalled":
      return lastMeaningfulMs + 7 * DAY;
    default:
      return null; // closed / rejected / watch / active_pipeline
  }
}

export function computeTemporalProfile(input: TemporalInput, nowMs: number): TemporalProfile {
  const now = new Date(nowMs).toISOString();
  const commTs = input.comms.map((c) => c.ts);

  // ── Meetings ──
  const meetings: MeetingState[] = input.meetings
    .map((m) => classifyMeeting(m, commTs, nowMs))
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  const futureMeetings = meetings.filter((m) => Date.parse(m.scheduledFor) > nowMs && m.lifecycle !== "cancelled");
  const pastMeetings = meetings.filter((m) => Date.parse(m.scheduledFor) <= nowMs);
  const completedMeetings = pastMeetings.filter((m) => m.lifecycle === "completed");
  const missedMeetings = meetings.filter((m) => m.lifecycle === "missed");
  const nextMeetingMs = futureMeetings.length ? Date.parse(futureMeetings[0].scheduledFor) : null;
  const lastMeetingMs = pastMeetings.length ? Date.parse(pastMeetings[pastMeetings.length - 1].scheduledFor) : null;
  // Most recent missed meeting is the one that matters for recovery.
  const missedMeeting = missedMeetings.length
    ? missedMeetings.reduce((a, b) => (Date.parse(a.scheduledFor) >= Date.parse(b.scheduledFor) ? a : b))
    : null;

  // ── Meaningful activity = last real touch (comm or a meeting that happened) ──
  const lastCompletedMeetingMs = completedMeetings.length
    ? Math.max(...completedMeetings.map((m) => Date.parse(m.endsAt ?? m.scheduledFor)))
    : null;
  const lastMeaningfulMs = maxMs(input.lastInboundMs, input.lastOutboundMs, lastCompletedMeetingMs);
  const daysSinceActivity = lastMeaningfulMs === null ? null : dayDiff(nowMs, lastMeaningfulMs);
  const relationshipAge = input.createdAtMs === null ? null : dayDiff(nowMs, input.createdAtMs);
  // Momentum rises on inbound engagement or a completed meeting.
  const momentumIncreasedMs = maxMs(input.lastInboundMs, lastCompletedMeetingMs);
  const momentumAge = momentumIncreasedMs === null ? null : dayDiff(nowMs, momentumIncreasedMs);

  // ── Expected response (from the counterparty's last inbound promise) ──
  const lastInboundComm = [...input.comms].filter((c) => c.direction === "inbound").sort((a, b) => a.ts - b.ts).pop();
  const promise = lastInboundComm?.text ? inferExpectedResponse(lastInboundComm.text, lastInboundComm.ts) : null;
  const nextExpectedResponseMs = promise ? promise.atMs : null;

  // ── Follow-up due (central) ──
  const followUpDueMs = followUpDueMsFor(input.stage, lastMeaningfulMs);

  // ── Deadline list ──
  const deadlines: TemporalDeadline[] = [];
  const pushDeadline = (kind: TemporalDeadline["kind"], atMs: number, label: string, source: string) => {
    const d = dayDiff(atMs, nowMs);
    deadlines.push({ kind, at: iso(atMs)!, label, daysUntil: d, overdue: d < 0, source });
  };
  if (followUpDueMs !== null && input.stage !== "meeting_scheduled") {
    pushDeadline("follow_up", followUpDueMs, `Follow up (${input.stage.replace(/_/g, " ")})`, "stage + last activity");
  }
  if (nextExpectedResponseMs !== null) {
    pushDeadline("expected_response", nextExpectedResponseMs, `Their reply expected (“${promise!.phrase}”)`, `inbound language, ${promise!.confidence} confidence`);
  }
  for (const m of futureMeetings) {
    const startMs = Date.parse(m.scheduledFor);
    pushDeadline("meeting", startMs, "Meeting", m.source);
    pushDeadline("meeting_prep", startMs - MEETING_PREP_LEAD_DAYS * DAY, "Meeting prep due", m.source);
  }
  for (const m of missedMeetings) {
    pushDeadline("missed_meeting", Date.parse(m.scheduledFor), "Missed meeting — recover", m.source);
  }

  const overdue = deadlines.filter((d) => d.overdue);
  const upcoming = deadlines.filter((d) => d.daysUntil >= 0 && d.daysUntil <= UPCOMING_HORIZON_DAYS);
  const daysOverdue = overdue.length ? Math.max(...overdue.map((d) => -d.daysUntil)) : 0;
  const upcomingPositive = deadlines.filter((d) => d.daysUntil >= 0).map((d) => d.daysUntil);
  const daysUntilDeadline = upcomingPositive.length ? Math.min(...upcomingPositive) : null;

  // ── Bands & scores ──
  const aging = agingBandOf(daysSinceActivity);
  const heat = timeHeatOf(daysSinceActivity);
  const missed = missedMeeting !== null;
  const decayRisk = decayRiskOf(aging, missed, daysOverdue);
  let stalenessScore = daysSinceActivity === null ? 100 : Math.min(100, Math.round((daysSinceActivity / (AGING_THRESHOLDS.red + 1)) * 100));
  if (missed) stalenessScore = Math.max(stalenessScore, 85);
  if (daysOverdue > 0) stalenessScore = Math.min(100, stalenessScore + Math.min(15, daysOverdue));
  const recoveryProbability = missed || daysOverdue > 0 ? recoveryProbabilityOf(daysOverdue, input.engagement) : null;
  const impactScore = impactScoreOf(input.kind, input.stage, input.momentum, input.confidence);

  return {
    now,
    createdAt: iso(input.createdAtMs),
    lastInbound: iso(input.lastInboundMs),
    lastOutbound: iso(input.lastOutboundMs),
    lastMeeting: iso(lastMeetingMs),
    nextMeeting: iso(nextMeetingMs),
    followUpDue: iso(followUpDueMs),
    nextExpectedResponse: iso(nextExpectedResponseMs),
    lastMeaningfulActivity: iso(lastMeaningfulMs),
    lastScan: now,
    statusChangedAt: iso(input.statusChangedAtMs),
    lastReminderSent: iso(input.lastReminderSentMs ?? null),
    daysSinceActivity,
    daysUntilDeadline,
    daysOverdue,
    momentumAge,
    relationshipAge,
    stalenessScore,
    aging,
    heat,
    decayRisk,
    deadlines,
    overdue,
    upcoming,
    meetings,
    missedMeeting,
    recoveryProbability,
    impactScore,
  };
}

/** Empty profile for tests / cold beliefs with no temporal signal. */
export function defaultTemporalProfile(nowMs: number): TemporalProfile {
  const now = new Date(nowMs).toISOString();
  return {
    now, createdAt: null, lastInbound: null, lastOutbound: null, lastMeeting: null, nextMeeting: null,
    followUpDue: null, nextExpectedResponse: null, lastMeaningfulActivity: null, lastScan: now,
    statusChangedAt: null, lastReminderSent: null, daysSinceActivity: null, daysUntilDeadline: null,
    daysOverdue: 0, momentumAge: null, relationshipAge: null, stalenessScore: 0, aging: "green",
    heat: "fresh", decayRisk: "none", deadlines: [], overdue: [], upcoming: [], meetings: [],
    missedMeeting: null, recoveryProbability: null, impactScore: 0,
  };
}
