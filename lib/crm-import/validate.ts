// Meridian CRM import — validation gate before import execution.

import type { DedupePair, NormalizedCrmContact } from "./types";

export type ValidationSummary = {
  valid: number;
  warnings: number;
  errors: number;
  blockedRowIndexes: number[];
};

export function validateImportRows(
  rows: NormalizedCrmContact[],
  dedupePairs: DedupePair[],
): ValidationSummary {
  const blocked = new Set<number>();
  let valid = 0;
  let warnings = 0;
  let errors = 0;

  const dedupeByRow = new Map(dedupePairs.map((p) => [p.incomingRowIndex, p]));

  for (const row of rows) {
    if (row.validationErrors.length > 0) {
      errors += 1;
      blocked.add(row.rowIndex);
      continue;
    }

    const pair = dedupeByRow.get(row.rowIndex);
    if (pair?.verdict === "safe_merge" || pair?.verdict === "likely_duplicate" || pair?.verdict === "manual_review_required") {
      // Duplicates are surfaced, not silently merged — row still importable as new unless operator merges
      warnings += 1;
    }

    if (row.validationWarnings.length > 0) warnings += 1;
    valid += 1;
  }

  return { valid, warnings, errors, blockedRowIndexes: [...blocked] };
}

export function rowsEligibleForImport(
  rows: NormalizedCrmContact[],
  blockedRowIndexes: number[],
  skipDuplicateRows: boolean,
  dedupePairs: DedupePair[],
): NormalizedCrmContact[] {
  const blocked = new Set(blockedRowIndexes);
  // Only "likely_duplicate" rows are filtered out of the import. They
  // need explicit operator review before being merged.
  //
  // "safe_merge" rows MUST flow through to executeImport — that path
  // resolves the existing contact_id and applies field-level merge via
  // mergeContactRecords. Dropping them here would leave the existing
  // (potentially stale) record un-updated, which is the failure mode
  // that caused the WiseAgent re-import not to converge: incoming
  // assembled rows were correctly identified as safe_merge duplicates
  // of pre-fix truncated rows, then SKIPPED, so the truncated rows
  // were never replaced.
  const duplicateRows = skipDuplicateRows
    ? new Set(
        dedupePairs
          .filter((p) => p.verdict === "likely_duplicate")
          .map((p) => p.incomingRowIndex),
      )
    : new Set<number>();

  return rows.filter(
    (row) => !blocked.has(row.rowIndex) && !duplicateRows.has(row.rowIndex),
  );
}
