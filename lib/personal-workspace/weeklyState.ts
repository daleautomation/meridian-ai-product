// Meridian — pure weekly-state builder.
//
// One snapshot per (customer × ISO week). Deterministic. Same input →
// same output. The /personal workspace loads this snapshot as its
// Monday anchor; if no snapshot exists, the workspace falls back to
// live computation.
//
// Strict rules:
//   • Pure function. No randomness. No `Date.now()` — `now` is injected.
//   • No AI generation. No LLM call.
//   • No fabricated continuity insight — when the workspace has no prior
//     captured outcomes, the insight says so honestly.
//   • Every priority card carries source-cited evidence via the
//     deterministic opener builder.

import type { CrmContactRecord } from "@/lib/crm-import/types";
import type { RelationshipOutcome } from "@/lib/recovery/outcomes/types";
import {
  buildSuggestedOpenerFromContact,
  type OpenerSource,
  type OpenerTrust,
} from "./openerBuilder";
import type { PersonalContactCard } from "./workspace";

// ── Public types ───────────────────────────────────────────────────

export type WeeklyMode = "monday" | "midweek" | "friday";

export interface WeeklyPriority {
  contactId: string;
  cardId: string;
  rank: number;
  name: string;
  company: string;
  score: number;
  suggestedOpener: string;
  openerSource: OpenerSource;
  supportingEvidence: string;
  trustLevel: OpenerTrust;
  lastTouchSummary: string;
  recommendedChannel: "email" | "phone" | "none";
  lastOperatorOutcome: {
    outcome: string;
    recordedAt: string;
    ageDays: number;
  } | null;
}

export interface ResurfacedRelationship {
  contactId: string;
  name: string;
  reason: string;
  evidence: string;
  monthsQuiet: number | null;
}

export interface WeeklyOutcomeRollup {
  outcomesCaptured: number;
  meetingsBooked: number;
  deprioritized: number;
  windowStart: string;
  windowEnd: string;
}

export interface ContinuityInsight {
  kind: "honest_cold_start" | "outcome_driven";
  text: string;
  citedContactIds: readonly string[];
}

export interface WeeklyState {
  schemaVersion: 1;
  workspaceSlug: string;
  weekId: string;
  generatedAt: string;
  priorities: WeeklyPriority[];
  resurfacedRelationship: ResurfacedRelationship | null;
  continuityInsight: ContinuityInsight;
  outcomeRollup: WeeklyOutcomeRollup;
  activationEmail: {
    subject: string;
    body: string;
  };
}

export interface BuildWeeklyStateInput {
  workspaceSlug: string;
  workspaceDisplayName: string;
  workspaceUrl: string;
  /** Live-computed priority cards. Pre-built so the snapshot uses the
   *  same rank/score the workspace would. */
  priorityCards: readonly PersonalContactCard[];
  /** CRM rows keyed by contactId, for opener regeneration. */
  contactsById: ReadonlyMap<string, CrmContactRecord>;
  /** All outcomes captured for this customer to date. May be empty. */
  outcomes: readonly RelationshipOutcome[];
  /** Resurfacing buckets — used to pick the single resurfaced contact. */
  resurfacingHighlight: {
    contactId: string;
    name: string;
    bucketLabel: string;
    whyNow: string;
  } | null;
  /** The Sunday-evening generation instant. Determines weekId. */
  now: Date;
}

// ── Constants ──────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKLY_PRIORITY_LIMIT = 8;
const PRIOR_WEEK_WINDOW_DAYS = 7;

// ── Helpers ────────────────────────────────────────────────────────

/**
 * ISO week id, e.g. "2026-W22". Uses UTC; same instant → same id on
 * any host. Pure.
 */
export function isoWeekId(instant: Date): string {
  const d = new Date(Date.UTC(
    instant.getUTCFullYear(),
    instant.getUTCMonth(),
    instant.getUTCDate(),
  ));
  // Shift to Thursday in current week (ISO week numbering).
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * The display mode of the briefing panel based on the operator's
 * current local-ish weekday relative to UTC. Monday/Tuesday = monday
 * mode; Wednesday/Thursday = midweek; Friday/Saturday/Sunday = friday.
 */
export function resolveWeeklyMode(now: Date): WeeklyMode {
  const day = now.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  if (day === 1 || day === 2) return "monday";
  if (day === 3 || day === 4) return "midweek";
  return "friday";
}

function daysBetween(thenIso: string, now: Date): number {
  const then = Date.parse(thenIso);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / MS_PER_DAY));
}

