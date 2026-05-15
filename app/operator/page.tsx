// Meridian — Operator workspace surface.
//
// Reads ?workspace=<slug>, validates against the user's session, loads the
// workspace config, and hands it to OperatorConsole alongside the engine
// payload. If the user has multiple workspaces and none was specified, a
// minimal picker is rendered. Single-workspace users are auto-routed.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { listSnapshots, type CompanySnapshot } from "../../lib/state/companySnapshotStore";
import { getAllActivities, getCalendarEvents } from "../../lib/state/crmStore";
import { getJobHistory } from "../../lib/pipeline/dailyJob";
import OperatorConsole from "../../components/OperatorConsole";
import { groupByDecision, type LeadDecision } from "../../lib/scoring/decision";
import { SOURCE_BACKED_MODULES } from "../../lib/ingestion/loadWorkspaceLeads";
import { cachedLoadWorkspaceLeads } from "../../lib/ingestion/cache/cachedWorkspaceLeads";
import type { NormalizedLead } from "../../lib/leads/normalizedLead";
import { buildGlobalLeadSchedule, buildRollingTeamSchedule } from "../../lib/scheduling/leadSchedule";
import { DEFAULT_TEAM_SCHEDULE_CONFIG } from "../../lib/scheduling/teamScheduleConfig";
import { DEFAULT_TEAM_MEMBERS } from "../../lib/scheduling/teamMembers";
import {
  classifyLeadServiceNeeds,
  aggregateServiceBuckets,
} from "../../lib/services/serviceNeedClassifier";
import { getTradeServices } from "../../lib/services/tradeServiceConfig";
import { getService as getServiceCatalogEntry } from "../../lib/services/serviceCatalog";
import { generateSalesStrategy } from "../../lib/sales/salesStrategy";
import {
  listWorkspacesForUser,
  defaultWorkspaceFor,
  type WorkspaceConfig,
} from "../../config/workspaces";
import { getWorkspaceAccess } from "../../lib/workspaceAccess";
import { getSourceReadiness } from "../../lib/sources/readiness";
import { ALL_TRADE_ENV_VARS } from "../../lib/modules/tradeSources";
import { readOperatorSnapshot, writeOperatorSnapshot } from "../../lib/operatorPayload/snapshot";
import {
  getDialablePhone,
  withCanonicalPhoneContact,
  type CanonicalPhoneLeadLike,
} from "../../lib/leads/phone";
import { leadIdentityCandidates, resolveByLeadIdentity } from "../../lib/leads/identity";
import {
  loadDurableOutcomeMap,
  type ExecutionOutcomeMapValue,
} from "../../lib/execution/serverOutcomeStore";
import { isTerminalStatusValue } from "../../lib/crm/statusTaxonomy";
import { listOverrides } from "../../lib/scheduling/overrideStore";
import { applyScheduleOverrides } from "../../lib/scheduling/applyOverrides";
import { companyKey } from "../../lib/mcp/types";
import {
  getBusinessTodayIso,
  getWeekStartIso,
  LAUNCH_DAY_ISO,
} from "../../lib/dates/businessDate";
import type { CrmActivity } from "../../lib/state/crmStore";

export const dynamic = "force-dynamic";

type SearchParams = { workspace?: string | string[] };

const VERBOSE_OPERATOR_LOGS = process.env.MERIDIAN_OPERATOR_VERBOSE === "1";
const verboseOperatorLog: typeof console.log = (...args) => {
  if (VERBOSE_OPERATOR_LOGS) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};

const RECENT_CALL_SUPPRESSION_MS = 24 * 60 * 60 * 1000;
const RECENT_ACTIVITY_TYPES = new Set(["call", "voicemail"]);
const RECENT_ACTIVITY_KINDS = new Set(["follow_up_created", "follow_up_completed"]);
const RECENT_STATUS_VALUES = new Set(["CONTACTED", "CALLED", "VOICEMAIL", "FOLLOW_UP"]);
const RECENT_OUTCOME_VALUES = new Set(["Called", "Follow Up"]);

export default async function OperatorPage(props: {
  searchParams?: Promise<SearchParams>;
}) {
  try {
    return await renderOperatorPage(props);
  } catch (err) {
    // CRITICAL: Next.js implements redirect() and notFound() by throwing
    // a control-flow exception with a `digest` of "NEXT_REDIRECT;…" or
    // "NEXT_NOT_FOUND". The runtime catches it at the route boundary and
    // performs the navigation. If we swallow it here, the user sees
    // "Operator failed to load: NEXT_REDIRECT" instead of being routed.
    // Re-throw any framework signal before treating as fatal.
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) {
      throw err;
    }
    // eslint-disable-next-line no-console
    console.error("[FATAL OPERATOR ERROR]", err);
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    return (
      <div style={{
        padding: "40px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#0F172A",
        background: "#F8FAFC",
        minHeight: "100dvh",
      }}>
        <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "12px" }}>
          Operator failed to load
        </h1>
        <pre style={{
          fontSize: "12px",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: "8px",
          padding: "16px",
          overflow: "auto",
        }}>{message}</pre>
      </div>
    );
  }
}

