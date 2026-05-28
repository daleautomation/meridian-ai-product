// Meridian CRM import — canonical types for contact ingestion.

/**
 * Canonical fields the import normalizer maps source CSV columns into.
 *
 * Two classes of fields:
 *   • SINGLE-VALUE fields (`name`, `address`) — used when a source CSV
 *     supplies the full value in one column (e.g., a column literally
 *     called "Name" or "Full Address").
 *   • COMPONENT fields (`firstName`, `lastName`, `street`, `unit`,
 *     `city`, `state`, `postalCode`) — used when the source splits the
 *     value across columns (the WiseAgent shape: "First Name" +
 *     "Last Name" + "Home Street" + "Home City" + "Home State" +
 *     "Home Postal Code"). The normalizer ASSEMBLES these into the
 *     final single-value fields at `normalizeCrmRow` time.
 *
 * The two classes coexist on `ColumnMapping` so a CSV that mixes them
 * (rare but possible — e.g., a "Name" column AND a "Last Name" column)
 * detects both. The assembly logic in `normalizeCrmRow` prefers the
 * SINGLE-VALUE field when present, falling back to the component
 * assembly only when the single-value field is empty.
 */
export type CrmImportField =
  | "name"
  | "firstName"
  | "lastName"
  | "company"
  | "phone"
  | "email"
  | "address"
  | "street"
  | "unit"
  | "city"
  | "state"
  | "postalCode"
  | "notes"
  | "tags"
  | "lastInteraction"
  | "sourceCrm";

/**
 * Detection order. **Specific fields are listed BEFORE general ones.**
 *
 * `detectColumnMapping` claims headers in iteration order, so listing
 * `firstName` before `name` lets a "First Name" header be captured as
 * a component without ALSO being claimed by `name` via substring match.
 * Same idea for street/city/state/postalCode vs. address.
 *
 * Mixing single-value and component columns in the same source CSV is
 * supported — the assembly logic picks the single-value field when
 * available.
 */
export const CRM_IMPORT_FIELDS: CrmImportField[] = [
  "firstName",
  "lastName",
  "name",
  "company",
  "phone",
  "email",
  "street",
  "unit",
  "city",
  "state",
  "postalCode",
  "address",
  "notes",
  "tags",
  "lastInteraction",
  "sourceCrm",
];

export type DatumTrustLevel = "verified" | "acceptable" | "weak" | "missing" | "conflicting";

export type ContactDatumTrust = {
  value: string | null;
  source: string;
  confidence: number; // 0–100
  trustLevel: DatumTrustLevel;
  lastVerifiedAt: string | null;
  enrichmentProvider: string | null;
  conflictState: "none" | "competing_values" | "stale_override";
  displayAsTrusted: boolean;
};

export type NormalizedCrmContact = {
  rowIndex: number;
  name: string;
  company: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  sourceCrm: string | null;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  normalizedCompany: string | null;
  normalizedName: string | null;
  dataTrust: {
    name: ContactDatumTrust;
    company: ContactDatumTrust;
    phone: ContactDatumTrust;
    email: ContactDatumTrust;
    address: ContactDatumTrust;
    lastInteraction: ContactDatumTrust;
  };
  validationErrors: string[];
  validationWarnings: string[];
};

export type ColumnMapping = Partial<Record<CrmImportField, string>>;

export type DedupeVerdict = "safe_merge" | "likely_duplicate" | "manual_review_required" | "unique";

export type DedupePair = {
  incomingRowIndex: number;
  existingContactId: string;
  verdict: DedupeVerdict;
  score: number;
  reasons: string[];
  incomingPreview: Pick<NormalizedCrmContact, "name" | "company" | "phone" | "email">;
  existingPreview: Pick<NormalizedCrmContact, "name" | "company" | "phone" | "email">;
};

export type MergeRecommendation = {
  pairId: string;
  verdict: DedupeVerdict;
  suggestedAction: "merge" | "keep_separate" | "review";
  fieldResolutions: Array<{
    field: CrmImportField;
    incomingValue: string | null;
    existingValue: string | null;
    recommendation: "keep_existing" | "use_incoming" | "manual";
    reason: string;
  }>;
};

export type ImportProgressState =
  | "uploaded"
  | "mapping"
  | "previewing"
  | "validating"
  | "deduping"
  | "importing"
  | "completed"
  | "failed"
  | "rolled_back";

export type CrmImportJob = {
  id: string;
  workspaceId: string;
  sourceLabel: string;
  state: ImportProgressState;
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  rollbackSnapshotId: string | null;
  error: string | null;
  headers: string[];
  columnMapping: ColumnMapping;
  previewSample: NormalizedCrmContact[];
  normalizedRows?: NormalizedCrmContact[];
  dedupePairs: DedupePair[];
  mergeRecommendations: MergeRecommendation[];
};

/** Operator-visible verification tier for CRM contact intelligence. */
export type VerificationTier = "imported" | "verified" | "enriched" | "confidence_low";

export type ContactScoreMetadata = {
  provenance: "imported" | "inferred" | "enriched" | "default";
  verificationTier?: VerificationTier;
  reasonCodes: string[];
  sourceFieldsUsed: string[];
  storedAtImport: boolean;
  confidence: "high" | "medium" | "low" | "unknown";
  computedAt: string;
};

