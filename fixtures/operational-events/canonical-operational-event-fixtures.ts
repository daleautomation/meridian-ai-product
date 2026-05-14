import type {
  AssignmentHistoryOperationalEventEnvelope,
  CanonicalOperationalAppendOnlySemantics,
  CanonicalOperationalEventBoundaryPolicy,
  CanonicalOperationalEventEnvelope,
  CanonicalOperationalEventFamily,
  CanonicalOperationalEventKind,
  CanonicalOperationalEventMetadata,
  CanonicalOperationalEventSource,
  ContinuityHistoryOperationalEventEnvelope,
  OperatorHandoffOperationalEventEnvelope,
  ReviewHistoryOperationalEventEnvelope,
  WorkflowProgressionOperationalEventEnvelope,
} from "@/lib/relationship-engine/operational/events";
import type { EvidenceRef } from "@/lib/relationship-engine/primitives";

export const canonicalOperationalFixtureBoundary = {
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

export const canonicalOperationalFixtureAppendOnly = {
  strategy: "append_only_operational_memory_v0",
  mutationSemanticsAllowed: false,
  overwriteSemanticsAllowed: false,
  deletionSemanticsAllowed: false,
  correctionStrategy: "append_reversal_or_supersession_event",
  projectionCacheCanonical: false,
} satisfies CanonicalOperationalAppendOnlySemantics;

export const reviewHistoryOperationalEventFixtures = [
  {
    id: "operational:event:fixture:review-started" as never,
    family: "review_history",
    kind: "review_started",
    metadata: metadata("review_history", "review_started", "operator", 0),
    ordering: ordering("2026-05-14T04:00:00.000Z", "2026-05-14T04:00:01.000Z", 0, 0, "operational:event:fixture:review-started"),
    idempotency: idempotency("review-started", 0),
    explainability: explainability("review-started", "Operator explicitly started the relationship review.", "high"),
    expectedState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      continuityState: "active_review",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      scope: "relationship_review",
      priorReviewState: "not_reviewed",
      nextReviewState: "in_review",
      reviewerId: "operator:fixture:a" as never,
      sharedWithOperatorIds: [],
      completionInferred: false,
    },
  },
  {
    id: "operational:event:fixture:review-shared" as never,
    family: "review_history",
    kind: "review_shared",
    metadata: metadata("review_history", "review_shared", "operator", 1),
    ordering: ordering("2026-05-14T04:02:00.000Z", "2026-05-14T04:02:03.000Z", 0, 3, "operational:event:fixture:review-shared"),
    idempotency: idempotency("review-shared", 1),
    explainability: explainability("review-shared", "Review visibility was shared with a second operator for explicit collaboration.", "medium"),
    expectedState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      continuityState: "shared_review",
      projectionVersion: "multi-operator:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      scope: "shared_review",
      priorReviewState: "in_review",
      nextReviewState: "shared_review",
      reviewerId: "operator:fixture:a" as never,
      sharedWithOperatorIds: ["operator:fixture:b" as never],
      completionInferred: false,
    },
  },
] satisfies readonly ReviewHistoryOperationalEventEnvelope[];

export const assignmentHistoryOperationalEventFixtures = [
  {
    id: "operational:event:fixture:assignment-created" as never,
    family: "assignment_history",
    kind: "assignment_created",
    metadata: metadata("assignment_history", "assignment_created", "engine", 2),
    ordering: ordering("2026-05-14T04:00:00.000Z", "2026-05-14T04:00:01.000Z", 1, 0, "operational:event:fixture:assignment-created"),
    idempotency: idempotency("assignment-created", 2),
    explainability: explainability("assignment-created", "Fixture records explicit primary ownership already visible in the source projection.", "high"),
    expectedState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      projectionVersion: "relationship-workflow:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorAssignmentState: "unassigned",
      nextAssignmentState: "assigned",
      nextOwnerId: "operator:fixture:a" as never,
      visibleOperatorIds: ["operator:fixture:a" as never],
      visibilityScope: "primary_owner",
      assignmentMutationExecuted: false,
    },
  },
  {
    id: "operational:event:fixture:assignment-visibility-changed" as never,
    family: "assignment_history",
    kind: "assignment_visibility_changed",
    metadata: metadata("assignment_history", "assignment_visibility_changed", "engine", 3),
    ordering: ordering("2026-05-14T04:02:00.000Z", "2026-05-14T04:02:01.000Z", 1, 3, "operational:event:fixture:assignment-visibility-changed"),
    idempotency: idempotency("assignment-visibility-changed", 3),
    explainability: explainability("assignment-visibility-changed", "Fixture records visibility broadening without changing ownership.", "medium"),
    expectedState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      projectionVersion: "multi-operator:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorAssignmentState: "assigned",
      nextAssignmentState: "shared",
      previousOwnerId: "operator:fixture:a" as never,
      nextOwnerId: "operator:fixture:a" as never,
      visibleOperatorIds: ["operator:fixture:a" as never, "operator:fixture:b" as never],
      visibilityScope: "shared_review",
      assignmentMutationExecuted: false,
    },
  },
] satisfies readonly AssignmentHistoryOperationalEventEnvelope[];

