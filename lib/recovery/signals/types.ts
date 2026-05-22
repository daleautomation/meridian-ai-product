// Meridian — Recovery signal type layer.
//
// Canonical shapes for raw observations, decay-weighted contributions, and
// ranked brief cards. Mirrors autonomy/SIGNAL_TRUST_RULES.md §2–§3.
//
// Types and type guards only — no decay math, no ranking, no I/O.

// ── Trust & confidence tiers ────────────────────────────────────────

/** Source trust tier per SIGNAL_TRUST_RULES.md §3. */
export type SourceTrustTier = "HIGH" | "MED" | "WEAK" | "BANNED";

/** Per-signal confidence per SIGNAL_TRUST_RULES.md §2 (not BANNED). */
export type SignalConfidence = "HIGH" | "MED" | "WEAK";

/** Pipeline lifecycle for a signal instance (ingestion → evaluation). */
export type SignalStatus =
  | "active"
  | "stale"
  | "weak"
  | "banned"
  | "excluded";

/**
 * Domain of the underlying observation. Used for grouping and config;
 * does not affect ranking math.
 */
export type SignalCategory =
  | "public_record"
  | "permit"
  | "mortgage"
  | "business_filing"
  | "places"
  | "crm"
  | "ads"
  | "weather"
  | "licensing"
  | "relationship"
  | "contact_path"
  | "listing"
  | "regulatory"
  | "other";

// ── Canonical raw signal (§2 + pipeline metadata) ───────────────────

/**
 * A single named, dated, sourced observation entering the recovery pipeline.
 * Required §2 fields must be present; extended fields support isolation and
 * disclosure without changing the trust contract.
 */
export interface RecoverySignal {
  /** Stable id for this signal instance (ingestion-time). */
  id: string;
  /** Canonical signal name (e.g. `permit_pulled`, `prior_client`). */
  name: string;
  category: SignalCategory;
  /** Origin label (e.g. `county_recorder:king_wa`, `crm:hubspot`). */
  source: string;
  /** Trust tier of the source per §3. */
  sourceTier: SourceTrustTier;
  /** Stable record id at the source (deed #, permit #, CRM activity id). */
  recordId: string;
  /** When the underlying event happened (ISO-8601 UTC), not fetch time. */
  observedAt: string;
  confidence: SignalConfidence;
  /** Per-signal decay constant (§4); same as `decayHalfLifeDays` in docs. */
  halfLifeDays: number;
  /** Workspace-config weight, 0–100. */
  weight: number;
  /** Public URL or internal link; null if re-derivable from source + recordId. */
  evidenceUrl: string | null;
  /** Optional human-readable evidence label for disclosure UI. */
  evidenceLabel?: string | null;
  /**
   * Deterministic, source-traceable explanation (never AI-generated).
   * Optional; brief copy is built elsewhere from contributions.
   */
  explanation?: string | null;
  /** Optional URL when recordId is not itself a URL. */
  sourceUrl?: string | null;
  /** Optional source-specific context; never used for ranking (§2). */
  payload: Record<string, unknown> | null;
  /** Owning workspace slug when known (§7 isolation). */
  workspaceSlug?: string;
  /** Customer slug alias when distinct from workspace. */
  customerSlug?: string;
  /** Pipeline status (active input vs filtered/stale/banned). */
  status: SignalStatus;
}

// ── Evaluated contributions & ranked cards ───────────────────────────

/**
 * One signal's decay-weighted contribution at evaluation time.
 * Emitted verbatim for brief disclosure (T9).
 */
export interface SignalContribution {
  name: string;
  weight: number;
  contribution: number;
  observedAt: string;
  /** Multiplier applied by half-life decay (0–1). */
  decayApplied: number;
  source: string;
  recordId: string;
  evidenceUrl: string | null;
  confidence: SignalConfidence;
}

/** Alias for evaluated per-signal contribution (scoring path). */
export type ScoredContribution = SignalContribution;

/** Per-lead score decomposition at a fixed `now`. */
export interface ScoreBreakdown {
  leadKey: string;
  totalScore: number;
  contributions: SignalContribution[];
  /** ISO-8601 instant used for decay (passed in, never Date.now() here). */
  evaluatedAt: string;
}

/**
 * Contribution fields surfaced on a ranked brief card disclosure.
 * Superset of display-oriented fields; same trust data as SignalContribution.
 */
export interface RankedBriefCardSignalContribution {
  name: string;
  source: string;
  observedAt: string;
  weight: number;
  contribution: number;
  decayApplied: number;
  recordId: string;
  evidenceUrl: string | null;
  evidenceLabel: string | null;
  confidence: SignalConfidence;
}

