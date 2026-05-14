import type {
  AcknowledgeHandoffOperationalEventCommand,
  BlockWorkflowProgressionOperationalEventCommand,
  CompleteReviewOperationalEventCommand,
  CreateAssignmentOperationalEventCommand,
  ObserveWorkflowProjectionOperationalEventCommand,
  OperationalEventCommand,
  OperationalEventCommandApprovalSemantics,
  OperationalEventCommandDryRunPlan,
  OperationalEventCommandIdempotencyRequirements,
  OperationalEventCommandKind,
  OperationalEventCommandNoWriteBoundaryPolicy,
  PrepareHandoffOperationalEventCommand,
  StartReviewOperationalEventCommand,
  TransferAssignmentOperationalEventCommand,
} from "@/lib/relationship-engine/operational/commands";
import type {
  AssignmentHistoryOperationalEventEnvelope,
  CanonicalOperationalAppendOnlySemantics,
  CanonicalOperationalEventActor,
  CanonicalOperationalEventBoundaryPolicy,
  CanonicalOperationalEventEnvelope,
  CanonicalOperationalEventFamily,
  CanonicalOperationalEventKind,
  CanonicalOperationalEventMetadata,
  CanonicalOperationalEventSource,
  CanonicalOperationalExplainabilityMetadata,
  CanonicalOperationalExpectedState,
  CanonicalOperationalSourceProjectionMetadata,
  OperatorHandoffOperationalEventEnvelope,
  ReviewHistoryOperationalEventEnvelope,
  WorkflowProgressionOperationalEventEnvelope,
} from "@/lib/relationship-engine/operational/events";
import type {
  OperationalCommandTranslationConflictIssue,
  OperationalCommandTranslationDryRunGuarantees,
  OperationalCommandTranslationInput,
  OperationalCommandTranslationNoWriteBoundaryMetadata,
  OperationalCommandTranslationOutput,
  PlannedCanonicalOperationalEventPreview,
} from "@/lib/relationship-engine/operational/commandTranslation";
import type { EvidenceRef, OperationalEventIdempotencyKey } from "@/lib/relationship-engine/primitives";

export const operationalCommandTranslationBoundary = {
  mode: "fixture_only_operational_command_to_event_translation",
  fixtureOnly: true,
  dryRunOnly: true,
  validationOnly: true,
  commandExecutionAllowed: false,
  canonicalEventEmissionAllowed: false,
  mutationEndpointsAllowed: false,
  repositoriesAllowed: false,
  persistenceAllowed: false,
  neonWritesAllowed: false,
  filesystemWritesAllowed: false,
  automationAllowed: false,
  automationIntentAllowed: false,
  remindersAllowed: false,
  notificationsAllowed: false,
  queueExecutionAllowed: false,
  workflowExecutionAllowed: false,
  productionScoringAllowed: false,
  autonomousWorkflowsAllowed: false,
} satisfies OperationalCommandTranslationNoWriteBoundaryMetadata;

export const operationalCommandTranslationDryRunGuarantees = {
  wouldEmitCanonicalEvent: false,
  wouldPersist: false,
  wouldWrite: false,
  wouldExecuteAutomation: false,
  wouldSendReminder: false,
  wouldSendNotification: false,
  wouldExecuteQueue: false,
  wouldExecuteWorkflow: false,
} satisfies OperationalCommandTranslationDryRunGuarantees;

const commandBoundary = {
  mode: "no_write_operational_event_command_contract",
  dryRunOnly: true,
  validationOnly: true,
  commandExecutionAllowed: false,
  canonicalEventEmissionAllowed: false,
  mutationEndpointsAllowed: false,
  repositoriesAllowed: false,
  persistenceAllowed: false,
  neonWritesAllowed: false,
  automationAllowed: false,
  automationIntentAllowed: false,
  remindersAllowed: false,
  notificationsAllowed: false,
  queueExecutionAllowed: false,
  workflowExecutionAllowed: false,
  productionScoringAllowed: false,
  autonomousWorkflowsAllowed: false,
} satisfies OperationalEventCommandNoWriteBoundaryPolicy;

const eventBoundary = {
  mode: "type_only_canonical_operational_event_contract",
  appendOnly: true,
  immutable: true,
  repositoriesAllowed: false,
  persistenceAllowed: false,
  neonWritesAllowed: false,
  automationAllowed: false,
  queueExecutionAllowed: false,
  workflowExecutionAllowed: false,
  remindersAllowed: false,
  notificationsAllowed: false,
  productionScoringAllowed: false,
  inferredReviewCompletionAllowed: false,
  uiDerivedWorkflowMemoryAllowed: false,
  projectionCacheCanonicalAllowed: false,
  hiddenAutomationStateAllowed: false,
  invisibleWorkflowProgressionAllowed: false,
} satisfies CanonicalOperationalEventBoundaryPolicy;

