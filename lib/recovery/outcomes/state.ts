// Meridian — Outcome Loop, relationship state derivation.
//
// Pure helpers that translate a continuity history into:
//   • a one-word RelationshipState (Dormant / Resurfacing / Reopened /
//     Deferred / Recently active) — for the muted state chip on the
//     Recovery Brief card
//   • a short list of deterministic continuity lines — what the
//     operator should read to feel that "this remembers"
//
// Both are derived deterministically from the recorded history and
// the per-card staleness fallback from the brief itself. There is no
// generated copy and no inference.

import {
  type RelationshipMovement,
  sortDescending,
} from "./continuity";
import {
  DEFERRED_OUTCOMES,
  type RelationshipOutcome,
} from "./types";

// Outcome → display label dictionary lives in components/outcomes/format.
// state.ts intentionally avoids the UI layer so it stays pure.
const OUTCOME_LINE_LABELS: Record<string, string> = {
  contacted: "contacted",
  no_response: "no response",
  follow_up_later: "follow up later",
  meeting_booked: "meeting booked",
  opportunity_reopened: "opportunity reopened",
  already_active: "already active",
  wrong_contact: "wrong contact",
  closed_won: "closed won",
  closed_lost: "closed lost",
  not_worth_pursuing: "not worth pursuing",
};

// ── Relationship state ──────────────────────────────────────────────

export type RelationshipState =
  | "dormant"
  | "resurfacing"
  | "reopened"
  | "deferred"
  | "recently_active";

export interface RelationshipStateInfo {
  state: RelationshipState;
  /** Title-cased label safe for a UI chip. */
  label: string;
}

const STATE_LABELS: Record<RelationshipState, string> = {
  dormant: "Dormant",
  resurfacing: "Resurfacing",
  reopened: "Reopened",
  deferred: "Deferred",
  recently_active: "Recently active",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic one-word state for the relationship. Precedence is
 * specific → general so the most informative tag wins:
 *
 *   1. reopened          — latest outcome is opportunity_reopened
 *   2. deferred          — latest outcome is a deferral
 *   3. resurfacing       — touched 2+ distinct times AND latest is touched
 *   4. recently_active   — last touch within 30 days
 *   5. dormant           — fallback (no record, or stale on every signal)
 */
export function deriveRelationshipState(
  movement: RelationshipMovement,
  now: Date = new Date(),
): RelationshipStateInfo {
  if (movement.lastOutcome === "opportunity_reopened") {
    return { state: "reopened", label: STATE_LABELS.reopened };
  }
  if (movement.lastOutcome && DEFERRED_OUTCOMES.includes(movement.lastOutcome)) {
    return { state: "deferred", label: STATE_LABELS.deferred };
  }
  if (movement.resurfacings >= 2 && movement.lastContactAt) {
    return { state: "resurfacing", label: STATE_LABELS.resurfacing };
  }
  if (movement.lastContactAt) {
    const daysAgo = (now.getTime() - Date.parse(movement.lastContactAt)) / DAY_MS;
    if (Number.isFinite(daysAgo) && daysAgo <= 30) {
      return { state: "recently_active", label: STATE_LABELS.recently_active };
    }
  }
  return { state: "dormant", label: STATE_LABELS.dormant };
}

// ── Continuity lines ────────────────────────────────────────────────

/**
 * Up to 3 short, plain-text continuity lines derived from the recorded
 * history. Returns [] when there is no recorded history and no fallback
 * staleness signal — the UI should render the section empty rather
 * than emit dead "no history yet" copy.
 *
 * Priority (capped at 3):
 *   1. "Last outreach: {outcome} · {short date}"
 *   2. "Resurfaced {n}× historically"      (when resurfacings >= 2)
 *   3. "Previously reopened after dormancy" (when an opportunity_reopened
 *      exists in history but isn't the latest entry)
 *   4. "Last meaningful touch: {n} days ago"  (fallback — only when
 *      there are no recorded outcomes and the brief still has a CSV
 *      staleness signal worth surfacing)
 */
export function buildContinuityLines(args: {
  movement: RelationshipMovement;
  history: readonly RelationshipOutcome[];
  /**
   * CSV-derived staleness from the brief item. Used as a fallback
   * when no outcomes have been recorded yet — so a never-touched
   * relationship still reads like a remembered one.
   */
  fallbackDaysSinceTouch?: number | null;
  now?: Date;
}): string[] {
  const { movement, history, fallbackDaysSinceTouch = null, now = new Date() } = args;
  const lines: string[] = [];

  if (movement.lastOutcome && movement.lastOutcomeAt) {
    const label = OUTCOME_LINE_LABELS[movement.lastOutcome] ?? movement.lastOutcome;
    lines.push(`Last outreach: ${label} · ${shortDate(movement.lastOutcomeAt, now)}`);
  }

  if (movement.resurfacings >= 2) {
    lines.push(`Resurfaced ${movement.resurfacings}× historically`);
  }

  if (
    movement.lastOutcome !== "opportunity_reopened"
    && hasOpportunityReopened(history)
  ) {
    lines.push("Previously reopened after dormancy");
  }

  if (
    lines.length === 0
    && typeof fallbackDaysSinceTouch === "number"
    && Number.isFinite(fallbackDaysSinceTouch)
    && fallbackDaysSinceTouch >= 0
  ) {
    lines.push(`Last meaningful touch: ${Math.round(fallbackDaysSinceTouch)} days ago`);
  }

  return lines.slice(0, 3);
}

function hasOpportunityReopened(history: readonly RelationshipOutcome[]): boolean {
  return sortDescending(history).some((o) => o.outcome === "opportunity_reopened");
}

function shortDate(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
