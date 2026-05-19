// Meridian — Outcome Loop, continuity primitives.
//
// Pure functions that operate on RelationshipOutcome[] and produce
// deterministic continuity facts about a relationship: when it was
// last touched, how many times it has been resurfaced, whether it is
// on a positive movement streak, etc.
//
// No I/O, no time-of-day heuristics, no hidden weights. Everything
// here is derivable from the recorded history alone.

import {
  type OutcomeType,
  type RelationshipOutcome,
  isPositiveOutcome,
  isTerminalOutcome,
  isTouchedOutcome,
} from "./types";

// ── Sorting helpers ─────────────────────────────────────────────────

/**
 * Stable chronological sort, oldest → newest. Falls back to id for
 * deterministic ordering when two outcomes share a recordedAt
 * (e.g. importer back-fill).
 */
export function sortAscending(outcomes: readonly RelationshipOutcome[]): RelationshipOutcome[] {
  return [...outcomes].sort((a, b) => {
    if (a.recordedAt !== b.recordedAt) {
      return a.recordedAt < b.recordedAt ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Stable chronological sort, newest → oldest.
 */
export function sortDescending(outcomes: readonly RelationshipOutcome[]): RelationshipOutcome[] {
  return sortAscending(outcomes).reverse();
}

// ── Per-lead facts ──────────────────────────────────────────────────

/**
 * The most recent outcome recorded for this leadKey, or null if there
 * is no history.
 */
export function latestOutcome(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): RelationshipOutcome | null {
  const scoped = sortDescending(outcomes.filter((o) => o.leadKey === leadKey));
  return scoped[0] ?? null;
}

/**
 * The most recent ISO timestamp at which the relationship was actually
 * touched (per TOUCHED_OUTCOMES). Returns null if the relationship has
 * never been touched, even if it has logged deferrals or terminal
 * decisions.
 */
export function lastContactAt(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): string | null {
  const scoped = sortDescending(
    outcomes.filter((o) => o.leadKey === leadKey && isTouchedOutcome(o.outcome)),
  );
  return scoped[0]?.recordedAt ?? null;
}

/**
 * How many distinct resurfacing cycles this relationship has been
 * through. A cycle is one chronological run that starts with a touched
 * outcome and ends either at the next touched outcome (boundary) or at
 * a terminal outcome.
 *
 * Concretely: contacted → no_response → no_response → contacted counts
 * as TWO resurfacings (two distinct touched events). A single chain
 * with no touched events at all counts as zero resurfacings.
 */
export function resurfacingCount(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): number {
  return sortAscending(outcomes.filter((o) => o.leadKey === leadKey)).reduce(
    (n, o) => (isTouchedOutcome(o.outcome) ? n + 1 : n),
    0,
  );
}

/**
 * The current run of consecutive positive outcomes ending at the most
 * recent outcome. A non-positive outcome (terminal, deferral, etc.)
 * breaks the streak immediately.
 *
 * Returns 0 when there is no history or when the most recent outcome
 * is non-positive.
 */
export function continuityStreak(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): number {
  const desc = sortDescending(outcomes.filter((o) => o.leadKey === leadKey));
  let streak = 0;
  for (const o of desc) {
    if (isPositiveOutcome(o.outcome)) streak += 1;
    else break;
  }
  return streak;
}

/**
 * True when the relationship has ever recorded a terminal outcome and
 * has not been re-opened by a subsequent positive outcome. A terminal
 * outcome can still be "unlocked" by a later opportunity_reopened —
 * this is the only path back to active status.
 */
export function isClosed(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): boolean {
  const desc = sortDescending(outcomes.filter((o) => o.leadKey === leadKey));
  for (const o of desc) {
    if (o.outcome === "opportunity_reopened") return false;
    if (isTerminalOutcome(o.outcome)) return true;
  }
  return false;
}

// ── Composed snapshot ───────────────────────────────────────────────

/**
 * One small struct that bundles the deterministic facts above. Surfaces
 * that need a quick "where is this relationship?" read should pull
 * this struct rather than calling the primitives individually.
 */
export interface RelationshipMovement {
  leadKey: string;
  totalOutcomes: number;
  resurfacings: number;
  streak: number;
  lastOutcome: OutcomeType | null;
  lastOutcomeAt: string | null;
  lastContactAt: string | null;
  closed: boolean;
}

export function relationshipMovementSummary(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): RelationshipMovement {
  const scoped = outcomes.filter((o) => o.leadKey === leadKey);
  const latest = latestOutcome(scoped, leadKey);
  return {
    leadKey,
    totalOutcomes: scoped.length,
    resurfacings: resurfacingCount(scoped, leadKey),
    streak: continuityStreak(scoped, leadKey),
    lastOutcome: latest?.outcome ?? null,
    lastOutcomeAt: latest?.recordedAt ?? null,
    lastContactAt: lastContactAt(scoped, leadKey),
    closed: isClosed(scoped, leadKey),
  };
}
