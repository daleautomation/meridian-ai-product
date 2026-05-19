// Meridian — Outcome Loop, write/read API.
//
// The store is the only surface that callers (API routes, scripts,
// future operator UI hooks) should depend on. It owns:
//   • generating the stable id + recordedAt
//   • validating the payload against the OutcomeType / OutcomeSource sets
//   • appending via persistence.ts (which handles atomic IO + locks)
//
// Reads are unfiltered passes through persistence with a single optional
// lead-key filter so callers don't reach for filtering ergonomics.

import { randomUUID } from "node:crypto";

import {
  appendCustomerOutcome,
  readCustomerOutcomes,
} from "./persistence";
import {
  type OutcomeSource,
  type OutcomeType,
  type RelationshipOutcome,
  isOutcomeSource,
  isOutcomeType,
} from "./types";

/**
 * The shape callers pass into recordOutcome. The store fills in id +
 * recordedAt so two writes with identical payloads still produce two
 * distinct, time-ordered entries in the continuity history.
 */
export interface RecordOutcomeInput {
  leadKey: string;
  outcome: OutcomeType;
  source: OutcomeSource;
  note?: string;
  nextReviewAt?: string;
  operator?: string;
  staleScoreAtTime?: number;
  decisionBucketAtTime?: string;
  /**
   * Optional explicit recordedAt. Used by importer scripts that
   * back-fill historical entries. Defaults to "now" when absent.
   */
  recordedAt?: string;
  /**
   * Optional explicit id (importers). Defaults to a fresh UUID.
   */
  id?: string;
}

/**
 * Append one outcome to the customer's continuity log and return the
 * fully-formed record that was written. Throws if the payload is
 * malformed; the persistence layer throws on disk failure.
 */
export async function recordOutcome(
  customer: string,
  input: RecordOutcomeInput,
): Promise<RelationshipOutcome> {
  if (typeof input.leadKey !== "string" || input.leadKey.length === 0) {
    throw new Error("recordOutcome: leadKey is required");
  }
  if (!isOutcomeType(input.outcome)) {
    throw new Error(`recordOutcome: unknown outcome "${String(input.outcome)}"`);
  }
  if (!isOutcomeSource(input.source)) {
    throw new Error(`recordOutcome: unknown source "${String(input.source)}"`);
  }
  if (input.nextReviewAt !== undefined && !isIsoString(input.nextReviewAt)) {
    throw new Error("recordOutcome: nextReviewAt must be an ISO-8601 string");
  }
  if (input.recordedAt !== undefined && !isIsoString(input.recordedAt)) {
    throw new Error("recordOutcome: recordedAt must be an ISO-8601 string");
  }
  if (
    input.staleScoreAtTime !== undefined
    && (typeof input.staleScoreAtTime !== "number" || !Number.isFinite(input.staleScoreAtTime))
  ) {
    throw new Error("recordOutcome: staleScoreAtTime must be a finite number");
  }

  const record: RelationshipOutcome = {
    id: input.id ?? randomUUID(),
    leadKey: input.leadKey,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    outcome: input.outcome,
    source: input.source,
    ...(input.note !== undefined ? { note: input.note } : null),
    ...(input.nextReviewAt !== undefined ? { nextReviewAt: input.nextReviewAt } : null),
    ...(input.operator !== undefined ? { operator: input.operator } : null),
    ...(input.staleScoreAtTime !== undefined ? { staleScoreAtTime: input.staleScoreAtTime } : null),
    ...(input.decisionBucketAtTime !== undefined
      ? { decisionBucketAtTime: input.decisionBucketAtTime }
      : null),
  };

  await appendCustomerOutcome(customer, record);
  return record;
}

/**
 * Read every outcome ever recorded for this customer, optionally
 * scoped to one leadKey. Records are returned in append order;
 * downstream summarizers sort by recordedAt where chronology matters.
 */
export async function listOutcomesFor(
  customer: string,
  leadKey?: string,
): Promise<RelationshipOutcome[]> {
  const all = await readCustomerOutcomes(customer);
  if (!leadKey) return all;
  return all.filter((o) => o.leadKey === leadKey);
}

function isIsoString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}