const appendOnly = {
  strategy: "append_only_operational_memory_v0",
  mutationSemanticsAllowed: false,
  overwriteSemanticsAllowed: false,
  deletionSemanticsAllowed: false,
  correctionStrategy: "append_reversal_or_supersession_event",
  projectionCacheCanonical: false,
} satisfies CanonicalOperationalAppendOnlySemantics;

export const operationalCommandExamples = [
  {
    family: "review_history",
    kind: "start_review",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: operatorActor("operator:fixture:a", "Fixture Operator A"),
    idempotencyKey: commandKey("start-review"),
    idempotency: commandIdempotency("start_review", "start-review"),
    expectedPriorState: {
      reviewState: "not_reviewed",
      assignmentState: "assigned",
      projectionVersion: "relationship-workflow:v0",
    },
    sourceProjectionVersion: "relationship-workflow:v0",
    sourceProjection: sourceProjection("manual_operator_observation", 0),
    evidence: [evidenceRef("start-review", "high")],
    reasonCodes: ["fixture_command_start_review"],
    explainability: explainability("start-review", "Operator explicitly starts review.", "high"),
    approval: approval("explicit_operator_approval", "2026-05-14T04:20:00.000Z"),
    dryRunPlan: dryRunPlan("review_history", "review_started"),
    boundary: commandBoundary,
    payload: {
      priorReviewState: "not_reviewed",
      requestedReviewState: "in_review",
      reviewScope: "relationship_review",
      reviewerId: "operator:fixture:a" as never,
      completionInferred: false,
      automationIntent: false,
    },
  } satisfies StartReviewOperationalEventCommand,
  {
    family: "review_history",
    kind: "complete_review",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: operatorActor("operator:fixture:a", "Fixture Operator A"),
    idempotencyKey: commandKey("complete-review"),
    idempotency: commandIdempotency("complete_review", "complete-review"),
    expectedPriorState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      projectionVersion: "relationship-workflow:v0",
    },
    sourceProjectionVersion: "relationship-workflow:v0",
    sourceProjection: sourceProjection("manual_operator_observation", 1),
    evidence: [evidenceRef("complete-review", "high")],
    reasonCodes: ["fixture_command_complete_review"],
    explainability: explainability("complete-review", "Operator explicitly completes review.", "high"),
    approval: approval("explicit_operator_approval", "2026-05-14T04:21:00.000Z"),
    dryRunPlan: dryRunPlan("review_history", "review_completed"),
    boundary: commandBoundary,
    payload: {
      priorReviewState: "in_review",
      requestedReviewState: "reviewed",
      reviewScope: "relationship_review",
      reviewerId: "operator:fixture:a" as never,
      reviewOutcome: "approved",
      completionInferred: false,
      automationIntent: false,
    },
  } satisfies CompleteReviewOperationalEventCommand,
  {
    family: "assignment_history",
    kind: "create_assignment",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: operatorActor("operator:fixture:a", "Fixture Operator A"),
    idempotencyKey: commandKey("create-assignment"),
    idempotency: commandIdempotency("create_assignment", "create-assignment"),
    expectedPriorState: {
      reviewState: "not_reviewed",
      assignmentState: "unassigned",
      projectionVersion: "relationship-workflow:v0",
    },
    sourceProjectionVersion: "relationship-workflow:v0",
    sourceProjection: sourceProjection("manual_operator_observation", 2),
    evidence: [evidenceRef("create-assignment", "high")],
    reasonCodes: ["fixture_command_create_assignment"],
    explainability: explainability("create-assignment", "Operator explicitly assigns ownership.", "high"),
    approval: approval("explicit_operator_approval", "2026-05-14T04:22:00.000Z"),
    dryRunPlan: dryRunPlan("assignment_history", "assignment_created"),
    boundary: commandBoundary,
    payload: {
      priorAssignmentState: "unassigned",
      requestedAssignmentState: "assigned",
      requestedOwnerId: "operator:fixture:a" as never,
      visibleOperatorIds: ["operator:fixture:a" as never],
      visibilityScope: "primary_owner",
      assignmentMutationIntent: false,
      automationIntent: false,
    },
  } satisfies CreateAssignmentOperationalEventCommand,
  {
    family: "assignment_history",
    kind: "transfer_assignment",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: operatorActor("operator:fixture:a", "Fixture Operator A"),
    idempotencyKey: commandKey("transfer-assignment"),
    idempotency: commandIdempotency("transfer_assignment", "transfer-assignment"),
    expectedPriorState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      projectionVersion: "relationship-workflow:v0",
    },
    sourceProjectionVersion: "relationship-workflow:v0",
    sourceProjection: sourceProjection("manual_operator_observation", 3),
    evidence: [evidenceRef("transfer-assignment", "high")],
    reasonCodes: ["fixture_command_transfer_assignment"],
    explainability: explainability("transfer-assignment", "Operator explicitly transfers ownership.", "high"),
    approval: approval("explicit_operator_approval", "2026-05-14T04:23:00.000Z"),
    dryRunPlan: dryRunPlan("assignment_history", "assignment_transferred"),
    boundary: commandBoundary,
    payload: {
      priorAssignmentState: "assigned",
      requestedAssignmentState: "assigned",
      previousOwnerId: "operator:fixture:a" as never,
      requestedOwnerId: "operator:fixture:b" as never,
      visibleOperatorIds: ["operator:fixture:b" as never],
      visibilityScope: "primary_owner",
      assignmentMutationIntent: false,
      automationIntent: false,
    },
  } satisfies TransferAssignmentOperationalEventCommand,
  {
    family: "operator_handoff",
    kind: "prepare_handoff",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: operatorActor("operator:fixture:a", "Fixture Operator A"),
    idempotencyKey: commandKey("prepare-handoff"),
    idempotency: commandIdempotency("prepare_handoff", "prepare-handoff"),
    expectedPriorState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      handoffState: "superseded",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    sourceProjectionVersion: "operator-workflow-continuity:v0",
    sourceProjection: sourceProjection("operator_workflow_continuity_projection", 4),
    evidence: [evidenceRef("prepare-handoff", "medium")],
    reasonCodes: ["fixture_command_prepare_handoff"],
    explainability: explainability("prepare-handoff", "Operator prepares handoff context without sending anything.", "medium"),
    approval: approval("explicit_operator_approval", "2026-05-14T04:24:00.000Z"),
    dryRunPlan: dryRunPlan("operator_handoff", "handoff_context_prepared"),
    boundary: commandBoundary,
    payload: {
      priorHandoffState: "superseded",
      requestedHandoffState: "prepared",
      fromOperatorId: "operator:fixture:a" as never,
      toOperatorId: "operator:fixture:b" as never,
      acknowledgementRequired: true,
      reminderIntent: false,
      notificationIntent: false,
      automationIntent: false,
    },
  } satisfies PrepareHandoffOperationalEventCommand,
  {
    family: "operator_handoff",
    kind: "acknowledge_handoff",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: operatorActor("operator:fixture:b", "Fixture Operator B"),
    idempotencyKey: commandKey("acknowledge-handoff"),
    idempotency: commandIdempotency("acknowledge_handoff", "acknowledge-handoff"),
    expectedPriorState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      handoffState: "prepared",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    sourceProjectionVersion: "operator-workflow-continuity:v0",
    sourceProjection: sourceProjection("manual_operator_observation", 5),
    evidence: [evidenceRef("acknowledge-handoff", "high")],
    reasonCodes: ["fixture_command_acknowledge_handoff"],
    explainability: explainability("acknowledge-handoff", "Receiving operator explicitly acknowledges handoff.", "high"),
    approval: approval("explicit_operator_approval", "2026-05-14T04:25:00.000Z"),
    dryRunPlan: dryRunPlan("operator_handoff", "handoff_context_acknowledged"),
    boundary: commandBoundary,
    payload: {
      priorHandoffState: "prepared",
      requestedHandoffState: "acknowledged",
      fromOperatorId: "operator:fixture:a" as never,
      toOperatorId: "operator:fixture:b" as never,
      acknowledgementRequired: true,
      acknowledgementObservedAt: "2026-05-14T04:25:00.000Z" as never,
      reminderIntent: false,
      notificationIntent: false,
      automationIntent: false,
    },
  } satisfies AcknowledgeHandoffOperationalEventCommand,
  {
    family: "workflow_progression",
    kind: "observe_projection",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: systemActor(),
    idempotencyKey: commandKey("observe-projection"),
    idempotency: commandIdempotency("observe_projection", "observe-projection"),
    expectedPriorState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      workflowProgressionState: "projection_observed",
      projectionVersion: "relationship-workflow:v0",
    },
    sourceProjectionVersion: "relationship-workflow:v0",
    sourceProjection: sourceProjection("relationship_workflow_projection", 6),
    evidence: [evidenceRef("observe-projection", "medium")],
    reasonCodes: ["fixture_command_observe_projection"],
    explainability: explainability("observe-projection", "System observes projection without executing workflow.", "medium"),
    approval: approval("system_observation_without_execution", undefined),
    dryRunPlan: dryRunPlan("workflow_progression", "workflow_projection_observed"),
    boundary: commandBoundary,
    payload: {
      priorProgressionState: "projection_observed",
      requestedProgressionState: "projection_observed",
      observedReviewState: "in_review",
      progressionReason: "Read-only fixture projection observation.",
      blockedByMissingFields: [],
      queueExecutionIntent: false,
      workflowExecutionIntent: false,
      automationIntent: false,
    },
  } satisfies ObserveWorkflowProjectionOperationalEventCommand,
  {
    family: "workflow_progression",
    kind: "block_progression",
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    actor: systemActor(),
    idempotencyKey: commandKey("block-progression"),
    idempotency: commandIdempotency("block_progression", "block-progression"),
    expectedPriorState: {
      reviewState: "shared_review",
      assignmentState: "ownership_unclear",
      workflowProgressionState: "projection_observed",
      projectionVersion: "relationship-workflow:v0",
    },
    sourceProjectionVersion: "relationship-workflow:v0",
    sourceProjection: sourceProjection("relationship_workflow_projection", 7),
    evidence: [evidenceRef("block-progression", "medium")],
    reasonCodes: ["fixture_command_block_progression"],
    explainability: explainability("block-progression", "System observes missing assignment confidence and blocks progression.", "medium"),
    approval: approval("system_observation_without_execution", undefined),
    dryRunPlan: dryRunPlan("workflow_progression", "workflow_progression_blocked"),
    boundary: commandBoundary,
    payload: {
      priorProgressionState: "projection_observed",
      requestedProgressionState: "blocked",
      observedReviewState: "shared_review",
      progressionReason: "Assignment confidence is missing.",
      blockedByMissingFields: ["assignment_confidence"],
      queueExecutionIntent: false,
      workflowExecutionIntent: false,
      automationIntent: false,
    },
  } satisfies BlockWorkflowProgressionOperationalEventCommand,
] satisfies readonly OperationalEventCommand[];

