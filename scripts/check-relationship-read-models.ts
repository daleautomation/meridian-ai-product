import assert from "node:assert/strict";
import {
  LIFECYCLE_STATE,
  asIsoDateString,
  asOperatorId,
  asOutcomeId,
  asRelationshipId,
  asTimelineEventId,
  asTouchpointId,
  projectAllRelationshipFeeds,
  projectAllRelationshipQueues,
  projectRelationshipSummary,
  projectRelationshipTimeline,
  relationshipFeedProjectionToMcpDtos,
  relationshipQueueProjectionToMcpDtos,
  relationshipTimelineProjectionToMcpDto,
} from "@/lib/relationship-engine";
import type {
  EvidenceRef,
  FollowUpInstruction,
  HealthScoreTrace,
  PromiseRecord,
  RelationshipEntity,
  TimelineEvent,
} from "@/lib/relationship-engine";

const now = asIsoDateString("2026-05-13T15:44:00.000Z");
const oldNow = asIsoDateString("2026-05-12T09:00:00.000Z");
const workspaceId = "workspace:test" as never;
const operatorA = asOperatorId("operator-a");
const operatorB = asOperatorId("operator-b");

const active = relationship("relationship:read-model:active", "Active Fixture", LIFECYCLE_STATE.ACTIVE, "warm", operatorA);
const retention = relationship("relationship:read-model:retention", "Retention Fixture", LIFECYCLE_STATE.RETENTION_RISK, "cool", operatorA);
const opportunity = relationship("relationship:read-model:opportunity", "Opportunity Fixture", LIFECYCLE_STATE.OPPORTUNITY, "hot", operatorB);
const dormant = relationship("relationship:read-model:dormant", "Dormant Fixture", LIFECYCLE_STATE.DORMANT, "cold", undefined);
const closed = relationship("relationship:read-model:closed", "Closed Fixture", LIFECYCLE_STATE.CLOSED_LOST, "cold", operatorA);

const activeEvents = [
  ownerEvent(active.id, "timeline:active:owner", "2026-05-13T09:00:00.000Z", operatorA),
  touchpointEvent(active.id, "timeline:active:touchpoint-a", "2026-05-13T10:00:00.000Z", "Initial call", operatorA),
  touchpointEvent(active.id, "timeline:active:touchpoint-b", "2026-05-13T11:00:00.000Z", "Follow-up call", operatorA),
  lifecycleEvent(active.id, "timeline:active:lifecycle", "2026-05-13T11:30:00.000Z", LIFECYCLE_STATE.QUALIFIED, LIFECYCLE_STATE.ACTIVE),
];
const retentionEvents = [
  ownerEvent(retention.id, "timeline:retention:owner", "2026-05-12T09:00:00.000Z", operatorA),
  outcomeEvent(retention.id, "timeline:retention:outcome", "2026-05-12T10:00:00.000Z", "deal_lost", "Renewal at risk", operatorA),
];
const opportunityEvents = [
  ownerEvent(opportunity.id, "timeline:opportunity:owner", "2026-05-13T08:00:00.000Z", operatorB),
  outcomeEvent(opportunity.id, "timeline:opportunity:outcome", "2026-05-13T13:00:00.000Z", "meeting_booked", "Meeting booked", operatorB),
];
const dormantEvents = [
  touchpointEvent(dormant.id, "timeline:dormant:touchpoint", "2025-10-01T12:00:00.000Z", "Old note", operatorB),
];
const closedEvents = [
  touchpointEvent(closed.id, "timeline:closed:touchpoint", "2026-05-13T12:30:00.000Z", "Closed note", operatorA),
];
const duplicateActiveEvent = activeEvents[2];
const timelineEvents = [
  ...activeEvents,
  duplicateActiveEvent,
  ...retentionEvents,
  ...opportunityEvents,
  ...dormantEvents,
  ...closedEvents,
];

