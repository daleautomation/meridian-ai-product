import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { UsageEvent } from "./eventLog";

export const EVENT_LOG_PATH =
  process.env.MERIDIAN_EVENT_LOG_PATH
  ?? path.resolve(process.cwd(), "data", "usage-events.jsonl");

async function ensureLogDir(): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(EVENT_LOG_PATH), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function writeEventToFile(event: UsageEvent): Promise<{ ok: boolean; reason?: string }> {
  const ok = await ensureLogDir();
  if (!ok) return { ok: false, reason: "mkdir_failed" };
  try {
    await fs.appendFile(EVENT_LOG_PATH, JSON.stringify(event) + "\n", "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "append_failed" };
  }
}

export async function readRecentEventsFromFile(limit = 200): Promise<UsageEvent[]> {
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