export const plannedOperationalEventPreviews = [
  preview(operationalCommandExamples[0], reviewEvent("start-review", "review_started", 0, {
    reviewState: "in_review",
    assignmentState: "assigned",
    continuityState: "active_review",
    projectionVersion: "relationship-workflow:v0",
  }, {
    scope: "relationship_review",
    priorReviewState: "not_reviewed",
    nextReviewState: "in_review",
    reviewerId: "operator:fixture:a" as never,
    sharedWithOperatorIds: [],
    completionInferred: false,
  })),
  preview(operationalCommandExamples[1], reviewEvent("complete-review", "review_completed", 1, {
    reviewState: "reviewed",
    assignmentState: "assigned",
    continuityState: "review_complete_not_inferred",
    projectionVersion: "relationship-workflow:v0",
  }, {
    scope: "relationship_review",
    priorReviewState: "in_review",
    nextReviewState: "reviewed",
    reviewOutcome: "approved",
    reviewerId: "operator:fixture:a" as never,
    sharedWithOperatorIds: [],
    completionInferred: false,
  })),
  preview(operationalCommandExamples[2], assignmentEvent("create-assignment", "assignment_created", 2, {
    reviewState: "not_reviewed",
    assignmentState: "assigned",
    projectionVersion: "relationship-workflow:v0",
  }, {
    priorAssignmentState: "unassigned",
    nextAssignmentState: "assigned",
    nextOwnerId: "operator:fixture:a" as never,
    visibleOperatorIds: ["operator:fixture:a" as never],
    visibilityScope: "primary_owner",
    assignmentMutationExecuted: false,
  })),
  preview(operationalCommandExamples[3], assignmentEvent("transfer-assignment", "assignment_transferred", 3, {
    reviewState: "in_review",
    assignmentState: "assigned",
    projectionVersion: "relationship-workflow:v0",
  }, {
    priorAssignmentState: "assigned",
    nextAssignmentState: "assigned",
    previousOwnerId: "operator:fixture:a" as never,
    nextOwnerId: "operator:fixture:b" as never,
    visibleOperatorIds: ["operator:fixture:b" as never],
    visibilityScope: "primary_owner",
    assignmentMutationExecuted: false,
  })),
  preview(operationalCommandExamples[4], handoffEvent("prepare-handoff", "handoff_context_prepared", 4, {
    reviewState: "shared_review",
    assignmentState: "shared",
    handoffState: "prepared",
    projectionVersion: "operator-workflow-continuity:v0",
  }, {
    priorHandoffState: "superseded",
    nextHandoffState: "prepared",
    fromOperatorId: "operator:fixture:a" as never,
    toOperatorId: "operator:fixture:b" as never,
    acknowledgementRequired: true,
    reminderCreated: false,
    notificationSent: false,
  })),
  preview(operationalCommandExamples[5], handoffEvent("acknowledge-handoff", "handoff_context_acknowledged", 5, {
    reviewState: "shared_review",
    assignmentState: "shared",
    handoffState: "acknowledged",
    projectionVersion: "operator-workflow-continuity:v0",
  }, {
    priorHandoffState: "prepared",
    nextHandoffState: "acknowledged",
    fromOperatorId: "operator:fixture:a" as never,
    toOperatorId: "operator:fixture:b" as never,
    acknowledgementRequired: true,
    acknowledgementObservedAt: "2026-05-14T04:25:00.000Z" as never,
    reminderCreated: false,
    notificationSent: false,
  })),
  preview(operationalCommandExamples[6], workflowEvent("observe-projection", "workflow_projection_observed", 6, {
    reviewState: "in_review",
    assignmentState: "assigned",
    workflowProgressionState: "projection_observed",
    projectionVersion: "relationship-workflow:v0",
  }, {
    priorProgressionState: "projection_observed",
    nextProgressionState: "projection_observed",
    observedReviewState: "in_review",
    progressionReason: "Read-only fixture projection observation.",
    blockedByMissingFields: [],
    queueExecutionPerformed: false,
    workflowExecutionPerformed: false,
    uiDerivedProgression: false,
  })),
  preview(operationalCommandExamples[7], workflowEvent("block-progression", "workflow_progression_blocked", 7, {
    reviewState: "shared_review",
    assignmentState: "ownership_unclear",
    workflowProgressionState: "blocked",
    projectionVersion: "relationship-workflow:v0",
  }, {
    priorProgressionState: "projection_observed",
    nextProgressionState: "blocked",
    observedReviewState: "shared_review",
    progressionReason: "Assignment confidence is missing.",
    blockedByMissingFields: ["assignment_confidence"],
    queueExecutionPerformed: false,
    workflowExecutionPerformed: false,
    uiDerivedProgression: false,
  })),
] satisfies readonly PlannedCanonicalOperationalEventPreview[];

