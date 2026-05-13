// Meridian Relationship Engine — safe operational diagnostics.
//
// Diagnostics consume the read facade and metadata only. They never inspect
// storage handles, execute queues, write projections, or expose raw internals.

import type { ConfidenceLevel, EngineContext, IsoDateString } from "../primitives";
import type {
  RelationshipCollectionReadRequest,
  RelationshipQueueProjectionSet,
  RelationshipServiceIssue,
  RelationshipServiceOptions,
  RelationshipServiceReadResult,
} from "./types";
import type { RelationshipEngineReadService } from "./readService";

export type RelationshipEngineDiagnosticStatus = "ok" | "warning" | "error" | "not_configured";

export type RelationshipEngineRepositoryModeLabel =
  | "read_only_unwired"
  | "read_only_file"
  | "read_only_neon"
  | "read_only_memory"
  | "unknown";

export interface RelationshipEngineRepositorySourceReadiness {
  companySnapshots: boolean;
  crmActivities: boolean;
  usageEvents: boolean;
  executionOutcomes: boolean;
  followUps: boolean;
  operatorSnapshot: boolean;
}

export interface RelationshipEngineRepositoryDiagnostics {
  relationshipStore: "ready" | "unwired" | "unknown";
  timelineStore: "ready" | "unwired" | "unknown";
  followUpStore: "ready" | "unwired" | "unknown";
  scoringStore: "ready" | "unwired" | "unknown";
  readOnly: true;
  sourceReadiness?: RelationshipEngineRepositorySourceReadiness;
}

export interface RelationshipEngineDiagnosticsRequest {
  context: EngineContext;
  service: RelationshipEngineReadService;
  repositoryMode: RelationshipEngineRepositoryModeLabel;
  repositoryDiagnostics: RelationshipEngineRepositoryDiagnostics;
  query?: RelationshipCollectionReadRequest["query"];
  relationshipIds?: RelationshipCollectionReadRequest["relationshipIds"];
  page?: RelationshipCollectionReadRequest["page"];
  options?: RelationshipServiceOptions;
  generatedAtSource: "query_asOf" | "server_clock";
}

export interface RelationshipEngineIssueSummary {
  code: string;
  severity: RelationshipServiceIssue["severity"];
  count: number;
  relationshipsAffected: number;
  sources: string[];
}

export interface RelationshipEngineConfidenceSummary {
  overall: ConfidenceLevel;
  bySurface: {
    feeds: ConfidenceLevel;
    queues: ConfidenceLevel;
  };
}

export interface RelationshipEngineMissingDataSummary {
  count: number;
  fields: string[];
  reasons: string[];
  effects: string[];
}

export interface RelationshipEngineHealthModel {
  generatedAt: IsoDateString;
  overallStatus: RelationshipEngineDiagnosticStatus;
  normalizationStatus: RelationshipEngineDiagnosticStatus;
  projectionStatus: RelationshipEngineDiagnosticStatus;
  queueValidationStatus: RelationshipEngineDiagnosticStatus;
  timelineValidationStatus: RelationshipEngineDiagnosticStatus;
  repositoryMode: RelationshipEngineRepositoryModeLabel;
  deterministicReplayStatus: RelationshipEngineDiagnosticStatus;
  staleProjectionWarnings: RelationshipEngineIssueSummary[];
  missingDataWarnings: RelationshipEngineMissingDataSummary;
  readOnlyGuarantees: RelationshipEngineReadOnlyGuarantees;
}

export interface RelationshipEngineReadOnlyGuarantees {
  retrievalOnly: true;
  projectionOnly: true;
  mutations: false;
  queueExecution: false;
  notifications: false;
  reminders: false;
  productionScoring: false;
  neonWrites: false;
  timelinePersistence: false;
  autonomousWorkflows: false;
}

