// Meridian — Schedule override persistence.
//
// File-backed override layer that sits ON TOP of the deterministic
// schedule produced by buildGlobalLeadSchedule + buildRollingTeamSchedule.
// Lets a rep move a lead to today / tomorrow / next week, mark
// follow-up, skip, or assign a rep — without touching the underlying
// scoring or schedule code.
//
// Persistence is JSON file at data/scheduling/overrides.json. On
// Vercel the deploy filesystem is read-only, so writes fall through
// to /tmp (best-effort, lost on cold start). For real production
// durability swap the storage adapter for KV/Postgres — the public
// surface stays stable.
//
// Override semantics: latest action wins per (workspaceSlug, leadId).
// Clearing an override means the lead falls back to its scored bucket.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export type ScheduleOverrideAction =
  | "move_today"
  | "move_tomorrow"
  | "move_next_week"
  | "move_to_date"
  | "follow_up"
  | "skip"
  | "assign_rep"
  | "clear";

export interface ScheduleOverride {
  leadId: string;
  workspaceSlug: string;
  action: ScheduleOverrideAction;
  /** ISO date YYYY-MM-DD when applicable (move_today/tomorrow/next_week). */
  scheduledFor: string | null;
  /** Rep id when set via assign_rep. */
  repId: string | null;
  /** Operator who set the override. */
  updatedBy: string;
  /** ISO timestamp. */
  updatedAt: string;
}

interface OverrideFile {
  version: 1;
  byWorkspace: Record<string, Record<string, ScheduleOverride>>;
}

const FILE_VERSION = 1;

function repoFilePath(): string {
  return path.join(process.cwd(), "data", "scheduling", "overrides.json");
}

function tmpFilePath(): string {
  return process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-overrides.json")
    : "/tmp/meridian-overrides.json";
}

/** Read overrides. Tries the repo file first (deploy-bundled), falls
 *  back to /tmp (warm-container ephemeral). Never throws. */
async function readFile(): Promise<OverrideFile> {
  for (const filePath of [repoFilePath(), tmpFilePath()]) {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === FILE_VERSION && parsed.byWorkspace) {
        return parsed as OverrideFile;
      }
    } catch {
      /* try next */
    }
  }
  return { version: FILE_VERSION, byWorkspace: {} };
}

/** Best-effort write. Tries repo path first; on EROFS / EACCES falls
 *  back to /tmp. Returns true if any write succeeded. */
async function writeFile(file: OverrideFile): Promise<boolean> {
  const candidates = [repoFilePath(), tmpFilePath()];
  for (const filePath of candidates) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(file, null, 2), "utf8");
      return true;
    } catch {
      /* try next candidate */
    }
  }
  return false;
}

export async function listOverrides(workspaceSlug: string): Promise<ScheduleOverride[]> {
  const file = await readFile();
  const map = file.byWorkspace[workspaceSlug] ?? {};
  return Object.values(map);
}

export async function getOverride(
  workspaceSlug: string,
  leadId: string,
): Promise<ScheduleOverride | null> {
  const file = await readFile();
  return file.byWorkspace[workspaceSlug]?.[leadId] ?? null;
}

export async function setOverride(override: ScheduleOverride): Promise<boolean> {
  const file = await readFile();
  if (!file.byWorkspace[override.workspaceSlug]) {
    file.byWorkspace[override.workspaceSlug] = {};
  }
  if (override.action === "clear") {
    delete file.byWorkspace[override.workspaceSlug][override.leadId];
  } else {
    file.byWorkspace[override.workspaceSlug][override.leadId] = override;
  }
  return writeFile(file);
}

/** Date helpers — produce ISO YYYY-MM-DD strings in the server's local
 *  zone. Schedule semantics are workday-aware (next-week jumps to next
 *  Monday, weekends roll forward). */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function tomorrowIso(now: Date = new Date()): string {
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  // Skip Saturday/Sunday — push to Monday so a Friday "move to tomorrow"
  // lands on the next working day, matching scheduler semantics.
  const dow = t.getDay();
  if (dow === 6) t.setDate(t.getDate() + 2);
  if (dow === 0) t.setDate(t.getDate() + 1);
  return todayIso(t);
}

export function nextMondayIso(now: Date = new Date()): string {
  const t = new Date(now);
  const dow = t.getDay(); // 0 Sun .. 6 Sat
  const daysUntilMonday = dow === 0 ? 1 : 8 - dow;
  t.setDate(t.getDate() + daysUntilMonday);
  return todayIso(t);
}

/** Validate a YYYY-MM-DD date string. Returns the trimmed value if
 *  it's a real date and falls on a weekday (Mon–Fri); else null.
 *  Past dates are rejected because operators should not be able to
 *  schedule leads into a slot that's already gone — confusing for
 *  the team operating-board. */
export function validateWeekdayIso(value: unknown, now: Date = new Date()): string | null {
  if (typeof value !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const dow = parsed.getDay();
  if (dow === 0 || dow === 6) return null; // weekend
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (parsed.getTime() < today.getTime()) return null; // past
  return value;
}

/** Compute the next occurrence of a given weekday (1 Mon … 5 Fri).
 *  Used by the SchedulingMenu's weekday quick picks. If today is
 *  the requested weekday, returns next week's same weekday — moving
 *  to "today" should use action=move_today, not this helper. */
export function nextWeekdayIso(targetDow: number, now: Date = new Date()): string {
  const t = new Date(now);
  const currentDow = t.getDay();
  let delta = targetDow - currentDow;
  if (delta <= 0) delta += 7;
  t.setDate(t.getDate() + delta);
  return todayIso(t);
}
