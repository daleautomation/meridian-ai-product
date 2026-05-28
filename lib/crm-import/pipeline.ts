// Meridian CRM import — orchestration: preview, validate, dedupe, execute, rollback.

import { parseCsv } from "@/lib/ingestion/csvParser";
import { upsertRaw } from "@/lib/state/rawCompaniesStore";
import { computeImportDiagnostics } from "./diagnostics";
import { buildMergeRecommendations, dedupeSummary, findDedupePairs } from "./dedupe";
import {
  mintContactId,
  resolveExistingContactForRow,
} from "./identityKey";
import { mergeContactRecords } from "./merge";
import { detectColumnMapping, normalizeCrmRows } from "./normalize";
import {
  createRollbackSnapshot,
  getImportJob,
  listContactsByWorkspace,
  newJobId,
  rollbackImport,
  saveImportJob,
  upsertContacts,
} from "./store";
import { rowsEligibleForImport, validateImportRows } from "./validate";
import type {
  CrmContactRecord,
  CrmImportJob,
  ImportExecuteResult,
  ImportPreviewResult,
  NormalizedCrmContact,
} from "./types";
import { scoreMetadataForImport } from "@/lib/crm-import/scoreTransparency";
import { computeRelationshipScore } from "@/lib/relationship-intelligence/scoring";

export function buildPreviewFromJob(job: CrmImportJob): ImportPreviewResult {
  const rows = job.normalizedRows ?? job.previewSample;
  const validationSummary = validateImportRows(rows, job.dedupePairs);
  const dedupeSummaryResult = dedupeSummary(job.dedupePairs, rows.length);
  const diagnostics = computeImportDiagnostics({
    headers: job.headers,
    mapping: job.columnMapping,
    rows,
  });

  return {
    jobId: job.id,
    headers: job.headers,
    suggestedMapping: job.columnMapping,
    rows: rows.slice(0, 50),
    diagnostics,
    validationSummary,
    dedupeSummary: dedupeSummaryResult,
    mergeRecommendations: job.mergeRecommendations,
  };
}

export async function createImportPreview(args: {
  workspaceId: string;
  sourceLabel: string;
  csvText: string;
  columnMapping?: Partial<Record<string, string>>;
}): Promise<ImportPreviewResult> {
  const parsed = parseCsv(args.csvText);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const suggestedMapping = detectColumnMapping(headers);
  const mapping = { ...suggestedMapping, ...args.columnMapping };
  const rows = normalizeCrmRows(parsed, mapping, args.sourceLabel);
  const existing = await listContactsByWorkspace(args.workspaceId);
  const dedupePairs = findDedupePairs(rows, existing);
  const mergeRecommendations = buildMergeRecommendations(dedupePairs);
  const validationSummary = validateImportRows(rows, dedupePairs);
  const summary = dedupeSummary(dedupePairs, rows.length);
  const diagnostics = computeImportDiagnostics({ headers, mapping, rows });

  const jobId = newJobId(args.workspaceId);
  const job: CrmImportJob = {
    id: jobId,
    workspaceId: args.workspaceId,
    sourceLabel: args.sourceLabel,
    state: "previewing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rowCount: rows.length,
    importedCount: 0,
    skippedCount: 0,
    duplicateCount: dedupePairs.length,
    rollbackSnapshotId: null,
    error: null,
    headers,
    columnMapping: mapping,
    previewSample: rows.slice(0, 25),
    normalizedRows: rows,
    dedupePairs,
    mergeRecommendations,
  };
  await saveImportJob(job);

  return {
    jobId,
    headers,
    suggestedMapping: mapping,
    rows: rows.slice(0, 50),
    diagnostics,
    validationSummary,
    dedupeSummary: summary,
    mergeRecommendations,
  };
}

