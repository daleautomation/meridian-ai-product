// Meridian CRM import — orchestration: preview, validate, dedupe, execute, rollback.

import { parseCsv } from "@/lib/ingestion/csvParser";
import { upsertRaw } from "@/lib/state/rawCompaniesStore";
import { buildMergeRecommendations, dedupeSummary, findDedupePairs } from "./dedupe";
import { detectColumnMapping, normalizeCrmRows } from "./normalize";
import {
  createRollbackSnapshot,
  getImportJob,
  listContactsByWorkspace,
  newContactId,
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
import { computeRelationshipScore } from "@/lib/relationship-intelligence/scoring";

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
    suggestedMapping,
    rows: rows.slice(0, 50),
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
  if (!job) throw new Error("Import job not found.");

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
    const contacts: CrmContactRecord[] = eligible.map((row) => {
      const score = computeRelationshipScore({
        lastInteractionAt: row.lastInteractionAt,
        tags: row.tags,
        hasPhone: Boolean(row.normalizedPhone),
        hasEmail: Boolean(row.normalizedEmail),
        notesLength: row.notes?.length ?? 0,
        dataTrust: row.dataTrust,
      });
      return {
        id: newContactId(job.workspaceId, row.rowIndex),
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
        createdAt: now,
        updatedAt: now,
      };
    });

    const { inserted } = await upsertContacts(contacts);

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
