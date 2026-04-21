// Meridian AI — Pipeline State Reset.
//
// POST /api/pipeline/reset
// Clears CRM activity history, pipeline status, call attempts, and next actions
// from all company snapshots — while preserving the lead data, scoring, and
// inspection results. Makes the workspace feel fresh for LaborTech.
//
// This does NOT wipe imported companies or their website inspection data.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const results: Record<string, unknown> = {};

  // 1. Clear CRM activities
  const crmPath = path.join(process.cwd(), "data", "crmActivities.json");
  await safeWriteJson(crmPath, {});
  results.crmActivities = "cleared";

  // 2. Clear pipeline state from snapshots (keep inspection data)
  const snapPath = path.join(process.cwd(), "data", "companySnapshots.json");
  try {
    const raw = await fs.readFile(snapPath, "utf8");
    const snapshots = JSON.parse(raw);
    let cleaned = 0;
    for (const key of Object.keys(snapshots)) {
      const snap = snapshots[key];
      // Remove pipeline/CRM fields but keep inspection + scoring data
      delete snap.status;
      delete snap.statusHistory;
      delete snap.lastAction;
      delete snap.nextAction;
      delete snap.nextActionDate;
      delete snap.dealActions;
      delete snap.callAttempts;
      delete snap.consecutiveNoAnswers;
      delete snap.lastAttemptType;
      delete snap.lastAttemptOutcome;
      delete snap.escalationStage;
      delete snap.contactName;
      delete snap.contactPhone;
      delete snap.contactEmail;
      // Keep: company, latest, history, scoreHistory, notes, profile, lastCheckedAt
      snapshots[key] = snap;
      cleaned++;
    }
    await safeWriteJson(snapPath, snapshots);
    results.snapshots = { cleaned, total: Object.keys(snapshots).length };
  } catch (e) {
    results.snapshots = { error: (e as Error).message };
  }

  // 3. Clear pipeline job history
  const histPath = path.join(process.cwd(), "data", "pipelineJobHistory.json");
  await safeWriteJson(histPath, []);
  results.jobHistory = "cleared";

  // 4. Clear reviews
  const reviewPath = path.join(process.cwd(), "data", "reviews.json");
  await safeWriteJson(reviewPath, {});
  results.reviews = "cleared";

  return NextResponse.json({ ok: true, results });
}