export const operationalCommandTranslationInputs = operationalCommandExamples.map((command) => ({
  mode: "fixture_only_translation_input",
  workspaceId: command.workspaceId,
  relationshipId: command.relationshipId,
  command,
  expectedCurrentState: command.expectedPriorState,
  boundary: operationalCommandTranslationBoundary,
})) satisfies readonly OperationalCommandTranslationInput[];

export const operationalCommandTranslationOutputs = plannedOperationalEventPreviews.map((plannedEventPreview, index) => ({
  status: "planned_no_write",
  acceptedForFutureEventPlanning: true,
  input: operationalCommandTranslationInputs[index],
  plannedEventPreview,
  issues: [],
  conflicts: [],
  dryRunGuarantees: operationalCommandTranslationDryRunGuarantees,
  boundary: operationalCommandTranslationBoundary,
})) satisfies readonly OperationalCommandTranslationOutput[];

export const operationalCommandTranslationDuplicateNoopExample = {
  status: "exact_duplicate_noop",
  acceptedForFutureEventPlanning: false,
  input: {
    ...operationalCommandTranslationInputs[0],
    existingCommandFingerprint: commandFingerprint(operationalCommandExamples[0]),
  },
  plannedEventPreview: plannedOperationalEventPreviews[0],
  issues: [],
  conflicts: [translationConflict("exact_duplicate_noop", operationalCommandExamples[0], operationalCommandExamples[0], "noop_exact_duplicate")],
  dryRunGuarantees: operationalCommandTranslationDryRunGuarantees,
  boundary: operationalCommandTranslationBoundary,
} satisfies OperationalCommandTranslationOutput;