export const continuityHistoryOperationalEventFixtures = [
  {
    id: "operational:event:fixture:continuity-created" as never,
    family: "continuity_history",
    kind: "continuity_context_created",
    metadata: metadata("continuity_history", "continuity_context_created", "engine", 4),
    ordering: ordering("2026-05-14T04:00:02.000Z", "2026-05-14T04:00:03.000Z", 2, 0, "operational:event:fixture:continuity-created"),
    idempotency: idempotency("continuity-created", 4),
    explainability: explainability("continuity-created", "Continuity context became active after explicit review start evidence.", "high"),
    expectedState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      continuityState: "active_review",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorContinuityState: "not_started",
      nextContinuityState: "active_review",
      continuityReason: "Review start evidence creates active continuity context.",
      reviewState: "in_review",
      assignmentState: "assigned",
      lifecycleContext: "active relationship review",
      sourceOperationalEventIds: ["operational:event:fixture:review-started" as never],
      projectionCacheCanonical: false,
    },
  },
  {
    id: "operational:event:fixture:continuity-changed" as never,
    family: "continuity_history",
    kind: "continuity_context_changed",
    metadata: metadata("continuity_history", "continuity_context_changed", "engine", 5),
    ordering: ordering("2026-05-14T04:02:02.000Z", "2026-05-14T04:02:04.000Z", 2, 1, "operational:event:fixture:continuity-changed"),
    idempotency: idempotency("continuity-changed", 5),
    explainability: explainability("continuity-changed", "Continuity changed because shared review evidence is now explicit.", "medium"),
    expectedState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      continuityState: "shared_review",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorContinuityState: "active_review",
      nextContinuityState: "shared_review",
      continuityReason: "Shared visibility requires handoff-ready continuity context.",
      reviewState: "shared_review",
      assignmentState: "shared",
      lifecycleContext: "active shared relationship review",
      sourceOperationalEventIds: ["operational:event:fixture:review-shared" as never],
      projectionCacheCanonical: false,
    },
  },
] satisfies readonly ContinuityHistoryOperationalEventEnvelope[];

export const workflowProgressionOperationalEventFixtures = [
  {
    id: "operational:event:fixture:workflow-projection-observed" as never,
    family: "workflow_progression",
    kind: "workflow_projection_observed",
    metadata: metadata("workflow_progression", "workflow_projection_observed", "engine", 6),
    ordering: ordering("2026-05-14T04:00:04.000Z", "2026-05-14T04:00:05.000Z", 3, 0, "operational:event:fixture:workflow-projection-observed"),
    idempotency: idempotency("workflow-projection-observed", 6),
    explainability: explainability("workflow-projection-observed", "Workflow projection was observed from fixed fixture inputs only.", "high"),
    expectedState: {
      reviewState: "in_review",
      assignmentState: "assigned",
      workflowProgressionState: "projection_observed",
      projectionVersion: "relationship-workflow:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorProgressionState: "projection_observed",
      nextProgressionState: "projection_observed",
      observedReviewState: "in_review",
      progressionReason: "Read-only projection observation is captured as replay fixture data.",
      blockedByMissingFields: [],
      queueExecutionPerformed: false,
      workflowExecutionPerformed: false,
      uiDerivedProgression: false,
    },
  },
  {
    id: "operational:event:fixture:workflow-progression-blocked" as never,
    family: "workflow_progression",
    kind: "workflow_progression_blocked",
    metadata: metadata("workflow_progression", "workflow_progression_blocked", "engine", 7),
    ordering: ordering("2026-05-14T04:03:00.000Z", "2026-05-14T04:03:01.000Z", 3, 2, "operational:event:fixture:workflow-progression-blocked"),
    idempotency: idempotency("workflow-progression-blocked", 7),
    explainability: explainability("workflow-progression-blocked", "Progression is blocked because assignment confidence is incomplete.", "medium"),
    expectedState: {
      reviewState: "shared_review",
      assignmentState: "ownership_unclear",
      workflowProgressionState: "blocked",
      projectionVersion: "relationship-workflow:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorProgressionState: "projection_observed",
      nextProgressionState: "blocked",
      observedReviewState: "shared_review",
      progressionReason: "Assignment clarity is required before progression can be approved.",
      blockedByMissingFields: ["assignment_confidence"],
      queueExecutionPerformed: false,
      workflowExecutionPerformed: false,
      uiDerivedProgression: false,
    },
  },
] satisfies readonly WorkflowProgressionOperationalEventEnvelope[];

