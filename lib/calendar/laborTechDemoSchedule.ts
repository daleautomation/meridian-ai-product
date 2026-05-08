// Meridian — LaborTech demo rollout schedule.
//
// Presentational rollout scheduler for the May-7 demo. Reorders the
// existing call tasks (category === "priority", title starts with
// "Call ") into a deterministic Day-1 → Day-N sequence anchored to
// Thursday May 7, 2026, and re-stamps each task's `dueDate` to a
// fixed time slot (9 AM – 11 AM and 1 PM – 3 PM, weekdays only).
//
// Pure / deterministic. No new lead data. Reads only fields already
// stamped on TaskItem during buildTasksFromLeads, plus the loosely
// typed laborTechScan attached to the task. Tiebreakers fall through
// to linkedCompany alphabetically so reloads always show the same
// order.
//
// To remove for production:
//   1. set LABORTECH_DEMO_ROLLOUT_ENABLED to false (or delete this file
//      and revert the call site in tasks.ts buildTasksFromLeads), OR
//   2. delete the import + applyLaborTechDemoSchedule call inside
//      buildTasksFromLeads.

import type { TaskItem, TaskPriority } from "./tasks";
import { serviceFitConfidenceScore } from "../scan/serviceFit";
import { getBusinessTodayWeekdayIso } from "../dates/businessDate";
// Recurring-ingestion architecture: the demo schedule is now also
// expressible as an IngestionBatch. Existing scheduler logic is
// untouched; the import is exported below so a future cron-driven
// ingestion run can call buildBatchSlotIso(nextWeekBatch, idx)
// instead of buildDemoSlotIso(idx) without changing the operator
// surface.
export { LABORTECH_DEMO_BATCH, buildBatchSlotIso, projectIngestionWindow, buildNextWeekBatch, namespacedTaskId, stripBatchNamespace } from "./ingestionBatch";

export const LABORTECH_DEMO_ROLLOUT_ENABLED = true;

// Day 1 anchor — the operator's business today (rolled forward to
// Monday if today is Sat/Sun). Resolved fresh on every call so a
// long-running server / a Vercel container that warmed up yesterday
// never anchors the calendar to a stale day.
//
// Use `getLaborTechDemoDayOne()` from internal code. The
// `LABORTECH_DEMO_DAY_ONE` export remains for backward compatibility
// — its value is captured at module-init time and may be stale on
// long-lived processes; treat it as a launch-day reference, not a
// runtime "today."
export function getLaborTechDemoDayOne(): { year: number; month: number; day: number } {
  const iso = getBusinessTodayWeekdayIso();
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m, day: d };
}
export const LABORTECH_DEMO_DAY_ONE = getLaborTechDemoDayOne();

// Slots per day. The master daily execution plan caps at 20 calls
// per business day — 10 in the morning (15-min cadence 9:00 → 11:15)
// and 10 in the afternoon (15-min cadence 13:00 → 15:15). Weekdays
// only; weekend days are skipped entirely.
//
// Per the All-Trades master-plan spec: this is the unified call
// capacity for the whole sales motion (across Roofing, HVAC,
// Carpentry, Painting, Plumbing, Electrical). Trade tabs filter
// this same schedule — they do NOT each schedule their own day.
const DEMO_TIME_SLOTS: Array<{ hour: number; minute: number }> = [
  { hour: 9,  minute: 0 },
  { hour: 9,  minute: 15 },
  { hour: 9,  minute: 30 },
  { hour: 9,  minute: 45 },
  { hour: 10, minute: 0 },
  { hour: 10, minute: 15 },
  { hour: 10, minute: 30 },
  { hour: 10, minute: 45 },
  { hour: 11, minute: 0 },
  { hour: 11, minute: 15 },
  { hour: 13, minute: 0 },
  { hour: 13, minute: 15 },
  { hour: 13, minute: 30 },
  { hour: 13, minute: 45 },
  { hour: 14, minute: 0 },
  { hour: 14, minute: 15 },
  { hour: 14, minute: 30 },
  { hour: 14, minute: 45 },
  { hour: 15, minute: 0 },
  { hour: 15, minute: 15 },
];