export const operationalCommandTranslationConflictExample = {
  status: "explicit_conflict",
  acceptedForFutureEventPlanning: false,
  input: {
    ...operationalCommandTranslationInputs[1],
    existingCommandFingerprint: {
      ...commandFingerprint(operationalCommandExamples[1]),
      expectedPriorState: {
        reviewState: "reviewed",
        assignmentState: "assigned",
        projectionVersion: "relationship-workflow:v0",
      },
    },
  },
  issues: [],
  conflicts: [translationConflict("expected_state_mismatch", operationalCommandExamples[1], operationalCommandExamples[1], "reject_until_expected_state_is_refreshed", {
    reviewState: "reviewed",
    assignmentState: "assigned",
    projectionVersion: "relationship-workflow:v0",
  })],
  dryRunGuarantees: operationalCommandTranslationDryRunGuarantees,
  boundary: operationalCommandTranslationBoundary,
} satisfies OperationalCommandTranslationOutput;

export const operationalCommandTranslationValidationFailureExamples = [
  validationFailure("missing_evidence", "evidence", "Fixture command must include explicit evidence before event planning."),
  validationFailure("forbidden_automation_intent", "payload", "Automation intent is forbidden in fixture-only translation."),
  validationFailure("forbidden_reminder_intent", "payload", "Reminder intent is forbidden in fixture-only translation."),
  validationFailure("forbidden_notification_intent", "payload", "Notification intent is forbidden in fixture-only translation."),
  validationFailure("forbidden_queue_execution_intent", "payload", "Queue execution intent is forbidden in fixture-only translation."),
  validationFailure("forbidden_workflow_execution_intent", "payload", "Workflow execution intent is forbidden in fixture-only translation."),
] satisfies readonly OperationalCommandTranslationOutput[];

