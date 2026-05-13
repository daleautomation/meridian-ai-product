// Meridian Relationship Engine — projection DTOs.
//
// Projections are read models over canonical relationship memory. They are
// intentionally richer than UI DTOs and contain enough evidence metadata for
// operators, queues, and MCP tools to explain what they are showing.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  PromiseId,
  RelationshipId,
  TimelineEventId,
} from "../primitives";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type {
  RelationshipSummary,
  RelationshipWarmthBand,
} from "../relationship/entities";
import type { LifecycleState } from "../relationship/lifecycle";
import type { TimelineEvent } from "../timeline/events";

export type RelationshipSummaryProjectionKind = "relationship_summary";

export type ProjectionInputSource =
  | "RelationshipEntity"
  | "TimelineEvent"
  | "PromiseRecord"
  | "HealthScoreTrace"
  | "FollowUpInstruction";

export type ProjectionMissingDataEffect =
  | "lowers_confidence"
  | "limits_visibility"
  | "neutral"
  | "not_applicable";

export interface RelationshipProjectionMissingData {
  field: string;
  reason:
    | "no_timeline_events"
    | "no_owner_assignment"
    | "no_health_trace"
    | "no_touchpoint"
    | "no_outcome"
    | "no_follow_up_instruction"
    | "no_promise_records"
    | "source_filtered_for_relationship";
  effect: ProjectionMissingDataEffect;
  message: string;
}

export interface RelationshipProjectionEvidencePointer {
  timelineEventId?: TimelineEventId;
  promiseId?: PromiseId;
  occurredAt?: IsoDateString;
  category?: TimelineEvent["category"];
  type?: TimelineEvent["type"];
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
  description: string;
}

export interface RelationshipProjectionExplanation {
  generatedBy: "relationship_summary_projection";
  generatedAt: IsoDateString;
  inputSources: ProjectionInputSource[];
  latestEvidence: RelationshipProjectionEvidencePointer[];
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  timelineReferences: TimelineEventId[];
  notes: string[];
}

export interface OwnerVisibilityProjection {
  primaryOwnerId?: OperatorId;
  collaboratorIds: OperatorId[];
  observerIds: OperatorId[];
  visibleTo: OperatorId[];
  unassigned: boolean;
  latestAssignmentEventId?: TimelineEventId;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface LatestTouchpointProjection {
  timelineEventId: TimelineEventId;
  occurredAt: IsoDateString;
  channel: Extract<TimelineEvent, { category: "touchpoint" }>["touchpoint"]["channel"];
  direction: Extract<TimelineEvent, { category: "touchpoint" }>["touchpoint"]["direction"];
  subject?: string;
  operatorId?: OperatorId;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface LatestOutcomeProjection {
  timelineEventId: TimelineEventId;
  outcomeId: Extract<TimelineEvent, { category: "outcome" }>["outcome"]["id"];
  kind: Extract<TimelineEvent, { category: "outcome" }>["outcome"]["kind"];
  label: string;
  occurredAt: IsoDateString;
  eventType: "outcome_recorded" | "outcome_updated" | "outcome_reversed";
  value?: number;
  notes?: string;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface OpenPromiseProjection {
  promiseId: PromiseId;
  title: string;
  ownerId?: OperatorId;
  dueAt?: IsoDateString;
  overdue: boolean;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface OverdueFollowUpProjection {
  dueAt: IsoDateString;
  ownerId?: OperatorId;
  reason: string;
  source: FollowUpInstruction["source"];
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface NextScheduledFollowUpProjection {
  dueAt: IsoDateString;
  ownerId?: OperatorId;
  reason: string;
  source: FollowUpInstruction["source"];
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface LatestRelationshipActivityProjection {
  timelineEventId: TimelineEventId;
  category: TimelineEvent["category"];
  type: TimelineEvent["type"];
  occurredAt: IsoDateString;
  recordedAt: IsoDateString;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
  description: string;
}

export type RelationshipMomentumHintKind =
  | "latest_touchpoint_observed"
  | "recent_positive_outcome"
  | "open_promise"
  | "overdue_follow_up"
  | "missing_owner"
  | "stale_activity"
  | "insufficient_timeline"
  | "missing_health_trace";

export interface RelationshipMomentumHint {
  kind: RelationshipMomentumHintKind;
  label: string;
  explanation: string;
  evidence: EvidenceRef[];
  timelineEventIds: TimelineEventId[];
  confidence: ConfidenceLevel;
}

export type RelationshipSummaryProjectionIssueSeverity = "error" | "warning";

export interface RelationshipSummaryProjectionIssue {
  severity: RelationshipSummaryProjectionIssueSeverity;
  code: string;
  message: string;
}

export interface RelationshipSummaryProjectionValidationResult {
  ok: boolean;
  issues: RelationshipSummaryProjectionIssue[];
}

export interface RelationshipSummaryProjection {
  kind: RelationshipSummaryProjectionKind;
  relationshipId: RelationshipId;
  generatedAt: IsoDateString;
  summary: RelationshipSummary;
  lifecycleState: LifecycleState;
  warmthState: RelationshipWarmthBand;
  ownerVisibility: OwnerVisibilityProjection;
  latestTouchpoint?: LatestTouchpointProjection;
  latestOutcome?: LatestOutcomeProjection;
  openPromises: OpenPromiseProjection[];
  overdueFollowUps: OverdueFollowUpProjection[];
  nextScheduledFollowUp?: NextScheduledFollowUpProjection;
  latestRelationshipActivity?: LatestRelationshipActivityProjection;
  momentumHints: RelationshipMomentumHint[];
  explanation: RelationshipProjectionExplanation;
  validation: RelationshipSummaryProjectionValidationResult;
}

export interface RelationshipSummaryProjectionBoundaryPolicy {
  allowedInputs: ProjectionInputSource[];
  forbiddenInputs: string[];
  readOnly: true;
  deterministic: true;
  persistsProjection: false;
  computesProductionScore: false;
  mutatesRepositories: false;
}

export interface RelationshipSummaryProjectionInputPolicy {
  promises?: PromiseRecord[];
  followUpInstructions?: FollowUpInstruction[];
}
