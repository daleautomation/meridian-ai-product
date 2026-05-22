// Meridian — Brookside public-record ingestion: CSV → PublicRecord[].
//
// Pure, deterministic adapter. Accepts either a parsed array of rows or a
// raw CSV string. Produces an ingest result with admitted records, typed
// rejections, and the set of source names observed.
//
// Rules enforced here (with rejection codes):
//   • missing_source     — no sourceName
//   • missing_observed_at — no observedAt
//   • invalid_date       — observedAt not ISO-8601
//   • missing_identifier — no parcelId AND no recordUrl
//   • weak_address       — situsAddress not parseable to a strong address
// No signal generation happens here — that is the brief generator's job
// via `combineEnrichmentWithPublicRecord`.

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import type {
  EstimatedPropertyType,
  FieldProvenance,
  OwnershipRecord,
  PropertyRecord,
} from "@/lib/enrichment/property/types";

import {
  cleanString,
  parseIsoDate,
  requirePublicRecordProvenance,
} from "./provenance";
import type {
  PublicRecord,
  PublicRecordAssessedValue,
  PublicRecordCsvRow,
  PublicRecordIngestResult,
  PublicRecordRejection,
} from "./types";

/**
 * Adapter input shape: a header-keyed map of strings. Values may be
 * undefined / missing so a `PublicRecordCsvRow` (all-optional) can be
 * passed directly without coercion.
 */
type RawRow = Record<string, string | undefined>;

const SUPPORTED_PROPERTY_TYPES: EstimatedPropertyType[] = [
  "single_family",
  "condo",
  "townhouse",
  "multi_family",
  "unknown",
];

function pick(row: RawRow, ...headers: string[]): string {
  // Case-insensitive lookup so CSVs from different counties can use snake_case,
  // camelCase, or Title Case headers without breaking the adapter.
  const norm = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    norm.set(k.trim().toLowerCase().replace(/[_\s]+/g, ""), (v ?? "").trim());
  }
  for (const h of headers) {
    const key = h.toLowerCase().replace(/[_\s]+/g, "");
    const v = norm.get(key);
    if (v) return v;
  }
  return "";
}

function asCanonicalRow(raw: RawRow): PublicRecordCsvRow {
  return {
    parcelId: pick(raw, "parcelId", "parcel_id"),
    situsAddress: pick(raw, "situsAddress", "situs_address", "propertyAddress"),
    ownerName: pick(raw, "ownerName", "owner_name"),
    mailingAddress: pick(raw, "mailingAddress", "mailing_address"),
    lastTransferDate: pick(raw, "lastTransferDate", "last_transfer_date"),
    ownershipStartDate: pick(raw, "ownershipStartDate", "ownership_start_date"),
    assessedValue: pick(raw, "assessedValue", "assessed_value"),
    propertyType: pick(raw, "propertyType", "property_type"),
    recordUrl: pick(raw, "recordUrl", "record_url"),
    sourceName: pick(raw, "sourceName", "source_name"),
    observedAt: pick(raw, "observedAt", "observed_at"),
  };
}

function parsePropertyType(value: string | null | undefined): EstimatedPropertyType {
  if (!value) return "unknown";
  const norm = value.trim().toLowerCase().replace(/\s+/g, "_");
  return (SUPPORTED_PROPERTY_TYPES as readonly string[]).includes(norm)
    ? (norm as EstimatedPropertyType)
    : "unknown";
}

function parseAssessedValue(
  raw: string,
  observedAtIso: string,
  recordId: string,
  source: string,
  recordUrl: string | null,
): PublicRecordAssessedValue | null {
  if (!raw) return null;
  // Strip $ and commas; only finite positive numbers admitted.
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return {
    value: n,
    observedAt: observedAtIso,
    recordId: `assess:${recordId}`,
    source,
    evidenceUrl: recordUrl,
  };
}

