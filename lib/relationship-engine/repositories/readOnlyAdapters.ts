// Meridian Relationship Engine — deterministic read-only repository adapters.
//
// These adapters are the first real data bridge for the engine. They read
// existing safe source files and expose only canonical repository contracts.
// No writer, queue executor, notification, reminder, or Neon persistence path
// is imported or reachable from this module.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  SourceCrmActivity,
  SourceExecutionOutcome,
  SourceFollowUpTask,
  SourceRelationshipRef,
  SourceUsageEvent,
} from "../adapters/sourceTypes";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import { normalizeLifecycleState } from "../lifecycle/validation";
import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  PromiseId,
  RelationshipId,
  ScoreTraceId,
  WorkspaceId,
} from "../primitives";
import type { RelationshipEntity, RelationshipWarmthBand } from "../relationship/entities";
import { LIFECYCLE_STATE, type LifecycleState } from "../relationship/lifecycle";
import { READ_ONLY_FILE_ADAPTER_CAPABILITIES, assertReadOnlyCapabilities } from "./boundaries";
import type { ReadOnlyTimelineSourceAdapter } from "./boundaries";
import type { PageRequest, PageResult, RelationshipQuery, TimelineQuery } from "./interfaces";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import { buildShadowHealthScoreTrace } from "../scoring/shadowHealthScore";
import { normalizeTimelineSources } from "../timeline/normalizers";
import { relationshipIdFromSource } from "../timeline/normalizers/common";
import type { TimelineEvent } from "../timeline/events";
import type { RelationshipEngineReadRepositories } from "../services/types";

const DEFAULT_FILE_AS_OF = "1970-01-01T00:00:00.000Z" as IsoDateString;

export interface ReadOnlyFileRelationshipAdapterOptions {
  workspaceId: WorkspaceId;
  workspaceSlug: string;
  dataDir?: string;
}

export interface ReadOnlyRelationshipAdapterSourceState {
  crmActivities: SourceCrmActivity[];
  followUpTasks: SourceFollowUpTask[];
  usageEvents: SourceUsageEvent[];
  executionOutcomes: SourceExecutionOutcome[];
  operatorSnapshotRefs: SourceRelationshipRef[];
  companySnapshots: SourceCompanySnapshot[];
}

export interface ReadOnlyRelationshipAdapterBundle {
  repositories: RelationshipEngineReadRepositories;
  timelineSources: ReadOnlyTimelineSourceAdapter;
}

type JsonRecord = Record<string, unknown>;

interface SourceCompanySnapshot {
  key: string;
  company: {
    name?: string;
    domain?: string;
    url?: string;
    location?: string;
  };
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  statusHistory?: Array<{ status?: string; changedAt?: string; changedBy?: string; note?: string }>;
  scoreHistory?: Array<{
    at?: string;
    opportunityLevel?: "HIGH" | "MEDIUM" | "LOW";
    confidence?: number;
    recommendedAction?: string;
    sourceTool?: string;
  }>;
  lastAction?: { type?: string; outcome?: string; note?: string; performedBy?: string; performedAt?: string };
  nextAction?: string;
  nextActionDate?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  preferredPhone?: string;
  preferredEmail?: string;
  dealActions?: Array<{ type?: string; outcome?: string; note?: string; performedBy?: string; performedAt?: string }>;
}

interface RelationshipAccumulator {
  id: RelationshipId;
  workspaceId: WorkspaceId;
  displayName: string;
  normalizedName: string;
  primaryEmail?: string;
  primaryPhone?: string;
  primaryLocation?: string;
  lifecycle: LifecycleState;
  warmthBand: RelationshipWarmthBand;
  warmthScore: number;
  warmthConfidence: ConfidenceLevel;
  evidence: EvidenceRef[];
  externalRefs: RelationshipEntity["identity"]["externalRefs"];
  assignments: RelationshipEntity["assignments"];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  tags: string[];
  attributes: Record<string, string | number | boolean | null>;
}

function authoritativeScoreHistory(
  scoreHistory: SourceCompanySnapshot["scoreHistory"] = [],
): NonNullable<SourceCompanySnapshot["scoreHistory"]> {
  // Legacy generate_opportunity_summary entries are AI-authored summaries,
  // not relationship warmth truth.
  return scoreHistory.filter((score) => score.sourceTool !== "generate_opportunity_summary");
}

