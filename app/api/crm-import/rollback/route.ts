import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rollbackImportJob } from "@/lib/crm-import/pipeline";

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
    const result = await rollbackImportJob(jobId);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