function monthsBetween(thenIso: string | null, now: Date): number | null {
  if (!thenIso) return null;
  const then = Date.parse(thenIso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / MS_PER_DAY / 30));
}

function buildLastTouchSummary(contact: CrmContactRecord, now: Date): string {
  const months = monthsBetween(contact.lastInteractionAt, now);
  if (months === null) return "No recorded interaction on file";
  if (months === 0) return "Touched within the last month";
  if (months < 12) return `${months} months since last touch`;
  const years = Math.floor(months / 12);
  return years === 1 ? "Over a year since last touch" : `Over ${years} years since last touch`;
}

function pickLastOperatorOutcome(
  outcomes: readonly RelationshipOutcome[],
  contactId: string,
  now: Date,
): WeeklyPriority["lastOperatorOutcome"] {
  // Outcomes are leadKey-scoped. Our PersonalContactCard.contactId
  // is the internal CRM contact id; treat it as the leadKey for the
  // workspace pipeline (existing convention).
  const matches = outcomes.filter((o) => o.leadKey === contactId);
  if (matches.length === 0) return null;
  const latest = matches.reduce((acc, cur) =>
    Date.parse(cur.recordedAt) > Date.parse(acc.recordedAt) ? cur : acc,
  );
  return {
    outcome: latest.outcome,
    recordedAt: latest.recordedAt,
    ageDays: daysBetween(latest.recordedAt, now),
  };
}

function buildPriority(
  card: PersonalContactCard,
  contact: CrmContactRecord | undefined,
  outcomes: readonly RelationshipOutcome[],
  now: Date,
): WeeklyPriority | null {
  if (!contact) return null;
  const opener = buildSuggestedOpenerFromContact(contact, { now });
  const recommendedChannel: WeeklyPriority["recommendedChannel"] =
    card.primaryChannel;
  return {
    contactId: card.contactId,
    cardId: card.id,
    rank: card.rank,
    name: card.name,
    company: card.company,
    score: card.strengthRaw,
    suggestedOpener: opener.opener,
    openerSource: opener.openerSource,
    supportingEvidence: opener.supportingEvidence,
    trustLevel: opener.trustLevel,
    lastTouchSummary: buildLastTouchSummary(contact, now),
    recommendedChannel,
    lastOperatorOutcome: pickLastOperatorOutcome(outcomes, card.contactId, now),
  };
}

function buildResurfacedRelationship(
  input: BuildWeeklyStateInput,
): ResurfacedRelationship | null {
  const highlight = input.resurfacingHighlight;
  if (!highlight) return null;
  const contact = input.contactsById.get(highlight.contactId);
  if (!contact) return null;
  const opener = buildSuggestedOpenerFromContact(contact, { now: input.now });
  const months = monthsBetween(contact.lastInteractionAt, input.now);
  return {
    contactId: highlight.contactId,
    name: highlight.name,
    reason: highlight.whyNow,
    evidence: opener.supportingEvidence,
    monthsQuiet: months,
  };
}

function buildOutcomeRollup(
  outcomes: readonly RelationshipOutcome[],
  now: Date,
): WeeklyOutcomeRollup {
  const windowEnd = now.getTime();
  const windowStart = windowEnd - PRIOR_WEEK_WINDOW_DAYS * MS_PER_DAY;
  let outcomesCaptured = 0;
  let meetingsBooked = 0;
  let deprioritized = 0;
  for (const outcome of outcomes) {
    const t = Date.parse(outcome.recordedAt);
    if (!Number.isFinite(t) || t < windowStart || t > windowEnd) continue;
    outcomesCaptured += 1;
    if (outcome.outcome === "meeting_booked") meetingsBooked += 1;
    if (
      outcome.outcome === "no_response" ||
      outcome.outcome === "not_worth_pursuing" ||
      outcome.outcome === "wrong_contact"
    ) {
      deprioritized += 1;
    }
  }
  return {
    outcomesCaptured,
    meetingsBooked,
    deprioritized,
    windowStart: new Date(windowStart).toISOString(),
    windowEnd: new Date(windowEnd).toISOString(),
  };
}

