// Meridian Command — Reality Layer validation.
//
// Runs the full pipeline over fixtures (Gmail + Calendar + Contacts) and asserts
// the framework's guarantees: connectors only observe, the belief engine unifies
// signals across connectors, recommendations are ordinal with opportunity cost,
// the brief renders, and everything is deterministic. Also proves the success
// criterion: a new connector needs no new architecture.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { GmailThreadBatch } from "../lib/gmail/types";
import type { CalendarBatch } from "../lib/connectors/googleCalendar";
import { runRealityPipeline } from "../lib/home/pipeline";
import { renderBrief } from "../lib/home/brief";
import { GmailConnector } from "../lib/connectors/gmail";
import { GoogleCalendarConnector } from "../lib/connectors/googleCalendar";
import { GoogleContactsConnector } from "../lib/connectors/googleContacts";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else { console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); failed += 1; }
}

async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), p), "utf8")) as T;
}

async function main(): Promise<void> {
  const NOW = Date.parse("2026-07-07T00:00:00.000Z");
  const gmail = await readJson<GmailThreadBatch>("fixtures/gmail/sample-threads.json");
  const calendar = await readJson<CalendarBatch>("fixtures/calendar/sample-events.json");

  const result = await runRealityPipeline({ gmail, calendar, contactsDir: "fixtures/contacts" }, { nowMs: NOW, owner: "Dylan" });
  console.log("[check-reality]", {
    connectors: result.results.map((r) => `${r.connector}:${r.collected}`),
    observations: result.observations.length,
    beliefs: result.beliefs.map((b) => `${b.subjectKey}:${b.stage}:${b.momentum}`),
    recs: result.recommendations.length,
  });

  // Connectors only observe (no stages/opportunities/scores on observations).
  const obsKeys = new Set(result.observations.flatMap((o) => Object.keys(o)));
  check("observations carry no stage/score/opportunity fields",
    !obsKeys.has("stage") && !obsKeys.has("score") && !obsKeys.has("opportunity") && !obsKeys.has("recommendation"), [...obsKeys]);
  check("all four connectors produced observations (incl. memory sensor)",
    result.results.filter((r) => r.collected > 0).length === 4, result.results.map((r) => `${r.connector}:${r.collected}`));
  check("observations came from multiple connectors", new Set(result.observations.map((o) => o.connector)).size >= 4);
  check("memory participates as a sensor", result.results.some((r) => r.connector === "memory" && r.collected > 0));

  // Belief engine unifies Gmail + Calendar into ONE Clue belief.
  const clue = result.beliefs.find((b) => b.subjectKey.includes("clue"));
  check("Clue belief formed from unified signals", !!clue, result.beliefs.map((b) => b.subjectKey));
  if (clue) {
    check("Clue belief uses both gmail + calendar connectors", clue.connectors.includes("gmail") && clue.connectors.includes("google-calendar"), clue.connectors);
    check("Clue stage is meeting_completed", clue.stage === "meeting_completed", clue.stage);
    check("Clue momentum accelerating/warm", ["accelerating", "warm"].includes(clue.momentum), clue.momentum);
    check("Clue waiting on them", clue.waitingOn === "them", clue.waitingOn);
    check("Clue belief has a falsifier", clue.falsifier.length > 0);
    check("Clue belief has a change log", clue.changeLog.length > 0);
    check("Clue belief has evidence", clue.evidence.length > 0);
  }

  // A rejection (Oracle) is believed, not recommended.
  const oracle = result.beliefs.find((b) => b.subjectKey.includes("oracle"));
  check("Oracle rejection is believed as rejected", oracle?.stage === "rejected", oracle?.stage);
  check("rejected beliefs are NOT recommended", !result.recommendations.some((r) => r.subjectKey.includes("oracle")));

  // Recommendations are ordinal + carry opportunity cost + evidence.
  check("recommendations produced", result.recommendations.length > 0);
  check("every recommendation states opportunity cost", result.recommendations.every((r) => r.opportunityCost.length > 0));
  check("every recommendation carries evidence", result.recommendations.every((r) => r.evidence.length > 0));
  check("recommendations are ranked 1..n", result.recommendations.every((r, i) => r.rank === i + 1));

  // Contacts connector detected the duplicate identity.
  const dupObs = result.observations.filter((o) => o.type === "duplicate_identity");
  check("contacts connector detected a duplicate identity", dupObs.length >= 1, dupObs.length);

  // Brief renders one page with the required sections.
  const text = renderBrief(result.brief);
  check("brief greets and reports overnight change", /GOOD MORNING DYLAN/.test(text) && /Reality changed overnight/.test(text));
  check("brief has highest-leverage actions", /HIGHEST-LEVERAGE ACTIONS/.test(text));
  check("brief revenue outlook is honest (no fabricated dollars)", /No dollar forecast/.test(result.brief.revenueOutlook) && !/\$\d/.test(result.brief.revenueOutlook));
  check("brief has a professional capital summary", result.brief.capitalSummary.length >= 4);

  // Determinism.
  const again = await runRealityPipeline({ gmail, calendar, contactsDir: "fixtures/contacts" }, { nowMs: NOW, owner: "Dylan" });
  check("pipeline is deterministic", JSON.stringify(result.beliefs) === JSON.stringify(again.beliefs) && JSON.stringify(result.recommendations) === JSON.stringify(again.recommendations));

  // Success criterion: a new connector needs no new architecture — capabilities align.
  for (const c of [new GmailConnector(), new GoogleCalendarConnector(), new GoogleContactsConnector()]) {
    const cap = c.capabilities();
    check(`${cap.id} is read-only and declares emitted observation types`, cap.readOnly && cap.emits.length > 0, cap.id);
  }

  if (failed > 0) { console.error(`\n[check-reality] ${failed} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\n[check-reality] all checks passed");
}

main().catch((err) => { console.error("[check-reality] failed", err); process.exitCode = 1; });
