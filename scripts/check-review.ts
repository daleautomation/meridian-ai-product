// Meridian Command — nightly review validation (pure, no DB).
//
// Proves calibration, belief updates, daily review, and weekly review are correct,
// honest (unknown when no feedback; no fabricated dollars), and deterministic.

import type { Belief } from "../lib/beliefs/types";
import type { Recommendation } from "../lib/beliefs/recommend";
import type { DailySnapshot } from "../lib/operator/types";
import type { FeedbackEntry } from "../lib/review/types";
import { accuracyOf, scoreRecommendations } from "../lib/review/calibrate";
import { buildDailyReview } from "../lib/review/nightly";
import { buildWeeklyReview } from "../lib/review/weekly";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else { console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); failed += 1; }
}

function belief(subjectKey: string, subjectLabel: string, stage: Belief["stage"], momentum: Belief["momentum"]): Belief {
  return {
    subjectKey, subjectLabel, kind: "career", company: null, people: [], stage, status: "warm",
    momentum, momentumDelta: "flat", waitingOn: "them", confidence: "medium", engagement: "two_way",
    heat: "WARM", domain: null,
    firstActivityAt: "2026-07-01T00:00:00Z", lastActivityAt: "2026-07-06T00:00:00Z", observationCount: 3,
    latestInboundAt: null, latestOutboundAt: null, latestMeetingAt: null, nextAction: "", followUpDate: null,
    connectors: ["gmail"], claim: `${subjectLabel}: ${stage} / ${momentum}`, falsifier: "", changeLog: "",
    statusHistory: [], lastScanAt: "2026-07-06T00:00:00Z", evidence: [],
  };
}
function rec(subjectKey: string, subjectLabel: string, rank: number): Recommendation {
  return { rank, subjectKey, subjectLabel, kind: "career", action: "", why: "", waitingOn: "them",
    stage: "waiting_on_them", momentum: "warm", confidence: "medium", changeLog: "", falsifier: "", evidence: [], opportunityCost: "", leverage: 0, memoryUsed: [], memoryBoost: 0, memoryConflict: null };
}
function snap(date: string, beliefs: Belief[], recs: Recommendation[]): DailySnapshot {
  return { date, ownerId: "dylan", generatedAt: `${date}T20:00:00Z`, observationCount: 20, connectors: [], beliefs, recommendations: recs, brief: {} as never };
}
function fb(subjectKey: string, subjectLabel: string, feedback: FeedbackEntry["feedback"]): FeedbackEntry {
  return { ownerId: "dylan", subjectKey, subjectLabel, feedback, rank: null, recordedAt: "2026-07-07T18:00:00Z" };
}

// ── Calibration ──────────────────────────────────────────────────────────────
const recs = [rec("clue", "Clue", 1), rec("acme", "Acme", 2), rec("blake", "Blake", 3), rec("soft", "SoftDoes", 4)];
const feedback = [fb("clue", "Clue", "better_than_expected"), fb("acme", "Acme", "worse_than_expected"), fb("blake", "Blake", "did_this")];
const scores = scoreRecommendations(recs, feedback);

check("better_than_expected → correct", scores.find((s) => s.subjectKey === "clue")?.verdict === "correct");
check("worse_than_expected → incorrect", scores.find((s) => s.subjectKey === "acme")?.verdict === "incorrect");
check("did_this → partially_correct", scores.find((s) => s.subjectKey === "blake")?.verdict === "partially_correct");
check("no feedback → unknown (never fabricated)", scores.find((s) => s.subjectKey === "soft")?.verdict === "unknown");

const acc = accuracyOf(scores);
check("accuracy excludes unknown from denominator", acc.scored === 3 && acc.unknown === 1, acc);
check("accuracy percentage computed honestly", acc.accuracyPct === Math.round(((1 + 0.5) / 3) * 100), acc.accuracyPct);

const noFeedbackScores = scoreRecommendations(recs, []);
check("no feedback at all → accuracy null (honest unknown)", accuracyOf(noFeedbackScores).accuracyPct === null);

// ── Daily review + belief updates ────────────────────────────────────────────
const yesterday = snap("2026-07-06",
  [belief("clue", "Clue", "waiting_on_them", "warm"), belief("acme", "Acme", "waiting_on_them", "warm"), belief("blake", "Blake", "waiting_on_them", "accelerating")],
  [rec("clue", "Clue", 1)]);
const today = snap("2026-07-07",
  [belief("clue", "Clue", "meeting_completed", "accelerating"), belief("acme", "Acme", "waiting_on_them", "cooling"), belief("blake", "Blake", "stalled", "cold")],
  recs);

const review = buildDailyReview({ today, yesterday, feedback, latestRun: null, generatedAt: "2026-07-07T22:00:00Z" });
check("produced value lists Clue", review.narrative.producedValue.includes("Clue"), review.narrative.producedValue);
check("failed lists Acme", review.narrative.failed.includes("Acme"), review.narrative.failed);
check("opportunity change detected (Clue advanced)", review.narrative.opportunitiesChanged.some((c) => c.includes("Clue")), review.narrative.opportunitiesChanged);
check("belief update on Acme (worse feedback contradicts)", review.beliefUpdates.some((u) => u.subjectKey === "acme" && u.confidence === "high"), review.beliefUpdates);
check("belief update on Blake (stage regressed to stalled)", review.beliefUpdates.some((u) => u.subjectKey === "blake"), review.beliefUpdates);
check("belief update records old + new belief", review.beliefUpdates.every((u) => u.oldBelief.length > 0 && u.newBelief.length > 0));
check("surprise flagged for top-3 failure (Acme #2)", review.narrative.surprises.some((s) => s.includes("Acme")), review.narrative.surprises);
check("believeDifferently is populated", review.narrative.believeDifferently.length > 0 && !/No belief revisions/.test(review.narrative.believeDifferently[0]));
check("daily review is deterministic", JSON.stringify(buildDailyReview({ today, yesterday, feedback, latestRun: null, generatedAt: "2026-07-07T22:00:00Z" })) === JSON.stringify(review));

// ── Weekly review ────────────────────────────────────────────────────────────
const weekly = buildWeeklyReview([review], "2026-07-12", "2026-07-12T22:00:00Z", "dylan");
check("weekly biggest wins includes Clue", weekly.biggestWins.includes("Clue"), weekly.biggestWins);
check("weekly biggest misses includes Acme", weekly.biggestMisses.includes("Acme"), weekly.biggestMisses);
check("weekly names most valuable relationship", weekly.mostValuableRelationship !== null);
check("weekly revenue is honest (no fabricated dollars)", !/\$\d/.test(weekly.revenueGenerated) && /Not tracked in dollars/.test(weekly.revenueGenerated));
check("weekly suggests what to optimize next", weekly.optimizeNextWeek.length > 0);

if (failed > 0) { console.error(`\n[check-review] ${failed} check(s) FAILED`); process.exitCode = 1; }
else console.log("\n[check-review] all checks passed");
