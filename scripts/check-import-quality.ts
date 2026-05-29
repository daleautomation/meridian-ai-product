/**
 * check-import-quality — operational dry-run that simulates a CRM
 * import end-to-end without persisting any data.
 *
 * Reports what the import pipeline WOULD produce:
 *   • rows parsed
 *   • valid rows (no validation errors)
 *   • full-name assembled count (rows whose name came from First+Last)
 *   • full-address assembled count
 *   • missing surname count
 *   • weak address count
 *   • duplicate candidates (against the live workspace)
 *   • safe-merge count (exact identity match)
 *   • likely-duplicate / manual-review count
 *   • projected inserts (genuinely new contacts)
 *   • projected updates (matched-by-identity contacts)
 *   • projected ACTIVE contact count after import
 *
 * Defaults to dry-run. The script does NOT support --write — actual
 * imports go through the canonical /api/crm-import/preview +
 * /api/crm-import/execute endpoints.
 *
 * Usage:
 *   npm run check-import-quality -- \
 *     --file=/path/to/wise-agent-export.csv \
 *     --customer=nicole-lonergan
 */

import { promises as fs } from "node:fs";
import { parseCsv } from "@/lib/ingestion/csvParser";
import { computeImportDiagnostics } from "@/lib/crm-import/diagnostics";
import {
  buildMergeRecommendations,
  dedupeSummary,
  findDedupePairs,
} from "@/lib/crm-import/dedupe";
import {
  detectColumnMapping,
  normalizeCrmRows,
} from "@/lib/crm-import/normalize";
import { resolveExistingContactForRow } from "@/lib/crm-import/identityKey";
import { listContactsByWorkspace } from "@/lib/crm-import/store";
import { validateImportRows, rowsEligibleForImport } from "@/lib/crm-import/validate";
import { getCrmDatabaseUrl, assertWorkspaceSlug } from "@/lib/crm-import/storageConfig";

interface Args {
  file: string;
  customer: string;
}

function parseArgs(argv: readonly string[]): Args {
  let file = "";
  let customer = "";
  for (const a of argv) {
    if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
  }
  if (!file || !customer) {
    console.error("Usage: check-import-quality -- --file=<csv> --customer=<workspace-slug>");
    process.exit(2);
  }
  return { file, customer };
}

