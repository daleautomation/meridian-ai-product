// Meridian — listings ingestion: types.
//
// Mirrors the public-records ingestion pattern (typed canonical row,
// typed record, typed rejection). Pure data; no functions.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §2 Provenance Requirements — every emitted ListingRecord carries
//      `source` + `observedAt`; rejections carry a canonical code.
//   §5 Deterministic Signal Rules — these types contain no inference.
//      A ListingRecord either reflects a parsed CSV row or it doesn't
//      get emitted.
//   §6 Forbidden Behaviors — no predictive fields, no "intent" labels,
//      no AI-derived enrichment hooks.

/**
 * Canonical listing status. Anything outside this closed set is
 * normalized to "unknown" via the adapter's case-insensitive
 * normalizer. Never fuzzy-matched.
 */
export type CurrentListingStatus =
  | "active"
  | "pending"
  | "sold_recently"
  | "off_market"
  | "withdrawn"
  | "expired"
  | "unknown";

/**
 * Outcome of comparing a listing's named agent to the operator
 * identifiers configured for the workspace. Deterministic; produced
 * only via classifyListingAgent().
 */
export type ListingAgentMatch =
  | "nicole"        // legacy label preserved for v1 to match the workspace pricing doc
  | "operator"      // generic — same semantics as "nicole" for non-Brookside workspaces
  | "other_agent"
  | "unknown";

/**
 * Operator identifiers a workspace declares for listing-agent matching.
 * The classifier compares against each entry in turn (case-insensitive,
 * surname-token aware). At least one of these forms is supplied for any
 * workspace that runs the listings ingestion.
 *
 * `displayLabel` is the canonical match label the classifier returns
 * when the agent name aligns. For Brookside (Nicole), this is "nicole";
 * for other workspaces, "operator" is the safe default.
 */
export interface OperatorIdentifiers {
  /** Full or partial names that may appear on an MLS export's
   *  listing-agent column for the workspace's operator. e.g.
   *  ["Nicole Lonergan", "Lonergan, Nicole", "N. Lonergan"]. */
  names: readonly string[];
  /** Label to return when classifyListingAgent decides it matches. */
  displayLabel: ListingAgentMatch & ("nicole" | "operator");
}

/**
 * A single normalized listing row. Fields with `null` are explicitly
 * absent from the source; the adapter never substitutes invented
 * defaults.
 */
export interface ListingRecord {
  /** MLS-supplied unique number for the listing (e.g. "2412345"). */
  mlsNumber: string;
  /** Verbatim situs address string as supplied by the export (kept
   *  alongside the normalized propertyKey so audit tooling can show
   *  the original string the operator would recognize). */
  situsAddress: string;
  /** Canonical property key produced by
   *  lib/enrichment/address/canonicalPropertyKey(). Used for O(1)
   *  lookup against the listings index. */
  propertyKey: string;
  status: CurrentListingStatus;
  /** Listing agent name verbatim from the export. May be null when
   *  the export omitted the column. */
  listingAgent: string | null;
  /** Listing brokerage verbatim from the export. May be null. */
  listingBrokerage: string | null;
  /** Numeric list price; null when the CSV cell was empty or
   *  unparseable (never coerced to 0 — null is honest). */
  listPrice: number | null;
  /** ISO-8601 listed-at instant. Null when absent or unparseable
   *  (never silently filled). */
  listedAt: string | null;
  /** Source provenance string, e.g. "heartland_mls_export". Required;
   *  rows without a source are rejected. */
  source: string;
  /** Optional deep-link back to the listing on the MLS portal. */
  recordUrl: string | null;
  /** ISO-8601 timestamp recording when the export was generated.
   *  Required; rows without observedAt are rejected. */
  observedAt: string;
}

/**
 * Adapter input shape — header-keyed map of strings. Matches the
 * public-records adapter convention so callers can use the same
 * naive-CSV-parse helper.
 */
export interface MlsCsvRow {
  mlsNumber?: string;
  situsAddress?: string;
  listingStatus?: string;
  listingAgent?: string;
  listingBrokerage?: string;
  listPrice?: string;
  listedAt?: string;
  recordUrl?: string;
  sourceName?: string;
  observedAt?: string;
}

/**
 * Closed set of rejection reasons. Each one names a single failed
 * invariant. Audit tooling groups rejections by this code so the
 * operator can fix the upstream CSV deterministically.
 */
export type ListingRejectionCode =
  | "missing_mls_number"
  | "missing_source"
  | "missing_observed_at"
  | "invalid_observed_at"
  | "invalid_listed_at"
  | "missing_situs_address"
  | "weak_situs_address"
  | "invalid_list_price";

export interface ListingRejection {
  rowIndex: number;
  code: ListingRejectionCode;
  detail: string;
  /** Verbatim source row so the operator can find the bad line in
   *  the CSV. Never mutated. */
  row: MlsCsvRow;
}

/**
 * Adapter output. Mirrors PublicRecordIngestResult shape so callers
 * can treat ingestion outcomes uniformly.
 */
export interface ListingIngestResult {
  records: ListingRecord[];
  rejections: ListingRejection[];
  /** Sorted, deduplicated set of source names observed across the
   *  batch — used by audit tooling to confirm provenance. */
  sourceNames: string[];
}

/** Built by buildListingIndex(); consumed by lookupListingByAddress(). */
export interface ListingIndex {
  /** O(1) lookup by canonical propertyKey. Last-wins when multiple
   *  records share a key (which would indicate a duplicate listing
   *  in the export — audit should flag). */
  readonly byPropertyKey: ReadonlyMap<string, ListingRecord>;
  /** Number of records in the index (after de-dup by propertyKey). */
  readonly size: number;
  /** Property keys that had > 1 record in the source batch. Surfaced
   *  so the audit can flag duplicate listings without silently
   *  dropping them. */
  readonly duplicatePropertyKeys: readonly string[];
}
