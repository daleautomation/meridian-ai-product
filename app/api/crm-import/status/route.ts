import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildPreviewFromJob } from "@/lib/crm-import/pipeline";
import { getImportJob } from "@/lib/crm-import/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jobId = new URL(req.url).searchParams.get("jobId")?.trim();
  const workspaceId = new URL(req.url).searchParams.get("workspaceId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const job = await getImportJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: "Import job not found. Re-run preview from your CSV." },
      { status: 404 },
    );
  }
  if (workspaceId && job.workspaceId !== workspaceId) {
    return NextResponse.json({ error: "Import job does not match this workspace." }, { status: 403 });
  }

  const preview = buildPreviewFromJob(job);
  return NextResponse.json({ ok: true, job, preview });
}
