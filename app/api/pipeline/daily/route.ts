// Meridian AI — Daily Pipeline Job API.
//
// POST /api/pipeline/daily — Runs the full daily pipeline refresh.
// GET  /api/pipeline/daily — Returns job history (last 30 runs).
//
// Authentication: session cookie OR x-pipeline-key header (for cron).
// The pipeline key should be set via PIPELINE_CRON_KEY env var.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runDailyPipeline, saveJobResult, getJobHistory, type DailyJobOptions } from "@/lib/pipeline/dailyJob";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min

function isAuthorized(req: Request): boolean {
  // Check cron key header
  const cronKey = process.env.PIPELINE_CRON_KEY;
  if (cronKey) {
    const headerKey = req.headers.get("x-pipeline-key");
    if (headerKey === cronKey) return true;
  }
  return false;
}

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const history = await getJobHistory();
  return NextResponse.json({ ok: true, history });
}

export async function POST(req: Request) {
  // Allow either session auth or cron key
  const user = await getSession();
  const cronAuthed = isAuthorized(req);
  if (!user && !cronAuthed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Parse options from request body (optional)
  let opts: DailyJobOptions = {};
  try {
    const body = await req.json();
    opts = {
      tenantId: user?.id ?? body.tenantId ?? "default",
      importSource: body.importSource ?? "seed",
      enrichLimit: body.enrichLimit ?? 25,
      enrichConcurrency: body.enrichConcurrency ?? 3,
      staleDays: body.staleDays ?? 7,
      rotationStaleDays: body.rotationStaleDays ?? 30,
    };
  } catch {
    opts = { tenantId: user?.id ?? "default", importSource: "seed" };
  }

  try {
    const result = await runDailyPipeline(opts);
    await saveJobResult(result);

    return NextResponse.json({
      ok: true,
      result: {
        duration: `${(result.durationMs / 1000).toFixed(1)}s`,
        steps: result.steps,
        errors: result.errors,
        hasErrors: result.errors.length > 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "pipeline job failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