function bar(n: number, total: number, width = 28): string {
  if (total === 0) return " ".repeat(width);
  const filled = Math.round((n / total) * width);
  return "█".repeat(Math.max(0, filled)) + "·".repeat(Math.max(0, width - filled));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertWorkspaceSlug(args.customer);

  const text = await fs.readFile(args.file, "utf8");
  const parsed = parseCsv(text);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const mapping = detectColumnMapping(headers);
  const rows = normalizeCrmRows(parsed, mapping, "wise_agent");
  const diagnostics = computeImportDiagnostics({ headers, mapping, rows });

  // Load existing workspace contacts to check duplicate state. If no
  // DATABASE_URL is set, surface the limitation honestly.
  let existing: Awaited<ReturnType<typeof listContactsByWorkspace>> = [];
  let existingLoadError: string | null = null;
  if (!getCrmDatabaseUrl()) {
    existingLoadError = "DATABASE_URL not set — duplicate detection against the live workspace is skipped";
  } else {
    try {
      existing = await listContactsByWorkspace(args.customer);
    } catch (err) {
      existingLoadError = err instanceof Error ? err.message : String(err);
    }
  }

  const dedupePairs = findDedupePairs(rows, existing);
  const dedupeSum = dedupeSummary(dedupePairs, rows.length);
  const mergeRecs = buildMergeRecommendations(dedupePairs);
  const validation = validateImportRows(rows, dedupePairs);
  const eligible = rowsEligibleForImport(
    rows,
    validation.blockedRowIndexes,
    true,
    dedupePairs,
  );

  // Projected insert vs update for the eligible rows. Identity match
  // → update; no match → insert. The actual upsert applies the same
  // resolution at execute time.
  let projectedInserts = 0;
  let projectedUpdates = 0;
  for (const row of eligible) {
    const resolution = resolveExistingContactForRow(row, existing);
    if (resolution.existing) projectedUpdates += 1;
    else projectedInserts += 1;
  }

  // ── Report ─────────────────────────────────────────────────────
  console.log("");
  console.log(`check-import-quality  ${args.customer}`);
  console.log(`file: ${args.file}`);
  console.log("================");
  console.log(`  rows parsed:                    ${rows.length}`);
  console.log(`  valid rows:                     ${validation.valid}`);
  console.log(`  rows with warnings:             ${validation.warnings}`);
  console.log(`  rows with errors:               ${validation.errors}`);
  console.log("");

  console.log("Column mapping");
  for (const [field, header] of Object.entries(mapping)) {
    console.log(`  ${field.padEnd(16)} ← "${header}"`);
  }
  console.log("");

  console.log("Assembly diagnostics");
  console.log(`  split-name detected:            ${diagnostics.detectsSplitName ? "YES" : "no"}`);
  console.log(`  rows assembled from name parts: ${diagnostics.rowsAssembledFromComponents}`);
  console.log(`  split-address detected:         ${diagnostics.detectsSplitAddress ? "YES" : "no"}`);
  console.log(`  rows assembled from addr parts: ${diagnostics.rowsAddressAssembledFromComponents}`);
  console.log(`  rows missing surname:           ${diagnostics.rowsMissingSurname}  ${bar(diagnostics.rowsMissingSurname, rows.length)}`);
  console.log(`  rows with weak address:         ${diagnostics.rowsWithWeakAddress}  ${bar(diagnostics.rowsWithWeakAddress, rows.length)}`);
  if (diagnostics.assemblySamples.length > 0) {
    console.log("  sample assembled rows:");
    for (const s of diagnostics.assemblySamples) {
      console.log(`    "${s.fromName}"  ←  "${s.fromAddress}"`);
    }
  }
  console.log("");

  console.log("Reachability");
  console.log(`  missing phone:                  ${diagnostics.rowsMissingPhone}  ${bar(diagnostics.rowsMissingPhone, rows.length)}`);
  console.log(`  missing email:                  ${diagnostics.rowsMissingEmail}  ${bar(diagnostics.rowsMissingEmail, rows.length)}`);
  console.log(`  missing both phone + email:     ${diagnostics.rowsMissingBoth}`);
  console.log("");

  console.log("Duplicate detection vs. live workspace");
  if (existingLoadError) {
    console.log(`  status: ${existingLoadError}`);
  } else {
    console.log(`  workspace contacts loaded:      ${existing.length}`);
    console.log(`  duplicate candidates:           ${dedupePairs.length}`);
    console.log(`    safe_merge (exact identity)   ${dedupeSum.safeMerge}`);
    console.log(`    likely_duplicate              ${dedupeSum.likelyDuplicate}`);
    console.log(`    manual_review_required        ${dedupeSum.manualReview}`);
    console.log(`  truly unique rows:              ${dedupeSum.unique}`);
    if (mergeRecs.length > 0) {
      console.log("  sample merge recommendations:");
      for (const m of mergeRecs.slice(0, 5)) {
        console.log(`    pair=${m.pairId}  verdict=${m.verdict}  action=${m.suggestedAction}`);
      }
      if (mergeRecs.length > 5) {
        console.log(`    ... ${mergeRecs.length - 5} more`);
      }
    }
  }
  console.log("");

  console.log("Projected outcome (DRY-RUN — no writes)");
  console.log(`  eligible rows to apply:         ${eligible.length}`);
  console.log(`  projected INSERTs (new):        ${projectedInserts}`);
  console.log(`  projected UPDATEs (matched):    ${projectedUpdates}`);
  if (existing.length > 0 || projectedInserts > 0) {
    const projectedTotal = existing.length + projectedInserts;
    console.log(`  projected active count after:   ${projectedTotal}`);
  }
  console.log("");

  console.log("This is a dry-run. No data was written.");
  console.log("Run the actual import via the operator UI or:");
  console.log("  POST /api/crm-import/preview  (returns jobId)");
  console.log("  POST /api/crm-import/execute  (with that jobId)");
  console.log("");

  if (diagnostics.detectsSplitName && diagnostics.rowsAssembledFromComponents === 0) {
    console.log("⚠ WARNING: split-name CSV detected but zero rows assembled. The mapping");
    console.log("           may be incorrect, or the rows lack First/Last values.");
  }
  if (diagnostics.detectsSplitAddress && diagnostics.rowsAddressAssembledFromComponents === 0) {
    console.log("⚠ WARNING: split-address CSV detected but zero rows assembled. The");
    console.log("           mapping may be incorrect, or the rows lack city/state/zip.");
  }
  if (diagnostics.rowsMissingSurname / Math.max(1, rows.length) > 0.2) {
    console.log("⚠ WARNING: >20% of rows lack a surname. Parcel grounding will be limited");
    console.log("           on those rows. Verify your CSV exposes First Name + Last Name.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
