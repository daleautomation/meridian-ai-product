// Meridian — Public-Record Intelligence Architecture v1, Commit B
//
// Shared preprocessing helpers. Each per-county preprocessor script
// composes from here so all canonical CSVs have an identical shape and
// every preprocessor applies the same address pre-normalization rules.
//
// Canonical CSV columns (in this exact order):
//
//   countyCode            us-mo-jackson, us-ks-johnson, ...
//   parcelId              verbatim county-issued id
//   situsAddress          pre-normalized; canonicalPropertyKey-ready
//   ownerName             verbatim from source
//   mailingAddress        verbatim from source (may be empty)
//   ownershipStartDate    ISO YYYY-MM-DD or empty
//   lastTransferDate      ISO YYYY-MM-DD or empty
//   assessedValue         integer or empty
//   propertyType          single_family | townhouse | ...
//   recordUrl             verbatim (may be empty)
//   sourceName            <jurisdiction>_<authority>_<method>_<period>
//   sourceSnapshotId      stable batch identifier
//   observedAt            ISO-8601 when the source generated this row
//   rawSourceRow          JSON-encoded original CSV row (audit)
//
// Pure module. No I/O — callers read files; we just parse / format.

import { preNormalizeAddress } from "@/lib/enrichment/address/preNormalize";

export const CANONICAL_COLUMNS = [
  "countyCode",
  "parcelId",
  "situsAddress",
  "ownerName",
  "mailingAddress",
  "ownershipStartDate",
  "lastTransferDate",
  "assessedValue",
  "propertyType",
  "recordUrl",
  "sourceName",
  "sourceSnapshotId",
  "observedAt",
  "rawSourceRow",
] as const;

export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];

export interface CanonicalRow {
  countyCode: string;
  parcelId: string;
  situsAddress: string;
  ownerName: string;
  mailingAddress: string;
  ownershipStartDate: string;
  lastTransferDate: string;
  assessedValue: string;
  propertyType: string;
  recordUrl: string;
  sourceName: string;
  sourceSnapshotId: string;
  observedAt: string;
  rawSourceRow: string;
}

export interface PreprocessRejection {
  rowIndex: number;
  code:
    | "missing_parcel_id"
    | "missing_situs_address"
    | "missing_owner_name"
    | "invalid_observed_at"
    | "invalid_date_field"
    | "invalid_assessed_value";
  detail: string;
  raw: Record<string, string>;
}

export interface PreprocessOutput {
  rows: CanonicalRow[];
  rejections: PreprocessRejection[];
  sourceName: string;
  sourceSnapshotId: string;
  observedAt: string;
  countyCode: string;
}

/**
 * Header-tolerant getter — same idea as parsePublicRecordCsv.pick:
 * snake_case / camelCase / TitleCase / "Title Case" all collapse to one
 * canonical key.
 */
export function pickHeader(
  row: Record<string, string | undefined>,
  ...headers: string[]
): string {
  const norm = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    norm.set(k.trim().toLowerCase().replace(/[_\s]+/g, ""), (v ?? "").trim());
  }
  for (const h of headers) {
    const key = h.trim().toLowerCase().replace(/[_\s]+/g, "");
    const v = norm.get(key);
    if (v) return v;
  }
  return "";
}

/**
 * Coerce a date string to ISO-8601 YYYY-MM-DD. Accepts:
 *   "2019-04-15", "04/15/2019", "4/15/2019", "April 15 2019",
 *   "2019-04-15T00:00:00Z" (trims to date)
 * Returns null on unparseable input.
 */
