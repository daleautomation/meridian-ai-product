// Meridian Relationship Engine — canonical operational event envelopes.
//
// Type-only operational memory contracts. These envelopes are append-only facts
// for future replay and audit; they do not expose persistence, execution, queue,
// reminder, notification, Neon, repository, or automation behavior.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperationalEventDedupeKey,
  OperationalEventId,
  OperationalEventIdempotencyKey,
  OperatorId,
  RelationshipId,
  TimelineEventId,
  WorkspaceId,
} from "../primitives";

export type CanonicalOperationalEventFamily =
  | "review_history"
  | "assignment_history"
  | "continuity_history"
  | "workflow_progression"
  | "operator_handoff";

export type ReviewHistoryOperationalEventKind =
  | "review_started"
  | "review_completed"
  | "review_reopened"
  | "review_shared"
  | "review_escalated"
  | "manager_review_requested"
  | "manager_review_completed";

export type AssignmentHistoryOperationalEventKind =
  | "assignment_created"
  | "assignment_transferred"
  | "assignment_removed"
  | "assignment_visibility_changed"
  | "shared_review_started"
  | "shared_review_ended"
  | "ownership_clarified";

export type ContinuityHistoryOperationalEventKind =
  | "continuity_context_created"
  | "continuity_context_changed"
  | "continuity_context_resolved"
  | "continuity_gap_observed";

export type WorkflowProgressionOperationalEventKind =
  | "workflow_projection_observed"
  | "workflow_review_state_changed"
  | "workflow_progression_blocked"
  | "workflow_progression_unblocked";

export type OperatorHandoffOperationalEventKind =
  | "handoff_context_prepared"
  | "handoff_context_acknowledged"
  | "handoff_context_superseded";

export type CanonicalOperationalEventKind =
  | ReviewHistoryOperationalEventKind
  | AssignmentHistoryOperationalEventKind
  | ContinuityHistoryOperationalEventKind
  | WorkflowProgressionOperationalEventKind
  | OperatorHandoffOperationalEventKind;

export type CanonicalOperationalEventSource =
  | "operator"
  | "engine"
  | "api"
  | "integration"
  | "system";

export type OperationalActorRole =
  | "operator"
  | "intern"
  | "account_manager"
  | "manager"
  | "review_coordinator"
  | "system";

export type OperationalReviewState =
  | "not_reviewed"
  | "in_review"
  | "reviewed"
  | "shared_review"
  | "escalated_review"
  | "manager_review"
  | "waiting_for_followup_review"
  | "dormant_review"
  | "review_reopened";

export type OperationalAssignmentState =
  | "assigned"
  | "unassigned"
  | "shared"
  | "visibility_only"
  | "ownership_unclear";

export type OperationalContinuityState =
  | "not_started"
  | "active_review"
  | "shared_review"
  | "escalation_review"
  | "manager_review"
  | "follow_up_review"
  | "dormant_review"
  | "resolved"
  | "gap_observed"
  | "review_complete_not_inferred";

export type OperationalWorkflowProgressionState =
  | "projection_observed"
  | "review_state_changed"
  | "blocked"
  | "unblocked";

export type OperationalHandoffState =
  | "prepared"
  | "acknowledged"
  | "superseded";

export interface CanonicalOperationalEventBoundaryPolicy {
  readonly mode: "type_only_canonical_operational_event_contract";
  readonly appendOnly: true;
  readonly immutable: true;
  readonly repositoriesAllowed: false;
  readonly persistenceAllowed: false;
  readonly neonWritesAllowed: false;
  readonly automationAllowed: false;
  readonly queueExecutionAllowed: false;
  readonly workflowExecutionAllowed: false;
  readonly remindersAllowed: false;
  readonly notificationsAllowed: false;
  readonly productionScoringAllowed: false;
  readonly inferredReviewCompletionAllowed: false;
  readonly uiDerivedWorkflowMemoryAllowed: false;
  readonly projectionCacheCanonicalAllowed: false;
  readonly hiddenAutomationStateAllowed: false;
  readonly invisibleWorkflowProgressionAllowed: false;
}

export interface CanonicalOperationalAppendOnlySemantics {
  readonly strategy: "append_only_operational_memory_v0";
  readonly mutationSemanticsAllowed: false;
  readonly overwriteSemanticsAllowed: false;
  readonly deletionSemanticsAllowed: false;
  readonly correctionStrategy: "append_reversal_or_supersession_event";
  readonly projectionCacheCanonical: false;
}

