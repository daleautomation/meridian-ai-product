import assert from "node:assert/strict";
import { TENANTS, toPublicUser } from "@/config/tenants";
import type { WorkspaceConfig } from "@/config/workspaces";
import {
  handleRelationshipEngineInternalDiagnosticsRequest,
  relationshipEngineInternalReadOnlyMethodNotAllowed,
} from "@/lib/relationship-engine/api/internalDiagnostics";
import type { RelationshipEngineReadServiceBinding } from "@/lib/relationship-engine/api/readServiceFactory";
import {
  LIFECYCLE_STATE,
  RelationshipEngineDiagnosticsService,
  asIsoDateString,
  asOperatorId,
  asRelationshipId,
  asTimelineEventId,
  asTouchpointId,
  assertRelationshipEngineConsumerBoundary,
  createRelationshipEngineFacadeDiagnosticsConsumer,
  createRelationshipEngineReadService,
  type EvidenceRef,
  type RelationshipEngineReadRepositories,
  type RelationshipEntity,
  type TimelineEvent,
  type WorkspaceId,
} from "@/lib/relationship-engine";

const now = "2026-05-13T18:06:00.000Z";
const admin = toPublicUser(TENANTS.dylan);
const client = toPublicUser(TENANTS.labortech);
const relationshipId = asRelationshipId("relationship:observability:stale");
const ownerId = asOperatorId("operator:observability:owner");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const unauthorized = await internalJson("health", "workspace=labortech", null);
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.body.error.code, "unauthorized");

  const nonAdmin = await internalJson("health", "workspace=labortech", client);
  assert.equal(nonAdmin.status, 403);
  assert.equal(nonAdmin.body.error.code, "relationship_engine_admin_required");

  const first = await internalJson(
    "diagnostics",
    `workspace=labortech&relationshipIds=${relationshipId}&asOf=${now}&staleTimelineAfterDays=30`,
    admin,
    fixtureBinding,
  );
  const second = await internalJson(
    "diagnostics",
    `staleTimelineAfterDays=30&asOf=${now}&relationshipIds=${relationshipId}&workspace=labortech`,
    admin,
    fixtureBinding,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(second.body, first.body, "Diagnostics output must replay deterministically with fixed asOf.");
  assert.equal(first.body.data.health.repositoryMode, "read_only_unwired");
  assert.equal(first.body.data.health.readOnlyGuarantees.queueExecution, false);
  assert.equal(first.body.data.metadata.deterministic.replaySafeWithFixedAsOf, true);
  assert.ok(first.body.data.metadata.validationWarnings.some((issue: { code: string }) => issue.code === "stale_timeline_activity"));
  assert.ok(first.body.data.metadata.missingData.reasons.includes("no_health_trace"));

  const health = await internalJson(
    "health",
    `workspace=labortech&relationshipIds=${relationshipId}&asOf=${now}&staleTimelineAfterDays=30`,
    admin,
    fixtureBinding,
  );
  assert.equal(health.status, 200);
  assert.equal(health.body.data.deterministicReplayStatus, "ok");
  assert.ok(health.body.data.staleProjectionWarnings.some((issue: { code: string }) => issue.code === "stale_timeline_activity"));

  const validation = await internalJson(
    "validation",
    `workspace=labortech&relationshipIds=${relationshipId}&asOf=${now}&staleTimelineAfterDays=30`,
    admin,
    fixtureBinding,
  );
  assert.equal(validation.status, 200);
  assert.ok(validation.body.data.consumerBoundaries.every((boundary: { repositoriesAllowed: boolean }) =>
    boundary.repositoriesAllowed === false));
  assertRelationshipEngineConsumerBoundary("operator_workspace");
  assertRelationshipEngineConsumerBoundary("future_admin_dashboard");

  const facadeConsumer = createRelationshipEngineFacadeDiagnosticsConsumer({
    kind: "operator_workspace",
    diagnosticsService: new RelationshipEngineDiagnosticsService(),
    request: {
      context: { now: asIsoDateString(now), workspaceId: "labortech" as WorkspaceId },
      service: createRelationshipEngineReadService(fixtureRepositories("labortech" as WorkspaceId)),
      repositoryMode: "read_only_unwired",
      repositoryDiagnostics: readyDiagnostics(),
      relationshipIds: [relationshipId],
      options: { staleTimelineAfterDays: 30 },
      generatedAtSource: "query_asOf",
    },
  });
  const consumerHealth = await facadeConsumer.getHealth();
  assert.equal(consumerHealth.queueValidationStatus, "ok");
  assert.equal(consumerHealth.readOnlyGuarantees.neonWrites, false);

  const mutation = await relationshipEngineInternalReadOnlyMethodNotAllowed().json();
  assert.equal(mutation.ok, false);
  assert.equal(mutation.readOnly.queueExecution, false);

  const serialized = JSON.stringify(first.body);
  assert.equal(serialized.includes("Stale Observability Fixture"), false, "Diagnostics must not expose private display names.");
  assert.equal(/password|cookie|token|DATABASE_URL|connectionString/i.test(serialized), false);

  console.log("relationship engine observability check passed", {
    healthStatus: health.body.data.overallStatus,
    warningCodes: first.body.data.metadata.validationWarnings.map((issue: { code: string }) => issue.code),
    repositoryMode: first.body.data.metadata.repositoryMode,
    consumerCount: validation.body.data.consumerBoundaries.length,
  });
}

