import assert from "node:assert/strict";
import { TENANTS, toPublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import {
  handleRelationshipEngineApiRequest,
  relationshipEngineReadOnlyMethodNotAllowed,
  type RelationshipEngineApiEndpoint,
} from "@/lib/relationship-engine/api/boundary";
import type { RelationshipEngineReadServiceBinding } from "@/lib/relationship-engine/api/readServiceFactory";
import {
  LIFECYCLE_STATE,
  asIsoDateString,
  asOperatorId,
  asRelationshipId,
  asTimelineEventId,
  asTouchpointId,
  createRelationshipEngineReadService,
  type EvidenceRef,
  type RelationshipEngineReadRepositories,
  type RelationshipEntity,
  type TimelineEvent,
  type WorkspaceId,
} from "@/lib/relationship-engine";

const now = "2026-05-13T17:47:00.000Z";
const admin = toPublicUser(TENANTS.dylan);
const advisor = toPublicUser(TENANTS.advisor);
const relationshipId = asRelationshipId("relationship:api:active");
const ownerId = asOperatorId("operator:api:owner");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const unauthorized = await apiJson("health", "workspace=labortech", null);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");

  const forbidden = await apiJson("health", "workspace=labortech", advisor);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.error.code, "workspace_not_accessible");

  const invalid = await apiJson("feeds", "workspace=labortech&lifecycle=BAD", admin);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "invalid_lifecycle");

  const notFound = await apiJson("summary", `workspace=labortech&relationshipId=missing&asOf=${now}`, admin);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error.code, "relationship_not_found");
  assert.equal(notFound.body.meta.readOnly.queueExecution, false);

  const summary = await apiJson(
    "summary",
    `workspace=labortech&relationshipId=${relationshipId}&asOf=${now}`,
    admin,
    fixtureBinding,
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.body.data.relationshipId, relationshipId);
  assert.equal(summary.body.meta.generatedAt, now);
  assert.equal(summary.body.meta.readOnly.mutations, false);
  assert.equal(summary.body.meta.access.workspace, "labortech");

  const firstQueues = await apiJson(
    "queues",
    `workspace=labortech&relationshipIds=${relationshipId}&asOf=${now}&limit=50`,
    admin,
    fixtureBinding,
  );
  const secondQueues = await apiJson(
    "queues",
    `limit=50&asOf=${now}&relationshipIds=${relationshipId}&workspace=labortech`,
    admin,
    fixtureBinding,
  );
  assert.deepEqual(secondQueues.body, firstQueues.body, "API serialization must replay deterministically.");
  assert.deepEqual(firstQueues.body.meta.deterministic.collectionOrder, [
    "needs_attention",
    "overdue_follow_ups",
    "cooling_relationships",
    "retention_risk",
    "warm_opportunities",
    "reactivation_candidates",
  ]);

  const projection = await apiJson(
    "projection",
    `workspace=labortech&relationshipId=${relationshipId}&asOf=${now}`,
    admin,
    fixtureBinding,
  );
  assert.equal(projection.status, 200);
  assert.ok(Array.isArray(projection.body.data.feeds));
  assert.ok(Array.isArray(projection.body.data.queues));

  const health = await apiJson("health", `workspace=advisor-demo&asOf=${now}`, advisor);
  assert.equal(health.status, 200);
  assert.equal(health.body.data.service, "RelationshipEngineReadService");
  assert.equal(health.body.data.repositoryMode, "read_only_unwired");
  assert.equal(health.body.meta.readOnly.neonWrites, false);

  const mutation = await relationshipEngineReadOnlyMethodNotAllowed().json();
  assert.equal(mutation.ok, false);
  assert.equal(mutation.error.code, "relationship_engine_read_only");

  console.log("relationship engine api check passed", {
    summaryConfidence: summary.body.meta.confidence,
    queueKinds: firstQueues.body.data.queues.map((queue: { queueKind: string }) => queue.queueKind),
    healthRepositoryMode: health.body.data.repositoryMode,
    readOnly: health.body.meta.readOnly,
  });
}