export interface CanonicalOperationalEventMetadata {
  readonly schemaVersion: "operational_event_envelope_v0";
  readonly eventVersion: number;
  readonly workspaceId: WorkspaceId;
  readonly relationshipId: RelationshipId;
  readonly family: CanonicalOperationalEventFamily;
  readonly kind: CanonicalOperationalEventKind;
  readonly occurredAt: IsoDateString;
  readonly recordedAt: IsoDateString;
  readonly source: CanonicalOperationalEventSource;
  readonly actor: CanonicalOperationalEventActor;
  readonly sourceProjection?: CanonicalOperationalSourceProjectionMetadata;
}

export interface CanonicalOperationalEventActor {
  readonly actorId: OperatorId | "system";
  readonly role: OperationalActorRole;
  readonly source: CanonicalOperationalEventSource;
  readonly displayName?: string;
}

export interface CanonicalOperationalSourceProjectionMetadata {
  readonly projectionKind:
    | "relationship_workflow_projection"
    | "multi_operator_workflow_orchestration_projection"
    | "operator_workflow_continuity_projection"
    | "relationship_summary_projection"
    | "relationship_feed_projection"
    | "relationship_queue_projection"
    | "manual_operator_observation"
    | "not_applicable";
  readonly projectionVersion: string;
  readonly generatedAt?: IsoDateString;
  readonly sourceWatermark?: string;
  readonly derivedCacheCanonical: false;
}

export interface CanonicalOperationalReplayOrderingMetadata {
  readonly strategy: "deterministic_operational_event_replay_v0";
  readonly orderKey: string;
  readonly occurredAt: IsoDateString;
  readonly recordedAt: IsoDateString;
  readonly familyRank: number;
  readonly kindRank: number;
  readonly eventIdTieBreaker: OperationalEventId;
  readonly sourceEventIds: readonly (OperationalEventId | TimelineEventId)[];
  readonly hiddenStateInputsAllowed: false;
}

export interface CanonicalOperationalIdempotencyMetadata {
  readonly strategy: "deterministic_operational_event_idempotency_v0";
  readonly idempotencyKey: OperationalEventIdempotencyKey;
  readonly dedupeKey: OperationalEventDedupeKey;
  readonly deterministicIdInputs: readonly string[];
  readonly duplicatePolicy: "collapse_exact_duplicate";
  readonly conflictPolicy: "explicit_conflict_when_expected_state_differs";
}

export interface CanonicalOperationalExplainabilityMetadata {
  readonly whyVisible: CanonicalOperationalExplanation;
  readonly whyAssigned: CanonicalOperationalExplanation;
  readonly whyEscalated: CanonicalOperationalExplanation;
  readonly whyContinuityChanged: CanonicalOperationalExplanation;
  readonly missingDataEffects: readonly CanonicalOperationalMissingDataEffect[];
  readonly confidence: CanonicalOperationalConfidenceContext;
  readonly evidence: readonly EvidenceRef[];
  readonly reasonCodes: readonly string[];
}

export interface CanonicalOperationalExplanation {
  readonly state: "explained" | "not_applicable" | "not_observed";
  readonly summary: string;
  readonly evidenceIds: readonly string[];
}

export interface CanonicalOperationalMissingDataEffect {
  readonly field: string;
  readonly effect: "lowers_confidence" | "limits_visibility" | "blocks_progression" | "not_applicable";
  readonly explanation: string;
}

export interface CanonicalOperationalConfidenceContext {
  readonly level: ConfidenceLevel;
  readonly rationale: string;
  readonly missingDataAdjusted: boolean;
}

export interface CanonicalOperationalExpectedState {
  readonly reviewState?: OperationalReviewState;
  readonly assignmentState?: OperationalAssignmentState;
  readonly continuityState?: OperationalContinuityState;
  readonly workflowProgressionState?: OperationalWorkflowProgressionState;
  readonly handoffState?: OperationalHandoffState;
  readonly projectionVersion?: string;
}

export interface BaseCanonicalOperationalEventEnvelope<
  Family extends CanonicalOperationalEventFamily,
  Kind extends CanonicalOperationalEventKind,
  Payload extends object,