async function internalJson(
  surface: "diagnostics" | "health" | "validation",
  query: string,
  session: typeof admin | null,
  serviceFactory?: (workspace: WorkspaceConfig) => RelationshipEngineReadServiceBinding,
) {
  const response = await handleRelationshipEngineInternalDiagnosticsRequest({
    surface,
    request: new Request(`https://meridian.local/api/internal/relationship-engine/${surface}?${query}`),
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
    diagnostics: readyDiagnostics(),
  };
}

function readyDiagnostics(): RelationshipEngineReadServiceBinding["diagnostics"] {
  return {
    relationshipStore: "ready",
    timelineStore: "ready",
    followUpStore: "ready",
    scoringStore: "ready",
    readOnly: true,
  };
}

function fixtureRepositories(workspaceId: WorkspaceId): RelationshipEngineReadRepositories {
  const relationship = relationshipFixture(workspaceId);
  const timelineEvent = staleTouchpointEvent(relationship.id);
  return {
    relationships: {
      async getById(id) {
        return id === relationship.id ? relationship : null;
      },
      async find(query) {
        return {
          items: query.workspaceId === relationship.workspaceId ? [relationship] : [],
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
      displayName: "Stale Observability Fixture" as never,
      normalizedName: "stale observability fixture",
      kind: "company",
      externalRefs: [],
    },
    lifecycle: LIFECYCLE_STATE.ACTIVE,
    warmth: {
      band: "cool",
      score: 0,
      evidence: [evidence("warmth", "Cool relationship", "2026-02-01T12:00:00.000Z")],
      confidence: "medium",
    },
    assignments: [{
      ownerId,
      assignedAt: asIsoDateString("2026-02-01T12:00:00.000Z"),
      visibility: "primary_owner",
      reason: "Observability fixture owner",
    }],
    audit: {
      createdAt: asIsoDateString("2026-02-01T11:00:00.000Z"),
      updatedAt: asIsoDateString("2026-02-01T12:00:00.000Z"),
    },
  };
}

function staleTouchpointEvent(id: RelationshipEntity["id"]): TimelineEvent {
  const occurredAt = asIsoDateString("2026-02-01T13:00:00.000Z");
  return {
    id: asTimelineEventId("timeline:observability:old-touchpoint"),
    relationshipId: id,
    category: "touchpoint",
    type: "call_completed",
    occurredAt,
    recordedAt: occurredAt,
    source: "operator",
    actorId: ownerId,
    evidence: [evidence("touchpoint", "Old call", "2026-02-01T13:00:00.000Z")],
    confidence: "medium",
    dedupeKey: "observability-fixture:touchpoint",
    touchpoint: {
      id: asTouchpointId("touchpoint:observability:old-call"),
      relationshipId: id,
      channel: "call",
      direction: "outbound",
      occurredAt,
      subject: "Old call",
      operatorId: ownerId,
      evidence: [evidence("touchpoint-detail", "Old call", "2026-02-01T13:00:00.000Z")],
    },
  };
}

function evidence(id: string, label: string, observedAt: string): EvidenceRef {
  return {
    id: `evidence:observability:${id}`,
    source: "engine",
    label,
    observedAt: asIsoDateString(observedAt),
    confidence: "medium",
  };
}
