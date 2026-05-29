/**
 * preprocess-manual-csv — founder-stage hand-curated CSV → canonical
 * PublicRecordCsvRow CSV. Used for the first real-world validation
 * dataset (data/raw/manual-parcels/<name>-<date>.csv).
 *
 * Expected source columns (case-insensitive, snake / camel / Title):
 *   countyCode | county_code              REQUIRED
 *   parcelId | parcel_id                  REQUIRED
 *   situsAddress | situs_address          REQUIRED
 *   ownerName | owner_name                REQUIRED
 *   mailingAddress | mailing_address
 *   ownershipStartDate | ownership_start_date
 *   lastTransferDate | last_transfer_date
 *   assessedValue | assessed_value
 *   propertyType | property_type
 *   recordUrl | record_url
 *
 * The founder fills these columns from county parcel-viewer lookups.
 * Per-row countyCode allows mixing JoCo + Jackson MO parcels in one
 * hand-curated CSV (Nicole's book spans both).
 *
 * Usage:
 *   npm run preprocess:manual-csv -- \
 *     --in=data/raw/manual-parcels/nicole-2026-05-27.csv \
 *     [--out=data/raw/canonical/manual-2026-05-27.csv] \
 *     [--observed-at=2026-05-27T00:00:00Z]
 *
 * The CLI is intentionally thin — every row carries its own countyCode
 * and the script generates a sourceName per row from that. No global
 * --county flag.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildCanonicalRow,
  CANONICAL_COLUMNS,
  parseCsvToRows,
  rowsToCanonicalCsv,
  type CanonicalRow,
  type PreprocessRejection,
} from "@/lib/enrichment/public-records/preprocessing/canonicalCsv";

const FIELD_MAP = {
  parcelId: ["parcelId", "parcel_id"],
  situsAddress: ["situsAddress", "situs_address", "propertyAddress", "property_address"],
  ownerName: ["ownerName", "owner_name", "owner"],
  mailingAddress: ["mailingAddress", "mailing_address", "mailAddress"],
  ownershipStartDate: ["ownershipStartDate", "ownership_start_date", "deedDate", "deed_date"],
  lastTransferDate: ["lastTransferDate", "last_transfer_date", "saleDate", "sale_date"],
  assessedValue: ["assessedValue", "assessed_value", "appraisedValue", "appraised_value"],
  propertyType: ["propertyType", "property_type", "landUse", "land_use"],
  recordUrl: ["recordUrl", "record_url"],
} as const;

function parseFlags(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function deriveOutPath(inPath: string, observedDate: string): string {
  const base = path.basename(inPath, path.extname(inPath));
  return path.join("data", "raw", "canonical", `manual-${base}-${observedDate}.csv`);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const inPath = flags.in;
  if (!inPath) {
    console.error("Usage: preprocess:manual-csv -- --in=<path> [--out=<path>] [--observed-at=<iso>]");
    process.exit(2);
  }
  const observedAtRaw = flags["observed-at"] ?? new Date().toISOString();
  const observedAt = observedAtRaw;
  const observedDate = observedAt.slice(0, 10);
  const outPath = flags.out ?? deriveOutPath(inPath, observedDate);

  const text = await fs.readFile(inPath, "utf8");
  const rows = parseCsvToRows(text);

  const canonical: CanonicalRow[] = [];
  const rejections: PreprocessRejection[] = [];
  const perCountyCount: Record<string, number> = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    // Each row carries its own countyCode (manual CSVs may mix counties).
    const countyCodeRaw = (row.countyCode ?? row.county_code ?? "").trim();
    if (!countyCodeRaw) {
      rejections.push({
        rowIndex: i,
        code: "missing_parcel_id",
        detail: "countyCode missing — manual CSV must label each row with a county",
        raw: { ...row },
      });
      continue;
    }
    const countyCode = countyCodeRaw.toLowerCase();
    const sourceName = `${countyCode}_manual_${observedDate}`;
    const sourceSnapshotId = sourceName;
    const result = buildCanonicalRow({
      sourceRow: row,
      rowIndex: i,
      countyCode,
      sourceName,
      sourceSnapshotId,
      observedAt,
      fieldMap: FIELD_MAP,
    });
    if (result.kind === "rejection") {
      rejections.push(result.rejection);
      continue;
    }
    canonical.push(result.row);
    perCountyCount[countyCode] = (perCountyCount[countyCode] ?? 0) + 1;
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, rowsToCanonicalCsv(canonical), "utf8");

  console.log("preprocess-manual-csv complete", {
    in: inPath,
    out: outPath,
    observedAt,
    rowsAdmitted: canonical.length,
    rowsRejected: rejections.length,
    perCounty: perCountyCount,
    canonicalColumns: CANONICAL_COLUMNS,
  });
  if (rejections.length > 0) {
    console.log("rejections:");
    for (const r of rejections) {
      console.log(`  row ${r.rowIndex}: ${r.code} — ${r.detail}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