async function apiJson(
  endpoint: RelationshipEngineApiEndpoint,
  query: string,
  session: typeof admin | null,
  serviceFactory?: (workspace: WorkspaceConfig) => RelationshipEngineReadServiceBinding,
) {
  const response = await handleRelationshipEngineApiRequest({
    endpoint,
    request: new Request(`https://meridian.local/api/relationship-engine/${endpoint}?${query}`),
    session,
    serviceFactory,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

function fixtureBinding(workspace: WorkspaceConfig): RelationshipEngineReadServiceBinding {
  return {
    service: createRelationshipEngineReadService(fixtureRepositories(workspace.id as WorkspaceId)),
    repositoryMode: "read_only_unwired",
    diagnostics: {
      relationshipStore: "unwired",
      timelineStore: "unwired",
      followUpStore: "unwired",
      scoringStore: "unwired",
      readOnly: true,
    },
  };
}

function fixtureRepositories(workspaceId: WorkspaceId): RelationshipEngineReadRepositories {
  const relationship = relationshipFixture(workspaceId);
  const timelineEvent = touchpointEvent(relationship.id);
  return {
    relationships: {
      async getById(id) {
        return id === relationship.id ? relationship : null;
      },
      async find(query) {
        const matchesWorkspace = query.workspaceId === relationship.workspaceId;
        const matchesOwner = !query.ownerId || relationship.assignments.some((assignment) => assignment.ownerId === query.ownerId);
        const matchesLifecycle = !query.lifecycle || query.lifecycle.includes(relationship.lifecycle);
        return {
          items: matchesWorkspace && matchesOwner && matchesLifecycle ? [relationship] : [],
        };
      },
      async summarize() {
        return null;
      },
    },
    timeline: {
      async list(query) {
        return {
          items: query.relationshipId === relationship.id ? [timelineEvent] : [],
        };
      },
    },
    followUps: {
      async listOpenPromises() {
        return [];
      },
      async listDueInstructions() {
        return [];
      },
    },
    scoring: {
      async getLatestHealthTrace() {
        return null;
      },
      async listHealthTraces() {
        return { items: [] };
      },
    },
  };
}

function relationshipFixture(workspaceId: WorkspaceId): RelationshipEntity {
  return {
    id: relationshipId,
    workspaceId,
    identity: {
      displayName: "API Boundary Fixture" as never,
      normalizedName: "api boundary fixture",
      kind: "company",
      externalRefs: [],
    },
    lifecycle: LIFECYCLE_STATE.ACTIVE,
    warmth: {
      band: "warm",
      score: 0,
      evidence: [evidence("warmth", "Warm relationship", "2026-05-13T12:00:00.000Z")],
      confidence: "medium",
    },
    assignments: [{
      ownerId,
      assignedAt: asIsoDateString("2026-05-13T12:00:00.000Z"),
      visibility: "primary_owner",
      reason: "API fixture owner",
    }],
    audit: {
      createdAt: asIsoDateString("2026-05-13T11:00:00.000Z"),
      updatedAt: asIsoDateString("2026-05-13T12:00:00.000Z"),
    },
  };
}

function touchpointEvent(id: RelationshipEntity["id"]): TimelineEvent {
  const occurredAt = asIsoDateString("2026-05-13T13:00:00.000Z");
  return {
    id: asTimelineEventId("timeline:api:touchpoint"),
    relationshipId: id,
    category: "touchpoint",
    type: "call_completed",
    occurredAt,
    recordedAt: occurredAt,
    source: "operator",
    actorId: ownerId,
    evidence: [evidence("touchpoint", "Completed call", "2026-05-13T13:00:00.000Z")],
    confidence: "medium",
    dedupeKey: "api-boundary-fixture:touchpoint",
    touchpoint: {
      id: asTouchpointId("touchpoint:api:call"),
      relationshipId: id,
      channel: "call",
      direction: "outbound",
      occurredAt,
      subject: "Completed call",
      operatorId: ownerId,
      evidence: [evidence("touchpoint-detail", "Completed call", "2026-05-13T13:00:00.000Z")],
    },
  };
}

function evidence(id: string, label: string, observedAt: string): EvidenceRef {
  return {
    id: `evidence:api:${id}`,
    source: "engine",
    label,
    observedAt: asIsoDateString(observedAt),
    confidence: "medium",
  };
}
