// Meridian — List schedule overrides for a workspace.
//
// GET ?workspace=<slug>  →  { ok: true, overrides: ScheduleOverride[] }
//
// Used by the operator console on mount when it wants to verify the
// SSR-applied overrides are in sync with what's actually persisted —
// rare, mostly defensive. Server-side rendering already merges
// overrides into the lead lists.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listOverrides } from "@/lib/scheduling/overrideStore";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace") ?? "";
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Missing workspace" }, { status: 400 });
  }
  const access = getWorkspaceAccess(session, workspace);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Workspace not accessible" }, { status: access.status });
  }
  const overrides = await listOverrides(workspace);
  return NextResponse.json({ ok: true, overrides });
}
