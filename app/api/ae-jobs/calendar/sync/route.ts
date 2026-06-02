import { NextRequest, NextResponse } from "next/server";
import { applyCalendarSync } from "@/lib/ae-jobs/calendar-sync";
import type { CalendarSyncBatch } from "@/lib/ae-jobs/calendar";
import { loadCalendarStore, saveCalendarStore } from "@/lib/ae-jobs/calendar-store";
import { getSession } from "@/lib/auth";
import { loadAeJobsStore, saveAeJobsStore } from "@/lib/ae-jobs/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/ae-jobs/calendar/sync
 * Accepts CalendarSyncBatch (manual/demo; no Google Calendar API in v1).
 */
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let batch: CalendarSyncBatch;
  try {
    batch = (await req.json()) as CalendarSyncBatch;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(batch?.events)) {
    return NextResponse.json({ success: false, error: "events array required" }, { status: 400 });
  }

  const syncedAt = batch.syncedAt ?? new Date().toISOString();
  const calendarStore = await loadCalendarStore(user.id);
  const jobsStore = await loadAeJobsStore(user.id);
  const seen = new Set(calendarStore.seenEventIds ?? []);

  const { events, opportunities, result } = applyCalendarSync(
    calendarStore.events,
    jobsStore.opportunities,
    { ...batch, syncedAt },
    seen,
  );

  const nextCalendar = {
    ...calendarStore,
    events,
    lastSyncedAt: syncedAt,
    lastSyncResult: result,
    seenEventIds: [...seen],
  };
  await saveCalendarStore(nextCalendar);

  const nextJobs = {
    ...jobsStore,
    opportunities,
  };
  await saveAeJobsStore(nextJobs);

  return NextResponse.json({
    success: true,
    result,
    calendar: nextCalendar,
    opportunitiesUpdated: result.opportunitiesUpdated,
  });
}
