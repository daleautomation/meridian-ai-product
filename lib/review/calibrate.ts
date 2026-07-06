// Meridian Command — recommendation calibration. Deterministic, never fabricated.
//
// Maps Dylan's feedback onto a verdict per recommendation. Absence of feedback is
// "unknown" — a valid, honest answer, not a guess.

import type { Recommendation } from "@/lib/beliefs/recommend";
import type { FeedbackEntry, RecommendationScore, Verdict } from "./types";

/** Aggregate feedback for one subject → verdict. worse dominates; then better;
 *  then acted; then deferred/none → unknown. */
function verdictFor(items: FeedbackEntry[]): { verdict: Verdict; evidence: string } {
  if (items.length === 0) return { verdict: "unknown", evidence: "no feedback recorded" };
  const kinds = new Set(items.map((i) => i.feedback));
  if (kinds.has("worse_than_expected")) return { verdict: "incorrect", evidence: "marked worse than expected" };
  if (kinds.has("better_than_expected")) return { verdict: "correct", evidence: "marked better than expected" };
  if (kinds.has("did_this")) return { verdict: "partially_correct", evidence: "acted on, outcome not yet rated" };
  if (kinds.has("ignored")) return { verdict: "unknown", evidence: "ignored — could be wrong or merely deferred" };
  return { verdict: "unknown", evidence: "no conclusive feedback" };
}

export function scoreRecommendations(recs: Recommendation[], feedback: FeedbackEntry[]): RecommendationScore[] {
  const byKey = new Map<string, FeedbackEntry[]>();
  for (const f of feedback) (byKey.get(f.subjectKey) ?? byKey.set(f.subjectKey, []).get(f.subjectKey)!).push(f);

  return recs.map((r) => {
    const { verdict, evidence } = verdictFor(byKey.get(r.subjectKey) ?? []);
    return { subjectKey: r.subjectKey, subjectLabel: r.subjectLabel, rank: r.rank, verdict, evidence };
  });
}

export function accuracyOf(scores: RecommendationScore[]): {
  correct: number; partial: number; incorrect: number; unknown: number; scored: number; accuracyPct: number | null;
} {
  const correct = scores.filter((s) => s.verdict === "correct").length;
  const partial = scores.filter((s) => s.verdict === "partially_correct").length;
  const incorrect = scores.filter((s) => s.verdict === "incorrect").length;
  const unknown = scores.filter((s) => s.verdict === "unknown").length;
  const scored = correct + partial + incorrect; // exclude unknown from accuracy denominator
  const accuracyPct = scored === 0 ? null : Math.round(((correct + 0.5 * partial) / scored) * 100);
  return { correct, partial, incorrect, unknown, scored, accuracyPct };
}
