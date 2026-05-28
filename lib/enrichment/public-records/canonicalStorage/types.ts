// Meridian — Public-Record Intelligence Architecture v1, Commit A
//
// Canonical ownership-record types. Three entities; no scoring, no UI,
// no enrichment, no CRM logic.
//
//   PublicParcel                  — unique parcel as identified by a
//                                   county. Workspace-agnostic (public
//                                   record; not tenant data).
//   PublicOwnershipSnapshot       — immutable, append-only moment-in-
//                                   time observation. Preserves raw
//                                   source row verbatim.
//   WorkspaceContactParcelLink    — per-workspace binding between a
//                                   CRM contact and a PublicParcel.
//                                   Supersession-tracked; never deleted.
//
// All three entities use deterministic SHA-256 IDs (see ./ids.ts) so
// re-ingestion is idempotent and audit history is preserved.
//
// Constitution alignment:
//   §1 (source-of-truth hierarchy): snapshots store T5-tier raw public
//   records verbatim; nothing inferred at this layer.
//   §2 (provenance): source + observedAt are non-optional on every
//   snapshot; rawSourceRow preserves the literal CSV cells.
//   §6.11 (workspace isolation): the link entity carries workspaceId;
//   parcels + snapshots do not (public records are not tenant data).

/**
 * Authoritative jurisdiction for a parcel. ISO-3166-style:
 *   "us-mo-jackson", "us-ks-johnson", "us-ks-wyandotte"
 *
 * Convention: "<country>-<state>-<county>" lowercase, kebab. Future
 * counties slot in with no schema change.
 */
export type CountyCode = string;

/**
 * Verbatim parcel identifier as published by the county. NEVER
 * normalized — different counties use very different formats:
 *   Jackson MO uses dash-segmented strings like "30-510-01-04-00-0-00-000"
 *   Johnson KS uses integers like "DP12345678"
 * We preserve the source format exactly so audit comparisons against
 * the original CSV stay readable.
 */
export type SourceParcelId = string;

/**
 * Canonical address key produced by canonicalPropertyKey(). The join
 * axis for CRM × MLS × Dotloop × county. Case-insensitive, but
 * INTENTIONALLY STRICT about suffix variants (St ≠ Street). Each
 * source's preprocessor must pre-normalize to consistent abbreviation
 * usage before the canonical key is computed.
 */
export type CanonicalPropertyKey = string;

/**
 * Deterministic 24-character SHA-256 hex prefix. Stable across runs;
 * same natural keys → same id (see ./ids.ts).
 */
export type DeterministicId = string;

/**
 * Categorization from the most-recent snapshot. NEVER AI-derived;
 * only from explicit source fields. Mirrors EstimatedPropertyType
 * from lib/enrichment/property/types.ts but kept local so the
 * canonical-storage layer has zero dependencies on the signals layer.
 */
export type CanonicalPropertyType =
  | "single_family"
  | "townhouse"
  | "condominium"
  | "multi_family"
  | "land"
  | "commercial"
  | "unknown";

// ─────────────────────────────────────────────────────────────────
// PublicParcel — workspace-agnostic
// ─────────────────────────────────────────────────────────────────

export interface PublicParcel {
  /** Deterministic id — SHA-256 of (countyCode, sourceParcelId). */
  id: DeterministicId;

  /** Authoritative jurisdiction. */
  countyCode: CountyCode;

  /** Verbatim parcel id from the county. */
  sourceParcelId: SourceParcelId;

  /** Canonical address key for cross-source joins. */
  propertyKey: CanonicalPropertyKey;

  /** Verbatim situs address (audit). */
  situsAddress: string;

  /** First Meridian ingestion that observed this parcel. ISO-8601. */
  firstObservedAt: string;

  /** Most recent snapshot containing this parcel. ISO-8601. */
  lastObservedAt: string;

  /**
   * Optional categorization from the most-recent snapshot. Null when
   * source did not supply a parseable property type.
   */
  estimatedPropertyType: CanonicalPropertyType | null;
}

// ─────────────────────────────────────────────────────────────────
// PublicOwnershipSnapshot — workspace-agnostic, immutable
// ─────────────────────────────────────────────────────────────────

export interface PublicOwnershipSnapshot {
  /**
   * Deterministic id — SHA-256 of (parcelId, sourceSnapshotId,
   * observedAt). Re-ingesting the same CSV produces the same id,
   * which the adapter treats as a no-op insert.
   */
  id: DeterministicId;

  /** → PublicParcel.id */
  parcelId: DeterministicId;

  /**
   * Verbatim owner of record from the source. NEVER normalized at this
   * layer. Format varies:
   *   "SMITH, GREGORY A & MARY J"
   *   "Smith Family Trust 2014"
   *   "ACME HOLDINGS LLC"
   * Owner-name matching happens at the resolver (Commit B), not here.
   */
  ownerName: string;

  /** Verbatim mailing address; null when source did not supply. */
  mailingAddress: string | null;

  /**
   * When the current owner took title (often deed-recorded date).
   * Verbatim from source; null when source did not supply.
   * ISO-8601 date (YYYY-MM-DD).
   */
  ownershipStartDate: string | null;

  /**
   * Most recent transfer reflected in this snapshot. May equal
   * ownershipStartDate; may differ for some sources.
   * ISO-8601 date (YYYY-MM-DD).
   */
  lastTransferDate: string | null;

  /** Assessed (or appraised) value. Null when source did not supply. */
  assessedValue: number | null;

  /**
   * Canonical source identifier. Convention:
   *   "<jurisdiction>_<authority>_<acquisition-method>_<period>"
   * Examples:
   *   "johnson_county_ks_appraiser_manual_2026-05-27"
   *   "jackson_county_mo_sunshine_law_request_2026-06"
   *   "johnson_county_ks_appraiser_csv_2026-07"
   */
  source: string;