const promises: PromiseRecord[] = [
  promise(active.id, "promise:active:send-recap", "Send recap", "2026-05-12T16:00:00.000Z", operatorA),
  promise(opportunity.id, "promise:opportunity:proposal", "Send proposal", "2026-05-14T16:00:00.000Z", operatorB),
];
const followUps: FollowUpInstruction[] = [
  followUp(active.id, "2026-05-12T17:00:00.000Z", "Call back with recap", operatorA),
  followUp(opportunity.id, "2026-05-14T17:00:00.000Z", "Confirm meeting agenda", operatorB),
];
const healthTraces = [riskTrace(retention.id, retentionEvents[1])];

const summaries = [
  projectRelationshipSummary({
    context: { now, workspaceId },
    relationship: active,
    timelineEvents,
    promises,
    followUpInstructions: followUps,
  }),
  projectRelationshipSummary({
    context: { now, workspaceId },
    relationship: retention,
    timelineEvents,
    healthTrace: healthTraces[0],
  }),
  projectRelationshipSummary({
    context: { now, workspaceId },
    relationship: opportunity,
    timelineEvents,
    promises,
    followUpInstructions: followUps,
  }),
  projectRelationshipSummary({
    context: { now: oldNow, workspaceId },
    relationship: dormant,
    timelineEvents,
  }),
  projectRelationshipSummary({
    context: { now, workspaceId },
    relationship: closed,
    timelineEvents,
  }),
];

const input = {
  context: { now, workspaceId },
  summaries,
  timelineEvents,
  promises,
  followUpInstructions: followUps,
  healthTraces,
  staleTimelineAfterDays: 90,
  staleProjectionAfterHours: 24,
};

const feeds = projectAllRelationshipFeeds(input, { operatorId: operatorA });
const replayFeeds = projectAllRelationshipFeeds({
  ...input,
  summaries: [...summaries].reverse(),
  timelineEvents: [...timelineEvents].reverse(),
  promises: [...promises].reverse(),
  followUpInstructions: [...followUps].reverse(),
  healthTraces: [...healthTraces].reverse(),
}, { operatorId: operatorA });
assert.deepEqual(replayFeeds, feeds, "Feed projections must replay deterministically under input reordering.");
assert.equal(feeds.relationship_activity.validation.ok, true);
assert.equal(
  feeds.relationship_activity.items.filter((item) => item.timelineReferences.includes(asTimelineEventId("timeline:active:touchpoint-b"))).length,
  1,
  "Duplicate timeline events should produce one activity feed item.",
);
assert.ok(feeds.operator_relationship.items.every((item) => item.ownerVisibility.visibleTo.includes(operatorA)));
assert.ok(feeds.relationship_momentum.items.some((item) => item.relationshipId === active.id && item.title === "Open promise"));
assert.ok(feeds.overdue_relationship.items.some((item) => item.relationshipId === active.id && item.title === "Overdue follow-up"));
assert.ok(feeds.relationship_change.items.some((item) => item.relationshipId === active.id && item.title === "Lifecycle changed"));
assert.ok(relationshipFeedProjectionToMcpDtos(feeds.relationship_activity).every((item) => item.relationshipId.length > 0));

