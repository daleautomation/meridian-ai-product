import {
  LIFECYCLE_STATE,
  READ_ONLY_FILE_ADAPTER_CAPABILITIES,
  asIsoDateString,
  asOperatorId,
  buildQueueCandidateSkeleton,
  buildShadowHealthScoreTrace,
  createEmptyReadOnlyTimelineSourceAdapter,
  normalizeTimelineSources,
  projectRelationshipSummary,
  validateLifecycleTransition,
} from "@/lib/relationship-engine";
import assert from "node:assert/strict";

const now = "2026-05-13T14:37:00.000Z";
const fixtureRelationshipId = "relationship:workspace:test:alpha";

async function main() {
const normalized = normalizeTimelineSources({
  context: { now, workspaceId: "workspace:test" },
  crmActivities: [
    {
      id: "crm-1",
      relationshipId: fixtureRelationshipId,
      companyKey: "company:alpha",
      companyName: "Alpha Roofing",
      performedAt: "2026-05-13T12:00:00.000Z",
      activityType: "call",
      performedBy: "operator-1",
      outcome: "connected",
      note: "Talked with owner.",
    },
  ],
  followUpTasks: [
    {
      id: "fu-1",
      relationshipId: fixtureRelationshipId,
      companyKey: "company:alpha",
      companyName: "Alpha Roofing",
      taskType: "follow_up_call",
      title: "Call back with pricing",
      dueAt: "2026-05-14T16:00:00.000Z",
      status: "open",
      assignedUserId: "operator-1",
      createdBy: "operator-1",
      createdAt: "2026-05-13T13:00:00.000Z",
    },
  ],
  usageEvents: [
    {
      eventId: "evt-1",
      eventType: "closed_won",
      userId: "operator-1",
      operatorId: "operator-1",
      workspace: "workspace:test",
      leadId: "lead-1",
      taskId: "task-1",
      relationshipId: fixtureRelationshipId,
      companyKey: "company:alpha",
      crmKey: "crm:alpha",
      companyName: "Alpha Roofing",
      previousStatus: "QUALIFIED",
      nextStatus: "CLOSED_WON",
      outcomeStatus: "Closed Won",
      estimatedValue: 5000,
      occurredAt: "2026-05-13T14:00:00.000Z",
      recordedAt: "2026-05-13T14:01:00.000Z",
      timestamp: "2026-05-13T14:01:00.000Z",
      metadata: {},
    },
  ],
  executionOutcomes: [
    {
      eventId: "outcome-1",
      workspace: "workspace:test",
      relationshipId: fixtureRelationshipId,
      companyKey: "company:alpha",
      crmKey: "crm:alpha",
      leadId: "lead-1",
      taskId: "task-1",
      operatorId: "operator-1",
      sourceSurface: "operator",
      outcomeStatus: "Follow Up",
      previousStatus: "Called",
      nextStatus: "Follow Up",
      occurredAt: "2026-05-13T14:10:00.000Z",
      recordedAt: "2026-05-13T14:11:00.000Z",
      nextAction: "Send recap",
      nextActionDate: "2026-05-15T15:00:00.000Z",
      estimatedValue: null,
      meridianInfluenced: true,
      influenceReason: "Recorded by operator",
      idempotencyKey: "idem-1",
      metadata: {},
    },
  ],
});

if (normalized.events.length !== 4) {
  throw new Error(`Expected 4 normalized events, received ${normalized.events.length}`);
}
if (normalized.warnings.length !== 0) {
  throw new Error(`Expected no normalization warnings, received ${normalized.warnings.length}`);
}

const invalidTransition = validateLifecycleTransition({
  from: LIFECYCLE_STATE.CLOSED_LOST,
  to: LIFECYCLE_STATE.ACTIVE,
  reason: "Should not reopen in foundation pass",
});
if (invalidTransition.ok || invalidTransition.code !== "invalid_transition") {
  throw new Error("Expected CLOSED_LOST -> ACTIVE to be rejected");
}

const relationshipId = normalized.events[0].relationshipId;
const trace = buildShadowHealthScoreTrace({
  relationshipId,
  computedAt: asIsoDateString(now),
  timelineEvents: normalized.events,
});
if (trace.modelVersion !== "shadow-foundation-v0" || trace.confidence !== "unknown") {
  throw new Error("Shadow health trace did not remain in placeholder mode");
}

const relationship = {
  id: relationshipId,
  workspaceId: "workspace:test" as never,
  identity: {
    displayName: "Alpha Roofing" as never,
    normalizedName: "alpha roofing",
    kind: "company" as const,
    externalRefs: [],
  },
  lifecycle: LIFECYCLE_STATE.NURTURING,
  warmth: {
    band: "unknown" as const,
    score: 0,
    lastMeaningfulTouchpointAt: asIsoDateString("2026-05-13T12:00:00.000Z"),
    evidence: normalized.events[0].evidence,
    confidence: "unknown" as const,
  },
  assignments: [
    {
      ownerId: asOperatorId("operator-1"),
      assignedAt: asIsoDateString("2026-05-13T13:00:00.000Z"),
      assignedBy: "system" as const,
      reason: "Foundation fixture assignment",
      visibility: "primary_owner" as const,
    },
  ],
  audit: {
    createdAt: asIsoDateString("2026-05-13T12:00:00.000Z"),
    updatedAt: asIsoDateString("2026-05-13T14:10:00.000Z"),
    createdBy: "system" as const,
    updatedBy: "system" as const,
  },
};
const promiseEvidence = normalized.events[1].evidence;
const promises = [
  {
    id: "promise:foundation:pricing" as never,
    relationshipId,
    title: "Send pricing recap",
    status: "open" as const,
    promisedBy: asOperatorId("operator-1"),
    ownerId: asOperatorId("operator-1"),
    createdAt: asIsoDateString("2026-05-13T13:00:00.000Z"),
    dueAt: asIsoDateString("2026-05-14T16:00:00.000Z"),
    evidence: promiseEvidence,
    confidence: "medium" as const,
  },
];
const followUpInstructions = [
  {
    relationshipId,
    ownerId: asOperatorId("operator-1"),
    dueAt: asIsoDateString("2026-05-12T16:00:00.000Z"),
    reason: "Prior callback is overdue",
    source: "operator" as const,
    confidence: "medium" as const,
    evidence: promiseEvidence,
  },
  {
    relationshipId,
    ownerId: asOperatorId("operator-1"),
    dueAt: asIsoDateString("2026-05-14T16:00:00.000Z"),
    reason: "Call back with pricing",
    source: "promise" as const,
    confidence: "medium" as const,
    evidence: promiseEvidence,
  },
];
const projectionInput = {
  context: { now: asIsoDateString(now), workspaceId: "workspace:test" as never },
  relationship,
  timelineEvents: normalized.events,
  promises,
  followUpInstructions,
  healthTrace: trace,
};
const projection = projectRelationshipSummary(projectionInput);
const projectionReplay = projectRelationshipSummary({
  ...projectionInput,
  timelineEvents: [...normalized.events].reverse(),
  promises: [...promises].reverse(),
  followUpInstructions: [...followUpInstructions].reverse(),
});
assert.deepEqual(projectionReplay, projection, "Relationship summary projection must be deterministic under input reordering");
assert.equal(projection.validation.ok, true, "Foundation projection should pass integrity validation");
assert.equal(projection.summary.relationshipId, relationshipId);
assert.equal(projection.summary.displayName, "Alpha Roofing");
assert.equal(projection.summary.ownerId, asOperatorId("operator-1"));
assert.equal(projection.summary.openPromiseCount, 1);
assert.equal(projection.summary.overduePromiseCount, 0);
assert.equal(projection.overdueFollowUps.length, 1);
assert.equal(projection.summary.nextFollowUpAt, asIsoDateString("2026-05-14T16:00:00.000Z"));
assert.equal(projection.latestTouchpoint?.occurredAt, asIsoDateString("2026-05-13T12:00:00.000Z"));
assert.equal(projection.latestOutcome?.label, "Closed Won");
assert.ok(projection.explanation.timelineReferences.length > 0, "Projection should expose timeline references");

const candidate = buildQueueCandidateSkeleton({
  summary: projection,
  generatedAt: asIsoDateString(now),
  whyNow: "Follow-up evidence exists in the shadow timeline.",
  nextBestAction: {
    kind: "review_manually",
    label: "Review relationship",
    reason: "Foundation pass does not automate outreach.",
  },
  evidence: normalized.events[0].evidence,
  visibleTo: [asOperatorId("operator-1")],
  healthTrace: trace,
});
if (candidate.rankScore !== 0 || candidate.visibleTo.length !== 1) {
  throw new Error("Queue candidate skeleton violated foundation defaults");
}
if (candidate.summary.openPromiseCount !== 1 || candidate.summary.nextFollowUpAt !== asIsoDateString("2026-05-14T16:00:00.000Z")) {
  throw new Error("Queue candidate did not consume the canonical relationship summary projection");
}

  const adapter = createEmptyReadOnlyTimelineSourceAdapter(READ_ONLY_FILE_ADAPTER_CAPABILITIES);
  const adapterRows = await adapter.listCrmActivities("workspace:test" as never);
  if (adapterRows.length !== 0 || adapter.capabilities.canAppendTimelineEvents) {
    throw new Error("Read-only placeholder adapter must stay empty and non-mutating");
  }

  console.log("relationship-engine foundation check passed", {
    events: normalized.events.map((event) => `${event.category}:${event.type}`),
    warnings: normalized.warnings.length,
    scoreModelVersion: trace.modelVersion,
    projectionIssues: projection.validation.issues.length,
    candidateId: candidate.id,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