export const operationalCommandTranslationAllOutputs = [
  ...operationalCommandTranslationOutputs,
  operationalCommandTranslationDuplicateNoopExample,
  operationalCommandTranslationConflictExample,
  ...operationalCommandTranslationValidationFailureExamples,
] satisfies readonly OperationalCommandTranslationOutput[];

function preview(
  command: OperationalEventCommand,
  plannedEvent: CanonicalOperationalEventEnvelope,
): PlannedCanonicalOperationalEventPreview {
  return {
    mode: "planned_canonical_event_preview_only",
    previewOnly: true,
    plannedEventId: plannedEvent.id,
    plannedEventFamily: command.dryRunPlan.plannedEventFamily,
    plannedEventKind: command.dryRunPlan.plannedEventKind,
    plannedEvent,
    replayOrdering: plannedEvent.ordering,
    expectedState: plannedEvent.expectedState,
    dryRunGuarantees: operationalCommandTranslationDryRunGuarantees,
  };
}

function reviewEvent(
  key: string,
  kind: ReviewHistoryOperationalEventEnvelope["kind"],
  sequence: number,
  expectedState: CanonicalOperationalExpectedState,
  payload: ReviewHistoryOperationalEventEnvelope["payload"],
): ReviewHistoryOperationalEventEnvelope {
  return baseEvent("review_history", kind, key, sequence, expectedState, payload);
}

function assignmentEvent(
  key: string,
  kind: AssignmentHistoryOperationalEventEnvelope["kind"],
  sequence: number,
  expectedState: CanonicalOperationalExpectedState,
  payload: AssignmentHistoryOperationalEventEnvelope["payload"],
): AssignmentHistoryOperationalEventEnvelope {
  return baseEvent("assignment_history", kind, key, sequence, expectedState, payload);
}

function handoffEvent(
  key: string,
  kind: OperatorHandoffOperationalEventEnvelope["kind"],
  sequence: number,
  expectedState: CanonicalOperationalExpectedState,
  payload: OperatorHandoffOperationalEventEnvelope["payload"],
): OperatorHandoffOperationalEventEnvelope {
  return baseEvent("operator_handoff", kind, key, sequence, expectedState, payload);
}

function workflowEvent(
  key: string,
  kind: WorkflowProgressionOperationalEventEnvelope["kind"],
  sequence: number,
  expectedState: CanonicalOperationalExpectedState,
  payload: WorkflowProgressionOperationalEventEnvelope["payload"],
): WorkflowProgressionOperationalEventEnvelope {
  return baseEvent("workflow_progression", kind, key, sequence, expectedState, payload);
}

function baseEvent<
  Family extends CanonicalOperationalEventFamily,
  Kind extends CanonicalOperationalEventKind,
  Payload extends object,
>(
  family: Family,
  kind: Kind,
  key: string,
  sequence: number,
  expectedState: CanonicalOperationalExpectedState,
  payload: Payload,
) {
  const id = `operational:event:translation:fixture:${key}`;
  return {
    id: id as never,
    family,
    kind,
    metadata: metadata(family, kind, sequence),
    ordering: ordering(sequence, id),
    idempotency: eventIdempotency(key, sequence),
    explainability: explainability(key, `Fixture translation previews ${kind} without emitting it.`, sequence % 2 === 0 ? "high" : "medium"),
    expectedState,
    appendOnly,
    boundary: eventBoundary,
    payload,
  };
}

function metadata<
  Family extends CanonicalOperationalEventFamily,
  Kind extends CanonicalOperationalEventKind,
