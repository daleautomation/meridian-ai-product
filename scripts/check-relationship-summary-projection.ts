import assert from "node:assert/strict";
import {
  LIFECYCLE_STATE,
  asIsoDateString,
  asOperatorId,
  asRelationshipId,
  asTimelineEventId,
  asTouchpointId,
  projectRelationshipSummary,
} from "@/lib/relationship-engine";
import type {
  EvidenceRef,
  RelationshipEntity,
  TimelineEvent,
} from "@/lib/relationship-engine";

const now = asIsoDateString("2026-05-13T15:20:00.000Z");
const relationshipId = asRelationshipId("relationship:test:summary");
const ownerId = asOperatorId("operator-1");

const baseRelationship: RelationshipEntity = {
  id: relationshipId,
  workspaceId: "workspace:test" as never,
  identity: {
    displayName: "Summary Fixture" as never,
    normalizedName: "summary fixture",
    kind: "company",
    externalRefs: [],
  },
  lifecycle: LIFECYCLE_STATE.ACTIVE,
  warmth: {
    band: "warm",
    score: 0,
    evidence: [evidence("relationship-warmth", "Warmth band fixture", "2026-05-13T10:00:00.000Z")],
    confidence: "medium",
  },
  assignments: [
    {
      ownerId,
      assignedAt: asIsoDateString("2026-05-13T09:00:00.000Z"),
      visibility: "primary_owner",
      reason: "Fixture owner",
    },
  ],
  audit: {
    createdAt: asIsoDateString("2026-05-13T09:00:00.000Z"),
    updatedAt: asIsoDateString("2026-05-13T10:00:00.000Z"),
  },
};

const earlierTouchpoint = touchpointEvent("timeline:summary:a", "2026-05-13T11:00:00.000Z", "Earlier call");
const laterTouchpoint = touchpointEvent("timeline:summary:b", "2026-05-13T11:00:00.000Z", "Later call by id");
const projection = projectRelationshipSummary({
  context: { now, workspaceId: "workspace:test" as never },
  relationship: baseRelationship,
  timelineEvents: [laterTouchpoint, earlierTouchpoint],
  promises: [
    {
      id: "promise:summary:1" as never,
      relationshipId,
      title: "Send scope",
      status: "open",
      promisedBy: ownerId,
      ownerId,
      createdAt: asIsoDateString("2026-05-13T10:00:00.000Z"),
      dueAt: asIsoDateString("2026-05-12T10:00:00.000Z"),
      evidence: [evidence("promise", "Promise fixture", "2026-05-13T10:00:00.000Z")],
      confidence: "medium",
    },
  ],
  followUpInstructions: [
    {
      relationshipId,
      ownerId,
      dueAt: asIsoDateString("2026-05-14T10:00:00.000Z"),
      reason: "Review scope",
      source: "promise",
      confidence: "medium",
      evidence: [evidence("follow-up", "Follow-up fixture", "2026-05-13T10:00:00.000Z")],
    },
  ],
});

assert.equal(projection.validation.ok, true);
assert.equal(projection.latestTouchpoint?.timelineEventId, asTimelineEventId("timeline:summary:b"));
assert.equal(projection.summary.openPromiseCount, 1);
assert.equal(projection.summary.overduePromiseCount, 1);
assert.equal(projection.summary.nextFollowUpAt, asIsoDateString("2026-05-14T10:00:00.000Z"));

const replay = projectRelationshipSummary({
  context: { now, workspaceId: "workspace:test" as never },
  relationship: baseRelationship,
  timelineEvents: [earlierTouchpoint, laterTouchpoint],
  promises: [],
  followUpInstructions: [],
});
assert.equal(replay.latestTouchpoint?.timelineEventId, asTimelineEventId("timeline:summary:b"));

const missingDataProjection = projectRelationshipSummary({
  context: { now, workspaceId: "workspace:test" as never },
  relationship: { ...baseRelationship, assignments: [] },
});
assert.equal(missingDataProjection.validation.ok, true);
assert.ok(missingDataProjection.validation.issues.some((issue) => issue.code === "missing_owner_visibility"));
assert.ok(missingDataProjection.validation.issues.some((issue) => issue.code === "missing_timeline_references"));
assert.ok(missingDataProjection.momentumHints.some((hint) => hint.kind === "insufficient_timeline"));

const staleProjection = projectRelationshipSummary({
  context: { now, workspaceId: "workspace:test" as never },
  relationship: baseRelationship,
  timelineEvents: [touchpointEvent("timeline:summary:stale", "2025-01-01T12:00:00.000Z", "Stale call")],
});
assert.ok(staleProjection.validation.issues.some((issue) => issue.code === "stale_timeline_activity"));
assert.ok(staleProjection.momentumHints.some((hint) => hint.kind === "stale_activity"));

const invalidLifecycleProjection = projectRelationshipSummary({
  context: { now, workspaceId: "workspace:test" as never },
  relationship: baseRelationship,
  timelineEvents: [
    {
      id: asTimelineEventId("timeline:summary:bad-lifecycle"),
      relationshipId,
      category: "lifecycle",
      type: "lifecycle_transitioned",
      occurredAt: asIsoDateString("2026-05-13T12:00:00.000Z"),
      recordedAt: asIsoDateString("2026-05-13T12:01:00.000Z"),
      source: "engine",
      evidence: [evidence("lifecycle", "Invalid lifecycle fixture", "2026-05-13T12:00:00.000Z")],
      confidence: "medium",
      dedupeKey: "fixture:bad-lifecycle",
      from: LIFECYCLE_STATE.CLOSED_LOST,
      to: LIFECYCLE_STATE.ACTIVE,
      reason: "Invalid fixture transition",
    },
  ],
});
assert.equal(invalidLifecycleProjection.validation.ok, false);
assert.ok(invalidLifecycleProjection.validation.issues.some((issue) => issue.code === "invalid_lifecycle_event"));

console.log("relationship summary projection check passed", {
  latestTouchpoint: projection.latestTouchpoint?.timelineEventId,
  replayLatestTouchpoint: replay.latestTouchpoint?.timelineEventId,
  missingDataIssues: missingDataProjection.validation.issues.map((issue) => issue.code),
  staleIssues: staleProjection.validation.issues.map((issue) => issue.code),
  invalidLifecycleOk: invalidLifecycleProjection.validation.ok,
});

function touchpointEvent(id: string, occurredAt: string, subject: string): TimelineEvent {
  const timestamp = asIsoDateString(occurredAt);
  return {
    id: asTimelineEventId(id),
    relationshipId,
    category: "touchpoint",
    type: "call_completed",
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: "operator",
    actorId: ownerId,
    evidence: [evidence(id, subject, occurredAt)],
    confidence: "medium",
    dedupeKey: `fixture:${id}`,
    touchpoint: {
      id: asTouchpointId(`${id}:touchpoint`),
      relationshipId,
      channel: "call",
      direction: "outbound",
      occurredAt: timestamp,
      subject,
      operatorId: ownerId,
      evidence: [evidence(`${id}:touchpoint`, subject, occurredAt)],
    },
  };
}

function evidence(id: string, label: string, observedAt: string): EvidenceRef {
  return {
    id: `evidence:${id}`,
    source: "engine",
    label,
    observedAt: asIsoDateString(observedAt),
    confidence: "medium",
  };
}
