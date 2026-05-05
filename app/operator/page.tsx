// Meridian — Operator workspace surface.
//
// Reads ?workspace=<slug>, validates against the user's session, loads the
// workspace config, and hands it to OperatorConsole alongside the engine
// payload. If the user has multiple workspaces and none was specified, a
// minimal picker is rendered. Single-workspace users are auto-routed.

import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "../../lib/auth";
import { listSnapshots } from "../../lib/state/companySnapshotStore";
import { getAllActivities, getCalendarEvents } from "../../lib/state/crmStore";
import { getJobHistory } from "../../lib/pipeline/dailyJob";
import OperatorConsole from "../../components/OperatorConsole";
import { groupByDecision, type LeadDecision } from "../../lib/scoring/decision";
import {
  loadWorkspaceLeads,
  SOURCE_BACKED_MODULES,
} from "../../lib/ingestion/loadWorkspaceLeads";
import type { NormalizedLead } from "../../lib/leads/normalizedLead";
import { buildGlobalLeadSchedule, buildRollingTeamSchedule } from "../../lib/scheduling/leadSchedule";
import { DEFAULT_TEAM_SCHEDULE_CONFIG } from "../../lib/scheduling/teamScheduleConfig";
import { DEFAULT_TEAM_MEMBERS } from "../../lib/scheduling/teamMembers";
import {
  classifyLeadServiceNeeds,
  aggregateServiceBuckets,
} from "../../lib/services/serviceNeedClassifier";
import { getTradeServices } from "../../lib/services/tradeServiceConfig";
import { generateSalesStrategy } from "../../lib/sales/salesStrategy";
import {
  getWorkspaceBySlug,
  listWorkspacesForUser,
  defaultWorkspaceFor,
  type WorkspaceConfig,
} from "../../config/workspaces";
import { getSourceReadiness } from "../../lib/sources/readiness";
import { ALL_TRADE_ENV_VARS } from "../../lib/modules/tradeSources";

export const dynamic = "force-dynamic";

