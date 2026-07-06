// Meridian Command — Reality Layer scan CLI.
//
// Runs the full pipeline: connectors → observations → beliefs → recommendations →
// Daily Brief. Read-only by default; --write persists observations/beliefs/brief.
//
// Usage:
//   npm run reality:scan                          # fixtures, dry-run
//   npm run reality:scan -- --live                # real batches in data/{gmail,calendar}
//   npm run reality:scan -- --live --write        # persist (feeds the Home page)

import { promises as fs } from "node:fs";
import path from "node:path";
import type { GmailThreadBatch } from "../lib/gmail/types";
import type { CalendarBatch } from "../lib/connectors/googleCalendar";
import { loadPreviousBeliefs, persistReality, runRealityPipeline } from "../lib/home/pipeline";
import { renderBrief } from "../lib/home/brief";

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(path.join(process.cwd(), p), "utf8")) as T; }
  catch { return null; }
}

async function main(): Promise<void> {
  const live = process.argv.includes("--live");
  const write = process.argv.includes("--write");
  const nowMs = process.env.MERIDIAN_GMAIL_NOW ? Date.parse(process.env.MERIDIAN_GMAIL_NOW) : Date.now();

  const gmailPath = live ? "data/gmail/inbox-batch.json" : "fixtures/gmail/sample-threads.json";
  const calPath = live ? "data/calendar/inbox-batch.json" : "fixtures/calendar/sample-events.json";
  const contactsDir = live ? undefined : "fixtures/contacts";

  const gmail = (await readJson<GmailThreadBatch>(gmailPath)) ?? undefined;
  const calendar = (await readJson<CalendarBatch>(calPath)) ?? undefined;

  const previousBeliefs = write ? await loadPreviousBeliefs() : [];
  const linkedinInput = live ? {} : { observationsPath: "fixtures/linkedin/observations.json" };
  const result = await runRealityPipeline(
    { gmail, calendar, contactsDir, contacts: true, linkedin: true, linkedinInput },
    { nowMs, owner: "Dylan", previousBeliefs },
  );

  console.log(`\n[reality] connectors:`);
  for (const r of result.results) {
    console.log(`  - ${r.connector.padEnd(18)} ${r.health.state.padEnd(14)} obs=${r.collected}  (${r.health.detail})`);
  }
  console.log(`[reality] observations=${result.observations.length}  beliefs=${result.beliefs.length}  recommendations=${result.recommendations.length}  mode=${write ? "WRITE" : "DRY-RUN"}\n`);

  console.log(renderBrief(result.brief));

  if (write) {
    const ok = await persistReality(result);
    console.log(`\n[write] ${ok ? "persisted data/reality/{observations,beliefs,brief-today}.json" : "FAILED (fs)"}`);
  } else {
    console.log(`\n(dry-run — nothing written. Add --write to persist and feed the Home page.)`);
  }
}

main().catch((err) => {
  console.error("[reality-scan] failed", err);
  process.exitCode = 1;
});