async function renderOperatorPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const t0 = Date.now();
  const user = await getSession();
  if (!user) redirect("/login");
  // eslint-disable-next-line no-console
  console.log(`[operator-timing] session_resolved ms=${Date.now() - t0}`);

  const params = (await searchParams) ?? {};
  const requestedSlug = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;

  const userWorkspaces = listWorkspacesForUser(user.workspaces ?? []);
  if (userWorkspaces.length === 0) {
    return <NoWorkspaceState userName={user.name ?? user.id} />;
  }

  // Resolve the active workspace.
  let workspace: WorkspaceConfig | null = null;
  if (requestedSlug) {
    const access = getWorkspaceAccess(user, requestedSlug);
    if (!access.ok) {
      // eslint-disable-next-line no-console
      console.log(
        `[workspace-auth] denied user=${user.id} role=${user.accessRole} ` +
        `requested=${requestedSlug} reason=${access.reason}`,
      );
      return (
        <WorkspaceAccessDeniedState
          requestedSlug={requestedSlug}
          workspaces={userWorkspaces}
          reason={access.reason}
        />
      );
    }
    workspace = access.workspace;
  }
  if (!workspace) {
    if (userWorkspaces.length === 1) {
      const only = defaultWorkspaceFor(user.workspaces ?? []);
      if (only) redirect(`/operator?workspace=${only.slug}`);
    }
    return <WorkspacePicker workspaces={userWorkspaces} userName={user.name ?? user.id} />;
  }

  // ── Snapshot fast-path ──────────────────────────────────────────────
  // Pre-baked operator payload at data/snapshots/<slug>-operator.json.
  // When present and unexpired we skip every heavy compute step
  // (Google Places ingestion, relationship-engine diagnostics,
  // sales-strategy generation, service-bucket aggregation, scheduling)
  // and hand OperatorConsole
  // exactly the props the slow-path would have produced. Snapshot is
  // refreshed by the slow-path after each successful render so warm
  // containers stay current. Disable with MERIDIAN_DISABLE_SNAPSHOT=1.
  const isolateDemoData = workspace.access.dataMode === "demo";
  const snapshotEnabled = process.env.MERIDIAN_DISABLE_SNAPSHOT !== "1" && !isolateDemoData;
  if (snapshotEnabled) {
    const tSnap = Date.now();
    const snap = await readOperatorSnapshot(workspace.slug);
    // eslint-disable-next-line no-console
    console.log(
      `[operator-timing] snapshot_lookup ms=${Date.now() - tSnap} ` +
      `hit=${snap ? "true" : "false"} workspace=${workspace.slug}`,
    );
    if (snap) {
      // Override the user prop with the *current* session (the snapshot
      // was generated under a different user). Workspace identity is
      // preserved from the snapshot — it must match the requested slug.
      const currentSnapshots = await listSnapshots();
      const recentActivitiesAll = await getAllActivities();
      const durableOutcomeMap = await loadDurableOutcomeMap(workspace.slug);
      const baseSnapProps = mergeDurableOutcomesIntoOperatorProps(mergeCurrentCrmIntoOperatorProps(
        {
          ...normalizeOperatorPhoneProps(snap.props as Record<string, unknown>),
          serverExecutionOutcomeMap: durableOutcomeMap,
        },
        currentSnapshots,
      ), durableOutcomeMap);
      const snapProps = withRecentTodaySuppression(baseSnapProps, buildRecentTodaySuppression({
        activities: recentActivitiesAll,
        snapshots: currentSnapshots,
        durableOutcomeMap,
      }));
      const tOv = Date.now();
      const overrides = await listOverrides(workspace.slug);
      const merged = applyScheduleOverrides(
        snapProps as unknown as Parameters<typeof applyScheduleOverrides>[0],
        overrides,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[operator-timing] overrides_applied ms=${Date.now() - tOv} count=${overrides.length}`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[operator-timing] FAST_PATH total_ms=${Date.now() - t0} ` +
        `snapshot_generated_at=${snap.generatedAt}`,
      );
      // Snapshot props are validated at write time. The cast through
      // unknown is necessary because TypeScript can't statically know
      // the JSON file matches OperatorConsoleProps — that contract is
      // enforced by the snapshot generator.
      const typedProps = merged as unknown as Parameters<typeof OperatorConsole>[0];
      const hydrationNow = new Date().toISOString();
      return (
        <OperatorConsole
          {...typedProps}
          user={{ name: user.name ?? user.id, id: user.id }}
          workspace={workspace}
          relationshipEngineOperatorSurface={null}
          snapshotGeneratedAt={snap.generatedAt}
          snapshotIsFresh={true}
          snapshotHydrationNow={hydrationNow}
        />
      );
    }
  }

  // ── Workspace lead load (single bridge into ingestion) ──────────────
  // Load only source-backed modules that are enabled for this workspace.
  // LaborTech currently enables roofing only; loading every source-backed
  // trade here ran scans/scheduling for inactive modules before first paint.
  const moduleId = workspace.defaultModule;
  const enabledSourceModules = workspace.enabledModules.filter((mid) =>
    SOURCE_BACKED_MODULES.includes(mid as (typeof SOURCE_BACKED_MODULES)[number]),
  );
  const moduleLoadList: string[] = Array.from(
    new Set<string>([
      moduleId,
      ...enabledSourceModules,
    ].filter((mid) => SOURCE_BACKED_MODULES.includes(mid as (typeof SOURCE_BACKED_MODULES)[number]))),
  );
  // eslint-disable-next-line no-console
  console.log(
    `[debug-workspace] slug="${workspace.slug}" defaultModule="${moduleId}" ` +
    `modules="${moduleLoadList.join(",")}" ` +
    `googleKeyPresent=${!!(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY)}`,
  );
  // Cache-first ingestion. Uses cachedLoadWorkspaceLeads which
  // checks the persistent ingestion cache before hitting Google
  // Places. Cache key: workspaceSlug + moduleId + today's batchId
  // (YYYY-MM-DD). TTL defaults to 24h; stale entries trigger a
  // refresh; failed refresh returns stale-if-available. See
  // lib/ingestion/cache/ for the storage strategy + production
  // durability notes.
  const tIngest = Date.now();
  const decidedByModule = await Promise.all(
    moduleLoadList.map(async (mid) => {
      const result = await cachedLoadWorkspaceLeads({
        workspaceSlug: workspace.slug,
        moduleId: mid,
        limit: 60,
      });
      return { mid, leads: result.leads, cacheStatus: result.status, storeId: result.diagnostics.storeId };
    }),
  );
  // eslint-disable-next-line no-console
  console.log(`[operator-timing] ingestion ms=${Date.now() - tIngest} modules=${moduleLoadList.length}`);
  const decided = (decidedByModule ?? []).flatMap((g) => g?.leads ?? []);
  // eslint-disable-next-line no-console
  console.log(
    `[debug-admitted] aggregate count=${decided.length} ` +
    `byModule=${decidedByModule.map((g) => `${g.mid}:${g.leads.length}`).join(",")}`,
  );
  // ── Field-test ingestion summary ────────────────────────────────
  // Lightweight, non-spammy server log surfacing the upstream lead
  // ceiling for the live field test + per-module cache status.
  // Mirrors the client-side [stage1-scheduler] / [stage4-calendarTasks]
  // logs so the full pipeline is observable end-to-end.
  // eslint-disable-next-line no-console
  console.log(
    `[field-test-ingestion] perModuleCap=60 modules=${moduleLoadList.length} ` +
    `aggregate=${decided.length} enabledModules=${workspace.enabledModules.join(",")} ` +
    `googleKeyPresent=${!!(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY)} ` +
    `byModule={${decidedByModule.map((g) => `${g.mid}:${g.leads.length}(${g.cacheStatus})`).join(",")}}`,
  );

  // Global schedule: every trade's leads merge into ONE pool so the
  // total calls per day is capped across the whole workspace, not
  // per-trade. Highest-value leads (bucket → score → trade order)
  // get the earliest slots; lower-value leads spill into later days.
  // Overflow leads stay queued — when a call gets marked done (CRM
  // activity logged), the next render frees that slot and the next
  // overflow lead is pulled in automatically.
  const tradePriority: Record<string, number> = {};
  SOURCE_BACKED_MODULES.forEach((m, i) => { tradePriority[m] = i; });

  // ── Schedule anchor ───────────────────────────────────────────────
  // Anchor scheduling to the Monday of the current business week. This
  // tracks "today" — the prior fixed-May-4 anchor would jump a year
  // forward once May 4 passed, mismatching the operator's reality.
  // The downstream calendar filters columns < today via dayKey(now)
  // so past weekdays in the current week disappear cleanly; future
  // weekdays render normally. Resolved via getBusinessTodayIso so
  // the server's locale doesn't drift the anchor by a day at midnight.
  const launchStart = (() => {
    const todayIso = getBusinessTodayIso();
    const [yy, mm, dd] = todayIso.split("-").map(Number);
    const dt = new Date(yy, mm - 1, dd);
    dt.setHours(0, 0, 0, 0);
    const dow = dt.getDay(); // 0 Sun .. 6 Sat
    const offsetToMonday = dow === 0 ? -6 : 1 - dow;
    dt.setDate(dt.getDate() + offsetToMonday);
    return dt;
  })();
  const weekStartDate = launchStart.toISOString();
  // Single canonical log line for date-axis diagnostics. Every field
  // here is the SAME value the rest of the system computes against —
  // grep `[business-today]` in production logs to verify the operator
  // console agrees with the database / scheduler / calendar.
  // eslint-disable-next-line no-console
  console.log(
    `[business-today] launchDayIso=${LAUNCH_DAY_ISO} ` +
    `businessTodayIso=${getBusinessTodayIso()} ` +
    `weekStartIso=${getWeekStartIso()} ` +
    `weekStartDate=${weekStartDate.slice(0, 10)} ` +
    `serverNow=${new Date().toISOString()}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[schedule-launch] start=${weekStartDate.slice(0, 10)} target=20/day weekdaysOnly=true`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[debug-schedule] inputLeads=${decided.length} weekStart="${weekStartDate.slice(0, 10)}" ` +
    `today="${new Date().toISOString().slice(0, 10)}"`,
  );

  const recentActivitiesAll = isolateDemoData ? [] : await getAllActivities();

  const EMPTY_GLOBAL_SCHEDULE: ReturnType<typeof buildGlobalLeadSchedule> = {
    entries: [],
    byKey: new Map(),
    perDay: {},
    overflowEntries: [],
    totals: { callNow: 0, callThisWeek: 0, watch: 0, scheduled: 0, overflow: 0 },
  };
  let globalSchedule: ReturnType<typeof buildGlobalLeadSchedule>;
  const tSched = Date.now();
  try {
    globalSchedule = buildGlobalLeadSchedule(decided, {
      weekStartDate,
      maxCallNowPerDay: 12,
      maxCallThisWeekPerDay: 12,
      // Daily-volume target: 20 high-quality leads/day across the workspace.
      maxTotalCallsPerDay: 20,
      includeWatch: false,
      tradePriority,
    }) ?? EMPTY_GLOBAL_SCHEDULE;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GLOBAL SCHEDULE CRASH]", err);
    globalSchedule = EMPTY_GLOBAL_SCHEDULE;
  }
  // eslint-disable-next-line no-console
  console.log(`[operator-timing] global_schedule ms=${Date.now() - tSched}`);

  // Overflow queue diagnostic. `pulled` stays 0 until pull-forward
  // persistence ships — see the TODO in components/OperatorConsole.jsx
  // near the Mark Done handler.
  const overflowAdded = globalSchedule.overflowEntries.length;
  const overflowActive = globalSchedule.overflowEntries.length;
  const overflowPulled = 0;
  console.log(
    `[overflow] added=${overflowAdded} active=${overflowActive} pulled=${overflowPulled}`,
  );

  // Rolling team schedule — spreads leads across the next N weeks,
  // hard-skips weekends, respects per-rep capacity. Replaces the
  // single-week dump model with a real team operating board.
  const EMPTY_TEAM_SCHEDULE: ReturnType<typeof buildRollingTeamSchedule> = {
    assignments: [],
    byKey: new Map(),
    perDay: {},
    perWeek: {},
    overflowEntries: [],
    totals: { scheduled: 0, overflow: 0 },
    weekendSkips: 0,
  };
  let teamSchedule: ReturnType<typeof buildRollingTeamSchedule>;
  const tTeamSched = Date.now();
  try {
    teamSchedule = buildRollingTeamSchedule(decided, {
      startDate: weekStartDate,
      horizonWeeks: DEFAULT_TEAM_SCHEDULE_CONFIG.schedulingHorizonWeeks,
      teamMembers: DEFAULT_TEAM_MEMBERS,
      config: DEFAULT_TEAM_SCHEDULE_CONFIG,
      tradePriority,
      includeWatch: false,
    }) ?? EMPTY_TEAM_SCHEDULE;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[TEAM SCHEDULE CRASH]", err);
    teamSchedule = EMPTY_TEAM_SCHEDULE;
  }
  // eslint-disable-next-line no-console
  console.log(`[operator-timing] team_schedule ms=${Date.now() - tTeamSched}`);
  const teamScheduleByKey = teamSchedule.byKey;
  const scheduleByKey = new Map<string, string>();
  for (const e of globalSchedule.entries) scheduleByKey.set(e.leadKey, e.date);
  // eslint-disable-next-line no-console
  console.log(
    `[debug-schedule] inputLeads=${decided.length} ` +
    `globalScheduled=${globalSchedule.entries.length} ` +
    `globalOverflow=${globalSchedule.overflowEntries.length} ` +
    `teamScheduled=${teamSchedule.totals.scheduled} ` +
    `teamOverflow=${teamSchedule.totals.overflow} ` +
    `weekStart="${weekStartDate.slice(0, 10)}"`,
  );

  // Per-trade diagnostic, derived from the global schedule (bucket
  // counts come from each trade's input pool).
  const tradeOfKey = new Map<string, string>();
  for (const group of decidedByModule) {
    for (const l of group.leads) tradeOfKey.set(l.id, group.mid);
  }
  const perTrade: Record<string, { callNow: number; callThisWeek: number; scheduled: number }> = {};
  for (const m of SOURCE_BACKED_MODULES) perTrade[m] = { callNow: 0, callThisWeek: 0, scheduled: 0 };
  for (const l of decided) {
    const t = tradeOfKey.get(l.id) ?? "unknown";
    if (!perTrade[t]) perTrade[t] = { callNow: 0, callThisWeek: 0, scheduled: 0 };
    if (l.decision.bucket === "Call now") perTrade[t].callNow++;
    if (l.decision.bucket === "Call this week") perTrade[t].callThisWeek++;
  }
  for (const e of globalSchedule.entries) {
    const t = tradeOfKey.get(e.leadKey) ?? "unknown";
    if (!perTrade[t]) perTrade[t] = { callNow: 0, callThisWeek: 0, scheduled: 0 };
    perTrade[t].scheduled++;
  }
  for (const [t, c] of Object.entries(perTrade)) {
    verboseOperatorLog(
      `[schedule] trade=${t} callNow=${c.callNow} callThisWeek=${c.callThisWeek} ` +
      `scheduled=${c.scheduled}`,
    );
  }
  // ── Source supply audit ────────────────────────────────────────────
  // Compare available qualified leads against the weekly demand
  // (5 weekdays × 20). If we're short, log [source-shortage] and
  // [source-expansion-needed] so the ops team sees which providers
  // need to come online. We never invent leads.
  const WEEKDAYS = 5;
  const weeklyTarget = 20 * WEEKDAYS;
  const availableQualified = decided.length;
  if (availableQualified < weeklyTarget) {
    const missing = weeklyTarget - availableQualified;
    // eslint-disable-next-line no-console
    console.log(
      `[source-shortage] needed=${weeklyTarget} available=${availableQualified} missing=${missing}`,
    );
    const SOURCE_EXPANSION_HINTS: Array<{ source: string; reason: string }> = [
      { source: "Yelp", reason: "Need more qualified leads" },
      { source: "BBB", reason: "Need more qualified leads" },
      { source: "SERP", reason: "Need more qualified leads" },
      { source: "Hunter", reason: "Need verified emails" },
      { source: "Apollo", reason: "Need verified emails" },
      { source: "Site Scrape", reason: "Need contact-page enrichment" },
      { source: "Manual Upload", reason: "Operator-curated supplemental list" },
    ];
    for (const hint of SOURCE_EXPANSION_HINTS) {
      verboseOperatorLog(
        `[source-expansion-needed] source="${hint.source}" reason="${hint.reason}"`,
      );
    }
  }

  // Email-supply audit — flag the leads still missing a verified email
  // so an enrichment provider can pick them up. Never invents addresses.
  const noEmailCount = decided.filter((l) => !l.email).length;
  if (noEmailCount > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[email-shortage] needsEmail=${noEmailCount} provider="not_connected"`,
    );
  }

  // ── Daily volume audit ─────────────────────────────────────────────
  // Log a per-day [schedule-volume] line so a shortage is always
  // visible. Never invent leads to backfill — if there are fewer
  // than 20 qualified leads, the shortage stays.
  const DAILY_TARGET = 20;
  for (const [date, day] of Object.entries(teamSchedule.perDay)) {
    const scheduled = day.calls;
    const shortage = Math.max(0, DAILY_TARGET - scheduled);
    verboseOperatorLog(
      `[schedule-volume] date="${date}" target=${DAILY_TARGET} ` +
      `scheduled=${scheduled} shortage=${shortage}`,
    );
  }

  // Compact perDay summary for the global log: { "YYYY-MM-DD": calls }.
  const perDayCompact: Record<string, number> = {};
  for (const [k, v] of Object.entries(globalSchedule.perDay)) perDayCompact[k] = v.calls;
  const totalCallableInputs =
    globalSchedule.totals.callNow + globalSchedule.totals.callThisWeek;
  console.log(
    `[schedule-global] totalCalls=${totalCallableInputs} ` +
    `scheduled=${globalSchedule.totals.scheduled} ` +
    `overflow=${globalSchedule.totals.overflow} ` +
    `perDay=${JSON.stringify(perDayCompact)}`,
  );

  // Convert NormalizedLead → the lead shape OperatorConsole consumes.
  // Only fields the existing UI reads are populated; the rest stay
  // undefined so legacy diagnostics gracefully degrade.
  for (const l of decided) {
    verboseOperatorLog(
      `[contact] lead="${l.companyName}" phone=${l.phone ? "present" : "missing"} ` +
      `email=${l.email ? "present" : "missing"}`,
    );
  }
  const uiLeads = decided.map((l, idx) => {
    const ui = toUiLead(l, idx);
    // Prefer the rolling team-schedule slot. Falls back to the global
    // group-by-day stamp when a lead overflowed the horizon.
    const teamSlot = teamScheduleByKey.get(l.id);
    if (teamSlot) {
      (ui as UiLead & { scheduledFor: string; assignedRepId: string; slotLocked: boolean; assignmentSource: string }).scheduledFor = teamSlot.startIso;
      (ui as UiLead & { assignedRepId: string }).assignedRepId = teamSlot.repId;
      (ui as UiLead & { slotLocked: boolean }).slotLocked = teamSlot.locked;
      (ui as UiLead & { assignmentSource: string }).assignmentSource = teamSlot.source;
      if (teamSlot.leadTier) {
        (ui as UiLead & { leadTier: string }).leadTier = teamSlot.leadTier;
      }
    } else {
      const stamped = scheduleByKey.get(l.id);
      if (stamped) (ui as UiLead & { scheduledFor: string }).scheduledFor = stamped;
    }
    return ui;
  });
  const uiLeadById = new Map(uiLeads.map((lead) => [lead.id, lead]));

  // Per-rep + per-week + today/this-week workload summary.
  // todayKey resolves in the business timezone so a Vercel function
  // running in UTC still groups assignments by the operator's local
  // working day.
  const todayKey = getBusinessTodayIso();
  const thisWeekStartKey = getWeekStartIso();
  const todayAssignments = teamSchedule.assignments.filter((a) => a.date === todayKey);
  const todayPerRep: Record<string, number> = {};
  for (const r of DEFAULT_TEAM_MEMBERS) todayPerRep[r.id] = 0;
  for (const a of todayAssignments) {
    todayPerRep[a.repId] = (todayPerRep[a.repId] ?? 0) + 1;
  }
  const thisWeekCalls = teamSchedule.perWeek[thisWeekStartKey] ?? 0;
  const teamWorkload = {
    perRep: DEFAULT_TEAM_MEMBERS.map((r) => {
      const total = teamSchedule.assignments.filter((a) => a.repId === r.id).length;
      const today = todayPerRep[r.id] ?? 0;
      return { id: r.id, name: r.name, total, today };
    }),
    perWeek: teamSchedule.perWeek,
    horizonWeeks: DEFAULT_TEAM_SCHEDULE_CONFIG.schedulingHorizonWeeks,
    weekendSkips: teamSchedule.weekendSkips,
    scheduled: teamSchedule.totals.scheduled,
    overflow: teamSchedule.totals.overflow,
    today: todayAssignments.length,
    thisWeek: thisWeekCalls,
  };

  const groups = groupByDecision(uiLeads);
  const callTheseFirst = groups.callNow;
  const todayList = groups.callThisWeek;
  const WATCH_VISIBLE_CAP = 17;
  const remaining = groups.watch.slice(0, WATCH_VISIBLE_CAP);
  const rest = [
    ...groups.watch.slice(WATCH_VISIBLE_CAP),
    ...groups.skip,
  ];

  // Pipeline + CRM still come from existing stores (empty when nothing
  // has been logged yet — honest empty).
  const snapshots = isolateDemoData ? [] : await listSnapshots();
  const pipelineMap = buildPipelineMapFromSnapshots(snapshots);
  const durableOutcomeMap: Record<string, ExecutionOutcomeMapValue> = isolateDemoData
    ? {}
    : await loadDurableOutcomeMap(workspace.slug);
  const todaySuppression = buildRecentTodaySuppression({
    activities: recentActivitiesAll,
    snapshots,
    durableOutcomeMap,
  });

  const roi = { totalLeads: uiLeads.length, contacted: 0, interested: 0, closedWon: 0, closedLost: 0 };
  for (const snap of snapshots) {
    const s = (snap.status ?? "").toUpperCase();
    if (["CONTACTED","CALLED","INTERESTED","QUALIFIED","PITCHED","CLOSED_WON","CLOSED_LOST"].includes(s)) roi.contacted++;
    if (["INTERESTED","QUALIFIED","PITCHED","CLOSED_WON"].includes(s)) roi.interested++;
    if (s === "CLOSED_WON") roi.closedWon++;
    if (s === "CLOSED_LOST") roi.closedLost++;
  }

  // Today Queue + calendar both source from `callTheseFirst` →
  // `buildTasksFromLeads` → `applyLaborTechDemoSchedule`. If the
  // rendered queue ever disagrees with this log, the divergence is
  // downstream (CRM filter applied at task-build time, snapshot
  // drift, or override merge). The excluded-terminal count is the
  // number of leads stripped by tasks.ts before scheduling — they
  // never reach Today Queue or any calendar column.
  const excludedTerminalCRM = uiLeads.filter((l) => {
    const s = (pipelineMap[l.id]?.status ?? "").toUpperCase();
    return s === "CLOSED_WON" || s === "CLOSED_LOST" || s === "DISQUALIFIED";
  }).length;
  // eslint-disable-next-line no-console
  console.log(
    `[today-queue-source] callTheseFirst=${callTheseFirst.length} ` +
    `todayList=${todayList.length} remaining=${remaining.length} rest=${rest.length} ` +
    `totalLeads=${uiLeads.length} excludedTerminalCRM=${excludedTerminalCRM} ` +
    `roi.contacted=${roi.contacted} roi.closedWon=${roi.closedWon}`,
  );

  const today = new Date();
  const calStart = new Date(today); calStart.setDate(calStart.getDate() - 7);
  const calEnd = new Date(today); calEnd.setDate(calEnd.getDate() + 7);
  const calendarEvents = isolateDemoData
    ? []
    : await getCalendarEvents(
      calStart.toISOString().split("T")[0],
      calEnd.toISOString().split("T")[0]
    );

  const recentActivities = recentActivitiesAll;
  const jobHistory = isolateDemoData ? [] : await getJobHistory();
  const lastJob = jobHistory[0] ?? null;
  const pendingReviews: unknown[] = [];

  // Temporary diagnostic line — removed once ingestion is fully wired.
  console.log(
    `[operator] workspace=${workspace.slug} moduleId=${moduleId} loaded=${uiLeads.length} ` +
    `callNow=${groups.callNow.length} callThisWeek=${groups.callThisWeek.length} ` +
    `watch=${groups.watch.length} skip=${groups.skip.length}`,
  );

  // ── Service-bucket aggregation (per trade) ──────────────────────────
  // Classifies each lead's LaborTech service needs, then aggregates the
  // per-service counts so the trade panel can render bucket cards and
  // the filtered "Companies needing <service> today" list.
  type ServiceBucketCard = {
    serviceId: string;
    label: string;
    tier: "primary" | "secondary" | "advanced";
    count: number;
    topLeadName: string | null;
    topReason: string | null;
    leadKeys: string[];
  };
  type FilteredLeadEntry = {
    leadKey: string;
    companyName: string;
    location?: string;
    phone?: string;
    phoneAuthority?: "dialable";
    companyKey?: string;
    crmKey?: string;
    serviceLabel: string;
    reason: string;
    needScore: number;
    urgency: "call_now" | "build_next" | "monitor";
    suggestedPitch: string;
    services: { id: string; label: string }[];
    /** All service buckets this company belongs to. A single company
     *  can need multiple LaborTech services — this array surfaces
     *  every match so the lead card can show all tags and the user
     *  understands the multi-bucket classification. */
    serviceTags: { id: string; label: string; reason: string }[];
    /** Canonical lead state — drives header counts + section grouping
     *  on the All Leads screen. Derived from CRM status + pipeline
     *  follow-up dates + closeability. One state per lead. */
    leadState?: "ready_to_call" | "in_progress" | "follow_up" | "closed";
    findings: { issue: string; evidence: string; impact: string; confidence: "high" | "medium" | "low" }[];
    closeProbability?: number;
    closeLabel?: string;
    primaryAngleLabel?: string;
    primaryAngleEvidence?: string;
    primaryAngleImpact?: string;
    opener?: string;
    recommendedOffer?: string;
    topObjection?: { objection: string; response: string };
  };
  type ServiceBucketsForTrade = {
    cards: ServiceBucketCard[];
    leadsByService: Record<string, FilteredLeadEntry[]>;
  };
  const serviceBucketsByTrade: Record<string, ServiceBucketsForTrade> = {};
  const tStrategy = Date.now();
  for (const group of decidedByModule) {
    const tradeCfg = getTradeServices(group.mid);
    if (!tradeCfg) {
      serviceBucketsByTrade[group.mid] = { cards: [], leadsByService: {} };
      continue;
    }
    // Classify each lead → list of service needs. Track which leads
    // need which service so we can both aggregate counts and surface
    // the per-service filtered list.
    const needsByLead = group.leads.map((l) => classifyLeadServiceNeeds(l, group.mid));
    const buckets = aggregateServiceBuckets(needsByLead);

    // Stamp the highest-priority pitch onto each lead so the calendar
    // task generator can pull it as the rep-ready callScript. Also
    // generate the full sales strategy (3 angles + objections + call
    // plan + close probability) for downstream surfaces.
    for (let i = 0; i < group.leads.length; i++) {
      const top = needsByLead[i][0];
      const lead = group.leads[i];
      if (top?.suggestedPitch) {
        (lead as unknown as {
          serviceNeed?: {
            suggestedPitch?: string;
            needScore?: number;
            urgency?: string;
            serviceId?: string;
            label?: string;
            reason?: string;
          };
        }).serviceNeed = {
          suggestedPitch: top.suggestedPitch,
          needScore: top.needScore,
          urgency: top.urgency,
          serviceId: top.serviceId,
          label: top.label,
          reason: top.reason,
        };
      }
      const strategy = generateSalesStrategy(lead, needsByLead[i]);
      lead.salesStrategy = strategy;
      verboseOperatorLog(
        `[sales-strategy] lead="${lead.companyName}" close=${strategy.closeProbability} ` +
        `primary="${strategy.primaryAngle?.label ?? "n/a"}"`,
      );
      strategy.angles.forEach((a) => {
        verboseOperatorLog(
          `[sales-angle] lead="${lead.companyName}" rank=${a.rank} ` +
          `issue="${a.label}" service="${a.serviceId ?? "n/a"}"`,
        );
      });
      verboseOperatorLog(
        `[sales-objection] lead="${lead.companyName}" count=${strategy.objections.length}`,
      );
    }

    // Build the filtered-lead lists keyed by serviceId.
    const leadsByService: Record<string, FilteredLeadEntry[]> = {};
    for (let i = 0; i < group.leads.length; i++) {
      const lead = group.leads[i];
      const needs = needsByLead[i];
      const opp = lead.decision?.primaryOpportunity;
      const sellList = opp?.services ?? [];
      const diag = lead.diagnostics;
      const findingsCompact = diag?.findings?.slice(0, 2).map((f) => ({
        issue: f.issue,
        evidence: f.evidence,
        impact: f.impact,
        confidence: f.confidence,
      })) ?? [];
      // Verbose per-lead diagnostic log line.
      verboseOperatorLog(
        `[diagnostics] lead=${lead.companyName ?? lead.id} ` +
        `findings=${diag?.findings.length ?? 0} ` +
        `top=${diag?.topFinding?.type ?? "none"}`,
      );
      const strategy = lead.salesStrategy;
      const dialablePhone = getDialablePhone(lead);
      const stableServiceCompanyKey = companyKey({
        name: lead.companyName,
        domain: lead.website,
        url: lead.website,
        location: lead.location,
      });
      const primary = strategy?.primaryAngle;
      const topObj = strategy?.objections?.[0];
      // Multi-bucket membership — every service this company needs.
      // The lead card uses this to show all matching service tags so
      // the user can see (and click through to) every bucket the
      // company belongs to.
      const serviceTags = needs.map((n) => ({
        id: n.serviceId,
        label: n.label,
        reason: n.reason,
      }));
      for (const need of needs) {
        const list = leadsByService[need.serviceId] ?? (leadsByService[need.serviceId] = []);
        list.push({
          leadKey: lead.id,
          companyKey: stableServiceCompanyKey,
          crmKey: stableServiceCompanyKey,
          companyName: lead.companyName,
          location: lead.location,
          phone: dialablePhone ?? undefined,
          phoneAuthority: dialablePhone ? "dialable" : undefined,
          serviceLabel: need.label,
          reason: need.reason,
          needScore: need.needScore,
          urgency: need.urgency,
          suggestedPitch: need.suggestedPitch,
          services: sellList.map((s) => ({ id: s.id, label: s.label })),
          serviceTags,
          findings: findingsCompact,
          closeProbability: strategy?.closeProbability,
          closeLabel: strategy?.closeLabel,
          primaryAngleLabel: primary?.label,
          primaryAngleEvidence: primary?.evidence,
          primaryAngleImpact: primary?.impact,
          opener: strategy?.callPlan?.opener,
          recommendedOffer: strategy?.callPlan?.recommendedOffer,
          topObjection: topObj
            ? { objection: topObj.objection, response: topObj.response }
            : undefined,
        });
      }
    }
    // Sort each list by needScore desc, then decision.score desc (we
    // don't have decision in the entry but the original order was
    // already sorted by score within the trade).
    for (const sid of Object.keys(leadsByService)) {
      leadsByService[sid].sort((a, z) => z.needScore - a.needScore);
    }

    // Build the per-tier card list.
    const tierMap: Record<string, "primary" | "secondary" | "advanced"> = {};
    for (const sid of tradeCfg.primary) tierMap[sid] = "primary";
    for (const sid of tradeCfg.secondary) tierMap[sid] = "secondary";
    for (const sid of tradeCfg.advanced) tierMap[sid] = "advanced";

    const cards: ServiceBucketCard[] = [];
    for (const sid of [...tradeCfg.primary, ...tradeCfg.secondary, ...tradeCfg.advanced]) {
      const agg = buckets.get(sid);
      const list = leadsByService[sid] ?? [];
      const top = list[0];
      const catalogLabel = getServiceCatalogEntry(sid)?.label;
      const card: ServiceBucketCard = {
        serviceId: sid,
        label: top?.serviceLabel ?? catalogLabel ?? sid,
        tier: tierMap[sid] ?? "secondary",
        count: agg?.count ?? 0,
        topLeadName: top?.companyName ?? null,
        topReason: agg?.topReason ?? null,
        leadKeys: list.map((e) => e.leadKey),
      };
      cards.push(card);
      verboseOperatorLog(
        `[service-bucket] trade=${group.mid} service=${sid} count=${card.count} ` +
        `topLead="${card.topLeadName ?? ""}"`,
      );
    }
    verboseOperatorLog(
      `[service-ui] trade=${group.mid} services=${cards.length}`,
    );

    serviceBucketsByTrade[group.mid] = { cards, leadsByService };
  }
  // eslint-disable-next-line no-console
  console.log(`[operator-timing] strategy_and_buckets ms=${Date.now() - tStrategy} leads=${decided.length}`);

  const sourceReadiness = getSourceReadiness();

  // Server-side env-var inventory. The browser cannot read process.env
  // for non-NEXT_PUBLIC keys, so we resolve them here and forward only
  // the *names* of the connected ones — never the values.
  const connectedEnvVars = ALL_TRADE_ENV_VARS.filter((name) => {
    const v = process.env[name];
    return typeof v === "string" && v.trim().length > 0;
  });

  // Server-side Hunter availability — boolean only. The key value
  // never crosses the network boundary; only the presence flag is
  // forwarded to the client so LeadEmailAction can decide whether to
  // render the "Find Email" mode.
  const hunterAvailable =
    typeof process.env.HUNTER_API_KEY === "string"
    && process.env.HUNTER_API_KEY.trim().length > 0;

  // Build the prop bag once so we can both render and persist it.
  const operatorProps = withRecentTodaySuppression(mergeDurableOutcomesIntoOperatorProps(mergeCurrentCrmIntoOperatorProps(normalizeOperatorPhoneProps({
    sourceReadiness,
    connectedEnvVars,
    hunterAvailable,
    overflowQueueCount: teamSchedule.overflowEntries.length,
    // Capped overflow queue exposed to the client so the
    // ExecutionOutcomePanel can pull-forward the next eligible lead
    // when an outbound call outcome is recorded. Cap of 50 keeps the
    // SSR payload small; the daily call cap is 20 so 50 is plenty of
    // runway. Each entry carries the leadKey + companyName for the
    // POST. Order is the team scheduler's priority — first entry is
    // always the strongest available pull.
    overflowEntries: (teamSchedule.overflowEntries ?? []).slice(0, 50).map((e) => ({
      leadKey: e.leadKey,
      companyKey: uiLeadById.get(e.leadKey)?.companyKey ?? e.leadKey,
      crmKey: uiLeadById.get(e.leadKey)?.crmKey ?? uiLeadById.get(e.leadKey)?.companyKey ?? e.leadKey,
      companyName: (e as unknown as { companyName?: string }).companyName ?? null,
    })),
    serviceBucketsByTrade,
    teamWorkload,
    callTheseFirst,
    todayList,
    remaining,
    rest,
    pendingReviews,
    totalPipeline: uiLeads.length,
    pipelineMap,
    serverExecutionOutcomeMap: durableOutcomeMap,
    roi,
    calendarEvents,
    recentActivities: recentActivities.slice(0, 30),
    lastPipelineJob: lastJob
      ? { completedAt: lastJob.completedAt, errors: lastJob.errors.length, enriched: lastJob.steps.enrich?.succeeded ?? 0 }
      : null,
  }), snapshots), durableOutcomeMap), todaySuppression);

  const slowGeneratedAt = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`[operator-timing] SLOW_PATH total_ms=${Date.now() - t0} workspace=${workspace.slug}`);

  // Best-effort snapshot write so the next render on this container
  // hits the fast path. Vercel /tmp is ephemeral; the in-bundle
  // snapshot is the durable artifact and must be regenerated locally.
  if (snapshotEnabled) {
    void writeOperatorSnapshot(workspace.slug, operatorProps).then((ok) => {
      // eslint-disable-next-line no-console
      console.log(`[operator-timing] snapshot_write ok=${ok} workspace=${workspace.slug}`);
    });
  }

  // Apply persisted overrides on top of the freshly computed lists.
  const overridesSlow = isolateDemoData ? [] : await listOverrides(workspace.slug);
  const mergedSlow = applyScheduleOverrides(operatorProps, overridesSlow);

  return (
    <OperatorConsole
      user={{ name: user.name ?? user.id, id: user.id }}
      workspace={workspace}
      {...mergedSlow}
      relationshipEngineOperatorSurface={null}
      snapshotGeneratedAt={slowGeneratedAt}
      snapshotIsFresh={true}
      snapshotHydrationNow={slowGeneratedAt}
    />
  );
}