export function createReadOnlyFileRelationshipAdapterBundle(
  options: ReadOnlyFileRelationshipAdapterOptions,
): ReadOnlyRelationshipAdapterBundle {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  let sourceStatePromise: Promise<ReadOnlyRelationshipAdapterSourceState> | null = null;
  const sourceState = () => {
    sourceStatePromise ??= readSourceState({ ...options, dataDir });
    return sourceStatePromise;
  };

  const timelineSources: ReadOnlyTimelineSourceAdapter = {
    capabilities: READ_ONLY_FILE_ADAPTER_CAPABILITIES,
    async listCrmActivities() {
      return stableCrmActivities((await sourceState()).crmActivities);
    },
    async listFollowUpTasks() {
      return stableFollowUpTasks((await sourceState()).followUpTasks);
    },
    async listUsageEvents() {
      return stableUsageEvents((await sourceState()).usageEvents);
    },
    async listExecutionOutcomes() {
      return stableExecutionOutcomes((await sourceState()).executionOutcomes);
    },
  };
  assertReadOnlyCapabilities(timelineSources.capabilities);

  const repositories: RelationshipEngineReadRepositories = {
    relationships: {
      async getById(id) {
        const relationships = await readRelationships(sourceState, options.workspaceId);
        return relationships.find((relationship) => relationship.id === id) ?? null;
      },
      async find(query) {
        const relationships = await readRelationships(sourceState, query.workspaceId);
        return page(
          relationships.filter((relationship) => relationshipMatchesQuery(relationship, query)),
          query.page,
        );
      },
      async summarize() {
        return null;
      },
    },
    timeline: {
      async list(query) {
        void query;
        return { items: [] };
      },
    },
    followUps: {
      async listOpenPromises(relationshipId) {
        const state = await sourceState();
        return stablePromises([
          ...state.followUpTasks.map((task) => followUpTaskToPromise(task, options.workspaceId)),
          ...state.crmActivities.flatMap((activity) => crmActivityToPromise(activity, options.workspaceId)),
        ].filter((promise): promise is PromiseRecord => {
          if (!promise) return false;
          return promise.relationshipId === relationshipId && promise.status === "open";
        }));
      },
      async listDueInstructions(args) {
        const state = await sourceState();
        return stableInstructions([
          ...state.followUpTasks.map((task) => followUpTaskToInstruction(task, options.workspaceId)),
          ...state.crmActivities.flatMap((activity) => crmActivityToInstruction(activity, options.workspaceId)),
          ...state.executionOutcomes.flatMap((outcome) => executionOutcomeToInstruction(outcome, options.workspaceId)),
          ...state.usageEvents.flatMap((event) => usageEventToInstruction(event, options.workspaceId)),
        ].filter((instruction): instruction is FollowUpInstruction => {
          if (!instruction) return false;
          return instruction.dueAt <= args.dueBefore
            && (!args.ownerId || instruction.ownerId === args.ownerId);
        }));
      },
    },
    scoring: {
      async getLatestHealthTrace(relationshipId) {
        const relationship = (await readRelationships(sourceState, options.workspaceId))
          .find((item) => item.id === relationshipId);
        if (!relationship) return null;
        const timeline = await readCanonicalTimeline(sourceState, options.workspaceId, { relationshipId });
        return shadowTrace(relationship, timeline);
      },
      async listHealthTraces(relationshipId, pageRequest) {
        const latest = await this.getLatestHealthTrace(relationshipId);
        return page(latest ? [latest] : [], pageRequest);
      },
    },
    timelineSources,
  };

  return { repositories, timelineSources };
}

export async function readRelationshipAdapterSourceState(
  options: ReadOnlyFileRelationshipAdapterOptions,
): Promise<ReadOnlyRelationshipAdapterSourceState> {
  return readSourceState({
    ...options,
    dataDir: options.dataDir ?? path.join(process.cwd(), "data"),
  });
}

