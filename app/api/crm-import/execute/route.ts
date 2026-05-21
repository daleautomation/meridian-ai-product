import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { executeImport } from "@/lib/crm-import/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const jobId = String(body?.jobId ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  try {
    const result = await executeImport({
      jobId,
      skipDuplicateRows: body?.skipDuplicateRows !== false,
      alsoUpsertRawCompanies: body?.alsoUpsertRawCompanies !== false,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Import job not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
