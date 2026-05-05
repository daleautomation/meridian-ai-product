// Meridian AI — Dynamic Decision Engine.
//
// Pure functions only. Combines four factors into a single score that
// answers: "what is the best next call this user can make right now?"
//
//   nextActionScore =
//     0.40 · revenue        (probability-adjusted opportunity value)
//   + 0.30 · closeProb      (likelihood the call books)
//   + 0.20 · urgency        (bucket urgency × time-of-day × staleness)
//   + 0.10 · completeness   (callable: phone/email/website data)
//
// The engine reads lead fields the snapshot already carries. It does
// NOT fabricate new fields and does NOT mutate the lead. It's safe to
// call on every render — same input, same output.

import { leadOpportunityValue, getActionableContact, type ActionableLeadLike } from "./leadActions";
import { primaryBucketForLead, classifyLeadIntoBuckets, type ClassifierLeadLike } from "../modules/bucketClassifier";
import { resolveBucketAction, type BucketTier } from "../modules/bucketActionConfig";
import type { TradeId } from "../modules/tradeConfigs";
import type { OutcomeEvent } from "./outcomes";

// ── Public types ───────────────────────────────────────────────────────

export interface DecisionContext {
  /** Current time. Drives urgency / time-of-day boosts and "today" rollovers. */
  now?: Date;
  /** Outcomes observed so far. Used to auto-skip leads acted on today. */
  events?: OutcomeEvent[] | null;
  /** Optional: an explicit "skip" key the user pressed. */
  skipLeadKey?: string | null;
}

export interface ScoreBreakdown {
  revenue: number;          // 0..1
  closeProbability: number; // 0..1
  urgency: number;          // 0..1
  completeness: number;     // 0..1
}

export interface RankedCallTarget {
  leadKey: string;
  lead: ActionableLeadLike & ClassifierLeadLike & { name?: string | null; companyName?: string | null };
  bucketId: string;
  bucketLabel: string;
  bucketTier: BucketTier;
  /** Final composite score 0..100. */
  score: number;
  breakdown: ScoreBreakdown;
  /** Plain-English reasons the engine picked this target. */
  reasons: string[];
  /** Probability-adjusted dollars on the line. */
  revenuePotential: number;
  /** Whether the operator can dial right now. */
  callable: boolean;
}

// ── Defaults (per-tier) ────────────────────────────────────────────────
// These are the priors when the lead doesn't carry its own
// closeProbability / urgency. They keep call_first reliably above
// set_up_next which is reliably above wait, without overriding any
// real signal a lead does carry.

const TIER_CLOSE_PRIOR: Record<BucketTier, number> = {
  call_first: 0.42,
  set_up_next: 0.25,
  wait: 0.15,
};

const TIER_URGENCY_PRIOR: Record<BucketTier, number> = {
  call_first: 0.80,
  set_up_next: 0.50,
  wait: 0.25,
};

// Bucket-specific urgency overrides keyed by bucketId. Hand-tuned for
// the buckets where time-of-day matters more than the tier prior.
const BUCKET_URGENCY_BOOST: Record<string, (now: Date) => number> = {
  emergency_service_visibility: (now) => {
    const h = now.getHours();
    return (h >= 18 || h < 8) ? 0.20 : 0.05;
  },
  storm_response: () => 0.15,
  seasonal_demand: (now) => {
    const m = now.getMonth();
    // Pre-summer (Apr–May) and pre-winter (Sep–Oct) are the windows.
    return (m === 3 || m === 4 || m === 8 || m === 9) ? 0.18 : 0.02;
  },
};

// ── Internals ──────────────────────────────────────────────────────────

const REVENUE_NORM_MAX = 50_000; // anything above $50K caps to 1.0

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function todayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Stable lead key. Mirrors callNowLeadKey in the UI so today's
 *  outcomes attach to the right lead across surfaces. */
export function leadKeyOf(lead: { id?: unknown; key?: unknown; placeId?: unknown; name?: unknown; companyName?: unknown }): string {
  return String(
    lead?.id ?? lead?.key ?? lead?.placeId ?? lead?.name ?? lead?.companyName ?? "unknown",
  );
}

/** True when this lead has any blocking outcome today (booked, dead,
 *  no_reach, no_answer). Followup outcomes do NOT block — they cool
 *  down via the cooldown rule below. */
function actedOnToday(events: OutcomeEvent[] | null | undefined, leadKey: string, now: Date): "blocked" | "cooled" | null {
  if (!Array.isArray(events) || events.length === 0) return null;
  const today = todayKey(now);
  let cooled: "cooled" | null = null;
  for (const e of events) {
    if (e.leadKey !== leadKey) continue;
    const sameDay = todayKey(new Date(e.at)) === today;
    if (!sameDay) continue;
    if (e.outcome === "booked" || e.outcome === "dead") return "blocked";
    if (e.outcome === "no_answer" || e.outcome === "no_reach") return "blocked";
    if (e.outcome === "followup") cooled = "cooled";
  }
  return cooled;
}

