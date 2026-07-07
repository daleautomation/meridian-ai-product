// Meridian — Temporal Intelligence Engine validation (pure, no DB).
//
// Proves the temporal reasoner is correct and deterministic: meeting-datetime
// parsing, MISSED-meeting classification, deadline-language inference, aging bands,
// the recovery estimate's decay, and the dashboard centers (overdue / urgency).

import { parseMeetingTime, classifyMeeting } from "../lib/temporal/meetings";
import { inferExpectedResponse } from "../lib/temporal/deadlines";
import {
  agingBandOf, timeHeatOf, impactScoreOf, recoveryProbabilityOf,
  computeTemporalProfile, defaultTemporalProfile, type TemporalInput,
} from "../lib/temporal/engine";
import { buildOverdueCenter, buildUrgencyLede, buildUpcomingRiskCenter } from "../lib/temporal/centers";
import type { Belief } from "../lib/beliefs/types";
import type { TemporalProfile } from "../lib/temporal/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else { console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); failed += 1; }
}

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-07T13:00:00Z");

// ── 1. Meeting-datetime parsing (the SoftDoes gap) ──────────────────────────
const soft = parseMeetingTime("Invitation from an unknown sender: Dylan Dale and SoftDoes @ Tue Jun 9, 2026 1:30pm - 2pm (CDT)");
check("parses the SoftDoes invite datetime", soft !== null && new Date(soft.startMs).toISOString() === "2026-06-09T18:30:00.000Z", soft && new Date(soft.startMs).toISOString());
check("parses the meeting end time", soft?.endMs !== null && new Date(soft!.endMs!).toISOString() === "2026-06-09T19:00:00.000Z");
check("honours the stated timezone (CDT)", soft?.tz === "CDT");
check("no false positive on plain text", parseMeetingTime("thanks for applying, we'll review your application") === null);

// ── 2. Meeting lifecycle: MISSED vs COMPLETED ───────────────────────────────
const pastStart = NOW - 20 * DAY;
const missed = classifyMeeting({ id: "m1", startMs: pastStart, endMs: pastStart + 1800_000, status: "confirmed", source: "gmail" }, [], NOW);
check("past meeting with NO evidence → MISSED", missed.lifecycle === "missed", missed.lifecycle);
const completed = classifyMeeting({ id: "m2", startMs: pastStart, endMs: pastStart + 1800_000, status: "confirmed", source: "gmail" }, [pastStart + DAY], NOW);
check("past meeting with a follow-up after it → COMPLETED", completed.lifecycle === "completed", completed.lifecycle);
const future = classifyMeeting({ id: "m3", startMs: NOW + 2 * DAY, endMs: null, status: "confirmed", source: "calendar" }, [], NOW);
check("future meeting → SCHEDULED", future.lifecycle === "scheduled", future.lifecycle);
const cancelled = classifyMeeting({ id: "m4", startMs: pastStart, endMs: null, status: "cancelled", source: "calendar" }, [], NOW);
check("cancelled meeting → CANCELLED (never missed)", cancelled.lifecycle === "cancelled", cancelled.lifecycle);

// ── 3. Deadline-language inference ──────────────────────────────────────────
const from = Date.parse("2026-07-06T15:00:00Z");
const early = inferExpectedResponse("Thanks — I'll get back to you early next week.", from);
check("'early next week' → a Tuesday, medium confidence", early !== null && new Date(early.atMs).getUTCDay() === 2 && early.confidence === "medium", early);
const byFri = inferExpectedResponse("I'll have an answer by Friday.", from);
check("'by Friday' → a Friday, high confidence", byFri !== null && new Date(byFri.atMs).getUTCDay() === 5 && byFri.confidence === "high", byFri);
const fewDays = inferExpectedResponse("Give me a few days to review.", from);
check("'a few days' → +3 days", fewDays?.horizonDays === 3, fewDays);
const tomorrow = inferExpectedResponse("Circling back tomorrow.", from);
check("'tomorrow' → +1 day", tomorrow?.horizonDays === 1, tomorrow);
check("no timeframe language → null", inferExpectedResponse("Sounds good, thanks!", from) === null);

// ── 4. Aging bands & time heat ──────────────────────────────────────────────
check("aging: 0–3d green", agingBandOf(0) === "green" && agingBandOf(3) === "green");
check("aging: 4–7d yellow", agingBandOf(4) === "yellow" && agingBandOf(7) === "yellow");
check("aging: 8–14d orange", agingBandOf(8) === "orange" && agingBandOf(14) === "orange");
check("aging: 15–29d red", agingBandOf(15) === "red" && agingBandOf(29) === "red");
check("aging: 30d+ black", agingBandOf(30) === "black" && agingBandOf(90) === "black");
check("aging: null (no activity) → black", agingBandOf(null) === "black");
check("time heat: fresh→dead by days", timeHeatOf(2) === "fresh" && timeHeatOf(6) === "warming" && timeHeatOf(12) === "cooling" && timeHeatOf(25) === "stale" && timeHeatOf(50) === "dormant" && timeHeatOf(90) === "dead");

