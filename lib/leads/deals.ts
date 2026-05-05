// Meridian AI — Deals (lightweight money pipeline).
//
// Pipeline state derived from the outcome log + a thin mutation layer.
// We deliberately do NOT build a parallel CRM store. Every deal is
// rebuildable from outcome events + the small mutations file in this
// module (notes, stage moves, won/lost flags applied AFTER an outcome).
//
// Storage: localStorage (key: meridian.deals.mutations.v1). Outcomes
// already persist via meridian.leads.outcomes.v1 — we only persist the
// human-driven overlay so the same call log produces the same pipeline
// across reloads.
//
// Backend-ready shape: every helper returns serializable plain objects
// that map 1:1 to /api/deals/upsert, /api/deals/:id/note,
// /api/deals/:id/stage, GET /api/deals when those land.

import { useCallback, useEffect, useMemo, useState } from "react";
import { leadOpportunityValue, getActionableContact } from "./leadActions";
import type { OutcomeEvent } from "./outcomes";

// ── Types ──────────────────────────────────────────────────────────────

export type DealStage =
  | "closing_soon"
  | "in_progress"
  | "new"
  | "lost"
  | "closed_won";

export const DEAL_STAGES: DealStage[] = [
  "closing_soon",
  "in_progress",
  "new",
  "lost",
  "closed_won",
];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  closing_soon: "Closing soon",
  in_progress: "In progress",
  new: "New",
  lost: "Lost",
  closed_won: "Won",
};

export interface DealHistoryEvent {
  type: "call" | "text" | "email" | "note" | "stage_move" | "create" | "find_number";
  outcome?: string | null;
  stage?: DealStage | null;
  summary: string;
  at: number;
}

export interface DealContact {
  phone: string | null;
  email: string | null;
  website: string | null;
}