const queues = projectAllRelationshipQueues(input);
const replayQueues = projectAllRelationshipQueues({
  ...input,
  summaries: [...summaries].reverse(),
  timelineEvents: [...timelineEvents].reverse(),
  promises: [...promises].reverse(),
  followUpInstructions: [...followUps].reverse(),
  healthTraces: [...healthTraces].reverse(),
});
assert.deepEqual(replayQueues, queues, "Queue projections must replay deterministically under input reordering.");
assert.equal(queues.overdue_follow_ups.validation.ok, true);
assert.equal(queues.overdue_follow_ups.items[0]?.relationshipId, active.id);
assert.equal(queues.overdue_follow_ups.items[0]?.rank, 1);
assert.ok(queues.needs_attention.items.some((item) => item.relationshipId === retention.id));
assert.ok(queues.cooling_relationships.items.some((item) => item.relationshipId === dormant.id));
assert.ok(queues.retention_risk.items.some((item) => item.relationshipId === retention.id));
assert.ok(queues.warm_opportunities.items.some((item) => item.relationshipId === opportunity.id));
assert.ok(queues.reactivation_candidates.items.some((item) => item.relationshipId === dormant.id));
assert.ok(queues.needs_attention.items.every((item) => item.relationshipId !== closed.id), "Closed relationships must not be active queue items.");
assert.ok(
  queues.cooling_relationships.validation.issues.some((issue) => issue.code === "stale_relationship_summary_projection"),
  "Stale summaries should be visible as queue integrity warnings.",
);
assert.ok(
  queues.needs_attention.validation.issues.some((issue) => issue.code === "queue_item_missing_owner_visibility"),
  "Missing owner visibility should be surfaced as a queue integrity warning.",
);
assert.ok(relationshipQueueProjectionToMcpDtos(queues.needs_attention).every((item) => item.reviewOnly));

const timeline = projectRelationshipTimeline({ ...input, relationshipId: active.id });
assert.equal(timeline.validation.ok, true);
assert.ok(timeline.groups.some((group) => group.groupKind === "grouped_activity" && group.items.length === 2));
assert.ok(timeline.groups.some((group) => group.groupKind === "promises" && group.items.some((item) => item.promiseId === "promise:active:send-recap")));
assert.ok(timeline.groups.some((group) => group.groupKind === "lifecycle_changes" && group.items.length === 1));
assert.ok(timeline.groups.some((group) => group.groupKind === "relationship_momentum" && group.items.length > 0));
assert.equal(relationshipTimelineProjectionToMcpDto(timeline).reviewOnly, true);

console.log("relationship read-model check passed", {
  feedCounts: Object.fromEntries(Object.entries(feeds).map(([kind, feed]) => [kind, feed.items.length])),
  queueCounts: Object.fromEntries(Object.entries(queues).map(([kind, queue]) => [kind, queue.items.length])),
  coolingWarnings: queues.cooling_relationships.validation.issues.map((issue) => issue.code),
  activeTimelineGroups: timeline.groups.map((group) => `${group.groupKind}:${group.items.length}`),
});

function relationship(
  id: string,
  displayName: string,
  lifecycle: RelationshipEntity["lifecycle"],
  warmth: RelationshipEntity["warmth"]["band"],
  ownerId: ReturnType<typeof asOperatorId> | undefined,
): RelationshipEntity {
  return {
    id: asRelationshipId(id),
    workspaceId,
    identity: {
      displayName: displayName as never,
      normalizedName: displayName.toLowerCase(),
      kind: "company",
      externalRefs: [],
    },
    lifecycle,
    warmth: {
      band: warmth,
      score: 0,
      evidence: [evidence(`${id}:warmth`, "Warmth fixture", "2026-05-13T09:00:00.000Z")],
      confidence: "medium",
    },
    assignments: ownerId ? [{
      ownerId,
      assignedAt: asIsoDateString("2026-05-13T09:00:00.000Z"),
      visibility: "primary_owner",
      reason: "Fixture owner",
    }] : [],
    audit: {
      createdAt: asIsoDateString("2026-05-13T09:00:00.000Z"),
      updatedAt: asIsoDateString("2026-05-13T10:00:00.000Z"),
    },
  };
}

function touchpointEvent(
  relationshipId: RelationshipEntity["id"],
  id: string,
  occurredAt: string,
  subject: string,
  operatorId: ReturnType<typeof asOperatorId>,
): TimelineEvent {
  const timestamp = asIsoDateString(occurredAt);
  return {
    id: asTimelineEventId(id),
    relationshipId,
    category: "touchpoint",
    type: "call_completed",
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: "operator",
    actorId: operatorId,
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
      operatorId,
      evidence: [evidence(`${id}:touchpoint`, subject, occurredAt)],
    },
  };
}

