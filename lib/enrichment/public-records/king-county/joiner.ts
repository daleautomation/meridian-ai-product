// Meridian — King County Assessor + Recorder deterministic join.
//
// Pure function. Same inputs (assessor rows + recorder rows + observedAt)
// produce byte-identical `JoinedRow[]` AND `JoinAudit`. Every rejection
// carries a typed code; nothing is silently dropped.
//
// Strict rules enforced here:
//   • parcelId is the only join key — fuzzy / address-based joins forbidden
//   • parcel IDs must normalize to 10 digits or the row is rejected
//   • situs addresses run through the project's normalizer; a weak
//     address rejects the row
//   • duplicate parcels in the assessor are rejected as a group
//   • recorder rows with non-transfer document types are silently
//     ignored (not rejected — they simply do not anchor an ownership
//     date); only the latest TRANSFER document drives ownershipStartDate
//   • a recorder row with a malformed date or malformed parcel is a
//     typed rejection
//   • no ownership inference: when no transfer doc exists for an
//     assessed parcel, `ownershipStartDate` is left empty and the
//     downstream public-records adapter will admit the property without
//     an ownership block (the documented contract — see
//     `lib/enrichment/public-records/csvAdapter.ts`)

import {
  detectWeakAddress,
  normalizeAddress,
  type NormalizedAddress,
} from "@/lib/enrichment/address";

import { isOwnershipTransferDoc } from "./docTypes";
import { normalizeKingCountyParcelId } from "./parcelId";

// ── Row shapes ─────────────────────────────────────────────────────

/** Raw assessor row keyed by header (case-insensitive on read). */
export type AssessorRow = Record<string, string | undefined>;
/** Raw recorder row keyed by header (case-insensitive on read). */
export type RecorderRow = Record<string, string | undefined>;

/** One row of the canonical joined output (column order set in csvSerializer). */
export interface JoinedRow {
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
  observedAt: string;
}

// ── Audit + rejection types ────────────────────────────────────────

export type JoinRejectionSource = "assessor" | "recorder" | "input";

export type JoinRejectionCode =
  | "missing_parcel_id"
  | "malformed_parcel_id"
  | "duplicate_parcel_id"
  | "missing_situs_address"
  | "weak_address"
  | "missing_observed_at"
  | "malformed_date";

export interface JoinRejection {
  source: JoinRejectionSource;
  rowIndex: number;
  code: JoinRejectionCode;
  detail: string;
  rawParcelId: string | null;
}

export interface JoinAudit {
  totalAssessorRows: number;
  totalRecorderRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateParcelCount: number;
  orphanRecorderCount: number;
  byCode: Record<JoinRejectionCode, number>;
  rejections: JoinRejection[];
  duplicateParcelIds: string[];
  orphanRecorderParcelIds: string[];
}

export interface JoinInput {
  assessor: readonly AssessorRow[];
  recorder: readonly RecorderRow[];
  /** Single observedAt stamp emitted on every accepted row (the pull date). */
  observedAt: string;
  /** Override the King County dashboard URL template if needed. */
  recordUrlTemplate?: string;
  /** Override the canonical source name on every accepted row. */
  sourceName?: string;
}

export interface JoinResult {
  rows: JoinedRow[];
  audit: JoinAudit;
}

// ── Defaults ───────────────────────────────────────────────────────

const DEFAULT_RECORD_URL_TEMPLATE =
  "https://blue.kingcounty.com/Assessor/eRealProperty/Dashboard.aspx?ParcelNbr={parcelId}";
const DEFAULT_SOURCE_NAME = "county_recorder:king_wa";

// ── Helpers ────────────────────────────────────────────────────────

const STRICT_DATE_RE =
  /^(?:\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4})$/;

