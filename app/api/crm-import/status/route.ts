import { getSession } from "@/lib/auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/crm-import/apiJson";
import { buildPreviewFromJob } from "@/lib/crm-import/pipeline";
import { getImportJob } from "@/lib/crm-import/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSession();
    if (!user) return jsonError("unauthorized", 401);

    const jobId = new URL(req.url).searchParams.get("jobId")?.trim();
    const workspaceId = new URL(req.url).searchParams.get("workspaceId")?.trim();
    if (!jobId) {
      return jsonError("jobId is required", 400);
    }

    const job = await getImportJob(jobId);
    if (!job) {
      return jsonError("Import job not found. Re-run preview from your CSV.", 404);
    }
    if (workspaceId && job.workspaceId !== workspaceId) {
      return jsonError("Import job does not match this workspace.", 403);
    }

    const preview = buildPreviewFromJob(job);
    return jsonOk({ job, preview });
  } catch (err) {
    console.error("[crm-import/status]", err);
    return jsonError(errorMessage(err), 500);
  }
}