// ── Scoring ────────────────────────────────────────────────────────────

export function scoreLeadForCall(
  lead: ActionableLeadLike & ClassifierLeadLike & { name?: string | null; companyName?: string | null; closeProbability?: number | null },
  bucketId: string,
  bucketTier: BucketTier,
  ctx: DecisionContext = {},
): { score: number; breakdown: ScoreBreakdown; reasons: string[]; revenuePotential: number; callable: boolean } {
  const now = ctx.now ?? new Date();
  const reasons: string[] = [];

  // Revenue (40%): probability-adjusted dollars, normalized.
  const revenueRaw = leadOpportunityValue(lead) ?? 0;
  const revenue = clamp01(revenueRaw / REVENUE_NORM_MAX);
  if (revenueRaw >= 5000) reasons.push(`~$${Math.round(revenueRaw).toLocaleString()} on the line`);

  // Close probability (30%): use lead's value if present, else tier prior,
  // adjusted by classifier confidence.
  let closeProbability: number;
  if (typeof lead.closeProbability === "number" && isFinite(lead.closeProbability)) {
    closeProbability = clamp01(lead.closeProbability);
  } else {
    closeProbability = TIER_CLOSE_PRIOR[bucketTier];
    // Classifier confidence on this bucket nudges close probability.
    const all = classifyLeadIntoBuckets(lead, (lead as { tradeId?: TradeId }).tradeId ?? "roofing");
    const match = all.find((c) => c.bucketId === bucketId);
    if (match) {
      if (match.confidence === "high") closeProbability += 0.10;
      else if (match.confidence === "low") closeProbability -= 0.05;
      closeProbability = clamp01(closeProbability);
      if (match.confidence === "high") reasons.push("Strong fit for this play");
    }
  }
  if (closeProbability >= 0.55) reasons.push(`${Math.round(closeProbability * 100)}% chance of close`);

  // Urgency (20%): tier prior + bucket-specific time-of-day boost.
  const baseUrgency = TIER_URGENCY_PRIOR[bucketTier];
  const boost = BUCKET_URGENCY_BOOST[bucketId]?.(now) ?? 0;
  const urgency = clamp01(baseUrgency + boost);
  if (boost >= 0.15) reasons.push("Right time of day for this play");

  // Data completeness (10%): callable matters most.
  const contact = getActionableContact(lead);
  let completeness = 0;
  if (contact.hasPhone) completeness += 0.5;
  if (contact.hasEmail) completeness += 0.3;
  if (lead.website || lead.websiteUrl || lead.domain) completeness += 0.2;
  completeness = clamp01(completeness);
  if (!contact.callable) reasons.push("Needs a number first");

  const score =
    100 * (
      0.40 * revenue +
      0.30 * closeProbability +
      0.20 * urgency +
      0.10 * completeness
    );

  return {
    score,
    breakdown: { revenue, closeProbability, urgency, completeness },
    reasons,
    revenuePotential: revenueRaw,
    callable: contact.callable,
  };
}

// ── Queue building ─────────────────────────────────────────────────────

interface BuildQueueArgs {
  leads: (ActionableLeadLike & ClassifierLeadLike & { name?: string | null; companyName?: string | null; id?: unknown; key?: unknown; placeId?: unknown })[];
  tradeId: TradeId;
  /** Mapping bucketId → tier from the opportunity system. */
  bucketTierByBucketId: Map<string, BucketTier>;
  /** Mapping bucketId → human label from the opportunity system. */
  bucketLabelByBucketId: Map<string, string>;
  ctx?: DecisionContext;
  /** Ceiling on returned targets. */
  topN?: number;
}

/** Build a ranked, deduplicated queue of call targets across every
 *  bucket in this trade. Auto-skips leads already acted on today
 *  (booked / dead / no_answer). Cooled (followup) leads are deranked
 *  but kept available. */
