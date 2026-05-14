import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";
import { buildRelationshipEngineOperatorSurface } from "@/lib/relationship-engine/operatorIntegration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const workspaceSlug = url.searchParams.get("workspace")?.trim() || user.workspaces?.[0] || null;
  if (!workspaceSlug) {
    return NextResponse.json({ ok: false, error: "Missing workspace" }, { status: 400 });
  }

  const access = getWorkspaceAccess(user, workspaceSlug);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "Workspace not accessible" }, { status: access.status });
  }

  if (
    access.workspace.access.dataMode !== "demo"
    && user.accessRole !== "admin_operator"
    && user.accessRole !== "client_user"
  ) {
    return NextResponse.json(
      { ok: false, error: "Relationship Engine reads require operator access for client workspaces" },
      { status: 403 },
    );
  }

  const surface = await buildRelationshipEngineOperatorSurface({
    workspace: access.workspace,
    user,
  });

  return NextResponse.json({ ok: true, surface });
}
