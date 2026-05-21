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
