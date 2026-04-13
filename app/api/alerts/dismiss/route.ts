import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { dismissAlert } from "@/lib/state/alertStore";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const alertId = body?.alertId;
  if (typeof alertId !== "string" || !alertId.startsWith(`${user.id}:`)) {
    return NextResponse.json({ error: "Invalid alert" }, { status: 400 });
  }

  const ok = await dismissAlert(alertId);
  return NextResponse.json({ ok });
}
