/**
 * import-workspace-csv — non-destructive CSV import for any workspace.
 *
 * Runs the SAME pipeline the operator wizard uses:
 *   parseCsv → detectColumnMapping → normalizeCrmRows
 *   → resolveExistingContactForRow + mintContactId
 *   → mergeContactRecords (for existing contacts)
 *   → upsertContactsNeon (JSONB-merging upsert preserves repairs +
 *      enrichment on matched rows)
 *
 * Differs from rebuild-workspace-from-csv: this script NEVER deletes
 * anything. Existing contacts are matched by identity (email > phone >
 * surname+canonical-address) and updated in place. New identities get
 * minted ids and inserted. Workspaces stay isolated via assertWorkspaceSlug.
 *
 * Usage:
 *   npm run import-workspace-csv -- --customer=<slug> --source=<csv> --dry-run
 *   npm run import-workspace-csv -- --customer=<slug> --source=<csv> --write
 *
 * Optional flags:
 *   --source-label=<label>     identifies the CSV in importJobId (default "csv_import")
 *   --skip-likely-duplicates   exclude likely_duplicate rows from the upsert
 *                              (safe_merge rows ALWAYS pass through; that's
 *                              the convergence contract)
 */

import { promises as fs } from "node:fs";
import { parseCsv } from "@/lib/ingestion/csvParser";
import { detectColumnMapping, normalizeCrmRows } from "@/lib/crm-import/normalize";
import {
  findDedupePairs,
  dedupeSummary as buildDedupeSummary,
} from "@/lib/crm-import/dedupe";
import {
  mintContactId,
  resolveExistingContactForRow,
} from "@/lib/crm-import/identityKey";
import { mergeContactRecords } from "@/lib/crm-import/merge";
import {
  rowsEligibleForImport,
  validateImportRows,
} from "@/lib/crm-import/validate";
import { computeImportDiagnostics } from "@/lib/crm-import/diagnostics";
import { computeRelationshipScore } from "@/lib/relationship-intelligence/scoring";
import { scoreMetadataForImport } from "@/lib/crm-import/scoreTransparency";
import {
  listContactsNeon,
  upsertContactsNeon,
} from "@/lib/crm-import/crmContactsNeonAdapter";
import {
  assertWorkspaceSlug,
  getCrmDatabaseUrl,
} from "@/lib/crm-import/storageConfig";
import type {
  CrmContactRecord,
  NormalizedCrmContact,
} from "@/lib/crm-import/types";

interface Args {
  customer: string;
  source: string;
  sourceLabel: string;
  dryRun: boolean;
  write: boolean;
  skipLikelyDuplicates: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let customer = "";
  let source = "";
  let sourceLabel = "csv_import";
  let dryRun = false;
  let write = false;
  let skipLikelyDuplicates = false;
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a.startsWith("--source=")) source = a.slice("--source=".length);
    else if (a.startsWith("--source-label=")) sourceLabel = a.slice("--source-label=".length);
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--write") write = true;
    else if (a === "--skip-likely-duplicates") skipLikelyDuplicates = true;
  }
  if (!customer || !source) {
    console.error("Usage: import-workspace-csv -- --customer=<slug> --source=<csv> [--dry-run | --write] [--source-label=<label>] [--skip-likely-duplicates]");
    process.exit(2);
  }
  if (write && dryRun) {
    console.error("Cannot pass both --dry-run and --write");
    process.exit(2);
  }
  // Default to dry-run when neither flag is supplied (safer for portable use)
  if (!write && !dryRun) dryRun = true;
  return { customer, source, sourceLabel, dryRun, write, skipLikelyDuplicates };
}

interface PlannedRecord {
  record: CrmContactRecord;
  basis: "merge" | "insert" | "csv_duplicate_collapsed";
  matchedExistingId: string | null;
  matchedBy: "email" | "phone" | "name_and_address" | null;
}

