// Meridian Command — the nightly Daily Review. Deterministic.
//
// Reviews the day: what happened, what produced value, what failed, what changed,
// what surprised us, and what to believe differently tomorrow. Reuses the operator
// change detection; adds calibration + belief updates from real feedback.

import type { Belief, MomentumState } from "@/lib/beliefs/types";
import type { OperatorRun } from "@/lib/operator/types";
import type { DailySnapshot } from "@/lib/operator/types";
import { detectChanges } from "@/lib/operator/changeDetection";
import { accuracyOf, scoreRecommendations } from "./calibrate";
import type { BeliefUpdate, DailyReview, FeedbackEntry, OperatorMetrics } from "./types";

const MOMENTUM_RANK: Record<MomentumState, number> = { accelerating: 5, warm: 4, cooling: 3, cold: 2, dead: 1 };
const REGRESSED = new Set(["stalled", "rejected", "closed_lost"]);

/** Detect beliefs to update: today's outcome contradicts yesterday's belief. */
function detectBeliefUpdates(today: DailySnapshot, yesterday: DailySnapshot | null, feedback: FeedbackEntry[]): BeliefUpdate[] {
  if (!yesterday) return [];
  const prevByKey = new Map(yesterday.beliefs.map((b) => [b.subjectKey, b]));
  const negFeedback = new Set(feedback.filter((f) => f.feedback === "worse_than_expected").map((f) => f.subjectKey));
  const updates: BeliefUpdate[] = [];

  for (const b of today.beliefs) {
    const prev = prevByKey.get(b.subjectKey);
    if (!prev) continue;

    const stageRegressed = REGRESSED.has(b.stage) && !REGRESSED.has(prev.stage);
    const momentumDropped = MOMENTUM_RANK[b.momentum] < MOMENTUM_RANK[prev.momentum];
    const feltWorse = negFeedback.has(b.subjectKey);

    if (stageRegressed || feltWorse) {
      updates.push({
        subjectKey: b.subjectKey,
        subjectLabel: b.subjectLabel,
        oldBelief: prev.claim || `${prev.subjectLabel}: ${prev.stage} / ${prev.momentum}`,
        newBelief: b.claim || `${b.subjectLabel}: ${b.stage} / ${b.momentum}`,
        evidence: feltWorse ? "feedback: worse than expected" : `stage moved ${prev.stage} → ${b.stage}`,
        reason: feltWorse ? "outcome contradicted the recommendation" : "opportunity regressed on observed signals",
        confidence: feltWorse ? "high" : momentumDropped ? "medium" : "low",
      });
    }
  }
  return updates;
}

function operatorMetrics(latestRun: OperatorRun | null, feedbackCount: number, recCount: number, accuracyPct: number | null): OperatorMetrics {
  return {
    morningRanOk: latestRun ? latestRun.ok : null,
    notificationSent: latestRun ? latestRun.notification.sent : null,
    connectorFailures: latestRun?.incompleteConnectors ?? [],
    freshnessHours: latestRun?.freshnessHours ?? null,
    feedbackRate: recCount === 0 ? 0 : Math.round((feedbackCount / recCount) * 100) / 100,
    recommendationAccuracy: accuracyPct,
  };
}

export function buildDailyReview(args: {
  today: DailySnapshot;
  yesterday: DailySnapshot | null;
  feedback: FeedbackEntry[];
  latestRun: OperatorRun | null;
  generatedAt: string;
}): DailyReview {
  const { today, yesterday, feedback, latestRun } = args;
  const change = detectChanges(today, yesterday);
  const scores = scoreRecommendations(today.recommendations, feedback);
  const accuracy = accuracyOf(scores);
  const beliefUpdates = detectBeliefUpdates(today, yesterday, feedback);

  const producedValue = scores.filter((s) => s.verdict === "correct").map((s) => s.subjectLabel);
  const failed = scores.filter((s) => s.verdict === "incorrect").map((s) => s.subjectLabel);

  // Surprises: a top-3 recommendation that failed, or a belief that dropped to rejected.
  const surprises: string[] = [];
  for (const s of scores) if (s.verdict === "incorrect" && s.rank <= 3) surprises.push(`#${s.rank} ${s.subjectLabel} underperformed (${s.evidence})`);
  for (const b of today.beliefs) {
    const prev = yesterday?.beliefs.find((y: Belief) => y.subjectKey === b.subjectKey);
    if (b.stage === "rejected" && prev && prev.stage !== "rejected") surprises.push(`${b.subjectLabel} closed (rejected) unexpectedly`);
  }

  const believeDifferently = beliefUpdates.map((u) => `${u.subjectLabel}: ${u.newBelief} (${u.reason})`);

  const whatHappened = `${today.observationCount} observations · ${today.beliefs.length} beliefs · ` +
    `${today.recommendations.length} recommendations · ${feedback.length} feedback item(s). ${change.headline}`;

  return {
    date: today.date,
    ownerId: today.ownerId,
    generatedAt: args.generatedAt,
    summary: { observations: today.observationCount, beliefs: today.beliefs.length, recommendations: today.recommendations.length, feedbackCount: feedback.length },
    narrative: {
      whatHappened,
      producedValue,
      failed,
      opportunitiesChanged: change.stageChanges.map((s) => `${s.label}: ${s.from} → ${s.to}`),
      strengthened: change.strengthened,
      weakened: change.cooled,
      surprises,
      believeDifferently: believeDifferently.length ? believeDifferently : ["No belief revisions warranted by today's evidence."],
    },
    scores,
    beliefUpdates,
    accuracy,
    operatorMetrics: operatorMetrics(latestRun, feedback.length, today.recommendations.length, accuracy.accuracyPct),
  };
}
