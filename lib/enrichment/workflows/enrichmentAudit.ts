// Meridian — Brookside targeted-enrichment audit record.
//
// Pure roll-up of the orchestrator's per-candidate decisions into a
// self-describing JSON artifact. Determinism rules:
//
//   • Outcomes are sorted by (rank, leadKey) ascending — same order as
//     the queue produced.
//   • All counts are integer derivations of the outcome list.
//   • No `Date.now()`, no timestamps beyond the runner-supplied `nowIso`.
//
// The audit is the only file the runner writes alongside the ledger.
// Downstream consumers (a future "wire enriched signals back into the
// next brief" step) read it directly.

import type { RecoverySignal } from "@/lib/recovery/signals/types";

import {
  ENRICHMENT_SKIP_REASONS,
  type EnrichmentPolicy,
  type EnrichmentSkipReason,
} from "./enrichmentPolicy";

export type EnrichmentResult = "enriched" | "skipped" | "failed";

export type EnrichmentMatchType = "parcel_id" | "address";
export type EnrichmentMatchConfidence = "HIGH" | "MED";

/** One audit row per brief opportunity considered in this run. */
export interface EnrichmentOutcome {
  rank: number;
  leadKey: string;
  companyName: string;
  propertyKey: string | null;
  result: EnrichmentResult;

  /** Set when result === "skipped". */
  skipReason?: EnrichmentSkipReason;
  /** Set when result === "failed" — reserved for unexpected errors only. */
  failureReason?: string;

  /** Set when the match step ran. */
  matchType?: EnrichmentMatchType | null;
  matchConfidence?: EnrichmentMatchConfidence | null;

  /** Public-record provenance triple, copied verbatim onto the audit. */
  evidence?: {
    source: string;
    recordId: string;
    observedAt: string;
    evidenceUrl: string | null;
  } | null;

  /** Signals produced by this enrichment, embedded so the audit is a feed. */
  signals: readonly RecoverySignal[];

  /** Free-text detail surfaced for operator review. */
  detail?: string;
}

export interface EnrichmentAuditSummary {
  totalCandidates: number;
  enqueued: number;
  enriched: number;
  skipped: number;
  failed: number;
  byReason: Record<EnrichmentSkipReason, number>;
}

export interface EnrichmentAudit {
  customer: string;
  generatedAt: string;
  briefSource: string;
  publicRecordSource: string | null;
  policy: EnrichmentPolicy;
  summary: EnrichmentAuditSummary;
  outcomes: EnrichmentOutcome[];
}

function emptyByReason(): Record<EnrichmentSkipReason, number> {
  const out = {} as Record<EnrichmentSkipReason, number>;
  for (const code of ENRICHMENT_SKIP_REASONS) out[code] = 0;
  return out;
}

/** Compute the audit summary from a sorted outcome list. Pure. */
export function summarizeOutcomes(
  outcomes: readonly EnrichmentOutcome[],
  enqueuedCount: number,
): EnrichmentAuditSummary {
  const byReason = emptyByReason();
  let enriched = 0;
  let skipped = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.result === "enriched") enriched += 1;
    else if (o.result === "failed") failed += 1;
    else {
      skipped += 1;
      if (o.skipReason) byReason[o.skipReason] += 1;
    }
  }
  return {
    totalCandidates: outcomes.length,
    enqueued: enqueuedCount,
    enriched,
    skipped,
    failed,
    byReason,
  };
}

/** Sort outcomes deterministically: rank ascending, leadKey tiebreak. */
export function sortOutcomes(
  outcomes: readonly EnrichmentOutcome[],
): EnrichmentOutcome[] {
  return [...outcomes].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.leadKey < b.leadKey ? -1 : a.leadKey > b.leadKey ? 1 : 0;
  });
}

/** Assemble the final audit. Same inputs → byte-identical output. */
export function buildAudit(input: {
  customer: string;
  generatedAt: string;
  briefSource: string;
  publicRecordSource: string | null;
  policy: EnrichmentPolicy;
  outcomes: readonly EnrichmentOutcome[];
  enqueuedCount: number;
}): EnrichmentAudit {
  const sorted = sortOutcomes(input.outcomes);
  return {
    customer: input.customer,
    generatedAt: input.generatedAt,
    briefSource: input.briefSource,
    publicRecordSource: input.publicRecordSource,
    policy: input.policy,
    summary: summarizeOutcomes(sorted, input.enqueuedCount),
    outcomes: sorted,
  };
}
