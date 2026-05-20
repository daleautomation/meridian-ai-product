import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listContactsByWorkspace } from "@/lib/crm-import/store";
import { buildResurfacingBuckets } from "@/lib/relationship-intelligence/resurfacing";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = new URL(req.url).searchParams.get("workspaceId")?.trim();
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const contacts = await listContactsByWorkspace(workspaceId);
  const buckets = buildResurfacingBuckets(contacts);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    contactCount: contacts.length,
    buckets,
  });
}
