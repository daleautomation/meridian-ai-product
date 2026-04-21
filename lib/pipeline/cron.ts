// Meridian AI — Pipeline Cron Configuration.
//
// This module provides an in-process interval-based scheduler for the
// daily pipeline job. Call `startPipelineScheduler()` at server boot
// to enable automatic daily runs.
//
// For production: use Vercel Cron or an external scheduler that POSTs to
// /api/pipeline/daily with the x-pipeline-key header.
//
// Environment variables:
//   PIPELINE_CRON_KEY   — shared secret for external cron auth
//   PIPELINE_AUTO_RUN   — "true" to enable in-process scheduler (default: false)
//   PIPELINE_INTERVAL   — interval in ms (default: 86400000 = 24h)

import { runDailyPipeline, saveJobResult } from "./dailyJob";

let intervalRef: ReturnType<typeof setInterval> | null = null;
let lastRunAt: string | null = null;
let isRunning = false;

const DEFAULT_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

export function startPipelineScheduler(): void {
  if (intervalRef) return; // already running

  const enabled = process.env.PIPELINE_AUTO_RUN === "true";
  if (!enabled) {
    console.log("[pipeline-cron] PIPELINE_AUTO_RUN not set — scheduler disabled. Use /api/pipeline/daily manually or via external cron.");
    return;
  }

  const interval = parseInt(process.env.PIPELINE_INTERVAL ?? "", 10) || DEFAULT_INTERVAL;
  console.log(`[pipeline-cron] scheduler started — interval ${interval / 1000}s`);

  // Run once on startup (after 30s delay to let server fully boot)
  setTimeout(() => runJob(), 30_000);

  intervalRef = setInterval(() => runJob(), interval);
}

export function stopPipelineScheduler(): void {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
  }
}

export function getSchedulerStatus(): { running: boolean; lastRunAt: string | null; isExecuting: boolean } {
  return { running: !!intervalRef, lastRunAt, isExecuting: isRunning };
}

async function runJob(): Promise<void> {
  if (isRunning) {
    console.log("[pipeline-cron] skipping — previous run still in progress");
    return;
  }
  isRunning = true;
  console.log("[pipeline-cron] daily job starting...");

  try {
    const result = await runDailyPipeline({
      importSource: "seed",
      enrichLimit: 25,
      enrichConcurrency: 3,
      staleDays: 7,
    });
    await saveJobResult(result);
    lastRunAt = result.completedAt;
    console.log(`[pipeline-cron] daily job complete in ${(result.durationMs / 1000).toFixed(1)}s — ${result.errors.length} errors`);
  } catch (e) {
    console.error("[pipeline-cron] daily job crashed:", e);
  } finally {
    isRunning = false;
  }
}
