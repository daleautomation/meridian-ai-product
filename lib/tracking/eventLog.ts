// Meridian — Server-side usage-event log.
//
// Public API remains stable while Phase 1 can route domain events to file,
// dual-write, or Neon via MERIDIAN_TRUTH_STORE.

import { dbReadFallbackEnabled, dualWriteStrict, getTruthStoreMode } from "@/lib/truth/types";
import {
  EVENT_LOG_PATH,
  readRecentEventsFromFile,
  writeEventToFile,
} from "./eventFileAdapter";
import {
  readRecentEventsFromNeon,
  writeEventToNeon,
} from "./eventNeonAdapter";

export { EVENT_LOG_PATH };

export interface UsageEvent {
  eventId?: string;
  eventType: string;
  userId: string | null;
  operatorId?: string | null;
  workspace: string | null;
  leadId: string | null;
  taskId: string | null;
  companyKey?: string | null;
  crmKey?: string | null;
  companyName: string | null;
  tradeId: string | null;
  serviceBucketId: string | null;
  sourceSurface?: string | null;
  previousStatus?: string | null;
  nextStatus?: string | null;
  outcomeStatus?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  estimatedValue?: number | null;
  meridianInfluenced?: boolean;
  influenceReason?: string | null;
  occurredAt?: string | null;
  recordedAt?: string | null;
  idempotencyKey?: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export function makeEvent(input: Partial<UsageEvent> & { eventType: string }): UsageEvent {
  return {
    ...(input.eventId ? { eventId: input.eventId } : {}),
    eventType: input.eventType,
    userId: input.userId ?? null,
    operatorId: input.operatorId ?? input.userId ?? null,
    workspace: input.workspace ?? null,
    leadId: input.leadId ?? null,
    taskId: input.taskId ?? null,
    companyKey: input.companyKey ?? null,
    crmKey: input.crmKey ?? null,
    companyName: input.companyName ?? null,
    tradeId: input.tradeId ?? null,
    serviceBucketId: input.serviceBucketId ?? null,
    sourceSurface: input.sourceSurface ?? null,
    previousStatus: input.previousStatus ?? null,
    nextStatus: input.nextStatus ?? null,
    outcomeStatus: input.outcomeStatus ?? null,
    nextAction: input.nextAction ?? null,
    nextActionDate: input.nextActionDate ?? null,
    estimatedValue: input.estimatedValue ?? null,
    meridianInfluenced: input.meridianInfluenced ?? false,
    influenceReason: input.influenceReason ?? null,
    occurredAt: input.occurredAt ?? null,
    recordedAt: input.recordedAt ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  };
}

export async function writeEvent(event: UsageEvent): Promise<{ ok: boolean; reason?: string }> {
  const mode = getTruthStoreMode();
  if (mode === "file") return writeEventToFile(event);

  const neonResult = await writeEventToNeon(event);
  if (neonResult.ok) {
    if (mode === "dual") {
      await writeEventToFile(event).catch((err) => {
        console.error("[eventLog] dual file event write failed", err);
      });
    }
    return neonResult;
  }

  if (mode === "dual" && !dualWriteStrict()) return writeEventToFile(event);
  return neonResult;
}

/** Read recent events for inspection. Skips malformed lines in file mode. */
export async function readRecentEvents(limit = 200): Promise<UsageEvent[]> {
  const mode = getTruthStoreMode();
  if (mode === "file") return readRecentEventsFromFile(limit);

  try {
    const neonRows = await readRecentEventsFromNeon(limit);
    if (!dbReadFallbackEnabled()) return neonRows;
    const fileRows = await readRecentEventsFromFile(limit);
    const byId = new Map<string, UsageEvent>();
    for (const event of fileRows) byId.set(event.eventId ?? `${event.timestamp}:${event.eventType}`, event);
    for (const event of neonRows) byId.set(event.eventId ?? `${event.timestamp}:${event.eventType}`, event);
    return Array.from(byId.values()).slice(-limit);
  } catch (err) {
    if (!dbReadFallbackEnabled()) throw err;
    console.error("[eventLog] Neon event read failed; falling back to file", err);
    return readRecentEventsFromFile(limit);
  }
}
