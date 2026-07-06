// Meridian Command — recommendations from beliefs.
//
// Ordinal (no fabricated dollars — MERIDIAN_TRUST_MODEL.md), deterministic, and
// each carries its evidence, its reasoning, and its opportunity cost (what it beat).
// Only beliefs that clear the actionability bar become recommendations.

import type { Belief, Confidence, MomentumState, OpportunityStage } from "./types";

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

function actionFor(b: Belief): string {
  const who = b.subjectLabel;
  switch (b.stage) {
    case "waiting_on_me":
    case "follow_up_due":
      return `Reply to ${who} — you owe the response (since ${b.lastActivityAt.slice(0, 10)}).`;
    case "meeting_scheduled":
      return `Prepare for the scheduled meeting with ${who}.`;
    case "meeting_completed":
      return `Hold — your follow-up with ${who} is out; nudge once if silent in ~3 days.`;
    case "waiting_on_them":
      return `Give ${who} a short window; nudge if no reply in a few days.`;
    case "stalled":
      return `Send a light re-engagement nudge to ${who}.`;
    case "contacted":
      return `Follow up with ${who} — no reply yet.`;
    case "discovered":
      return `Reply to ${who} and qualify the opportunity.`;
    default:
      return `Review the ${who} thread and decide next step.`;
  }
}

function leverageOf(b: Belief): number {
  return (STAGE_URGENCY[b.stage] ?? 0) + MOMENTUM_RANK[b.momentum] * 4 + CONFIDENCE_BONUS[b.confidence];
}

export function recommendFromBeliefs(beliefs: Belief[]): Recommendation[] {
  const actionable = beliefs.filter(
    (b) => !TERMINAL.has(b.stage) && b.momentum !== "dead" && ACTIONABLE_ENGAGEMENT.has(b.engagement),
  );

  const ranked = actionable
    .map((b) => ({ b, leverage: leverageOf(b) }))
    .sort((x, y) => (y.leverage !== x.leverage ? y.leverage - x.leverage : x.b.subjectKey.localeCompare(y.b.subjectKey)));

  return ranked.map(({ b, leverage }, i) => {
    const next = ranked[i + 1]?.b;
    const opportunityCost = next
      ? `Doing this first defers "${next.subjectLabel}" (${next.stage.replace(/_/g, " ")}), the next-best use of this slot.`
      : "No lower-ranked action competes for this slot right now.";
    return {
      rank: i + 1,
      subjectKey: b.subjectKey,
      subjectLabel: b.subjectLabel,
      kind: b.kind,
      action: actionFor(b),
      why: b.claim,
      waitingOn: b.waitingOn,
      stage: b.stage,
      momentum: b.momentum,
      confidence: b.confidence,
      changeLog: b.changeLog,
      falsifier: b.falsifier,
      evidence: b.evidence,
      opportunityCost,
      leverage,
    };
  });
}