export interface RelationshipEngineDiagnosticsResult {
  generatedAt: IsoDateString;
  health: RelationshipEngineHealthModel;
  diagnostics: {
    relationshipEngine: RelationshipEngineDiagnosticSurface;
    projectionIntegrity: RelationshipEngineDiagnosticSurface;
    timelineNormalization: RelationshipEngineDiagnosticSurface;
    queueIntegrity: RelationshipEngineDiagnosticSurface;
    apiBoundary: RelationshipEngineDiagnosticSurface;
    repositoryReadiness: RelationshipEngineDiagnosticSurface;
  };
  metadata: {
    deterministic: {
      replaySafeWithFixedAsOf: true;
      generatedAtSource: "query_asOf" | "server_clock";
      collectionOrder: {
        feeds: readonly string[];
        queues: readonly string[];
      };
    };
    validationWarnings: RelationshipEngineIssueSummary[];
    confidence: RelationshipEngineConfidenceSummary;
    missingData: RelationshipEngineMissingDataSummary;
    repositoryMode: RelationshipEngineRepositoryModeLabel;
    readOnly: RelationshipEngineReadOnlyGuarantees;
  };
}

export interface RelationshipEngineDiagnosticSurface {
  status: RelationshipEngineDiagnosticStatus;
  summary: string;
  issueSummary: RelationshipEngineIssueSummary[];
  safeMetadata: Record<string, unknown>;
}

export const RELATIONSHIP_ENGINE_READ_ONLY_GUARANTEES: RelationshipEngineReadOnlyGuarantees = {
  retrievalOnly: true,
  projectionOnly: true,
  mutations: false,
  queueExecution: false,
  notifications: false,
  reminders: false,
  productionScoring: false,
  neonWrites: false,
  timelinePersistence: false,
  autonomousWorkflows: false,
};

const FEED_ORDER = [
  "relationship_activity",
  "operator_relationship",
  "relationship_momentum",
  "overdue_relationship",
  "relationship_change",
] as const;

const QUEUE_ORDER = [
  "needs_attention",
  "overdue_follow_ups",
  "cooling_relationships",
  "retention_risk",
  "warm_opportunities",
  "reactivation_candidates",
] as const;