// ── 5. Recovery estimate decays with days overdue ───────────────────────────
const r7 = recoveryProbabilityOf(7, "two_way");
const r28 = recoveryProbabilityOf(28, "two_way");
check("recovery decays as overdue grows", r7 > r28 && r28 > 0 && r7 < 1, { r7, r28 });
check("recovery ~34% near 31d overdue (matches the spec example)", Math.abs(recoveryProbabilityOf(31, "two_way") - 0.34) < 0.06, recoveryProbabilityOf(31, "two_way"));
check("impact score is ordinal + bounded", impactScoreOf("career", "meeting_completed", "accelerating", "high") > impactScoreOf("unknown", "watch", "dead", "unknown"));

// ── 6. computeTemporalProfile end-to-end (a missed meeting) ─────────────────
const missInput: TemporalInput = {
  createdAtMs: NOW - 40 * DAY,
  lastInboundMs: NOW - 28 * DAY,
  lastOutboundMs: null,
  comms: [{ ts: NOW - 28 * DAY, direction: "inbound", text: "calendar invite" }],
  meetings: [{ id: "mtg", startMs: NOW - 28 * DAY, endMs: null, status: "confirmed", source: "gmail" }],
  stage: "follow_up_due", momentum: "cold", kind: "partnership", confidence: "medium",
  waitingOn: "me", engagement: "inbound_qualified", statusChangedAtMs: NOW - 28 * DAY,
};
const prof = computeTemporalProfile(missInput, NOW);
check("profile detects the missed meeting", prof.missedMeeting !== null, prof.missedMeeting?.lifecycle);
check("profile days overdue = 28", prof.daysOverdue === 28, prof.daysOverdue);
check("profile aging = red at 28d", prof.aging === "red", prof.aging);
check("profile decay risk = high (missed)", prof.decayRisk === "high", prof.decayRisk);
check("profile recovery is an estimate in (0,1)", prof.recoveryProbability !== null && prof.recoveryProbability > 0 && prof.recoveryProbability < 1, prof.recoveryProbability);
check("profile records createdAt / lastInbound / relationshipAge", prof.createdAt !== null && prof.lastInbound !== null && prof.relationshipAge === 40, prof.relationshipAge);
check("temporal profile is deterministic", JSON.stringify(computeTemporalProfile(missInput, NOW)) === JSON.stringify(prof));

// ── 7. Dashboard centers ────────────────────────────────────────────────────
function beliefWith(subjectKey: string, label: string, kind: Belief["kind"], temporal: TemporalProfile): Belief {
  return {
    subjectKey, subjectLabel: label, kind, company: null, people: [], stage: "follow_up_due", status: "waiting",
    momentum: "cold", momentumDelta: "flat", waitingOn: "me", confidence: "medium", engagement: "inbound_qualified",
    heat: "COLD", domain: null, firstActivityAt: "2026-06-01T00:00:00Z", lastActivityAt: "2026-06-09T00:00:00Z",
    latestInboundAt: null, latestOutboundAt: null, latestMeetingAt: null, nextAction: `Reach out to ${label}.`,
    followUpDate: null, observationCount: 2, connectors: ["gmail"], claim: "", falsifier: "", changeLog: "",
    statusHistory: [], lastScanAt: new Date(NOW).toISOString(), temporal, evidence: [],
  };
}
const missedBelief = beliefWith("softdoes", "SoftDoes", "partnership", prof);
const freshBelief = beliefWith("acme", "Acme", "sales", defaultTemporalProfile(NOW));
const overdue = buildOverdueCenter([missedBelief, freshBelief]);
check("overdue center includes the missed relationship", overdue.some((o) => o.subjectKey === "softdoes" && o.reason === "Missed meeting"), overdue.map((o) => `${o.label}:${o.reason}`));
check("overdue center excludes the current one", !overdue.some((o) => o.subjectKey === "acme"));
check("overdue item carries a recovery estimate + expected action", overdue[0].recoveryProbability !== null && overdue[0].expectedAction.length > 0);
const urgency = buildUrgencyLede([missedBelief, freshBelief]);
check("urgency lede leads with the missed meeting", urgency.length > 0 && urgency[0].kind === "missed_meeting", urgency[0]);
check("urgency message names the relationship + days overdue", /SoftDoes/.test(urgency[0].message) && /28 days overdue/.test(urgency[0].message), urgency[0].message);
check("centers are deterministic", JSON.stringify(buildOverdueCenter([missedBelief, freshBelief])) === JSON.stringify(overdue));
void buildUpcomingRiskCenter([missedBelief]); // smoke: must not throw

if (failed > 0) { console.error(`\n[check-temporal] ${failed} check(s) FAILED`); process.exitCode = 1; }
else console.log("\n[check-temporal] all checks passed");
