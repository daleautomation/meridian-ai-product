// Meridian Command — Gmail scanner validation.
//
// Runs the deterministic scanner over the bundled fixture (no live Gmail needed)
// and asserts the invariants that matter: Clue Insights is detected with the
// correct stage, evidence is attached, noise is dropped, and the scan is
// deterministic. Follows the check-*.ts convention (check(label, ok) + exit code).

import { promises as fs } from "node:fs";
import path from "node:path";
import { scanThreads } from "../lib/gmail/scan";
import type { GmailThreadBatch } from "../lib/gmail/types";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else {
    console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
    failed += 1;
  }
}

async function main(): Promise<void> {
  const NOW = Date.parse("2026-07-07T00:00:00.000Z"); // fixed → deterministic stages
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), "fixtures/gmail/sample-threads.json"), "utf8"));
  const batch = raw as GmailThreadBatch;

  const result = scanThreads(batch, { nowMs: NOW });
  console.log("[check-gmail-scan]", {
    threads: result.threadsScanned,
    opportunities: result.opportunities.length,
    droppedAsNoise: result.droppedAsNoise,
    unknown: result.unknown,
    keys: result.opportunities.map((o) => `${o.key}:${o.stage}`),
  });

  const clue = result.opportunities.find((o) => o.company.toLowerCase().includes("clue"));

  // Clue Insights — the explicit requirement.
  check("Clue Insights opportunity detected", !!clue, result.opportunities.map((o) => o.company));
  if (clue) {
    check("Clue collapsed all threads into one opportunity", clue.threadIds.length >= 3, clue.threadIds);
    check("Clue current stage is meeting_completed", clue.stage === "meeting_completed", clue.stage);
    check("Clue is waiting on them (I followed up last)", clue.waitingOn === "them", clue.waitingOn);
    check("Clue momentum is hot (accelerating/warm)", ["accelerating", "warm"].includes(clue.momentum), clue.momentum);
    check("Clue kind is career", clue.kind === "career", clue.kind);
    check("Clue has evidence with real thread ids", clue.evidence.length > 0 && clue.evidence.every((e) => e.threadId && e.messageId), clue.evidence.length);
    check("Clue evidence includes the July 6 follow-up", clue.evidence.some((e) => e.date.startsWith("2026-07-06")), clue.evidence.map((e) => e.date));
    check("Clue last outbound is the July 6 follow-up", clue.lastOutboundAt?.startsWith("2026-07-06") ?? false, clue.lastOutboundAt);
    check("Clue has a concrete next action", clue.nextAction.length > 0 && /clue|chandler/i.test(clue.name));
    check("Clue confidence is not unknown", clue.confidence !== "unknown", clue.confidence);
  }

  // Not job-search-only: sales/consulting are detected too.
  const preston = result.opportunities.find((o) => o.company.toLowerCase().includes("preston"));
  check("Consulting/bid opportunity (Preston) detected", !!preston, result.opportunities.map((o) => o.company));
  if (preston) check("Preston is waiting on me (inbound request)", preston.waitingOn === "me", preston.waitingOn);

  const sc = result.opportunities.find((o) => o.company.toLowerCase().includes("safety"));
  check("SafetyCulture detected and stalled/waiting", !!sc && ["stalled", "waiting_on_them"].includes(sc?.stage ?? ""), sc?.stage);

  // Trust: noise dropped, nothing invented, evidence everywhere.
  check("newsletter noise was dropped", result.droppedAsNoise >= 1, result.droppedAsNoise);
  check("no opportunity lacks evidence", result.opportunities.every((o) => o.evidence.length > 0));
  check("every opportunity has a why-this-stage reason", result.opportunities.every((o) => o.reason.length > 0));
  check("every opportunity has a change log entry", result.opportunities.every((o) => o.whatChanged.length > 0));

  // Determinism.
  const again = scanThreads(batch, { nowMs: NOW });
  check("scan is deterministic (stable across runs)", JSON.stringify(result) === JSON.stringify(again));

  // Change log: a second scan with the first as "previous" should report no change.
  const third = scanThreads(batch, { nowMs: NOW, previous: result.opportunities });
  check("re-scan reports 'no change' for unchanged opportunities", third.opportunities.every((o) => o.whatChanged.includes("no change")), third.opportunities.map((o) => o.whatChanged));

  if (failed > 0) {
    console.error(`\n[check-gmail-scan] ${failed} check(s) FAILED`);
    process.exitCode = 1;
  } else {
    console.log("\n[check-gmail-scan] all checks passed");
  }
}

main().catch((err) => {
  console.error("[check-gmail-scan] failed", err);
  process.exitCode = 1;
});