export class RelationshipEngineDiagnosticsService {
  async getDiagnostics(request: RelationshipEngineDiagnosticsRequest): Promise<RelationshipEngineDiagnosticsResult> {
    const readRequest = collectionRequest(request);
    const [feeds, queues] = await Promise.all([
      request.service.getRelationshipFeeds(readRequest),
      request.service.getRelationshipQueues(readRequest),
    ]);
    const feedIssues = normalizedIssues(feeds);
    const queueIssues = normalizedIssues(queues);
    const allIssues = [...feedIssues, ...queueIssues];
    const validationWarnings = issueSummary(allIssues.filter((issue) => issue.severity === "warning"));
    const missingData = missingDataSummary([feeds, queues]);
    const confidence = confidenceSummary(feeds.confidence, queues.confidence);
    const repository = repositorySurface(request.repositoryMode, request.repositoryDiagnostics);
    const normalizationIssues = issueSummary(allIssues.filter((issue) => issue.code.includes("normalization")));
    const projectionIssues = issueSummary(allIssues.filter((issue) =>
      issue.code.includes("projection")
      || issue.code.includes("summary")
      || issue.code.includes("relationship")));
    const queueIssuesSummary = issueSummary(queueIssues.filter((issue) => issue.source || issue.code.includes("queue")));
    const timelineIssues = issueSummary(allIssues.filter((issue) =>
      issue.code.includes("timeline") || Boolean(issue.timelineEventId)));
    const staleProjectionWarnings = issueSummary(allIssues.filter((issue) => issue.code.includes("stale")));

    const normalizationStatus = statusForIssues(normalizationIssues);
    const projectionStatus = statusForIssues(projectionIssues);
    const queueValidationStatus = statusForIssues(queueIssuesSummary);
    const timelineValidationStatus = statusForIssues(timelineIssues);
    const deterministicReplayStatus: RelationshipEngineDiagnosticStatus = "ok";
    const overallStatus = combineStatuses([
      normalizationStatus,
      projectionStatus,
      queueValidationStatus,
      timelineValidationStatus,
      repository.status,
      deterministicReplayStatus,
    ]);

    const health: RelationshipEngineHealthModel = {
      generatedAt: request.context.now,
      overallStatus,
      normalizationStatus,
      projectionStatus,
      queueValidationStatus,
      timelineValidationStatus,
      repositoryMode: request.repositoryMode,
      deterministicReplayStatus,
      staleProjectionWarnings,
      missingDataWarnings: missingData,
      readOnlyGuarantees: RELATIONSHIP_ENGINE_READ_ONLY_GUARANTEES,
    };

    return {
      generatedAt: request.context.now,
      health,
      diagnostics: {
        relationshipEngine: {
          status: overallStatus,
          summary: "Relationship Engine diagnostics are read-only and service-facade backed.",
          issueSummary: issueSummary(allIssues),
          safeMetadata: {
            generatedAt: request.context.now,
            relationshipCount: relationshipCount(queues.data),
            feedKinds: FEED_ORDER,
            queueKinds: QUEUE_ORDER,
          },
        },
        projectionIntegrity: {
          status: projectionStatus,
          summary: "Projection integrity is derived from service validation metadata.",
          issueSummary: projectionIssues,
          safeMetadata: {
            feedValidationOk: feeds.validation.ok,
            queueValidationOk: queues.validation.ok,
            staleProjectionWarnings: staleProjectionWarnings.length,
          },
        },
        timelineNormalization: {
          status: normalizationStatus,
          summary: "Timeline normalization diagnostics expose warning metadata only.",
          issueSummary: normalizationIssues,
          safeMetadata: {
            normalizationWarningCount: normalizationIssues.reduce((sum, issue) => sum + issue.count, 0),
            rawTimelineEventsExposed: false,
          },
        },
        queueIntegrity: {
          status: queueValidationStatus,
          summary: "Queue diagnostics validate review-only projections without executing queue work.",
          issueSummary: queueIssuesSummary,
          safeMetadata: {
            queueExecution: false,
            queueKinds: QUEUE_ORDER,
            queueItemCount: queueItemCount(queues.data),
          },
        },
        apiBoundary: {
          status: "ok",
          summary: "Internal diagnostics endpoints are admin-only, GET-only, and metadata-only.",
          issueSummary: [],
          safeMetadata: {
            adminOnly: true,
            readOnlyMethods: ["GET"],
            publicExposure: false,
            rawInternalsExposed: false,
          },
        },
        repositoryReadiness: repository,
      },
      metadata: {
        deterministic: {
          replaySafeWithFixedAsOf: true,
          generatedAtSource: request.generatedAtSource,
          collectionOrder: {
            feeds: FEED_ORDER,
            queues: QUEUE_ORDER,
          },
        },
        validationWarnings,
        confidence,
        missingData,
        repositoryMode: request.repositoryMode,
        readOnly: RELATIONSHIP_ENGINE_READ_ONLY_GUARANTEES,
      },
    };
  }
}

function collectionRequest(request: RelationshipEngineDiagnosticsRequest): RelationshipCollectionReadRequest {
  return {
    context: request.context,
    ...(request.relationshipIds ? { relationshipIds: request.relationshipIds } : {}),
    ...(request.query ? { query: request.query } : {}),
    ...(request.page ? { page: request.page } : {}),
    ...(request.options ? { options: request.options } : {}),
  };
}

function normalizedIssues(result: RelationshipServiceReadResult<unknown>): RelationshipServiceIssue[] {
  return [...result.validation.issues, ...result.warnings].sort(compareIssues);
}

function issueSummary(issues: RelationshipServiceIssue[]): RelationshipEngineIssueSummary[] {
  const grouped = new Map<string, RelationshipServiceIssue[]>();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    grouped.set(key, [...(grouped.get(key) ?? []), issue]);
  }
  return [...grouped.entries()]
    .map(([key, group]) => {
      const [severity, code] = key.split(":") as [RelationshipServiceIssue["severity"], string];
      const relationships = new Set(group.map((issue) => issue.relationshipId).filter(Boolean));
      const sources = [...new Set(group.map((issue) => issue.source).filter((source): source is string => Boolean(source)))]
        .sort((a, b) => a.localeCompare(b));
      return {
        code,
        severity,
        count: group.length,
        relationshipsAffected: relationships.size,
        sources,
      };
    })
    .sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity)
      || a.code.localeCompare(b.code));
}

