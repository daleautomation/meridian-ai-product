import { getSession } from "@/lib/auth";
import { errorMessage, jsonError, jsonOk, parseRequestJson } from "@/lib/crm-import/apiJson";
import { executeImport } from "@/lib/crm-import/pipeline";
import {
  describeContactStorageMode,
  getImportJob,
  getWorkspaceContactCounts,
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

    // Decisive diagnostic: immediately after the upsert returns, query
    // the SAME read path /personal uses (listContactsByWorkspace via
    // getWorkspaceContactCounts). If `inserted` > 0 but
    // `contactCountAfterImport` is 0, the write and read are on
    // different stores — the smoking gun the operator needs to see in
    // function logs.
    const storage = describeContactStorageMode();
    const job = await getImportJob(jobId).catch(() => null);
    const workspaceId = job?.workspaceId ?? "";
    let contactCountAfterImport: number | null = null;
    let readBackError: string | null = null;
    if (workspaceId) {
      const counts = await getWorkspaceContactCounts([workspaceId]);
      const entry = counts.workspaces.find((w) => w.workspaceId === workspaceId);
      contactCountAfterImport = entry?.count ?? null;
      readBackError = entry?.error ?? null;
    }

    // eslint-disable-next-line no-console
    console.log(
      `[crm-import/execute] ok jobId=${jobId} workspaceId=${workspaceId || "?"} ` +
        `inserted=${result.imported} skipped=${result.skipped} duplicates=${result.duplicates} ` +
        `contactCountAfterImport=${contactCountAfterImport ?? "(error)"} ` +
        `readBackError=${readBackError ?? "none"} ` +
        `storageMode=${storage.mode} durable=${storage.durable}`,
    );

    return jsonOk({
      result,
      storage: {
        mode: storage.mode,
        durable: storage.durable,
      },
      contactCountAfterImport,
      readBackError,
    });
  } catch (err) {
    console.error("[crm-import/execute]", err);
    const message = errorMessage(err);
    const status = message.includes("Import job not found") ? 404 : 500;
    return jsonError(message, status);
  }
}
