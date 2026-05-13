import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  projectRelationshipWorkflowIntegration,
  type EvidenceRef,
  type FollowUpInstruction,
  type RelationshipEntity,
  type TimelineEvent,
} from "@/lib/relationship-engine";

const now = asIsoDateString("2026-05-13T18:45:00.000Z");
const workspaceId = "workspace:workflow-fixture" as never;
const operatorA = asOperatorId("operator:workflow:a");
const operatorB = asOperatorId("operator:workflow:b");

const active = relationship("relationship:workflow:active", "Active Follow Up", LIFECYCLE_STATE.ACTIVE, "warm", operatorA);
const retention = relationship("relationship:workflow:retention", "Retention Risk", LIFECYCLE_STATE.RETENTION_RISK, "cool", operatorA);
const opportunity = relationship("relationship:workflow:opportunity", "Warm Opportunity", LIFECYCLE_STATE.OPPORTUNITY, "hot", operatorB);
const dormant = relationship("relationship:workflow:dormant", "Dormant Account", LIFECYCLE_STATE.DORMANT, "cold", undefined);

const timelineEvents = [
  touchpointEvent(active.id, "timeline:workflow:active:touchpoint", "2026-05-11T09:00:00.000Z", "Active call", operatorA),
  outcomeEvent(retention.id, "timeline:workflow:retention:outcome", "2026-05-10T10:00:00.000Z", "deal_lost", "Renewal at risk", operatorA),
  outcomeEvent(opportunity.id, "timeline:workflow:opportunity:outcome", "2026-05-13T10:00:00.000Z", "meeting_booked", "Meeting booked", operatorB),
  touchpointEvent(dormant.id, "timeline:workflow:dormant:touchpoint", "2025-10-01T12:00:00.000Z", "Dormant note", operatorB),
];

const followUps: FollowUpInstruction[] = [{
  relationshipId: active.id,
  ownerId: operatorA,
  dueAt: asIsoDateString("2026-05-12T17:00:00.000Z"),
  reason: "Review overdue recap",
  source: "operator",
  confidence: "medium",
  evidence: [evidence("follow-up:active", "Overdue follow-up", "2026-05-12T17:00:00.000Z")],
}];

const summaries = [active, retention, opportunity, dormant].map((entity) => projectRelationshipSummary({
  context: { now, workspaceId },
  relationship: entity,
  timelineEvents,
  followUpInstructions: followUps,
  staleTimelineAfterDays: 90,
}));

const input = {
  context: { now, workspaceId },
  summaries,
  timelineEvents,
  followUpInstructions: followUps,
  staleTimelineAfterDays: 90,
  staleProjectionAfterHours: 24,
};

const queues = Object.values(projectAllRelationshipQueues(input));
const feeds = Object.values(projectAllRelationshipFeeds(input));
const workflow = projectRelationshipWorkflowIntegration({ generatedAt: now, queues, feeds });
const replay = projectRelationshipWorkflowIntegration({
  generatedAt: now,
  queues: [...queues].reverse().map((queue) => ({ ...queue, items: [...queue.items].reverse() })),
  feeds: [...feeds].reverse(),
});

assert.deepEqual(replay, workflow, "Workflow grouping must replay deterministically under input reordering.");
assert.equal(workflow.boundary.reviewOnly, true);
assert.equal(workflow.boundary.workflowExecutionAllowed, false);
assert.equal(workflow.boundary.automationAllowed, false);
assert.equal(workflow.boundary.remindersAllowed, false);
assert.equal(workflow.boundary.notificationsAllowed, false);
assert.equal(workflow.boundary.persistenceAllowed, false);
assert.equal(workflow.boundary.neonWritesAllowed, false);
assert.equal(workflow.boundary.productionScoringAllowed, false);
assert.deepEqual(workflow.ordering.groupOrder, [
  "needs_relationship_attention",
  "stale_relationship_review",
  "follow_up_review",
  "retention_review",
  "warm_opportunity_review",
  "reactivation_review",
]);
assert.equal(workflow.groups.length, 6);
assert.ok(group("follow_up_review").items.some((item) => item.relationshipId === active.id));
assert.ok(group("retention_review").items.some((item) => item.relationshipId === retention.id));
assert.ok(group("warm_opportunity_review").items.some((item) => item.relationshipId === opportunity.id));
assert.ok(group("reactivation_review").items.some((item) => item.relationshipId === dormant.id));
assert.ok(workflow.visibility.overdueRelationships.some((item) => item.relationshipId === active.id));
assert.ok(workflow.visibility.dormantRelationships.some((item) => item.relationshipId === dormant.id));
assert.ok(workflow.visibility.warmOpportunities.some((item) => item.relationshipId === opportunity.id));
assert.ok(workflow.relationshipSummaries.every((item) => item.whyNow.evidenceReferences.length > 0));
assert.ok(workflow.metadata.missingDataEffects.some((effect) => effect.reason === "no_health_trace"));
assert.equal(workflow.workflowContexts.relationshipMaintenance.reviewOnly, true);
assert.equal(workflow.workflowContexts.followUpReview.groupKinds[0], "follow_up_review");
assert.equal(workflow.workflowContexts.dormantReactivationReview.groupKinds[0], "reactivation_review");

const source = readFileSync("lib/relationship-engine/workflowIntegration.ts", "utf8");
assert.equal(/relationship-engine\/repositories|from "\.\/repositories|from "\.\.\/repositories/.test(source), false);
assert.equal(/executeQueue|sendNotification|createReminder|writeOperatorSnapshot|neonWrite\s*\(|method:\s*["']POST["']/i.test(source), false);

console.log("relationship workflow integration check passed", {
  groupCounts: workflow.metadata.groupCounts,
  overdueVisible: workflow.visibility.overdueRelationships.length,
  dormantVisible: workflow.visibility.dormantRelationships.length,
  warmVisible: workflow.visibility.warmOpportunities.length,
  boundary: workflow.boundary,
});

function group(kind: (typeof workflow.groups)[number]["groupKind"]) {
  const found = workflow.groups.find((candidate) => candidate.groupKind === kind);
  assert.ok(found, `Missing workflow group ${kind}`);
  return found;
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
      reason: "Workflow fixture owner",
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
    dedupeKey: `workflow-fixture:${id}`,
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
    dedupeKey: `workflow-fixture:${id}`,
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

function evidence(id: string, label: string, observedAt: string): EvidenceRef {
  return {
    id: `evidence:${id}`,
    source: "engine",
    label,
    observedAt: asIsoDateString(observedAt),
    confidence: "medium",
  };
}
