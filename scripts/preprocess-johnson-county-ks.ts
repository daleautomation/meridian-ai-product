/**
 * preprocess-johnson-county-ks — Johnson County KS appraiser export →
 * canonical PublicRecordCsvRow CSV.
 *
 * Expected source columns vary by export format. The header-tolerant
 * pickHeader() accepts these common aliases:
 *
 *   parcelId            ParcelID | QPID | parcel_id | KIS_ID
 *   situsAddress        SitusAddress | PropertyAddress | situs_address
 *   ownerName           Owner | OwnerName | owner_name | OWNER
 *   mailingAddress      MailAddress | MailingAddress | mail_address
 *   ownershipStartDate  DeedDate | OwnershipDate | deed_date
 *   lastTransferDate    SaleDate | LastSaleDate | sale_date | TransferDate
 *   assessedValue       AppraisedValue | AssessedValue | TOTAL_VALUE
 *   propertyType        PropertyClass | LandUse | property_type
 *
 * Hard-coded:
 *   countyCode          us-ks-johnson
 *   sourceName          us-ks-johnson_aims_<period>
 *
 * Usage:
 *   npm run preprocess:johnson-ks -- \
 *     --in=data/raw/johnson-county-ks/2026-05.csv \
 *     --period=2026-05 \
 *     [--out=...] [--observed-at=<iso>]
 *
 * --period is required so the snapshot batch id is stable across re-runs.
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

const COUNTY_CODE = "us-ks-johnson";

const FIELD_MAP = {
  parcelId: ["parcelId", "parcel_id", "ParcelID", "QPID", "KIS_ID", "parcel"],
  situsAddress: [
    "situsAddress",
    "situs_address",
    "SitusAddress",
    "PropertyAddress",
    "property_address",
  ],
  ownerName: ["ownerName", "owner_name", "Owner", "OwnerName", "OWNER"],
  mailingAddress: [
    "mailingAddress",
    "mailing_address",
    "MailAddress",
    "MailingAddress",
    "mail_address",
    "MailAddr1",
  ],
  ownershipStartDate: [
    "ownershipStartDate",
    "ownership_start_date",
    "DeedDate",
    "OwnershipDate",
    "deed_date",
  ],
  lastTransferDate: [
    "lastTransferDate",
    "last_transfer_date",
    "SaleDate",
    "LastSaleDate",
    "sale_date",
    "TransferDate",
  ],
  assessedValue: [
    "assessedValue",
    "assessed_value",
    "AppraisedValue",
    "AssessedValue",
    "TotalValue",
    "TOTAL_VALUE",
  ],
  propertyType: ["propertyType", "property_type", "PropertyClass", "LandUse", "LandUseDesc"],
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
      "Usage: preprocess:johnson-ks -- --in=<path> --period=<YYYY-MM> [--out=<path>] [--observed-at=<iso>]",
    );
    process.exit(2);
  }
  const observedAt = flags["observed-at"] ?? `${period}-01T00:00:00Z`;
  const sourceName = `${COUNTY_CODE}_aims_${period}`;
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

  console.log("preprocess-johnson-county-ks complete", {
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
