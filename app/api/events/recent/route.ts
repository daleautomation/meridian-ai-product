import { NextResponse } from "next/server";
import { readRecentEvents } from "@/lib/tracking/eventLog";

// Meridian — Recent events viewer.
//
// Auth-gated: only logged-in operators can read. Returns the latest
// N events as JSON, newest last. Useful for Dylan to inspect John's
// usage post-session without shelling into the box.
import { getSession } from "@/lib/auth";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, limitRaw) : 200;
  const events = await readRecentEvents(limit);
  return NextResponse.json({ count: events.length, events });
}
