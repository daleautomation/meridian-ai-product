import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  type CanonicalOperationalAppendOnlySemantics,
  type CanonicalOperationalEventBoundaryPolicy,
  type CanonicalOperationalEventEnvelope,
  type CanonicalOperationalEventFamily,
  type CanonicalOperationalEventKind,
  type CanonicalOperationalEventMetadata,
  type CanonicalOperationalEventSource,
  type EvidenceRef,
} from "@/lib/relationship-engine";

const eventModuleSource = readFileSync("lib/relationship-engine/operational/events.ts", "utf8");

const boundary = {
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

const evidence = {
  id: "evidence:canonical-operational-events:review-started",
  source: "engine",
  label: "Canonical operational event fixture",
  observedAt: "2026-05-14T03:00:00.000Z" as never,
  confidence: "medium",
} satisfies EvidenceRef;

const reviewStarted = {
  id: "operational:event:review-started" as never,
  family: "review_history",
  kind: "review_started",
  metadata: metadata("review_history", "review_started", "operator"),
  ordering: ordering("2026-05-14T03:00:00.000Z", "2026-05-14T03:00:01.000Z", 0, 0, "operational:event:review-started"),
  idempotency: idempotency("review-started"),
  explainability: explainability("Relationship entered explicit review visibility."),
  expectedState: {
    reviewState: "not_reviewed",
    assignmentState: "assigned",
    continuityState: "not_started",
    projectionVersion: "workflow-continuity:v0",
  },
  appendOnly,
  boundary,
  payload: {
    scope: "relationship_review",
    priorReviewState: "not_reviewed",
    nextReviewState: "in_review",
    reviewerId: "operator:canonical-events:a" as never,
    sharedWithOperatorIds: [],
    completionInferred: false,
  },
} satisfies CanonicalOperationalEventEnvelope;

const assignmentVisibilityChanged = {
  id: "operational:event:assignment-visibility" as never,
  family: "assignment_history",
  kind: "assignment_visibility_changed",
  metadata: metadata("assignment_history", "assignment_visibility_changed", "engine"),
  ordering: ordering("2026-05-14T03:00:00.000Z", "2026-05-14T03:00:01.000Z", 1, 3, "operational:event:assignment-visibility"),
  idempotency: idempotency("assignment-visibility"),
  explainability: explainability("Relationship stayed assigned and became shared-review visible."),
  expectedState: {
    reviewState: "in_review",
    assignmentState: "assigned",
    projectionVersion: "multi-operator:v0",
  },
  appendOnly,
  boundary,
  payload: {
    priorAssignmentState: "assigned",
    nextAssignmentState: "shared",
    previousOwnerId: "operator:canonical-events:a" as never,
    nextOwnerId: "operator:canonical-events:a" as never,
    visibleOperatorIds: ["operator:canonical-events:a" as never, "operator:canonical-events:b" as never],
    visibilityScope: "shared_review",
    assignmentMutationExecuted: false,
  },
} satisfies CanonicalOperationalEventEnvelope;

const continuityChanged = {
  id: "operational:event:continuity-changed" as never,
  family: "continuity_history",
  kind: "continuity_context_changed",
  metadata: metadata("continuity_history", "continuity_context_changed", "engine"),
  ordering: ordering("2026-05-14T03:00:02.000Z", "2026-05-14T03:00:02.000Z", 2, 1, "operational:event:continuity-changed"),
  idempotency: idempotency("continuity-changed"),
  explainability: explainability("Continuity changed because shared review evidence is now visible."),
  expectedState: {
    reviewState: "shared_review",
    assignmentState: "shared",
    continuityState: "active_review",
    projectionVersion: "operator-workflow-continuity:v0",
  },
  appendOnly,
  boundary,
  payload: {
    priorContinuityState: "active_review",
    nextContinuityState: "shared_review",
    continuityReason: "Shared review visibility requires explicit handoff context.",
    reviewState: "shared_review",
    assignmentState: "shared",
    lifecycleContext: "active relationship review",
    sourceOperationalEventIds: ["operational:event:review-started" as never],
    projectionCacheCanonical: false,
  },
} satisfies CanonicalOperationalEventEnvelope;

const workflowBlocked = {
  id: "operational:event:workflow-blocked" as never,
  family: "workflow_progression",
  kind: "workflow_progression_blocked",
  metadata: metadata("workflow_progression", "workflow_progression_blocked", "engine"),
  ordering: ordering("2026-05-14T03:00:02.000Z", "2026-05-14T03:00:03.000Z", 3, 2, "operational:event:workflow-blocked"),
  idempotency: idempotency("workflow-blocked"),
  explainability: explainability("Progression is blocked because assignment confidence is incomplete."),
  expectedState: {
    reviewState: "shared_review",
    assignmentState: "ownership_unclear",
    workflowProgressionState: "projection_observed",
    projectionVersion: "workflow:v0",
  },
  appendOnly,
  boundary,
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
} satisfies CanonicalOperationalEventEnvelope;

const handoffPrepared = {
  id: "operational:event:handoff-prepared" as never,
  family: "operator_handoff",
  kind: "handoff_context_prepared",
  metadata: metadata("operator_handoff", "handoff_context_prepared", "operator"),
  ordering: ordering("2026-05-14T03:00:03.000Z", "2026-05-14T03:00:04.000Z", 4, 0, "operational:event:handoff-prepared"),
  idempotency: idempotency("handoff-prepared"),
  explainability: explainability("Handoff context was prepared for the second operator."),
  expectedState: {
    reviewState: "shared_review",
    assignmentState: "shared",
    handoffState: "prepared",
    projectionVersion: "operator-workflow-continuity:v0",
  },
  appendOnly,
  boundary,
  payload: {
    priorHandoffState: "superseded",
    nextHandoffState: "prepared",
    fromOperatorId: "operator:canonical-events:a" as never,
    toOperatorId: "operator:canonical-events:b" as never,
    acknowledgementRequired: true,
    reminderCreated: false,
    notificationSent: false,
  },
} satisfies CanonicalOperationalEventEnvelope;

const events = [
  handoffPrepared,
  workflowBlocked,
  continuityChanged,
  assignmentVisibilityChanged,
  reviewStarted,
] satisfies readonly CanonicalOperationalEventEnvelope[];

const replayOrdered = [...events].sort(compareOperationalEvents);
assert.deepEqual(
  replayOrdered.map((event) => event.id),
  [
    reviewStarted.id,
    assignmentVisibilityChanged.id,
    continuityChanged.id,
    workflowBlocked.id,
    handoffPrepared.id,
  ],
  "operational event replay ordering must be deterministic under reversed inputs",
);

const duplicateReview = { ...reviewStarted };
const deduped = new Map<string, CanonicalOperationalEventEnvelope>();
for (const event of [reviewStarted, duplicateReview]) {
  deduped.set(event.idempotency.dedupeKey, event);
}
assert.equal(deduped.size, 1, "exact duplicate operational events must collapse by dedupe key");

for (const event of replayOrdered) {
  assert.equal(event.appendOnly.mutationSemanticsAllowed, false);
  assert.equal(event.appendOnly.overwriteSemanticsAllowed, false);
  assert.equal(event.boundary.persistenceAllowed, false);
  assert.equal(event.boundary.neonWritesAllowed, false);
  assert.equal(event.boundary.automationAllowed, false);
  assert.equal(event.boundary.queueExecutionAllowed, false);
  assert.equal(event.boundary.workflowExecutionAllowed, false);
  assert.equal(event.boundary.inferredReviewCompletionAllowed, false);
  assert.equal(event.boundary.uiDerivedWorkflowMemoryAllowed, false);
  assert.equal(event.boundary.projectionCacheCanonicalAllowed, false);
  assert.ok(event.explainability.evidence.length > 0);
  assert.ok(event.explainability.reasonCodes.length > 0);
  assert.ok(event.explainability.confidence.rationale);
  assert.ok(event.metadata.actor.actorId);
  assert.ok(event.metadata.source);
}

assert.equal(
  /relationship-engine\/repositories|from "\.\.\/repositories|from "\.\/repositories/.test(eventModuleSource),
  false,
  "operational event contracts must not import repositories",
);
assert.equal(
  /executeQueue|sendNotification|createReminder|writeOperatorSnapshot|neonWrite\s*\(|method:\s*["']POST["']|method:\s*["']PATCH["']|method:\s*["']PUT["']|method:\s*["']DELETE["']/i.test(eventModuleSource),
  false,
  "operational event contracts must not add write or automation paths",
);

console.log("canonical operational event envelope check passed", {
  families: [...new Set(replayOrdered.map((event) => event.family))],
  replayOrder: replayOrdered.map((event) => event.id),
  dedupedEvents: deduped.size,
  persistenceAllowed: boundary.persistenceAllowed,
  automationAllowed: boundary.automationAllowed,
});

function metadata<
  Family extends CanonicalOperationalEventFamily,
  Kind extends CanonicalOperationalEventKind,
>(
  family: Family,
  kind: Kind,
  source: CanonicalOperationalEventSource,
): CanonicalOperationalEventMetadata & { readonly family: Family; readonly kind: Kind } {
  return {
    schemaVersion: "operational_event_envelope_v0",
    eventVersion: 0,
    workspaceId: "workspace:canonical-operational-events" as never,
    relationshipId: "relationship:canonical-operational-events" as never,
    family,
    kind,
    occurredAt: "2026-05-14T03:00:00.000Z" as never,
    recordedAt: "2026-05-14T03:00:01.000Z" as never,
    source,
    actor: {
      actorId: source === "operator" ? "operator:canonical-events:a" as never : "system",
      role: source === "operator" ? "operator" : "system",
      source,
    },
    sourceProjection: {
      projectionKind: "operator_workflow_continuity_projection",
      projectionVersion: "operator-workflow-continuity:v0",
      generatedAt: "2026-05-14T03:00:00.000Z" as never,
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

function idempotency(key: string): CanonicalOperationalEventEnvelope["idempotency"] {
  return {
    strategy: "deterministic_operational_event_idempotency_v0",
    idempotencyKey: `idempotency:${key}` as never,
    dedupeKey: `dedupe:${key}` as never,
    deterministicIdInputs: [
      "workspace:canonical-operational-events",
      "relationship:canonical-operational-events",
      key,
      "2026-05-14T03:00:00.000Z",
    ],
    duplicatePolicy: "collapse_exact_duplicate",
    conflictPolicy: "explicit_conflict_when_expected_state_differs",
  };
}

function explainability(summary: string): CanonicalOperationalEventEnvelope["explainability"] {
  return {
    whyVisible: { state: "explained", summary, evidenceIds: [evidence.id] },
    whyAssigned: { state: "explained", summary: "Assignment context is visible from canonical relationship ownership.", evidenceIds: [evidence.id] },
    whyEscalated: { state: "not_applicable", summary: "No escalation is asserted by this fixture event.", evidenceIds: [] },
    whyContinuityChanged: { state: "explained", summary, evidenceIds: [evidence.id] },
    missingDataEffects: [{
      field: "assignment_confidence",
      effect: "lowers_confidence",
      explanation: "The fixture keeps missing data explicit instead of turning it into hidden priority.",
    }],
    confidence: {
      level: "medium",
      rationale: "Fixture evidence is present and deterministic.",
      missingDataAdjusted: true,
    },
    evidence: [evidence],
    reasonCodes: ["canonical_operational_event_fixture"],
  };
}

function compareOperationalEvents(a: CanonicalOperationalEventEnvelope, b: CanonicalOperationalEventEnvelope): number {
  const occurred = a.ordering.occurredAt.localeCompare(b.ordering.occurredAt);
  if (occurred !== 0) return occurred;
  const recorded = a.ordering.recordedAt.localeCompare(b.ordering.recordedAt);
  if (recorded !== 0) return recorded;
  const family = a.ordering.familyRank - b.ordering.familyRank;
  if (family !== 0) return family;
  const kind = a.ordering.kindRank - b.ordering.kindRank;
  if (kind !== 0) return kind;
  return a.ordering.eventIdTieBreaker.localeCompare(b.ordering.eventIdTieBreaker);
}
