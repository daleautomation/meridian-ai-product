// Meridian — Server-side usage-event log.
//
// Lightweight append-only JSONL persistence for John's field-test
// session. Writes to data/usage-events.jsonl at the project root.
// Local dev is the runtime: the ngrok tunnel hits localhost, so the
// dev server's filesystem IS the persistence — Dylan can `cat` the
// file post-session to review.
//
// Production-safe: if filesystem write fails, the API route returns
// 200 and silently drops the event so UI never blocks. KV/DB swap
// in the future is a one-line change to writeEvent().

import * as fs from "node:fs/promises";
import * as path from "node:path";

export const EVENT_LOG_PATH =
  process.env.MERIDIAN_EVENT_LOG_PATH
  ?? path.resolve(process.cwd(), "data", "usage-events.jsonl");

export interface UsageEvent {
  eventType: string;
  userId: string | null;
  workspace: string | null;
  leadId: string | null;
  taskId: string | null;
  companyName: string | null;
  tradeId: string | null;
  serviceBucketId: string | null;
  timestamp: string;          // ISO
  metadata: Record<string, unknown>;
}

export function makeEvent(input: Partial<UsageEvent> & { eventType: string }): UsageEvent {
  return {
    eventType: input.eventType,
    userId: input.userId ?? null,
    workspace: input.workspace ?? null,
    leadId: input.leadId ?? null,
    taskId: input.taskId ?? null,
    companyName: input.companyName ?? null,
    tradeId: input.tradeId ?? null,
    serviceBucketId: input.serviceBucketId ?? null,
    timestamp: input.timestamp ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  };
}

async function ensureLogDir(): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(EVENT_LOG_PATH), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function writeEvent(event: UsageEvent): Promise<{ ok: boolean; reason?: string }> {
  const ok = await ensureLogDir();
  if (!ok) return { ok: false, reason: "mkdir_failed" };
  try {
    await fs.appendFile(EVENT_LOG_PATH, JSON.stringify(event) + "\n", "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "append_failed" };
  }
}

/** Read recent events for inspection. Skips malformed lines. */
export async function readRecentEvents(limit = 200): Promise<UsageEvent[]> {
  try {
    const raw = await fs.readFile(EVENT_LOG_PATH, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const tail = lines.slice(-limit);
    const out: UsageEvent[] = [];
    for (const line of tail) {
      try { out.push(JSON.parse(line) as UsageEvent); } catch { /* skip */ }
    }
    return out;
  } catch {
    return [];
  }
}
