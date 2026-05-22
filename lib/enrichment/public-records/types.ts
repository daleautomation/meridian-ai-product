// Meridian — Brookside public-record ingestion: shared types.
//
// A `PublicRecord` is the deterministic, provenance-complete unit produced
// from one row of a county/assessor export. It carries:
//   • a normalized property identity (PropertyRecord)
//   • verified ownership facts (OwnershipRecord) when supported by a dated
//     ownershipStartDate AND a sourceName/observedAt/recordId tuple
//   • optional collateral facts (assessed value, mailing address)
//
// Every record entering the index must have passed `requirePublicRecordProvenance`
// in `./provenance.ts`. Rows that do not are returned in `rejections` so an
// operator can audit them — they are never silently dropped.

import type {
  EstimatedPropertyType,
  FieldProvenance,
  OwnershipRecord,
  PropertyRecord,
} from "@/lib/enrichment/property/types";

/**
 * Raw CSV row shape from a county/assessor export. All values arrive as
 * strings; the adapter trims, normalizes case, and parses dates / numbers.
 *
 * Field names follow the spec from the ingestion task; the adapter also
 * accepts the same names with snake_case / Title Case via a case-insensitive
 * cell lookup.
 */
export interface PublicRecordCsvRow {
  parcelId?: string;
  situsAddress?: string;
  ownerName?: string;
  mailingAddress?: string;
  lastTransferDate?: string;
  ownershipStartDate?: string;
  assessedValue?: string;
  propertyType?: string;
  recordUrl?: string;
  sourceName?: string;
  observedAt?: string;
}

/** A single county/assessor row, parsed and provenance-stamped. */
export interface PublicRecord {
  property: PropertyRecord;
  ownership: OwnershipRecord | null;
  /** Optional single-point assessed value when the row supplied one. */
  assessedValue: PublicRecordAssessedValue | null;
  /** Mailing address (post-normalization). Used only as audit context. */
  mailingAddressRaw: string | null;
  /** Estimated property type from the row, if parseable. */
  propertyType: EstimatedPropertyType;
  /** Top-level provenance for the row (mirrors property.provenance). */
  provenance: FieldProvenance;
}

export interface PublicRecordAssessedValue {
  value: number;
  observedAt: string;
  recordId: string;
  source: string;
  evidenceUrl: string | null;
}

/** Reason a row was rejected during ingestion. Drives operator-visible audit. */
export type PublicRecordRejectionCode =
  | "missing_source"
  | "missing_observed_at"
  | "missing_identifier"
  | "weak_address"
  | "invalid_date";

export interface PublicRecordRejection {
  rowIndex: number;
  code: PublicRecordRejectionCode;
  detail: string;
  /** The row as supplied (verbatim) so the operator can find it in the file. */
  row: PublicRecordCsvRow;
}

export interface PublicRecordIngestResult {
  records: PublicRecord[];
  rejections: PublicRecordRejection[];
  /** Source name(s) seen across the batch — for audit logging. */
  sourceNames: string[];
}

/** Outcome of a deterministic parcel lookup. */
export type ParcelMatchType = "parcel_id" | "address";
export type ParcelMatchConfidence = "HIGH" | "MED";

export interface ParcelMatch {
  publicRecord: PublicRecord;
  matchType: ParcelMatchType;
  matchConfidence: ParcelMatchConfidence;
}

/** Built once per batch; deterministic O(1) lookup by parcelId or propertyKey. */
export interface ParcelIndex {
  readonly byParcelId: ReadonlyMap<string, PublicRecord>;
  readonly byPropertyKey: ReadonlyMap<string, PublicRecord>;
  readonly size: number;
}
