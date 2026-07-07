// Meridian — Temporal Intelligence Engine: dashboard derivations.
//
// Turns a set of temporally-aware beliefs into the COO-style views the operator
// reads first: what became more urgent, what is overdue (sorted by impact), what
// will become overdue soon, and the time-based dashboard sections. Pure functions
// over belief.temporal — no clock reads, no re-deriving time in the UI.

import type { Belief } from "@/lib/beliefs/types";
import type {
  OverdueItem,
  TemporalDeadline,
  UpcomingRiskItem,
  UrgencyEvent,
} from "./types";

/** A compact row for the time-based dashboard sections. */
export interface TemporalRow {
  subjectKey: string;
  label: string;
  metric: string; // the temporal fact ("31d overdue", "in 2 days", "meeting Jul 13")
  action: string;
}

function impactBand(score: number): "high" | "medium" | "low" {
  return score >= 60 ? "high" : score >= 35 ? "medium" : "low";
}

/** Real relationships only — cold one-way inbound is observed but never surfaced
 *  in the temporal centers (matches the brief's engagement filter). */
function realRelationships(beliefs: Belief[]): Belief[] {
  return beliefs.filter((b) => b.engagement !== "inbound_cold" && b.engagement !== "none");
}

const DEADLINE_PRIORITY: Record<TemporalDeadline["kind"], number> = {
  missed_meeting: 4, expected_response: 3, follow_up: 2, meeting_prep: 1, meeting: 0,
};

/** The single most urgent thing about a relationship right now (or null). */
export function urgencyForBelief(b: Belief): UrgencyEvent | null {
  const t = b.temporal;
  const base = { subjectKey: b.subjectKey, label: b.subjectLabel };

  if (t.missedMeeting) {
    const d = t.daysOverdue;
    return { ...base, kind: "missed_meeting", severity: 1000 + d,
      message: `${b.subjectLabel} is ${d} day${d === 1 ? "" : "s"} overdue — missed meeting on ${t.missedMeeting.scheduledFor.slice(0, 10)}.`,
      daysOverdue: d };
  }

  // Meeting prep due (a future meeting whose prep window has opened/passed).
  const prep = t.deadlines.find((x) => x.kind === "meeting_prep" && x.daysUntil <= 0);
  const nextMeetingDeadline = t.deadlines.find((x) => x.kind === "meeting" && x.daysUntil >= 0);
  if (prep && nextMeetingDeadline && nextMeetingDeadline.daysUntil <= 2) {
    const when = nextMeetingDeadline.daysUntil === 0 ? "today" : nextMeetingDeadline.daysUntil === 1 ? "tomorrow" : `in ${nextMeetingDeadline.daysUntil} days`;
    return { ...base, kind: "prep_due", severity: 850,
      message: `${b.subjectLabel} meeting prep is due — meeting ${when}.`, daysUntil: nextMeetingDeadline.daysUntil };
  }

  // Overdue follow-up / expected reply.
  const overdue = [...t.overdue].sort((a, c) => DEADLINE_PRIORITY[c.kind] - DEADLINE_PRIORITY[a.kind])[0];
  if (overdue) {
    const d = -overdue.daysUntil;
    const noun = overdue.kind === "expected_response" ? "their expected reply" : "your follow-up";
    return { ...base, kind: "overdue", severity: 700 + d,
      message: `${b.subjectLabel}: ${noun} is ${d} day${d === 1 ? "" : "s"} overdue.`, daysOverdue: d };
  }

  // Follow-up window opens tomorrow.
  const followTomorrow = t.deadlines.find((x) => x.kind === "follow_up" && x.daysUntil === 1);
  if (followTomorrow) {
    return { ...base, kind: "follow_up_window", severity: 500,
      message: `${b.subjectLabel} enters its follow-up window tomorrow.`, daysUntil: 1 };
  }

  // Expected-response window closing within 2 days.
  const respClosing = t.deadlines.find((x) => x.kind === "expected_response" && x.daysUntil >= 0 && x.daysUntil <= 2);
  if (respClosing) {
    const when = respClosing.daysUntil === 0 ? "today" : respClosing.daysUntil === 1 ? "tomorrow" : `in ${respClosing.daysUntil} days`;
    return { ...base, kind: "response_window_closing", severity: 450,
      message: `Expected response window for ${b.subjectLabel} closes ${when}.`, daysUntil: respClosing.daysUntil };
  }

  // Notable inactivity (6+ days) on a real relationship.
  if (t.daysSinceActivity !== null && t.daysSinceActivity >= 6 && b.momentum !== "dead" && t.impactScore >= 35) {
    return { ...base, kind: "inactivity", severity: 200 + t.daysSinceActivity,
      message: `${b.subjectLabel} has been inactive for ${t.daysSinceActivity} days.`, daysUntil: undefined };
  }
  return null;
}

