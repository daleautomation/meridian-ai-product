// Meridian Relationship Engine — read-only service layer contracts.
//
// Services are the only internal callers that should orchestrate repositories
// for relationship intelligence. They expose projections and diagnostics, never
// storage adapters, write handles, queue execution, or UI-shaped state.

import type {
  ConfidenceLevel,
  EngineContext,
  IsoDateString,
  RelationshipId,
  TimelineEventId,
} from "../primitives";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type { RelationshipEntity } from "../relationship/entities";
import type { RelationshipQuery } from "../repositories/interfaces";
import type {
  FollowUpRepository,
  PageRequest,
  PageResult,
  RelationshipRepository,
  ScoringRepository,
  TimelineRepository,
} from "../repositories/interfaces";
import type { ReadOnlyTimelineSourceAdapter } from "../repositories/boundaries";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type { TimelineEvent } from "../timeline/events";
import type { TimelineNormalizationWarning } from "../adapters/sourceTypes";
import type {
  RelationshipProjectionEvidencePointer,
  RelationshipProjectionMissingData,
  RelationshipSummaryProjection,
} from "../projections/dto";
import type {
  RelationshipFeedProjection,
  RelationshipQueueProjection,
  RelationshipTimelineProjection,
} from "../projections/operatorReadModels";

export type RelationshipEngineReadRelationshipRepository = Pick<
  RelationshipRepository,
  "getById" | "find" | "summarize"
>;

export type RelationshipEngineReadTimelineRepository = Pick<TimelineRepository, "list">;

export type RelationshipEngineReadFollowUpRepository = Pick<
  FollowUpRepository,
  "listOpenPromises" | "listDueInstructions"
>;

export type RelationshipEngineReadScoringRepository = Pick<
  ScoringRepository,
  "getLatestHealthTrace" | "listHealthTraces"
>;

export interface RelationshipEngineReadRepositories {
  relationships: RelationshipEngineReadRelationshipRepository;
  timeline?: RelationshipEngineReadTimelineRepository;
  followUps?: RelationshipEngineReadFollowUpRepository;
  scoring?: RelationshipEngineReadScoringRepository;
  timelineSources?: ReadOnlyTimelineSourceAdapter;
}

export interface RelationshipServiceOptions {
  pageSize?: number;
  maxPages?: number;
  staleTimelineAfterDays?: number;
  staleProjectionAfterHours?: number;
  followUpLookaheadDays?: number;
  followUpDueBefore?: IsoDateString;
}

export interface RelationshipByIdReadRequest {
  context: EngineContext;
  relationshipId: RelationshipId;
  options?: RelationshipServiceOptions;
}

export interface RelationshipCollectionReadRequest {
  context: EngineContext;
  relationshipIds?: RelationshipId[];
  query?: Omit<RelationshipQuery, "workspaceId" | "page">;
  page?: PageRequest;
  options?: RelationshipServiceOptions;
}

export type RelationshipServiceIssueSeverity = "error" | "warning";

export interface RelationshipServiceIssue {
  severity: RelationshipServiceIssueSeverity;
  code: string;
  message: string;
  relationshipId?: RelationshipId;
  timelineEventId?: TimelineEventId;
  source?: string;
}

export interface RelationshipServiceValidationResult {
  ok: boolean;
  issues: RelationshipServiceIssue[];
}

export interface RelationshipServiceReadResult<T> {
  data: T;
  generatedAt: IsoDateString;
  validation: RelationshipServiceValidationResult;
  warnings: RelationshipServiceIssue[];
  confidence: ConfidenceLevel;
  evidence: RelationshipProjectionEvidencePointer[];
  missingDataEffects: RelationshipProjectionMissingData[];
}

export interface RelationshipTimelineMemory {
  relationshipIds: RelationshipId[];
  timelineEvents: TimelineEvent[];
  normalizationWarnings: TimelineNormalizationWarning[];
  validation: RelationshipServiceValidationResult;
}

export interface RelationshipCanonicalReadSet {
  relationship: RelationshipEntity;
  timelineEvents: TimelineEvent[];
  promises: PromiseRecord[];
  followUpInstructions: FollowUpInstruction[];
  healthTrace: HealthScoreTrace | null;
  warnings: RelationshipServiceIssue[];
}

export interface RelationshipReadModelCanonicalSet {
  relationships: RelationshipEntity[];
  summaries: RelationshipSummaryProjection[];
  timelineEvents: TimelineEvent[];
  promises: PromiseRecord[];
  followUpInstructions: FollowUpInstruction[];
  healthTraces: HealthScoreTrace[];
  warnings: RelationshipServiceIssue[];
  validation: RelationshipServiceValidationResult;
}

export type RelationshipFeedProjectionSet = Record<RelationshipFeedProjection["feedKind"], RelationshipFeedProjection>;
export type RelationshipQueueProjectionSet = Record<RelationshipQueueProjection["queueKind"], RelationshipQueueProjection>;

export interface RelationshipProjectionBundle {
  summary: RelationshipSummaryProjection;
  timeline: RelationshipTimelineProjection;
  feeds: RelationshipFeedProjectionSet;
  queues: RelationshipQueueProjectionSet;
}

export interface RelationshipPageCollector<TQuery, TItem> {
  (query: TQuery): Promise<PageResult<TItem>>;
}
