// Meridian Relationship Engine — no-write operational event command contracts.
//
// Type-only command shapes for future canonical operational event creation.
// These contracts are dry-run and validation-only: no persistence, Neon, routes,
// repositories, automation, reminders, notifications, queue execution, workflow
// execution, production scoring, or autonomous workflow behavior.

import type {
  CanonicalOperationalEventActor,
  CanonicalOperationalEventFamily,
  CanonicalOperationalEventKind,
  CanonicalOperationalExplainabilityMetadata,
  CanonicalOperationalExpectedState,
  CanonicalOperationalSourceProjectionMetadata,
  OperationalAssignmentState,
  OperationalHandoffState,
  OperationalReviewState,
  OperationalWorkflowProgressionState,
} from "./events";
import type {
  EvidenceRef,
  IsoDateString,
  OperationalEventIdempotencyKey,
  OperatorId,
  RelationshipId,
  WorkspaceId,
} from "../primitives";

export type OperationalEventCommandFamily =
  | "review_history"
  | "assignment_history"
  | "operator_handoff"
  | "workflow_progression";

export type ReviewOperationalEventCommandKind =
  | "start_review"
  | "complete_review"
  | "reopen_review"
  | "escalate_review"
  | "request_manager_review";

export type AssignmentOperationalEventCommandKind =
  | "create_assignment"
  | "transfer_assignment"
  | "remove_assignment"
  | "change_assignment_visibility"
  | "clarify_ownership";

export type HandoffOperationalEventCommandKind =
  | "prepare_handoff"
  | "acknowledge_handoff"
  | "supersede_handoff";

export type WorkflowProgressionObservationCommandKind =
  | "observe_projection"
  | "block_progression"
  | "unblock_progression";

export type OperationalEventCommandKind =
  | ReviewOperationalEventCommandKind
  | AssignmentOperationalEventCommandKind
  | HandoffOperationalEventCommandKind
  | WorkflowProgressionObservationCommandKind;

export interface OperationalEventCommandNoWriteBoundaryPolicy {
  readonly mode: "no_write_operational_event_command_contract";
  readonly dryRunOnly: true;
  readonly validationOnly: true;
  readonly commandExecutionAllowed: false;
  readonly canonicalEventEmissionAllowed: false;
  readonly mutationEndpointsAllowed: false;
  readonly repositoriesAllowed: false;
  readonly persistenceAllowed: false;
  readonly neonWritesAllowed: false;
  readonly automationAllowed: false;
  readonly automationIntentAllowed: false;
  readonly remindersAllowed: false;
  readonly notificationsAllowed: false;
  readonly queueExecutionAllowed: false;
  readonly workflowExecutionAllowed: false;
  readonly productionScoringAllowed: false;
  readonly autonomousWorkflowsAllowed: false;
}

export interface OperationalEventCommandIdempotencyRequirements {
  readonly idempotencyKey: OperationalEventIdempotencyKey;
  readonly dedupeScope:
    | "workspace_relationship_command_kind_actor"
    | "workspace_relationship_command_kind_source_projection";
  readonly deterministicCommandInputs: readonly string[];
  readonly exactDuplicatePolicy: "noop";
  readonly expectedStateMismatchPolicy: "explicit_conflict";
  readonly missingEvidencePolicy: "validation_failure";
  readonly forbiddenAutomationIntentPolicy: "validation_failure";
}

export interface OperationalEventCommandApprovalSemantics {
  readonly mode:
    | "explicit_operator_approval"
    | "explicit_manager_approval"
    | "system_observation_without_execution";
  readonly actorApprovalRequired: boolean;
  readonly approvalEvidenceRequired: true;
  readonly implicitApprovalAllowed: false;
  readonly automationApprovalAllowed: false;
  readonly approvalObservedAt?: IsoDateString;
}

export interface OperationalEventCommandDryRunPlan {
  readonly plannedEventFamily: CanonicalOperationalEventFamily;
  readonly plannedEventKind: CanonicalOperationalEventKind;
  readonly wouldEmitCanonicalEvent: false;
  readonly wouldPersist: false;
  readonly wouldExecuteAutomation: false;
  readonly wouldSendReminder: false;
  readonly wouldSendNotification: false;
  readonly wouldExecuteQueue: false;
  readonly wouldExecuteWorkflow: false;
}

