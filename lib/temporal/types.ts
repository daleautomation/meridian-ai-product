// Meridian — Temporal Intelligence Engine: types.
//
// The single source of truth for how Meridian understands TIME. Dates are never
// display strings here — every timestamp is reasoned about: how old, how overdue,
// how much longer until a deadline, whether a meeting silently passed, whether
// momentum is decaying. Everything downstream (dashboard, scoring, notifications,
// stages) derives from a TemporalProfile so nothing computes time in its own way.

/** Aging band — how healthy a relationship is by days since meaningful activity. */
export type AgingBand = "green" | "yellow" | "orange" | "red" | "black";

/** Time-only heat — momentum as a pure function of elapsed time. */
export type TimeHeat = "fresh" | "warming" | "cooling" | "stale" | "dormant" | "dead";

/** Full meeting lifecycle. A scheduled meeting whose time passes with no
 *  completion evidence becomes MISSED automatically — never left as "scheduled". */
export type MeetingLifecycle =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "rescheduled"
  | "missed"
  | "no_show"
  | "awaiting_follow_up"
  | "follow_up_complete";

export type DeadlineKind =
  | "follow_up" // I owe a follow-up by this date
  | "expected_response" // they promised / are expected to reply by this date
  | "meeting" // a meeting is scheduled at this time
  | "meeting_prep" // prep is due before an upcoming meeting
  | "missed_meeting"; // a meeting passed with no completion — overdue recovery

export interface TemporalDeadline {
  kind: DeadlineKind;
  at: string; // ISO
  label: string;
  /** Whole days until the deadline; negative when already past. */
  daysUntil: number;
  overdue: boolean;
  source: string; // evidence for why this deadline exists
}

export interface MeetingState {
  id: string;
  scheduledFor: string; // ISO
  endsAt: string | null;
  lifecycle: MeetingLifecycle;
  source: string; // connector / evidence
  hasFollowUpEvidence: boolean;
  /** Whole days until the meeting; negative when in the past. */
  daysUntil: number;
  reason: string;
}

export type DecayRisk = "none" | "low" | "moderate" | "high" | "lost";

/** The complete temporal understanding of one relationship. */
export interface TemporalProfile {
  now: string;

  // ── Raw temporal anchors (all nullable — honest about what's unknown) ──
  createdAt: string | null;
  lastInbound: string | null;
  lastOutbound: string | null;
  lastMeeting: string | null;
  nextMeeting: string | null;
  followUpDue: string | null;
  nextExpectedResponse: string | null;
  lastMeaningfulActivity: string | null;
  lastScan: string;
  statusChangedAt: string | null;
  lastReminderSent: string | null;

  // ── Derived durations (days) ──
  daysSinceActivity: number | null;
  daysUntilDeadline: number | null; // to the nearest upcoming deadline
  daysOverdue: number; // worst overdue deadline; 0 when nothing is overdue
  momentumAge: number | null; // days since the last momentum-increasing event
  relationshipAge: number | null; // days since createdAt
  stalenessScore: number; // 0–100

  // ── Classifications ──
  aging: AgingBand;
  heat: TimeHeat;
  decayRisk: DecayRisk;

  // ── Deadlines & meetings ──
  deadlines: TemporalDeadline[];
  overdue: TemporalDeadline[]; // subset, overdue === true
  upcoming: TemporalDeadline[]; // subset within the risk horizon
  meetings: MeetingState[];
  missedMeeting: MeetingState | null; // the most significant missed meeting, if any

  // ── Recovery / prioritisation (heuristic + ordinal, NEVER calibrated $) ──
  /** Estimated chance of recovering an overdue/missed opportunity (0–1), or null
   *  when nothing is overdue. Heuristic decay of daysOverdue × prior engagement;
   *  labelled as an estimate, not a calibrated forecast (per the Trust Model). */
  recoveryProbability: number | null;
  /** Ordinal 0–100 impact used only for SORTING (kind × stage × momentum ×
   *  confidence). Not dollars — the Trust Model forbids fabricated revenue. */
  impactScore: number;
}

/** One "what became more urgent" event for the daily brief lede. */
export type UrgencyKind =
  | "missed_meeting"
  | "overdue"
  | "follow_up_window"
  | "prep_due"
  | "response_window_closing"
  | "inactivity"
  | "decay";

export interface UrgencyEvent {
  subjectKey: string;
  label: string;
  kind: UrgencyKind;
  message: string; // "SoftDoes became 28 days overdue"
  severity: number; // for ordering; higher = more urgent
  daysOverdue?: number;
  daysUntil?: number;
}

/** An Overdue Center row (sorted by impact, then days overdue). */
export interface OverdueItem {
  subjectKey: string;
  label: string;
  kind: string;
  reason: string; // "Missed interview" | "Follow-up overdue" | "Meeting prep overdue"
  daysOverdue: number;
  expectedAction: string;
  recoveryProbability: number | null; // 0–1 estimate
  impactScore: number;
  impactBand: "high" | "medium" | "low";
}

/** An Upcoming Risk row — a predicted future transition, grouped by day offset. */
export interface UpcomingRiskItem {
  subjectKey: string;
  label: string;
  whenDays: number; // 0 = today, 1 = tomorrow, …
  whenLabel: string; // "Today" | "Tomorrow" | "In 2 days"
  prediction: string; // "Expected response window closes for Blake"
  action: string;
}