function ownerEvent(
  relationshipId: RelationshipEntity["id"],
  id: string,
  occurredAt: string,
  ownerId: ReturnType<typeof asOperatorId>,
): TimelineEvent {
  const timestamp = asIsoDateString(occurredAt);
  return {
    id: asTimelineEventId(id),
    relationshipId,
    category: "owner_assignment",
    type: "owner_assigned",
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: "engine",
    actorId: "system",
    evidence: [evidence(id, "Owner assigned", occurredAt)],
    confidence: "medium",
    dedupeKey: `fixture:${id}`,
    toOwnerId: ownerId,
    reason: "Fixture owner assignment",
  };
}

function lifecycleEvent(
  relationshipId: RelationshipEntity["id"],
  id: string,
  occurredAt: string,
  from: RelationshipEntity["lifecycle"],
  to: RelationshipEntity["lifecycle"],
): TimelineEvent {
  const timestamp = asIsoDateString(occurredAt);
  return {
    id: asTimelineEventId(id),
    relationshipId,
    category: "lifecycle",
    type: "lifecycle_transitioned",
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: "engine",
    evidence: [evidence(id, "Lifecycle changed", occurredAt)],
    confidence: "medium",
    dedupeKey: `fixture:${id}`,
    from,
    to,
    reason: "Fixture lifecycle transition",
  };
}

function outcomeEvent(
  relationshipId: RelationshipEntity["id"],
  id: string,
  occurredAt: string,
  kind: Extract<TimelineEvent, { category: "outcome" }>["outcome"]["kind"],
  label: string,
  operatorId: ReturnType<typeof asOperatorId>,
): TimelineEvent {
  const timestamp = asIsoDateString(occurredAt);
  return {
    id: asTimelineEventId(id),
    relationshipId,
    category: "outcome",
    type: "outcome_recorded",
    occurredAt: timestamp,
    recordedAt: timestamp,
    source: "operator",
    actorId: operatorId,
    evidence: [evidence(id, label, occurredAt)],
    confidence: "medium",
    dedupeKey: `fixture:${id}`,
    outcome: {
      id: asOutcomeId(`${id}:outcome`),
      relationshipId,
      kind,
      label,
      occurredAt: timestamp,
      evidence: [evidence(`${id}:outcome`, label, occurredAt)],
      confidence: "medium",
    },
  };
}

function promise(
  relationshipId: RelationshipEntity["id"],
  id: string,
  title: string,
  dueAt: string,
  ownerId: ReturnType<typeof asOperatorId>,
): PromiseRecord {
  return {
    id: id as never,
    relationshipId,
    title,
    status: "open",
    promisedBy: ownerId,
    ownerId,
    createdAt: asIsoDateString("2026-05-13T09:30:00.000Z"),
    dueAt: asIsoDateString(dueAt),
    evidence: [evidence(id, title, "2026-05-13T09:30:00.000Z")],
    confidence: "medium",
  };
}

function followUp(
  relationshipId: RelationshipEntity["id"],
  dueAt: string,
  reason: string,
  ownerId: ReturnType<typeof asOperatorId>,
): FollowUpInstruction {
  return {
    relationshipId,
    ownerId,
    dueAt: asIsoDateString(dueAt),
    reason,
    source: "operator",
    confidence: "medium",
    evidence: [evidence(`${relationshipId}:${dueAt}`, reason, dueAt)],
  };
}

function riskTrace(relationshipId: RelationshipEntity["id"], event: TimelineEvent): HealthScoreTrace {
  return {
    id: "score-trace:retention" as never,
    relationshipId,
    modelName: "relationship_health",
    modelVersion: "shadow-read-model-fixture-v0",
    computedAt: now,
    score: 0,
    confidence: "medium",
    components: [{
      key: "risk",
      label: "Risk",
      status: "observed",
      evidence: event.evidence,
      explanation: "Risk component observed from canonical outcome evidence.",
      confidence: "medium",
    }],
    missingEvidence: [],
    explanation: "Fixture health trace; no production weights.",
    inputTimelineEventIds: [event.id],
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