export interface BaseOperationalEventCommand<
  Family extends OperationalEventCommandFamily,
  Kind extends OperationalEventCommandKind,
  PlannedEventFamily extends CanonicalOperationalEventFamily,
  PlannedEventKind extends CanonicalOperationalEventKind,
  Payload extends object,
> {
  readonly family: Family;
  readonly kind: Kind;
  readonly workspaceId: WorkspaceId;
  readonly relationshipId: RelationshipId;
  readonly actor: CanonicalOperationalEventActor;
  readonly idempotencyKey: OperationalEventIdempotencyKey;
  readonly idempotency: OperationalEventCommandIdempotencyRequirements;
  readonly expectedPriorState: CanonicalOperationalExpectedState;
  readonly sourceProjectionVersion: string;
  readonly sourceProjection: CanonicalOperationalSourceProjectionMetadata;
  readonly evidence: readonly EvidenceRef[];
  readonly reasonCodes: readonly string[];
  readonly explainability: CanonicalOperationalExplainabilityMetadata;
  readonly approval: OperationalEventCommandApprovalSemantics;
  readonly dryRunPlan: OperationalEventCommandDryRunPlan & {
    readonly plannedEventFamily: PlannedEventFamily;
    readonly plannedEventKind: PlannedEventKind;
  };
  readonly boundary: OperationalEventCommandNoWriteBoundaryPolicy;
  readonly payload: Readonly<Payload>;
}

export interface ReviewOperationalEventCommandPayload {
  readonly priorReviewState: OperationalReviewState;
  readonly requestedReviewState: OperationalReviewState;
  readonly reviewScope: "relationship_review" | "shared_review" | "manager_review";
  readonly reviewerId: OperatorId | "system";
  readonly managerReviewerId?: OperatorId;
  readonly reviewOutcome?: "approved" | "needs_follow_up" | "needs_escalation" | "not_fit" | "deferred";
  readonly completionInferred: false;
  readonly automationIntent: false;
}

export type StartReviewOperationalEventCommand = BaseOperationalEventCommand<
  "review_history",
  "start_review",
  "review_history",
  "review_started",
  ReviewOperationalEventCommandPayload
>;

export type CompleteReviewOperationalEventCommand = BaseOperationalEventCommand<
  "review_history",
  "complete_review",
  "review_history",
  "review_completed",
  ReviewOperationalEventCommandPayload
>;

export type ReopenReviewOperationalEventCommand = BaseOperationalEventCommand<
  "review_history",
  "reopen_review",
  "review_history",
  "review_reopened",
  ReviewOperationalEventCommandPayload
>;

export type EscalateReviewOperationalEventCommand = BaseOperationalEventCommand<
  "review_history",
  "escalate_review",
  "review_history",
  "review_escalated",
  ReviewOperationalEventCommandPayload
>;

export type RequestManagerReviewOperationalEventCommand = BaseOperationalEventCommand<
  "review_history",
  "request_manager_review",
  "review_history",
  "manager_review_requested",
  ReviewOperationalEventCommandPayload
>;

export interface AssignmentOperationalEventCommandPayload {
  readonly priorAssignmentState: OperationalAssignmentState;
  readonly requestedAssignmentState: OperationalAssignmentState;
  readonly previousOwnerId?: OperatorId;
  readonly requestedOwnerId?: OperatorId;
  readonly visibleOperatorIds: readonly OperatorId[];
  readonly visibilityScope:
    | "primary_owner"
    | "collaborator"
    | "observer"
    | "shared_review"
    | "unassigned_review"
    | "manager_review";
  readonly assignmentMutationIntent: false;
  readonly automationIntent: false;
}

export type CreateAssignmentOperationalEventCommand = BaseOperationalEventCommand<
  "assignment_history",
  "create_assignment",
  "assignment_history",
  "assignment_created",
  AssignmentOperationalEventCommandPayload
>;

