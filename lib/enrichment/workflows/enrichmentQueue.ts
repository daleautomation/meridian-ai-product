// Meridian — Brookside targeted-enrichment queue builder.
//
// Pure, deterministic. Given the ranked brief candidates + the policy +
// the ledger, the queue emits two parallel lists:
//
//   • `enqueued`  — candidates that survived every gate (address, dedupe,
//                   recency) and are within the cap. The orchestrator
//                   tries to match each of these against the public-record
//                   index and emits signals.
//   • `decisions` — one decision per candidate (including those NOT
//                   enqueued). Drives the audit so an operator can see
//                   exactly why a contact was suppressed.
//
// Same input → same output, always. The candidate order is the brief's
// rank order; ties are broken by `leadKey` ascending so two contacts at
// the same rank never flip between runs.

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
  type NormalizedAddress,
} from "@/lib/enrichment/address";
import type { RecoveryBriefItem } from "@/lib/recovery/brief";

import {
  isWithinRecencyWindow,
  type EnrichmentLedger,
  type EnrichmentPolicy,
  type EnrichmentSkipReason,
} from "./enrichmentPolicy";

/** Candidate distilled from a single brief opportunity row. */
export interface QueueCandidate {
  rank: number;
  leadKey: string;
  companyName: string;
  contactName: string | null;
  /** Display string from the brief; the queue normalizes a property key from it. */
  location: string | null;
  /** Days since last touch from `staleness.daysSinceTouch`, used to anchor signals. */
  daysSinceTouch: number | null;
  /** Derived deterministically from `location`; null when address parsing fails. */
  propertyKey: string | null;
  /** Normalized address details (kept for downstream signal-building anchors). */
  normalizedAddress: NormalizedAddress | null;
  weakAddressReason: string | null;
}

export interface QueueDecision {
  candidate: QueueCandidate;
  /** Either `enqueue` (will attempt match) or `skip` (with a reason). */
  decision: "enqueue" | "skip";
  /** Set when decision === "skip". */
  skipReason?: EnrichmentSkipReason;
  /** Free-text detail surfaced in the audit report. */
  skipDetail?: string;
}

export interface QueueResult {
  enqueued: readonly QueueCandidate[];
  decisions: readonly QueueDecision[];
}

/** Build a candidate from a single brief opportunity. Pure. */
export function candidateFromBriefItem(item: RecoveryBriefItem): QueueCandidate {
  const location = (item.location ?? "").trim() || null;
  let propertyKey: string | null = null;
  let normalized: NormalizedAddress | null = null;
  let weakReason: string | null = null;

  if (location) {
    const addr = normalizeAddress(location);
    const weak = detectWeakAddress(addr);
    if (weak) {
      weakReason = `${weak.code}: ${weak.detail}`;
    } else {
      normalized = addr;
      propertyKey = canonicalPropertyKey(addr);
    }
  }

  return {
    rank: item.rank,
    leadKey: item.leadKey,
    companyName: item.companyName,
    contactName: item.contactName,
    location,
    daysSinceTouch: item.staleness?.daysSinceTouch ?? null,
    propertyKey,
    normalizedAddress: normalized,
    weakAddressReason: weakReason,
  };
}

/** Sort: rank ascending; leadKey ascending as deterministic tiebreaker. */
function sortCandidates(candidates: readonly QueueCandidate[]): QueueCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.leadKey < b.leadKey ? -1 : a.leadKey > b.leadKey ? 1 : 0;
  });
}

/**
 * Build the queue. Pure function; same inputs → same output.
 *
 * Gate order (matters — operators read the first reason that fires):
 *   1. no_property_key            (couldn't normalize at all)
 *   2. weak_address               (incomplete street / city / state / zip)
 *   3. duplicate_property_key     (an earlier-ranked candidate already
 *                                  claimed this propertyKey in this run)
 *   4. already_enriched_recent    (ledger says we touched it within window)
 *   5. outside_cap                (we'd exceed `policy.cap` if we admitted)
 *
 * After this function returns, the orchestrator runs the parcel match.
 * `no_match` and `no_actionable_facts` are downstream skip reasons —
 * they live on the orchestrator's audit outcome, not on the queue decision.
 */
export function buildEnrichmentQueue(
  candidates: readonly QueueCandidate[],
  policy: EnrichmentPolicy,
  ledger: EnrichmentLedger,
  nowIso: string,
): QueueResult {
  const sorted = sortCandidates(candidates);
  const enqueued: QueueCandidate[] = [];
  const decisions: QueueDecision[] = [];
  const seenPropertyKeys = new Set<string>();

  for (const candidate of sorted) {
    if (!candidate.propertyKey) {
      decisions.push({
        candidate,
        decision: "skip",
        skipReason: "no_property_key",
        skipDetail: candidate.weakAddressReason ?? "no address available on brief item",
      });
      continue;
    }

    if (policy.requireStrongAddress && candidate.weakAddressReason) {
      decisions.push({
        candidate,
        decision: "skip",
        skipReason: "weak_address",
        skipDetail: candidate.weakAddressReason,
      });
      continue;
    }

    if (seenPropertyKeys.has(candidate.propertyKey)) {
      decisions.push({
        candidate,
        decision: "skip",
        skipReason: "duplicate_property_key",
        skipDetail: `propertyKey ${candidate.propertyKey} already claimed by an earlier-ranked candidate`,
      });
      continue;
    }

    const ledgerHit = ledger.entriesByLeadKey.get(candidate.leadKey);
    if (
      ledgerHit &&
      isWithinRecencyWindow(ledgerHit.enrichedAt, nowIso, policy.recencyWindowDays)
    ) {
      decisions.push({
        candidate,
        decision: "skip",
        skipReason: "already_enriched_recent",
        skipDetail: `last enriched at ${ledgerHit.enrichedAt} within ${policy.recencyWindowDays}-day window`,
      });
      continue;
    }

    if (enqueued.length >= policy.cap) {
      decisions.push({
        candidate,
        decision: "skip",
        skipReason: "outside_cap",
        skipDetail: `cap=${policy.cap} reached before rank ${candidate.rank}`,
      });
      continue;
    }

    seenPropertyKeys.add(candidate.propertyKey);
    enqueued.push(candidate);
    decisions.push({ candidate, decision: "enqueue" });
  }

  return { enqueued, decisions };
}