type PipelineData = {
  status: string;
  lastAction: { type: string; outcome?: string; performedAt: string } | null;
  nextAction: string | null;
  nextActionDate: string | null;
  contactName: string | null;
  contactPhone: string | null;
  dealActionCount: number;
  callAttempts: number;
  consecutiveNoAnswers: number;
  escalationStage: number;
};

function pipelineEntryFromSnapshot(snap: CompanySnapshot): PipelineData {
  return {
    status: snap.status ?? "NEW",
    lastAction: snap.lastAction ?? null,
    nextAction: snap.nextAction ?? null,
    nextActionDate: snap.nextActionDate ?? null,
    contactName: snap.contactName ?? null,
    contactPhone: snap.contactPhone ?? null,
    dealActionCount: snap.dealActions?.length ?? 0,
    callAttempts: snap.callAttempts ?? 0,
    consecutiveNoAnswers: snap.consecutiveNoAnswers ?? 0,
    escalationStage: snap.escalationStage ?? 0,
  };
}

function buildPipelineMapFromSnapshots(snapshots: CompanySnapshot[]): Record<string, PipelineData> {
  const pipelineMap: Record<string, PipelineData> = {};
  for (const snap of snapshots) {
    pipelineMap[snap.key] = pipelineEntryFromSnapshot(snap);
  }
  return pipelineMap;
}

