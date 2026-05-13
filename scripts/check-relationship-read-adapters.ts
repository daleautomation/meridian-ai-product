import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  asIsoDateString,
  asRelationshipId,
  createRelationshipEngineReadService,
  type RelationshipEngineReadRepositories,
} from "@/lib/relationship-engine";
import { relationshipReadOnlyDataSourceState } from "@/lib/relationship-engine/repositories/readOnlyDataSources";
import {
  createReadOnlyFileRelationshipAdapterBundle,
  readRelationshipAdapterSourceState,
} from "@/lib/relationship-engine/repositories/readOnlyAdapters";
import { WORKSPACES } from "@/config/workspaces";

const workspace = WORKSPACES.labortech;
const workspaceId = workspace.id as never;
const now = asIsoDateString("2026-05-13T19:00:00.000Z");
const relationshipId = asRelationshipId("relationship:labortech:domain:adapter.example");

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "relationship-read-adapters-"));
  try {
    await writeFixtures(dataDir);

    const state = relationshipReadOnlyDataSourceState(workspace, dataDir);
    assert.equal(state.ready, true);
    assert.equal(state.mode, "read_only_file");
    assert.equal(state.sources.operatorSnapshot, true);

    const sourceState = await readRelationshipAdapterSourceState({
      workspaceId,
      workspaceSlug: workspace.slug,
      dataDir,
    });
    assert.equal(sourceState.crmActivities.length, 2);
    assert.equal(sourceState.followUpTasks.length, 1);
    assert.equal(sourceState.usageEvents.length, 1);
    assert.equal(sourceState.executionOutcomes.length, 1);
    assert.equal(sourceState.operatorSnapshotRefs.length, 1);

    const first = createReadOnlyFileRelationshipAdapterBundle({ workspaceId, workspaceSlug: workspace.slug, dataDir });
    const second = createReadOnlyFileRelationshipAdapterBundle({ workspaceId, workspaceSlug: workspace.slug, dataDir });
    assertReadOnlyRepositories(first.repositories);
    assert.equal(first.timelineSources.capabilities.canWriteRelationships, false);
    assert.equal(first.timelineSources.capabilities.canAppendTimelineEvents, false);
    assert.equal(first.timelineSources.capabilities.canWriteScores, false);
    assert.equal(first.timelineSources.capabilities.canWriteQueueCandidates, false);

    const service = createRelationshipEngineReadService(first.repositories);
    const replayService = createRelationshipEngineReadService(second.repositories);
    const relationship = await first.repositories.relationships.getById(relationshipId);
    assert.ok(relationship);
    assert.equal(relationship.identity.displayName, "Adapter Roofing");
    assert.equal(relationship.lifecycle, "OPPORTUNITY");

    const summary = await service.getRelationshipSummary({
      context: { workspaceId, now },
      relationshipId,
      options: { staleTimelineAfterDays: 30 },
    });
    assert.equal(summary.data.relationshipId, relationshipId);
    assert.ok(summary.data.summary.openPromiseCount >= 1);
    assert.ok(summary.data.overdueFollowUps.some((followUp) =>
      followUp.dueAt === asIsoDateString("2026-05-12T16:00:00.000Z")));

    const timeline = await service.getRelationshipTimeline({
      context: { workspaceId, now },
      relationshipId,
      options: { staleTimelineAfterDays: 30 },
    });
    const timelineItemIds = timeline.data.groups.flatMap((group) => group.items.map((item) => item.id));
    assert.equal(new Set(timelineItemIds).size, timelineItemIds.length, "Timeline projection must not duplicate memory items.");
    assert.ok(timeline.warnings.some((issue) => issue.message.includes("duplicate import")));

    const traces = await first.repositories.scoring?.listHealthTraces(relationshipId);
    assert.equal(traces?.items.length, 1);
    assert.equal(traces?.items[0]?.modelVersion, "shadow-foundation-v0");
    assert.equal(traces?.items[0]?.score, 0);

    const projection = await service.getRelationshipProjection({ context: { workspaceId, now }, relationshipId });
    const replayProjection = await replayService.getRelationshipProjection({ context: { workspaceId, now }, relationshipId });
    assert.deepEqual(replayProjection, projection, "Adapter-backed projection must replay deterministically.");

    const adapterSource = await readFile("lib/relationship-engine/repositories/readOnlyAdapters.ts", "utf8");
    assert.equal(/safeWriteJson|appendFile|writeFile|recordDurableOutcome|writeEvent|createFollowUp|logActivity/.test(adapterSource), false);

    console.log("relationship read adapter check passed", {
      repositoryMode: state.mode,
      operatorSnapshot: state.sources.operatorSnapshot,
      relationshipId,
      timelineItems: timelineItemIds.length,
      warningCodes: timeline.warnings.map((issue) => issue.code),
      healthTraceModel: traces?.items[0]?.modelVersion,
      sourceCounts: {
        crmActivities: sourceState.crmActivities.length,
        followUpTasks: sourceState.followUpTasks.length,
        usageEvents: sourceState.usageEvents.length,
        executionOutcomes: sourceState.executionOutcomes.length,
        operatorSnapshotRefs: sourceState.operatorSnapshotRefs.length,
      },
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

function assertReadOnlyRepositories(repositories: RelationshipEngineReadRepositories): void {
  assert.equal("save" in repositories.relationships, false);
  assert.equal("append" in (repositories.timeline ?? {}), false);
  assert.equal("savePromise" in (repositories.followUps ?? {}), false);
  assert.equal("saveHealthTrace" in (repositories.scoring ?? {}), false);
}

async function writeFixtures(dataDir: string): Promise<void> {
  await mkdir(path.join(dataDir, "snapshots"), { recursive: true });
  await writeFile(path.join(dataDir, "snapshots", "labortech-operator.json"), JSON.stringify({
    version: 1,
    workspaceSlug: "labortech",
    generatedAt: "2026-05-13T18:00:00.000Z",
    expiresAt: "2026-05-14T18:00:00.000Z",
    props: {
      leads: [{
        id: "lead-adapter",
        taskId: "task-adapter",
        companyKey: "domain:adapter.example",
        companyName: "Adapter Roofing",
      }],
    },
  }));
  await writeFile(path.join(dataDir, "companySnapshots.json"), JSON.stringify({
    "domain:adapter.example": {
      key: "domain:adapter.example",
      company: {
        name: "Adapter Roofing",
        domain: "adapter.example",
        location: "Kansas City",
      },
      createdAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-10T12:00:00.000Z",
      status: "INTERESTED",
      scoreHistory: [{
        at: "2026-05-10T12:00:00.000Z",
        opportunityLevel: "HIGH",
        confidence: 92,
        recommendedAction: "Follow up",
        sourceTool: "fixture",
      }],
      lastAction: {
        type: "call",
        outcome: "INTERESTED",
        performedBy: "operator:adapter",
        performedAt: "2026-05-10T12:00:00.000Z",
      },
      nextAction: "Send proposal",
      nextActionDate: "2026-05-12T16:00:00.000Z",
    },
  }));
  await writeFile(path.join(dataDir, "crmActivities.json"), JSON.stringify({
    "domain:adapter.example": [
      crmActivity("crm-duplicate"),
      crmActivity("crm-duplicate"),
    ],
  }));
  await writeFile(path.join(dataDir, "followUps.json"), JSON.stringify({
    "domain:adapter.example": [{
      id: "follow-up-adapter",
      companyKey: "domain:adapter.example",
      companyName: "Adapter Roofing",
      taskType: "follow_up_call",
      title: "Call back Adapter Roofing",
      description: "Confirm proposal details",
      dueAt: "2026-05-12T16:00:00.000Z",
      status: "open",
      assignedUserId: "operator:adapter",
      createdBy: "operator:adapter",
      createdAt: "2026-05-10T13:00:00.000Z",
    }],
  }));
  await writeFile(path.join(dataDir, "usage-events.jsonl"), JSON.stringify({
    eventId: "usage-adapter",
    eventType: "call_completed",
    userId: "operator:adapter",
    operatorId: "operator:adapter",
    workspace: "labortech",
    leadId: "lead-adapter",
    taskId: "task-adapter",
    companyKey: "domain:adapter.example",
    companyName: "Adapter Roofing",
    tradeId: "roofing",
    serviceBucketId: "Reviews",
    sourceSurface: "operator_console",
    previousStatus: "QUALIFIED",
    nextStatus: "INTERESTED",
    outcomeStatus: null,
    occurredAt: "2026-05-10T14:00:00.000Z",
    recordedAt: "2026-05-10T14:00:01.000Z",
    idempotencyKey: "usage-adapter",
    timestamp: "2026-05-10T14:00:01.000Z",
    metadata: {},
  }) + "\n");
  await writeFile(path.join(dataDir, "executionOutcomes.json"), JSON.stringify({
    version: 1,
    byWorkspace: {
      labortech: {
        latestByKey: {},
        history: [{
          eventId: "outcome-adapter",
          workspace: "labortech",
          companyKey: "domain:adapter.example",
          crmKey: "domain:adapter.example",
          leadId: "lead-adapter",
          taskId: "task-adapter",
          operatorId: "operator:adapter",
          sourceSurface: "operator_console",
          outcomeStatus: "Proposal Sent",
          previousStatus: "Interested",
          nextStatus: "Proposal Sent",
          occurredAt: "2026-05-10T15:00:00.000Z",
          recordedAt: "2026-05-10T15:00:01.000Z",
          nextAction: "Send proposal",
          nextActionDate: "2026-05-12T16:00:00.000Z",
          estimatedValue: 12500,
          meridianInfluenced: true,
          influenceReason: "Fixture outcome",
          idempotencyKey: "outcome-adapter",
          metadata: { companyName: "Adapter Roofing" },
        }],
      },
    },
  }));
}

function crmActivity(id: string) {
  return {
    id,
    companyKey: "domain:adapter.example",
    companyName: "Adapter Roofing",
    performedAt: "2026-05-10T13:30:00.000Z",
    activityType: "call",
    performedBy: "operator:adapter",
    outcome: "interested",
    note: "Discussed proposal",
    summary: "Adapter Roofing is interested",
    nextAction: "Send proposal",
    nextActionDate: "2026-05-12T16:00:00.000Z",
  };
}
