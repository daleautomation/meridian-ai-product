#!/usr/bin/env tsx
/**
 * Local demo for AE Job career calendar sync.
 * Simulates POST /api/ae-jobs/calendar/sync against file stores.
 *
 * Usage:
 *   npm run ae-jobs:calendar:demo
 *   npm run ae-jobs:calendar:demo -- --reset-seen
 */

import { buildDemoCalendarBatch } from "../lib/ae-jobs/calendar";
import { applyCalendarSync } from "../lib/ae-jobs/calendar-sync";
import { buildCareerBriefModel } from "../lib/ae-jobs/career-brief";
import { loadCalendarStore, saveCalendarStore } from "../lib/ae-jobs/calendar-store";
import { loadAeJobsStore, saveAeJobsStore } from "../lib/ae-jobs/store";
import { seedOpportunities } from "../lib/ae-jobs/seed";

const args = new Set(process.argv.slice(2));
const resetSeen = args.has("--reset-seen");

const user = {
  id: "dylan",
  name: "Dylan",
  accessRole: "admin_operator" as const,
  modules: ["roofing" as const],
  geo: [],
  workspaces: [],
};

function log(label: string, value: unknown) {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function main() {
  console.log("AE Job OS — career calendar sync demo");
  console.log("(same merge path as POST /api/ae-jobs/calendar/sync)\n");

  let calendarStore = await loadCalendarStore("dylan");
  let jobsStore = await loadAeJobsStore("dylan");

  if (resetSeen) {
    calendarStore = {
      ...calendarStore,
      events: [],
      seenEventIds: [],
      lastSyncedAt: null,
      lastSyncResult: null,
    };
    jobsStore = {
      ...jobsStore,
      opportunities: seedOpportunities(),
    };
    console.log("Reset calendar + re-seeded opportunities.\n");
  }

  const batch = buildDemoCalendarBatch();
  console.log(`Demo batch: ${batch.events.length} calendar events\n`);

  const seen = new Set(calendarStore.seenEventIds ?? []);
  for (const event of batch.events) seen.delete(event.eventId);

  const sync = applyCalendarSync(calendarStore.events, jobsStore.opportunities, batch, seen);

  calendarStore = {
    ...calendarStore,
    events: sync.events,
    lastSyncedAt: batch.syncedAt,
    lastSyncResult: sync.result,
    seenEventIds: [...seen],
  };
  jobsStore = {
    ...jobsStore,
    opportunities: sync.opportunities,
  };

  await saveCalendarStore(calendarStore);
  await saveAeJobsStore(jobsStore);

  console.log("Sync result:");
  log("  imported", sync.result.imported);
  log("  skipped", sync.result.skipped);
  log("  opportunitiesUpdated", sync.result.opportunitiesUpdated);

  const brief = buildCareerBriefModel(jobsStore.opportunities, user, undefined, {
    events: calendarStore.events,
    lastSyncedAt: calendarStore.lastSyncedAt,
    nowMs: Date.parse(batch.syncedAt),
  });

  console.log("\nCareer Brief (calendar-enriched):");
  log("  upcoming count", brief.upcoming.length);
  log(
    "  upcoming includes SafetyCulture",
    brief.upcoming.some((u) => u.company === "SafetyCulture"),
  );
  log(
    "  needs dylan 24h reminder",
    brief.needsDylanToday.some((n) => n.category === "interview_reminder_24h"),
  );
  log(
    "  needs dylan 48h reminder",
    brief.needsDylanToday.some((n) => n.category === "interview_reminder_48h"),
  );
  log("  calendar events imported", brief.calendar.eventsImported);

  const safetyCulture = sync.opportunities.find((o) => o.company === "SafetyCulture");
  const clipboard = sync.opportunities.find((o) => o.company === "Clipboard");
  if (safetyCulture) {
    log("  SafetyCulture interview_scheduled", safetyCulture.checklist.interview_scheduled);
  }
  if (clipboard) {
    log("  Clipboard interview_scheduled", clipboard.checklist.interview_scheduled);
  }

  const ok =
    sync.result.imported === batch.events.length &&
    brief.upcoming.some((u) => u.company === "SafetyCulture") &&
    brief.needsDylanToday.some((n) => n.category === "interview_reminder_24h") &&
    brief.needsDylanToday.some((n) => n.category === "interview_reminder_48h") &&
    safetyCulture?.checklist.interview_scheduled === true;

  if (!ok) {
    console.error("\nDemo validation failed.");
    process.exit(1);
  }

  console.log("\nDemo passed: calendar sync updates Career Brief and pipeline checklist.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
