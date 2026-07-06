import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLatestRun } from "@/lib/operator/store";
import { envPresence } from "@/lib/operator/health";

export const dynamic = "force-dynamic";

/** GET /api/operator/status — the operator's self-health (for the status page and
 *  deployment verification). Admin session or CRON_SECRET bearer. */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isCron = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;
  const user = await getSession().catch(() => null);
  if (!isCron && user?.accessRole !== "admin_operator") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const latest = await getLatestRun("dylan").catch(() => null);
  return NextResponse.json({
    ok: true,
    env: envPresence(),
    lastRun: latest,
    healthy: latest?.ok ?? false,
    note: latest ? undefined : "No operator run recorded yet — the first cron (or manual refresh) will populate this.",
  });
}