export interface Deal {
  id: string;
  leadId: string | null;
  leadKey: string;
  companyName: string;
  trade: string | null;
  bucketId: string | null;
  bucketLabel: string | null;
  stage: DealStage;
  estimatedValue: number;
  closeProbability: number;
  lastAction: string | null;
  nextAction: string;
  /** Last call/text/email outcome that touched this deal. */
  lastOutcome: string | null;
  contact: DealContact;
  notes: { text: string; at: number }[];
  history: DealHistoryEvent[];
  /** Follow-up due date as YYYY-MM-DD string. null = no follow-up. */
  followUpOn: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Outcome → stage mapping ────────────────────────────────────────────

export function stageFromOutcome(outcome: string | null | undefined): DealStage {
  switch (outcome) {
    case "booked":            return "closing_soon";
    case "followup":
    case "reached":           return "in_progress";
    case "no_answer":
    case "no_reach":          return "new";
    case "dead":              return "lost";
    default:                  return "new";
  }
}

export function nextActionFromOutcome(outcome: string | null | undefined, callable: boolean): string {
  if (!callable) return "Find their number";
  switch (outcome) {
    case "booked":            return "Send proposal or confirm next step";
    case "followup":          return "Follow up tomorrow";
    case "reached":           return "Follow up tomorrow";
    case "no_answer":
    case "no_reach":          return "Call again tomorrow";
    case "dead":              return "No follow-up needed";
    default:                  return "Call them";
  }
}

function followUpDateFromOutcome(outcome: string | null | undefined, now: Date): string | null {
  switch (outcome) {
    case "booked":            return ymd(now); // today
    case "followup":
    case "reached":
    case "no_answer":
    case "no_reach":          return ymd(addDays(now, 1));
    case "dead":              return null;
    default:                  return ymd(addDays(now, 1));
  }
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function summaryFromOutcome(outcome: string | null | undefined): string {
  switch (outcome) {
    case "booked":      return "Booked the job";
    case "followup":    return "Talked — try again later";
    case "reached":     return "Talked to them";
    case "no_answer":   return "No answer";
    case "no_reach":    return "Couldn't reach";
    case "dead":        return "Not a fit";
    default:            return "Logged outcome";
  }
}

export function actionLabelFromAction(action: string | null | undefined): string {
  switch (action) {
    case "call":          return "Called";
    case "text":          return "Sent a text";
    case "email":         return "Sent an email";
    case "find_number":   return "Looking up number";
    default:              return "Logged";
  }
}

// ── Mutation layer (manual overrides on top of outcome-derived deals) ──

interface DealMutation {
  /** Stable per-deal key. */
  dealId: string;
  type: "stage" | "note" | "won" | "lost" | "next_action" | "create_seed";
  stage?: DealStage;
  note?: string;
  nextAction?: string;
  // For create_seed (a deal born without an outcome yet, e.g. user
  // explicitly added one). Kept open for future; not currently used.
  seed?: Partial<Deal>;
  at: number;
}

const MUTATIONS_KEY = "meridian.deals.mutations.v1";

function readMutations(): DealMutation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MUTATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMutations(list: DealMutation[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTATIONS_KEY, JSON.stringify(list.slice(-1000)));
  } catch {
    /* ignore quota / private mode */
  }
}

// ── Lead context resolver ──────────────────────────────────────────────
// Outcomes only carry leadKey + bucketId. To build deals we need the
// company name + EV + contact. We accept a `leadIndex` keyed by leadKey
// so consumers (the React tree) can pass the live lead snapshot.

export interface LeadIndexEntry {
  leadKey: string;
  leadId?: string | null;
  companyName: string;
  trade?: string | null;
  bucketLabel?: string | null;
  estimatedValue?: number;
  closeProbability?: number;
  contact: DealContact;
}

interface BuildOptions {
  leadIndex: Map<string, LeadIndexEntry>;
  events: OutcomeEvent[];
  mutations: DealMutation[];
  now: Date;
}

function dealIdFor(entry: { leadKey: string; companyName: string }): string {
  // Use the leadKey directly; it's already stable. Prefix `deal_` so
  // server-side ids stay ergonomic when we move off localStorage.
  return `deal_${entry.leadKey}`;
}

function buildDealsInternal({ leadIndex, events, mutations }: BuildOptions): Map<string, Deal> {
  const byId = new Map<string, Deal>();
  // Process outcomes in chronological order so derived state ends on
  // the latest stage / next action.
  const sortedEvents = [...events].sort((a, b) => a.at - b.at);
  for (const e of sortedEvents) {
    if (!e.leadKey) continue;
    const ctx = leadIndex.get(e.leadKey);
    // Build a minimal seed even if we don't have the lead in the
    // current trade view — pipeline shouldn't drop yesterday's deals
    // just because the user switched trades today.
    const companyName = ctx?.companyName ?? e.leadKey;
    const id = dealIdFor({ leadKey: e.leadKey, companyName });
    const existing = byId.get(id);
    const callable = !!ctx?.contact?.phone;
    const stage = stageFromOutcome(e.outcome);
    const nextAction = nextActionFromOutcome(e.outcome, callable);
    const followUpOn = followUpDateFromOutcome(e.outcome, new Date(e.at));
    const summary = `${actionLabelFromAction(e.action)}. ${summaryFromOutcome(e.outcome)}.`;
    const historyEvent: DealHistoryEvent = {
      type: e.action === "find_number" ? "find_number" : (e.action as DealHistoryEvent["type"]),
      outcome: e.outcome ?? null,
      summary,
      at: e.at,
    };
    if (!existing) {
      byId.set(id, {
        id,
        leadId: ctx?.leadId ?? null,
        leadKey: e.leadKey,
        companyName,
        trade: ctx?.trade ?? null,
        bucketId: e.bucketId ?? null,
        bucketLabel: ctx?.bucketLabel ?? null,
        stage,
        estimatedValue: ctx?.estimatedValue ?? (e.bookedValue ?? 0),
        closeProbability: ctx?.closeProbability ?? 0.3,
        lastAction: summary,
        nextAction,
        lastOutcome: e.outcome ?? null,
        contact: ctx?.contact ?? { phone: null, email: null, website: null },
        notes: [],
        history: [
          {
            type: "create",
            summary: `Created from ${summary.toLowerCase()}`,
            at: e.at,
          },
          historyEvent,
        ],
        followUpOn,
        createdAt: e.at,
        updatedAt: e.at,
      });
    } else {
      existing.stage = stage;
      existing.lastAction = summary;
      existing.lastOutcome = e.outcome ?? existing.lastOutcome;
      existing.nextAction = nextAction;
      existing.followUpOn = followUpOn;
      existing.updatedAt = e.at;
      existing.history.push(historyEvent);
      // If we now have lead context (e.g. snapshot loaded), refresh
      // the contact + EV; otherwise keep the previous values.
      if (ctx) {
        existing.companyName = ctx.companyName ?? existing.companyName;
        existing.trade = ctx.trade ?? existing.trade;
        existing.bucketLabel = ctx.bucketLabel ?? existing.bucketLabel;
        existing.contact = ctx.contact ?? existing.contact;
        if (ctx.estimatedValue && ctx.estimatedValue > 0) existing.estimatedValue = ctx.estimatedValue;
        if (ctx.closeProbability) existing.closeProbability = ctx.closeProbability;
      }
      if (e.outcome === "booked" && (e.bookedValue ?? 0) > 0) {
        existing.estimatedValue = e.bookedValue ?? existing.estimatedValue;
      }
    }
  }

  // Apply manual mutations on top, in order. Mutations always win over
  // outcome-derived state — that's the whole point of an override.
  const sortedMutations = [...mutations].sort((a, b) => a.at - b.at);
  for (const m of sortedMutations) {
    const deal = byId.get(m.dealId);
    if (!deal) continue;
    if (m.type === "stage" && m.stage) {
      deal.stage = m.stage;
      deal.history.push({ type: "stage_move", stage: m.stage, summary: `Moved to ${DEAL_STAGE_LABELS[m.stage]}.`, at: m.at });
    } else if (m.type === "won") {
      deal.stage = "closed_won";
      deal.followUpOn = ymd(addDays(new Date(m.at), 7));
      deal.nextAction = "Ask for referral or review";
      deal.history.push({ type: "stage_move", stage: "closed_won", summary: "Marked won.", at: m.at });
    } else if (m.type === "lost") {
      deal.stage = "lost";
      deal.followUpOn = null;
      deal.nextAction = "No follow-up needed";
      deal.history.push({ type: "stage_move", stage: "lost", summary: "Marked not a fit.", at: m.at });
    } else if (m.type === "note" && m.note) {
      deal.notes.push({ text: m.note, at: m.at });
      deal.history.push({ type: "note", summary: m.note, at: m.at });
    } else if (m.type === "next_action" && m.nextAction) {
      deal.nextAction = m.nextAction;
    }
    deal.updatedAt = Math.max(deal.updatedAt, m.at);
  }

  return byId;
}

// ── Pipeline summary ───────────────────────────────────────────────────

export interface PipelineSummary {
  totalActiveValue: number;
  byStage: Record<DealStage, { count: number; value: number; deals: Deal[] }>;
  wonToday: number;
  nextFollowUp: { deal: Deal; due: "today" | "tomorrow" | "late" } | null;
  /** Deals due today, sorted highest value first. */
  dueToday: Deal[];
  /** Deals overdue (followUpOn before today, not lost/won). */
  late: Deal[];
}

function dealDueLabel(deal: Deal, now: Date): "today" | "tomorrow" | "late" | null {
  if (!deal.followUpOn) return null;
  const today = ymd(now);
  const tomorrow = ymd(addDays(now, 1));
  if (deal.followUpOn === today) return "today";
  if (deal.followUpOn === tomorrow) return "tomorrow";
  if (deal.followUpOn < today) return "late";
  return null;
}

export function summarizePipeline(deals: Deal[], now: Date): PipelineSummary {
  const byStage: PipelineSummary["byStage"] = {
    closing_soon: { count: 0, value: 0, deals: [] },
    in_progress: { count: 0, value: 0, deals: [] },
    new: { count: 0, value: 0, deals: [] },
    lost: { count: 0, value: 0, deals: [] },
    closed_won: { count: 0, value: 0, deals: [] },
  };
  let wonToday = 0;
  const dueToday: Deal[] = [];
  const late: Deal[] = [];
  const today = ymd(now);
  for (const d of deals) {
    byStage[d.stage].count += 1;
    byStage[d.stage].value += d.estimatedValue;
    byStage[d.stage].deals.push(d);
    if (d.stage === "closed_won" && ymd(new Date(d.updatedAt)) === today) {
      wonToday += d.estimatedValue;
    }
    const due = dealDueLabel(d, now);
    if (due === "today" && d.stage !== "lost" && d.stage !== "closed_won") dueToday.push(d);
    if (due === "late" && d.stage !== "lost" && d.stage !== "closed_won") late.push(d);
  }
  const totalActiveValue =
    byStage.closing_soon.value + byStage.in_progress.value + byStage.new.value;

  // Next follow-up = highest-value deal due today; fall back to the
  // earliest-overdue deal if nothing's due today.
  let nextFollowUp: PipelineSummary["nextFollowUp"] = null;
  const sortedToday = [...dueToday].sort((a, b) => b.estimatedValue - a.estimatedValue);
  const sortedLate = [...late].sort((a, b) => (a.followUpOn ?? "").localeCompare(b.followUpOn ?? ""));
  if (sortedToday[0]) nextFollowUp = { deal: sortedToday[0], due: "today" };
  else if (sortedLate[0]) nextFollowUp = { deal: sortedLate[0], due: "late" };

  return { totalActiveValue, byStage, wonToday, nextFollowUp, dueToday, late };
}

/** Sort deals within a single stage by the "smart priority" rules. */
export function sortDealsForStage(deals: Deal[], now: Date): Deal[] {
  const today = ymd(now);
  return [...deals].sort((a, b) => {
    const aDue = a.followUpOn === today || (a.followUpOn && a.followUpOn < today);
    const bDue = b.followUpOn === today || (b.followUpOn && b.followUpOn < today);
    if (aDue !== bDue) return aDue ? -1 : 1;
    if (b.estimatedValue !== a.estimatedValue) return b.estimatedValue - a.estimatedValue;
    if (b.closeProbability !== a.closeProbability) return b.closeProbability - a.closeProbability;
    return b.updatedAt - a.updatedAt;
  });
}

// ── Hook ───────────────────────────────────────────────────────────────

export interface UseDealsArgs {
  events: OutcomeEvent[];
  /** Map of leadKey → enriched lead context. Use the React tree's
   *  current snapshot map. */
  leadIndex: Map<string, LeadIndexEntry>;
  now?: Date;
}

export interface UseDealsResult {
  deals: Deal[];
  byId: Map<string, Deal>;
  summary: PipelineSummary;
  /** Mutators — all persist to localStorage and bump local state. */
  moveDealStage: (dealId: string, stage: DealStage) => void;
  addDealNote: (dealId: string, note: string) => void;
  markDealWon: (dealId: string) => void;
  markDealLost: (dealId: string) => void;
  setDealNextAction: (dealId: string, nextAction: string) => void;
}

export function useDeals({ events, leadIndex, now }: UseDealsArgs): UseDealsResult {
  const [mutations, setMutations] = useState<DealMutation[]>(() => readMutations());

  // Hydration safety — mirror useOutcomes' pattern.
  useEffect(() => {
    if (mutations.length === 0) {
      const fresh = readMutations();
      if (fresh.length > 0) setMutations(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const append = useCallback((m: DealMutation) => {
    setMutations((prev) => {
      const next = [...prev, m];
      writeMutations(next);
      return next;
    });
  }, []);

  const moveDealStage = useCallback((dealId: string, stage: DealStage) => {
    append({ dealId, type: "stage", stage, at: Date.now() });
  }, [append]);
  const addDealNote = useCallback((dealId: string, note: string) => {
    if (!note.trim()) return;
    append({ dealId, type: "note", note: note.trim(), at: Date.now() });
  }, [append]);
  const markDealWon = useCallback((dealId: string) => {
    append({ dealId, type: "won", at: Date.now() });
  }, [append]);
  const markDealLost = useCallback((dealId: string) => {
    append({ dealId, type: "lost", at: Date.now() });
  }, [append]);
  const setDealNextAction = useCallback((dealId: string, nextAction: string) => {
    if (!nextAction.trim()) return;
    append({ dealId, type: "next_action", nextAction: nextAction.trim(), at: Date.now() });
  }, [append]);

  const { deals, byId, summary } = useMemo(() => {
    const ts = now ?? new Date();
    const map = buildDealsInternal({ leadIndex, events, mutations, now: ts });
    const list = Array.from(map.values());
    return {
      deals: list,
      byId: map,
      summary: summarizePipeline(list, ts),
    };
  }, [events, mutations, leadIndex, now]);

  return { deals, byId, summary, moveDealStage, addDealNote, markDealWon, markDealLost, setDealNextAction };
}

// ── Lead-index helper ──────────────────────────────────────────────────
// Build a lead index from any iterable of leads + bucket map. Keeps the
// hook input pure and lets the React tree memoize cheaply.

export function buildLeadIndex(leads: Iterable<{
  id?: unknown; key?: unknown; placeId?: unknown; name?: unknown; companyName?: unknown;
  expectedValue?: number | null; revenueImpact?: number | null;
  closeProbability?: number | null;
  phone?: string | null; email?: string | null; website?: string | null;
  websiteUrl?: string | null; domain?: string | null;
  contacts?: { primaryPhone?: string | null; primaryEmail?: string | null } | null;
  serviceBucketId?: string | null; serviceBucketLabel?: string | null;
  tradeId?: string | null; tradeLabel?: string | null;
}>, opts: { defaultTrade?: string | null } = {}): Map<string, LeadIndexEntry> {
  const map = new Map<string, LeadIndexEntry>();
  for (const l of leads) {
    const leadKey = String(
      l?.id ?? l?.key ?? l?.placeId ?? l?.name ?? l?.companyName ?? "unknown",
    );
    const contactRes = getActionableContact(l);
    map.set(leadKey, {
      leadKey,
      leadId: typeof l?.id === "string" ? l.id : null,
      companyName: String(l?.name ?? l?.companyName ?? leadKey),
      trade: (l?.tradeLabel as string | null) ?? opts.defaultTrade ?? null,
      bucketLabel: (l?.serviceBucketLabel as string | null) ?? null,
      estimatedValue: leadOpportunityValue(l) ?? 0,
      closeProbability: typeof l?.closeProbability === "number" ? l.closeProbability : 0.3,
      contact: {
        phone: contactRes.phone,
        email: contactRes.email,
        website: (l?.website as string | null) ?? (l?.websiteUrl as string | null) ?? (l?.domain as string | null) ?? null,
      },
    });
  }
  return map;
}