async function readSourceState(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<ReadOnlyRelationshipAdapterSourceState> {
  const [
    companySnapshots,
    crmActivities,
    followUpTasks,
    usageEvents,
    executionOutcomes,
    operatorSnapshotRefs,
  ] = await Promise.all([
    readCompanySnapshots(options),
    readCrmActivities(options),
    readFollowUpTasks(options),
    readUsageEvents(options),
    readExecutionOutcomes(options),
    readOperatorSnapshotRefs(options),
  ]);
  return {
    companySnapshots,
    crmActivities,
    followUpTasks,
    usageEvents,
    executionOutcomes,
    operatorSnapshotRefs,
  };
}

async function readRelationships(
  sourceState: () => Promise<ReadOnlyRelationshipAdapterSourceState>,
  workspaceId: WorkspaceId,
): Promise<RelationshipEntity[]> {
  const state = await sourceState();
  const accumulators = new Map<RelationshipId, RelationshipAccumulator>();
  const upsert = (ref: SourceRelationshipRef, input: Partial<RelationshipAccumulator> & { observedAt: string; source: string; sourceId: string }) => {
    const id = relationshipIdFor(workspaceId, ref);
    const observedAt = isoOrDefault(input.observedAt);
    const existing = accumulators.get(id);
    const displayName = cleanString(input.displayName) ?? cleanString(ref.companyName) ?? cleanString(ref.companyKey) ?? id;
    const next: RelationshipAccumulator = existing ?? {
      id,
      workspaceId,
      displayName,
      normalizedName: normalizeName(displayName),
      lifecycle: LIFECYCLE_STATE.NEW,
      warmthBand: "unknown",
      warmthScore: 0,
      warmthConfidence: "unknown",
      evidence: [],
      externalRefs: [],
      assignments: [],
      createdAt: observedAt,
      updatedAt: observedAt,
      tags: [],
      attributes: {},
    };

    next.displayName = betterDisplayName(next.displayName, displayName);
    next.normalizedName = normalizeName(next.displayName);
    next.primaryEmail = cleanString(input.primaryEmail) ?? next.primaryEmail;
    next.primaryPhone = cleanString(input.primaryPhone) ?? next.primaryPhone;
    next.primaryLocation = cleanString(input.primaryLocation) ?? next.primaryLocation;
    next.lifecycle = input.lifecycle ?? next.lifecycle;
    next.warmthBand = input.warmthBand ?? next.warmthBand;
    next.warmthScore = input.warmthScore ?? next.warmthScore;
    next.warmthConfidence = input.warmthConfidence ?? next.warmthConfidence;
    next.createdAt = minIso(next.createdAt, observedAt);
    next.updatedAt = maxIso(next.updatedAt, observedAt);
    next.evidence = uniqueEvidence([...next.evidence, ...(input.evidence ?? [
      evidence(`${input.source}:${input.sourceId}`, input.source, input.sourceId, observedAt),
    ])]);
    next.externalRefs = uniqueExternalRefs([
      ...next.externalRefs,
      { source: input.source, sourceId: input.sourceId, observedAt },
    ]);
    next.assignments = uniqueAssignments([
      ...next.assignments,
      ...(input.assignments ?? []),
    ]);
    next.tags = uniqueStrings([...next.tags, ...(input.tags ?? [])]);
    next.attributes = { ...next.attributes, ...input.attributes };
    accumulators.set(id, next);
  };

  for (const snapshot of stableCompanySnapshots(state.companySnapshots)) {
    const latestScore = latestBy(authoritativeScoreHistory(snapshot.scoreHistory), (score) => isoOrDefault(score.at));
    const action = latestBy([
      ...(snapshot.dealActions ?? []),
      ...(snapshot.lastAction ? [snapshot.lastAction] : []),
    ], (item) => isoOrDefault(item.performedAt));
    const observedAt = snapshot.updatedAt ?? snapshot.createdAt ?? latestScore?.at ?? action?.performedAt ?? DEFAULT_FILE_AS_OF;
    const ownerId = cleanString(action?.performedBy)
      ?? cleanString(latestBy(snapshot.statusHistory ?? [], (item) => isoOrDefault(item.changedAt))?.changedBy);
    upsert({ workspace: workspaceId, companyKey: snapshot.key, companyName: snapshot.company.name }, {
      source: "company_snapshot",
      sourceId: snapshot.key,
      observedAt,
      displayName: snapshot.company.name,
      primaryEmail: snapshot.preferredEmail ?? snapshot.contactEmail,
      primaryPhone: snapshot.preferredPhone ?? snapshot.contactPhone,
      primaryLocation: snapshot.company.location,
      lifecycle: lifecycleFrom(snapshot.status ?? action?.outcome ?? action?.type) ?? LIFECYCLE_STATE.NEW,
      warmthBand: warmthBandFromScore(latestScore?.opportunityLevel),
      warmthScore: typeof latestScore?.confidence === "number" ? latestScore.confidence : 0,
      warmthConfidence: confidenceFromScore(latestScore?.confidence),
      assignments: ownerId ? [assignment(ownerId, observedAt, "Snapshot owner")] : [],
      attributes: {
        sourceSnapshotKey: snapshot.key,
        hasNextAction: Boolean(snapshot.nextActionDate),
      },
      tags: ["read_only_file"],
    });
  }

  for (const ref of stableRelationshipRefs(state.operatorSnapshotRefs)) {
    upsert(ref, {
      source: "operator_snapshot",
      sourceId: cleanString(ref.leadId) ?? cleanString(ref.taskId) ?? cleanString(ref.companyKey) ?? cleanString(ref.companyName) ?? "unknown",
      observedAt: DEFAULT_FILE_AS_OF,
      tags: ["read_only_snapshot"],
    });
  }

  for (const activity of stableCrmActivities(state.crmActivities)) {
    upsert(activity, {
      source: "crm_activity",
      sourceId: activity.id,
      observedAt: activity.performedAt,
      displayName: activity.companyName,
      lifecycle: lifecycleFrom(activity.outcome ?? activity.activityType),
      warmthBand: activity.closeConfidence === undefined ? undefined : warmthBandFromConfidence(activity.closeConfidence),
      warmthScore: activity.closeConfidence ?? undefined,
      warmthConfidence: confidenceFromScore(activity.closeConfidence),
      assignments: [assignment(activity.performedBy, activity.performedAt, "CRM activity actor")],
    });
  }

  for (const task of stableFollowUpTasks(state.followUpTasks)) {
    upsert(task, {
      source: "follow_up_task",
      sourceId: task.id,
      observedAt: task.completedAt ?? task.dueAt ?? task.createdAt,
      displayName: task.companyName,
      lifecycle: task.status === "open" ? LIFECYCLE_STATE.NURTURING : undefined,
      assignments: task.assignedUserId ? [assignment(task.assignedUserId, task.createdAt, "Follow-up assignee")] : [],
    });
  }

  for (const event of stableUsageEvents(state.usageEvents)) {
    upsert(event, {
      source: "usage_event",
      sourceId: event.eventId ?? `${event.timestamp}:${event.eventType}`,
      observedAt: event.occurredAt ?? event.recordedAt ?? event.timestamp,
      displayName: event.companyName ?? undefined,
      lifecycle: lifecycleFrom(event.nextStatus ?? event.outcomeStatus ?? event.eventType),
      assignments: event.operatorId ?? event.userId ? [assignment(event.operatorId ?? event.userId ?? "system", event.timestamp, "Usage event actor")] : [],
    });
  }

  for (const outcome of stableExecutionOutcomes(state.executionOutcomes)) {
    upsert(outcome, {
      source: "execution_outcome",
      sourceId: outcome.eventId,
      observedAt: outcome.occurredAt ?? outcome.recordedAt,
      displayName: outcome.companyName ?? undefined,
      lifecycle: lifecycleFrom(outcome.nextStatus ?? outcome.outcomeStatus),
      assignments: [assignment(outcome.operatorId, outcome.recordedAt, "Execution outcome actor")],
    });
  }

  return [...accumulators.values()].map(accumulatorToRelationship).sort(compareRelationships);
}

async function readCanonicalTimeline(
  sourceState: () => Promise<ReadOnlyRelationshipAdapterSourceState>,
  workspaceId: WorkspaceId,
  query: TimelineQuery,
): Promise<TimelineEvent[]> {
  const state = await sourceState();
  const normalized = normalizeTimelineSources({
    context: {
      now: DEFAULT_FILE_AS_OF,
      workspaceId,
      defaultRecordedAt: DEFAULT_FILE_AS_OF,
    },
    crmActivities: state.crmActivities,
    followUpTasks: state.followUpTasks,
    usageEvents: state.usageEvents,
    executionOutcomes: state.executionOutcomes,
  });
  return normalized.events.filter((event) => (
    event.relationshipId === query.relationshipId
    && (!query.occurredAfter || event.occurredAt > query.occurredAfter)
    && (!query.occurredBefore || event.occurredAt < query.occurredBefore)
    && (!query.categories || query.categories.includes(event.category))
  )).sort(compareTimelineEvents);
}

async function readCompanySnapshots(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<SourceCompanySnapshot[]> {
  const parsed = await readJson<JsonRecord>(path.join(options.dataDir, "companySnapshots.json"));
  if (!parsed) return [];
  return Object.values(parsed)
    .filter(isRecord)
    .map((value) => value as unknown as SourceCompanySnapshot)
    .filter((snapshot) => typeof snapshot.key === "string" && isRecord(snapshot.company))
    .sort((a, b) => a.key.localeCompare(b.key));
}

async function readCrmActivities(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<SourceCrmActivity[]> {
  const parsed = await readJson<Record<string, SourceCrmActivity[]>>(path.join(options.dataDir, "crmActivities.json"));
  if (!parsed) return [];
  return Object.values(parsed)
    .flat()
    .filter((activity) => isRecord(activity) && typeof activity.id === "string")
    .map((activity) => ({
      ...activity,
      workspace: options.workspaceId,
      crmKey: activity.companyKey,
    }));
}

async function readFollowUpTasks(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<SourceFollowUpTask[]> {
  const parsed = await readJson<Record<string, SourceFollowUpTask[]>>(path.join(options.dataDir, "followUps.json"));
  if (!parsed) return [];
  return Object.values(parsed)
    .flat()
    .filter((task) => isRecord(task) && typeof task.id === "string")
    .map((task) => ({
      ...task,
      workspace: options.workspaceId,
      crmKey: task.companyKey,
    }));
}

async function readUsageEvents(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<SourceUsageEvent[]> {
  const rows = await readJsonLines<SourceUsageEvent>(path.join(options.dataDir, "usage-events.jsonl"));
  return rows
    .filter((event) => event.workspace === options.workspaceSlug || event.workspace === options.workspaceId)
    .map((event) => ({
      ...event,
      workspace: event.workspace ?? options.workspaceId,
      operatorId: event.operatorId ?? event.userId,
      metadata: event.metadata ?? {},
    }));
}

async function readExecutionOutcomes(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<SourceExecutionOutcome[]> {
  const parsed = await readJson<{ byWorkspace?: Record<string, { history?: SourceExecutionOutcome[] }> }>(
    path.join(options.dataDir, "executionOutcomes.json"),
  );
  const rows = parsed?.byWorkspace?.[options.workspaceSlug]?.history
    ?? parsed?.byWorkspace?.[options.workspaceId]?.history
    ?? [];
  return rows.filter((outcome) => isRecord(outcome) && typeof outcome.eventId === "string")
    .map((outcome) => ({
      ...outcome,
      workspace: outcome.workspace ?? options.workspaceId,
      companyName: cleanString(outcome.companyName) ?? cleanString(outcome.metadata?.companyName as string | undefined),
    }));
}

async function readOperatorSnapshotRefs(options: Required<ReadOnlyFileRelationshipAdapterOptions>): Promise<SourceRelationshipRef[]> {
  const parsed = await readJson<JsonRecord>(path.join(options.dataDir, "snapshots", `${safeFilePart(options.workspaceSlug)}-operator.json`));
  if (!parsed || !isRecord(parsed.props)) return [];
  const refs: SourceRelationshipRef[] = [];
  collectRelationshipRefs(parsed.props, options.workspaceId, refs, 0);
  return stableRelationshipRefs(refs);
}

function collectRelationshipRefs(value: unknown, workspaceId: WorkspaceId, refs: SourceRelationshipRef[], depth: number): void {
  if (depth > 8 || refs.length > 500) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRelationshipRefs(item, workspaceId, refs, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  const companyName = cleanString(value.companyName) ?? (isRecord(value.company) ? cleanString(value.company.name) : null);
  const leadId = cleanString(value.leadId) ?? cleanString(value.id);
  const taskId = cleanString(value.taskId);
  const companyKey = cleanString(value.companyKey)
    ?? cleanString(value.crmKey)
    ?? (isRecord(value.company) ? cleanString(value.company.domain) : null);
  if (companyName && (leadId || taskId || companyKey)) {
    refs.push({
      workspace: workspaceId,
      companyName,
      leadId,
      taskId,
      companyKey,
      crmKey: companyKey,
    });
  }

  for (const nested of Object.values(value)) {
    collectRelationshipRefs(nested, workspaceId, refs, depth + 1);
  }
}

function relationshipMatchesQuery(relationship: RelationshipEntity, query: RelationshipQuery): boolean {
  return relationship.workspaceId === query.workspaceId
    && (!query.ownerId || relationship.assignments.some((assignment) => assignment.ownerId === query.ownerId))
    && (!query.lifecycle || query.lifecycle.includes(relationship.lifecycle))
    && (!query.updatedAfter || relationship.audit.updatedAt > query.updatedAfter);
}

function relationshipIdFor(workspaceId: WorkspaceId, ref: SourceRelationshipRef): RelationshipId {
  return relationshipIdFromSource({ ...ref, workspace: ref.workspace ?? workspaceId });
}

function accumulatorToRelationship(accumulator: RelationshipAccumulator): RelationshipEntity {
  return {
    id: accumulator.id,
    workspaceId: accumulator.workspaceId,
    identity: {
      displayName: accumulator.displayName as never,
      normalizedName: accumulator.normalizedName,
      kind: "company",
      ...(accumulator.primaryEmail ? { primaryEmail: accumulator.primaryEmail } : {}),
      ...(accumulator.primaryPhone ? { primaryPhone: accumulator.primaryPhone } : {}),
      ...(accumulator.primaryLocation ? { primaryLocation: accumulator.primaryLocation } : {}),
      externalRefs: accumulator.externalRefs,
    },
    lifecycle: accumulator.lifecycle,
    warmth: {
      band: accumulator.warmthBand,
      score: accumulator.warmthScore,
      evidence: accumulator.evidence,
      confidence: accumulator.warmthConfidence,
    },
    assignments: accumulator.assignments,
    tags: accumulator.tags,
    attributes: accumulator.attributes,
    audit: {
      createdAt: accumulator.createdAt,
      updatedAt: accumulator.updatedAt,
      createdBy: "system",
      updatedBy: "system",
    },
  };
}

function followUpTaskToPromise(task: SourceFollowUpTask, workspaceId: WorkspaceId): PromiseRecord | null {
  if (task.status !== "open") return null;
  const observedAt = isoOrDefault(task.createdAt);
  return {
    id: `promise:follow-up:${task.id}` as PromiseId,
    relationshipId: relationshipIdFor(workspaceId, task),
    title: task.title,
    ...(task.description ? { description: task.description } : {}),
    status: "open",
    promisedBy: task.createdBy ? operatorId(task.createdBy) : "system",
    ...(task.assignedUserId ? { ownerId: operatorId(task.assignedUserId) } : {}),
    createdAt: observedAt,
    ...(task.dueAt ? { dueAt: isoOrDefault(task.dueAt) } : {}),
    evidence: [evidence(`follow_up_task:${task.id}`, "follow_up_task", task.title, observedAt)],
    confidence: "medium",
  };
}

function crmActivityToPromise(activity: SourceCrmActivity, workspaceId: WorkspaceId): PromiseRecord[] {
  if (!activity.nextActionDate || !activity.nextAction) return [];
  const observedAt = isoOrDefault(activity.performedAt);
  return [{
    id: `promise:crm:${activity.id}` as PromiseId,
    relationshipId: relationshipIdFor(workspaceId, activity),
    title: activity.nextAction,
    status: "open",
    promisedBy: activity.performedBy ? operatorId(activity.performedBy) : "system",
    ownerId: activity.performedBy ? operatorId(activity.performedBy) : undefined,
    createdAt: observedAt,
    dueAt: isoOrDefault(activity.nextActionDate),
    evidence: [evidence(`crm_activity:${activity.id}:next_action`, "crm_activity", activity.nextAction, observedAt)],
    confidence: "medium",
  }];
}

function followUpTaskToInstruction(task: SourceFollowUpTask, workspaceId: WorkspaceId): FollowUpInstruction | null {
  if (task.status !== "open" || !task.dueAt) return null;
  const observedAt = isoOrDefault(task.createdAt);
  return {
    relationshipId: relationshipIdFor(workspaceId, task),
    ...(task.assignedUserId ? { ownerId: operatorId(task.assignedUserId) } : {}),
    dueAt: isoOrDefault(task.dueAt),
    reason: task.title,
    source: "operator",
    confidence: "medium",
    evidence: [evidence(`follow_up_task:${task.id}:instruction`, "follow_up_task", task.title, observedAt)],
  };
}

function crmActivityToInstruction(activity: SourceCrmActivity, workspaceId: WorkspaceId): FollowUpInstruction[] {
  if (!activity.nextActionDate || !activity.nextAction) return [];
  const observedAt = isoOrDefault(activity.performedAt);
  return [{
    relationshipId: relationshipIdFor(workspaceId, activity),
    ownerId: activity.performedBy ? operatorId(activity.performedBy) : undefined,
    dueAt: isoOrDefault(activity.nextActionDate),
    reason: activity.nextAction,
    source: "operator",
    confidence: "medium",
    evidence: [evidence(`crm_activity:${activity.id}:instruction`, "crm_activity", activity.nextAction, observedAt)],
  }];
}

function executionOutcomeToInstruction(outcome: SourceExecutionOutcome, workspaceId: WorkspaceId): FollowUpInstruction[] {
  if (!outcome.nextActionDate || !outcome.nextAction) return [];
  const observedAt = isoOrDefault(outcome.recordedAt ?? outcome.occurredAt);
  return [{
    relationshipId: relationshipIdFor(workspaceId, outcome),
    ownerId: operatorId(outcome.operatorId),
    dueAt: isoOrDefault(outcome.nextActionDate),
    reason: outcome.nextAction,
    source: "outcome",
    confidence: "medium",
    evidence: [evidence(`execution_outcome:${outcome.eventId}:instruction`, "execution_outcome", outcome.nextAction, observedAt)],
  }];
}

function usageEventToInstruction(event: SourceUsageEvent, workspaceId: WorkspaceId): FollowUpInstruction[] {
  if (!event.nextActionDate || !event.nextAction) return [];
  const observedAt = isoOrDefault(event.recordedAt ?? event.timestamp);
  return [{
    relationshipId: relationshipIdFor(workspaceId, event),
    ownerId: event.operatorId ?? event.userId ? operatorId(event.operatorId ?? event.userId ?? "system") : undefined,
    dueAt: isoOrDefault(event.nextActionDate),
    reason: event.nextAction,
    source: "operator",
    confidence: "low",
    evidence: [evidence(`usage_event:${event.eventId ?? event.timestamp}:instruction`, "usage_event", event.nextAction, observedAt)],
  }];
}

function shadowTrace(relationship: RelationshipEntity, timelineEvents: TimelineEvent[]): HealthScoreTrace {
  return {
    ...buildShadowHealthScoreTrace({
      relationshipId: relationship.id,
      computedAt: relationship.audit.updatedAt,
      timelineEvents,
      inputRelationshipVersion: relationship.audit.updatedAt,
      evidence: relationship.warmth.evidence,
    }),
    id: `score-trace:read-only:${stableHash([relationship.id, relationship.audit.updatedAt])}` as ScoreTraceId,
  };
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readJsonLines<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.split("\n").flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        return [JSON.parse(trimmed) as T];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function page<T>(items: T[], pageRequest?: PageRequest): PageResult<T> {
  if (!pageRequest) return { items };
  const start = pageRequest.cursor ? Number(pageRequest.cursor) : 0;
  const safeStart = Number.isInteger(start) && start > 0 ? start : 0;
  const end = safeStart + pageRequest.limit;
  return {
    items: items.slice(safeStart, end),
    ...(end < items.length ? { nextCursor: String(end) } : {}),
  };
}

function stableCompanySnapshots(items: SourceCompanySnapshot[]): SourceCompanySnapshot[] {
  return items.slice().sort((a, b) => a.key.localeCompare(b.key));
}

function stableCrmActivities(items: SourceCrmActivity[]): SourceCrmActivity[] {
  return items.slice().sort((a, b) => a.performedAt.localeCompare(b.performedAt) || a.id.localeCompare(b.id));
}

function stableFollowUpTasks(items: SourceFollowUpTask[]): SourceFollowUpTask[] {
  return items.slice().sort((a, b) => (a.dueAt ?? a.createdAt).localeCompare(b.dueAt ?? b.createdAt) || a.id.localeCompare(b.id));
}

function stableUsageEvents(items: SourceUsageEvent[]): SourceUsageEvent[] {
  return items.slice().sort((a, b) =>
    (a.occurredAt ?? a.recordedAt ?? a.timestamp).localeCompare(b.occurredAt ?? b.recordedAt ?? b.timestamp)
    || (a.eventId ?? "").localeCompare(b.eventId ?? "")
    || a.eventType.localeCompare(b.eventType));
}

function stableExecutionOutcomes(items: SourceExecutionOutcome[]): SourceExecutionOutcome[] {
  return items.slice().sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.eventId.localeCompare(b.eventId));
}

function stableRelationshipRefs(items: SourceRelationshipRef[]): SourceRelationshipRef[] {
  const byId = new Map<string, SourceRelationshipRef>();
  for (const item of items) {
    const key = [
      item.workspace,
      item.relationshipId,
      item.companyKey,
      item.crmKey,
      item.leadId,
      item.taskId,
      item.companyName,
    ].join("|");
    byId.set(key, item);
  }
  return [...byId.values()].sort((a, b) =>
    (a.companyName ?? "").localeCompare(b.companyName ?? "")
    || (a.companyKey ?? "").localeCompare(b.companyKey ?? "")
    || (a.leadId ?? "").localeCompare(b.leadId ?? "")
    || (a.taskId ?? "").localeCompare(b.taskId ?? ""));
}

function stablePromises(items: PromiseRecord[]): PromiseRecord[] {
  const byId = new Map<PromiseId, PromiseRecord>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) =>
    (a.dueAt ?? "").localeCompare(b.dueAt ?? "")
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id));
}

function stableInstructions(items: FollowUpInstruction[]): FollowUpInstruction[] {
  return items.slice().sort((a, b) =>
    a.dueAt.localeCompare(b.dueAt)
    || (a.ownerId ?? "").localeCompare(b.ownerId ?? "")
    || a.relationshipId.localeCompare(b.relationshipId)
    || a.reason.localeCompare(b.reason)
    || a.source.localeCompare(b.source));
}

function compareRelationships(a: RelationshipEntity, b: RelationshipEntity): number {
  return a.id.localeCompare(b.id);
}

function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  return a.occurredAt.localeCompare(b.occurredAt)
    || a.recordedAt.localeCompare(b.recordedAt)
    || a.id.localeCompare(b.id);
}

function lifecycleFrom(value: unknown): LifecycleState | undefined {
  return normalizeLifecycleState(value) ?? undefined;
}

function warmthBandFromScore(value: "HIGH" | "MEDIUM" | "LOW" | undefined): RelationshipWarmthBand {
  if (value === "HIGH") return "hot";
  if (value === "MEDIUM") return "warm";
  if (value === "LOW") return "cool";
  return "unknown";
}

function warmthBandFromConfidence(value: number): RelationshipWarmthBand {
  if (value >= 80) return "hot";
  if (value >= 55) return "warm";
  if (value >= 25) return "cool";
  return "cold";
}

function confidenceFromScore(value: number | undefined): ConfidenceLevel {
  if (typeof value !== "number") return "unknown";
  if (value >= 75) return "high";
  if (value >= 35) return "medium";
  return "low";
}

function assignment(ownerId: string, assignedAt: string, reason: string): RelationshipEntity["assignments"][number] {
  return {
    ownerId: operatorId(ownerId),
    assignedAt: isoOrDefault(assignedAt),
    assignedBy: "system",
    reason,
    visibility: "primary_owner",
  };
}

function operatorId(value: string): OperatorId {
  return value as OperatorId;
}

function evidence(id: string, source: string, label: string, observedAt: string): EvidenceRef {
  return {
    id: `evidence:read-only:${stableHash([id, source, label])}`,
    source,
    label,
    observedAt: isoOrDefault(observedAt),
    confidence: "medium",
  };
}

function uniqueEvidence(items: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
}

function uniqueExternalRefs(items: RelationshipEntity["identity"]["externalRefs"]): RelationshipEntity["identity"]["externalRefs"] {
  return [...new Map(items.map((item) => [`${item.source}:${item.sourceId}`, item])).values()]
    .sort((a, b) => a.source.localeCompare(b.source) || a.sourceId.localeCompare(b.sourceId));
}

function uniqueAssignments(items: RelationshipEntity["assignments"]): RelationshipEntity["assignments"] {
  return [...new Map(items.map((item) => [`${item.ownerId}:${item.visibility}`, item])).values()]
    .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt) || a.ownerId.localeCompare(b.ownerId));
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function latestBy<T>(items: T[], getTimestamp: (item: T) => IsoDateString): T | undefined {
  return items.slice().sort((a, b) => getTimestamp(a).localeCompare(getTimestamp(b))).at(-1);
}

function minIso(a: IsoDateString, b: IsoDateString): IsoDateString {
  return a <= b ? a : b;
}

function maxIso(a: IsoDateString, b: IsoDateString): IsoDateString {
  return a >= b ? a : b;
}

function isoOrDefault(value: string | undefined | null): IsoDateString {
  if (!value) return DEFAULT_FILE_AS_OF;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return DEFAULT_FILE_AS_OF;
  return parsed.toISOString() as IsoDateString;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function betterDisplayName(current: string, next: string): string {
  if (current.startsWith("relationship:")) return next;
  if (next.length > current.length && current === current.toLowerCase()) return next;
  return current;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function stableHash(parts: Array<string | number | boolean | null | undefined>): string {
  let value = 2166136261;
  for (const char of parts.map((part) => part ?? "").join("|")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}
