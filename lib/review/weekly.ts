// Meridian Command — the Sunday Weekly Review. Deterministic aggregation over the
// week's Daily Reviews. No fabricated dollars; revenue is stated honestly.

import type { DailyReview, WeeklyReview } from "./types";

function tally(items: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function buildWeeklyReview(reviews: DailyReview[], weekEnding: string, generatedAt: string, ownerId = "dylan"): WeeklyReview {
  // reviews: the last up-to-7 daily reviews (any order).
  const wins = reviews.flatMap((r) => r.narrative.producedValue);
  const misses = reviews.flatMap((r) => r.narrative.failed);
  const strengthened = reviews.flatMap((r) => r.narrative.strengthened);
  const advanced = reviews.flatMap((r) => r.narrative.opportunitiesChanged.map((c) => c.split(":")[0].trim()));
  const lessons = Array.from(new Set(reviews.flatMap((r) => r.narrative.believeDifferently)))
    .filter((l) => !/No belief revisions/.test(l));

  const winTally = tally(wins);
  const missTally = tally(misses);
  const relationshipTally = tally([...wins, ...strengthened]);
  const advancedTally = tally(advanced);

  // Optimize-next signals from operator metrics across the week.
  const optimize: string[] = [];
  const avgFeedback = reviews.length ? reviews.reduce((a, r) => a + r.operatorMetrics.feedbackRate, 0) / reviews.length : 0;
  if (avgFeedback < 0.5) optimize.push("Tap the feedback buttons more — low feedback rate means Meridian can't calibrate.");
  const anyConnectorFail = reviews.some((r) => r.operatorMetrics.connectorFailures.length > 0);
  if (anyConnectorFail) optimize.push("A connector was incomplete on some days — check /home/status.");
  const anyStale = reviews.some((r) => (r.operatorMetrics.freshnessHours ?? 99) > 36);
  if (anyStale) optimize.push("Reality data went stale on some days — refresh the inbox batches more often.");
  if (missTally.length) optimize.push(`Investigate repeated misses: ${missTally.slice(0, 3).map(([k]) => k).join(", ")}.`);
  if (optimize.length === 0) optimize.push("Hold course — the loop is healthy; keep feeding feedback.");

  const scoredWins = reviews.reduce((a, r) => a + r.accuracy.correct, 0);
  const revenueGenerated =
    `Not tracked in dollars — no calibrated revenue evidence yet. This week: ${scoredWins} recommendation(s) ` +
    `confirmed as producing value via feedback. Dollar tracking unlocks once outcomes are recorded with amounts.`;

  return {
    weekEnding,
    ownerId,
    generatedAt,
    daysReviewed: reviews.length,
    biggestWins: winTally.slice(0, 3).map(([k, n]) => (n > 1 ? `${k} (×${n})` : k)),
    biggestMisses: missTally.slice(0, 3).map(([k, n]) => (n > 1 ? `${k} (×${n})` : k)),
    mostValuableRelationship: relationshipTally[0]?.[0] ?? null,
    mostImprovedOpportunity: advancedTally[0]?.[0] ?? null,
    revenueGenerated,
    lessonsLearned: lessons.slice(0, 6),
    optimizeNextWeek: optimize.slice(0, 5),
  };
}
