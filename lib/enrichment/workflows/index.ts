// Meridian — Brookside targeted-enrichment public surface.

export {
  buildAudit,
  sortOutcomes,
  summarizeOutcomes,
  type EnrichmentAudit,
  type EnrichmentAuditSummary,
  type EnrichmentMatchConfidence,
  type EnrichmentMatchType,
  type EnrichmentOutcome,
  type EnrichmentResult,
} from "./enrichmentAudit";

export {
  buildEnrichmentQueue,
  candidateFromBriefItem,
  type QueueCandidate,
  type QueueDecision,
  type QueueResult,
} from "./enrichmentQueue";

export {
  DEFAULT_POLICY,
  ENRICHMENT_SKIP_REASONS,
  emptyLedger,
  isWithinRecencyWindow,
  ledgerFromFile,
  ledgerToFile,
  ledgerWithEnrichment,
  normalizePolicy,
  type EnrichmentLedger,
  type EnrichmentLedgerFile,
  type EnrichmentPolicy,
  type EnrichmentSkipReason,
  type LedgerEntry,
} from "./enrichmentPolicy";

export {
  runTargetedEnrichment,
  type TargetedEnrichmentInput,
  type TargetedEnrichmentResult,
} from "./targetedEnrichment";
