// Meridian — Recurring Ingestion + Schedule Projection foundation.
//
// Generic, anchor-agnostic scheduling primitives. The current
// LaborTech demo is just the FIRST batch; a future Friday 11:59 PM
// ingestion cycle plugs in by emitting a new IngestionBatch with the
// next Monday as `anchorDate`. The scheduler reuses the same slot
// math, the same ranking, and the same overflow continuation.
//
// CRITICAL: this file is ARCHITECTURE only — no production cron, no
// new UI, no new engines. It abstracts the date math + batch shape
// so recurring ingestion becomes a natural extension later.

import type { TaskItem } from "./tasks";

// ── Public types ────────────────────────────────────────────────────

export interface IngestionBatch {
  /**
   * Stable id for this batch. Used to namespace task ids so
   * re-ingestion never overwrites a prior week's execution outcomes.
   * Convention: ISO date of the anchor day, e.g. "batch-2026-05-07".
   */
  id: string;

  /** Anchor day for the batch (the first business day filled). */
  anchorDate: { year: number; month: number; day: number };

  /** How many business days this batch covers (5 for Mon-Fri). */
  daysCount: number;

  /** Calls scheduled per business day (default 20). */
  slotsPerDay: number;

  /**
   * Cadence template — array of {hour, minute} offsets in local time.
   * Defaults to the LaborTech demo's 10 morning + 10 afternoon
   * 15-minute cadence when omitted.
   */
  timeSlots?: Array<{ hour: number; minute: number }>;

  /** Free-form metadata (industry id, ingestion source, etc.). */
  meta?: Record<string, unknown>;
}

export interface ScheduleProjectionDay {
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Day-of-week 0–6 (always 1–5 for valid weekdays). */
  dayOfWeek: number;
  /** Slots in chronological order with their ISO timestamps. */
  slots: Array<{ slotIndex: number; iso: string }>;
}

export interface ScheduleProjection {
  batchId: string;
  anchorIso: string;
  endIso: string;
  daysCount: number;
  slotsPerDay: number;
  totalSlots: number;
  days: ScheduleProjectionDay[];
}

// ── Default cadence ────────────────────────────────────────────────

export const DEFAULT_TIME_SLOTS: Array<{ hour: number; minute: number }> = [
  { hour: 9,  minute: 0  }, { hour: 9,  minute: 15 }, { hour: 9,  minute: 30 }, { hour: 9,  minute: 45 },
  { hour: 10, minute: 0  }, { hour: 10, minute: 15 }, { hour: 10, minute: 30 }, { hour: 10, minute: 45 },
  { hour: 11, minute: 0  }, { hour: 11, minute: 15 },
  { hour: 13, minute: 0  }, { hour: 13, minute: 15 }, { hour: 13, minute: 30 }, { hour: 13, minute: 45 },
  { hour: 14, minute: 0  }, { hour: 14, minute: 15 }, { hour: 14, minute: 30 }, { hour: 14, minute: 45 },
  { hour: 15, minute: 0  }, { hour: 15, minute: 15 },
];

export const DEFAULT_SLOTS_PER_DAY = DEFAULT_TIME_SLOTS.length;
export const DEFAULT_DAYS_PER_BATCH = 5;

// ── Helpers ─────────────────────────────────────────────────────────

function timeSlotsFor(batch: IngestionBatch): Array<{ hour: number; minute: number }> {
  return Array.isArray(batch.timeSlots) && batch.timeSlots.length > 0
    ? batch.timeSlots
    : DEFAULT_TIME_SLOTS;
}

function isWeekend(d: Date): boolean {
  const dow = d.getDay();
  return dow === 0 || dow === 6;
}

/**
 * Walk forward from the batch's anchor day, skipping weekends, and
 * return the local-time Date for the requested slot.
 *
 * Pure / deterministic — same input always produces the same output.
 */
export function buildBatchSlotDate(batch: IngestionBatch, slotIndex: number): Date {
  const slots = timeSlotsFor(batch);
  const slotsPerDay = batch.slotsPerDay > 0 ? batch.slotsPerDay : slots.length;
  const dayIndex = Math.floor(slotIndex / slotsPerDay);
  const within = slotIndex % slotsPerDay;
  const anchor = new Date(
    batch.anchorDate.year,
    batch.anchorDate.month - 1,
    batch.anchorDate.day,
  );

  let dayOffset = 0;
  let added = 0;
  while (added < dayIndex) {
    dayOffset++;
    const probe = new Date(anchor);
    probe.setDate(anchor.getDate() + dayOffset);
    if (isWeekend(probe)) continue;
    added++;
  }
  const final = new Date(anchor);
  final.setDate(anchor.getDate() + dayOffset);
  const slot = slots[within];
  final.setHours(slot.hour, slot.minute, 0, 0);
  return final;
}

export function buildBatchSlotIso(batch: IngestionBatch, slotIndex: number): string {
  return buildBatchSlotDate(batch, slotIndex).toISOString();
}

/**
 * Project the full schedule window for a batch — useful for UI
 * consumers (calendar headers, debug logs, ingestion previews) and
 * for the smoke test that verifies day counts + weekday-only.
 */