// Master cap. Day 1 fills with the strongest 20 across ALL trades;
// Day 2 takes the next 20; and so on through the working week.
// Weekends are skipped via buildDemoSlotIso's day-walk.
export const MAX_TOTAL_CALLS_PER_DAY = DEMO_TIME_SLOTS.length;
const SLOTS_PER_DAY = DEMO_TIME_SLOTS.length;

// ── Ranking helpers (read-only from existing fields) ──────────────────

const PRIORITY_RANK: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PAIN_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const TIER_RANK: Record<string, number> = {
  CLOSE_NOW: 0,
  STRONG: 1,
  TEST: 2,
};

function tierScore(t: TaskItem): number {
  const tier = t.leadTier;
  if (typeof tier !== "string") return 99;
  return TIER_RANK[tier] ?? 99;
}

function closeabilityScore(t: TaskItem): number {
  // Higher is better. We sort ascending, so invert via negative.
  const s = t.laborTechScan?.closeability?.score;
  if (typeof s === "number" && Number.isFinite(s)) return -s;
  return 0;
}

function priorityScore(t: TaskItem): number {
  return PRIORITY_RANK[t.priority] ?? 99;
}

function painScore(t: TaskItem): number {
  const lvl = t.laborTechScan?.painLevel;
  if (typeof lvl !== "string") return 99;
  return PAIN_RANK[lvl.toLowerCase()] ?? 99;
}

function contactScore(t: TaskItem): number {
  // Lower is better (sorted ascending).
  let pts = 0;
  if (t.phone) pts -= 2;
  if (t.email || t.verifiedEmail) pts -= 1;
  if (t.laborTechScan?.salesAngle?.opener) pts -= 1;
  return pts;
}

function serviceFitRank(t: TaskItem): number {
  // Higher confidence is better. We sort ascending, so invert.
  // Service-fit bumps a lead with a clear primary LaborTech offer
  // ahead of a lead whose fit is diffuse across low-scoring services.
  return -serviceFitConfidenceScore(t);
}

function alphaTiebreak(t: TaskItem): string {
  return (t.linkedCompany ?? t.title ?? t.id ?? "").toLowerCase();
}

/**
 * Deterministic comparator:
 *   1. CLOSE_NOW / STRONG / TEST tier
 *   2. closeability score (higher first)
 *   3. service-fit confidence (clear primary LaborTech offer first)
 *   4. priority tier (critical → low)
 *   5. pain level (critical → low)
 *   6. contact richness (phone + email > phone > nothing)
 *   7. alpha tiebreak on linkedCompany — guarantees stable order
 */
function compareCallTasks(a: TaskItem, b: TaskItem): number {
  return (
    tierScore(a) - tierScore(b)
    || closeabilityScore(a) - closeabilityScore(b)
    || serviceFitRank(a) - serviceFitRank(b)
    || priorityScore(a) - priorityScore(b)
    || painScore(a) - painScore(b)
    || contactScore(a) - contactScore(b)
    || alphaTiebreak(a).localeCompare(alphaTiebreak(b))
  );
}

// ── Day walk (weekdays only, anchored to May 7) ───────────────────────

function buildDemoSlotIso(slotIndex: number): string {
  // Walk forward from Day-1, skipping Saturday (6) and Sunday (0),
  // returning a local-time ISO timestamp at the corresponding slot.
  // Day 1 resolved fresh per call — never anchored to module init.
  const dayOne = getLaborTechDemoDayOne();
  const dayOfWeek = (i: number) => {
    const d = new Date(
      dayOne.year,
      dayOne.month - 1,
      dayOne.day,
    );
    let added = 0;
    let dayOffset = 0;
    while (added < i) {
      dayOffset++;
      const probe = new Date(d);
      probe.setDate(d.getDate() + dayOffset);
      const dow = probe.getDay();
      if (dow === 0 || dow === 6) continue; // skip Sat/Sun
      added++;
    }
    const final = new Date(d);
    final.setDate(d.getDate() + dayOffset);
    final.setHours(0, 0, 0, 0);
    return final;
  };

  const dayIndex = Math.floor(slotIndex / SLOTS_PER_DAY);
  const within = slotIndex % SLOTS_PER_DAY;
  const date = dayOfWeek(dayIndex);
  const slot = DEMO_TIME_SLOTS[within];
  date.setHours(slot.hour, slot.minute, 0, 0);
  return date.toISOString();
}

// ── Public API ────────────────────────────────────────────────────────