export const operatorHandoffOperationalEventFixtures = [
  {
    id: "operational:event:fixture:handoff-prepared" as never,
    family: "operator_handoff",
    kind: "handoff_context_prepared",
    metadata: metadata("operator_handoff", "handoff_context_prepared", "operator", 8),
    ordering: ordering("2026-05-14T04:02:05.000Z", "2026-05-14T04:02:06.000Z", 4, 0, "operational:event:fixture:handoff-prepared"),
    idempotency: idempotency("handoff-prepared", 8),
    explainability: explainability("handoff-prepared", "Handoff context was prepared for the second operator without sending anything.", "medium"),
    expectedState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      handoffState: "prepared",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorHandoffState: "superseded",
      nextHandoffState: "prepared",
      fromOperatorId: "operator:fixture:a" as never,
      toOperatorId: "operator:fixture:b" as never,
      acknowledgementRequired: true,
      reminderCreated: false,
      notificationSent: false,
    },
  },
  {
    id: "operational:event:fixture:handoff-acknowledged" as never,
    family: "operator_handoff",
    kind: "handoff_context_acknowledged",
    metadata: metadata("operator_handoff", "handoff_context_acknowledged", "operator", 9),
    ordering: ordering("2026-05-14T04:04:00.000Z", "2026-05-14T04:04:01.000Z", 4, 1, "operational:event:fixture:handoff-acknowledged"),
    idempotency: idempotency("handoff-acknowledged", 9),
    explainability: explainability("handoff-acknowledged", "Receiving operator explicitly acknowledged the handoff context.", "high"),
    expectedState: {
      reviewState: "shared_review",
      assignmentState: "shared",
      handoffState: "acknowledged",
      projectionVersion: "operator-workflow-continuity:v0",
    },
    appendOnly: canonicalOperationalFixtureAppendOnly,
    boundary: canonicalOperationalFixtureBoundary,
    payload: {
      priorHandoffState: "prepared",
      nextHandoffState: "acknowledged",
      fromOperatorId: "operator:fixture:a" as never,
      toOperatorId: "operator:fixture:b" as never,
      acknowledgementRequired: true,
      acknowledgementObservedAt: "2026-05-14T04:04:00.000Z" as never,
      reminderCreated: false,
      notificationSent: false,
    },
  },
] satisfies readonly OperatorHandoffOperationalEventEnvelope[];

export const canonicalOperationalEventFixtureFamilies = {
  review_history: reviewHistoryOperationalEventFixtures,
  assignment_history: assignmentHistoryOperationalEventFixtures,
  continuity_history: continuityHistoryOperationalEventFixtures,
  workflow_progression: workflowProgressionOperationalEventFixtures,
  operator_handoff: operatorHandoffOperationalEventFixtures,
} satisfies Record<CanonicalOperationalEventFamily, readonly CanonicalOperationalEventEnvelope[]>;

export const canonicalOperationalEventFixtures = [
  ...reviewHistoryOperationalEventFixtures,
  ...assignmentHistoryOperationalEventFixtures,
  ...continuityHistoryOperationalEventFixtures,
  ...workflowProgressionOperationalEventFixtures,
  ...operatorHandoffOperationalEventFixtures,
] satisfies readonly CanonicalOperationalEventEnvelope[];