> {
  readonly id: OperationalEventId;
  readonly family: Family;
  readonly kind: Kind;
  readonly metadata: CanonicalOperationalEventMetadata & {
    readonly family: Family;
    readonly kind: Kind;
  };
  readonly ordering: CanonicalOperationalReplayOrderingMetadata;
  readonly idempotency: CanonicalOperationalIdempotencyMetadata;
  readonly explainability: CanonicalOperationalExplainabilityMetadata;
  readonly expectedState: CanonicalOperationalExpectedState;
  readonly appendOnly: CanonicalOperationalAppendOnlySemantics;
  readonly boundary: CanonicalOperationalEventBoundaryPolicy;
  readonly payload: Readonly<Payload>;
}

export interface ReviewHistoryOperationalEventPayload {
  readonly scope: "relationship_review" | "manager_review" | "shared_review";
  readonly priorReviewState: OperationalReviewState;
  readonly nextReviewState: OperationalReviewState;
  readonly reviewOutcome?: "approved" | "needs_follow_up" | "needs_escalation" | "not_fit" | "deferred";
  readonly reviewerId: OperatorId | "system";
  readonly sharedWithOperatorIds: readonly OperatorId[];
  readonly completionInferred: false;
}

export type ReviewHistoryOperationalEventEnvelope = BaseCanonicalOperationalEventEnvelope<
  "review_history",
  ReviewHistoryOperationalEventKind,
  ReviewHistoryOperationalEventPayload
>;

export interface AssignmentHistoryOperationalEventPayload {
  readonly priorAssignmentState: OperationalAssignmentState;
  readonly nextAssignmentState: OperationalAssignmentState;
  readonly previousOwnerId?: OperatorId;
  readonly nextOwnerId?: OperatorId;
  readonly visibleOperatorIds: readonly OperatorId[];
  readonly visibilityScope:
    | "primary_owner"
    | "collaborator"
    | "observer"
    | "shared_review"
    | "unassigned_review"
    | "manager_review";
  readonly assignmentMutationExecuted: false;
}

export type AssignmentHistoryOperationalEventEnvelope = BaseCanonicalOperationalEventEnvelope<
  "assignment_history",
  AssignmentHistoryOperationalEventKind,
  AssignmentHistoryOperationalEventPayload
>;

export interface ContinuityHistoryOperationalEventPayload {
  readonly priorContinuityState: OperationalContinuityState;
  readonly nextContinuityState: OperationalContinuityState;
  readonly continuityReason: string;
  readonly reviewState: OperationalReviewState;
  readonly assignmentState: OperationalAssignmentState;
  readonly lifecycleContext: string;
  readonly sourceOperationalEventIds: readonly OperationalEventId[];
  readonly projectionCacheCanonical: false;
}

export type ContinuityHistoryOperationalEventEnvelope = BaseCanonicalOperationalEventEnvelope<
  "continuity_history",
  ContinuityHistoryOperationalEventKind,
  ContinuityHistoryOperationalEventPayload
>;

export interface WorkflowProgressionOperationalEventPayload {
  readonly priorProgressionState: OperationalWorkflowProgressionState;
  readonly nextProgressionState: OperationalWorkflowProgressionState;
  readonly observedReviewState: OperationalReviewState;
  readonly progressionReason: string;
  readonly blockedByMissingFields: readonly string[];
  readonly queueExecutionPerformed: false;
  readonly workflowExecutionPerformed: false;
  readonly uiDerivedProgression: false;
}

export type WorkflowProgressionOperationalEventEnvelope = BaseCanonicalOperationalEventEnvelope<
  "workflow_progression",
  WorkflowProgressionOperationalEventKind,
  WorkflowProgressionOperationalEventPayload
>;

export interface OperatorHandoffOperationalEventPayload {
  readonly priorHandoffState: OperationalHandoffState;
  readonly nextHandoffState: OperationalHandoffState;
  readonly fromOperatorId?: OperatorId;
  readonly toOperatorId?: OperatorId;
  readonly acknowledgementRequired: boolean;
  readonly acknowledgementObservedAt?: IsoDateString;
  readonly reminderCreated: false;
  readonly notificationSent: false;
}

export type OperatorHandoffOperationalEventEnvelope = BaseCanonicalOperationalEventEnvelope<
  "operator_handoff",
  OperatorHandoffOperationalEventKind,
  OperatorHandoffOperationalEventPayload
>;

export type CanonicalOperationalEventEnvelope =
  | ReviewHistoryOperationalEventEnvelope
  | AssignmentHistoryOperationalEventEnvelope
  | ContinuityHistoryOperationalEventEnvelope
  | WorkflowProgressionOperationalEventEnvelope
  | OperatorHandoffOperationalEventEnvelope;
