// Meridian Command — Gmail opportunity scanner (orchestrator).
//
// Pure. Takes a batch of raw threads, deduplicates by OPPORTUNITY (not just
// thread — multiple Chandler threads collapse into one Clue opportunity),
// classifies deterministically, drops noise, and diffs against the previous scan
// to produce the "what changed" change log.

import { classifyThread } from "./classify";
import { isNoiseThread, normalizeThread, parseEmail } from "./normalize";
import { matchSeed } from "./seeds";
import type {
  DetectedOpportunity,
  GmailThread,
  GmailThreadBatch,
  OpportunityScanResult,
} from "./types";

const DEFAULT_MIN_RELEVANCE = 40;

/** Preliminary grouping key for a thread, before full classification. */
function groupKeyFor(thread: GmailThread, ownerEmails: string[]): string | null {
  const sig = normalizeThread(thread, ownerEmails);
  if (!sig.primaryCounterparty) return null;
  const seed = matchSeed(`${sig.combinedText} ${sig.primaryCounterparty} ${sig.companyDomain ?? ""}`);
  // Known entities group at the COMPANY level so every Clue thread (application,
  // invite, follow-up) collapses into one opportunity. Unknown threads group by
  // company+person to avoid over-merging strangers at a shared domain.
  if (seed) return seed.company.toLowerCase();
  const company = sig.companyDomain ?? sig.primaryCounterparty;
  return `${company.toLowerCase()}::${sig.primaryCounterparty}`;
}

export interface ScanOptions {
  nowMs: number;
  minRelevance?: number;
  previous?: DetectedOpportunity[];
}

export function scanThreads(batch: GmailThreadBatch, opts: ScanOptions): OpportunityScanResult {
  const minRelevance = opts.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const owner = batch.ownerEmails;

  // 1. Drop pure noise, then group threads by opportunity.
  const groups = new Map<string, GmailThread[]>();
  let droppedAsNoise = 0;
  for (const thread of batch.threads) {
    const sig = normalizeThread(thread, owner);
    if (isNoiseThread(sig)) {
      droppedAsNoise += 1;
      continue;
    }
    const key = groupKeyFor(thread, owner);
    if (!key) {
      droppedAsNoise += 1;
      continue;
    }
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(thread);
  }

  // 2. Merge each group's messages into one synthetic thread, then classify.
  const prevByKey = new Map((opts.previous ?? []).map((o) => [o.key, o]));
  const opportunities: DetectedOpportunity[] = [];
  let unknown = 0;

  for (const [, threads] of groups) {
    const mergedId = threads[0].id;
    const messages = threads.flatMap((t) =>
      (t.messages ?? []).map((m) => ({ ...m, threadId: m.threadId ?? t.id })),
    );
    const merged: GmailThread = { id: mergedId, messages };
    const sig = normalizeThread(merged, owner);
    const opp = classifyThread(sig, opts.nowMs);
    if (!opp) {
      unknown += 1;
      continue;
    }
    opp.threadIds = Array.from(new Set(threads.map((t) => t.id)));
    if (opp.relevance < minRelevance) {
      droppedAsNoise += 1;
      continue;
    }
    if (opp.confidence === "unknown") unknown += 1;

    opp.whatChanged = diffOpportunity(opp, prevByKey.get(opp.key));
    opportunities.push(opp);
  }

  // 3. Deterministic leverage ordering (a sort, not an AI score).
  opportunities.sort(byLeverage);

  return {
    scannedAt: new Date(opts.nowMs).toISOString(),
    ownerEmails: owner,
    threadsScanned: batch.threads.length,
    opportunities,
    droppedAsNoise,
    unknown,
  };
}

/** Trust-model Change Log: what moved since the previous scan. */
function diffOpportunity(next: DetectedOpportunity, prev: DetectedOpportunity | undefined): string {
  if (!prev) return "NEW — first time detected";
  if (prev.stage !== next.stage) return `stage: ${prev.stage} → ${next.stage}`;
  if (prev.momentum !== next.momentum) return `momentum: ${prev.momentum} → ${next.momentum}`;
  if (prev.waitingOn !== next.waitingOn) return `waiting-on: ${prev.waitingOn} → ${next.waitingOn}`;
  if ((prev.lastInboundAt ?? "") !== (next.lastInboundAt ?? "")) return `new inbound ${(next.lastInboundAt ?? "").slice(0, 10)}`;
  if ((prev.lastOutboundAt ?? "") !== (next.lastOutboundAt ?? "")) return `new outbound ${(next.lastOutboundAt ?? "").slice(0, 10)}`;
  return "no change since last scan";
}

/** Order for the daily view: actionable + hot + relevant first. Deterministic. */
const STAGE_URGENCY: Record<string, number> = {
  follow_up_due: 100, waiting_on_me: 95, meeting_scheduled: 90, meeting_completed: 70,
  waiting_on_them: 60, discovered: 55, contacted: 50, active_pipeline: 65, replied: 60,
  stalled: 40, watch: 20, closed_won: 15, rejected: 5, closed_lost: 5,
};
const MOMENTUM_RANK: Record<string, number> = { accelerating: 5, warm: 4, cooling: 3, cold: 2, dead: 1 };

function byLeverage(a: DetectedOpportunity, b: DetectedOpportunity): number {
  const av = (STAGE_URGENCY[a.stage] ?? 0) + MOMENTUM_RANK[a.momentum] * 4 + a.relevance / 10;
  const bv = (STAGE_URGENCY[b.stage] ?? 0) + MOMENTUM_RANK[b.momentum] * 4 + b.relevance / 10;
  if (bv !== av) return bv - av;
  return a.key.localeCompare(b.key); // stable tiebreak
}

export { parseEmail };
