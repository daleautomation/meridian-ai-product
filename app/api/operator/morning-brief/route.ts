import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  dataFreshness,
  loadLiveRealityInputs,
  persistReality,
  runRealityPipeline,
} from "@/lib/home/pipeline";
import { sendBriefNotification } from "@/lib/home/notify";
import { getLatestSnapshot, saveRun, saveSnapshot } from "@/lib/operator/store";
import { detectChanges } from "@/lib/operator/changeDetection";
import { buildRun } from "@/lib/operator/health";
import { shouldCronScanRun } from "@/lib/operator/schedule";
import type { DailySnapshot } from "@/lib/operator/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWNER = "dylan";

/**
 * The autonomous morning operator. Wakes (via Vercel Cron), runs every connector,
 * derives beliefs + recommendations, detects what changed since yesterday, persists
 * an immutable dated snapshot (Neon-durable), records its own health, and notifies.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` (GET). The manual
 * refresh button uses an admin session (POST). Either passes.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  const user = await getSession().catch(() => null);
  const isAdmin = user?.accessRole === "admin_operator";
  if (!isCron && !isAdmin) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const trigger = isCron ? "cron" : "manual";
  const runAtMs = Date.now();
  const today = new Date(runAtMs).toISOString().slice(0, 10);

  // DST-proof scan guard: the cron fires at the union of both DST offsets
  // (13,14,18,19 UTC); only the fire that lands on 8am or 1pm Central proceeds.
  // Manual admin runs always proceed.
  if (isCron) {
    const gate = shouldCronScanRun(runAtMs);
    if (!gate.run) {
      console.log(`[morning-brief] skipped — not a scan hour (Central ${gate.centralHour}:00)`);
      return NextResponse.json({ ok: true, skipped: true, reason: `not a scan hour (Central ${gate.centralHour}:00)` });
    }
    console.log(`[morning-brief] scan slot=${gate.slot} (Central ${gate.centralHour}:00)`);
  }

  try {
    // 1) The last scan on record — for the "what changed since last scan" diff.
    //    getLatestSnapshot is intraday-aware (8am vs 1pm), unlike a day-keyed read.
    const previous = await getLatestSnapshot(OWNER).catch(() => null);

    // 2) Observe reality → beliefs → recommendations → brief.
    const inputs = await loadLiveRealityInputs();
    const result = await runRealityPipeline(inputs, { nowMs: runAtMs, owner: "Dylan", previousBeliefs: previous?.beliefs ?? [] });
    const freshness = await dataFreshness().catch(() => ({ gmail: null, calendar: null }));

    // 3) Immutable dated snapshot (never overwrites yesterday).
    const snapshot: DailySnapshot = {
      date: today,
      ownerId: OWNER,
      generatedAt: result.brief.generatedAt,
      observationCount: result.observations.length,
      connectors: result.results.map((r) => ({ id: r.connector, state: r.health.state, observations: r.collected })),
      beliefs: result.beliefs,
      recommendations: result.recommendations,
      brief: result.brief,
    };
    const change = detectChanges(snapshot, previous);
    const storage = await saveSnapshot(snapshot);

    // Meaningful changes = new + stage moves + momentum shifts + resolved.
    const changeCount =
      change.newBeliefs.length + change.stageChanges.length +
      change.strengthened.length + change.cooled.length + change.droppedBeliefs.length;

    // 4) Notify (only when something meaningful moved, or on the first run) + health.
    const shouldNotify = !previous || changeCount > 0;
    const notification = shouldNotify
      ? await sendBriefNotification(result.brief, { changeCount })
      : { sent: false as const, channel: "none" as const, detail: "no meaningful change — notification suppressed" };
    const run = buildRun({ ownerId: OWNER, trigger, runAtMs, result, notification, freshness, storage, changeHeadline: change.headline });
    await saveRun(run);
    await persistReality(result).catch(() => false); // best-effort brief cache for /home

    const top = result.brief.topActions[0];
    const summary = {
      ok: true,
      trigger,
      date: today,
      topAction: top ? { label: top.subjectLabel, action: top.action } : null,
      change: change.headline,
      recommendationMoves: change.recommendationMoves,
      notification,
      storage,
      health: { ok: run.ok, stale: run.stale, freshnessHours: run.freshnessHours, incompleteConnectors: run.incompleteConnectors },
    };
    console.log("[morning-brief] ok", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[morning-brief] FAILED", detail);
    // Record the failure so the status page shows it quietly.
    await saveRun({
      runId: `${OWNER}:${new Date(runAtMs).toISOString()}`, ownerId: OWNER,
      runAt: new Date(runAtMs).toISOString(), trigger, ok: false,
      connectors: [], notification: { sent: false, channel: "none", detail: "run failed before notify" },
      freshnessHours: null, stale: true, incompleteConnectors: ["all"],
      env: { cronSecret: !!cronSecret, notificationChannel: false, databaseUrl: !!process.env.DATABASE_URL, baseUrl: true },
      storage: "file", changeSummary: `FAILED: ${detail}`,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