function mergeCurrentCrmIntoOperatorProps<T extends Record<string, unknown>>(
  props: T,
  snapshots: CompanySnapshot[],
): T {
  const pipelineMap = buildPipelineMapFromSnapshots(snapshots);
  const snapshotByKey: Record<string, CompanySnapshot> = {};
  for (const snap of snapshots) snapshotByKey[snap.key] = snap;

  const mergeLead = (item: unknown): unknown => {
    if (!item || typeof item !== "object") return item;
    const lead = item as Record<string, unknown>;
    const resolved = resolveByLeadIdentity(lead, snapshotByKey);
    if (!resolved.value) return lead;
    const pipe = pipelineEntryFromSnapshot(resolved.value);
    return {
      ...lead,
      companyKey: typeof lead.companyKey === "string" && lead.companyKey ? lead.companyKey : resolved.key,
      crmKey: typeof lead.crmKey === "string" && lead.crmKey ? lead.crmKey : resolved.key,
      accountSnapshot: {
        ...((lead.accountSnapshot && typeof lead.accountSnapshot === "object") ? lead.accountSnapshot : {}),
        status: pipe.status,
      },
      crm: {
        ...((lead.crm && typeof lead.crm === "object") ? lead.crm : {}),
        status: pipe.status,
      },
    };
  };

  const mergeList = (value: unknown): unknown => Array.isArray(value) ? value.map(mergeLead) : value;

  return {
    ...props,
    pipelineMap: {
      ...((props.pipelineMap && typeof props.pipelineMap === "object") ? props.pipelineMap : {}),
      ...pipelineMap,
    },
    callTheseFirst: mergeList(props.callTheseFirst),
    todayList: mergeList(props.todayList),
    remaining: mergeList(props.remaining),
    rest: mergeList(props.rest),
  } as T;
}

