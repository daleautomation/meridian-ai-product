// Meridian — server-only loader for a previously-generated weekly
// state snapshot. The /personal page calls this; if no snapshot file
// exists for the customer × current ISO week, the workspace renders
// without the briefing panel (live computation continues as before).
//
// Snapshots are written by `scripts/generate-weekly-state.ts` to
// `data/weekly-state/<slug>/<weekId>.json`. The file is the source of
// truth — we do not recompute the snapshot at page-load time.

import { promises as fs } from "node:fs";
import path from "node:path";

import { isoWeekId, type WeeklyState } from "./weeklyState";

function snapshotPathFor(slug: string, weekId: string): string {
  const root = process.env.MERIDIAN_WEEKLY_STATE_DIR
    ? path.resolve(process.env.MERIDIAN_WEEKLY_STATE_DIR)
    : path.join(process.cwd(), "data", "weekly-state");
  return path.join(root, slug, `${weekId}.json`);
}

/**
 * Load the snapshot for the current ISO week, or `null` if absent /
 * unreadable / malformed. Never throws — the workspace must continue
 * rendering even when the snapshot is missing.
 */
export async function loadWeeklyStateFromDisk(
  workspaceSlug: string,
  now: Date = new Date(),
): Promise<WeeklyState | null> {
  const weekId = isoWeekId(now);
  const file = snapshotPathFor(workspaceSlug, weekId);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as WeeklyState;
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      parsed.workspaceSlug !== workspaceSlug ||
      parsed.weekId !== weekId
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