export async function executeImport(args: {
  jobId: string;
  skipDuplicateRows?: boolean;
  alsoUpsertRawCompanies?: boolean;
}): Promise<ImportExecuteResult> {
  const job = await getImportJob(args.jobId);
  if (!job) {
    throw new Error(
      "Import job not found. Re-run preview from your CSV — the server may have restarted or the job expired.",
    );
  }
  if (!job.normalizedRows?.length && !job.previewSample.length) {
    throw new Error("Import job has no rows to import. Re-run preview from your CSV.");
  }

  job.state = "importing";
  job.updatedAt = new Date().toISOString();
  await saveImportJob(job);

  try {
    const rollbackSnapshotId = await createRollbackSnapshot(job.workspaceId);
    job.rollbackSnapshotId = rollbackSnapshotId;

    const fullRows = job.normalizedRows ?? job.previewSample;

    const existing = await listContactsByWorkspace(job.workspaceId);
    const dedupePairs = job.dedupePairs.length > 0
      ? job.dedupePairs
      : findDedupePairs(fullRows, existing);

    const validation = validateImportRows(fullRows, dedupePairs);
    const eligible = rowsEligibleForImport(
      fullRows,
      validation.blockedRowIndexes,
      args.skipDuplicateRows ?? true,
      dedupePairs,
    );

    const now = new Date().toISOString();
    let safeMergeCount = 0;
    let newContactCount = 0;
    const contacts: CrmContactRecord[] = eligible.map((row) => {
      const score = computeRelationshipScore({
        lastInteractionAt: row.lastInteractionAt,
        tags: row.tags,
        hasPhone: Boolean(row.normalizedPhone),
        hasEmail: Boolean(row.normalizedEmail),
        notesLength: row.notes?.length ?? 0,
        dataTrust: row.dataTrust,
      });

      // ── Identity resolution: match incoming against existing ────
      // Re-importing the same contact must REUSE the existing
      // contact_id so the JSONB-merging upsert UPDATES the row
      // (preserving enrichment + repairs) instead of inserting a
      // duplicate. Only the rules in identityKey.ts can produce a
      // match — exact email, exact phone, or same surname + same
      // canonical address.
      const resolution = resolveExistingContactForRow(row, existing);
      const minted = mintContactId(job.workspaceId, row, { importJobId: job.id });

      // Build the import-time record. ID is either the existing
      // contact's (preserve identity + history) or the minted
      // identity-derived id.
      const importedRecord: CrmContactRecord = {
        id: resolution.existing ? resolution.existing.id : minted.id,
        workspaceId: job.workspaceId,
        importJobId: job.id,
        name: row.name,
        company: row.company,
        phone: row.phone,
        email: row.email,
        address: row.address,
        notes: row.notes,
        tags: row.tags,
        lastInteractionAt: row.lastInteractionAt,
        sourceCrm: row.sourceCrm,
        normalizedPhone: row.normalizedPhone,
        normalizedEmail: row.normalizedEmail,
        normalizedCompany: row.normalizedCompany,
        normalizedName: row.normalizedName,
        dataTrust: row.dataTrust,
        relationshipScore: score.total,
        scoreMetadata: {
          ...scoreMetadataForImport(score),
          sourceFieldsUsed: [
            ...(row.lastInteractionAt ? ["lastInteractionAt"] : []),
            ...(row.tags.length > 0 ? ["tags"] : []),
            ...(row.notes?.trim() ? ["notes"] : []),
            ...(row.normalizedPhone ? ["phone"] : []),
            ...(row.normalizedEmail ? ["email"] : []),
            ...(row.company?.trim() ? ["company"] : []),
            ...(row.name?.trim() ? ["name"] : []),
          ],
        },
        createdAt: resolution.existing ? resolution.existing.createdAt : now,
        updatedAt: now,
      };

      // If we matched an existing contact, MERGE field-by-field so
      // blank incoming values don't blow away non-empty existing
      // values. Enrichment + repairs are preserved at the
      // persistence layer (upsertContactsNeon's ON CONFLICT clause).
      if (resolution.existing) {
        safeMergeCount += 1;
        return mergeContactRecords({
          incoming: importedRecord,
          existing: resolution.existing,
        });
      }
      newContactCount += 1;
      return importedRecord;
    });

    // The persistence layer's JSONB-merging upsert preserves
    // source_metadata.enrichment.* and source_metadata.repairs[] on
    // every UPDATE. Matched contacts get their CRM-truth fields
    // refreshed; non-matched contacts get inserted with new identity-
    // derived IDs.
    const { inserted, updated } = await upsertContacts(contacts);
    void updated;
    void safeMergeCount;
    void newContactCount;

    if (args.alsoUpsertRawCompanies !== false) {
      await upsertRaw(
        eligible.map((row) => ({
          name: row.company || row.name,
          phone: row.phone ?? undefined,
          website: undefined,
          city: undefined,
          state: undefined,
          source: job.sourceLabel,
          collectedAt: now,
        })),
      );
    }

    job.state = "completed";
    job.importedCount = inserted;
    job.skippedCount = fullRows.length - eligible.length;
    job.duplicateCount = dedupePairs.length;
    job.updatedAt = new Date().toISOString();
    await saveImportJob(job);

    return {
      jobId: job.id,
      state: job.state,
      imported: inserted,
      skipped: job.skippedCount,
      duplicates: job.duplicateCount,
      rollbackSnapshotId,
    };
  } catch (err) {
    job.state = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    job.updatedAt = new Date().toISOString();
    await saveImportJob(job);
    throw err;
  }
}

export async function rollbackImportJob(jobId: string): Promise<{ restored: number; state: string }> {
  const job = await getImportJob(jobId);
  if (!job?.rollbackSnapshotId) throw new Error("No rollback snapshot for this job.");

  const { restored } = await rollbackImport(job.rollbackSnapshotId);
  job.state = "rolled_back";
  job.updatedAt = new Date().toISOString();
  await saveImportJob(job);
  return { restored, state: job.state };
}

export async function storeFullPreviewRows(jobId: string, rows: NormalizedCrmContact[]): Promise<void> {
  const job = await getImportJob(jobId);
  if (!job) throw new Error("Import job not found.");
  job.previewSample = rows;
  job.rowCount = rows.length;
  job.updatedAt = new Date().toISOString();
  const existing = await listContactsByWorkspace(job.workspaceId);
  job.dedupePairs = findDedupePairs(rows, existing);
  job.mergeRecommendations = buildMergeRecommendations(job.dedupePairs);
  job.duplicateCount = job.dedupePairs.length;
  await saveImportJob(job);
}
