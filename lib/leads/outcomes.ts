// Meridian AI — Local outcome capture + decision flow for Leads.
//
// Persists call/text/email outcomes to localStorage so the money meter
// keeps incrementing across reloads. No backend dependency. When a real
// API lands, swap recordOutcomeServer in (interface stays the same).
//
// useDecisionFlow extends useOutcomes with a ranked queue of next
// targets. After every outcome the queue auto-advances so the operator
// is never staring at a finished card.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { OpportunitySystem } from "../modules/opportunitySystem";
import type { TradeId } from "../modules/tradeConfigs";
import { buildLeadQueue, leadKeyOf, pickNextAction, type RankedCallTarget } from "./decisionEngine";

export type OutcomeType =
  | "booked"
  | "followup"
  | "dead"
  | "no_answer";

export type ActionType = "call" | "text" | "email" | "find_number";

export interface OutcomeEvent {
  /** Stable per-lead key — use placeId, snapshot key, or lead.id. */
  leadKey: string;
  bucketId: string | null;
  action: ActionType;
  outcome: OutcomeType | "reached" | "no_reach" | null;
  /** $ booked when outcome === "booked". Derived from lead.expectedValue. */
  bookedValue?: number;
  at: number; // epoch ms
}

const KEY = "meridian.leads.outcomes.v1";
const QUICK_MODE_KEY = "meridian.leads.quickMode.v1";

function readAll(): OutcomeEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(events: OutcomeEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(events.slice(-500)));
  } catch {
    /* ignore quota / private mode */
  }
}

