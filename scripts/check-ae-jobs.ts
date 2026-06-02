// Validates AE Job OS domain model without starting the dev server.
import { resolveBriefActionPatch, resolveMarkDonePatch } from "../lib/ae-jobs/brief-actions";
import {
  buildDemoCalendarBatch,
  CALENDAR_CONTRACT_VERSION,
  CALENDAR_STATUS_MESSAGE,
  findMatchingOpportunityForCalendar,
} from "../lib/ae-jobs/calendar";
import {
  applyCalendarSync,
  buildCalendarReminderItems,
  buildCalendarUpcomingItems,
  enrichOpportunitiesFromCalendar,
} from "../lib/ae-jobs/calendar-sync";
import { buildCareerBriefModel } from "../lib/ae-jobs/career-brief";
import { buildAeJobsWorkspaceModel, groupByRoleCategory } from "../lib/ae-jobs/workspace";
import { seedOpportunities } from "../lib/ae-jobs/seed";
import {
  applyIngestionEvents,
  buildDemoIngestionBatch,
  findMatchingOpportunity,
  INGESTION_CONTRACT_VERSION,
  INGESTION_STATUS_MESSAGE,
} from "../lib/ae-jobs/ingestion";
import { ROLE_CATEGORIES, CHECKLIST_KEYS } from "../lib/ae-jobs/types";

const user = {
  id: "dylan",
  name: "Dylan",
  accessRole: "admin_operator" as const,
  modules: ["roofing" as const],
  geo: [],
  workspaces: [],
};

const opportunities = seedOpportunities();
const calendarBatch = buildDemoCalendarBatch("2026-06-02T12:00:00.000Z");
const calendarNowMs = Date.parse(calendarBatch.syncedAt);
const model = buildAeJobsWorkspaceModel(opportunities, user, null);
const brief = buildCareerBriefModel(opportunities, user, undefined, {
  events: calendarBatch.events,
  lastSyncedAt: calendarBatch.syncedAt,
  nowMs: calendarNowMs,
});
const groups = groupByRoleCategory(opportunities);

const REAL_COMPANIES = ["Clipboard", "SafetyCulture", "Ronco"];