/** Ranked lead ready for recovery-brief-builder. */
export interface RankedCard {
  leadKey: string;
  score: number;
  contributions: SignalContribution[];
  /** Canonical name of the top contributing signal, if any. */
  headlineSignal: string | null;
  /** True when the top contributor is WEAK-only (§3, §6). */
  weakOnly: boolean;
}

// ── Workspace signal config (declarative; consumed by evaluator) ────

export interface SignalDefinition {
  name: string;
  category: SignalCategory;
  /** Canonical source label; must map to a §3.1 tier row. */
  source: string;
  sourceTier: SourceTrustTier;
  defaultHalfLifeDays: number;
  defaultWeight: number;
}

/**
 * Declarative inverse-time ramp (§5). The evaluator applies a pure function
 * from these parameters — no curves are implied here.
 */
export interface RampDefinition {
  kind: "linear" | "step";
  /** Days since observation at which the ramp begins. */
  startDays: number;
  /** Days since observation at which the ramp ends. */
  endDays: number;
  /** Contribution factor at startDays. */
  startFactor: number;
  /** Contribution factor at endDays. */
  endFactor: number;
}

export interface WorkspaceSignalConfig {
  slug: string;
  signals: SignalDefinition[];
  ramps?: Record<string, RampDefinition>;
}

// ── Literal sets for guards ───────────────────────────────────────────

const SOURCE_TRUST_TIER_SET: ReadonlySet<SourceTrustTier> = new Set<SourceTrustTier>([
  "HIGH",
  "MED",
  "WEAK",
  "BANNED",
]);

const SIGNAL_CONFIDENCE_SET: ReadonlySet<SignalConfidence> = new Set<SignalConfidence>([
  "HIGH",
  "MED",
  "WEAK",
]);

const SIGNAL_STATUS_SET: ReadonlySet<SignalStatus> = new Set<SignalStatus>([
  "active",
  "stale",
  "weak",
  "banned",
  "excluded",
]);

const SIGNAL_CATEGORY_SET: ReadonlySet<SignalCategory> = new Set<SignalCategory>([
  "public_record",
  "permit",
  "mortgage",
  "business_filing",
  "places",
  "crm",
  "ads",
  "weather",
  "licensing",
  "relationship",
  "contact_path",
  "listing",
  "regulatory",
  "other",
]);

const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIso8601Timestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_8601_RE.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

// ── Type guards ───────────────────────────────────────────────────────

export function isSourceTrustTier(value: unknown): value is SourceTrustTier {
  return typeof value === "string" && SOURCE_TRUST_TIER_SET.has(value as SourceTrustTier);
}

export function isSignalConfidence(value: unknown): value is SignalConfidence {
  return typeof value === "string" && SIGNAL_CONFIDENCE_SET.has(value as SignalConfidence);
}

export function isSignalStatus(value: unknown): value is SignalStatus {
  return typeof value === "string" && SIGNAL_STATUS_SET.has(value as SignalStatus);
}

export function isSignalCategory(value: unknown): value is SignalCategory {
  return typeof value === "string" && SIGNAL_CATEGORY_SET.has(value as SignalCategory);
}

/**
 * Structural check for SIGNAL_TRUST_RULES.md §2 required fields on a raw signal.
 * Does not prove re-derivability of evidence — that is an ingestion/auditor concern.
 */
export function isWellFormedSignal(value: unknown): value is RecoverySignal {
  if (!isPlainObject(value)) return false;

  const v = value as Record<string, unknown>;

  if (!isNonEmptyString(v.id)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (!isSignalCategory(v.category)) return false;
  if (!isNonEmptyString(v.source)) return false;
  if (!isSourceTrustTier(v.sourceTier)) return false;
  if (v.sourceTier === "BANNED") return false;
  if (!isNonEmptyString(v.recordId)) return false;
  if (!isIso8601Timestamp(v.observedAt)) return false;
  if (!isSignalConfidence(v.confidence)) return false;

  const halfLifeDays = v.halfLifeDays;
  if (typeof halfLifeDays !== "number" || !Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    return false;
  }

  const weight = v.weight;
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0 || weight > 100) {
    return false;
  }

  if (!isNullableString(v.evidenceUrl)) return false;

  if (v.evidenceLabel !== undefined && v.evidenceLabel !== null && typeof v.evidenceLabel !== "string") {
    return false;
  }
  if (v.explanation !== undefined && v.explanation !== null && typeof v.explanation !== "string") {
    return false;
  }
  if (v.sourceUrl !== undefined && v.sourceUrl !== null && typeof v.sourceUrl !== "string") {
    return false;
  }

  if (v.payload !== null && !isPlainObject(v.payload)) return false;

  if (v.workspaceSlug !== undefined && !isNonEmptyString(v.workspaceSlug)) return false;
  if (v.customerSlug !== undefined && !isNonEmptyString(v.customerSlug)) return false;

  if (!isSignalStatus(v.status)) return false;
  if (v.status === "banned") return false;

  return true;
}
