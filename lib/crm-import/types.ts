// Meridian CRM import — canonical types for contact ingestion.

export type CrmImportField =
  | "name"
  | "company"
  | "phone"
  | "email"
  | "address"
  | "notes"
  | "tags"
  | "lastInteraction"
  | "sourceCrm";

export const CRM_IMPORT_FIELDS: CrmImportField[] = [
  "name",
  "company",
  "phone",
  "email",
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
};

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
