import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MERIDIAN_DATA_DIR, USAGE_EVENTS_LOG_PATH } from "@/lib/meridianDataPaths";
import type { UsageEvent } from "./eventLog";

/** Default deploy-bundled event log (NFT-scoped under `data/`). */
export const EVENT_LOG_PATH = USAGE_EVENTS_LOG_PATH;

function resolveEventLogPath(): string {
  const custom = process.env.MERIDIAN_EVENT_LOG_PATH?.trim();
  if (!custom) return EVENT_LOG_PATH;
  if (path.isAbsolute(custom)) return custom;
  return path.join(MERIDIAN_DATA_DIR, custom.replace(/^(\.\/|\.\.\/)+/, ""));
}

async function ensureLogDir(): Promise<boolean> {
  try {
    await fs.mkdir(MERIDIAN_DATA_DIR, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export async function writeEventToFile(event: UsageEvent): Promise<{ ok: boolean; reason?: string }> {
  const logPath = resolveEventLogPath();
  if (logPath !== EVENT_LOG_PATH) {
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
    } catch {
      return { ok: false, reason: "mkdir_failed" };
    }
  } else {
    const ok = await ensureLogDir();
    if (!ok) return { ok: false, reason: "mkdir_failed" };
  }
  try {
    await fs.appendFile(logPath, JSON.stringify(event) + "\n", "utf8");
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "append_failed" };
  }
}

export async function readRecentEventsFromFile(limit = 200): Promise<UsageEvent[]> {
  const logPath = resolveEventLogPath();
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const tail = lines.slice(-limit);
    const out: UsageEvent[] = [];
    for (const line of tail) {
      try {
        out.push(JSON.parse(line) as UsageEvent);
      } catch {
        /* skip */
      }
    }
    return out;
  } catch {
    return [];
  }
}
