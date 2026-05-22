// Meridian — Brookside targeted-enrichment orchestrator.
//
// Pure, deterministic. Composes the queue + the public-record matcher +
// the seller-timing signal builders + the audit producer into one
// function:
//
//     runTargetedEnrichment(input) → { audit, nextLedger }
//
// The runner script (`scripts/run-targeted-enrichment.ts`) owns all I/O.
// This file does no fs / http / random / Date.now() — pass `nowIso` in.

import {
  buildPropertyEnrichmentSignals,
} from "@/lib/enrichment/brookside";
import type { FieldProvenance } from "@/lib/enrichment/property/types";
import {
  combineEnrichmentWithPublicRecord,
  lookupMatch,
  type ParcelIndex,
  type ParcelMatch,
} from "@/lib/enrichment/public-records";
import type { RecoveryBrief } from "@/lib/recovery/brief";
import type {
  RecoverySignal,
  WorkspaceSignalConfig,
} from "@/lib/recovery/signals/types";

import {
  buildAudit,
  type EnrichmentAudit,
  type EnrichmentOutcome,
} from "./enrichmentAudit";
import {
  ledgerWithEnrichment,
  type EnrichmentLedger,
  type EnrichmentPolicy,
} from "./enrichmentPolicy";
import {
  buildEnrichmentQueue,
  candidateFromBriefItem,
  type QueueCandidate,
  type QueueDecision,
} from "./enrichmentQueue";

export interface TargetedEnrichmentInput {
  customer: string;
  /** Already-loaded brief JSON. */
  brief: RecoveryBrief;
  /** Source description for audit traceability (e.g. relative file path). */
  briefSource: string;
  /** Built once per run by the caller from a public-records CSV. */
  publicRecordIndex: ParcelIndex | null;
  /** Description for audit traceability. Null when no source was provided. */
  publicRecordSource: string | null;
  /** Workspace config (for mapping seller-timing → RecoverySignal). */
  workspaceConfig: WorkspaceSignalConfig;
  /** Ledger loaded from disk; the orchestrator returns the next ledger. */
  ledger: EnrichmentLedger;
  /** Run policy (cap, recency window, etc). */
  policy: EnrichmentPolicy;
  /** Reference instant for recency checks + audit `generatedAt`. */
  nowIso: string;
}

export interface TargetedEnrichmentResult {
  audit: EnrichmentAudit;
  /** Updated ledger reflecting every leadKey that was successfully enriched. */
  nextLedger: EnrichmentLedger;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysAgoIso(nowIso: string, days: number | null): string | null {
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) return null;
  const t = Date.parse(nowIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t - days * MS_PER_DAY).toISOString();
}

function copyEvidence(
  prov: FieldProvenance | undefined,
): EnrichmentOutcome["evidence"] {
  if (!prov) return null;
  return {
    source: prov.source,
    recordId: prov.recordId,
    observedAt: prov.observedAt,
    evidenceUrl: prov.evidenceUrl ?? null,
  };
}

function buildSignalsForCandidate(args: {
  candidate: QueueCandidate;
  match: ParcelMatch;
  workspaceConfig: WorkspaceSignalConfig;
  nowIso: string;
}): RecoverySignal[] {
  const staleTouch = daysAgoIso(args.nowIso, args.candidate.daysSinceTouch);

  // Synthesize a base PropertyEnrichmentInput from the candidate-only side
  // so the public record can be merged via the standard combiner. The
  // candidate carries no recorder-backed ownership, so this base is
  // intentionally minimal — the combiner pulls authoritative ownership
  // out of the public record.
  const baseProvenance: FieldProvenance = {
    source: "crm:wise-agent",
    recordId: `lead:${args.candidate.leadKey}`,
    observedAt: args.nowIso,
    confidence: "MED",
    evidenceUrl: null,
    evidenceLabel: "Brief candidate row",
  };
  const base = args.candidate.normalizedAddress
    ? {
        property: {
          propertyKey: args.candidate.propertyKey ?? "",
          normalizedAddress: args.candidate.normalizedAddress,
          parcelId: null,
          provenance: baseProvenance,
        },
        ownership: null,
        permits: undefined,
        mortgageReleases: undefined,
        neighborhoodTransfers: null,
        assessedValueChange: null,
        priorTransactionCount: null,
        staleRelationshipObservedAt: staleTouch,
        priorClientClosedAt: null,
      }
    : null;

  const combined = combineEnrichmentWithPublicRecord(base, args.match);
  if (!combined) return [];

  // Re-inject the stale-touch anchor in case `synthesizeFromPublicRecord`
  // ran (no base) — that path correctly drops CRM-side fields. We add the
  // stale anchor back here so the combiner result is consistent regardless
  // of which branch the merge took.
  const final = combined.staleRelationshipObservedAt
    ? combined
    : { ...combined, staleRelationshipObservedAt: staleTouch };

  return buildPropertyEnrichmentSignals({
    enrichment: final,
    config: args.workspaceConfig,
    leadKey: args.candidate.leadKey,
    nowIso: args.nowIso,
  });
}

