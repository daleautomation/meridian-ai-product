import { getSession } from "@/lib/auth";
import { errorMessage, jsonError, jsonOk, parseRequestJson } from "@/lib/crm-import/apiJson";
import { executeImport } from "@/lib/crm-import/pipeline";
import {
  describeContactStorageMode,
  getImportJob,
} from "@/lib/crm-import/store";

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

    // Explicit import-completion summary. Surfaces the write outcome
    // AND the storage path it landed on so an operator can rule out
    // silent fallback or workspace-key drift between import and read.
    const storage = describeContactStorageMode();
    const job = await getImportJob(jobId).catch(() => null);
    // eslint-disable-next-line no-console
    console.log(
      `[crm-import/execute] ok jobId=${jobId} workspaceId=${job?.workspaceId ?? "?"} ` +
        `inserted=${result.imported} skipped=${result.skipped} duplicates=${result.duplicates} ` +
        `storageMode=${storage.mode} durable=${storage.durable}`,
    );

    return jsonOk({
      result,
      storage: {
        mode: storage.mode,
        durable: storage.durable,
      },
    });
  } catch (err) {
    console.error("[crm-import/execute]", err);
    const message = errorMessage(err);
    const status = message.includes("Import job not found") ? 404 : 500;
    return jsonError(message, status);
  }
}
