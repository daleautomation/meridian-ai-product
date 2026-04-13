// Meridian AI — alert generation from scored DecisionItems.
//
// Runs AFTER the engine produces decisions. Reads existing fields only —
// does not alter items, scoring, or ordering.
//
// Trigger rules:
//   EXECUTE_NOW                      → alert
//   EXECUTE_CONTROLLED               → alert
//   PROBE + freshnessPriority=HIGH   → alert
//   everything else                  → no alert

import type { DecisionItem } from "@/lib/types";
import {
  type Alert,
  type AlertSeverity,
  createOrUpdateAlerts,
} from "@/lib/state/alertStore";

// ── Severity classification ────────────────────────────────────────────

function classifySeverity(
  action: string,
  freshness: "HIGH" | "NORMAL"
): AlertSeverity {
  if (action === "EXECUTE_NOW" && freshness === "HIGH") return "CRITICAL";
  if (action === "EXECUTE_NOW") return "HIGH";
  if (action === "EXECUTE_CONTROLLED" && freshness === "HIGH") return "MEDIUM";
  if (action === "EXECUTE_CONTROLLED") return "MEDIUM";
  // PROBE + HIGH freshness (the only other case that triggers)
  return "LOW";
}

// ── Reason text from existing decision context ─────────────────────────

function buildReason(item: DecisionItem): string {
  const action = item.acquisitionPlan?.decision?.dominantAction ?? "";
  const fresh = item.freshnessPriority === "HIGH";
  const qualifier = item.acquisitionPlan?.decision?.negotiation?.reasoning ?? "";

  // Extract the short qualifier after the "ACTION — " prefix
  const shortQualifier = qualifier.replace(/^[A-Z_]+ — /, "").slice(0, 60);

  if (action === "EXECUTE_NOW") {
    if (fresh) return `EXECUTE NOW — fresh listing, ${shortQualifier || "strong edge"}`;
    return `EXECUTE NOW — ${shortQualifier || "premium edge, move immediately"}`;
  }
  if (action === "EXECUTE_CONTROLLED") {
    return `EXECUTE — ${shortQualifier || "real edge, controlled execution"}`;
  }
  // PROBE
  return `PROBE — ${shortQualifier || "fresh signal worth checking"}`;
}

// ── Trigger check ──────────────────────────────────────────────────────

function shouldAlert(item: DecisionItem): boolean {
  const action = item.acquisitionPlan?.decision?.dominantAction;
  if (!action) return false;
  if (action === "EXECUTE_NOW") return true;
  if (action === "EXECUTE_CONTROLLED") return true;
  if (action === "PROBE" && item.freshnessPriority === "HIGH" && item.score >= 6.5) return true;
  return false;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Generate alerts from a set of scored DecisionItems.
 * Returns items unchanged — alert generation is a side effect only.
 */
export async function generateAlerts(
  userId: string,
  vertical: "watches" | "real_estate",
  items: DecisionItem[]
): Promise<DecisionItem[]> {
  const now = new Date().toISOString();
  const newAlerts: Alert[] = [];

  for (const item of items) {
    if (!shouldAlert(item)) continue;

    const action = item.acquisitionPlan!.decision.dominantAction;
    const freshness = item.freshnessPriority ?? "NORMAL";
    const id = `${userId}:${item.id}:${action}`;

    newAlerts.push({
      id,
      userId,
      itemId: item.id,
      vertical,
      title: item.title,
      dominantAction: action,
      score: item.score,
      freshnessPriority: freshness,
      severity: classifySeverity(action, freshness),
      reason: buildReason(item),
      createdAt: now,
      updatedAt: now,
      isRead: false,
      isDismissed: false,
    });
  }

  if (newAlerts.length > 0) {
    const result = await createOrUpdateAlerts(newAlerts);
    if (result.created > 0 || result.updated > 0) {
      console.log(
        `[alerts] ${vertical}: ${result.created} new, ${result.updated} updated`
      );
    }
  }

  return items; // unchanged
}