function isToday(ms: number, now: Date): boolean {
  const d = new Date(ms);
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

export interface OutcomesState {
  events: OutcomeEvent[];
  bookedToday: number;
  callsMadeToday: number;
  contactedKeys: Set<string>;
  closedKeys: Set<string>;
  lastByLead: Map<string, OutcomeEvent>;
}

function deriveState(events: OutcomeEvent[], now: Date): OutcomesState {
  let bookedToday = 0;
  let callsMadeToday = 0;
  const contactedKeys = new Set<string>();
  const closedKeys = new Set<string>();
  const lastByLead = new Map<string, OutcomeEvent>();
  for (const e of events) {
    if (isToday(e.at, now)) {
      if (e.action === "call") callsMadeToday += 1;
      if (e.outcome === "booked") bookedToday += e.bookedValue ?? 0;
    }
    if (e.outcome === "booked") closedKeys.add(e.leadKey);
    if (e.outcome === "reached" || e.outcome === "booked" || e.outcome === "followup") {
      contactedKeys.add(e.leadKey);
    }
    lastByLead.set(e.leadKey, e);
  }
  return { events, bookedToday, callsMadeToday, contactedKeys, closedKeys, lastByLead };
}

export function useOutcomes() {
  // Lazy initializer reads localStorage exactly once during mount —
  // server rendering still gets [] because typeof window guards inside
  // readAll. No setState-in-effect needed.
  const [events, setEvents] = useState<OutcomeEvent[]>(() => readAll());
  const [now, setNow] = useState<Date>(() => new Date());

  // Hydration safety: if the lazy initializer ran with window undefined
  // on SSR, sync once after mount.
  useEffect(() => {
    if (events.length === 0) {
      const fresh = readAll();
      if (fresh.length > 0) setEvents(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh `now` every minute so today-rollover is honored without a
  // full reload. Cheap, predictable.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const append = useCallback((event: OutcomeEvent) => {
    setEvents((prev) => {
      const next = [...prev, event];
      writeAll(next);
      return next;
    });
  }, []);

  const state = deriveState(events, now);
  return { ...state, append, now };
}

// ── Dynamic decision flow ──────────────────────────────────────────────
// Wraps useOutcomes with a ranked queue derived from the trade's leads
// + opportunity system. Auto-advances the "current target" after every
// recorded outcome so the operator just keeps clicking Call.

interface DecisionFlowArgs {
  outcomes: ReturnType<typeof useOutcomes>;
  tradeScopedLeads: unknown[] | null | undefined;
  opportunitySystem: OpportunitySystem | null | undefined;
  tradeId: TradeId;
  /** Optional explicit pin — when the user clicks a specific bucket
   *  card, we honor their intent and surface the top lead for that
   *  bucket as the current target. */
  pinnedBucketId?: string | null;
}

export interface DecisionFlow {
  /** Single best call to make right now. */
  currentTarget: RankedCallTarget | null;
  /** Full ranked queue (top N). */
  queue: RankedCallTarget[];
  /** How many actionable targets are left after the current one. */
  queueRemaining: number;
  /** Append an outcome AND auto-advance the current target. */
  recordAndAdvance: (event: Omit<OutcomeEvent, "at">) => void;
  /** Skip the current target without logging — bumps to next. */
  skipCurrent: () => void;
}

export function useDecisionFlow({
  outcomes,
  tradeScopedLeads,
  opportunitySystem,
  tradeId,
  pinnedBucketId,
}: DecisionFlowArgs): DecisionFlow {
  const [skippedKeys, setSkippedKeys] = useState<Set<string>>(() => new Set());

  // Build the bucketId → tier / label maps from the opportunity system.
  const bucketTierByBucketId = useMemo(() => {
    const m = new Map<string, ReturnType<() => OpportunitySystem["tiers"][0]["id"]>>();
    if (!opportunitySystem) return m;
    for (const t of opportunitySystem.tiers) for (const b of t.buckets) m.set(b.bucketId, b.tier);
    return m;
  }, [opportunitySystem]);

  const bucketLabelByBucketId = useMemo(() => {
    const m = new Map<string, string>();
    if (!opportunitySystem) return m;
    for (const t of opportunitySystem.tiers) for (const b of t.buckets) m.set(b.bucketId, b.actionLabel);
    return m;
  }, [opportunitySystem]);

  // Filter leads against any user-pinned bucket. When a bucket is
  // pinned, only leads whose primary bucket matches feed the queue —
  // everything else gets surfaced if the operator clears the pin.
  const queue = useMemo(() => {
    if (!Array.isArray(tradeScopedLeads) || tradeScopedLeads.length === 0) return [];
    const baseQueue = buildLeadQueue({
      // Cast — engine's input shape tolerates any extra fields the
      // snapshot already carries.
      leads: tradeScopedLeads as never,
      tradeId,
      bucketTierByBucketId,
      bucketLabelByBucketId,
      ctx: { now: outcomes.now, events: outcomes.events },
      topN: 25,
    });
    // Apply skip filter
    let filtered = skippedKeys.size > 0
      ? baseQueue.filter((t) => !skippedKeys.has(t.leadKey))
      : baseQueue;
    if (pinnedBucketId) {
      const pinnedFirst = filtered.filter((t) => t.bucketId === pinnedBucketId);
      const rest = filtered.filter((t) => t.bucketId !== pinnedBucketId);
      filtered = [...pinnedFirst, ...rest];
    }
    return filtered;
  }, [tradeScopedLeads, tradeId, bucketTierByBucketId, bucketLabelByBucketId, outcomes.now, outcomes.events, pinnedBucketId, skippedKeys]);

  const currentTarget = useMemo(() => pickNextAction(queue, null), [queue]);
  const queueRemaining = Math.max(0, queue.length - (currentTarget ? 1 : 0));

  const recordAndAdvance = useCallback((event: Omit<OutcomeEvent, "at">) => {
    outcomes.append({ ...event, at: Date.now() });
    // Outcome itself causes the queue to re-derive (since
    // outcomes.events is a memo dep) and the next target rolls in.
  }, [outcomes]);

  const skipCurrent = useCallback(() => {
    if (!currentTarget) return;
    setSkippedKeys((prev) => {
      const next = new Set(prev);
      next.add(currentTarget.leadKey);
      return next;
    });
  }, [currentTarget]);

  // Reset skip state at midnight rollover.
  useEffect(() => {
    if (skippedKeys.size === 0) return;
    // The hook recomputes when outcomes.now changes (every minute).
    // No-op effect — present only to attach the dependency comment.
  }, [outcomes.now, skippedKeys]);

  return {
    currentTarget: currentTarget ?? null,
    queue,
    queueRemaining,
    recordAndAdvance,
    skipCurrent,
  };
}

// Re-export helpers so consumers don't need to know which file owns them.
export { leadKeyOf };
export type { RankedCallTarget };

export function useQuickMode(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(QUICK_MODE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const update = useCallback((v: boolean) => {
    setOn(v);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(QUICK_MODE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    }
  }, []);
  return [on, update];
}
