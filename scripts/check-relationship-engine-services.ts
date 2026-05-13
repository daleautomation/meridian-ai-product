import assert from "node:assert/strict";
import {
  LIFECYCLE_STATE,
  asIsoDateString,
  asOperatorId,
  asOutcomeId,
  asRelationshipId,
  asTimelineEventId,
  asTouchpointId,
  createRelationshipEngineReadService,
} from "@/lib/relationship-engine";
import type {
  EvidenceRef,
  FollowUpInstruction,
  HealthScoreTrace,
  PromiseRecord,
  RelationshipEngineReadRepositories,
  RelationshipEntity,
  TimelineEvent,
} from "@/lib/relationship-engine";

const now = asIsoDateString("2026-05-13T17:30:00.000Z");
const workspaceId = "workspace:services" as never;
const operatorA = asOperatorId("operator:services:a");
const operatorB = asOperatorId("operator:services:b");

const active = relationship("relationship:services:active", "Active Service Fixture", LIFECYCLE_STATE.ACTIVE, "warm", operatorA);
const dormant = relationship("relationship:services:dormant", "Dormant Service Fixture", LIFECYCLE_STATE.DORMANT, "cold", undefined);
const retention = relationship("relationship:services:retention", "Retention Service Fixture", LIFECYCLE_STATE.RETENTION_RISK, "cool", operatorA);

const events: TimelineEvent[] = [
  ownerEvent(active.id, "timeline:services:active:owner", "2026-05-13T09:00:00.000Z", operatorA),
  touchpointEvent(active.id, "timeline:services:active:call", "2026-05-13T10:00:00.000Z", "Service call", operatorA),
  outcomeEvent(retention.id, "timeline:services:retention:outcome", "2026-05-12T10:00:00.000Z", "deal_lost", "Renewal at risk", operatorA),
  touchpointEvent(dormant.id, "timeline:services:dormant:old", "2025-10-01T10:00:00.000Z", "Old service note", operatorB),
];
const promises: PromiseRecord[] = [
  promise(active.id, "promise:services:active", "Send recap", "2026-05-12T12:00:00.000Z", operatorA),
];
const followUps: FollowUpInstruction[] = [
  followUp(active.id, "2026-05-12T13:00:00.000Z", "Call back", operatorA),
  followUp(active.id, "2026-05-14T13:00:00.000Z", "Confirm next step", operatorA),
];
const healthTraces: HealthScoreTrace[] = [riskTrace(retention.id, events[2])];

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const service = createRelationshipEngineReadService(repositories());
  const replayService = createRelationshipEngineReadService(repositories(true));

  const summary = await service.getRelationshipSummary({ context: { now, workspaceId }, relationshipId: active.id });
  assert.equal(summary.validation.ok, true);
  assert.equal(summary.data.summary.openPromiseCount, 1);
  assert.equal(summary.data.summary.overduePromiseCount, 1);
  assert.equal(summary.data.summary.nextFollowUpAt, asIsoDateString("2026-05-14T13:00:00.000Z"));
  assert.ok(summary.missingDataEffects.some((effect) => effect.reason === "no_health_trace"));

  const timeline = await service.getRelationshipTimeline({ context: { now, workspaceId }, relationshipId: active.id });
  assert.equal(timeline.validation.ok, true);
  assert.ok(timeline.data.groups.some((group) => group.groupKind === "grouped_activity" && group.items.length === 1));
  assert.ok(timeline.data.groups.some((group) => group.groupKind === "promises" && group.items.length === 1));

  const feeds = await service.getRelationshipFeeds({ context: { now, workspaceId }, query: { ownerId: operatorA } });
  assert.equal(feeds.data.relationship_activity.validation.ok, true);
  assert.ok(feeds.data.operator_relationship.items.every((item) => item.ownerVisibility.visibleTo.includes(operatorA)));
  assert.ok(feeds.data.overdue_relationship.items.some((item) => item.relationshipId === active.id));

  const queues = await service.getRelationshipQueues({ context: { now, workspaceId }, options: { staleTimelineAfterDays: 90 } });
  assert.equal(queues.data.overdue_follow_ups.validation.ok, true);
  assert.equal(queues.data.overdue_follow_ups.items[0]?.relationshipId, active.id);
  assert.ok(queues.data.cooling_relationships.items.some((item) => item.relationshipId === dormant.id));
  assert.ok(queues.data.retention_risk.items.some((item) => item.relationshipId === retention.id));
  assert.ok(queues.warnings.some((issue) => issue.code === "queue_item_missing_owner_visibility"));

  const bundle = await service.getRelationshipProjection({ context: { now, workspaceId }, relationshipId: active.id });
  const replayBundle = await replayService.getRelationshipProjection({ context: { now, workspaceId }, relationshipId: active.id });
  assert.deepEqual(replayBundle, bundle, "Facade bundle must replay deterministically under repository ordering changes.");
  assert.equal(bundle.data.summary.relationshipId, active.id);
  assert.equal(bundle.data.timeline.relationshipId, active.id);

  assert.throws(() => createRelationshipEngineReadService({
    ...repositories(),
    timelineSources: {
      capabilities: {
        storage: "memory",
        mode: "write_prepared",
        canReadTimelineSources: true,
        canWriteRelationships: true,
        canAppendTimelineEvents: false,
        canWriteScores: false,
        canWriteQueueCandidates: false,
      },
      async listCrmActivities() {
        return [];
      },
      async listFollowUpTasks() {
        return [];
      },
      async listUsageEvents() {
        return [];
      },
      async listExecutionOutcomes() {
        return [];
      },
    },
  }), /read-only/);

  console.log("relationship engine service check passed", {
    summaryConfidence: summary.confidence,
    activeTimelineGroups: timeline.data.groups.map((group) => `${group.groupKind}:${group.items.length}`),
    feedCounts: Object.fromEntries(Object.entries(feeds.data).map(([kind, feed]) => [kind, feed.items.length])),
    queueCounts: Object.fromEntries(Object.entries(queues.data).map(([kind, queue]) => [kind, queue.items.length])),
    warningCodes: queues.warnings.map((issue) => issue.code),
  });
}