function buildPropertyRecord(
  canonical: PublicRecordCsvRow,
  rowIndex: number,
): PropertyRecord | { rejection: PublicRecordRejection } {
  const situs = cleanString(canonical.situsAddress);
  if (!situs) {
    return {
      rejection: {
        rowIndex,
        code: "weak_address",
        detail: "situsAddress missing or empty",
        row: canonical,
      },
    };
  }
  const normalized = normalizeAddress(situs);
  const weak = detectWeakAddress(normalized);
  if (weak) {
    return {
      rejection: {
        rowIndex,
        code: "weak_address",
        detail: `situsAddress weak: ${weak.code} (${weak.detail})`,
        row: canonical,
      },
    };
  }
  const propertyKey = canonicalPropertyKey(normalized);
  return {
    propertyKey,
    normalizedAddress: normalized,
    parcelId: cleanString(canonical.parcelId) ?? null,
    // Caller fills `provenance`.
    provenance: {
      source: "",
      recordId: "",
      observedAt: "",
      confidence: "HIGH",
      evidenceUrl: null,
      evidenceLabel: null,
    },
  };
}

function buildOwnership(
  canonical: PublicRecordCsvRow,
  property: PropertyRecord,
  prov: FieldProvenance,
): OwnershipRecord | null {
  const startRaw = cleanString(canonical.ownershipStartDate);
  if (!startRaw) return null;
  const startIso = parseIsoDate(startRaw);
  // Per rules: ownership duration cannot be calculated without a valid date.
  // An unparseable date is treated as "no ownership record" — silent skip.
  if (!startIso) return null;

  const lastTransferIso = parseIsoDate(canonical.lastTransferDate);
  const ownerName = cleanString(canonical.ownerName);

  // ownershipDurationYears is computed at signal-build time against `now`;
  // the adapter stores only the verified start date.
  return {
    propertyKey: property.propertyKey,
    ownerName,
    ownershipStartDate: startIso,
    ownershipDurationYears: null,
    lastTransferDate: lastTransferIso,
    estimatedPropertyType: parsePropertyType(canonical.propertyType),
    estimatedOccupancy: "unknown",
    provenance: prov,
  };
}

/**
 * Parse an already-row-decomposed batch into PublicRecord[] + rejections.
 * The adapter does no I/O — pass in the rows.
 */
export function parsePublicRecordRows(
  rows: readonly RawRow[],
): PublicRecordIngestResult {
  const records: PublicRecord[] = [];
  const rejections: PublicRecordRejection[] = [];
  const sources = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const canonical = asCanonicalRow(rows[i] ?? {});
    const prov = requirePublicRecordProvenance(canonical);
    if (!prov.ok) {
      rejections.push({ rowIndex: i, code: prov.code, detail: prov.detail, row: canonical });
      continue;
    }

    const propResult = buildPropertyRecord(canonical, i);
    if ("rejection" in propResult) {
      rejections.push(propResult.rejection);
      continue;
    }
    const property: PropertyRecord = {
      ...propResult,
      provenance: {
        source: prov.sourceName,
        recordId: prov.recordId,
        observedAt: prov.observedAtIso,
        confidence: "HIGH",
        evidenceUrl: prov.recordUrl,
        evidenceLabel: "Public record",
      },
    };
    const fieldProv = property.provenance;

    const ownership = buildOwnership(canonical, property, fieldProv);
    const assessed = parseAssessedValue(
      cleanString(canonical.assessedValue) ?? "",
      fieldProv.observedAt,
      fieldProv.recordId,
      fieldProv.source,
      fieldProv.evidenceUrl ?? null,
    );

    const record: PublicRecord = {
      property,
      ownership,
      assessedValue: assessed,
      mailingAddressRaw: cleanString(canonical.mailingAddress),
      propertyType: parsePropertyType(canonical.propertyType),
      provenance: fieldProv,
    };

    records.push(record);
    sources.add(fieldProv.source);
  }

  return {
    records,
    rejections,
    sourceNames: [...sources].sort(),
  };
}

/**
 * Convenience: parse a raw CSV blob and run rows through the adapter.
 * Uses a minimal in-file CSV split — sufficient for county exports that
 * do not embed commas/newlines in fields. For richer escaping the caller
 * should parse with their own CSV library and pass the rows to
 * `parsePublicRecordRows` directly.
 */
export function parsePublicRecordCsv(csv: string): PublicRecordIngestResult {
  const rows = naiveParseCsv(csv);
  return parsePublicRecordRows(rows);
}

function naiveParseCsv(input: string): RawRow[] {
  const text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const row: RawRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  // Handles double-quoted cells (most common CSV escape) and trims whitespace.
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
