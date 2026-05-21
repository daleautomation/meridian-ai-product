import { getSession } from "@/lib/auth";
import { errorMessage, jsonError, jsonOk, parseRequestJson } from "@/lib/crm-import/apiJson";
import { executeImport } from "@/lib/crm-import/pipeline";

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

    const result = await executeImport({
      jobId,
      skipDuplicateRows: body?.skipDuplicateRows !== false,
      alsoUpsertRawCompanies: body?.alsoUpsertRawCompanies !== false,
    });
    return jsonOk({ result });
  } catch (err) {
    console.error("[crm-import/execute]", err);
    const message = errorMessage(err);
    const status = message.includes("Import job not found") ? 404 : 500;
    return jsonError(message, status);
  }
}