function repositories(reverse = false): RelationshipEngineReadRepositories {
  const relationships = ordered([active, dormant, retention], reverse);
  const timelineEvents = ordered(events, reverse);
  const promiseRows = ordered(promises, reverse);
  const followUpRows = ordered(followUps, reverse);
  const traceRows = ordered(healthTraces, reverse);
  return {
    relationships: {
      async getById(id) {
        return relationships.find((item) => item.id === id) ?? null;
      },
      async find(query) {
        const filtered = relationships.filter((item) => (
          item.workspaceId === query.workspaceId
          && (!query.ownerId || item.assignments.some((assignment) => assignment.ownerId === query.ownerId))
          && (!query.lifecycle || query.lifecycle.includes(item.lifecycle))
          && (!query.updatedAfter || item.audit.updatedAt > query.updatedAfter)
        ));
        return page(filtered, query.page);
      },
      async summarize() {
        return null;
      },
    },
    timeline: {
      async list(query) {
        return page(timelineEvents.filter((event) => (
          event.relationshipId === query.relationshipId
          && (!query.occurredAfter || event.occurredAt > query.occurredAfter)
          && (!query.occurredBefore || event.occurredAt < query.occurredBefore)
          && (!query.categories || query.categories.includes(event.category))
        )), query.page);
      },
    },
    followUps: {
      async listOpenPromises(relationshipId) {
        return promiseRows.filter((item) => item.relationshipId === relationshipId && item.status === "open");
      },
      async listDueInstructions(args) {
        return followUpRows.filter((item) => (
          item.dueAt <= args.dueBefore
          && (!args.ownerId || item.ownerId === args.ownerId)
        ));
      },
    },
    scoring: {
      async getLatestHealthTrace(relationshipId) {
        return traceRows.find((trace) => trace.relationshipId === relationshipId) ?? null;
      },
      async listHealthTraces(relationshipId, pageRequest) {
        return page(traceRows.filter((trace) => trace.relationshipId === relationshipId), pageRequest);
      },
    },
  };
}

function page<T>(items: T[], pageRequest?: { limit: number; cursor?: string }) {
  if (!pageRequest) return { items };
  const start = pageRequest.cursor ? Number(pageRequest.cursor) : 0;
  const end = start + pageRequest.limit;
  return {
    items: items.slice(start, end),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  };
}

function ordered<T>(items: T[], reverse: boolean): T[] {
  return reverse ? [...items].reverse() : items;
}

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
      createdAt: asIsoDateString("2026-05-13T08:00:00.000Z"),
      updatedAt: asIsoDateString("2026-05-13T09:00:00.000Z"),
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
    id: "score-trace:services:retention" as never,
    relationshipId,
    modelName: "relationship_health",
    modelVersion: "service-fixture-v0",
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