export function coerceIsoDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  // YYYY-MM-DD already.
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // MM/DD/YYYY or M/D/YYYY (US common).
  const m1 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) {
    const mm = m1[1].padStart(2, "0");
    const dd = m1[2].padStart(2, "0");
    return `${m1[3]}-${mm}-${dd}`;
  }
  // YYYY/MM/DD.
  const m2 = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m2) {
    const mm = m2[2].padStart(2, "0");
    const dd = m2[3].padStart(2, "0");
    return `${m2[1]}-${mm}-${dd}`;
  }
  // Date.parse fallback (handles "April 15 2019", "15 Apr 2019", etc.).
  const t = Date.parse(v);
  if (Number.isFinite(t)) {
    return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Coerce an ISO-8601 instant. Accepts a date (YYYY-MM-DD) and rounds
 * to T00:00:00Z; accepts full ISO; returns null on unparseable.
 */
export function coerceIsoInstant(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v}T00:00:00Z`;
  const t = Date.parse(v);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  return null;
}

/**
 * Parse a property-type string to one of the canonical codes. Falls
 * back to empty string when the source did not supply a type or used
 * a value we don't recognize — never invents a type.
 */
export function coercePropertyType(raw: string): string {
  const v = raw.trim().toLowerCase().replace(/\s+/g, "_");
  const allowed = new Set([
    "single_family",
    "townhouse",
    "condominium",
    "multi_family",
    "land",
    "commercial",
    "unknown",
  ]);
  return allowed.has(v) ? v : "";
}

export function coerceAssessedValue(raw: string): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.round(n));
}

/**
 * Build a single canonical row from a source row.
 *
 * `sourceFieldMap` lets each preprocessor declare its source-specific
 * column names. Missing-required-field rejections are returned in
 * `rejections`, not thrown.
 */
export interface BuildCanonicalRowInput {
  sourceRow: Record<string, string>;
  rowIndex: number;
  countyCode: string;
  sourceName: string;
  sourceSnapshotId: string;
  observedAt: string;
  fieldMap: {
    parcelId: readonly string[];
    situsAddress: readonly string[];
    ownerName: readonly string[];
    mailingAddress: readonly string[];
    ownershipStartDate: readonly string[];
    lastTransferDate: readonly string[];
    assessedValue: readonly string[];
    propertyType: readonly string[];
    recordUrl: readonly string[];
  };
}

export type BuildCanonicalRowOutcome =
  | { kind: "row"; row: CanonicalRow }
  | { kind: "rejection"; rejection: PreprocessRejection };

export function buildCanonicalRow(
  input: BuildCanonicalRowInput,
): BuildCanonicalRowOutcome {
  const pick = (...headers: readonly string[]) => pickHeader(input.sourceRow, ...headers);

  const parcelId = pick(...input.fieldMap.parcelId);
  if (!parcelId) {
    return {
      kind: "rejection",
      rejection: {
        rowIndex: input.rowIndex,
        code: "missing_parcel_id",
        detail: `parcelId missing under aliases [${input.fieldMap.parcelId.join(", ")}]`,
        raw: { ...input.sourceRow },
      },
    };
  }

  const situsRaw = pick(...input.fieldMap.situsAddress);
  if (!situsRaw) {
    return {
      kind: "rejection",
      rejection: {
        rowIndex: input.rowIndex,
        code: "missing_situs_address",
        detail: `situsAddress missing under aliases [${input.fieldMap.situsAddress.join(", ")}]`,
        raw: { ...input.sourceRow },
      },
    };
  }
  const situsAddress = preNormalizeAddress(situsRaw);

  const ownerName = pick(...input.fieldMap.ownerName);
  if (!ownerName) {
    return {
      kind: "rejection",
      rejection: {
        rowIndex: input.rowIndex,
        code: "missing_owner_name",
        detail: `ownerName missing under aliases [${input.fieldMap.ownerName.join(", ")}]`,
        raw: { ...input.sourceRow },
      },
    };
  }

  const mailingAddress = pick(...input.fieldMap.mailingAddress);

  const ownershipStartRaw = pick(...input.fieldMap.ownershipStartDate);
  let ownershipStartDate = "";
  if (ownershipStartRaw) {
    const iso = coerceIsoDate(ownershipStartRaw);
    if (!iso) {
      return {
        kind: "rejection",
        rejection: {
          rowIndex: input.rowIndex,
          code: "invalid_date_field",
          detail: `ownershipStartDate not parseable: "${ownershipStartRaw}"`,
          raw: { ...input.sourceRow },
        },
      };
    }
    ownershipStartDate = iso;
  }

  const lastTransferRaw = pick(...input.fieldMap.lastTransferDate);
  let lastTransferDate = "";
  if (lastTransferRaw) {
    const iso = coerceIsoDate(lastTransferRaw);
    if (!iso) {
      return {
        kind: "rejection",
        rejection: {
          rowIndex: input.rowIndex,
          code: "invalid_date_field",
          detail: `lastTransferDate not parseable: "${lastTransferRaw}"`,
          raw: { ...input.sourceRow },
        },
      };
    }
    lastTransferDate = iso;
  }

  const assessedRaw = pick(...input.fieldMap.assessedValue);
  const assessedValue = coerceAssessedValue(assessedRaw);
  if (assessedRaw && !assessedValue) {
    return {
      kind: "rejection",
      rejection: {
        rowIndex: input.rowIndex,
        code: "invalid_assessed_value",
        detail: `assessedValue not parseable: "${assessedRaw}"`,
        raw: { ...input.sourceRow },
      },
    };
  }

  const propertyType = coercePropertyType(pick(...input.fieldMap.propertyType));
  const recordUrl = pick(...input.fieldMap.recordUrl);

  return {
    kind: "row",
    row: {
      countyCode: input.countyCode,
      parcelId,
      situsAddress,
      ownerName,
      mailingAddress,
      ownershipStartDate,
      lastTransferDate,
      assessedValue,
      propertyType,
      recordUrl,
      sourceName: input.sourceName,
      sourceSnapshotId: input.sourceSnapshotId,
      observedAt: input.observedAt,
      rawSourceRow: JSON.stringify(input.sourceRow),
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Minimal CSV reader/writer (handles quoted cells; same naive split
// pattern as parsePublicRecordCsv but kept local so this module has
// zero dependency on the adapter's internals).
// ─────────────────────────────────────────────────────────────────

export function parseCsvToRows(input: string): Array<Record<string, string>> {
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        buf += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out;
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize canonical rows to a CSV string with the agreed column order. */
export function rowsToCanonicalCsv(rows: ReadonlyArray<CanonicalRow>): string {
  const header = CANONICAL_COLUMNS.join(",");
  const body = rows
    .map((r) =>
      CANONICAL_COLUMNS.map((col) => csvEscape(r[col])).join(","),
    )
    .join("\n");
  return body ? `${header}\n${body}\n` : `${header}\n`;
}