export function buildLeadQueue({
  leads,
  tradeId,
  bucketTierByBucketId,
  bucketLabelByBucketId,
  ctx,
  topN = 25,
}: BuildQueueArgs): RankedCallTarget[] {
  if (!Array.isArray(leads) || leads.length === 0) return [];
  const now = ctx?.now ?? new Date();
  const events = ctx?.events ?? [];
  const out: RankedCallTarget[] = [];
  const seen = new Set<string>();
  for (const lead of leads) {
    if (!lead) continue;
    const key = leadKeyOf(lead);
    if (seen.has(key)) continue;
    if (ctx?.skipLeadKey && ctx.skipLeadKey === key) continue;
    const status = actedOnToday(events, key, now);
    if (status === "blocked") continue;
    seen.add(key);

    // Pick the strongest matching bucket for THIS lead (its primary
    // classification). Falls back to first bucket the lead carries.
    const primary = primaryBucketForLead(lead, tradeId);
    const bucketId = primary?.bucketId ?? null;
    if (!bucketId) continue;
    const bucketTier = bucketTierByBucketId.get(bucketId) ?? "set_up_next";
    const action = resolveBucketAction(bucketId, tradeId);
    const bucketLabel = bucketLabelByBucketId.get(bucketId) ?? action.actionLabel;

    const scored = scoreLeadForCall(lead, bucketId, bucketTier, { now, events });
    // Deprioritize cooled leads so fresh ones surface first, but keep
    // them in the queue.
    const finalScore = status === "cooled" ? scored.score * 0.6 : scored.score;

    out.push({
      leadKey: key,
      lead,
      bucketId,
      bucketLabel,
      bucketTier,
      score: finalScore,
      breakdown: scored.breakdown,
      reasons: scored.reasons,
      revenuePotential: scored.revenuePotential,
      callable: scored.callable,
    });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.callable !== a.callable) return b.callable ? 1 : -1;
    return a.leadKey.localeCompare(b.leadKey);
  });
  return out.slice(0, topN);
}

/** Return the target to act on right now. Defaults to the top of the
 *  queue; respects an explicit pin (e.g. user clicked a specific
 *  bucket card in the UI to override the engine). */
export function pickNextAction(
  queue: RankedCallTarget[],
  pinnedLeadKey?: string | null,
): RankedCallTarget | null {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  if (pinnedLeadKey) {
    const found = queue.find((t) => t.leadKey === pinnedLeadKey);
    if (found) return found;
  }
  return queue[0];
}

// ── Bucket performance tracking ────────────────────────────────────────

export interface BucketPerformance {
  bucketId: string;
  potential: number;       // total $ across all ready leads in the bucket
  closedToday: number;     // $ booked today from this bucket
  closedAllTime: number;   // $ booked all-time from this bucket
  attemptsToday: number;   // # call attempts today
  attemptsAllTime: number; // # call attempts all-time
  conversionRate: number;  // closed / attempts (all-time)
}

/** Compute per-bucket performance from the outcome log + the
 *  opportunity system's revenue potentials. */
export function bucketPerformanceMap(
  events: OutcomeEvent[] | null | undefined,
  potentialByBucket: Map<string, number>,
  now: Date = new Date(),
): Map<string, BucketPerformance> {
  const out = new Map<string, BucketPerformance>();
  // Seed every bucket so the UI can render zero-state perf chips.
  potentialByBucket.forEach((potential, bucketId) => {
    out.set(bucketId, {
      bucketId,
      potential,
      closedToday: 0,
      closedAllTime: 0,
      attemptsToday: 0,
      attemptsAllTime: 0,
      conversionRate: 0,
    });
  });
  if (!Array.isArray(events) || events.length === 0) return out;
  const today = todayKey(now);
  for (const e of events) {
    if (!e.bucketId) continue;
    const slot = out.get(e.bucketId) ?? {
      bucketId: e.bucketId,
      potential: 0,
      closedToday: 0,
      closedAllTime: 0,
      attemptsToday: 0,
      attemptsAllTime: 0,
      conversionRate: 0,
    };
    const sameDay = todayKey(new Date(e.at)) === today;
    if (e.action === "call") {
      slot.attemptsAllTime += 1;
      if (sameDay) slot.attemptsToday += 1;
    }
    if (e.outcome === "booked") {
      slot.closedAllTime += e.bookedValue ?? 0;
      if (sameDay) slot.closedToday += e.bookedValue ?? 0;
    }
    out.set(e.bucketId, slot);
  }
  // Compute conversion rates last.
  out.forEach((slot) => {
    slot.conversionRate = slot.attemptsAllTime > 0
      ? Math.min(1, (slot.closedAllTime > 0 ? slot.closedAllTime : 0) / Math.max(1, slot.attemptsAllTime * 1)) // proportion of attempts that closed
      : 0;
    // Use # of booked outcomes / # attempts when possible.
    // (Computed above is $-based; below is correct count-based.)
  });
  // Recompute conversionRate as bookedCount / attemptsAllTime for accuracy.
  const bookedCount = new Map<string, number>();
  for (const e of events) {
    if (!e.bucketId) continue;
    if (e.outcome === "booked") {
      bookedCount.set(e.bucketId, (bookedCount.get(e.bucketId) ?? 0) + 1);
    }
  }
  out.forEach((slot, id) => {
    const attempts = slot.attemptsAllTime;
    const closed = bookedCount.get(id) ?? 0;
    slot.conversionRate = attempts > 0 ? closed / attempts : 0;
  });
  return out;
}