let failed = 0;
function check(label: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

check("seed has real pipeline opportunities", opportunities.length === 3);
check("today actions surfaced", model.todayActions.length > 0);
check("needs dylan items surfaced", model.needsDylan.length > 0);
check("career brief needs dylan today", brief.needsDylanToday.length > 0);
check("career brief waiting on ronco", brief.waitingOn.some((w) => w.company === "Ronco"));
check("career brief suggested next move", brief.suggestedNextMove.headline.length > 0);
check("career brief morning hero", brief.morningBrief.activeOpportunities > 0);
check("career brief execute now", brief.executeNow.length > 0);
check(
  "career brief execute now includes clipboard",
  brief.executeNow.some((item) => item.company === "Clipboard"),
);
check(
  "career brief execute now items have category",
  brief.executeNow.every((item) => typeof item.category === "string"),
);
check("career brief quick actions", brief.quickActions.length === 4);
check(
  "career brief quick action clipboard link",
  brief.quickActions.find((a) => a.id === "clipboard")?.href.includes("opp-clipboard-ae") === true,
);
check("career brief momentum metrics", brief.careerMomentum.applicationsInProgress >= 0);
check("career brief generated timestamp", brief.generatedAt.length > 0);
check(
  "career brief clipboard loom recommendation",
  brief.suggestedNextMove.headline.toLowerCase().includes("clipboard") &&
    brief.suggestedNextMove.headline.toLowerCase().includes("loom"),
);
check("career brief top opportunities", brief.topOpportunities.length === 3);
check("career brief health total", brief.health.total === 3);
check("role grouping covers categories", groups.length >= 3);
check("checklist keys defined", CHECKLIST_KEYS.length === 9);
check("role categories defined", ROLE_CATEGORIES.length === 5);
check("ingestion contract version set", model.ingestion.contractVersion === INGESTION_CONTRACT_VERSION);
check("ingestion not wired", model.ingestion.wired === false);
check(
  "ingestion status manual demo mode",
  model.ingestion.statusMessage === INGESTION_STATUS_MESSAGE,
);
check("career brief ingestion meta", brief.ingestion.statusMessage === INGESTION_STATUS_MESSAGE);
check("career brief ingestion not wired", brief.ingestion.wired === false);
check("career brief calendar meta", brief.calendar.contractVersion === CALENDAR_CONTRACT_VERSION);
check(
  "career brief calendar status message",
  brief.calendar.statusMessage === CALENDAR_STATUS_MESSAGE,
);
check("career brief calendar events imported", brief.calendar.eventsImported === 3);
check(
  "career brief upcoming from calendar",
  brief.upcoming.some((u) => u.company === "SafetyCulture"),
);
check(
  "career brief 48h interview reminder",
  brief.needsDylanToday.some(
    (n) => n.category === "interview_reminder_48h" && n.company === "Clipboard",
  ),
);
check(
  "career brief 24h interview reminder",
  brief.needsDylanToday.some(
    (n) => n.category === "interview_reminder_24h" && n.company === "SafetyCulture",
  ),
);
check(
  "calendar enriches interview_scheduled",
  enrichOpportunitiesFromCalendar(opportunities, calendarBatch.events).find(
    (o) => o.company === "SafetyCulture",
  )?.checklist.interview_scheduled === true,
);
check(
  "calendar match safetyculture",
  findMatchingOpportunityForCalendar(opportunities, calendarBatch.events[1])?.id ===
    "opp-safetyculture-pam",
);

const calendarSeen = new Set<string>();
const calendarSync = applyCalendarSync([], opportunities, calendarBatch, calendarSeen);
check("calendar sync imports three", calendarSync.result.imported === 3);
check(
  "calendar sync sets interview_scheduled",
  calendarSync.opportunities.find((o) => o.company === "SafetyCulture")?.checklist
    .interview_scheduled === true,
);
const calendarReminders = buildCalendarReminderItems(
  calendarBatch.events,
  calendarSync.opportunities,
  calendarNowMs,
);
check("calendar reminders deterministic", calendarReminders.length >= 2);
check(
  "calendar upcoming deterministic",
  buildCalendarUpcomingItems(calendarBatch.events, opportunities, calendarNowMs).length >= 2,
);

const demoBatch = buildDemoIngestionBatch();
const seen = new Set<string>();
const ingestFirst = applyIngestionEvents([...opportunities], demoBatch, seen);
check("ingestion demo updates three", ingestFirst.result.updated === 3);
check("ingestion demo no unmatched", ingestFirst.result.unmatched === 0);
check(
  "ingestion match by company and role",
  findMatchingOpportunity(opportunities, demoBatch.events[0])?.id === "opp-clipboard-ae",
);
check(
  "ingestion match by company fallback",
  findMatchingOpportunity(opportunities, { ...demoBatch.events[2], roleTitle: "" })?.company === "Ronco",
);
const ingestSecond = applyIngestionEvents(ingestFirst.opportunities, demoBatch, seen);
check("ingestion idempotency skips duplicates", ingestSecond.result.skipped === demoBatch.events.length);

for (const company of REAL_COMPANIES) {
  check(`real pipeline includes ${company}`, opportunities.some((o) => o.company === company));
}

const clipboard = opportunities.find((o) => o.company === "Clipboard");
check("clipboard loom due flagged", model.needsDylan.some((n) => n.company === "Clipboard" && n.category === "loom_due"));
check("clipboard case study stage", clipboard?.stage === "case_study");

if (clipboard) {
  const markDone = resolveMarkDonePatch(clipboard, "loom_due");
  check("mark done loom sets loom_recorded", markDone.checklist?.loom_recorded === true);
  check("mark done loom clears prepRequired", markDone.fields?.prepRequired === false);

  const reminderDone = resolveMarkDonePatch(clipboard, "interview_reminder_48h");
  check("mark done 48h reminder clears prep", reminderDone.fields?.prepRequired === false);

  const snooze = resolveBriefActionPatch(clipboard, "snooze");
  check("snooze sets followUpDate", typeof snooze.fields?.followUpDate === "string");

  const touch = resolveBriefActionPatch(clipboard, "log_touchpoint", { note: "Called recruiter" });
  check("touchpoint updates lastTouchpoint", typeof touch.fields?.lastTouchpoint === "string");
  check("touchpoint appends note", touch.fields?.notes?.includes("Called recruiter") === true);
}

const safetyCulture = opportunities.find((o) => o.company === "SafetyCulture");
check(
  "safetyculture follow-up or prep in needs dylan",
  model.needsDylan.some((n) => n.company === "SafetyCulture"),
);
check("safetyculture PAM category", safetyCulture?.roleCategory === "partner_account_manager");

const ronco = opportunities.find((o) => o.company === "Ronco");
check(
  "ronco waiting on reply",
  model.needsDylan.some((n) => n.company === "Ronco" && n.category === "waiting_on_reply"),
);
check("ronco other category", ronco?.roleCategory === "other");

for (const cat of ROLE_CATEGORIES) {
  check(`summary counts ${cat}`, typeof model.summary.byCategory[cat] === "number");
}

for (const opp of opportunities) {
  for (const key of CHECKLIST_KEYS) {
    check(`${opp.id} checklist.${key}`, typeof opp.checklist[key] === "boolean");
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll AE Job OS checks passed.");
