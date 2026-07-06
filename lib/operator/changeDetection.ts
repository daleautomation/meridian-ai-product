// Meridian Command — day-over-day change detection. Deterministic.
//
// Answers the morning questions: what changed, which belief moved, which
// recommendation moved, which cooled, which strengthened — by diffing today's
// snapshot against the previous one.

import type { MomentumState } from "@/lib/beliefs/types";
import type { ChangeReport, DailySnapshot } from "./types";

const MOMENTUM_RANK: Record<MomentumState, number> = { accelerating: 5, warm: 4, cooling: 3, cold: 2, dead: 1 };

export function detectChanges(today: DailySnapshot, previous: DailySnapshot | null): ChangeReport {
  const date = today.date;
  if (!previous) {
    return {
      date, comparedTo: null,
      newBeliefs: today.beliefs.map((b) => b.subjectLabel),
      droppedBeliefs: [], stageChanges: [], strengthened: [], cooled: [],
      recommendationMoves: [],
      headline: "First snapshot — establishing the baseline. Tomorrow shows what moved.",
    };
  }

  const prevByKey = new Map(previous.beliefs.map((b) => [b.subjectKey, b]));
  const todayByKey = new Map(today.beliefs.map((b) => [b.subjectKey, b]));

  const newBeliefs: string[] = [];
  const stageChanges: ChangeReport["stageChanges"] = [];
  const strengthened: string[] = [];
  const cooled: string[] = [];

  for (const b of today.beliefs) {
    const prev = prevByKey.get(b.subjectKey);
    if (!prev) { newBeliefs.push(b.subjectLabel); continue; }
    if (prev.stage !== b.stage) stageChanges.push({ label: b.subjectLabel, from: prev.stage, to: b.stage });
    const d = MOMENTUM_RANK[b.momentum] - MOMENTUM_RANK[prev.momentum];
    if (d > 0) strengthened.push(b.subjectLabel);
    else if (d < 0) cooled.push(b.subjectLabel);
  }

  const droppedBeliefs = previous.beliefs
    .filter((b) => !todayByKey.has(b.subjectKey))
    .map((b) => b.subjectLabel);

  // Recommendation rank moves (by subject).
  const prevRank = new Map(previous.recommendations.map((r) => [r.subjectKey, r.rank]));
  const todayRank = new Map(today.recommendations.map((r) => [r.subjectKey, r.rank]));
  const recommendationMoves: ChangeReport["recommendationMoves"] = [];
  const labels = new Map<string, string>();
  [...previous.recommendations, ...today.recommendations].forEach((r) => labels.set(r.subjectKey, r.subjectLabel));
  for (const key of new Set([...prevRank.keys(), ...todayRank.keys()])) {
    const from = prevRank.get(key) ?? "—";
    const to = todayRank.get(key) ?? "—";
    if (from !== to) recommendationMoves.push({ label: labels.get(key) ?? key, from, to });
  }
  recommendationMoves.sort((a, b) => (a.to === "—" ? 99 : a.to) - (b.to === "—" ? 99 : b.to));

  const parts: string[] = [];
  if (newBeliefs.length) parts.push(`${newBeliefs.length} new`);
  if (stageChanges.length) parts.push(`${stageChanges.length} stage change(s)`);
  if (strengthened.length) parts.push(`${strengthened.length} strengthening`);
  if (cooled.length) parts.push(`${cooled.length} cooling`);
  const headline = parts.length ? `Since ${previous.date}: ${parts.join(", ")}.` : `No material change since ${previous.date}.`;

  return { date, comparedTo: previous.date, newBeliefs, droppedBeliefs, stageChanges, strengthened, cooled, recommendationMoves, headline };
}
