import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createImportPreview } from "@/lib/crm-import/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const workspaceId = String(body?.workspaceId ?? "").trim();
  const sourceLabel = String(body?.sourceLabel ?? "manual_csv").trim();
  const csvText = String(body?.csv ?? "").trim();
  const columnMapping = body?.columnMapping;

  if (!workspaceId || !csvText) {
    return NextResponse.json({ error: "workspaceId and csv are required" }, { status: 400 });
  }

  const preview = await createImportPreview({ workspaceId, sourceLabel, csvText, columnMapping });
  return NextResponse.json({ ok: true, preview });
}
