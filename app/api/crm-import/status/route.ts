import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getImportJob } from "@/lib/crm-import/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jobId = new URL(req.url).searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getImportJob(jobId);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, job });
}
