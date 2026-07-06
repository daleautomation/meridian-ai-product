import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeLiveBrief } from "@/lib/home/pipeline";
import { getLatestRun, getPreviousSnapshot, saveSnapshot } from "@/lib/operator/store";
import type { DailySnapshot } from "@/lib/operator/types";
import { buildDailyReview } from "@/lib/review/nightly";
import { buildWeeklyReview } from "@/lib/review/weekly";
import { getFeedbackForDate, getRecentDailyReviews, saveDailyReview, saveWeeklyReview } from "@/lib/review/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWNER = "dylan";

/**
 * The autonomous evening reviewer. Morning is for decisions; evening is for
 * learning. Reviews the day, calibrates each recommendation against real feedback,
 * records belief updates, and persists an immutable Daily Review (and, on Sundays,
 * a Weekly Review). No fabricated numbers; "unknown" is a valid verdict.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isCron = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;
  const user = await getSession().catch(() => null);
  if (!isCron && user?.accessRole !== "admin_operator") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const runAtMs = Date.now();
  const today = new Date(runAtMs).toISOString().slice(0, 10);
  const generatedAt = new Date(runAtMs).toISOString();

  try {
    // End-of-day reality is "today"; the prior snapshot is "yesterday".
    const result = await computeLiveBrief(runAtMs, "Dylan");
    const snapshot: DailySnapshot = {
      date: today, ownerId: OWNER, generatedAt: result.brief.generatedAt,
      observationCount: result.observations.length,
      connectors: result.results.map((r) => ({ id: r.connector, state: r.health.state, observations: r.collected })),
      beliefs: result.beliefs, recommendations: result.recommendations, brief: result.brief,
    };
    await saveSnapshot(snapshot);

    const yesterday = await getPreviousSnapshot(OWNER, today).catch(() => null);
    const feedback = await getFeedbackForDate(OWNER, today).catch(() => []);
    const latestRun = await getLatestRun(OWNER).catch(() => null);

    const review = buildDailyReview({ today: snapshot, yesterday, feedback, latestRun, generatedAt });
    await saveDailyReview(review);

    // Weekly review on Sundays (UTC day 0).
    let weekly = null;
    if (new Date(runAtMs).getUTCDay() === 0) {
      const recent = await getRecentDailyReviews(OWNER, 7).catch(() => []);
      weekly = buildWeeklyReview(recent.length ? recent : [review], today, generatedAt, OWNER);
      await saveWeeklyReview(weekly);
    }

    const summary = {
      ok: true,
      date: today,
      trigger: isCron ? "cron" : "manual",
      accuracy: review.accuracy,
      producedValue: review.narrative.producedValue,
      failed: review.narrative.failed,
      beliefUpdates: review.beliefUpdates.length,
      believeDifferently: review.narrative.believeDifferently,
      weeklyGenerated: !!weekly,
    };
    console.log("[nightly-review] ok", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[nightly-review] FAILED", detail);
    return NextResponse.json({ ok: false, error: detail, date: today }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
