// Meridian AI — file-based alert persistence.
//
// JSON file at data/alerts.json keyed by alert id. Same atomic-write pattern
// as negotiationStore. Alerts are per-user, keyed by `userId:itemId:action`.

import { promises as fs } from "node:fs";
import path from "node:path";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type Alert = {
  id: string;                // `${userId}:${itemId}:${dominantAction}`
  userId: string;
  itemId: string | number;
  vertical: "watches" | "real_estate";
  title: string;
  dominantAction: string;
  score: number;
  freshnessPriority: "HIGH" | "NORMAL";
  severity: AlertSeverity;
  reason: string;
  createdAt: string;         // ISO timestamp
  updatedAt: string;         // ISO timestamp — bumped on action upgrade
  isRead: boolean;
  isDismissed: boolean;
};

const STORE_PATH = path.join(process.cwd(), "data", "alerts.json");

async function readAll(): Promise<Record<string, Alert>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, Alert>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[alertStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, Alert>): Promise<void> {
  await safeWriteJson(STORE_PATH, data);
}

// ── Severity ordering (for upgrade detection) ──────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const ACTION_RANK: Record<string, number> = {
  EXECUTE_NOW: 4,
  EXECUTE_CONTROLLED: 3,
  PROBE: 2,
};

// ── Public API ─────────────────────────────────────────────────────────

export async function getAlerts(userId: string): Promise<Alert[]> {
  const all = await readAll();
  return Object.values(all)
    .filter((a) => a.userId === userId && !a.isDismissed)
    .sort((a, b) => {
      // Severity descending, then createdAt descending
      const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sd !== 0) return sd;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

export async function createOrUpdateAlerts(
  alerts: Alert[]
): Promise<{ created: number; updated: number }> {
  if (alerts.length === 0) return { created: 0, updated: 0 };

  const all = await readAll();
  let created = 0;
  let updated = 0;

  for (const alert of alerts) {
    const existing = all[alert.id];
    if (!existing) {
      all[alert.id] = alert;
      created++;
      continue;
    }
    // Only update if action improved (PROBE → EXECUTE_CONTROLLED → EXECUTE_NOW)
    const existingRank = ACTION_RANK[existing.dominantAction] ?? 0;
    const newRank = ACTION_RANK[alert.dominantAction] ?? 0;
    if (newRank > existingRank) {
      all[alert.id] = {
        ...alert,
        createdAt: existing.createdAt, // preserve original creation time
        isRead: false,                 // re-surface upgraded alerts
        isDismissed: false,
      };
      updated++;
    }
    // Same or lower action — keep existing, don't duplicate
  }

  if (created > 0 || updated > 0) {
    await writeAll(all);
  }
  return { created, updated };
}

export async function markAlertRead(alertId: string): Promise<boolean> {
  const all = await readAll();
  if (!all[alertId]) return false;
  all[alertId].isRead = true;
  await writeAll(all);
  return true;
}

export async function dismissAlert(alertId: string): Promise<boolean> {
  const all = await readAll();
  if (!all[alertId]) return false;
  all[alertId].isDismissed = true;
  await writeAll(all);
  return true;
}