function strictParseDateToIso(value: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!STRICT_DATE_RE.test(trimmed)) return null;
  const t = Date.parse(trimmed);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function pick(
  row: Record<string, string | undefined>,
  ...headers: string[]
): string {
  // Case- and separator-insensitive header lookup so the joiner accepts
  // common header conventions without per-export wiring.
  const norm = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    norm.set(canonicalHeader(k), (v ?? "").trim());
  }
  for (const h of headers) {
    const value = norm.get(canonicalHeader(h));
    if (value) return value;
  }
  return "";
}

function canonicalHeader(key: string): string {
  return key.toLowerCase().replace(/[_\s\-.]+/g, "");
}

function situsDisplayString(addr: NormalizedAddress): string {
  const street = [addr.line1, addr.line2].filter(Boolean).join(" ").trim();
  const csz = [addr.city, [addr.state, addr.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, csz].filter(Boolean).join(", ");
}

function emptyByCode(): Record<JoinRejectionCode, number> {
  return {
    missing_parcel_id: 0,
    malformed_parcel_id: 0,
    duplicate_parcel_id: 0,
    missing_situs_address: 0,
    weak_address: 0,
    missing_observed_at: 0,
    malformed_date: 0,
  };
}

function recordRejection(
  rejections: JoinRejection[],
  byCode: Record<JoinRejectionCode, number>,
  rejection: JoinRejection,
): void {
  rejections.push(rejection);
  byCode[rejection.code] += 1;
}

interface ParsedRecorderEntry {
  rowIndex: number;
  parcelId: string;
  recordingDateIso: string;
  documentType: string;
  documentNumber: string;
}

function deterministicCompareRecorder(
  a: ParsedRecorderEntry,
  b: ParsedRecorderEntry,
): number {
  // Latest recording date wins. Tiebreak by documentNumber DESC for
  // determinism across reruns (no input-order dependency).
  if (a.recordingDateIso !== b.recordingDateIso) {
    return a.recordingDateIso > b.recordingDateIso ? -1 : 1;
  }
  if (a.documentNumber !== b.documentNumber) {
    return a.documentNumber > b.documentNumber ? -1 : 1;
  }
  return 0;
}

// ── Phase headers — pure, ordered phases ───────────────────────────

interface AssessorBucket {
  rows: { row: AssessorRow; rowIndex: number }[];
}

function buildAssessorBuckets(
  assessor: readonly AssessorRow[],
  rejections: JoinRejection[],
  byCode: Record<JoinRejectionCode, number>,
): Map<string, AssessorBucket> {
  const byParcel = new Map<string, AssessorBucket>();
  for (let i = 0; i < assessor.length; i++) {
    const row = assessor[i] ?? {};
    const rawPid = pick(row, "parcelId", "parcel_number", "pin", "parcel", "major", "account");
    if (!rawPid) {
      recordRejection(rejections, byCode, {
        source: "assessor",
        rowIndex: i,
        code: "missing_parcel_id",
        detail: "assessor row has no parcel identifier",
        rawParcelId: null,
      });
      continue;
    }
    const normPid = normalizeKingCountyParcelId(rawPid);
    if (!normPid) {
      recordRejection(rejections, byCode, {
        source: "assessor",
        rowIndex: i,
        code: "malformed_parcel_id",
        detail: `parcel "${rawPid}" does not normalize to a 10-digit King County PIN`,
        rawParcelId: rawPid,
      });
      continue;
    }
    const bucket = byParcel.get(normPid) ?? { rows: [] };
    bucket.rows.push({ row, rowIndex: i });
    byParcel.set(normPid, bucket);
  }
  return byParcel;
}

function flagDuplicateParcels(
  byParcel: Map<string, AssessorBucket>,
  rejections: JoinRejection[],
  byCode: Record<JoinRejectionCode, number>,
): string[] {
  const duplicates: string[] = [];
  for (const [pid, bucket] of byParcel) {
    if (bucket.rows.length <= 1) continue;
    duplicates.push(pid);
    for (const r of bucket.rows) {
      recordRejection(rejections, byCode, {
        source: "assessor",
        rowIndex: r.rowIndex,
        code: "duplicate_parcel_id",
        detail: `parcel ${pid} appears ${bucket.rows.length} times in assessor export`,
        rawParcelId: pid,
      });
    }
  }
  duplicates.sort();
  return duplicates;
}

function buildRecorderIndex(
  recorder: readonly RecorderRow[],
  rejections: JoinRejection[],
  byCode: Record<JoinRejectionCode, number>,
): Map<string, ParsedRecorderEntry[]> {
  const byParcel = new Map<string, ParsedRecorderEntry[]>();
  for (let i = 0; i < recorder.length; i++) {
    const row = recorder[i] ?? {};
    const rawPid = pick(row, "parcelId", "parcel_number", "pin", "parcel", "associatedparcel");
    if (!rawPid) {
      recordRejection(rejections, byCode, {
        source: "recorder",
        rowIndex: i,
        code: "missing_parcel_id",
        detail: "recorder row has no parcel identifier",
        rawParcelId: null,
      });
      continue;
    }
    const normPid = normalizeKingCountyParcelId(rawPid);
    if (!normPid) {
      recordRejection(rejections, byCode, {
        source: "recorder",
        rowIndex: i,
        code: "malformed_parcel_id",
        detail: `parcel "${rawPid}" does not normalize to a 10-digit King County PIN`,
        rawParcelId: rawPid,
      });
      continue;
    }
    const docType = pick(row, "documentType", "doctype", "instrumentType", "type");
    // Non-transfer documents are intentionally not rejected — they are
    // simply ignored when picking the latest transfer date.
    if (!isOwnershipTransferDoc(docType)) continue;

    const rawDate = pick(row, "recordingDate", "recordedDate", "filingDate", "date");
    const dateIso = strictParseDateToIso(rawDate);
    if (!dateIso) {
      recordRejection(rejections, byCode, {
        source: "recorder",
        rowIndex: i,
        code: "malformed_date",
        detail: `recordingDate "${rawDate}" not parseable for parcel ${normPid}`,
        rawParcelId: normPid,
      });
      continue;
    }
    const documentNumber = pick(row, "documentNumber", "instrumentNumber", "recordingNumber");
    const arr = byParcel.get(normPid) ?? [];
    arr.push({
      rowIndex: i,
      parcelId: normPid,
      recordingDateIso: dateIso,
      documentType: docType,
      documentNumber,
    });
    byParcel.set(normPid, arr);
  }
  for (const arr of byParcel.values()) arr.sort(deterministicCompareRecorder);
  return byParcel;
}

// ── Main entry ─────────────────────────────────────────────────────

export function joinKingCountyRecords(input: JoinInput): JoinResult {
  const rejections: JoinRejection[] = [];
  const byCode = emptyByCode();

  const observedAtIso = strictParseDateToIso(input.observedAt);
  if (!observedAtIso) {
    recordRejection(rejections, byCode, {
      source: "input",
      rowIndex: -1,
      code: "missing_observed_at",
      detail: `observedAt "${input.observedAt}" is not a parseable date`,
      rawParcelId: null,
    });
    return {
      rows: [],
      audit: {
        totalAssessorRows: input.assessor.length,
        totalRecorderRows: input.recorder.length,
        acceptedRows: 0,
        rejectedRows: rejections.length,
        duplicateParcelCount: 0,
        orphanRecorderCount: 0,
        byCode,
        rejections,
        duplicateParcelIds: [],
        orphanRecorderParcelIds: [],
      },
    };
  }

  const sourceName = input.sourceName ?? DEFAULT_SOURCE_NAME;
  const recordUrlTemplate = input.recordUrlTemplate ?? DEFAULT_RECORD_URL_TEMPLATE;

  // Phase 1: assessor bucketing + identifier rejections.
  const assessorByParcel = buildAssessorBuckets(input.assessor, rejections, byCode);

  // Phase 2: duplicate parcel flagging (rejects every row in a dup group).
  const duplicateParcelIds = flagDuplicateParcels(assessorByParcel, rejections, byCode);
  const dupSet = new Set(duplicateParcelIds);

  // Phase 3: recorder index — transfer-only, with date/parcel rejections.
  const recorderByParcel = buildRecorderIndex(input.recorder, rejections, byCode);

  // Phase 4: build joined rows for single-bucket assessor parcels.
  const rows: JoinedRow[] = [];
  const acceptedSet = new Set<string>();

  for (const [normPid, bucket] of assessorByParcel) {
    if (bucket.rows.length !== 1) continue;
    const { row, rowIndex } = bucket.rows[0];

    const rawSitus = pick(
      row,
      "situsAddress",
      "address",
      "propertyAddress",
      "locationAddress",
      "street",
    );
    if (!rawSitus) {
      recordRejection(rejections, byCode, {
        source: "assessor",
        rowIndex,
        code: "missing_situs_address",
        detail: `parcel ${normPid} has no situs address`,
        rawParcelId: normPid,
      });
      continue;
    }
    const normalized = normalizeAddress(rawSitus);
    const weak = detectWeakAddress(normalized);
    if (weak) {
      recordRejection(rejections, byCode, {
        source: "assessor",
        rowIndex,
        code: "weak_address",
        detail: `parcel ${normPid}: ${weak.code} (${weak.detail})`,
        rawParcelId: normPid,
      });
      continue;
    }

    const ownerName = pick(row, "ownerName", "taxpayerName", "owner", "taxpayer");
    const mailingAddress = pick(row, "mailingAddress", "mailingStreet");
    const assessedValue = pick(row, "assessedValue", "appraisedValue", "totalValue", "appraisal");
    const propertyType = pick(row, "propertyType", "presentUse", "useCode", "dorUse");

    const recorderHits = recorderByParcel.get(normPid) ?? [];
    const latest = recorderHits[0] ?? null;
    const ownershipStartDate = latest?.recordingDateIso ?? "";
    const lastTransferDate = latest?.recordingDateIso ?? "";

    const recordUrl = recordUrlTemplate.replace(/\{parcelId\}/g, normPid);

    rows.push({
      parcelId: normPid,
      situsAddress: situsDisplayString(normalized),
      ownerName,
      mailingAddress,
      ownershipStartDate,
      lastTransferDate,
      assessedValue,
      propertyType,
      recordUrl,
      sourceName,
      observedAt: observedAtIso,
    });
    acceptedSet.add(normPid);
  }

  // Phase 5: orphan recorder parcels (no matching assessor row at all,
  // and not part of a duplicate-rejected group).
  const orphans: string[] = [];
  for (const pid of recorderByParcel.keys()) {
    if (acceptedSet.has(pid)) continue;
    if (dupSet.has(pid)) continue;
    if (!assessorByParcel.has(pid)) orphans.push(pid);
  }
  orphans.sort();

  // Phase 6: deterministic output ordering by parcelId ASC.
  rows.sort((a, b) => (a.parcelId < b.parcelId ? -1 : a.parcelId > b.parcelId ? 1 : 0));

  // Phase 7: deterministic rejection ordering by (source, rowIndex, code).
  rejections.sort((a, b) => {
    if (a.source !== b.source) return a.source < b.source ? -1 : 1;
    if (a.rowIndex !== b.rowIndex) return a.rowIndex - b.rowIndex;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });

  return {
    rows,
    audit: {
      totalAssessorRows: input.assessor.length,
      totalRecorderRows: input.recorder.length,
      acceptedRows: rows.length,
      rejectedRows: rejections.length,
      duplicateParcelCount: duplicateParcelIds.length,
      orphanRecorderCount: orphans.length,
      byCode,
      rejections,
      duplicateParcelIds,
      orphanRecorderParcelIds: orphans,
    },
  };
}