>(
  family: Family,
  kind: Kind,
  sequence: number,
): CanonicalOperationalEventMetadata & { readonly family: Family; readonly kind: Kind } {
  const source: CanonicalOperationalEventSource = family === "workflow_progression" ? "engine" : "operator";
  return {
    schemaVersion: "operational_event_envelope_v0",
    eventVersion: 0,
    workspaceId: workspaceId(),
    relationshipId: relationshipId(),
    family,
    kind,
    occurredAt: `2026-05-14T04:${String(20 + sequence).padStart(2, "0")}:00.000Z` as never,
    recordedAt: `2026-05-14T04:${String(20 + sequence).padStart(2, "0")}:01.000Z` as never,
    source,
    actor: source === "operator" ? operatorActor("operator:fixture:a", "Fixture Operator A") : systemActor(),
    sourceProjection: sourceProjection(source === "operator" ? "manual_operator_observation" : "relationship_workflow_projection", sequence),
  };
}

function ordering(sequence: number, id: string): CanonicalOperationalEventEnvelope["ordering"] {
  const occurredAt = `2026-05-14T04:${String(20 + sequence).padStart(2, "0")}:00.000Z`;
  const recordedAt = `2026-05-14T04:${String(20 + sequence).padStart(2, "0")}:01.000Z`;
  return {
    strategy: "deterministic_operational_event_replay_v0",
    orderKey: `${occurredAt}:${recordedAt}:${familyRank(sequence)}:${sequence}:${id}`,
    occurredAt: occurredAt as never,
    recordedAt: recordedAt as never,
    familyRank: familyRank(sequence),
    kindRank: sequence,
    eventIdTieBreaker: id as never,
    sourceEventIds: [],
    hiddenStateInputsAllowed: false,
  };
}

function familyRank(sequence: number): number {
  if (sequence < 2) return 0;
  if (sequence < 4) return 1;
  if (sequence < 6) return 4;
  return 3;
}

function eventIdempotency(key: string, sequence: number): CanonicalOperationalEventEnvelope["idempotency"] {
  return {
    strategy: "deterministic_operational_event_idempotency_v0",
    idempotencyKey: commandKey(key),
    dedupeKey: `dedupe:translation-fixture:${key}` as never,
    deterministicIdInputs: [
      "workspace:operational-command-translation-fixtures",
      "relationship:operational-command-translation-fixtures",
      key,
      String(sequence),
      "fixture-only-command-to-event-preview",
    ],
    duplicatePolicy: "collapse_exact_duplicate",
    conflictPolicy: "explicit_conflict_when_expected_state_differs",
  };
}

function commandFingerprint(command: OperationalEventCommand) {
  return {
    commandKind: command.kind,
    idempotencyKey: command.idempotencyKey,
    expectedPriorState: command.expectedPriorState,
    deterministicCommandInputs: command.idempotency.deterministicCommandInputs,
  };
}

function translationConflict(
  code: "exact_duplicate_noop" | "expected_state_mismatch",
  existing: OperationalEventCommand,
  incoming: OperationalEventCommand,
  resolution: "noop_exact_duplicate" | "reject_until_expected_state_is_refreshed",
  existingExpectedState: CanonicalOperationalExpectedState = existing.expectedPriorState,
): OperationalCommandTranslationConflictIssue {
  return {
    code,
    message: code === "exact_duplicate_noop"
      ? "Exact duplicate command is accepted as a no-op."
      : "Incoming expected state differs from the existing command fingerprint.",
    idempotencyKey: incoming.idempotencyKey,
    existingCommandKind: existing.kind,
    incomingCommandKind: incoming.kind,
    resolution,
    existingExpectedState,
    incomingExpectedState: incoming.expectedPriorState,
    appendPrevented: true,
  };
}

function validationFailure(
  code: "missing_evidence" | "forbidden_automation_intent" | "forbidden_reminder_intent" | "forbidden_notification_intent" | "forbidden_queue_execution_intent" | "forbidden_workflow_execution_intent",
  field: "evidence" | "payload",
  message: string,
): OperationalCommandTranslationOutput {
  return {
    status: "validation_failed",
    acceptedForFutureEventPlanning: false,
    input: operationalCommandTranslationInputs[0],
    issues: [{ code, field, message }],
    conflicts: [],
    dryRunGuarantees: operationalCommandTranslationDryRunGuarantees,
    boundary: operationalCommandTranslationBoundary,
  };
}

