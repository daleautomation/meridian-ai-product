// Meridian Command — recommendations from beliefs.
//
// Ordinal (no fabricated dollars — MERIDIAN_TRUST_MODEL.md), deterministic, and
// each carries its evidence, its reasoning, and its opportunity cost (what it beat).
// Only beliefs that clear the actionability bar become recommendations.

import type { Belief, Confidence, MomentumState, OpportunityStage } from "./types";
import { strategicWeight, type Memory } from "@/lib/memory/types";

export interface Recommendation {
  rank: number;
  subjectKey: string;
  subjectLabel: string;
  kind: string;
  action: string;
  why: string;
  waitingOn: string;
  stage: OpportunityStage;
  momentum: MomentumState;
  confidence: Confidence;
  changeLog: string;
  falsifier: string;
  evidence: Belief["evidence"];
  /** What choosing this displaces (the shadow-price sacrifice). */
  opportunityCost: string;
  leverage: number;
  /** Transparent memory influence — every memory that moved this ranking, shown. */
  memoryUsed: string[];
  memoryBoost: number;
  /** Surfaced when strategic memory says "important" but reality says "cooling". */
  memoryConflict: string | null;
}

const COLD = new Set<MomentumState>(["cooling", "cold", "dead"]);
const MEMORY_BOOST_CAP = 20; // memory can nudge, never dominate reality (urgency ≈ 100)

/** Does a memory apply to this belief? "subject" = named-entity match; "global" =
 *  a preference/strategic tag that appears in the belief's text. */
function memoryMatch(m: Memory, b: Belief): "subject" | "global" | null {
  const subj = m.subject.trim().toLowerCase();
  const hay = `${b.subjectKey} ${b.subjectLabel} ${b.company ?? ""}`.toLowerCase();
  const generic = subj === "global" || subj === "self" || subj === "dylan" || subj === "meridian";
  if (!generic && subj.length > 2) {
    if (hay.includes(subj)) return "subject";
    if (subj.split(/[\s/&]+/).some((w) => w.length > 3 && hay.includes(w))) return "subject";
  }
  if ((m.tags ?? []).some((t) => t.length > 3 && hay.includes(t.toLowerCase()))) return "global";
  return null;
}

const STAGE_URGENCY: Partial<Record<OpportunityStage, number>> = {
  follow_up_due: 100, waiting_on_me: 95, meeting_scheduled: 90, meeting_completed: 70,
  active_pipeline: 65, replied: 60, waiting_on_them: 60, discovered: 55, contacted: 50, stalled: 45,
};
const MOMENTUM_RANK: Record<MomentumState, number> = { accelerating: 5, warm: 4, cooling: 3, cold: 2, dead: 1 };
const CONFIDENCE_BONUS: Record<Confidence, number> = { high: 6, medium: 3, low: 1, unknown: 0 };

// Beliefs that are NOT actionable today.
const TERMINAL = new Set<OpportunityStage>(["rejected", "closed_won", "closed_lost", "watch"]);
// Only engaged relationships may be recommended (trust-model permission gate).
const ACTIONABLE_ENGAGEMENT = new Set(["two_way", "owner_initiated", "inbound_qualified"]);

/** Time pressure from the Temporal Intelligence Engine. A missed meeting and
 *  accumulating overdue days lift a belief up "Do this now" — inaction is itself
 *  a signal, so decay and missed commitments outrank a merely-warm thread. */
function temporalUrgency(b: Belief): number {
  const t = b.temporal;
  let u = 0;
  if (t.missedMeeting) u += 60; // a missed commitment is the most urgent thing there is
  u += Math.min(45, t.daysOverdue * 3); // overdue pressure, capped
  if (t.daysUntilDeadline === 0) u += 12; // something is due today
  if (t.decayRisk === "high") u += 8;
  return u;
}

function leverageOf(b: Belief): number {
  return (STAGE_URGENCY[b.stage] ?? 0) + MOMENTUM_RANK[b.momentum] * 4 + CONFIDENCE_BONUS[b.confidence] + temporalUrgency(b);
}

/** Apply memory to one belief's leverage, transparently. Returns the adjustment,
 *  the human-readable list of memories used, and any reality-vs-memory conflict. */
function applyMemory(b: Belief, memories: Memory[]): { boost: number; used: string[]; conflict: string | null } {
  const used: string[] = [];
  let boost = 0;
  let conflict: string | null = null;

  for (const m of memories) {
    if (m.status !== "active") continue; // pending/stale/rejected never influence ranking
    const match = memoryMatch(m, b);
    if (!match) continue;

    let w = strategicWeight(m); // facts = 0 (context only)
    if (match === "global") w *= 0.5;
    // Guardrail: important strategic memory vs cooling reality → surface, don't override.
    if (m.type === "strategic_knowledge" && strategicWeight(m) >= 5 && COLD.has(b.momentum)) {
      conflict = `Strategic memory remains high, but current momentum is ${b.momentum}.`;
      w *= 0.5;
    }
    boost += w;
    used.push(`${m.type}: ${m.statement} (${m.confidence}${w > 0 ? `, +${w.toFixed(1)}` : ", context"})`);
  }
  return { boost: Math.min(boost, MEMORY_BOOST_CAP), used, conflict };
}

export function recommendFromBeliefs(beliefs: Belief[], memories: Memory[] = []): Recommendation[] {
  const actionable = beliefs.filter(
    (b) => !TERMINAL.has(b.stage) && b.momentum !== "dead" && ACTIONABLE_ENGAGEMENT.has(b.engagement),
  );

  const ranked = actionable
    .map((b) => {
      const mem = applyMemory(b, memories);
      return { b, base: leverageOf(b), mem, adjusted: leverageOf(b) + mem.boost };
    })
    .sort((x, y) => (y.adjusted !== x.adjusted ? y.adjusted - x.adjusted : x.b.subjectKey.localeCompare(y.b.subjectKey)));

  return ranked.map(({ b, adjusted, mem }, i) => {
    const next = ranked[i + 1]?.b;
    const opportunityCost = next
      ? `Doing this first defers "${next.subjectLabel}" (${next.stage.replace(/_/g, " ")}), the next-best use of this slot.`
      : "No lower-ranked action competes for this slot right now.";
    return {
      rank: i + 1,
      subjectKey: b.subjectKey,
      subjectLabel: b.subjectLabel,
      kind: b.kind,
      action: b.nextAction,
      why: b.claim,
      waitingOn: b.waitingOn,
      stage: b.stage,
      momentum: b.momentum,
      confidence: b.confidence,
      changeLog: b.changeLog,
      falsifier: b.falsifier,
      evidence: b.evidence,
      opportunityCost,
      leverage: adjusted,
      memoryUsed: mem.used,
      memoryBoost: Math.round(mem.boost * 10) / 10,
      memoryConflict: mem.conflict,
    };
  });
}
