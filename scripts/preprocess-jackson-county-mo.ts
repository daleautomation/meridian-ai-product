/**
 * preprocess-jackson-county-mo — Jackson County MO Assessment /
 * Recorder of Deeds export → canonical PublicRecordCsvRow CSV.
 *
 * Expected source columns vary by export. Header-tolerant aliases:
 *
 *   parcelId            parcel_number | ParcelNumber | PARCEL_ID | APN
 *   situsAddress        property_address | PROPERTY_ADDRESS | situs_address
 *   ownerName           owner | owner_name | OWNER | OWNER_NAME
 *   mailingAddress      mail_address | mailing_address | MAIL_ADDR
 *   ownershipStartDate  deed_date | recording_date | DEED_DATE
 *   lastTransferDate    sale_date | transfer_date | TRANSFER_DATE
 *   assessedValue       assessed_value | total_value | TOT_ASSD_VAL
 *   propertyType        property_class | land_use | LAND_USE
 *
 * Hard-coded:
 *   countyCode          us-mo-jackson
 *   sourceName          us-mo-jackson_assessment_<period>
 *
 * Usage:
 *   npm run preprocess:jackson-mo -- \
 *     --in=data/raw/jackson-county-mo/sunshine-2026-06.csv \
 *     --period=2026-06 \
 *     [--out=...] [--observed-at=<iso>]
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

const COUNTY_CODE = "us-mo-jackson";

const FIELD_MAP = {
  parcelId: [
    "parcelId",
    "parcel_id",
    "parcel_number",
    "ParcelNumber",
    "PARCEL_ID",
    "PARCEL_NUMBER",
    "APN",
  ],
  situsAddress: [
    "situsAddress",
    "situs_address",
    "property_address",
    "PropertyAddress",
    "PROPERTY_ADDRESS",
    "SITUS",
  ],
  ownerName: [
    "ownerName",
    "owner_name",
    "Owner",
    "OWNER",
    "OWNER_NAME",
    "owner",
  ],
  mailingAddress: [
    "mailingAddress",
    "mailing_address",
    "mail_address",
    "MAIL_ADDR",
    "MailingAddress",
    "MailAddr1",
  ],
  ownershipStartDate: [
    "ownershipStartDate",
    "ownership_start_date",
    "deed_date",
    "DEED_DATE",
    "recording_date",
    "RECORDING_DATE",
  ],
  lastTransferDate: [
    "lastTransferDate",
    "last_transfer_date",
    "sale_date",
    "SALE_DATE",
    "transfer_date",
    "TRANSFER_DATE",
  ],
  assessedValue: [
    "assessedValue",
    "assessed_value",
    "total_value",
    "TOT_ASSD_VAL",
    "TOTAL_VALUE",
    "AssessedValue",
  ],
  propertyType: [
    "propertyType",
    "property_type",
    "property_class",
    "PROPERTY_CLASS",
    "land_use",
    "LAND_USE",
  ],
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

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const inPath = flags.in;
  const period = flags.period;
  if (!inPath || !period) {
    console.error(
      "Usage: preprocess:jackson-mo -- --in=<path> --period=<YYYY-MM> [--out=<path>] [--observed-at=<iso>]",
    );
    process.exit(2);
  }
  const observedAt = flags["observed-at"] ?? `${period}-01T00:00:00Z`;
  const sourceName = `${COUNTY_CODE}_assessment_${period}`;
  const sourceSnapshotId = sourceName;
  const outPath =
    flags.out ?? path.join("data", "raw", "canonical", `${sourceName}.csv`);

  const text = await fs.readFile(inPath, "utf8");
  const rows = parseCsvToRows(text);

  const canonical: CanonicalRow[] = [];
  const rejections: PreprocessRejection[] = [];

  for (let i = 0; i < rows.length; i++) {
    const result = buildCanonicalRow({
      sourceRow: rows[i],
      rowIndex: i,
      countyCode: COUNTY_CODE,
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
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, rowsToCanonicalCsv(canonical), "utf8");

  console.log("preprocess-jackson-county-mo complete", {
    in: inPath,
    out: outPath,
    countyCode: COUNTY_CODE,
    sourceName,
    period,
    observedAt,
    rowsAdmitted: canonical.length,
    rowsRejected: rejections.length,
    canonicalColumns: CANONICAL_COLUMNS,
  });
  if (rejections.length > 0) {
    console.log("rejections:");
    for (const r of rejections.slice(0, 20)) {
      console.log(`  row ${r.rowIndex}: ${r.code} — ${r.detail}`);
    }
    if (rejections.length > 20) {
      console.log(`  ... ${rejections.length - 20} more rejections (truncated)`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