export type CrmContactRecord = {
  id: string;
  workspaceId: string;
  importJobId: string | null;
  name: string;
  company: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  sourceCrm: string | null;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  normalizedCompany: string | null;
  normalizedName: string | null;
  dataTrust: NormalizedCrmContact["dataTrust"];
  relationshipScore: number | null;
  scoreMetadata: ContactScoreMetadata | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Optional external enrichment captured AFTER the CRM import.
   * Additive only — never overwrites name / tags / notes / lastInteractionAt.
   * Every nested provider entry MUST carry source, fetchedAt, and a
   * confidence score so audit tooling can prove provenance.
   */
  enrichment?: ContactEnrichment;
  /**
   * Append-only operator/founder-confirmed corrections. Field values
   * (name, company, email, phone, address) on this record reflect the
   * EFFECTIVE value after repairs are applied; the import-time
   * originals stay in `originalImport` below. Never silently
   * overwritten.
   */
  repairs?: ContactRepair[];
  /**
   * Verbatim import-time values for the repairable fields. Populated
   * by the adapter on every read whenever `repairs` is non-empty, so
   * any caller can see the original CRM truth without consulting the
   * full JSONB. When `repairs` is empty/absent, this field is
   * `undefined` and the record's main fields ARE the originals.
   */
  originalImport?: {
    name?: string;
    company?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
};

export type HunterEnrichmentStatus = "found" | "not_found" | "skipped" | "error";

export type HunterEnrichmentEntry = {
  /** Always "hunter" today; reserved field for future providers. */
  source: "hunter";
  /** When the Hunter call returned this result. ISO-8601. */
  fetchedAt: string;
  /** Hunter's 0–100 email-finder score for the (domain, name) match. */
  confidence: number | null;
  status: HunterEnrichmentStatus;
  /** Reason for non-"found" statuses (e.g. "personal_domain", "no_match"). */
  reason?: string;
  /** Returned by Hunter Email Finder when available. */
  company?: string;
  role?: string;
  /** Optional Hunter-supplied source URL (where Hunter observed the email). */
  sourceUrl?: string;
};

// ── Property Intelligence Entry ────────────────────────────────────
//
// Per-contact storage shape for residential property data.
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §1 Source-of-Truth Hierarchy — T4 (verified external lookup) / T5
//       (public record) / T6 (derived). Never silently overrides
//       T1–T3 CRM truth.
//   §2 Provenance Requirements — source / fetchedAt / confidence /
//       status are non-optional.
//   §4 Confidence System — HIGH requires parcel match + owner-name
//       match (exact or strong-surname). MED requires parcel match +
//       weaker name match. LOW is stored but never surfaced.
//   §6 Forbidden Behaviors — no predictive financial fields. No
//       refinance windows, equity estimates, or "ready to sell"
//       probabilities. Period.

export type PropertyIntelligenceStatus =
  | "matched"
  | "ownership_mismatch"
  | "not_found"
  | "ambiguous"
  | "skipped"
  | "error";

export type PropertyIntelligenceConfidence = "HIGH" | "MED" | "LOW";

export type PropertyOwnerNameMatch =
  | "exact"        // full normalized name match
  | "surname"      // surname only — common with spouse-only-on-title cases
  | "trust_or_llc" // owner string contains contact surname inside a trust/LLC suffix
  | "fuzzy"        // minor variation (initial vs first name, hyphenation)
  | "no_match";    // address resolved but owner names do not align

export type PropertyOccupancyHint =
  | "owner_occupied_likely" // mailing == situs
  | "absentee_likely"       // mailing != situs (excluding P.O. Box ambiguity)
  | "unknown";              // P.O. Box mailing, or missing data

export type PropertyPermitCategory =
  | "roof"
  | "kitchen"
  | "bath"
  | "addition"
  | "structural"
  | "other";

export interface PropertyPermitSignal {
  permitNumber: string;
  filedAt: string;              // ISO-8601, verbatim from source
  category: PropertyPermitCategory;
  descriptionVerbatim: string;  // never paraphrased
}

export interface PropertyAssessedValueTrend {
  previousValue: number;
  currentValue: number;
  /** Computed: ((currentValue - previousValue) / previousValue) * 100. */
  deltaPct: number;
  windowYears: number;
}

export interface PropertyIntelligenceEntry {
  // ── Provenance (mandatory; constitution §2) ──────────────────────
  source: string;        // canonical provider id: "regrid" | "estated" | "<county>_assessor"
  fetchedAt: string;     // ISO-8601 UTC instant
  confidence: PropertyIntelligenceConfidence;
  status: PropertyIntelligenceStatus;
  reason?: string;       // canonical vocabulary when status !== "matched"

  // ── Public-record identifiers ────────────────────────────────────
  county: string;        // verbatim from provider, e.g. "Jackson County, MO"
  parcelId: string;
  situsAddress: string;  // provider's normalized address

  // ── Owner-attribution ────────────────────────────────────────────
  ownerNameOnRecord: string;  // verbatim public-record string
  ownerNameMatch: PropertyOwnerNameMatch;

  // ── HIGH-trust public-record facts ───────────────────────────────
  ownershipYears: number | null;   // null when ownershipStartDate missing
  lastSaleDate: string | null;     // ISO-8601, verbatim from source

  // ── MED-trust derived signals (optional) ─────────────────────────
  assessedValueTrend?: PropertyAssessedValueTrend;
  occupancyHint?: PropertyOccupancyHint;

  // ── HIGH-trust public-record events (optional) ───────────────────
  permitSignals?: PropertyPermitSignal[];

  // ── Direct citation link ─────────────────────────────────────────
  sourceUrl?: string;
}

export type ContactEnrichment = {
  hunter?: HunterEnrichmentEntry;
  propertyIntelligence?: PropertyIntelligenceEntry;
  /** Opportunity scoring output from lib/enrichment/opportunity/.
   *  Stored under source_metadata.enrichment.opportunity via the
   *  applyContactOpportunityNeon writer. The shape is the
   *  OpportunitySignal type from lib/enrichment/opportunity/types.ts;
   *  we declare a structural alias here to avoid pulling the
   *  opportunity layer into the crm-import type-graph circularly. */
  opportunity?: import("@/lib/enrichment/opportunity/types").OpportunitySignal;
};

// ── Founder-led CRM rehabilitation (append-only repair log) ────────
//
// Repairs are operator/founder-confirmed corrections to specific CRM
// fields that were missing or malformed at import time. The original
// imported value is ALWAYS preserved in `normalized.*` JSONB. Repairs
// are layered as an append-only array under `source_metadata.repairs`;
// the adapter overlays them at read time so every downstream consumer
// sees effective values without losing audit history.
//
// Governed by docs/INTELLIGENCE_SYSTEM_CONSTITUTION.md:
//   §1 Source-of-Truth Hierarchy — repairs are T1 operator-entered
//       content. They sit between T1 notes and T3 imported tags.
//   §2 Provenance Requirements — every repair carries originalValue,
//       newValue, source, repairedAt. Never anonymous.
//   §5 Deterministic Signal Rules — overlay merge order is chronological;
//       same input → same effective values.

export type ContactRepairField = "name" | "company" | "email" | "phone" | "address";

export type ContactRepairSource = "founder_rehab" | "operator_self";

export interface ContactRepair {
  field: ContactRepairField;
  /** Verbatim value from `normalized.<field>` at import time. Always
   *  the import-time truth, even across multiple repairs to the same
   *  field. */
  originalValue: string | null;
  newValue: string;
  source: ContactRepairSource;
  repairedAt: string; // ISO-8601 UTC
  /** Operator/founder id (e.g. session.id). Optional, never required
   *  for the writer to succeed; auditor uses it when present. */
  operator?: string;
  /** Optional free-text context, e.g. "confirmed via phone call".
   *  Never AI-generated. */
  note?: string;
}

export type ImportDiagnostics = {
  detectedHeaders: string[];
  columnMapping: ColumnMapping;
  mappedPhoneColumns: string[];
  mappedEmailColumns: string[];
  unmappedPhoneLikeHeaders: string[];
  unmappedEmailLikeHeaders: string[];
  rowsMissingPhone: number;
  rowsMissingEmail: number;
  rowsMissingBoth: number;
  totalRows: number;
  phoneMissingPct: number;
  emailReachablePct: number;
  highPhoneMissingRate: boolean;
  /** Phone-sparse export with usable email — relationship workspace should lean on email + history. */
  isEmailFirstExport: boolean;

  // ── Assembly diagnostics (Commit: import hardening) ─────────────
  /** True when the CSV had no single-value name column AND `firstName`+`lastName` components produced the row's name. */
  detectsSplitName: boolean;
  /** Rows whose `name` was assembled from First Name + Last Name. */
  rowsAssembledFromComponents: number;
  /** Same for address — `street` + `city` + `state` + `postalCode` flowing into a single line. */
  detectsSplitAddress: boolean;
  rowsAddressAssembledFromComponents: number;
  /** Rows whose final name is single-token (no surname) — operator should be alerted. */
  rowsMissingSurname: number;
  /** Rows whose final address fails canonicalization (missing city/state/zip). */
  rowsWithWeakAddress: number;
  /** Sample assembled rows so operator can sanity-check the preview before clicking Import. */
  assemblySamples: Array<{
    fromName: string;
    fromAddress: string;
  }>;
};

export type ImportPreviewResult = {
  jobId: string;
  headers: string[];
  suggestedMapping: ColumnMapping;
  rows: NormalizedCrmContact[];
  diagnostics: ImportDiagnostics;
  validationSummary: {
    valid: number;
    warnings: number;
    errors: number;
  };
  dedupeSummary: {
    unique: number;
    safeMerge: number;
    likelyDuplicate: number;
    manualReview: number;
  };
  mergeRecommendations: MergeRecommendation[];
};

export type ImportExecuteResult = {
  jobId: string;
  state: ImportProgressState;
  imported: number;
  skipped: number;
  duplicates: number;
  rollbackSnapshotId: string;
};