function statusFromDurableOutcome(status: string | null | undefined): string | null {
  switch (status) {
    case "Called":
      return "CONTACTED";
    case "Interested":
    case "Follow Up":
      return "FOLLOW_UP";
    case "Proposal Sent":
    case "Qualified":
      return "QUALIFIED";
    case "Closed Won":
      return "CLOSED_WON";
    case "Closed Lost":
      return "CLOSED_LOST";
    case "Not Qualified":
      return "NOT_QUALIFIED";
    default:
      return null;
  }
}

function mergeDurableOutcomesIntoOperatorProps<T extends Record<string, unknown>>(
  props: T,
  durableOutcomeMap: Record<string, ExecutionOutcomeMapValue>,
): T {
  const resolveOutcome = (item: unknown): ExecutionOutcomeMapValue | null => {
    if (!item || typeof item !== "object") return null;
    const lead = item as Record<string, unknown>;
    const directKeys = [
      typeof lead.id === "string" ? `lead-${lead.id}-call` : null,
      typeof lead.key === "string" ? `lead-${lead.key}-call` : null,
    ].filter((key): key is string => !!key);
    for (const key of directKeys) {
      if (durableOutcomeMap[key]) return durableOutcomeMap[key];
    }
    return resolveByLeadIdentity(lead, durableOutcomeMap).value;
  };

  const mergeLead = (item: unknown): unknown => {
    if (!item || typeof item !== "object") return item;
    const lead = item as Record<string, unknown>;
    const outcome = resolveOutcome(lead);
    const status = statusFromDurableOutcome(outcome?.status);
    if (!status) return lead;
    return {
      ...lead,
      accountSnapshot: {
        ...((lead.accountSnapshot && typeof lead.accountSnapshot === "object") ? lead.accountSnapshot : {}),
        status,
      },
      crm: {
        ...((lead.crm && typeof lead.crm === "object") ? lead.crm : {}),
        status,
      },
    };
  };

  const mergeOpenList = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value
      .map(mergeLead)
      .filter((item) => {
        if (!item || typeof item !== "object") return true;
        const outcome = resolveOutcome(item);
        const status = statusFromDurableOutcome(outcome?.status);
        return !isTerminalStatusValue(status);
      });
  };

  return {
    ...props,
    serverExecutionOutcomeMap: durableOutcomeMap,
    callTheseFirst: mergeOpenList(props.callTheseFirst),
    todayList: mergeOpenList(props.todayList),
    remaining: mergeOpenList(props.remaining),
    rest: mergeOpenList(props.rest),
  } as T;
}