function isCallTask(t: TaskItem): boolean {
  if (t.category !== "priority") return false;
  const id = t.id ?? "";
  if (id.endsWith("-call")) return true;
  const title = t.title ?? "";
  return title.startsWith("Call ");
}

/**
 * Apply the LaborTech demo rollout schedule to the given task list.
 * Mutation strategy: returns a NEW array with a NEW dueDate stamped on
 * the call tasks; non-call tasks pass through untouched. The input
 * array is not modified.
 *
 * No-op when the demo flag is disabled.
 */
export function applyLaborTechDemoSchedule(tasks: TaskItem[]): TaskItem[] {
  if (!LABORTECH_DEMO_ROLLOUT_ENABLED) return tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) return tasks;

  const calls: TaskItem[] = [];
  const others: TaskItem[] = [];
  for (const t of tasks) {
    if (isCallTask(t)) calls.push(t);
    else others.push(t);
  }
  if (calls.length === 0) return tasks;

  // Deterministic priority order — stable across reloads.
  calls.sort(compareCallTasks);

  // Day-1 quality gate — leads with closeability < 60 are pushed off
  // Day 1 so the first column always reads as "highest probability."
  // Strong leads fill Day 1; weaker leads slide to Day 2+. Aligned
  // with the v2 score spread (Medium starts at 50, High at 80) so
  // Day 1 is solidly Medium-and-above.
  const STRONG_THRESHOLD = 60;
  const isStrong = (t: TaskItem): boolean => {
    const s = t.laborTechScan?.closeability?.score;
    return typeof s === "number" && s >= STRONG_THRESHOLD;
  };
  const strong: TaskItem[] = [];
  const weak: TaskItem[] = [];
  for (const t of calls) {
    if (isStrong(t)) strong.push(t);
    else weak.push(t);
  }
  // Strong leads first so they land on Day 1, then weak leads after.
  const ordered = [...strong, ...weak];

  // Top-tier display boost — pulls the top 5 leads into the 80–95
  // band so they visually separate from the rest. Applied AFTER
  // sort/slot assignment so ordering is unchanged; only the
  // displayed closeability score moves. Clamped at 95 so we never
  // emit 100%.
  const TOP_TIER_BOOSTS = [15, 12, 10, 8, 6];
  const boosted = ordered.map((t, idx) => {
    const bump = TOP_TIER_BOOSTS[idx];
    if (typeof bump !== "number") return t;
    const close = t.laborTechScan?.closeability;
    if (!close || typeof close.score !== "number") return t;
    const newScore = Math.min(95, Math.round(close.score + bump));
    if (newScore === close.score) return t;
    return {
      ...t,
      laborTechScan: {
        ...t.laborTechScan,
        closeability: {
          ...close,
          score: newScore,
        },
      },
    };
  });

  const rescheduled = boosted.map((t, idx) => ({
    ...t,
    dueDate: buildDemoSlotIso(idx),
  }));

  // ── Stage 1 diagnostic: applyLaborTechDemoSchedule ─────────────
  // Counts call tasks IN, by-day distribution OUT, sample slot ISOs.
  // Helps trace whether the disappearing-leads bug is upstream
  // (lead pool too small) or downstream (filter / grouping).
  if (typeof console !== "undefined") {
    try {
      const byDay = new Map<string, number>();
      const sampleTaskIds: Array<{ id: string; dueDate: string }> = [];
      for (const t of rescheduled) {
        if (!t.dueDate) continue;
        const d = new Date(t.dueDate);
        if (Number.isNaN(d.getTime())) continue;
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        byDay.set(k, (byDay.get(k) ?? 0) + 1);
        if (sampleTaskIds.length < 5) sampleTaskIds.push({ id: t.id ?? "", dueDate: t.dueDate });
      }
      // eslint-disable-next-line no-console
      console.log(
        `[stage1-scheduler] callsIn=${calls.length} ` +
        `strong=${strong.length} weak=${weak.length} ` +
        `boosted=${boosted.length} rescheduled=${rescheduled.length} ` +
        `byDay=${JSON.stringify(Object.fromEntries(Array.from(byDay.entries()).sort()))} ` +
        `sample=${JSON.stringify(sampleTaskIds)} ` +
        `slot0=${rescheduled[0]?.dueDate ?? "—"} ` +
        `slot19=${rescheduled[19]?.dueDate ?? "—"} ` +
        `slot20=${rescheduled[20]?.dueDate ?? "—"} ` +
        `slot40=${rescheduled[40]?.dueDate ?? "—"} ` +
        `slot60=${rescheduled[60]?.dueDate ?? "—"} ` +
        `slot80=${rescheduled[80]?.dueDate ?? "—"} ` +
        `slot100=${rescheduled[100]?.dueDate ?? "—"} ` +
        `slot119=${rescheduled[119]?.dueDate ?? "—"}`,
      );
    } catch { /* ignore */ }
  }

  // ── Field-test debug log ────────────────────────────────────────
  // One concise summary per build: leads/day, weekend skip count
  // (always 0 — buildDemoSlotIso is the only date assignor), first
  // and last lead per day, overflow count beyond Day 5 (Thursday
  // May 14, 2026). Pure read-only — no mutation.
  if (typeof console !== "undefined") {
    try {
      const FIELD_TEST_DAYS = 6; // May 7, 8, 11, 12, 13, 14 (Thu→Thu)
      const TOTAL_FIELD_SLOTS = MAX_TOTAL_CALLS_PER_DAY * FIELD_TEST_DAYS;
      const inWindow = rescheduled.slice(0, TOTAL_FIELD_SLOTS);
      const overflow = rescheduled.length - inWindow.length;
      const byDay = new Map<string, TaskItem[]>();
      for (const t of inWindow) {
        if (!t.dueDate) continue;
        const d = new Date(t.dueDate);
        if (Number.isNaN(d.getTime())) continue;
        const dayKey = d.toISOString().slice(0, 10);
        const arr = byDay.get(dayKey) ?? [];
        arr.push(t);
        byDay.set(dayKey, arr);
      }
      let weekendCount = 0;
      const summary: Array<{ day: string; count: number; first: string; last: string }> = [];
      for (const [dayKey, list] of Array.from(byDay.entries()).sort()) {
        const d = new Date(dayKey + "T12:00:00");
        const dow = d.getDay();
        if (dow === 0 || dow === 6) weekendCount += list.length;
        const first = list[0]?.linkedCompany ?? list[0]?.title ?? "(unknown)";
        const last  = list[list.length - 1]?.linkedCompany ?? list[list.length - 1]?.title ?? "(unknown)";
        summary.push({ day: dayKey, count: list.length, first, last });
      }
      // eslint-disable-next-line no-console
      console.log(
        `[field-test-schedule] window=Thu-May-7 → Thu-May-14 ` +
        `slots/day=${MAX_TOTAL_CALLS_PER_DAY} ` +
        `total-calls=${rescheduled.length} ` +
        `in-window=${inWindow.length} ` +
        `overflow-beyond-window=${overflow} ` +
        `weekend-leads=${weekendCount} ` +
        `days=${JSON.stringify(summary)}`,
      );
    } catch { /* logging failure is non-fatal */ }
  }

  // Day-1 floor — applied to non-call tasks whose dueDate would
  // otherwise land before the rollout start. Keeps the calendar
  // honest: nothing visible from before today's anchor day. Day 1
  // resolved fresh so the floor tracks "today" each render.
  const dayOneFloor = (() => {
    const dayOne = getLaborTechDemoDayOne();
    const d = new Date(dayOne.year, dayOne.month - 1, dayOne.day);
    d.setHours(9, 0, 0, 0);
    return d;
  })();
  const dayOneFloorMs = dayOneFloor.getTime();

  function flooredNonCall(t: TaskItem): TaskItem {
    if (!t.dueDate) return t;
    const ms = new Date(t.dueDate).getTime();
    if (!Number.isFinite(ms) || ms >= dayOneFloorMs) return t;
    return { ...t, dueDate: dayOneFloor.toISOString() };
  }

  // Preserve the original array's relative position of non-call tasks
  // by walking the input once and substituting from the rescheduled
  // call list in order. Non-call tasks pass through untouched unless
  // their dueDate falls before the rollout floor.
  const callQueue = rescheduled.slice();
  const out: TaskItem[] = new Array(tasks.length);
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (isCallTask(t)) {
      const next = callQueue.shift();
      out[i] = next ?? t;
    } else {
      out[i] = flooredNonCall(t);
    }
  }
  return out;
}
