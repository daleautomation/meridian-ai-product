/**
 * ingest-public-records — read a canonical CSV (produced by a
 * preprocess-* script) and write to the canonical Neon substrate.
 *
 * Pipeline:
 *   1. Read canonical CSV
 *   2. For each row:
 *      a. Normalize address + compute canonicalPropertyKey
 *      b. upsertPublicParcel(...)
 *      c. appendOwnershipSnapshot(...)
 *   3. Emit ingest summary + rejection summary
 *
 * Mode:
 *   default = dry-run (no writes; prints what would happen)
 *   --write = persist via Neon adapter
 *
 * Idempotent: re-running with the same canonical CSV produces zero
 * new rows (deterministic IDs + ON CONFLICT DO NOTHING in adapter).
 *
 * NOT touched by this script:
 *   • opportunity scoring
 *   • workspace contact-parcel links
 *   • /personal rendering
 *   • opener builder
 *
 * Usage:
 *   npm run ingest-public-records -- --in=data/raw/canonical/<name>.csv
 *   npm run ingest-public-records -- --in=... --write
 */

import { promises as fs } from "node:fs";
import {
  canonicalPropertyKey,
  normalizeAddress,
  detectWeakAddress,
} from "@/lib/enrichment/address";
import {
  parseCsvToRows,
  CANONICAL_COLUMNS,
  type CanonicalColumn,
} from "@/lib/enrichment/public-records/preprocessing/canonicalCsv";
import {
  appendOwnershipSnapshot,
  upsertPublicParcel,
} from "@/lib/enrichment/public-records/canonicalStorage/neonAdapter";
import { ensurePublicRecordsSchema } from "@/lib/enrichment/public-records/canonicalStorage/initSchema";
import type {
  CanonicalPropertyType,
  OwnershipSnapshotAppendResult,
  ParcelUpsertResult,
} from "@/lib/enrichment/public-records/canonicalStorage/types";
import { getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";

const PROPERTY_TYPE_VALUES = new Set<CanonicalPropertyType>([
  "single_family",
  "townhouse",
  "condominium",
  "multi_family",
  "land",
  "commercial",
  "unknown",
]);

interface IngestRow {
  rowIndex: number;
  countyCode: string;
  parcelId: string;
  situsAddress: string;
  propertyKey: string;
  ownerName: string;
  mailingAddress: string | null;
  ownershipStartDate: string | null;
  lastTransferDate: string | null;
  assessedValue: number | null;
  propertyType: CanonicalPropertyType | null;
  sourceName: string;
  sourceSnapshotId: string;
  observedAt: string;
  rawSourceRow: Record<string, string>;
}

interface IngestRejection {
  rowIndex: number;
  code:
    | "missing_county_code"
    | "missing_parcel_id"
    | "missing_situs_address"
    | "missing_owner_name"
    | "missing_source"
    | "missing_observed_at"
    | "weak_address"
    | "invalid_raw_source_row"
    | "invalid_assessed_value";
  detail: string;
  raw: Record<string, string>;
}

function parseFlags(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      out[arg.slice(2)] = true;
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return out;
}

function nonEmpty(s: string | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
}

function parsePropertyType(s: string): CanonicalPropertyType | null {
  const v = s.trim();
  if (!v) return null;
  if (PROPERTY_TYPE_VALUES.has(v as CanonicalPropertyType)) {
    return v as CanonicalPropertyType;
  }
  return null;
}

function parseRow(row: Record<string, string>, rowIndex: number):
  | { kind: "row"; row: IngestRow }
  | { kind: "rejection"; rejection: IngestRejection }
{
  const get = (col: CanonicalColumn) => (row[col] ?? "").trim();

  const countyCode = get("countyCode");
  if (!countyCode) {
    return {
      kind: "rejection",
      rejection: { rowIndex, code: "missing_county_code", detail: "countyCode empty", raw: { ...row } },
    };
  }
  const parcelId = get("parcelId");
  if (!parcelId) {
    return {
      kind: "rejection",
      rejection: { rowIndex, code: "missing_parcel_id", detail: "parcelId empty", raw: { ...row } },
    };
  }
  const situsAddress = get("situsAddress");
  if (!situsAddress) {
    return {
      kind: "rejection",
      rejection: { rowIndex, code: "missing_situs_address", detail: "situsAddress empty", raw: { ...row } },
    };
  }
  const ownerName = get("ownerName");
  if (!ownerName) {
    return {
      kind: "rejection",
      rejection: { rowIndex, code: "missing_owner_name", detail: "ownerName empty", raw: { ...row } },
    };
  }
  const sourceName = get("sourceName");
  if (!sourceName) {
    return {
      kind: "rejection",
      rejection: { rowIndex, code: "missing_source", detail: "sourceName empty", raw: { ...row } },
    };
  }
  const sourceSnapshotId = get("sourceSnapshotId") || sourceName;
  const observedAt = get("observedAt");
  if (!observedAt) {
    return {
      kind: "rejection",
      rejection: { rowIndex, code: "missing_observed_at", detail: "observedAt empty", raw: { ...row } },
    };
  }

  // Canonical address — strict normalization, then canonicalPropertyKey.
  // (Each source's preprocessor already pre-normalized via
  // preNormalizeAddress; this step is the final canonicalization.)
  const normalized = normalizeAddress(situsAddress);
  const weak = detectWeakAddress(normalized);
  if (weak) {
    return {
      kind: "rejection",
      rejection: {
        rowIndex,
        code: "weak_address",
        detail: `${weak.code}: ${weak.detail}`,
        raw: { ...row },
      },
    };
  }
  const propertyKey = canonicalPropertyKey(normalized);

  // rawSourceRow — JSON-encoded by the preprocessor.
  const rawJson = get("rawSourceRow");
  let rawSourceRow: Record<string, string> = {};
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          rawSourceRow[k] = typeof v === "string" ? v : String(v ?? "");
        }
      }
    } catch {
      return {
        kind: "rejection",
        rejection: {
          rowIndex,
          code: "invalid_raw_source_row",
          detail: "rawSourceRow column was not valid JSON",
          raw: { ...row },
        },
      };
    }
  }

  // assessedValue numeric coercion.
  let assessedValue: number | null = null;
  const assessedRaw = get("assessedValue");
  if (assessedRaw) {
    const n = Number.parseFloat(assessedRaw.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      return {
        kind: "rejection",
        rejection: {
          rowIndex,
          code: "invalid_assessed_value",
          detail: `assessedValue not numeric: "${assessedRaw}"`,
          raw: { ...row },
        },
      };
    }
    assessedValue = Math.round(n);
  }

  return {
    kind: "row",
    row: {
      rowIndex,
      countyCode: countyCode.toLowerCase(),
      parcelId,
      situsAddress: normalized.line1
        + (normalized.line2 ? ` ${normalized.line2}` : "")
        + (normalized.city ? `, ${normalized.city}` : "")
        + (normalized.state ? `, ${normalized.state}` : "")
        + (normalized.postalCode ? ` ${normalized.postalCode}` : ""),
      propertyKey,
      ownerName,
      mailingAddress: nonEmpty(get("mailingAddress")),
      ownershipStartDate: nonEmpty(get("ownershipStartDate")),
      lastTransferDate: nonEmpty(get("lastTransferDate")),
      assessedValue,
      propertyType: parsePropertyType(get("propertyType")),
      sourceName,
      sourceSnapshotId,
      observedAt,
      rawSourceRow,
    },
  };
}

