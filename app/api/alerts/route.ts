import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAlerts } from "@/lib/state/alertStore";

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alerts = await getAlerts(user.id);
  return NextResponse.json({ alerts });
}
