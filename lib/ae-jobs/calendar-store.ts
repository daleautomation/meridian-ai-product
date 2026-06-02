import path from "node:path";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import { buildDemoCalendarBatch } from "./calendar";
import type { CareerCalendarEvent } from "./calendar";
import type { CalendarSyncResult } from "./calendar";

const DATA_PATH = path.join(process.cwd(), "data", "ae-jobs", "calendar-events.json");
const DEFAULT_OWNER = "dylan";

export interface CalendarStoreFile {
  version: 1;
  ownerId: string;
  events: CareerCalendarEvent[];
  lastSyncedAt: string | null;
  seenEventIds?: string[];
  lastSyncResult?: CalendarSyncResult | null;
}

function normalizeCalendarStore(
  file: CalendarStoreFile | null,
  ownerId: string,
): CalendarStoreFile {
  if (file?.version === 1 && Array.isArray(file.events)) {
    return {
      ...file,
      ownerId: file.ownerId || ownerId,
      events: file.events,
      seenEventIds: file.seenEventIds ?? [],
    };
  }
  return {
    version: 1,
    ownerId,
    events: [],
    lastSyncedAt: null,
    seenEventIds: [],
    lastSyncResult: null,
  };
}

export async function loadCalendarStore(ownerId = DEFAULT_OWNER): Promise<CalendarStoreFile> {
  const file = await safeReadJson<CalendarStoreFile>(DATA_PATH);
  return normalizeCalendarStore(file, ownerId);
}

export async function saveCalendarStore(store: CalendarStoreFile): Promise<boolean> {
  return safeWriteJson(DATA_PATH, store);
}

/** Seed demo events when store is empty (local validation). */
export async function ensureDemoCalendarIfEmpty(ownerId = DEFAULT_OWNER): Promise<CalendarStoreFile> {
  const store = await loadCalendarStore(ownerId);
  if (store.events.length > 0) return store;

  const batch = buildDemoCalendarBatch();
  const seen = new Set<string>();
  for (const event of batch.events) seen.add(event.eventId);

  const next: CalendarStoreFile = {
    ...store,
    events: batch.events,
    lastSyncedAt: batch.syncedAt,
    seenEventIds: [...seen],
    lastSyncResult: {
      imported: batch.events.length,
      skipped: 0,
      opportunitiesUpdated: 0,
      errors: [],
    },
  };
  await saveCalendarStore(next);
  return next;
}