function buildContinuityInsight(
  input: BuildWeeklyStateInput,
  rollup: WeeklyOutcomeRollup,
  priorities: readonly WeeklyPriority[],
): ContinuityInsight {
  // Honest cold start: no captured outcomes anywhere yet.
  if (input.outcomes.length === 0) {
    return {
      kind: "honest_cold_start",
      text: "Continuity insights begin after your first week of captured outcomes.",
      citedContactIds: [],
    };
  }

  // Outcome-driven insight: name how many last-week outcomes are
  // reshaping this week's priorities. Cite specific contact ids; never
  // invent narrative beyond what the captured data supports.
  const reshaping = priorities.filter((p) => {
    if (!p.lastOperatorOutcome) return false;
    return p.lastOperatorOutcome.ageDays <= PRIOR_WEEK_WINDOW_DAYS;
  });

  if (reshaping.length === 0) {
    return {
      kind: "outcome_driven",
      text: `${input.outcomes.length} outcomes captured to date. None from the past 7 days shape this week's priorities.`,
      citedContactIds: [],
    };
  }

  const namedList = reshaping
    .slice(0, 3)
    .map((p) => p.name.split(/\s+/)[0])
    .filter(Boolean)
    .join(", ");

  return {
    kind: "outcome_driven",
    text:
      reshaping.length === 1
        ? `Last week you captured 1 outcome for ${namedList}. It shapes this week's priorities.`
        : `Last week you captured ${rollup.outcomesCaptured} outcomes. ${reshaping.length} of them (${namedList}) shape this week's priorities.`,
    citedContactIds: reshaping.map((p) => p.contactId),
  };
}

function buildActivationEmail(
  input: BuildWeeklyStateInput,
  priorities: readonly WeeklyPriority[],
  resurface: ResurfacedRelationship | null,
  insight: ContinuityInsight,
  weekId: string,
): WeeklyState["activationEmail"] {
  const lines: string[] = [];
  lines.push(`Your Meridian workspace is ready for ${weekId}.`);
  lines.push("");
  if (priorities.length === 0) {
    lines.push(
      "No priority relationships are queued this week — your workspace is quiet. Open it when you'd like to review the broader list.",
    );
  } else if (resurface) {
    const ageHint =
      resurface.monthsQuiet !== null
        ? `${resurface.monthsQuiet} months quiet`
        : "quiet on file";
    lines.push(
      `${priorities.length} priority relationships queued. Top resurface: ${resurface.name} — ${ageHint}.`,
    );
  } else {
    lines.push(`${priorities.length} priority relationships queued.`);
  }
  if (insight.kind === "outcome_driven" && insight.citedContactIds.length > 0) {
    lines.push("");
    lines.push(insight.text);
  } else if (insight.kind === "honest_cold_start") {
    lines.push("");
    lines.push(insight.text);
  }
  lines.push("");
  lines.push("Open workspace:");
  lines.push(input.workspaceUrl);

  return {
    subject: `Your Meridian workspace is ready for this week`,
    body: lines.join("\n"),
  };
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Build the weekly snapshot. Pure. Deterministic.
 */
export function buildWeeklyState(input: BuildWeeklyStateInput): WeeklyState {
  const weekId = isoWeekId(input.now);

  const priorities: WeeklyPriority[] = [];
  for (const card of input.priorityCards.slice(0, WEEKLY_PRIORITY_LIMIT)) {
    const contact = input.contactsById.get(card.contactId);
    const priority = buildPriority(card, contact, input.outcomes, input.now);
    if (priority) priorities.push(priority);
  }

  const resurfacedRelationship = buildResurfacedRelationship(input);
  const outcomeRollup = buildOutcomeRollup(input.outcomes, input.now);
  const continuityInsight = buildContinuityInsight(input, outcomeRollup, priorities);
  const activationEmail = buildActivationEmail(
    input,
    priorities,
    resurfacedRelationship,
    continuityInsight,
    weekId,
  );

  return {
    schemaVersion: 1,
    workspaceSlug: input.workspaceSlug,
    weekId,
    generatedAt: input.now.toISOString(),
    priorities,
    resurfacedRelationship,
    continuityInsight,
    outcomeRollup,
    activationEmail,
  };
}
