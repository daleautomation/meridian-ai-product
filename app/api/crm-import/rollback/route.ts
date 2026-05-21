import { getSession } from "@/lib/auth";
import { errorMessage, jsonError, jsonOk, parseRequestJson } from "@/lib/crm-import/apiJson";
import { rollbackImportJob } from "@/lib/crm-import/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSession();
    if (!user) return jsonError("unauthorized", 401);

    const body = await parseRequestJson(req);
    const jobId = String(body?.jobId ?? "").trim();
    if (!jobId) {
      return jsonError("jobId is required", 400);
    }

    const result = await rollbackImportJob(jobId);
    return jsonOk({ result });
  } catch (err) {
    console.error("[crm-import/rollback]", err);
    return jsonError(errorMessage(err), 500);
  }
}
