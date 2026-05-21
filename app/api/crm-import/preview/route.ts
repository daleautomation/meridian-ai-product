import { getSession } from "@/lib/auth";
import { errorMessage, jsonError, jsonOk, parseRequestJson } from "@/lib/crm-import/apiJson";
import { createImportPreview } from "@/lib/crm-import/pipeline";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getSession();
    if (!user) return jsonError("unauthorized", 401);

    const body = await parseRequestJson(req);
    const workspaceId = String(body?.workspaceId ?? "").trim();
    const sourceLabel = String(body?.sourceLabel ?? "manual_csv").trim();
    const csvText = String(body?.csv ?? "").trim();
    const columnMapping = body?.columnMapping as Record<string, string> | undefined;

    if (!workspaceId || !csvText) {
      return jsonError("workspaceId and csv are required", 400);
    }

    const preview = await createImportPreview({ workspaceId, sourceLabel, csvText, columnMapping });
    return jsonOk({ preview });
  } catch (err) {
    console.error("[crm-import/preview]", err);
    return jsonError(errorMessage(err), 500);
  }
}