type TodaySuppressionInfo = {
  generatedAt: string;
  windowHours: number;
  companyKeys: string[];
  leadKeys: string[];
  latestActivityAt: string | null;
};

function recentEnough(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && nowMs - ms >= 0 && nowMs - ms < RECENT_CALL_SUPPRESSION_MS;
}

function normalizeRecentStatus(status: string | null | undefined): string {
  return (status ?? "").trim().toUpperCase().replace(/\s+/g, "_");
}

function buildRecentTodaySuppression({
  activities,
  snapshots,
  durableOutcomeMap,
}: {
  activities: CrmActivity[];
  snapshots: CompanySnapshot[];
  durableOutcomeMap: Record<string, ExecutionOutcomeMapValue>;
}): TodaySuppressionInfo {
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const companyKeys = new Set<string>();
  let latestActivityAt: string | null = null;

  const remember = (key: string | null | undefined, at: string | null | undefined) => {
    if (!key || !recentEnough(at, now)) return;
    companyKeys.add(key);
    if (!latestActivityAt || (at && at > latestActivityAt)) latestActivityAt = at ?? latestActivityAt;
  };

  for (const activity of activities) {
    const kind = typeof activity.metadata?.kind === "string" ? activity.metadata.kind : "";
    const suppresses =
      RECENT_ACTIVITY_TYPES.has(activity.activityType)
      || activity.outcome === "follow_up_needed"
      || RECENT_ACTIVITY_KINDS.has(kind);
    if (suppresses) remember(activity.companyKey, activity.performedAt);
  }

  for (const snap of snapshots) {
    for (const change of snap.statusHistory ?? []) {
      if (RECENT_STATUS_VALUES.has(normalizeRecentStatus(change.status))) {
        remember(snap.key, change.changedAt);
      }
    }
    const lastActionType = normalizeRecentStatus(snap.lastAction?.type);
    if (RECENT_STATUS_VALUES.has(lastActionType) || RECENT_ACTIVITY_TYPES.has((snap.lastAction?.type ?? "").toLowerCase())) {
      remember(snap.key, snap.lastAction?.performedAt);
    }
  }

  for (const [key, outcome] of Object.entries(durableOutcomeMap)) {
    if (RECENT_OUTCOME_VALUES.has(outcome.status)) remember(key, outcome.lastActionAt);
  }

  return {
    generatedAt,
    windowHours: 24,
    companyKeys: Array.from(companyKeys),
    leadKeys: [],
    latestActivityAt,
  };
}