/** "What became more urgent" — the daily brief lede, most urgent first. */
export function buildUrgencyLede(beliefs: Belief[], limit = 6): UrgencyEvent[] {
  return realRelationships(beliefs)
    .map(urgencyForBelief)
    .filter((e): e is UrgencyEvent => e !== null)
    .sort((a, b) => (b.severity !== a.severity ? b.severity - a.severity : a.label.localeCompare(b.label)))
    .slice(0, limit);
}

/** Overdue Center — every overdue relationship, sorted by expected impact. */
export function buildOverdueCenter(beliefs: Belief[]): OverdueItem[] {
  const items: OverdueItem[] = [];
  for (const b of realRelationships(beliefs)) {
    const t = b.temporal;
    if (t.overdue.length === 0) continue;
    const top = [...t.overdue].sort((a, c) => DEADLINE_PRIORITY[c.kind] - DEADLINE_PRIORITY[a.kind])[0];
    const daysOverdue = -top.daysUntil;

    let reason: string;
    let expectedAction: string;
    if (top.kind === "missed_meeting") {
      reason = b.kind === "career" ? "Missed interview" : "Missed meeting";
      expectedAction = "Reach out immediately with an honest explanation.";
    } else if (top.kind === "expected_response") {
      reason = "Expected reply overdue";
      expectedAction = `Send a follow-up — ${b.subjectLabel}'s reply window has closed.`;
    } else if (top.kind === "meeting_prep") {
      const meeting = t.deadlines.find((x) => x.kind === "meeting");
      const when = meeting ? (meeting.daysUntil === 0 ? "today" : meeting.daysUntil === 1 ? "tomorrow" : `in ${meeting.daysUntil} days`) : "soon";
      reason = "Meeting prep overdue";
      expectedAction = `Prep not completed — meeting ${when}.`;
    } else {
      reason = "Follow-up overdue";
      expectedAction = b.nextAction;
    }

    items.push({
      subjectKey: b.subjectKey,
      label: b.subjectLabel,
      kind: b.kind,
      reason,
      daysOverdue,
      expectedAction,
      recoveryProbability: top.kind === "meeting_prep" ? null : t.recoveryProbability,
      impactScore: t.impactScore,
      impactBand: impactBand(t.impactScore),
    });
  }
  return items.sort((a, b) => (b.impactScore !== a.impactScore ? b.impactScore - a.impactScore : b.daysOverdue - a.daysOverdue));
}

function whenLabel(days: number): string {
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}

/** Upcoming Risk Center — predict what becomes overdue in the next few days. */
export function buildUpcomingRiskCenter(beliefs: Belief[], horizonDays = 3): UpcomingRiskItem[] {
  const items: UpcomingRiskItem[] = [];
  for (const b of realRelationships(beliefs)) {
    const t = b.temporal;
    const candidates: Array<{ whenDays: number; prediction: string; action: string; sev: number }> = [];

    const prep = t.deadlines.find((x) => x.kind === "meeting_prep" && x.daysUntil >= 0 && x.daysUntil <= horizonDays);
    if (prep) candidates.push({ whenDays: prep.daysUntil, prediction: `Prepare the ${b.subjectLabel} meeting`, action: b.nextAction, sev: 3 });

    const follow = t.deadlines.find((x) => x.kind === "follow_up" && x.daysUntil >= 0 && x.daysUntil <= horizonDays);
    if (follow) candidates.push({ whenDays: follow.daysUntil, prediction: `Follow up with ${b.subjectLabel}`, action: b.nextAction, sev: 2 });

    const resp = t.deadlines.find((x) => x.kind === "expected_response" && x.daysUntil >= 0 && x.daysUntil <= horizonDays);
    if (resp) candidates.push({ whenDays: resp.daysUntil, prediction: `Expected response window closes for ${b.subjectLabel}`, action: `If silent, follow up with ${b.subjectLabel}.`, sev: 2 });

    // Decay: a relationship about to cross into "likely dead" (30d inactive).
    if (t.daysSinceActivity !== null && b.momentum !== "dead") {
      const toBlack = 30 - t.daysSinceActivity;
      if (toBlack >= 0 && toBlack <= horizonDays) {
        candidates.push({ whenDays: toBlack, prediction: `${b.subjectLabel} likely transitions to a lost opportunity`, action: `Re-engage ${b.subjectLabel} before it goes cold.`, sev: 1 });
      }
    }

    if (candidates.length === 0) continue;
    const best = candidates.sort((a, c) => (a.whenDays !== c.whenDays ? a.whenDays - c.whenDays : c.sev - a.sev))[0];
    items.push({ subjectKey: b.subjectKey, label: b.subjectLabel, whenDays: best.whenDays, whenLabel: whenLabel(best.whenDays), prediction: best.prediction, action: best.action });
  }
  return items.sort((a, b) => (a.whenDays !== b.whenDays ? a.whenDays - b.whenDays : a.label.localeCompare(b.label)));
}