function buildPlan(
  normalizedRows: NormalizedCrmContact[],
  existing: ReadonlyArray<CrmContactRecord>,
  workspaceId: string,
  importJobId: string,
  nowIso: string,
  eligibleRowIndexes: Set<number>,
): PlannedRecord[] {
  const plans: PlannedRecord[] = [];
  // First-write-wins for in-CSV duplicates (so the import is byte-stable).
  const writtenIds = new Set<string>();

  for (const row of normalizedRows) {
    if (!eligibleRowIndexes.has(row.rowIndex)) continue;

    const score = computeRelationshipScore({
      lastInteractionAt: row.lastInteractionAt,
      tags: row.tags,
      hasPhone: Boolean(row.normalizedPhone),
      hasEmail: Boolean(row.normalizedEmail),
      notesLength: row.notes?.length ?? 0,
      dataTrust: row.dataTrust,
    });

    const resolution = resolveExistingContactForRow(row, existing);
    const minted = mintContactId(workspaceId, row, { importJobId });
    const targetId = resolution.existing ? resolution.existing.id : minted.id;

    if (writtenIds.has(targetId)) {
      plans.push({
        record: { ...resolution.existing! }, // shape filler; not used by caller for collapsed rows
        basis: "csv_duplicate_collapsed",
        matchedExistingId: resolution.existing?.id ?? null,
        matchedBy: resolution.reason ?? null,
      });
      continue;
    }

    const incoming: CrmContactRecord = {
      id: targetId,
      workspaceId,
      importJobId,
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
      createdAt: resolution.existing ? resolution.existing.createdAt : nowIso,
      updatedAt: nowIso,
    };

    if (resolution.existing) {
      const merged = mergeContactRecords({
        incoming,
        existing: resolution.existing,
      });
      writtenIds.add(targetId);
      plans.push({
        record: merged,
        basis: "merge",
        matchedExistingId: resolution.existing.id,
        matchedBy: resolution.reason,
      });
    } else {
      writtenIds.add(targetId);
      plans.push({
        record: incoming,
        basis: "insert",
        matchedExistingId: null,
        matchedBy: null,
      });
    }
  }
  return plans;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertWorkspaceSlug(args.customer);
  if (!getCrmDatabaseUrl()) {
    console.error("DATABASE_URL / POSTGRES_URL not configured.");
    process.exit(1);
  }

  console.log("");
  console.log(`import-workspace-csv  ${args.customer}`);
  console.log("================");
  console.log(`  mode:        ${args.dryRun ? "DRY-RUN (no writes)" : "LIVE (--write)"}`);
  console.log(`  source:      ${args.source}`);

  // Parse CSV through the canonical importer.
  const text = await fs.readFile(args.source, "utf8");
  const parsed = parseCsv(text);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const mapping = detectColumnMapping(headers);
  const importJobId = `${args.sourceLabel}-${args.customer}-${Date.now().toString(36)}`;
  const normalizedRows = normalizeCrmRows(parsed, mapping, args.sourceLabel);

  console.log(`  CSV rows parsed:    ${parsed.length}`);
  console.log(`  normalized rows:    ${normalizedRows.length}`);

  // Load existing workspace state.
  const existing = await listContactsNeon(args.customer);
  console.log(`  existing contacts:  ${existing.length}`);

  // Mapping summary.
  console.log("");
  console.log("Column mapping:");
  for (const [field, header] of Object.entries(mapping)) {
    console.log(`  ${field.padEnd(16)} ← "${header}"`);
  }

  // Dedupe analysis (identity-first; fuzzy fallback).
  const dedupePairs = findDedupePairs(normalizedRows, existing);
  const dedupe = buildDedupeSummary(dedupePairs, normalizedRows.length);
  const validation = validateImportRows(normalizedRows, dedupePairs);
  const eligible = rowsEligibleForImport(
    normalizedRows,
    validation.blockedRowIndexes,
    args.skipLikelyDuplicates,
    dedupePairs,
  );
  const eligibleIdx = new Set(eligible.map((r) => r.rowIndex));

  // Build plan.
  const nowIso = new Date().toISOString();
  const plans = buildPlan(
    normalizedRows,
    existing,
    args.customer,
    importJobId,
    nowIso,
    eligibleIdx,
  );

  const planInserts = plans.filter((p) => p.basis === "insert");
  const planMerges = plans.filter((p) => p.basis === "merge");
  const planCsvDups = plans.filter((p) => p.basis === "csv_duplicate_collapsed");

  // Diagnostics from the same code the wizard renders.
  const diagnostics = computeImportDiagnostics({ headers, mapping, rows: normalizedRows });

  console.log("");
  console.log("Import quality");
  console.log(`  valid rows:                       ${validation.valid}`);
  console.log(`  rows with warnings:               ${validation.warnings}`);
  console.log(`  rows with validation errors:      ${validation.errors}`);
  console.log(`  split-name detected:              ${diagnostics.detectsSplitName ? "YES" : "no"}`);
  console.log(`  rows assembled from name parts:   ${diagnostics.rowsAssembledFromComponents}`);
  console.log(`  split-address detected:           ${diagnostics.detectsSplitAddress ? "YES" : "no"}`);
  console.log(`  rows assembled from addr parts:   ${diagnostics.rowsAddressAssembledFromComponents}`);
  console.log(`  rows missing surname:             ${diagnostics.rowsMissingSurname}`);
  console.log(`  rows with weak address:           ${diagnostics.rowsWithWeakAddress}`);
  console.log("");
  console.log("Duplicate detection vs. existing workspace");
  console.log(`  safe_merge pairs:                 ${dedupe.safeMerge}`);
  console.log(`  likely_duplicate pairs:           ${dedupe.likelyDuplicate}`);
  console.log(`  manual_review_required pairs:     ${dedupe.manualReview}`);
  console.log(`  truly unique incoming rows:       ${dedupe.unique}`);
  console.log("");
  console.log("Projected outcome");
  console.log(`  rows eligible to apply:           ${eligible.length}`);
  console.log(`  projected INSERTs (new):          ${planInserts.length}`);
  console.log(`  projected UPDATEs (matched):      ${planMerges.length}`);
  console.log(`    matched by email:                 ${planMerges.filter((p) => p.matchedBy === "email").length}`);
  console.log(`    matched by phone:                 ${planMerges.filter((p) => p.matchedBy === "phone").length}`);
  console.log(`    matched by name+address:          ${planMerges.filter((p) => p.matchedBy === "name_and_address").length}`);
  console.log(`  in-CSV duplicates collapsed:      ${planCsvDups.length}`);
  console.log(`  projected workspace size after:   ${existing.length + planInserts.length}`);

  if (planInserts.length > 0) {
    console.log("");
    console.log("Sample inserts (up to 5):");
    for (const p of planInserts.slice(0, 5)) {
      console.log(`  ${p.record.id}  name="${p.record.name}"  email=${JSON.stringify(p.record.email)}`);
    }
  }
  if (planMerges.length > 0) {
    console.log("");
    console.log("Sample merges (up to 5):");
    for (const p of planMerges.slice(0, 5)) {
      console.log(`  ${p.record.id}  [${p.matchedBy}]  name="${p.record.name}"`);
    }
  }

  if (args.dryRun) {
    console.log("");
    console.log("DRY-RUN complete. No writes performed.");
    console.log("To execute the import, re-run with --write.");
    return;
  }

  // ── LIVE PATH ──────────────────────────────────────────────────
  console.log("");
  console.log("LIVE WRITE — applying upserts...");
  const recordsToWrite = plans
    .filter((p) => p.basis !== "csv_duplicate_collapsed")
    .map((p) => p.record);
  const { inserted, updated } = await upsertContactsNeon(recordsToWrite);
  console.log(`  upsertContactsNeon: inserted=${inserted}, updated=${updated}`);

  // Verify post-state count.
  const after = await listContactsNeon(args.customer);
  console.log(`  workspace contacts after import:  ${after.length}`);
  if (after.length !== existing.length + planInserts.length) {
    console.warn(
      `  NOTE: post-import count (${after.length}) differs from projected ` +
        `(${existing.length + planInserts.length}). Investigate via:`,
    );
    console.warn(`    npm run workspace-forensics -- --customer=${args.customer}`);
  }
  console.log("");
  console.log("Import complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
