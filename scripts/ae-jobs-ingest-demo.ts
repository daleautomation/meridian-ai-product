#!/usr/bin/env tsx
/**
 * Local demo for AE Job parsed-email ingestion.
 * Simulates POST /api/ae-jobs/ingest against the file store.
 *
 * Usage:
 *   npm run ae-jobs:ingest:demo
 *   npm run ae-jobs:ingest:demo -- --reset-seen
 */

import {
  applyIngestionEvents,
  buildDemoIngestionBatch,
  findMatchingOpportunity,
} from "../lib/ae-jobs/ingestion";
import { loadAeJobsStore, saveAeJobsStore } from "../lib/ae-jobs/store";

const args = new Set(process.argv.slice(2));
const resetSeen = args.has("--reset-seen");

function log(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main() {
  console.log("AE Job OS — parsed email ingestion demo");
  console.log("(same merge path as POST /api/ae-jobs/ingest)\n");

  let store = await loadAeJobsStore("dylan");

  if (resetSeen) {
    store = {
      ...store,
      seenEventIds: [],
      lastIngestedAt: null,
      lastIngestionResult: null,
    };
    console.log("Reset seenEventIds and last ingestion metadata.\n");
  }

  const batch = buildDemoIngestionBatch();
  console.log(`Demo batch: ${batch.events.length} parsed events\n`);

  for (const event of batch.events) {
    const match = findMatchingOpportunity(store.opportunities, event);
    log(
      `  match ${event.company}`,
      match ? `${match.id} (${match.company})` : "NO MATCH",
    );
  }
  console.log("");

  const seen = new Set(store.seenEventIds ?? []);
  // Re-runnable demo: clear prior demo event ids so first pass always applies updates.
  for (const event of batch.events) seen.delete(event.eventId);
  const first = applyIngestionEvents(store.opportunities, batch, seen);

  store = {
    ...store,
    opportunities: first.opportunities,
    lastIngestedAt: batch.ingestedAt,
    lastIngestionResult: first.result,
    seenEventIds: [...seen],
  };
  await saveAeJobsStore(store);

  console.log("First pass result:");
  log("  processed", first.result.processed);
  log("  updated", first.result.updated);
  log("  skipped", first.result.skipped);
  log("  unmatched", first.result.unmatched);
  if (first.result.errors.length) log("  errors", first.result.errors);

  const clipboard = first.opportunities.find((o) => o.company === "Clipboard");
  const safetyCulture = first.opportunities.find((o) => o.company === "SafetyCulture");
  const ronco = first.opportunities.find((o) => o.company === "Ronco");

  console.log("\nUpdated opportunities:");
  if (clipboard) {
    log("  Clipboard nextAction", clipboard.nextAction);
    log("  Clipboard source", clipboard.sourceEmailSubject);
  }
  if (safetyCulture) {
    log("  SafetyCulture followUpDate", safetyCulture.followUpDate);
    log("  SafetyCulture nextAction", safetyCulture.nextAction);
  }
  if (ronco) {
    log("  Ronco waitingOnReply", ronco.waitingOnReply);
    log("  Ronco lastTouchpoint", ronco.lastTouchpoint);
  }

  const second = applyIngestionEvents(store.opportunities, batch, seen);
  console.log("\nSecond pass (idempotency):");
  log("  processed", second.result.processed);
  log("  updated", second.result.updated);
  log("  skipped", second.result.skipped);
  log("  unmatched", second.result.unmatched);

  const okFirst =
    first.result.updated === 3 &&
    first.result.unmatched === 0 &&
    first.result.skipped === 0;
  const okSecond =
    second.result.skipped === batch.events.length &&
    second.result.updated === 0 &&
    second.result.processed === 0;

  if (!okFirst || !okSecond) {
    console.error("\nDemo validation failed.");
    process.exit(1);
  }

  console.log("\nDemo passed: 3 opportunities updated, duplicate eventIds skipped.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