function metadata<
  Family extends CanonicalOperationalEventFamily,
  Kind extends CanonicalOperationalEventKind,
>(
  family: Family,
  kind: Kind,
  source: CanonicalOperationalEventSource,
  sequence: number,
): CanonicalOperationalEventMetadata & { readonly family: Family; readonly kind: Kind } {
  const occurredAt = `2026-05-14T04:${String(sequence).padStart(2, "0")}:00.000Z`;

  return {
    schemaVersion: "operational_event_envelope_v0",
    eventVersion: 0,
    workspaceId: "workspace:operational-event-fixtures" as never,
    relationshipId: "relationship:operational-event-fixtures" as never,
    family,
    kind,
    occurredAt: occurredAt as never,
    recordedAt: "2026-05-14T04:10:00.000Z" as never,
    source,
    actor: {
      actorId: source === "operator" ? "operator:fixture:a" as never : "system",
      role: source === "operator" ? "operator" : "system",
      source,
      displayName: source === "operator" ? "Fixture Operator A" : "Fixture System",
    },
    sourceProjection: {
      projectionKind: source === "operator" ? "manual_operator_observation" : "operator_workflow_continuity_projection",
      projectionVersion: "operator-workflow-continuity:v0",
      generatedAt: "2026-05-14T04:00:00.000Z" as never,
      sourceWatermark: `fixture-watermark-${sequence}`,
      derivedCacheCanonical: false,
    },
  };
}

function ordering(
  occurredAt: string,
  recordedAt: string,
  familyRank: number,
  kindRank: number,
  id: string,
): CanonicalOperationalEventEnvelope["ordering"] {
  return {
    strategy: "deterministic_operational_event_replay_v0",
    orderKey: `${occurredAt}:${recordedAt}:${familyRank}:${kindRank}:${id}`,
    occurredAt: occurredAt as never,
    recordedAt: recordedAt as never,
    familyRank,
    kindRank,
    eventIdTieBreaker: id as never,
    sourceEventIds: [],
    hiddenStateInputsAllowed: false,
  };
}

function idempotency(key: string, sequence: number): CanonicalOperationalEventEnvelope["idempotency"] {
  return {
    strategy: "deterministic_operational_event_idempotency_v0",
    idempotencyKey: `idempotency:fixture:${key}` as never,
    dedupeKey: `dedupe:fixture:${key}` as never,
    deterministicIdInputs: [
      "workspace:operational-event-fixtures",
      "relationship:operational-event-fixtures",
      key,
      String(sequence),
      "2026-05-14T04:00:00.000Z",
    ],
    duplicatePolicy: "collapse_exact_duplicate",
    conflictPolicy: "explicit_conflict_when_expected_state_differs",
  };
}

function explainability(
  key: string,
  summary: string,
  confidenceLevel: EvidenceRef["confidence"],
): CanonicalOperationalEventEnvelope["explainability"] {
  const evidence = evidenceRef(key, confidenceLevel);

  return {
    whyVisible: { state: "explained", summary, evidenceIds: [evidence.id] },
    whyAssigned: { state: "explained", summary: "Assignment context is visible from fixture ownership evidence.", evidenceIds: [evidence.id] },
    whyEscalated: { state: "not_applicable", summary: "No escalation is asserted by this fixture event.", evidenceIds: [] },
    whyContinuityChanged: { state: "explained", summary, evidenceIds: [evidence.id] },
    missingDataEffects: [{
      field: "assignment_confidence",
      effect: confidenceLevel === "high" ? "not_applicable" : "blocks_progression",
      explanation: "Fixture keeps missing data explicit so replay cannot invent hidden priority.",
    }],
    confidence: {
      level: confidenceLevel,
      rationale: "Fixture evidence and reason codes are explicit and deterministic.",
      missingDataAdjusted: confidenceLevel !== "high",
    },
    evidence: [evidence],
    reasonCodes: [`fixture_${key.replaceAll("-", "_")}`],
  };
}

function evidenceRef(key: string, confidence: EvidenceRef["confidence"]): EvidenceRef {
  return {
    id: `evidence:operational-event-fixture:${key}`,
    source: "engine",
    label: `Operational event fixture evidence for ${key}`,
    observedAt: "2026-05-14T04:00:00.000Z" as never,
    confidence,
    notes: "Static fixture evidence; no runtime write path is exercised.",
  };
}
