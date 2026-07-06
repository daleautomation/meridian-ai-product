// Meridian Command — operator autonomy validation (pure, no DB).
//
// Verifies the deterministic autonomy logic: day-over-day change detection, the
// self-health record, and env presence. Store I/O (Neon/file) is exercised by the
// live run; here we prove the brains are correct and stable.

import type { Belief } from "../lib/beliefs/types";
import type { Recommendation } from "../lib/beliefs/recommend";
import type { RealityResult } from "../lib/home/pipeline";
import type { DailySnapshot } from "../lib/operator/types";
import { detectChanges } from "../lib/operator/changeDetection";
import { buildRun, envPresence } from "../lib/operator/health";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else { console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); failed += 1; }
}

function belief(p: Partial<Belief> & Pick<Belief, "subjectKey" | "subjectLabel" | "stage" | "momentum">): Belief {
  return {
    kind: "career", company: null, people: [], status: "warm", momentumDelta: "flat",
    waitingOn: "them", confidence: "medium", engagement: "two_way",
    firstActivityAt: "2026-07-01T00:00:00Z", lastActivityAt: "2026-07-06T00:00:00Z",
    observationCount: 3, connectors: ["gmail"], claim: "", falsifier: "", changeLog: "", evidence: [],
    ...p,
  };
}
function rec(subjectKey: string, subjectLabel: string, rank: number): Recommendation {
  return {
    rank, subjectKey, subjectLabel, kind: "career", action: "", why: "", waitingOn: "them",
    stage: "waiting_on_them", momentum: "warm", confidence: "medium", changeLog: "", falsifier: "",
    evidence: [], opportunityCost: "", leverage: 100 - rank,
  };
}
function snap(date: string, beliefs: Belief[], recommendations: Recommendation[]): DailySnapshot {
  return { date, ownerId: "dylan", generatedAt: `${date}T12:00:00Z`, observationCount: 10, connectors: [], beliefs, recommendations, brief: {} as never };
}

// Day 1 baseline, Day 2 with: Clue stage advance, Blake cooled, ContactLoop new, SoftDoes dropped.
const day1 = snap("2026-07-06",
  [belief({ subjectKey: "clue insights", subjectLabel: "Clue Insights", stage: "waiting_on_them", momentum: "warm" }),
   belief({ subjectKey: "quext / ownerlm", subjectLabel: "Quext / OwnerLM", stage: "waiting_on_them", momentum: "accelerating" }),
   belief({ subjectKey: "softdoes", subjectLabel: "SoftDoes", stage: "follow_up_due", momentum: "cold" })],
  [rec("clue insights", "Clue Insights", 1), rec("quext / ownerlm", "Quext / OwnerLM", 2), rec("softdoes", "SoftDoes", 3)]);

const day2 = snap("2026-07-07",
  [belief({ subjectKey: "clue insights", subjectLabel: "Clue Insights", stage: "meeting_completed", momentum: "accelerating" }),
   belief({ subjectKey: "quext / ownerlm", subjectLabel: "Quext / OwnerLM", stage: "waiting_on_them", momentum: "cooling" }),
   belief({ subjectKey: "onramplab.com", subjectLabel: "ContactLoop", stage: "meeting_scheduled", momentum: "warm" })],
  [rec("onramplab.com", "ContactLoop", 1), rec("clue insights", "Clue Insights", 2), rec("quext / ownerlm", "Quext / OwnerLM", 3)]);

// First run → baseline.
const first = detectChanges(day1, null);
check("first run establishes baseline (comparedTo null)", first.comparedTo === null && first.newBeliefs.length === 3, first);

const change = detectChanges(day2, day1);
check("compares to yesterday", change.comparedTo === "2026-07-06");
check("detects new belief (ContactLoop)", change.newBeliefs.includes("ContactLoop"), change.newBeliefs);
check("detects dropped belief (SoftDoes)", change.droppedBeliefs.includes("SoftDoes"), change.droppedBeliefs);
check("detects Clue stage advance", change.stageChanges.some((s) => s.label === "Clue Insights" && s.to === "meeting_completed"), change.stageChanges);
check("detects Clue strengthened (momentum up)", change.strengthened.includes("Clue Insights"), change.strengthened);
check("detects OwnerLM cooled (momentum down)", change.cooled.includes("Quext / OwnerLM"), change.cooled);
check("detects recommendation move (ContactLoop → #1)", change.recommendationMoves.some((m) => m.label === "ContactLoop" && m.to === 1), change.recommendationMoves);
check("headline summarizes change", /Since 2026-07-06/.test(change.headline), change.headline);
check("change detection is deterministic", JSON.stringify(detectChanges(day2, day1)) === JSON.stringify(change));

// Self-health.
const fakeResult = {
  results: [
    { connector: "gmail", collected: 28, health: { state: "ok" } },
    { connector: "google-calendar", collected: 3, health: { state: "ok" } },
    { connector: "google-contacts", collected: 0, health: { state: "degraded" } },
    { connector: "linkedin", collected: 4, health: { state: "ok" } },
  ],
} as unknown as RealityResult;

const runFresh = buildRun({
  ownerId: "dylan", trigger: "cron", runAtMs: Date.parse("2026-07-07T12:00:00Z"), result: fakeResult,
  notification: { sent: true, channel: "ntfy", detail: "ok" },
  freshness: { gmail: "2026-07-07T06:00:00Z", calendar: "2026-07-07T06:00:00Z" },
  storage: "neon", changeHeadline: change.headline,
});
check("healthy run when gmail ok + notified + fresh", runFresh.ok === true, runFresh);
check("degraded contacts does NOT fail the run", !runFresh.incompleteConnectors.includes("google-contacts"), runFresh.incompleteConnectors);
check("freshness computed in hours", runFresh.freshnessHours === 6, runFresh.freshnessHours);

const runStale = buildRun({
  ownerId: "dylan", trigger: "cron", runAtMs: Date.parse("2026-07-10T12:00:00Z"), result: fakeResult,
  notification: { sent: false, channel: "none", detail: "no channel" },
  freshness: { gmail: "2026-07-07T06:00:00Z", calendar: null },
  storage: "file", changeHeadline: "",
});
check("stale data flips run unhealthy", runStale.ok === false && runStale.stale, runStale);

const env = envPresence();
check("env presence returns booleans", typeof env.cronSecret === "boolean" && typeof env.notificationChannel === "boolean" && typeof env.databaseUrl === "boolean");

if (failed > 0) { console.error(`\n[check-operator] ${failed} check(s) FAILED`); process.exitCode = 1; }
else console.log("\n[check-operator] all checks passed");