interface RunSummary {
  parsedRows: number;
  rowsAdmitted: number;
  rowsRejected: number;
  rejectionsByCode: Record<string, number>;
  parcelInserts: number;
  parcelUpdates: number;
  parcelNoops: number;
  snapshotInserts: number;
  snapshotNoops: number;
  perCounty: Record<string, number>;
  perSource: Record<string, number>;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const inPath = typeof flags.in === "string" ? flags.in : null;
  const isWrite = flags.write === true;

  if (!inPath) {
    console.error("Usage: ingest-public-records -- --in=<canonical.csv> [--write]");
    process.exit(2);
  }

  const text = await fs.readFile(inPath, "utf8");
  const rawRows = parseCsvToRows(text);

  // Header sanity check — canonical CSV must include every column.
  if (rawRows.length > 0) {
    const present = new Set(Object.keys(rawRows[0]));
    const missing = CANONICAL_COLUMNS.filter((c) => !present.has(c));
    if (missing.length > 0) {
      console.error("Canonical CSV missing required columns:", missing);
      console.error("Found columns:", Array.from(present));
      console.error("Run a preprocess-* script first.");
      process.exit(2);
    }
  }

  const admitted: IngestRow[] = [];
  const rejections: IngestRejection[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const result = parseRow(rawRows[i], i);
    if (result.kind === "rejection") rejections.push(result.rejection);
    else admitted.push(result.row);
  }

  const summary: RunSummary = {
    parsedRows: rawRows.length,
    rowsAdmitted: admitted.length,
    rowsRejected: rejections.length,
    rejectionsByCode: {},
    parcelInserts: 0,
    parcelUpdates: 0,
    parcelNoops: 0,
    snapshotInserts: 0,
    snapshotNoops: 0,
    perCounty: {},
    perSource: {},
  };
  for (const r of rejections) {
    summary.rejectionsByCode[r.code] = (summary.rejectionsByCode[r.code] ?? 0) + 1;
  }
  for (const row of admitted) {
    summary.perCounty[row.countyCode] = (summary.perCounty[row.countyCode] ?? 0) + 1;
    summary.perSource[row.sourceName] = (summary.perSource[row.sourceName] ?? 0) + 1;
  }

  if (!isWrite) {
    console.log("ingest-public-records DRY-RUN", {
      in: inPath,
      ...summary,
      mode: "dry-run",
      hint: "Pass --write to persist to Neon.",
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
    return;
  }

  // ── Live write path ─────────────────────────────────────────────
  if (!getCrmDatabaseUrl()) {
    console.error("Set DATABASE_URL or POSTGRES_URL before --write");
    process.exit(1);
  }
  await ensurePublicRecordsSchema();

  for (const row of admitted) {
    const parcelResult: ParcelUpsertResult = await upsertPublicParcel({
      countyCode: row.countyCode,
      sourceParcelId: row.parcelId,
      propertyKey: row.propertyKey,
      situsAddress: row.situsAddress,
      estimatedPropertyType: row.propertyType,
      observedAt: row.observedAt,
    });
    if (parcelResult.outcome === "inserted") summary.parcelInserts += 1;
    else if (parcelResult.outcome === "updated") summary.parcelUpdates += 1;
    else summary.parcelNoops += 1;

    const snapResult: OwnershipSnapshotAppendResult = await appendOwnershipSnapshot({
      parcelId: parcelResult.id,
      ownerName: row.ownerName,
      mailingAddress: row.mailingAddress,
      ownershipStartDate: row.ownershipStartDate,
      lastTransferDate: row.lastTransferDate,
      assessedValue: row.assessedValue,
      source: row.sourceName,
      sourceSnapshotId: row.sourceSnapshotId,
      observedAt: row.observedAt,
      rawSourceRow: row.rawSourceRow,
    });
    if (snapResult.outcome === "inserted") summary.snapshotInserts += 1;
    else summary.snapshotNoops += 1;
  }

  console.log("ingest-public-records complete", {
    in: inPath,
    mode: "write",
    ...summary,
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