function outcomeFromSkip(decision: QueueDecision): EnrichmentOutcome {
  return {
    rank: decision.candidate.rank,
    leadKey: decision.candidate.leadKey,
    companyName: decision.candidate.companyName,
    propertyKey: decision.candidate.propertyKey,
    result: "skipped",
    skipReason: decision.skipReason,
    matchType: null,
    matchConfidence: null,
    evidence: null,
    signals: [],
    detail: decision.skipDetail,
  };
}

/**
 * Run the targeted enrichment for one customer. Pure: every randomness /
 * I/O / clock dependency is injected via `input`. Same inputs → byte-
 * identical `audit` JSON via `JSON.stringify` (outcomes sorted, ledger
 * sorted, summary counts derived from outcomes).
 */
export function runTargetedEnrichment(
  input: TargetedEnrichmentInput,
): TargetedEnrichmentResult {
  const candidates = input.brief.opportunities.map(candidateFromBriefItem);
  const queue = buildEnrichmentQueue(
    candidates,
    input.policy,
    input.ledger,
    input.nowIso,
  );

  const enqueuedKeys = new Set(queue.enqueued.map((c) => c.leadKey));
  const outcomes: EnrichmentOutcome[] = [];
  let nextLedger = input.ledger;

  for (const decision of queue.decisions) {
    if (decision.decision === "skip") {
      outcomes.push(outcomeFromSkip(decision));
      continue;
    }

    // Enqueued — attempt the match.
    if (!enqueuedKeys.has(decision.candidate.leadKey)) continue;
    const match = input.publicRecordIndex
      ? lookupMatch(input.publicRecordIndex, {
          parcelId: null, // brief items don't carry a parcelId
          propertyKey: decision.candidate.propertyKey,
        })
      : null;

    if (!match) {
      outcomes.push({
        rank: decision.candidate.rank,
        leadKey: decision.candidate.leadKey,
        companyName: decision.candidate.companyName,
        propertyKey: decision.candidate.propertyKey,
        result: "skipped",
        skipReason: "no_match",
        matchType: null,
        matchConfidence: null,
        evidence: null,
        signals: [],
        detail: input.publicRecordIndex
          ? "no public-record entry for this propertyKey"
          : "no public-record source supplied to this run",
      });
      continue;
    }

    // Honor policy.allowAddressOnlyMatch — if false, MED matches are
    // treated as no_match (we will not generate signals on address-only
    // evidence).
    if (match.matchConfidence === "MED" && !input.policy.allowAddressOnlyMatch) {
      outcomes.push({
        rank: decision.candidate.rank,
        leadKey: decision.candidate.leadKey,
        companyName: decision.candidate.companyName,
        propertyKey: decision.candidate.propertyKey,
        result: "skipped",
        skipReason: "no_match",
        matchType: match.matchType,
        matchConfidence: match.matchConfidence,
        evidence: copyEvidence(match.publicRecord.provenance),
        signals: [],
        detail: "policy.allowAddressOnlyMatch=false; MED match downgraded to skip",
      });
      continue;
    }

    let signals: RecoverySignal[] = [];
    try {
      signals = buildSignalsForCandidate({
        candidate: decision.candidate,
        match,
        workspaceConfig: input.workspaceConfig,
        nowIso: input.nowIso,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      outcomes.push({
        rank: decision.candidate.rank,
        leadKey: decision.candidate.leadKey,
        companyName: decision.candidate.companyName,
        propertyKey: decision.candidate.propertyKey,
        result: "failed",
        failureReason: "signal_build_threw",
        matchType: match.matchType,
        matchConfidence: match.matchConfidence,
        evidence: copyEvidence(match.publicRecord.provenance),
        signals: [],
        detail,
      });
      continue;
    }

    if (signals.length === 0) {
      outcomes.push({
        rank: decision.candidate.rank,
        leadKey: decision.candidate.leadKey,
        companyName: decision.candidate.companyName,
        propertyKey: decision.candidate.propertyKey,
        result: "skipped",
        skipReason: "no_actionable_facts",
        matchType: match.matchType,
        matchConfidence: match.matchConfidence,
        evidence: copyEvidence(match.publicRecord.provenance),
        signals: [],
        detail: "match succeeded but the record carried no actionable facts (no ownership date, no permits, no releases)",
      });
      continue;
    }

    outcomes.push({
      rank: decision.candidate.rank,
      leadKey: decision.candidate.leadKey,
      companyName: decision.candidate.companyName,
      propertyKey: decision.candidate.propertyKey,
      result: "enriched",
      matchType: match.matchType,
      matchConfidence: match.matchConfidence,
      evidence: copyEvidence(match.publicRecord.provenance),
      signals,
      detail: `${signals.length} signal(s) emitted from ${match.matchType} match`,
    });

    nextLedger = ledgerWithEnrichment(
      nextLedger,
      decision.candidate.leadKey,
      input.nowIso,
      signals.length,
    );
  }

  const audit = buildAudit({
    customer: input.customer,
    generatedAt: input.nowIso,
    briefSource: input.briefSource,
    publicRecordSource: input.publicRecordSource,
    policy: input.policy,
    outcomes,
    enqueuedCount: queue.enqueued.length,
  });

  return { audit, nextLedger };
}
