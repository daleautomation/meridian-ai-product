// Meridian Relationship Engine — DTO boundary contracts.
//
// Internal entities are canonical. API, MCP, and UI DTOs are projections and
// must be produced through engine mappers, never by storage adapters directly.

import type { QueueCandidate } from "../queue/candidate";
import type { RelationshipEntity, RelationshipSummary } from "../relationship/entities";
import type { LifecycleState } from "../relationship/lifecycle";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type { TimelineEvent } from "../timeline/events";

export type RelationshipInternalEntity = RelationshipEntity;

export interface RelationshipApiDto {
  id: string;
  workspaceId: string;
  displayName: string;
  kind: RelationshipEntity["identity"]["kind"];
  lifecycle: LifecycleState;
  warmth: RelationshipEntity["warmth"]["band"];
  ownerIds: string[];
  primaryEmail?: string;
  primaryPhone?: string;
  updatedAt: string;
}

export interface RelationshipDetailApiDto extends RelationshipApiDto {
  summary: RelationshipSummary;
  latestHealthTrace?: HealthScoreTrace;
  recentTimeline: TimelineEvent[];
}

export interface RelationshipMcpDto {
  relationshipId: string;
  displayName: string;
  lifecycle: LifecycleState;
  allowedActions: string[];
  evidenceRequired: string[];
  summary: string;
}

export interface RelationshipUiDto {
  id: string;
  title: string;
  subtitle?: string;
  lifecycleLabel: string;
  warmthLabel: string;
  ownerLabel?: string;
  nextActionLabel?: string;
  healthScore?: number;
  healthExplanation?: string;
}

export interface QueueCandidateApiDto {
  id: string;
  relationshipId: string;
  ownerId?: string;
  rankScore: number;
  whyNow: string;
  nextBestAction: QueueCandidate["nextBestAction"];
  escalationReason?: QueueCandidate["escalationReason"];
  confidence: QueueCandidate["confidence"];
}

export interface DtoBoundaryPolicy {
  internalEntitiesAreCanonical: true;
  apiDtosAreSerializedContracts: true;
  mcpDtosMustCallEngineUseCases: true;
  uiDtosMayContainLabelsButNoScoringLogic: true;
  storageAdaptersMustNotReturnUiDtos: true;
}
