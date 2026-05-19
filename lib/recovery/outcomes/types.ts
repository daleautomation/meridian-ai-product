// Meridian — Outcome Loop, type layer.
//
// This module defines the shape of a single recorded RelationshipOutcome
// and the deterministic classifications that the continuity helpers
// (continuity.ts / summaries.ts) read from. There are no enums, no
// derived state, no AI: every value here is observable and source-
// traceable to an operator action.

/**
 * The closed set of outcome categories Meridian records when a
 * relationship has received attention.
 *
 * The set is intentionally small. New categories require a docs/
 * principles update because every category becomes a fork in the
 * continuity history forever.
 */
export type OutcomeType =
  | "contacted"
  | "no_response"
  | "follow_up_later"
  | "meeting_booked"
  | "opportunity_reopened"
  | "already_active"
  | "wrong_contact"
  | "closed_won"
  | "closed_lost"
  | "not_worth_pursuing";

/**
 * Where the outcome was recorded from. Used to source-trace continuity
 * entries back to a surface (so a "closed_won" recorded from a brief
 * download flow is distinguishable from one recorded by an operator).
 */
export type OutcomeSource =
  | "recovery_brief"
  | "operator_console"
  | "manual";

/**
 * Canonical, append-only record. Every field is captured once at write
 * time and never edited. Schema migrations append new fields with
 * narrow optionality — they never rewrite history.
 */
export interface RelationshipOutcome {
  /** Stable id, generated at record time. */
  id: string;
  /** Canonical lead key (matches the rest of the platform's lead identity). */
  leadKey: string;
  /** ISO-8601 UTC instant of when the outcome was recorded. */
  recordedAt: string;
  outcome: OutcomeType;
  /** Free-text operator note. Optional. Never AI-generated. */
  note?: string;
  /** Operator-supplied next review instant (ISO). Optional. */
  nextReviewAt?: string;
  /** Operator identifier (email / handle / system actor name). Optional. */
  operator?: string;
  source: OutcomeSource;
  /** Snapshot of the staleness score at write time, for longitudinal analysis. */
  staleScoreAtTime?: number;
  /** Snapshot of the decision bucket at write time. */
  decisionBucketAtTime?: string;
}

// ── Deterministic classifications ───────────────────────────────────
//
// These are pure data: which OutcomeType values count as terminal,
// which as "touched but unresolved", which as forward-movement. Any
// continuity / summary helper that needs to ask "did this outcome mean
// the relationship moved?" reads from these sets — never from heuristics.

/**
 * Outcomes that represent a real touch on the relationship — i.e. the
 * operator and the contact interacted (or the operator attempted and
 * recorded the attempt) on this date.
 */
export const TOUCHED_OUTCOMES: readonly OutcomeType[] = [
  "contacted",
  "no_response",
  "meeting_booked",
  "opportunity_reopened",
  "wrong_contact",
] as const;

/**
 * Outcomes that move the relationship forward commercially.
 */
export const POSITIVE_OUTCOMES: readonly OutcomeType[] = [
  "contacted",
  "meeting_booked",
  "opportunity_reopened",
] as const;

/**
 * Outcomes that close the loop on this relationship: no further
 * resurfacing should be attempted unless the operator explicitly
 * re-opens the relationship in a future cycle.
 */
export const TERMINAL_OUTCOMES: readonly OutcomeType[] = [
  "closed_won",
  "closed_lost",
  "not_worth_pursuing",
  "already_active",
] as const;

/**
 * Outcomes that explicitly request a future review — the operator
 * promised themselves they would come back to this relationship.
 */
export const DEFERRED_OUTCOMES: readonly OutcomeType[] = [
  "follow_up_later",
  "no_response",
] as const;

// ── Type guards ─────────────────────────────────────────────────────

const OUTCOME_TYPE_SET: ReadonlySet<OutcomeType> = new Set<OutcomeType>([
  "contacted",
  "no_response",
  "follow_up_later",
  "meeting_booked",
  "opportunity_reopened",
  "already_active",
  "wrong_contact",
  "closed_won",
  "closed_lost",
  "not_worth_pursuing",
]);

export function isOutcomeType(value: unknown): value is OutcomeType {
  return typeof value === "string" && OUTCOME_TYPE_SET.has(value as OutcomeType);
}

const OUTCOME_SOURCE_SET: ReadonlySet<OutcomeSource> = new Set<OutcomeSource>([
  "recovery_brief",
  "operator_console",
  "manual",
]);

export function isOutcomeSource(value: unknown): value is OutcomeSource {
  return typeof value === "string" && OUTCOME_SOURCE_SET.has(value as OutcomeSource);
}

export function isTouchedOutcome(type: OutcomeType): boolean {
  return TOUCHED_OUTCOMES.includes(type);
}

export function isPositiveOutcome(type: OutcomeType): boolean {
  return POSITIVE_OUTCOMES.includes(type);
}

export function isTerminalOutcome(type: OutcomeType): boolean {
  return TERMINAL_OUTCOMES.includes(type);
}

export function isDeferredOutcome(type: OutcomeType): boolean {
  return DEFERRED_OUTCOMES.includes(type);
}
