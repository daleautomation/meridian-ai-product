// Meridian — listings CSV adapter (Heartland MLS shape, vendor-neutral).
//
// Pure, deterministic. Accepts either a raw CSV string (parseMlsCsv)
// or already-parsed header-keyed rows (parseMlsRows). Produces an
// IngestResult identical in shape to the public-records adapter so
// downstream consumers handle both pipelines uniformly.
//
// Hard rules enforced here:
//   • mlsNumber required             → "missing_mls_number"
//   • sourceName required            → "missing_source"
//   • observedAt required + ISO      → "missing_observed_at" / "invalid_observed_at"
//   • situsAddress required + parseable to a non-weak address
//                                     → "missing_situs_address" / "weak_situs_address"
//   • listedAt, when present, must be ISO; absent is permitted
//                                     → "invalid_listed_at" if malformed
//   • listPrice, when present, must be a finite number ≥ 0
//                                     → "invalid_list_price" if malformed
// No fuzzy inference. No invented defaults. Skipped rows are
// preserved verbatim on the ListingRejection.row field so the
// operator can locate them in the upstream export.

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";

import type {
  CurrentListingStatus,
  ListingIngestResult,
  ListingRecord,
  ListingRejection,
  ListingRejectionCode,
  MlsCsvRow,
} from "./types";

// ── Canonical row + header tolerance ──────────────────────────────

type RawRow = Record<string, string | undefined>;

/** Look up a header tolerating snake_case / camelCase / Title Case. */
function pick(row: RawRow, ...headers: string[]): string {
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

function asCanonicalRow(raw: RawRow): MlsCsvRow {
  return {
    mlsNumber: pick(raw, "mlsNumber", "mls_number", "mlsId", "listingId"),
    situsAddress: pick(raw, "situsAddress", "situs_address", "propertyAddress", "address"),
    listingStatus: pick(raw, "listingStatus", "listing_status", "status"),
    listingAgent: pick(raw, "listingAgent", "listing_agent", "agent"),
    listingBrokerage: pick(raw, "listingBrokerage", "listing_brokerage", "brokerage", "office"),
    listPrice: pick(raw, "listPrice", "list_price", "price"),
    listedAt: pick(raw, "listedAt", "listed_at", "listDate"),
    recordUrl: pick(raw, "recordUrl", "record_url", "url"),
    sourceName: pick(raw, "sourceName", "source_name", "source"),
    observedAt: pick(raw, "observedAt", "observed_at", "exportedAt"),
  };
}

// ── Status normalization ──────────────────────────────────────────
//
// Closed set. ANY value outside this map normalizes to "unknown" —
// the adapter does not invent statuses or fuzzy-match to neighbors.

const STATUS_MAP: ReadonlyMap<string, CurrentListingStatus> = new Map([
  ["active", "active"],
  ["a", "active"],
  ["new", "active"],
  ["coming soon", "active"],
  ["coming_soon", "active"],
  ["back on market", "active"],

  ["pending", "pending"],
  ["under contract", "pending"],
  ["contingent", "pending"],
  ["p", "pending"],

  ["sold", "sold_recently"],
  ["closed", "sold_recently"],
  ["c", "sold_recently"],
  ["sold_recently", "sold_recently"],

  ["off market", "off_market"],
  ["off_market", "off_market"],
  ["temporarily off market", "off_market"],
  ["tom", "off_market"],

  ["withdrawn", "withdrawn"],
  ["w", "withdrawn"],
  ["cancelled", "withdrawn"],
  ["canceled", "withdrawn"],

  ["expired", "expired"],
  ["e", "expired"],
  ["expired_listing", "expired"],
]);

export function normalizeListingStatus(value: string | null | undefined): CurrentListingStatus {
  if (!value) return "unknown";
  const key = value.trim().toLowerCase().replace(/\s+/g, " ");
  return STATUS_MAP.get(key) ?? "unknown";
}

// ── Helpers ────────────────────────────────────────────────────────

const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseIsoInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!ISO_INSTANT_RE.test(trimmed)) return null;
  const t = Date.parse(trimmed);
  if (!Number.isFinite(t)) return null;
  // Re-emit as a normalized ISO string so callers can rely on the
  // shape regardless of whether the source omitted the time portion.
  return new Date(t).toISOString();
}