export function projectIngestionWindow(batch: IngestionBatch): ScheduleProjection {
  const slotsPerDay = batch.slotsPerDay > 0 ? batch.slotsPerDay : DEFAULT_SLOTS_PER_DAY;
  const daysCount = batch.daysCount > 0 ? batch.daysCount : DEFAULT_DAYS_PER_BATCH;
  const totalSlots = slotsPerDay * daysCount;

  const grouped = new Map<string, Array<{ slotIndex: number; iso: string }>>();
  for (let i = 0; i < totalSlots; i++) {
    const d = buildBatchSlotDate(batch, i);
    const isoDay = d.toISOString().slice(0, 10);
    const arr = grouped.get(isoDay) ?? [];
    arr.push({ slotIndex: i, iso: d.toISOString() });
    grouped.set(isoDay, arr);
  }
  const days: ScheduleProjectionDay[] = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      dayOfWeek: new Date(date + "T12:00:00").getDay(),
      slots,
    }));
  const anchorIso = days[0]?.slots[0]?.iso ?? "";
  const endIso = days[days.length - 1]?.slots[days[days.length - 1].slots.length - 1]?.iso ?? "";
  return {
    batchId: batch.id,
    anchorIso,
    endIso,
    daysCount,
    slotsPerDay,
    totalSlots,
    days,
  };
}

// ── Task-id namespacing ─────────────────────────────────────────────

/**
 * Optionally namespace a task id to a batch so re-ingestion of the
 * same underlying lead never overwrites the prior week's
 * `executionOutcome` map (which is keyed by task id). Backward-
 * compat: when a caller doesn't pass a batch id, the original task
 * id is returned untouched — historical tasks keep working.
 */
export function namespacedTaskId(originalTaskId: string, batchId: string | null | undefined): string {
  if (!batchId || typeof batchId !== "string" || batchId.length === 0) return originalTaskId;
  // Already namespaced — don't double-prefix.
  if (originalTaskId.startsWith(`${batchId}::`)) return originalTaskId;
  return `${batchId}::${originalTaskId}`;
}

/** Inverse of `namespacedTaskId` — strips a batch prefix if present. */
export function stripBatchNamespace(taskId: string): { batchId: string | null; baseId: string } {
  const idx = taskId.indexOf("::");
  if (idx <= 0) return { batchId: null, baseId: taskId };
  return { batchId: taskId.slice(0, idx), baseId: taskId.slice(idx + 2) };
}

// ── Convenience builders ────────────────────────────────────────────

/**
 * Build the next-week ingestion batch. Future cron entry point.
 * Given a "now" Date, returns the IngestionBatch for the upcoming
 * Mon–Fri window. If `now` is already a weekday, the batch anchors
 * on the NEXT Monday so the current week's plan stays stable.
 */
export function buildNextWeekBatch(now: Date = new Date(), opts: Partial<IngestionBatch> = {}): IngestionBatch {
  const d = new Date(now);
  // Walk forward to the next Monday.
  const dow = d.getDay();
  const daysToMonday = dow === 0 ? 1 : (8 - dow); // Sun → 1, Mon → 7, …, Sat → 2
  d.setDate(d.getDate() + daysToMonday);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const id = opts.id ?? `batch-${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    id,
    anchorDate: { year, month, day },
    daysCount: opts.daysCount ?? DEFAULT_DAYS_PER_BATCH,
    slotsPerDay: opts.slotsPerDay ?? DEFAULT_SLOTS_PER_DAY,
    timeSlots: opts.timeSlots ?? DEFAULT_TIME_SLOTS,
    meta: opts.meta ?? {},
  };
}

/**
 * The current LaborTech demo / field-test batch. Lifted into the
 * IngestionBatch shape so the existing scheduler can be expressed
 * as `scheduleTasksForBatch(tasks, LABORTECH_DEMO_BATCH)` later
 * without changing any callers today.
 */
export const LABORTECH_DEMO_BATCH: IngestionBatch = {
  id: "batch-2026-05-07",
  anchorDate: { year: 2026, month: 5, day: 7 },
  daysCount: 6, // Thu, Fri, Mon, Tue, Wed, Thu (the field test window)
  slotsPerDay: DEFAULT_SLOTS_PER_DAY,
  timeSlots: DEFAULT_TIME_SLOTS,
  meta: { industry: "labortech", source: "demo" },
};

/**
 * Bulk slot-stamp helper — given a batch and an ALREADY-RANKED list
 * of call tasks, return the same array with `dueDate` re-stamped per
 * slot. Pure projection over the existing list — never re-ranks,
 * never mutates the input. Overflow tasks beyond the batch window
 * still receive ISO timestamps (slot indices continue past day N).
 *
 * The existing `applyLaborTechDemoSchedule` function in
 * laborTechDemoSchedule.ts can be expressed as this helper plus the
 * existing rank/boost/walk pipeline. Today it produces byte-identical
 * output — flagged for a future cleanup.
 */
export function stampBatchSlots<T extends Pick<TaskItem, "id" | "dueDate">>(
  rankedTasks: T[],
  batch: IngestionBatch,
): T[] {
  return rankedTasks.map((t, idx) => ({
    ...t,
    dueDate: buildBatchSlotIso(batch, idx),
  }));
}
