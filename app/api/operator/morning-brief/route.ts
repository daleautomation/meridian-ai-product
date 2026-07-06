import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeLiveBrief, persistReality } from "@/lib/home/pipeline";
import { sendBriefNotification } from "@/lib/home/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The morning operator. Runs the Reality Layer scan (Gmail + Calendar + Contacts +
 * LinkedIn manual observations from the committed batches), derives beliefs,
 * generates recommendations, persists the brief (best-effort), and sends the
 * notification.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` (GET). The manual
 * "Run refresh" button calls it with an admin session cookie (POST). Either passes.
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

  const startedAt = new Date().toISOString();
  try {
    const result = await computeLiveBrief(Date.now(), "Dylan");
    const persisted = await persistReality(result).catch(() => false);
    const notify = await sendBriefNotification(result.brief);

    const top = result.brief.topActions[0];
    const summary = {
      ok: true,
      trigger: isCron ? "cron" : "manual",
      startedAt,
      connectors: result.results.map((r) => ({ id: r.connector, state: r.health.state, observations: r.collected })),
      beliefs: result.beliefs.length,
      recommendations: result.recommendations.length,
      topAction: top ? { label: top.subjectLabel, action: top.action } : null,
      persisted,
      notification: notify,
    };
    console.log("[morning-brief] ok", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[morning-brief] FAILED", detail);
    return NextResponse.json({ ok: false, error: detail, startedAt }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
