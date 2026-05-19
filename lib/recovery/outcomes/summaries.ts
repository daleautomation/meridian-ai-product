// Meridian — Outcome Loop, summaries.
//
// Customer- and lead-scoped aggregations of the raw outcome log. These
// helpers compose the per-lead primitives in continuity.ts with simple
// counters so a brief / future UI hook can ask one question and get
// back a numbers-only report.
//
// Everything here is pure. No I/O, no formatting, no AI.

import {
  type OutcomeType,
  type RelationshipOutcome,
  isTerminalOutcome,
  isTouchedOutcome,
} from "./types";
import {
  type RelationshipMovement,
  relationshipMovementSummary,
  sortDescending,
} from "./continuity";

/**
 * Count of outcomes per OutcomeType. Every known OutcomeType appears
 * in the result with a count of 0 if absent — callers can render a
 * stable table without defensive checks.
 */
export type OutcomeCounts = Readonly<Record<OutcomeType, number>>;

const ZERO_COUNTS: OutcomeCounts = Object.freeze({
  contacted: 0,
  no_response: 0,
  follow_up_later: 0,
  meeting_booked: 0,
  opportunity_reopened: 0,
  already_active: 0,
  wrong_contact: 0,
  closed_won: 0,
  closed_lost: 0,
  not_worth_pursuing: 0,
});

function countByOutcome(outcomes: readonly RelationshipOutcome[]): OutcomeCounts {
  const counts = { ...ZERO_COUNTS } as Record<OutcomeType, number>;
  for (const o of outcomes) counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
  return counts as OutcomeCounts;
}

// ── Lead-scoped summary ─────────────────────────────────────────────

export interface LeadOutcomeSummary {
  leadKey: string;
  counts: OutcomeCounts;
  movement: RelationshipMovement;
  history: readonly RelationshipOutcome[]; // newest-first
}

export function summarizeLead(
  outcomes: readonly RelationshipOutcome[],
  leadKey: string,
): LeadOutcomeSummary {
  const scoped = outcomes.filter((o) => o.leadKey === leadKey);
  return {
    leadKey,
    counts: countByOutcome(scoped),
    movement: relationshipMovementSummary(scoped, leadKey),
    history: sortDescending(scoped),
  };
}

// ── Customer-scoped summary ─────────────────────────────────────────

export interface CustomerOutcomeSummary {
  totalOutcomes: number;
  uniqueLeads: number;
  counts: OutcomeCounts;
  /** Leads that have recorded at least one touched outcome. */
  touchedLeads: number;
  /** Leads whose most recent state is terminal and not re-opened. */
  closedLeads: number;
  /** Leads that have been surfaced more than once. */
  resurfacedLeads: number;
  /** ISO timestamp of the most recently recorded outcome overall, or null. */
  lastRecordedAt: string | null;
  /** ISO timestamp of the most recent touched outcome overall, or null. */
  lastTouchedAt: string | null;
}

export function summarizeCustomer(
  outcomes: readonly RelationshipOutcome[],
): CustomerOutcomeSummary {
  const counts = countByOutcome(outcomes);
  const byLead = new Map<string, RelationshipOutcome[]>();
  for (const o of outcomes) {
    const arr = byLead.get(o.leadKey);
    if (arr) arr.push(o);
    else byLead.set(o.leadKey, [o]);
  }

  let touchedLeads = 0;
  let closedLeads = 0;
  let resurfacedLeads = 0;
  for (const [leadKey, scoped] of byLead) {
    const movement = relationshipMovementSummary(scoped, leadKey);
    if (movement.lastContactAt) touchedLeads += 1;
    if (movement.closed) closedLeads += 1;
    if (movement.resurfacings > 1) resurfacedLeads += 1;
  }

  const desc = sortDescending(outcomes);
  const lastRecordedAt = desc[0]?.recordedAt ?? null;
  const lastTouchedAt = desc.find((o) => isTouchedOutcome(o.outcome))?.recordedAt ?? null;

  return {
    totalOutcomes: outcomes.length,
    uniqueLeads: byLead.size,
    counts,
    touchedLeads,
    closedLeads,
    resurfacedLeads,
    lastRecordedAt,
    lastTouchedAt,
  };
}

// ── Recent activity ─────────────────────────────────────────────────

/**
 * Most recent N outcomes across all leads, newest first. Used by future
 * "what happened this week" surfaces. Default limit is intentionally
 * small to keep call sites cheap.
 */
export function recentOutcomes(
  outcomes: readonly RelationshipOutcome[],
  limit = 20,
): RelationshipOutcome[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  return sortDescending(outcomes).slice(0, Math.floor(limit));
}

/**
 * Leads whose most recent state is terminal-and-not-reopened. Useful
 * for "what closed this week" rollups.
 */
export function closedLeadKeys(outcomes: readonly RelationshipOutcome[]): string[] {
  const byLead = new Map<string, RelationshipOutcome[]>();
  for (const o of outcomes) {
    const arr = byLead.get(o.leadKey);
    if (arr) arr.push(o);
    else byLead.set(o.leadKey, [o]);
  }
  const closed: string[] = [];
  for (const [leadKey, scoped] of byLead) {
    const movement = relationshipMovementSummary(scoped, leadKey);
    if (movement.closed && movement.lastOutcome && isTerminalOutcome(movement.lastOutcome)) {
      closed.push(leadKey);
    }
  }
  return closed.sort();
}

/**
 * Leads with at least one deferred outcome (`follow_up_later` /
 * `no_response`) whose nextReviewAt is on-or-before `asOfIso`. Used
 * for "due to revisit" surfaces.
 */
export function leadsDueForReview(
  outcomes: readonly RelationshipOutcome[],
  asOfIso: string,
): string[] {
  if (typeof asOfIso !== "string") return [];
  const asOf = Date.parse(asOfIso);
  if (!Number.isFinite(asOf)) return [];
  const due = new Set<string>();
  for (const o of outcomes) {
    if (!o.nextReviewAt) continue;
    const due_at = Date.parse(o.nextReviewAt);
    if (!Number.isFinite(due_at)) continue;
    if (due_at <= asOf) due.add(o.leadKey);
  }
  return [...due].sort();
}
