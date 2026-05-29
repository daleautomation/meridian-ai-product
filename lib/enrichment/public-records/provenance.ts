// Meridian — Brookside public-record ingestion: provenance gate.
//
// Single source of truth for "is this row legal to admit into the index?".
// A row is admitted only when it carries:
//   • a non-empty `sourceName`
//   • a parseable ISO-8601 `observedAt`
//   • at least one of `recordId` (synthetic) or `parcelId`
//
// Rows that fail any check return a typed rejection. The adapter uses that
// rejection verbatim in the audit list — no silent drops.

import type {
  PublicRecordCsvRow,
  PublicRecordRejectionCode,
} from "./types";

const STRICT_ISO_RE =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** Parse a string into an ISO-8601 UTC stamp, or return null if not valid. */
export function parseIsoDate(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!STRICT_ISO_RE.test(trimmed)) return null;
  const t = Date.parse(trimmed);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/** Trim a string field; return null if empty. */
export function cleanString(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ProvenanceOk {
  ok: true;
  sourceName: string;
  observedAtIso: string;
  recordId: string;
  recordUrl: string | null;
}

export interface ProvenanceFailure {
  ok: false;
  code: PublicRecordRejectionCode;
  detail: string;
}

/**
 * Validate the provenance triple on a raw row. Returns a success object
 * with normalized values or a typed failure the caller can surface as a
 * `PublicRecordRejection`.
 *
 * Per ingestion rules:
 *   • `sourceName` must be present
 *   • `observedAt` must be a parseable ISO-8601 date string
 *   • `recordId` is satisfied by either the explicit `parcelId` OR a
 *     synthetic `recordUrl`-derived id; if neither is present, the row
 *     cannot be admitted.
 */
export function requirePublicRecordProvenance(
  row: PublicRecordCsvRow,
): ProvenanceOk | ProvenanceFailure {
  const sourceName = cleanString(row.sourceName);
  if (!sourceName) {
    return {
      ok: false,
      code: "missing_source",
      detail: "sourceName is required on every public-record row",
    };
  }

  const observedRaw = cleanString(row.observedAt);
  if (!observedRaw) {
    return {
      ok: false,
      code: "missing_observed_at",
      detail: "observedAt is required on every public-record row",
    };
  }
  const observedAtIso = parseIsoDate(observedRaw);
  if (!observedAtIso) {
    return {
      ok: false,
      code: "invalid_date",
      detail: `observedAt "${observedRaw}" is not a parseable ISO-8601 date`,
    };
  }

  const parcelId = cleanString(row.parcelId);
  const recordUrl = cleanString(row.recordUrl);
  const recordId = parcelId ?? (recordUrl ? `url:${recordUrl}` : null);
  if (!recordId) {
    return {
      ok: false,
      code: "missing_identifier",
      detail: "recordId requires parcelId or recordUrl on the row",
    };
  }

  return {
    ok: true,
    sourceName,
    observedAtIso,
    recordId,
    recordUrl,
  };
}

/** True for any code that indicates a provenance / shape problem (not address). */
export function isProvenanceRejection(code: PublicRecordRejectionCode): boolean {
  return (
    code === "missing_source" ||
    code === "missing_observed_at" ||
    code === "missing_identifier" ||
    code === "invalid_date"
  );
}