export interface TemporalSections {
  todaysDeadlines: TemporalRow[];
  upcomingDeadlines: TemporalRow[];
  overdue: TemporalRow[];
  recentlyMissed: TemporalRow[];
  needsScheduling: TemporalRow[];
  waitingTooLong: TemporalRow[];
  expectedRepliesThisWeek: TemporalRow[];
  expectedMeetingsThisWeek: TemporalRow[];
}

const row = (b: Belief, metric: string, action?: string): TemporalRow => ({
  subjectKey: b.subjectKey, label: b.subjectLabel, metric, action: action ?? b.nextAction,
});

/** The eight time-based dashboard sections. */
export function buildTemporalSections(beliefs: Belief[]): TemporalSections {
  const active = beliefs.filter((b) => b.engagement !== "inbound_cold" && b.engagement !== "none");
  const s: TemporalSections = {
    todaysDeadlines: [], upcomingDeadlines: [], overdue: [], recentlyMissed: [],
    needsScheduling: [], waitingTooLong: [], expectedRepliesThisWeek: [], expectedMeetingsThisWeek: [],
  };

  for (const b of active) {
    const t = b.temporal;

    const dueToday = t.deadlines.find((d) => d.daysUntil === 0);
    if (dueToday) s.todaysDeadlines.push(row(b, `${dueToday.label} — due today`));

    const soon = t.deadlines.filter((d) => d.daysUntil >= 1 && d.daysUntil <= 7).sort((a, c) => a.daysUntil - c.daysUntil)[0];
    if (soon) s.upcomingDeadlines.push(row(b, `${soon.label} in ${soon.daysUntil}d`));

    if (t.overdue.length > 0) s.overdue.push(row(b, `${t.daysOverdue}d overdue`));

    if (t.missedMeeting) s.recentlyMissed.push(row(b, `missed ${t.missedMeeting.scheduledFor.slice(0, 10)}`, "Reach out with an honest explanation."));

    // Needs scheduling: warm/active, no next meeting booked, not terminal.
    const terminal = ["rejected", "closed_won", "closed_lost", "watch"].includes(b.stage);
    if (!terminal && !t.nextMeeting && (b.momentum === "warm" || b.momentum === "accelerating") &&
        ["meeting_completed", "waiting_on_them", "replied", "discovered", "contacted"].includes(b.stage)) {
      s.needsScheduling.push(row(b, "no next meeting booked", `Propose a next step / time to ${b.subjectLabel}.`));
    }

    if (b.waitingOn === "them" && t.daysSinceActivity !== null && t.daysSinceActivity >= 10 && !["rejected", "closed_lost"].includes(b.stage)) {
      s.waitingTooLong.push(row(b, `silent ${t.daysSinceActivity}d`, `Nudge ${b.subjectLabel} — it's been too long.`));
    }

    if (t.nextExpectedResponse) {
      const d = t.deadlines.find((x) => x.kind === "expected_response");
      if (d && d.daysUntil >= -1 && d.daysUntil <= 7) s.expectedRepliesThisWeek.push(row(b, d.daysUntil < 0 ? `reply overdue ${-d.daysUntil}d` : `reply by ${t.nextExpectedResponse.slice(0, 10)}`));
    }

    if (t.nextMeeting) {
      const d = t.deadlines.find((x) => x.kind === "meeting");
      if (d && d.daysUntil <= 7) s.expectedMeetingsThisWeek.push(row(b, `meeting ${t.nextMeeting.slice(0, 10)} (${d.daysUntil}d)`, `Prepare for the ${b.subjectLabel} meeting.`));
    }
  }
  return s;
}