  /**
   * Stable identifier for the snapshot BATCH (one file may contain
   * many parcels; they share a sourceSnapshotId). Lets audit show
   * "everything from the JoCo May 2026 export."
   */
  sourceSnapshotId: string;

  /** When the snapshot was generated by the source. ISO-8601. */
  observedAt: string;

  /**
   * The original CSV row, preserved verbatim. Never mutated, never
   * overwritten. Used by audit tooling to show exactly what the
   * source said. Keys are the raw header strings from the CSV; values
   * are the raw cell strings.
   */
  rawSourceRow: Record<string, string>;

  /** When Meridian wrote this snapshot to storage. ISO-8601. */
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────
// WorkspaceContactParcelLink — workspace-scoped
// ─────────────────────────────────────────────────────────────────

/**
 * Confidence of the contact↔parcel link.
 *
 *   HIGH  — parcel_id exact match + exact owner-name match
 *   MED   — parcel_id exact match + surname/trust match, OR
 *           address-only match + exact owner-name match
 *   WEAK  — address-only match + surname-only match, OR
 *           any match with ownership_mismatch
 *
 * Drives the REVIEW-tier cap in the opportunity scorer (Commit C).
 */
export type LinkMatchConfidence = "HIGH" | "MED" | "WEAK";

/**
 * Outcome of classifyOwnerNameMatch (see
 * lib/enrichment/property/propertyMatchRules.ts) at the time the link
 * was created. "ownership_mismatch" is recorded when address matched
 * but owner-name did not — surfaced as a cautionary chip; never claimed
 * as ownership.
 */
export type LinkMatchReason =
  | "exact"
  | "surname"
  | "trust_or_llc"
  | "fuzzy"
  | "ownership_mismatch";

export interface WorkspaceContactParcelLink {
  /** Deterministic id — SHA-256 of (workspaceId, contactId, parcelId). */
  id: DeterministicId;

  /** Workspace slug. Workspace isolation enforced at this layer. */
  workspaceId: string;

  /** crm_contacts.contact_id within the workspace. */
  contactId: string;

  /** → PublicParcel.id */
  parcelId: DeterministicId;

  /**
   * → PublicOwnershipSnapshot.id — the snapshot that justified this
   * link. Always the most-recent snapshot whose owner-name matched
   * the contact at link-creation time.
   */
  ownerSnapshotId: DeterministicId;

  matchConfidence: LinkMatchConfidence;
  matchReason: LinkMatchReason;

  /** When the link was created. ISO-8601. */
  linkCreatedAt: string;

  /**
   * When this link was last verified against a current snapshot.
   * Equal to linkCreatedAt when never re-verified.
   */
  linkLastVerifiedAt: string;

  /**
   * Null while the link is active. Set (never unset) when a newer
   * snapshot shows a different owner. The superseded link stays
   * queryable for audit; the supersededByLinkId points to the
   * replacement.
   */
  linkSupersededAt: string | null;

  /** Pointer to the link that replaced this one (when superseded). */
  supersededByLinkId: DeterministicId | null;
}

// ─────────────────────────────────────────────────────────────────
// Insert/upsert payloads — explicit subsets of the entity types
// ─────────────────────────────────────────────────────────────────

/**
 * Payload for upsertPublicParcel. Lacks `firstObservedAt` /
 * `lastObservedAt` because the adapter computes those from
 * `observedAt` and any existing row.
 */
export interface PublicParcelUpsert {
  countyCode: CountyCode;
  sourceParcelId: SourceParcelId;
  propertyKey: CanonicalPropertyKey;
  situsAddress: string;
  estimatedPropertyType: CanonicalPropertyType | null;
  observedAt: string;
}

/**
 * Payload for appendOwnershipSnapshot. The adapter:
 *   • computes the deterministic id from (parcelId, sourceSnapshotId,
 *     observedAt)
 *   • dedups by primary key (re-insert is a no-op)
 *   • stamps createdAt = now()
 */
export interface PublicOwnershipSnapshotAppend {
  parcelId: DeterministicId;
  ownerName: string;
  mailingAddress: string | null;
  ownershipStartDate: string | null;
  lastTransferDate: string | null;
  assessedValue: number | null;
  source: string;
  sourceSnapshotId: string;
  observedAt: string;
  rawSourceRow: Record<string, string>;
}

/** Payload for upsertWorkspaceParcelLink. */
export interface WorkspaceContactParcelLinkUpsert {
  workspaceId: string;
  contactId: string;
  parcelId: DeterministicId;
  ownerSnapshotId: DeterministicId;
  matchConfidence: LinkMatchConfidence;
  matchReason: LinkMatchReason;
  linkCreatedAt: string;
}

// ─────────────────────────────────────────────────────────────────
// Write outcomes — explicit so callers can audit upsert vs no-op
// ─────────────────────────────────────────────────────────────────

export type WriteOutcome = "inserted" | "updated" | "noop";

export interface ParcelUpsertResult {
  id: DeterministicId;
  outcome: WriteOutcome;
}

export interface OwnershipSnapshotAppendResult {
  id: DeterministicId;
  outcome: WriteOutcome;
}

export interface WorkspaceParcelLinkUpsertResult {
  id: DeterministicId;
  outcome: WriteOutcome;
}

export interface WorkspaceParcelLinkSupersedeResult {
  /** The link that was superseded (now historical). */
  supersededLinkId: DeterministicId;
  /** The replacement link id (the active one going forward). */
  replacementLinkId: DeterministicId;
  /** ISO-8601 timestamp recorded on the supersession. */
  supersededAt: string;
}