export type TransferAssignmentOperationalEventCommand = BaseOperationalEventCommand<
  "assignment_history",
  "transfer_assignment",
  "assignment_history",
  "assignment_transferred",
  AssignmentOperationalEventCommandPayload
>;

export type RemoveAssignmentOperationalEventCommand = BaseOperationalEventCommand<
  "assignment_history",
  "remove_assignment",
  "assignment_history",
  "assignment_removed",
  AssignmentOperationalEventCommandPayload
>;

export type ChangeAssignmentVisibilityOperationalEventCommand = BaseOperationalEventCommand<
  "assignment_history",
  "change_assignment_visibility",
  "assignment_history",
  "assignment_visibility_changed",
  AssignmentOperationalEventCommandPayload
>;

export type ClarifyOwnershipOperationalEventCommand = BaseOperationalEventCommand<
  "assignment_history",
  "clarify_ownership",
  "assignment_history",
  "ownership_clarified",
  AssignmentOperationalEventCommandPayload
>;

export interface HandoffOperationalEventCommandPayload {
  readonly priorHandoffState: OperationalHandoffState;
  readonly requestedHandoffState: OperationalHandoffState;
  readonly fromOperatorId?: OperatorId;
  readonly toOperatorId?: OperatorId;
  readonly acknowledgementRequired: boolean;
  readonly acknowledgementObservedAt?: IsoDateString;
  readonly reminderIntent: false;
  readonly notificationIntent: false;
  readonly automationIntent: false;
}

export type PrepareHandoffOperationalEventCommand = BaseOperationalEventCommand<
  "operator_handoff",
  "prepare_handoff",
  "operator_handoff",
  "handoff_context_prepared",
  HandoffOperationalEventCommandPayload
>;

export type AcknowledgeHandoffOperationalEventCommand = BaseOperationalEventCommand<
  "operator_handoff",
  "acknowledge_handoff",
  "operator_handoff",
  "handoff_context_acknowledged",
  HandoffOperationalEventCommandPayload
>;

export type SupersedeHandoffOperationalEventCommand = BaseOperationalEventCommand<
  "operator_handoff",
  "supersede_handoff",
  "operator_handoff",
  "handoff_context_superseded",
  HandoffOperationalEventCommandPayload
>;

export interface WorkflowProgressionObservationCommandPayload {
  readonly priorProgressionState: OperationalWorkflowProgressionState;
  readonly requestedProgressionState: OperationalWorkflowProgressionState;
  readonly observedReviewState: OperationalReviewState;
  readonly progressionReason: string;
  readonly blockedByMissingFields: readonly string[];
  readonly queueExecutionIntent: false;
  readonly workflowExecutionIntent: false;
  readonly automationIntent: false;
}

export type ObserveWorkflowProjectionOperationalEventCommand = BaseOperationalEventCommand<
  "workflow_progression",
  "observe_projection",
  "workflow_progression",
  "workflow_projection_observed",
  WorkflowProgressionObservationCommandPayload
>;

export type BlockWorkflowProgressionOperationalEventCommand = BaseOperationalEventCommand<
  "workflow_progression",
  "block_progression",
  "workflow_progression",
  "workflow_progression_blocked",
  WorkflowProgressionObservationCommandPayload
>;

export type UnblockWorkflowProgressionOperationalEventCommand = BaseOperationalEventCommand<
  "workflow_progression",
  "unblock_progression",
  "workflow_progression",
  "workflow_progression_unblocked",
  WorkflowProgressionObservationCommandPayload
>;

export type ReviewOperationalEventCommand =
  | StartReviewOperationalEventCommand
  | CompleteReviewOperationalEventCommand
  | ReopenReviewOperationalEventCommand
  | EscalateReviewOperationalEventCommand
  | RequestManagerReviewOperationalEventCommand;

export type AssignmentOperationalEventCommand =
  | CreateAssignmentOperationalEventCommand
  | TransferAssignmentOperationalEventCommand
  | RemoveAssignmentOperationalEventCommand
  | ChangeAssignmentVisibilityOperationalEventCommand
  | ClarifyOwnershipOperationalEventCommand;