function withRecentTodaySuppression<T extends Record<string, unknown>>(
  props: T,
  suppression: TodaySuppressionInfo,
): T {
  if (suppression.companyKeys.length === 0) {
    return { ...props, todaySuppression: suppression } as T;
  }
  const suppressed = new Set(suppression.companyKeys);
  const leadKeys = new Set<string>();
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const candidates = leadIdentityCandidates(item as Parameters<typeof leadIdentityCandidates>[0]);
      if (!candidates.some((key) => suppressed.has(key))) continue;
      candidates.forEach((key) => leadKeys.add(key));
    }
  };
  collect(props.callTheseFirst);
  collect(props.todayList);
  collect(props.remaining);
  collect(props.rest);

  return {
    ...props,
    todaySuppression: {
      ...suppression,
      leadKeys: Array.from(leadKeys),
    },
  } as T;
}

// ── NormalizedLead → operator-console UI shape ─────────────────────────
// OperatorConsole was originally fed CompanyDecision-shaped objects.
// Here we attach the same field surface around a NormalizedLead so the
// existing card render (name / location / contacts / decision) works
// unchanged. Diagnostic-only fields stay undefined and the legacy code
// falls back to its empty branches.
type UiLead = NormalizedLead & {
  decision: LeadDecision;
  key: string;
  name: string;
  rank: number;
  score: number;
  trade: string;
  contacts: { primaryPhone?: string; primaryEmail?: string; source?: string };
  domain?: string;
  resolvedBusinessUrl?: string;
  companyKey: string;
  crmKey: string;
  accountSnapshot?: { status: string };
};