type SearchParams = { workspace?: string | string[] };

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
  const user = await getSession();
  if (!user) redirect("/login");

  const params = (await searchParams) ?? {};
  const requestedSlug = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;

  const userWorkspaces = listWorkspacesForUser(user.workspaces ?? []);
  if (userWorkspaces.length === 0) {
    return <NoWorkspaceState userName={user.name ?? user.id} />;
  }

  // Resolve the active workspace.
  let workspace: WorkspaceConfig | null = null;
  if (requestedSlug) {
    const candidate = getWorkspaceBySlug(requestedSlug);
    if (candidate && userWorkspaces.some((w) => w.id === candidate.id)) {
      workspace = candidate;
    }
  }
  if (!workspace) {
    if (userWorkspaces.length === 1) {
      const only = defaultWorkspaceFor(user.workspaces ?? []);
      if (only) redirect(`/operator?workspace=${only.slug}`);
    }
    return <WorkspacePicker workspaces={userWorkspaces} userName={user.name ?? user.id} />;
  }

  // ── Workspace lead load (single bridge into ingestion) ──────────────
  // Load every module that has a wired source (its own seed file). The
  // OperatorConsole's trade selector filters by lead.trade so trades
  // stay separated — never cross-contaminate companies between modules.
  const moduleId = workspace.defaultModule;
  const moduleLoadList: string[] = Array.from(
    new Set<string>([moduleId, ...SOURCE_BACKED_MODULES]),
  );
  // eslint-disable-next-line no-console
  console.log(
    `[debug-workspace] slug="${workspace.slug}" defaultModule="${moduleId}" ` +
    `modules="${moduleLoadList.join(",")}" ` +
    `googleKeyPresent=${!!(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY)}`,
  );
  const decidedByModule = await Promise.all(
    moduleLoadList.map(async (mid) => ({
      mid,
      leads: await loadWorkspaceLeads({
        workspaceSlug: workspace.slug,
        moduleId: mid,
        limit: 25,
      }),
    })),
  );
  const decided = (decidedByModule ?? []).flatMap((g) => g?.leads ?? []);
  // eslint-disable-next-line no-console
  console.log(
    `[debug-admitted] aggregate count=${decided.length} ` +
    `byModule=${decidedByModule.map((g) => `${g.mid}:${g.leads.length}`).join(",")}`,
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

  // ── LaborTech launch start ───────────────────────────────────────────
  // Pin scheduling to Monday May 4 of the current calendar year (or
  // the next May 4 if today is already past). Single config constant
  // — change here when the launch slips.
  const LABORTECH_LAUNCH_MONTH = 5;   // May
  const LABORTECH_LAUNCH_DAY = 4;
  const launchStart = (() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const candidate = new Date(today.getFullYear(), LABORTECH_LAUNCH_MONTH - 1, LABORTECH_LAUNCH_DAY);
    candidate.setHours(0, 0, 0, 0);
    if (candidate.getTime() < today.getTime()) {
      // Past this year — push to next year so the live week still
      // anchors on Monday May 4.
      candidate.setFullYear(candidate.getFullYear() + 1);
    }
    return candidate;
  })();
  const weekStartDate = launchStart.toISOString();
  // eslint-disable-next-line no-console
  console.log(
    `[schedule-launch] start=${weekStartDate.slice(0, 10)} target=20/day weekdaysOnly=true`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[debug-schedule] inputLeads=${decided.length} weekStart="${weekStartDate.slice(0, 10)}" ` +
    `today="${new Date().toISOString().slice(0, 10)}"`,
  );

  const recentActivitiesAll = await getAllActivities();

  const EMPTY_GLOBAL_SCHEDULE: ReturnType<typeof buildGlobalLeadSchedule> = {
    entries: [],
    byKey: new Map(),
    perDay: {},
    overflowEntries: [],
    totals: { callNow: 0, callThisWeek: 0, watch: 0, scheduled: 0, overflow: 0 },
  };
  let globalSchedule: ReturnType<typeof buildGlobalLeadSchedule>;
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
    console.log(
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
      // eslint-disable-next-line no-console
      console.log(
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
    // eslint-disable-next-line no-console
    console.log(
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
    console.log(
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

  // Per-rep + per-week + today/this-week workload summary.
  const todayKey = (() => {
    const d = new Date();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${d.getFullYear()}-${m < 10 ? "0" + m : m}-${day < 10 ? "0" + day : day}`;
  })();
  const thisWeekStartKey = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    const m2 = new Date(d);
    m2.setDate(m2.getDate() + offset);
    const mm = m2.getMonth() + 1;
    const dd = m2.getDate();
    return `${m2.getFullYear()}-${mm < 10 ? "0" + mm : mm}-${dd < 10 ? "0" + dd : dd}`;
  })();
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
  const snapshots = await listSnapshots();
  const pipelineMap: Record<string, PipelineData> = {};
  for (const snap of snapshots) {
    pipelineMap[snap.key] = {
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

  const roi = { totalLeads: uiLeads.length, contacted: 0, interested: 0, closedWon: 0, closedLost: 0 };
  for (const snap of snapshots) {
    const s = (snap.status ?? "").toUpperCase();
    if (["CONTACTED","CALLED","INTERESTED","QUALIFIED","PITCHED","CLOSED_WON","CLOSED_LOST"].includes(s)) roi.contacted++;
    if (["INTERESTED","QUALIFIED","PITCHED","CLOSED_WON"].includes(s)) roi.interested++;
    if (s === "CLOSED_WON") roi.closedWon++;
    if (s === "CLOSED_LOST") roi.closedLost++;
  }

  const today = new Date();
  const calStart = new Date(today); calStart.setDate(calStart.getDate() - 7);
  const calEnd = new Date(today); calEnd.setDate(calEnd.getDate() + 7);
  const calendarEvents = await getCalendarEvents(
    calStart.toISOString().split("T")[0],
    calEnd.toISOString().split("T")[0]
  );

  const recentActivities = recentActivitiesAll;
  const jobHistory = await getJobHistory();
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
        (lead as unknown as { serviceNeed?: { suggestedPitch?: string } }).serviceNeed = {
          suggestedPitch: top.suggestedPitch,
        };
      }
      const strategy = generateSalesStrategy(lead, needsByLead[i]);
      lead.salesStrategy = strategy;
      console.log(
        `[sales-strategy] lead="${lead.companyName}" close=${strategy.closeProbability} ` +
        `primary="${strategy.primaryAngle?.label ?? "n/a"}"`,
      );
      strategy.angles.forEach((a) => {
        console.log(
          `[sales-angle] lead="${lead.companyName}" rank=${a.rank} ` +
          `issue="${a.label}" service="${a.serviceId ?? "n/a"}"`,
        );
      });
      console.log(
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
      // Per-lead diagnostic log line.
      console.log(
        `[diagnostics] lead=${lead.companyName ?? lead.id} ` +
        `findings=${diag?.findings.length ?? 0} ` +
        `top=${diag?.topFinding?.type ?? "none"}`,
      );
      const strategy = lead.salesStrategy;
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
          companyName: lead.companyName,
          location: lead.location,
          phone: lead.phone,
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
      const card: ServiceBucketCard = {
        serviceId: sid,
        label: top?.serviceLabel ?? sid,
        tier: tierMap[sid] ?? "secondary",
        count: agg?.count ?? 0,
        topLeadName: top?.companyName ?? null,
        topReason: agg?.topReason ?? null,
        leadKeys: list.map((e) => e.leadKey),
      };
      cards.push(card);
      console.log(
        `[service-bucket] trade=${group.mid} service=${sid} count=${card.count} ` +
        `topLead="${card.topLeadName ?? ""}"`,
      );
    }
    console.log(
      `[service-ui] trade=${group.mid} services=${cards.length}`,
    );

    serviceBucketsByTrade[group.mid] = { cards, leadsByService };
  }

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

  return (
    <OperatorConsole
      user={{ name: user.name ?? user.id, id: user.id }}
      workspace={workspace}
      sourceReadiness={sourceReadiness}
      connectedEnvVars={connectedEnvVars}
      hunterAvailable={hunterAvailable}
      overflowQueueCount={teamSchedule.overflowEntries.length}
      serviceBucketsByTrade={serviceBucketsByTrade}
      teamWorkload={teamWorkload}
      callTheseFirst={callTheseFirst}
      todayList={todayList}
      remaining={remaining}
      rest={rest}
      pendingReviews={pendingReviews}
      totalPipeline={uiLeads.length}
      pipelineMap={pipelineMap}
      roi={roi}
      calendarEvents={calendarEvents}
      recentActivities={recentActivities.slice(0, 30)}
      lastPipelineJob={lastJob ? { completedAt: lastJob.completedAt, errors: lastJob.errors.length, enriched: lastJob.steps.enrich?.succeeded ?? 0 } : null}
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
  accountSnapshot?: { status: string };
};

function toUiLead(lead: NormalizedLead & { decision: LeadDecision }, idx: number): UiLead {
  return {
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
    // Tag the lead with its trade so OperatorConsole's filter
    // (filterLeadsForTrade) routes it to the correct module.
    trade: lead.moduleId,
    accountSnapshot: { status: lead.crm.status ?? "NEW" },
  };
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
};
