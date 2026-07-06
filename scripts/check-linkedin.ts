// Meridian Command — LinkedInConnector validation.
//
// Proves the connector reads manual LinkedIn input, emits linkedin_* Observations
// only (no scoring/scraping), and that a LinkedIn message fuses into the Clue
// belief alongside Gmail + Calendar. Runs over fixtures — no live data needed.

import { promises as fs } from "node:fs";
import path from "node:path";
import { LinkedInConnector } from "../lib/connectors/linkedin";
import { deriveBeliefs } from "../lib/beliefs/engine";
import { runRealityPipeline } from "../lib/home/pipeline";
import type { GmailThreadBatch } from "../lib/gmail/types";
import type { CalendarBatch } from "../lib/connectors/googleCalendar";

let failed = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`ok: ${label}`);
  else { console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); failed += 1; }
}
async function readJson<T>(p: string): Promise<T> { return JSON.parse(await fs.readFile(path.join(process.cwd(), p), "utf8")) as T; }

async function main(): Promise<void> {
  const NOW = Date.parse("2026-07-07T00:00:00.000Z");
  const connector = new LinkedInConnector();
  const input = { observationsPath: "fixtures/linkedin/observations.json" };

  const health = await connector.health(input);
  check("connector is read-only + never scrapes", connector.capabilities().readOnly && /never scrapes/i.test(connector.capabilities().description));
  check("connector health ok on fixture", health.state === "ok", health);

  const obs = await connector.collectObservations(input, NOW);
  check("emitted observations", obs.length >= 4, obs.length);
  check("all observations are linkedin_* types", obs.every((o) => o.type.startsWith("linkedin_")), obs.map((o) => o.type));
  check("observations carry no stage/score fields", obs.every((o) => !("stage" in o) && !("score" in o)));
  check("inbound LinkedIn message has inbound direction", obs.some((o) => o.type === "linkedin_message_received" && o.direction === "inbound"));
  check("job signal captured", obs.some((o) => o.type === "linkedin_job_signal"));
  check("manual note captured", obs.some((o) => o.type === "linkedin_manual_note"));

  // Belief fusion: LinkedIn Chandler message rolls into the Clue subject.
  const beliefs = deriveBeliefs(obs, { nowMs: NOW });
  const clue = beliefs.find((b) => b.subjectKey.includes("clue"));
  check("LinkedIn observations form a Clue belief", !!clue, beliefs.map((b) => b.subjectKey));
  check("Clue belief lists linkedin as a connector", clue?.connectors.includes("linkedin") ?? false, clue?.connectors);

  // Full pipeline: Gmail + Calendar + LinkedIn unify into ONE Clue belief using 3 sensors.
  const gmail = await readJson<GmailThreadBatch>("fixtures/gmail/sample-threads.json");
  const calendar = await readJson<CalendarBatch>("fixtures/calendar/sample-events.json");
  const result = await runRealityPipeline(
    { gmail, calendar, contactsDir: "fixtures/contacts", linkedinInput: input },
    { nowMs: NOW, owner: "Dylan" },
  );
  const clueAll = result.beliefs.find((b) => b.subjectKey.includes("clue"));
  check("Clue fuses gmail + calendar + linkedin into one belief",
    !!clueAll && ["gmail", "google-calendar", "linkedin"].every((c) => clueAll!.connectors.includes(c)), clueAll?.connectors);

  if (failed > 0) { console.error(`\n[check-linkedin] ${failed} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\n[check-linkedin] all checks passed");
}

main().catch((err) => { console.error("[check-linkedin] failed", err); process.exitCode = 1; });