function toUiLead(lead: NormalizedLead & { decision: LeadDecision }, idx: number): UiLead {
  const stableCompanyKey = companyKey({
    name: lead.companyName,
    domain: lead.website,
    url: lead.website,
    location: lead.location,
  });
  const uiLead: UiLead = {
    ...lead,
    key: lead.id,
    name: lead.companyName,
    rank: idx + 1,
    score: lead.decision.score,
    contacts: {
      primaryPhone: lead.phone,
      primaryEmail: lead.email,
      source: lead.source,
    },
    domain: lead.website,
    resolvedBusinessUrl: lead.website,
    companyKey: stableCompanyKey,
    crmKey: stableCompanyKey,
    // Tag the lead with its trade so OperatorConsole's filter
    // (filterLeadsForTrade) routes it to the correct module.
    trade: lead.moduleId,
    accountSnapshot: { status: lead.crm.status ?? "NEW" },
  };
  return withCanonicalPhoneContact(uiLead);
}

function normalizeOperatorPhoneProps<T extends Record<string, unknown>>(props: T): T {
  const withStableCompanyKey = (item: Record<string, unknown>): Record<string, unknown> => {
    const name =
      typeof item.name === "string" && item.name.trim()
        ? item.name
        : typeof item.companyName === "string" && item.companyName.trim()
          ? item.companyName
          : null;
    const domain =
      typeof item.domain === "string" && item.domain.trim()
        ? item.domain
        : typeof item.website === "string" && item.website.trim()
          ? item.website
          : typeof item.resolvedBusinessUrl === "string" && item.resolvedBusinessUrl.trim()
            ? item.resolvedBusinessUrl
            : null;
    if (!name) return item;
    const stableCompanyKey = companyKey({
      name,
      ...(domain ? { domain, url: domain } : {}),
      ...(typeof item.location === "string" ? { location: item.location } : {}),
    });
    return {
      ...item,
      companyKey: typeof item.companyKey === "string" && item.companyKey ? item.companyKey : stableCompanyKey,
      crmKey: typeof item.crmKey === "string" && item.crmKey ? item.crmKey : stableCompanyKey,
    };
  };

  const normalizeList = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.map((item) => {
      if (!item || typeof item !== "object") return item;
      return withCanonicalPhoneContact(
        withStableCompanyKey(item as Record<string, unknown>) as CanonicalPhoneLeadLike,
      );
    });
  };

  return {
    ...props,
    callTheseFirst: normalizeList(props.callTheseFirst),
    todayList: normalizeList(props.todayList),
    remaining: normalizeList(props.remaining),
    rest: normalizeList(props.rest),
  } as T;
}

// ── Inline workspace picker ───────────────────────────────────────────

function WorkspacePicker({
  workspaces,
  userName,
}: {
  workspaces: WorkspaceConfig[];
  userName: string;
}) {
  return (
    <div style={pickerStyles.root}>
      <div style={pickerStyles.card}>
        <div style={pickerStyles.brand}>MERIDIAN</div>
        <div style={pickerStyles.sub}>Choose a workspace</div>
        <div style={pickerStyles.userLine}>Signed in as {userName}</div>
        <div style={pickerStyles.list}>
          {workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/operator?workspace=${ws.slug}`}
              style={pickerStyles.item}
            >
              <div style={pickerStyles.itemName}>{ws.branding?.displayName ?? ws.name}</div>
              <div style={pickerStyles.itemMeta}>
                {ws.enabledModules.length} module{ws.enabledModules.length === 1 ? "" : "s"} live
                {ws.comingSoonModules.length > 0
                  ? ` · ${ws.comingSoonModules.length} coming soon`
                  : ""}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function NoWorkspaceState({ userName }: { userName: string }) {
  return (
    <div style={pickerStyles.root}>
      <div style={pickerStyles.card}>
        <div style={pickerStyles.brand}>MERIDIAN</div>
        <div style={pickerStyles.sub}>No workspace assigned</div>
        <div style={pickerStyles.userLine}>Signed in as {userName}</div>
        <p style={pickerStyles.empty}>
          Your account is not yet assigned to a workspace. Contact your admin
          or request access at hello@meridian.ai.
        </p>
      </div>
    </div>
  );
}

function WorkspaceAccessDeniedState({
  requestedSlug,
  workspaces,
  reason,
}: {
  requestedSlug: string;
  workspaces: WorkspaceConfig[];
  reason: string;
}) {
  const message =
    reason === "unknown_workspace"
      ? "That workspace link does not match a known Meridian workspace."
      : "Your account is signed in, but it is not authorized for that workspace.";
  return (
    <div style={pickerStyles.root}>
      <div style={pickerStyles.card}>
        <div style={pickerStyles.brand}>MERIDIAN</div>
        <div style={pickerStyles.sub}>Workspace access blocked</div>
        <p style={pickerStyles.empty}>
          {message} Requested workspace: {requestedSlug}.
        </p>
        {workspaces.length > 0 ? (
          <div style={pickerStyles.list}>
            {workspaces.map((ws) => (
              <Link key={ws.id} href={`/operator?workspace=${ws.slug}`} style={pickerStyles.item}>
                <div style={pickerStyles.itemName}>{ws.branding?.displayName ?? ws.name}</div>
                <div style={pickerStyles.itemMeta}>Open authorized workspace</div>
              </Link>
            ))}
          </div>
        ) : null}
        <Link href="/login" style={pickerStyles.loginLink}>Use a different login</Link>
      </div>
    </div>
  );
}

const pickerStyles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100dvh",
    background: "#FAFBFC",
    color: "#1A1A2E",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "420px",
    padding: "32px 28px",
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: "14px",
    boxShadow: "0 4px 6px rgba(0,0,0,0.04), 0 10px 15px rgba(0,0,0,0.03)",
    boxSizing: "border-box",
  },
  brand: { fontSize: "18px", fontWeight: 700, color: "#1A1A2E", letterSpacing: "-0.01em" },
  sub: { fontSize: "12px", color: "#94A3B8", marginTop: "2px" },
  userLine: { fontSize: "12px", color: "#64748B", marginTop: "18px", marginBottom: "8px" },
  list: { display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" },
  item: {
    display: "block",
    padding: "14px 14px",
    border: "1px solid #E2E8F0",
    borderRadius: "10px",
    background: "#FAFBFC",
    textDecoration: "none",
    color: "#1A1A2E",
  },
  itemName: { fontSize: "15px", fontWeight: 600, color: "#1A1A2E" },
  itemMeta: { fontSize: "12px", color: "#64748B", marginTop: "4px" },
  empty: { fontSize: "13px", color: "#64748B", lineHeight: 1.5, marginTop: "16px" },
  loginLink: { display: "inline-block", marginTop: "16px", fontSize: "13px", color: "#2563EB" },
};
