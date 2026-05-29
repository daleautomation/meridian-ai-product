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

/**
 * How a captured outcome shapes this contact's standing in *this*
 * week's priority list.
 *
 *   • `deprioritized` — visible but pushed to the bottom of the slice
 *     (e.g. no_response within the last 7 days)
 *   • `deferred`      — recorded but not shown (e.g. follow_up_later
 *     whose nextReviewAt has not yet arrived). This value never
 *     appears on a rendered priority — deferred contacts are filtered
 *     out of `priorities`. It exists in the type so the rule engine
 *     can be exhaustive and so audit tooling can describe what was
 *     filtered and why.
 *   • `resurfaced`    — was deferred, nextReviewAt has now arrived,
 *     contact is back on the list with that fact made explicit
 *   • `null`          — outcome history exists but did not influence
 *     this week's ranking
 */
export type OutcomeInfluence = "deprioritized" | "deferred" | "resurfaced" | null;

export interface WeeklyPriority {
  contactId: string;
  cardId: string;
  rank: number;
  name: string;
  company: string;
  /** Primary relationship-intelligence label for this contact. */
  relationshipLabel: string;
  /** @deprecated Retained for snapshot schema compat — not shown in UI. */
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
  /** How prior captured outcomes shaped this contact's standing this
   *  week. `null` when nothing relevant exists. */
  outcomeInfluence: OutcomeInfluence;
  /** Plain-language explanation of the influence — one short sentence,
   *  source-traceable to a real outcome record. Never AI-generated. */
  outcomeReason: string | null;
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
  followUpsDeferred: number;
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

// ── Outcome rule engine ────────────────────────────────────────────
// Every rule is deterministic, exhaustive, and source-traceable to a
// concrete OutcomeType. Same outcome history + same `now` → same
// decision, every call.

const NO_RESPONSE_DEPRIORITIZE_WINDOW_DAYS = 7;
const RESURFACE_REASON_WINDOW_DAYS = 14;

interface OutcomeDecision {
  /** Drop the contact from this week's priority slice entirely. */
  excluded: boolean;
  /** Why excluded — used only by audit tooling, not rendered. */
  excludeReason: string | null;
  influence: OutcomeInfluence;
  /** Operator-facing line; surfaced on the rendered priority. */
  reason: string | null;
}

function findLatestOutcomeRecord(
  outcomes: readonly RelationshipOutcome[],
  contactId: string,
): RelationshipOutcome | null {
  let latest: RelationshipOutcome | null = null;
  for (const o of outcomes) {
    if (o.leadKey !== contactId) continue;
    if (!latest || Date.parse(o.recordedAt) > Date.parse(latest.recordedAt)) {
      latest = o;
    }
  }
  return latest;
}

function formatDaysAgo(ageDays: number): string {
  if (ageDays <= 0) return "today";
  if (ageDays === 1) return "1 day ago";
  return `${ageDays} days ago`;
}

function formatIsoDate(iso: string): string {
  // Plain YYYY-MM-DD (UTC). No locale guessing, no fabricated time.
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Apply the deterministic outcome rules to one contact's outcome
 * history. Pure. Same input → same output every time.
 */
export function evaluateOutcomeInfluence(
  outcomes: readonly RelationshipOutcome[],
  contactId: string,
  now: Date,
): OutcomeDecision {
  const latest = findLatestOutcomeRecord(outcomes, contactId);
  if (!latest) {
    return { excluded: false, excludeReason: null, influence: null, reason: null };
  }

  switch (latest.outcome) {
    case "meeting_booked":
      return {
        excluded: true,
        excludeReason: "meeting_booked outcome captured — already in motion",
        influence: null,
        reason: null,
      };

    case "closed_won":
      return {
        excluded: true,
        excludeReason: "closed_won — archived from active priorities",
        influence: null,
        reason: null,
      };

    case "closed_lost":
      return {
        excluded: true,
        excludeReason: "closed_lost — archived from active priorities",
        influence: null,
        reason: null,
      };

    case "wrong_contact":
      return {
        excluded: true,
        excludeReason: "wrong_contact — suppressed from priority generation",
        influence: null,
        reason: null,
      };

    case "not_worth_pursuing":
      // Belongs in the same "operator said don't pursue" family as
      // wrong_contact. Suppressed, never deleted.
      return {
        excluded: true,
        excludeReason: "not_worth_pursuing — suppressed from priority generation",
        influence: null,
        reason: null,
      };

    case "follow_up_later": {
      const nextReviewAt = latest.nextReviewAt;
      if (nextReviewAt) {
        const reviewT = Date.parse(nextReviewAt);
        if (Number.isFinite(reviewT) && reviewT > now.getTime()) {
          // Defer: not yet eligible.
          return {
            excluded: true,
            excludeReason: `deferred until ${formatIsoDate(nextReviewAt)}`,
            influence: "deferred",
            reason: `Deferred until ${formatIsoDate(nextReviewAt)}.`,
          };
        }
        // Past the defer date.
        const daysSinceReview = Math.floor((now.getTime() - reviewT) / MS_PER_DAY);
        if (Number.isFinite(reviewT) && daysSinceReview <= RESURFACE_REASON_WINDOW_DAYS) {
          return {
            excluded: false,
            excludeReason: null,
            influence: "resurfaced",
            reason: `Returned from defer set for ${formatIsoDate(nextReviewAt)}.`,
          };
        }
      }
      // follow_up_later without a date, or long past the review date.
      // Allowed back into the list with no special reason.
      return { excluded: false, excludeReason: null, influence: null, reason: null };
    }

    case "no_response": {
      const ageDays = Math.floor((now.getTime() - Date.parse(latest.recordedAt)) / MS_PER_DAY);
      if (Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= NO_RESPONSE_DEPRIORITIZE_WINDOW_DAYS) {
        return {
          excluded: false,
          excludeReason: null,
          influence: "deprioritized",
          reason: `Deprioritized after no answer ${formatDaysAgo(ageDays)}.`,
        };
      }
      // Older than the window — no current effect.
      return { excluded: false, excludeReason: null, influence: null, reason: null };
    }

    case "contacted":
      // Neutral signal. The captured outcome surfaces in continuity
      // history (lastOperatorOutcome chip on the row) but does not
      // shape this week's ranking.
      return { excluded: false, excludeReason: null, influence: null, reason: null };

    case "opportunity_reopened":
    case "already_active":
      // No ranking effect today. Visible only in continuity history.
      return { excluded: false, excludeReason: null, influence: null, reason: null };
  }
  // Exhaustiveness — should never reach.
  return { excluded: false, excludeReason: null, influence: null, reason: null };
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

interface PriorityBuildResult {
  priority: WeeklyPriority;
  decision: OutcomeDecision;
}

function buildPriority(
  card: PersonalContactCard,
  contact: CrmContactRecord | undefined,
  outcomes: readonly RelationshipOutcome[],
  now: Date,
): PriorityBuildResult | null {
  if (!contact) return null;
  const opener = buildSuggestedOpenerFromContact(contact, { now });
  const recommendedChannel: WeeklyPriority["recommendedChannel"] = card.primaryChannel;
  const decision = evaluateOutcomeInfluence(outcomes, card.contactId, now);
  const priority: WeeklyPriority = {
    contactId: card.contactId,
    cardId: card.id,
    rank: card.rank,
    name: card.name,
    company: card.company,
    relationshipLabel: card.relationshipLabel,
    score: card.strengthRaw,
    suggestedOpener: opener.opener,
    openerSource: opener.openerSource,
    supportingEvidence: opener.supportingEvidence,
    trustLevel: opener.trustLevel,
    lastTouchSummary: buildLastTouchSummary(contact, now),
    recommendedChannel,
    lastOperatorOutcome: pickLastOperatorOutcome(outcomes, card.contactId, now),
    outcomeInfluence: decision.influence,
    outcomeReason: decision.reason,
  };
  return { priority, decision };
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
  let followUpsDeferred = 0;
  for (const outcome of outcomes) {
    const t = Date.parse(outcome.recordedAt);
    if (!Number.isFinite(t) || t < windowStart || t > windowEnd) continue;
    outcomesCaptured += 1;
    if (outcome.outcome === "meeting_booked") meetingsBooked += 1;
    if (outcome.outcome === "follow_up_later") followUpsDeferred += 1;
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
    followUpsDeferred,
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
 *
 * The candidate pool (`input.priorityCards`) may be wider than the
 * 8-priority slice we ultimately render — the rule engine needs
 * room to exclude meeting_booked / closed_* / wrong_contact / deferred
 * contacts and backfill from the rest of the rank-ordered list. The
 * generator passes the full ranked contact list; this function
 * applies the outcome rules and then slices to WEEKLY_PRIORITY_LIMIT.
 */
export function buildWeeklyState(input: BuildWeeklyStateInput): WeeklyState {
  const weekId = isoWeekId(input.now);

  // 1. Build a candidate priority for each input card (preserving
  //    input order, which is rank order). Skip candidates with no
  //    matching CRM record. Apply outcome decisions.
  const normalCandidates: WeeklyPriority[] = [];
  const deprioritizedCandidates: WeeklyPriority[] = [];
  for (const card of input.priorityCards) {
    const contact = input.contactsById.get(card.contactId);
    const built = buildPriority(card, contact, input.outcomes, input.now);
    if (!built) continue;
    if (built.decision.excluded) continue; // filter meeting_booked, closed_*, wrong_contact, deferred
    if (built.decision.influence === "deprioritized") {
      deprioritizedCandidates.push(built.priority);
    } else {
      normalCandidates.push(built.priority);
    }
    // Early-exit optimization: stop building candidates once we have
    // enough headroom to fill the slice. The order is stable so the
    // slice is deterministic.
    if (
      normalCandidates.length + deprioritizedCandidates.length >=
      WEEKLY_PRIORITY_LIMIT * 3
    ) {
      break;
    }
  }

  // 2. Concatenate: normal candidates first, then deprioritized
  //    candidates at the bottom of the slice (stable within each
  //    group, preserving input rank order). Slice to the limit.
  const slice = [...normalCandidates, ...deprioritizedCandidates].slice(
    0,
    WEEKLY_PRIORITY_LIMIT,
  );

  // 3. Renumber ranks 1..N in the order the slice will be displayed.
  //    The original `card.rank` came from the full personal-workspace
  //    ordering; here we want the rank to reflect this week's view.
  const priorities: WeeklyPriority[] = slice.map((p, idx) => ({
    ...p,
    rank: idx + 1,
  }));

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

// ── Overlay ────────────────────────────────────────────────────────

/**
 * Re-derive `lastOperatorOutcome` per priority and the weekly rollup
 * from the durable outcome store. The snapshot itself is frozen for
 * the week; this overlay layers fresh outcomes on top each time the
 * page renders, so a refresh persists captured state without ever
 * rewriting the snapshot file.
 *
 * Pure. Deterministic for any (state, outcomes, now) triple.
 */
export function applyOutcomesOverlay(
  state: WeeklyState,
  outcomes: readonly RelationshipOutcome[],
  now: Date,
): WeeklyState {
  const updatedPriorities = state.priorities.map((priority) => {
    const latest = pickLastOperatorOutcome(outcomes, priority.contactId, now);
    // Recompute influence/reason against the freshest outcome log so
    // mid-week captures land as visible reasoning on refresh.
    const decision = evaluateOutcomeInfluence(outcomes, priority.contactId, now);
    const unchanged =
      ((latest === null && priority.lastOperatorOutcome === null) ||
        (latest !== null &&
          priority.lastOperatorOutcome !== null &&
          latest.outcome === priority.lastOperatorOutcome.outcome &&
          latest.recordedAt === priority.lastOperatorOutcome.recordedAt)) &&
      decision.influence === priority.outcomeInfluence &&
      decision.reason === priority.outcomeReason;
    if (unchanged) return priority;
    return {
      ...priority,
      lastOperatorOutcome: latest,
      outcomeInfluence: decision.influence,
      outcomeReason: decision.reason,
    };
  });

  return {
    ...state,
    priorities: updatedPriorities,
    outcomeRollup: buildOutcomeRollup(outcomes, now),
  };
}