export type HandoffOperationalEventCommand =
  | PrepareHandoffOperationalEventCommand
  | AcknowledgeHandoffOperationalEventCommand
  | SupersedeHandoffOperationalEventCommand;

export type WorkflowProgressionObservationCommand =
  | ObserveWorkflowProjectionOperationalEventCommand
  | BlockWorkflowProgressionOperationalEventCommand
  | UnblockWorkflowProgressionOperationalEventCommand;

export type OperationalEventCommand =
  | ReviewOperationalEventCommand
  | AssignmentOperationalEventCommand
  | HandoffOperationalEventCommand
  | WorkflowProgressionObservationCommand;

export type OperationalEventCommandValidationFailureCode =
  | "missing_workspace_id"
  | "missing_relationship_id"
  | "missing_actor"
  | "missing_idempotency_key"
  | "missing_expected_prior_state"
  | "missing_source_projection_version"
  | "missing_evidence"
  | "missing_reason_codes"
  | "missing_explainability"
  | "forbidden_automation_intent"
  | "forbidden_reminder_intent"
  | "forbidden_notification_intent"
  | "forbidden_queue_execution_intent"
  | "forbidden_workflow_execution_intent";

export type OperationalEventCommandConflictCode =
  | "exact_duplicate_noop"
  | "expected_state_mismatch";

export interface OperationalEventCommandValidationIssue {
  readonly code: OperationalEventCommandValidationFailureCode;
  readonly message: string;
  readonly field:
    | "workspaceId"
    | "relationshipId"
    | "actor"
    | "idempotencyKey"
    | "expectedPriorState"
    | "sourceProjectionVersion"
    | "evidence"
    | "reasonCodes"
    | "explainability"
    | "payload";
}

export interface OperationalEventCommandConflict {
  readonly code: OperationalEventCommandConflictCode;
  readonly message: string;
  readonly idempotencyKey: OperationalEventIdempotencyKey;
  readonly existingCommandKind?: OperationalEventCommandKind;
  readonly incomingCommandKind: OperationalEventCommandKind;
  readonly resolution:
    | "noop_exact_duplicate"
    | "reject_until_expected_state_is_refreshed";
}

export interface OperationalEventCommandDryRunValidResult {
  readonly status: "valid_no_write";
  readonly acceptedForFutureEventCreation: true;
  readonly command: OperationalEventCommand;
  readonly issues: readonly [];
  readonly conflicts: readonly [];
  readonly wouldWrite: false;
  readonly dryRunPlan: OperationalEventCommandDryRunPlan;
}

export interface OperationalEventCommandDryRunDuplicateNoopResult {
  readonly status: "exact_duplicate_noop";
  readonly acceptedForFutureEventCreation: false;
  readonly command: OperationalEventCommand;
  readonly issues: readonly [];
  readonly conflicts: readonly [OperationalEventCommandConflict];
  readonly wouldWrite: false;
  readonly dryRunPlan: OperationalEventCommandDryRunPlan;
}

export interface OperationalEventCommandDryRunConflictResult {
  readonly status: "explicit_conflict";
  readonly acceptedForFutureEventCreation: false;
  readonly command: OperationalEventCommand;
  readonly issues: readonly [];
  readonly conflicts: readonly [OperationalEventCommandConflict, ...OperationalEventCommandConflict[]];
  readonly wouldWrite: false;
  readonly dryRunPlan: OperationalEventCommandDryRunPlan;
}

export interface OperationalEventCommandDryRunValidationFailureResult {
  readonly status: "validation_failed";
  readonly acceptedForFutureEventCreation: false;
  readonly command?: OperationalEventCommand;
  readonly issues: readonly [OperationalEventCommandValidationIssue, ...OperationalEventCommandValidationIssue[]];
  readonly conflicts: readonly [];
  readonly wouldWrite: false;
  readonly dryRunPlan?: OperationalEventCommandDryRunPlan;
}

export type OperationalEventCommandDryRunValidationResult =
  | OperationalEventCommandDryRunValidResult
  | OperationalEventCommandDryRunDuplicateNoopResult
  | OperationalEventCommandDryRunConflictResult
  | OperationalEventCommandDryRunValidationFailureResult;