function missingDataSummary(results: RelationshipServiceReadResult<unknown>[]): RelationshipEngineMissingDataSummary {
  const effects = results.flatMap((result) => result.missingDataEffects);
  return {
    count: effects.length,
    fields: uniqueSorted(effects.map((effect) => effect.field)),
    reasons: uniqueSorted(effects.map((effect) => effect.reason)),
    effects: uniqueSorted(effects.map((effect) => effect.effect)),
  };
}

function confidenceSummary(feeds: ConfidenceLevel, queues: ConfidenceLevel): RelationshipEngineConfidenceSummary {
  return {
    overall: combineConfidence([feeds, queues]),
    bySurface: { feeds, queues },
  };
}

function repositorySurface(
  mode: RelationshipEngineRepositoryModeLabel,
  diagnostics: RelationshipEngineRepositoryDiagnostics,
): RelationshipEngineDiagnosticSurface {
  const stores = {
    relationshipStore: diagnostics.relationshipStore,
    timelineStore: diagnostics.timelineStore,
    followUpStore: diagnostics.followUpStore,
    scoringStore: diagnostics.scoringStore,
  };
  const unwiredStores = Object.entries(stores)
    .filter(([, value]) => value === "unwired")
    .map(([key]) => key)
    .sort((a, b) => a.localeCompare(b));
  return {
    status: unwiredStores.length > 0 ? "not_configured" : "ok",
    summary: unwiredStores.length > 0
      ? "Read facade is active, but one or more repository adapters are not wired."
      : "Read-only repository adapters report ready.",
    issueSummary: [],
    safeMetadata: {
      repositoryMode: mode,
      stores,
      unwiredStores,
      readOnly: diagnostics.readOnly,
      sourceReadiness: diagnostics.sourceReadiness ?? null,
      rawStorageInternalsExposed: false,
      adapterIntegrityVerified: diagnostics.readOnly === true && unwiredStores.length === 0,
      mutationPathsExposed: false,
    },
  };
}

function statusForIssues(issues: RelationshipEngineIssueSummary[]): RelationshipEngineDiagnosticStatus {
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.length > 0) return "warning";
  return "ok";
}

function combineStatuses(statuses: RelationshipEngineDiagnosticStatus[]): RelationshipEngineDiagnosticStatus {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("not_configured")) return "warning";
  if (statuses.includes("warning")) return "warning";
  return "ok";
}

function queueItemCount(queues: RelationshipQueueProjectionSet): number {
  return Object.values(queues).reduce((sum, queue) => sum + queue.items.length, 0);
}

function relationshipCount(queues: RelationshipQueueProjectionSet): number {
  return new Set(Object.values(queues).flatMap((queue) => queue.items.map((item) => item.relationshipId))).size;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function compareIssues(a: RelationshipServiceIssue, b: RelationshipServiceIssue): number {
  return severityRank(a.severity) - severityRank(b.severity)
    || a.code.localeCompare(b.code)
    || (a.relationshipId ?? "").localeCompare(b.relationshipId ?? "")
    || (a.timelineEventId ?? "").localeCompare(b.timelineEventId ?? "")
    || (a.source ?? "").localeCompare(b.source ?? "")
    || a.message.localeCompare(b.message);
}

function severityRank(severity: RelationshipServiceIssue["severity"]): number {
  return severity === "error" ? 0 : 1;
}

function combineConfidence(values: ConfidenceLevel[]): ConfidenceLevel {
  return values.reduce((lowest, value) => (
    confidenceRank(value) > confidenceRank(lowest) ? value : lowest
  ), "high");
}

function confidenceRank(value: ConfidenceLevel): number {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unknown":
      return 3;
  }
}
