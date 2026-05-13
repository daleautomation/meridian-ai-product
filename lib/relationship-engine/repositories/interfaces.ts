// Meridian Relationship Engine — repository boundaries.
//
// Interfaces describe engine persistence needs without naming storage
// technology. Adapters may target Neon, files, APIs, or tests externally.

import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type { RelationshipEntity, RelationshipSummary } from "../relationship/entities";
import type { LifecycleState } from "../relationship/lifecycle";
import type {
  IsoDateString,
  OperatorId,
  RelationshipId,
  WorkspaceId,
} from "../primitives";
import type { QueueCandidate } from "../queue/candidate";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type { TimelineEvent } from "../timeline/events";

export interface PageRequest {
  limit: number;
  cursor?: string;
}

export interface PageResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface RelationshipQuery {
  workspaceId: WorkspaceId;
  lifecycle?: LifecycleState[];
  ownerId?: OperatorId;
  updatedAfter?: IsoDateString;
  page?: PageRequest;
}

export interface RelationshipRepository {
  getById(id: RelationshipId): Promise<RelationshipEntity | null>;
  find(query: RelationshipQuery): Promise<PageResult<RelationshipEntity>>;
  save(entity: RelationshipEntity): Promise<RelationshipEntity>;
  summarize(id: RelationshipId): Promise<RelationshipSummary | null>;
}

export interface TimelineQuery {
  relationshipId: RelationshipId;
  occurredAfter?: IsoDateString;
  occurredBefore?: IsoDateString;
  categories?: TimelineEvent["category"][];
  page?: PageRequest;
}

export interface TimelineRepository {
  append(event: TimelineEvent): Promise<TimelineEvent>;
  getById(id: TimelineEvent["id"]): Promise<TimelineEvent | null>;
  list(query: TimelineQuery): Promise<PageResult<TimelineEvent>>;
}

export interface FollowUpRepository {
  listOpenPromises(relationshipId: RelationshipId): Promise<PromiseRecord[]>;
  savePromise(record: PromiseRecord): Promise<PromiseRecord>;
  listDueInstructions(args: {
    workspaceId: WorkspaceId;
    dueBefore: IsoDateString;
    ownerId?: OperatorId;
  }): Promise<FollowUpInstruction[]>;
}

export interface ScoringRepository {
  saveHealthTrace(trace: HealthScoreTrace): Promise<HealthScoreTrace>;
  getLatestHealthTrace(relationshipId: RelationshipId): Promise<HealthScoreTrace | null>;
  listHealthTraces(relationshipId: RelationshipId, page?: PageRequest): Promise<PageResult<HealthScoreTrace>>;
}

export interface QueueRepository {
  saveCandidate(candidate: QueueCandidate): Promise<QueueCandidate>;
  listCandidates(args: {
    workspaceId: WorkspaceId;
    ownerId?: OperatorId;
    generatedAfter?: IsoDateString;
    page?: PageRequest;
  }): Promise<PageResult<QueueCandidate>>;
  clearCandidate(id: QueueCandidate["id"], reason: string): Promise<void>;
}
