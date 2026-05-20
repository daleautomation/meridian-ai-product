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
  const duplicateRows = skipDuplicateRows
    ? new Set(
        dedupePairs
          .filter((p) => p.verdict === "safe_merge" || p.verdict === "likely_duplicate")
          .map((p) => p.incomingRowIndex),
      )
    : new Set<number>();

  return rows.filter(
    (row) => !blocked.has(row.rowIndex) && !duplicateRows.has(row.rowIndex),
  );
}