function parseListPrice(value: string | null | undefined): number | null | "invalid" {
  if (!value) return null;
  const cleaned = value.trim().replace(/[$,]/g, "");
  if (cleaned.length === 0) return null;
  // Allow integers and decimals. Negative prices and non-numeric
  // values are invalid (the source is malformed).
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return "invalid";
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return n;
}

function nullableString(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim();
  return t.length === 0 ? null : t;
}

// ── Main API ──────────────────────────────────────────────────────

/** Parse already-tokenized header-keyed rows. */
export function parseMlsRows(rows: readonly RawRow[]): ListingIngestResult {
  const records: ListingRecord[] = [];
  const rejections: ListingRejection[] = [];
  const sources = new Set<string>();

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const raw = rows[rowIndex];
    const canonical = asCanonicalRow(raw);

    const fail = (code: ListingRejectionCode, detail: string) => {
      rejections.push({ rowIndex, code, detail, row: { ...canonical } });
    };

    const mlsNumber = canonical.mlsNumber?.trim() ?? "";
    if (mlsNumber.length === 0) {
      fail("missing_mls_number", "row has no mlsNumber");
      continue;
    }

    const sourceName = canonical.sourceName?.trim() ?? "";
    if (sourceName.length === 0) {
      fail("missing_source", "row has no sourceName");
      continue;
    }

    const observedAtRaw = canonical.observedAt?.trim() ?? "";
    if (observedAtRaw.length === 0) {
      fail("missing_observed_at", "row has no observedAt");
      continue;
    }
    const observedAt = parseIsoInstant(observedAtRaw);
    if (!observedAt) {
      fail("invalid_observed_at", `observedAt="${observedAtRaw}" is not ISO-8601`);
      continue;
    }

    const situsRaw = canonical.situsAddress?.trim() ?? "";
    if (situsRaw.length === 0) {
      fail("missing_situs_address", "row has no situsAddress");
      continue;
    }
    const normalized = normalizeAddress(situsRaw);
    const weak = detectWeakAddress(normalized);
    if (weak) {
      fail("weak_situs_address", `address "${situsRaw}" rejected: ${weak.code} (${weak.detail})`);
      continue;
    }
    const propertyKey = canonicalPropertyKey(normalized);

    // listedAt is optional but when present must be ISO.
    const listedAtRaw = canonical.listedAt?.trim() ?? "";
    let listedAt: string | null = null;
    if (listedAtRaw.length > 0) {
      const parsed = parseIsoInstant(listedAtRaw);
      if (!parsed) {
        fail("invalid_listed_at", `listedAt="${listedAtRaw}" is not ISO-8601`);
        continue;
      }
      listedAt = parsed;
    }

    // listPrice is optional but when present must parse to a
    // finite non-negative number.
    const priceParse = parseListPrice(canonical.listPrice);
    if (priceParse === "invalid") {
      fail("invalid_list_price", `listPrice="${canonical.listPrice}" is not a valid number`);
      continue;
    }
    const listPrice = priceParse;

    const status = normalizeListingStatus(canonical.listingStatus);

    const record: ListingRecord = {
      mlsNumber,
      situsAddress: situsRaw,
      propertyKey,
      status,
      listingAgent: nullableString(canonical.listingAgent),
      listingBrokerage: nullableString(canonical.listingBrokerage),
      listPrice,
      listedAt,
      source: sourceName,
      recordUrl: nullableString(canonical.recordUrl),
      observedAt,
    };
    records.push(record);
    sources.add(sourceName);
  }

  return {
    records,
    rejections,
    sourceNames: [...sources].sort(),
  };
}

/**
 * Parse a raw CSV blob and run rows through parseMlsRows. Uses the
 * same naive parser as the public-records adapter — sufficient for
 * MLS exports that don't embed unescaped commas/newlines. Callers
 * with richer CSV needs should parse with a library and feed rows
 * to parseMlsRows directly.
 */
export function parseMlsCsv(csv: string): ListingIngestResult {
  const rows = naiveParseCsv(csv);
  return parseMlsRows(rows);
}

// ── Naive CSV split (mirrors public-records adapter for parity) ───

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