function commandIdempotency(
  kind: OperationalEventCommandKind,
  key: string,
): OperationalEventCommandIdempotencyRequirements {
  return {
    idempotencyKey: commandKey(key),
    dedupeScope: kind === "observe_projection" || kind === "block_progression"
      ? "workspace_relationship_command_kind_source_projection"
      : "workspace_relationship_command_kind_actor",
    deterministicCommandInputs: [
      "workspace:operational-command-translation-fixtures",
      "relationship:operational-command-translation-fixtures",
      kind,
      key,
    ],
    exactDuplicatePolicy: "noop",
    expectedStateMismatchPolicy: "explicit_conflict",
    missingEvidencePolicy: "validation_failure",
    forbiddenAutomationIntentPolicy: "validation_failure",
  };
}

function dryRunPlan<
  Family extends CanonicalOperationalEventFamily,
  Kind extends CanonicalOperationalEventKind,
>(
  plannedEventFamily: Family,
  plannedEventKind: Kind,
): OperationalEventCommandDryRunPlan & {
  readonly plannedEventFamily: Family;
  readonly plannedEventKind: Kind;
} {
  return {
    plannedEventFamily,
    plannedEventKind,
    wouldEmitCanonicalEvent: false,
    wouldPersist: false,
    wouldExecuteAutomation: false,
    wouldSendReminder: false,
    wouldSendNotification: false,
    wouldExecuteQueue: false,
    wouldExecuteWorkflow: false,
  };
}

function approval(
  mode: "explicit_operator_approval" | "explicit_manager_approval" | "system_observation_without_execution",
  approvalObservedAt: string | undefined,
): OperationalEventCommandApprovalSemantics {
  return {
    mode,
    actorApprovalRequired: mode !== "system_observation_without_execution",
    approvalEvidenceRequired: true,
    implicitApprovalAllowed: false,
    automationApprovalAllowed: false,
    ...(approvalObservedAt ? { approvalObservedAt: approvalObservedAt as never } : {}),
  };
}

function explainability(
  key: string,
  summary: string,
  confidence: EvidenceRef["confidence"],
): CanonicalOperationalExplainabilityMetadata {
  const evidence = evidenceRef(key, confidence);
  return {
    whyVisible: { state: "explained", summary, evidenceIds: [evidence.id] },
    whyAssigned: { state: "explained", summary: "Fixture command preserves explicit assignment context.", evidenceIds: [evidence.id] },
    whyEscalated: { state: "not_applicable", summary: "No escalation is asserted by this translation fixture.", evidenceIds: [] },
    whyContinuityChanged: { state: "explained", summary, evidenceIds: [evidence.id] },
    missingDataEffects: [{
      field: "assignment_confidence",
      effect: confidence === "high" ? "not_applicable" : "blocks_progression",
      explanation: "Fixture translation keeps missing data explicit.",
    }],
    confidence: {
      level: confidence,
      rationale: "Fixture command evidence and reason codes are explicit and deterministic.",
      missingDataAdjusted: confidence !== "high",
    },
    evidence: [evidence],
    reasonCodes: [`fixture_translation_${key.replaceAll("-", "_")}`],
  };
}

function evidenceRef(key: string, confidence: EvidenceRef["confidence"]): EvidenceRef {
  return {
    id: `evidence:operational-command-translation:${key}`,
    source: "operator",
    label: `Operational command translation fixture evidence for ${key}`,
    observedAt: "2026-05-14T04:20:00.000Z" as never,
    confidence,
    notes: "Static fixture evidence; no runtime write path is exercised.",
  };
}

function sourceProjection(
  projectionKind: CanonicalOperationalSourceProjectionMetadata["projectionKind"],
  sequence: number,
): CanonicalOperationalSourceProjectionMetadata {
  return {
    projectionKind,
    projectionVersion: projectionKind === "operator_workflow_continuity_projection"
      ? "operator-workflow-continuity:v0"
      : "relationship-workflow:v0",
    generatedAt: `2026-05-14T04:${String(20 + sequence).padStart(2, "0")}:00.000Z` as never,
    sourceWatermark: `translation-fixture-watermark-${sequence}`,
    derivedCacheCanonical: false,
  };
}

function operatorActor(actorId: string, displayName: string): CanonicalOperationalEventActor {
  return {
    actorId: actorId as never,
    role: "operator",
    source: "operator",
    displayName,
  };
}

function systemActor(): CanonicalOperationalEventActor {
  return {
    actorId: "system",
    role: "system",
    source: "engine",
    displayName: "Fixture System",
  };
}

function workspaceId() {
  return "workspace:operational-command-translation-fixtures" as never;
}

function relationshipId() {
  return "relationship:operational-command-translation-fixtures" as never;
}

function commandKey(key: string): OperationalEventIdempotencyKey {
  return `idempotency:translation-fixture:${key}` as never;
}
