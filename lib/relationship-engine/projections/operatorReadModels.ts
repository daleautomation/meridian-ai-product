// Meridian Relationship Engine — safe operator feed, queue, and timeline read models.
//
// These projections are deterministic DTO builders over canonical relationship
// memory. They do not rank with production scores, dispatch work, write storage,
// notify operators, or derive state from UI surfaces.

import type {
  ConfidenceLevel,
  EngineContext,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  PromiseId,
  RelationshipId,
  TimelineEventId,
} from "../primitives";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type { LifecycleState } from "../relationship/lifecycle";
import { LIFECYCLE_STATE, TERMINAL_LIFECYCLE_STATES } from "../relationship/lifecycle";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type { TimelineEvent } from "../timeline/events";
import type {
  ProjectionInputSource,
  RelationshipProjectionEvidencePointer,
  RelationshipProjectionMissingData,
  RelationshipSummaryProjection,
} from "./dto";
import {
  sortProjectionEvidence,
  sortProjectionFollowUps,
  sortProjectionPromises,
  sortProjectionTimelineEvents,
  uniqueStrings,
} from "./ordering";
import { DEFAULT_STALE_TIMELINE_AFTER_DAYS } from "./validation";

export type RelationshipFeedKind =
  | "relationship_activity"
  | "operator_relationship"
  | "relationship_momentum"
  | "overdue_relationship"
  | "relationship_change";

export type RelationshipQueueKind =
  | "needs_attention"
  | "overdue_follow_ups"
  | "cooling_relationships"
  | "retention_risk"
  | "warm_opportunities"
  | "reactivation_candidates";

export type RelationshipTimelineGroupKind =
  | "grouped_activity"
  | "promises"
  | "lifecycle_changes"
  | "outcomes"
  | "follow_ups"
  | "ownership_changes"
  | "relationship_momentum";

export type RelationshipReadModelIssueSeverity = "error" | "warning";

export interface RelationshipReadModelIssue {
  severity: RelationshipReadModelIssueSeverity;
  code: string;
  message: string;
  relationshipId?: RelationshipId;
  timelineEventId?: TimelineEventId;
  queueKind?: RelationshipQueueKind;
}

export interface RelationshipReadModelValidationResult {
  ok: boolean;
  issues: RelationshipReadModelIssue[];
}

export interface RelationshipReadModelBoundaryPolicy {
  allowedInputs: ProjectionInputSource[];
  readOnly: true;
  deterministic: true;
  persistsProjection: false;
  mutatesRepositories: false;
  dispatchesQueue: false;
  sendsNotifications: false;
  computesProductionScore: false;
  consumesUiState: false;
  writesNeon: false;
}

export interface RelationshipReadModelOrdering {
  strategy: "deterministic_read_model_v0";
  productionScoring: false;
  sortKeys: string[];
  tieBreakers: string[];
}

export interface RelationshipReadModelExplanation {
  generatedBy:
    | "relationship_feed_read_model"
    | "relationship_queue_read_model"
    | "relationship_timeline_read_model";
  generatedAt: IsoDateString;
  inputSources: ProjectionInputSource[];
  boundary: RelationshipReadModelBoundaryPolicy;
  notes: string[];
}

export interface RelationshipReadModelInput {
  context: EngineContext;
  summaries: RelationshipSummaryProjection[];
  timelineEvents?: TimelineEvent[];
  promises?: PromiseRecord[];
  followUpInstructions?: FollowUpInstruction[];
  healthTraces?: HealthScoreTrace[];
  staleTimelineAfterDays?: number;
  staleProjectionAfterHours?: number;
}

export interface RelationshipFeedProjectionInput extends RelationshipReadModelInput {
  feedKind: RelationshipFeedKind;
  operatorId?: OperatorId;
}

export interface RelationshipQueueProjectionInput extends RelationshipReadModelInput {
  queueKind: RelationshipQueueKind;
}

export interface RelationshipTimelineProjectionInput extends RelationshipReadModelInput {
  relationshipId: RelationshipId;
}

export interface RelationshipReadModelRelationshipState {
  relationshipId: RelationshipId;
  displayName: string;
  lifecycle: LifecycleState;
  warmth: RelationshipSummaryProjection["warmthState"];
  healthScore?: number;
  healthConfidence: ConfidenceLevel;
  summaryGeneratedAt: IsoDateString;
}

export interface RelationshipReadModelOwnerVisibility {
  ownerId?: OperatorId;
  visibleTo: OperatorId[];
  unassigned: boolean;
  latestAssignmentEventId?: TimelineEventId;
  confidence: ConfidenceLevel;
}

export interface RelationshipReadModelLifecycleContext {
  state: LifecycleState;
  terminal: boolean;
  queueEligible: boolean;
  explanation: string;
}

export interface RelationshipFeedItem {
  id: string;
  feedKind: RelationshipFeedKind;
  relationshipId: RelationshipId;
  occurredAt: IsoDateString;
  recordedAt?: IsoDateString;
  title: string;
  body: string;
  category:
    | "activity"
    | "momentum"
    | "overdue"
    | "change"
    | "promise"
    | "follow_up"
    | "health";
  relationshipState: RelationshipReadModelRelationshipState;
  lifecycleContext: RelationshipReadModelLifecycleContext;
  ownerVisibility: RelationshipReadModelOwnerVisibility;
  latestEvidence: RelationshipProjectionEvidencePointer[];
  timelineReferences: TimelineEventId[];
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
}

export interface RelationshipFeedProjection {
  kind: "relationship_feed";
  feedKind: RelationshipFeedKind;
  generatedAt: IsoDateString;
  items: RelationshipFeedItem[];
  ordering: RelationshipReadModelOrdering;
  explanation: RelationshipReadModelExplanation;
  validation: RelationshipReadModelValidationResult;
}

export interface QueueItemReason {
  code:
    | "overdue_follow_up"
    | "overdue_promise"
    | "stale_activity"
    | "missing_owner"
    | "retention_risk_lifecycle"
    | "retention_risk_trace"
    | "warm_opportunity_lifecycle"
    | "warm_opportunity_outcome"
    | "reactivation_lifecycle"
    | "dormant_lifecycle";
  label: string;
  explanation: string;
  dueAt?: IsoDateString;
  timelineEventIds: TimelineEventId[];
  promiseIds: PromiseId[];
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface RelationshipQueueItem {
  id: string;
  queueKind: RelationshipQueueKind;
  rank: number;
  rankKey: string;
  relationshipId: RelationshipId;
  generatedAt: IsoDateString;
  whyItExists: string;
  latestEvidence: RelationshipProjectionEvidencePointer[];
  relationshipState: RelationshipReadModelRelationshipState;
  timelineReferences: TimelineEventId[];
  confidence: ConfidenceLevel;
  missingDataEffects: RelationshipProjectionMissingData[];
  ownerVisibility: RelationshipReadModelOwnerVisibility;
  lifecycleContext: RelationshipReadModelLifecycleContext;
  reasons: QueueItemReason[];
  integrityFindings: RelationshipReadModelIssue[];
}

export interface RelationshipQueueProjection {
  kind: "relationship_queue";
  queueKind: RelationshipQueueKind;
  generatedAt: IsoDateString;
  items: RelationshipQueueItem[];
  ordering: RelationshipReadModelOrdering;
  explanation: RelationshipReadModelExplanation;
  validation: RelationshipReadModelValidationResult;
}

export interface RelationshipTimelineItem {
  id: string;
  groupKind: RelationshipTimelineGroupKind;
  relationshipId: RelationshipId;
  occurredAt: IsoDateString;
  recordedAt?: IsoDateString;
  title: string;
  body: string;
  timelineEventId?: TimelineEventId;
  promiseId?: PromiseId;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface RelationshipTimelineGroup {
  groupKind: RelationshipTimelineGroupKind;
  label: string;
  items: RelationshipTimelineItem[];
}

export interface RelationshipTimelineProjection {
  kind: "relationship_timeline";
  relationshipId: RelationshipId;
  generatedAt: IsoDateString;
  relationshipState: RelationshipReadModelRelationshipState;
  ownerVisibility: RelationshipReadModelOwnerVisibility;
  lifecycleContext: RelationshipReadModelLifecycleContext;
  groups: RelationshipTimelineGroup[];
  latestEvidence: RelationshipProjectionEvidencePointer[];
  missingDataEffects: RelationshipProjectionMissingData[];
  ordering: RelationshipReadModelOrdering;
  explanation: RelationshipReadModelExplanation;
  validation: RelationshipReadModelValidationResult;
}

export const RELATIONSHIP_OPERATOR_READ_MODEL_BOUNDARY: RelationshipReadModelBoundaryPolicy = {
  allowedInputs: [
    "RelationshipSummaryProjection",
    "TimelineEvent",
    "PromiseRecord",
    "HealthScoreTrace",
    "FollowUpInstruction",
  ],
  readOnly: true,
  deterministic: true,
  persistsProjection: false,
  mutatesRepositories: false,
  dispatchesQueue: false,
  sendsNotifications: false,
  computesProductionScore: false,
  consumesUiState: false,
  writesNeon: false,
};

export const RELATIONSHIP_FEED_ORDERING: RelationshipReadModelOrdering = {
  strategy: "deterministic_read_model_v0",
  productionScoring: false,
  sortKeys: ["occurredAt desc", "recordedAt desc", "relationshipId asc", "id asc"],
  tieBreakers: ["relationshipId", "timelineEventId", "promiseId", "item id"],
};

export const RELATIONSHIP_QUEUE_ORDERING: RelationshipReadModelOrdering = {
  strategy: "deterministic_read_model_v0",
  productionScoring: false,
  sortKeys: ["reason tier asc", "dueAt asc", "activity age desc", "confidence asc"],
  tieBreakers: ["relationshipId", "timeline references", "promise references", "item id"],
};

export const RELATIONSHIP_TIMELINE_ORDERING: RelationshipReadModelOrdering = {
  strategy: "deterministic_read_model_v0",
  productionScoring: false,
  sortKeys: ["group order asc", "occurredAt desc", "recordedAt desc"],
  tieBreakers: ["timelineEventId", "promiseId", "item id"],
};

export function projectRelationshipFeed(input: RelationshipFeedProjectionInput): RelationshipFeedProjection {
  const context = normalizeInput(input);
  const items = buildFeedItems(context, input.feedKind, input.operatorId).sort(compareFeedItems);
  const projection: RelationshipFeedProjection = {
    kind: "relationship_feed",
    feedKind: input.feedKind,
    generatedAt: input.context.now,
    items,
    ordering: RELATIONSHIP_FEED_ORDERING,
    explanation: explanation("relationship_feed_read_model", input.context.now),
    validation: { ok: true, issues: [] },
  };
  return {
    ...projection,
    validation: validateRelationshipFeedProjection(projection, context),
  };
}

export function projectAllRelationshipFeeds(
  input: RelationshipReadModelInput,
  options: { operatorId?: OperatorId } = {},
): Record<RelationshipFeedKind, RelationshipFeedProjection> {
  return {
    relationship_activity: projectRelationshipFeed({ ...input, feedKind: "relationship_activity" }),
    operator_relationship: projectRelationshipFeed({
      ...input,
      feedKind: "operator_relationship",
      ...(options.operatorId ? { operatorId: options.operatorId } : {}),
    }),
    relationship_momentum: projectRelationshipFeed({ ...input, feedKind: "relationship_momentum" }),
    overdue_relationship: projectRelationshipFeed({ ...input, feedKind: "overdue_relationship" }),
    relationship_change: projectRelationshipFeed({ ...input, feedKind: "relationship_change" }),
  };
}

export function projectRelationshipQueue(input: RelationshipQueueProjectionInput): RelationshipQueueProjection {
  const context = normalizeInput(input);
  const candidates = context.summaries
    .flatMap((summary) => buildQueueItem(context, summary, input.queueKind))
    .sort(compareQueueItems)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const projection: RelationshipQueueProjection = {
    kind: "relationship_queue",
    queueKind: input.queueKind,
    generatedAt: input.context.now,
    items: candidates,
    ordering: RELATIONSHIP_QUEUE_ORDERING,
    explanation: explanation("relationship_queue_read_model", input.context.now),
    validation: { ok: true, issues: [] },
  };
  return {
    ...projection,
    validation: validateRelationshipQueueProjection(projection, context),
  };
}

export function projectAllRelationshipQueues(
  input: RelationshipReadModelInput,
): Record<RelationshipQueueKind, RelationshipQueueProjection> {
  return {
    needs_attention: projectRelationshipQueue({ ...input, queueKind: "needs_attention" }),
    overdue_follow_ups: projectRelationshipQueue({ ...input, queueKind: "overdue_follow_ups" }),
    cooling_relationships: projectRelationshipQueue({ ...input, queueKind: "cooling_relationships" }),
    retention_risk: projectRelationshipQueue({ ...input, queueKind: "retention_risk" }),
    warm_opportunities: projectRelationshipQueue({ ...input, queueKind: "warm_opportunities" }),
    reactivation_candidates: projectRelationshipQueue({ ...input, queueKind: "reactivation_candidates" }),
  };
}

export function projectRelationshipTimeline(input: RelationshipTimelineProjectionInput): RelationshipTimelineProjection {
  const context = normalizeInput(input);
  const summary = context.summaryById.get(input.relationshipId);
  if (!summary) {
    throw new Error(`Cannot project relationship timeline without summary ${input.relationshipId}.`);
  }
  const groups = buildTimelineGroups(context, summary);
  const projection: RelationshipTimelineProjection = {
    kind: "relationship_timeline",
    relationshipId: input.relationshipId,
    generatedAt: input.context.now,
    relationshipState: relationshipState(summary),
    ownerVisibility: ownerVisibility(summary),
    lifecycleContext: lifecycleContext(summary.lifecycleState),
    groups,
    latestEvidence: summary.explanation.latestEvidence,
    missingDataEffects: summary.explanation.missingDataEffects,
    ordering: RELATIONSHIP_TIMELINE_ORDERING,
    explanation: explanation("relationship_timeline_read_model", input.context.now),
    validation: { ok: true, issues: [] },
  };
  return {
    ...projection,
    validation: validateRelationshipTimelineProjection(projection, context),
  };
}

export function validateRelationshipQueueProjection(
  projection: RelationshipQueueProjection,
  context: NormalizedRelationshipReadModelContext,
): RelationshipReadModelValidationResult {
  const issues: RelationshipReadModelIssue[] = [];
  if (projection.kind !== "relationship_queue") {
    issues.push(error("invalid_queue_projection_kind", "Queue projection has an invalid kind."));
  }
  for (const item of projection.items) {
    if (item.queueKind !== projection.queueKind) {
      issues.push(error("queue_kind_mismatch", "Queue item kind must match projection kind.", item));
    }
    if (!context.summaryById.has(item.relationshipId)) {
      issues.push(error("unknown_relationship_reference", "Queue item references an unknown relationship summary.", item));
    }
    if (item.latestEvidence.length === 0 || item.latestEvidence.every((pointer) => pointer.evidence.length === 0)) {
      issues.push(error("queue_item_missing_evidence", "Queue item must expose evidence for why it exists.", item));
    }
    if (item.ownerVisibility.visibleTo.length === 0) {
      issues.push(warning("queue_item_not_visible", "Queue item has no visible owner; consumers must not infer one.", item));
    }
    if (item.lifecycleContext.terminal) {
      issues.push(error("terminal_relationship_queued", "Terminal relationships must not emit active queue read-model items.", item));
    }
    for (const reference of item.timelineReferences) {
      if (!context.timelineEventIds.has(reference)) {
        issues.push(error("unknown_queue_timeline_reference", `Queue item references missing timeline event ${reference}.`, item, reference));
      }
    }
    if (isProjectionStale(item.relationshipState.summaryGeneratedAt, context.now, context.staleProjectionAfterHours)) {
      issues.push(warning("stale_relationship_summary_projection", "Queue item was built from an old relationship summary projection.", item));
    }
    issues.push(...item.integrityFindings);
  }
  return result(issues);
}

export function validateRelationshipFeedProjection(
  projection: RelationshipFeedProjection,
  context: NormalizedRelationshipReadModelContext,
): RelationshipReadModelValidationResult {
  const issues: RelationshipReadModelIssue[] = [];
  if (projection.kind !== "relationship_feed") {
    issues.push(error("invalid_feed_projection_kind", "Feed projection has an invalid kind."));
  }
  for (const item of projection.items) {
    if (!context.summaryById.has(item.relationshipId)) {
      issues.push(error("unknown_feed_relationship_reference", "Feed item references an unknown relationship summary.", item));
    }
    for (const reference of item.timelineReferences) {
      if (!context.timelineEventIds.has(reference)) {
        issues.push(error("unknown_feed_timeline_reference", `Feed item references missing timeline event ${reference}.`, item, reference));
      }
    }
  }
  return result(issues);
}

export function validateRelationshipTimelineProjection(
  projection: RelationshipTimelineProjection,
  context: NormalizedRelationshipReadModelContext,
): RelationshipReadModelValidationResult {
  const issues: RelationshipReadModelIssue[] = [];
  if (projection.kind !== "relationship_timeline") {
    issues.push(error("invalid_timeline_projection_kind", "Timeline projection has an invalid kind."));
  }
  if (!context.summaryById.has(projection.relationshipId)) {
    issues.push(error("unknown_timeline_relationship_reference", "Timeline projection references an unknown relationship summary."));
  }
  for (const group of projection.groups) {
    for (const item of group.items) {
      if (item.timelineEventId && !context.timelineEventIds.has(item.timelineEventId)) {
        issues.push(error("unknown_timeline_item_reference", `Timeline item references missing event ${item.timelineEventId}.`, undefined, item.timelineEventId));
      }
    }
  }
  return result(issues);
}

interface NormalizedRelationshipReadModelContext {
  now: IsoDateString;
  summaries: RelationshipSummaryProjection[];
  summaryById: Map<RelationshipId, RelationshipSummaryProjection>;
  timelineEvents: TimelineEvent[];
  timelineEventIds: Set<TimelineEventId>;
  timelineByRelationshipId: Map<RelationshipId, TimelineEvent[]>;
  promisesByRelationshipId: Map<RelationshipId, PromiseRecord[]>;
  followUpsByRelationshipId: Map<RelationshipId, FollowUpInstruction[]>;
  healthTraceByRelationshipId: Map<RelationshipId, HealthScoreTrace>;
  staleTimelineAfterDays: number;
  staleProjectionAfterHours: number;
}

function normalizeInput(input: RelationshipReadModelInput): NormalizedRelationshipReadModelContext {
  const summaries = input.summaries.slice().sort((a, b) => compareStrings(a.relationshipId, b.relationshipId));
  const relationshipIds = new Set(summaries.map((summary) => summary.relationshipId));
  const timelineEvents = uniqueTimelineEvents(sortProjectionTimelineEvents(input.timelineEvents ?? []))
    .filter((event) => relationshipIds.has(event.relationshipId));
  const promises = sortProjectionPromises(input.promises ?? [])
    .filter((promise) => relationshipIds.has(promise.relationshipId));
  const followUps = sortProjectionFollowUps(input.followUpInstructions ?? [])
    .filter((followUp) => relationshipIds.has(followUp.relationshipId));
  const healthTraces = (input.healthTraces ?? [])
    .filter((trace) => relationshipIds.has(trace.relationshipId))
    .sort((a, b) => compareStrings(a.computedAt, b.computedAt) || compareStrings(a.id, b.id));

  return {
    now: input.context.now,
    summaries,
    summaryById: groupOne(summaries, (summary) => summary.relationshipId),
    timelineEvents,
    timelineEventIds: new Set(timelineEvents.map((event) => event.id)),
    timelineByRelationshipId: groupMany(timelineEvents, (event) => event.relationshipId),
    promisesByRelationshipId: groupMany(promises, (promise) => promise.relationshipId),
    followUpsByRelationshipId: groupMany(followUps, (followUp) => followUp.relationshipId),
    healthTraceByRelationshipId: groupOne(healthTraces, (trace) => trace.relationshipId),
    staleTimelineAfterDays: input.staleTimelineAfterDays ?? DEFAULT_STALE_TIMELINE_AFTER_DAYS,
    staleProjectionAfterHours: input.staleProjectionAfterHours ?? 24,
  };
}

function buildFeedItems(
  context: NormalizedRelationshipReadModelContext,
  feedKind: RelationshipFeedKind,
  operatorId?: OperatorId,
): RelationshipFeedItem[] {
  switch (feedKind) {
    case "relationship_activity":
      return context.timelineEvents.flatMap((event) => feedItemFromTimelineEvent(context, event, feedKind));
    case "operator_relationship":
      return context.timelineEvents
        .filter((event) => {
          const summary = context.summaryById.get(event.relationshipId);
          if (!summary) return false;
          return !operatorId || summary.ownerVisibility.visibleTo.includes(operatorId);
        })
        .flatMap((event) => feedItemFromTimelineEvent(context, event, feedKind));
    case "relationship_momentum":
      return context.summaries.flatMap((summary) => summary.momentumHints.map((hint) => feedItemFromMomentumHint(summary, hint)));
    case "overdue_relationship":
      return context.summaries.flatMap((summary) => feedItemsFromOverdueState(context, summary));
    case "relationship_change":
      return context.timelineEvents
        .filter((event) => ["lifecycle", "owner_assignment", "outcome", "promise", "system"].includes(event.category))
        .flatMap((event) => feedItemFromTimelineEvent(context, event, feedKind));
  }
}

function feedItemFromTimelineEvent(
  context: NormalizedRelationshipReadModelContext,
  event: TimelineEvent,
  feedKind: RelationshipFeedKind,
): RelationshipFeedItem[] {
  const summary = context.summaryById.get(event.relationshipId);
  if (!summary) return [];
  return [{
    id: stableId(["feed", feedKind, event.id]),
    feedKind,
    relationshipId: event.relationshipId,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    title: timelineTitle(event),
    body: timelineBody(event),
    category: feedCategory(event),
    relationshipState: relationshipState(summary),
    lifecycleContext: lifecycleContext(summary.lifecycleState),
    ownerVisibility: ownerVisibility(summary),
    latestEvidence: latestEvidenceForTimeline(summary, event.id),
    timelineReferences: [event.id],
    confidence: event.confidence,
    missingDataEffects: summary.explanation.missingDataEffects,
  }];
}

function feedItemFromMomentumHint(
  summary: RelationshipSummaryProjection,
  hint: RelationshipSummaryProjection["momentumHints"][number],
): RelationshipFeedItem {
  const occurredAt = latestEvidenceDate(hint.evidence) ?? summary.latestRelationshipActivity?.occurredAt ?? summary.generatedAt;
  return {
    id: stableId(["feed", "relationship_momentum", summary.relationshipId, hint.kind, hint.timelineEventIds.join(",")]),
    feedKind: "relationship_momentum",
    relationshipId: summary.relationshipId,
    occurredAt,
    title: hint.label,
    body: hint.explanation,
    category: "momentum",
    relationshipState: relationshipState(summary),
    lifecycleContext: lifecycleContext(summary.lifecycleState),
    ownerVisibility: ownerVisibility(summary),
    latestEvidence: latestEvidenceForTimeline(summary, hint.timelineEventIds[0]),
    timelineReferences: hint.timelineEventIds,
    confidence: hint.confidence,
    missingDataEffects: summary.explanation.missingDataEffects,
  };
}

function feedItemsFromOverdueState(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
): RelationshipFeedItem[] {
  const overduePromises = summary.openPromises.filter((promise) => promise.overdue);
  const followUps = summary.overdueFollowUps;
  return [
    ...overduePromises.map((promise): RelationshipFeedItem => ({
      id: stableId(["feed", "overdue_relationship", summary.relationshipId, promise.promiseId]),
      feedKind: "overdue_relationship",
      relationshipId: summary.relationshipId,
      occurredAt: promise.dueAt ?? context.now,
      title: "Overdue promise",
      body: promise.title,
      category: "promise",
      relationshipState: relationshipState(summary),
      lifecycleContext: lifecycleContext(summary.lifecycleState),
      ownerVisibility: ownerVisibility(summary),
      latestEvidence: evidencePointersFromEvidence(summary, promise.evidence, promise.confidence, `Overdue promise: ${promise.title}.`),
      timelineReferences: [],
      confidence: promise.confidence,
      missingDataEffects: summary.explanation.missingDataEffects,
    })),
    ...followUps.map((followUp): RelationshipFeedItem => ({
      id: stableId(["feed", "overdue_relationship", summary.relationshipId, followUp.dueAt, followUp.reason, followUp.source]),
      feedKind: "overdue_relationship",
      relationshipId: summary.relationshipId,
      occurredAt: followUp.dueAt,
      title: "Overdue follow-up",
      body: followUp.reason,
      category: "follow_up",
      relationshipState: relationshipState(summary),
      lifecycleContext: lifecycleContext(summary.lifecycleState),
      ownerVisibility: ownerVisibility(summary),
      latestEvidence: evidencePointersFromEvidence(summary, followUp.evidence, followUp.confidence, `Overdue follow-up: ${followUp.reason}.`),
      timelineReferences: [],
      confidence: followUp.confidence,
      missingDataEffects: summary.explanation.missingDataEffects,
    })),
  ];
}

function buildQueueItem(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
  queueKind: RelationshipQueueKind,
): RelationshipQueueItem[] {
  if (TERMINAL_LIFECYCLE_STATES.includes(summary.lifecycleState)) return [];
  const reasons = reasonsForQueue(context, summary, queueKind);
  if (reasons.length === 0) return [];
  const timelineReferences = uniqueStrings(reasons.flatMap((reason) => reason.timelineEventIds)) as TimelineEventId[];
  const latestEvidence = latestQueueEvidence(summary, reasons);
  const item: RelationshipQueueItem = {
    id: stableId([
      "queue",
      queueKind,
      summary.relationshipId,
      reasons.map((reason) => reason.code).join(","),
      timelineReferences.join(","),
      reasons.flatMap((reason) => reason.promiseIds).join(","),
    ]),
    queueKind,
    rank: 0,
    rankKey: queueRankKey(context, summary, reasons),
    relationshipId: summary.relationshipId,
    generatedAt: context.now,
    whyItExists: reasons.map((reason) => reason.explanation).join(" "),
    latestEvidence,
    relationshipState: relationshipState(summary),
    timelineReferences,
    confidence: combineConfidence([
      summary.explanation.confidence,
      ...reasons.map((reason) => reason.confidence),
    ]),
    missingDataEffects: summary.explanation.missingDataEffects,
    ownerVisibility: ownerVisibility(summary),
    lifecycleContext: lifecycleContext(summary.lifecycleState),
    reasons,
    integrityFindings: queueIntegrityFindings(summary, queueKind, reasons, latestEvidence),
  };
  return [item];
}

function reasonsForQueue(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
  queueKind: RelationshipQueueKind,
): QueueItemReason[] {
  const overdueFollowUps = summary.overdueFollowUps.map((followUp): QueueItemReason => ({
    code: "overdue_follow_up",
    label: "Overdue follow-up",
    explanation: `Follow-up is overdue: ${followUp.reason}.`,
    dueAt: followUp.dueAt,
    timelineEventIds: [],
    promiseIds: [],
    evidence: followUp.evidence,
    confidence: followUp.confidence,
  }));
  const overduePromises = summary.openPromises
    .filter((promise) => promise.overdue)
    .map((promise): QueueItemReason => ({
      code: "overdue_promise",
      label: "Overdue promise",
      explanation: `Open promise is overdue: ${promise.title}.`,
      dueAt: promise.dueAt,
      timelineEventIds: [],
      promiseIds: [promise.promiseId],
      evidence: promise.evidence,
      confidence: promise.confidence,
    }));
  const staleActivity = staleActivityReason(context, summary);
  const missingOwner = summary.ownerVisibility.unassigned ? [{
    code: "missing_owner" as const,
    label: "Missing owner",
    explanation: "No canonical owner visibility exists for this relationship.",
    timelineEventIds: summary.ownerVisibility.latestAssignmentEventId ? [summary.ownerVisibility.latestAssignmentEventId] : [],
    promiseIds: [],
    evidence: summary.ownerVisibility.evidence,
    confidence: summary.ownerVisibility.confidence,
  }] : [];
  const retentionRisk = retentionRiskReasons(context, summary);
  const warmOpportunity = warmOpportunityReasons(summary);
  const reactivation = reactivationReasons(context, summary);

  switch (queueKind) {
    case "needs_attention":
      return [
        ...overdueFollowUps,
        ...overduePromises,
        ...(staleActivity ? [staleActivity] : []),
        ...missingOwner,
        ...retentionRisk,
      ].sort(compareReasons);
    case "overdue_follow_ups":
      return [...overdueFollowUps, ...overduePromises].sort(compareReasons);
    case "cooling_relationships":
      return staleActivity ? [staleActivity] : [];
    case "retention_risk":
      return retentionRisk.sort(compareReasons);
    case "warm_opportunities":
      return warmOpportunity.sort(compareReasons);
    case "reactivation_candidates":
      return reactivation.sort(compareReasons);
  }
}

function staleActivityReason(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
): QueueItemReason | undefined {
  const latest = summary.latestRelationshipActivity;
  if (!latest || !isOlderThanDays(latest.occurredAt, context.now, context.staleTimelineAfterDays)) return undefined;
  return {
    code: "stale_activity",
    label: "Cooling relationship",
    explanation: `Latest relationship activity is older than ${context.staleTimelineAfterDays} days.`,
    timelineEventIds: [latest.timelineEventId],
    promiseIds: [],
    evidence: latest.evidence,
    confidence: latest.confidence,
  };
}

function retentionRiskReasons(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
): QueueItemReason[] {
  const reasons: QueueItemReason[] = [];
  if (summary.lifecycleState === LIFECYCLE_STATE.RETENTION_RISK) {
    reasons.push({
      code: "retention_risk_lifecycle",
      label: "Retention risk lifecycle",
      explanation: "Relationship lifecycle is RETENTION_RISK.",
      timelineEventIds: summary.explanation.timelineReferences,
      promiseIds: [],
      evidence: summary.latestRelationshipActivity?.evidence ?? summary.ownerVisibility.evidence,
      confidence: summary.latestRelationshipActivity?.confidence ?? summary.explanation.confidence,
    });
  }
  const trace = context.healthTraceByRelationshipId.get(summary.relationshipId);
  const riskComponent = trace?.components.find((component) => component.key === "risk" && component.status === "observed");
  if (riskComponent) {
    reasons.push({
      code: "retention_risk_trace",
      label: "Risk trace observed",
      explanation: riskComponent.explanation,
      timelineEventIds: trace?.inputTimelineEventIds ?? [],
      promiseIds: [],
      evidence: riskComponent.evidence,
      confidence: riskComponent.confidence,
    });
  }
  return reasons;
}

function warmOpportunityReasons(summary: RelationshipSummaryProjection): QueueItemReason[] {
  const reasons: QueueItemReason[] = [];
  if (summary.lifecycleState === LIFECYCLE_STATE.OPPORTUNITY) {
    reasons.push({
      code: "warm_opportunity_lifecycle",
      label: "Opportunity lifecycle",
      explanation: "Relationship lifecycle is OPPORTUNITY.",
      timelineEventIds: summary.explanation.timelineReferences,
      promiseIds: [],
      evidence: summary.latestRelationshipActivity?.evidence ?? [],
      confidence: summary.latestRelationshipActivity?.confidence ?? summary.explanation.confidence,
    });
  }
  const positiveOutcome = summary.momentumHints.find((hint) => hint.kind === "recent_positive_outcome");
  if (positiveOutcome && ["warm", "hot"].includes(summary.warmthState)) {
    reasons.push({
      code: "warm_opportunity_outcome",
      label: "Warm positive outcome",
      explanation: positiveOutcome.explanation,
      timelineEventIds: positiveOutcome.timelineEventIds,
      promiseIds: [],
      evidence: positiveOutcome.evidence,
      confidence: positiveOutcome.confidence,
    });
  }
  return reasons;
}

function reactivationReasons(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
): QueueItemReason[] {
  const reactivationStates: LifecycleState[] = [LIFECYCLE_STATE.DORMANT, LIFECYCLE_STATE.REACTIVATION];
  if (!reactivationStates.includes(summary.lifecycleState)) return [];
  const stale = staleActivityReason(context, summary);
  return [{
    code: summary.lifecycleState === LIFECYCLE_STATE.REACTIVATION ? "reactivation_lifecycle" : "dormant_lifecycle",
    label: summary.lifecycleState === LIFECYCLE_STATE.REACTIVATION ? "Reactivation lifecycle" : "Dormant relationship",
    explanation: `Relationship lifecycle is ${summary.lifecycleState}; projection is read-only and does not start outreach.`,
    timelineEventIds: stale?.timelineEventIds ?? summary.explanation.timelineReferences,
    promiseIds: [],
    evidence: stale?.evidence ?? summary.latestRelationshipActivity?.evidence ?? [],
    confidence: stale?.confidence ?? summary.explanation.confidence,
  }];
}

function buildTimelineGroups(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
): RelationshipTimelineGroup[] {
  const events = context.timelineByRelationshipId.get(summary.relationshipId) ?? [];
  const promises = context.promisesByRelationshipId.get(summary.relationshipId) ?? [];
  const groups: RelationshipTimelineGroup[] = [
    timelineGroup("grouped_activity", "Grouped activity", events
      .filter((event) => ["touchpoint", "referral", "system"].includes(event.category))
      .map((event) => timelineItemFromEvent(event, "grouped_activity"))),
    timelineGroup("promises", "Promises", [
      ...events.filter((event) => event.category === "promise").map((event) => timelineItemFromEvent(event, "promises")),
      ...promises.map(timelineItemFromPromise),
    ]),
    timelineGroup("lifecycle_changes", "Lifecycle changes", events
      .filter((event) => event.category === "lifecycle")
      .map((event) => timelineItemFromEvent(event, "lifecycle_changes"))),
    timelineGroup("outcomes", "Outcomes", events
      .filter((event) => event.category === "outcome")
      .map((event) => timelineItemFromEvent(event, "outcomes"))),
    timelineGroup("follow_ups", "Follow-ups", events
      .filter((event) => event.category === "follow_up")
      .map((event) => timelineItemFromEvent(event, "follow_ups"))),
    timelineGroup("ownership_changes", "Ownership changes", events
      .filter((event) => event.category === "owner_assignment")
      .map((event) => timelineItemFromEvent(event, "ownership_changes"))),
    timelineGroup("relationship_momentum", "Relationship momentum", summary.momentumHints.map((hint): RelationshipTimelineItem => ({
      id: stableId(["timeline", "momentum", summary.relationshipId, hint.kind, hint.timelineEventIds.join(",")]),
      groupKind: "relationship_momentum",
      relationshipId: summary.relationshipId,
      occurredAt: latestEvidenceDate(hint.evidence) ?? summary.latestRelationshipActivity?.occurredAt ?? summary.generatedAt,
      title: hint.label,
      body: hint.explanation,
      timelineEventId: hint.timelineEventIds[0],
      evidence: sortProjectionEvidence(hint.evidence),
      confidence: hint.confidence,
    }))),
  ];
  return groups.map((group) => ({
    ...group,
    items: group.items.sort(compareTimelineItems),
  }));
}

function timelineGroup(
  groupKind: RelationshipTimelineGroupKind,
  label: string,
  items: RelationshipTimelineItem[],
): RelationshipTimelineGroup {
  return { groupKind, label, items };
}

function timelineItemFromEvent(event: TimelineEvent, groupKind: RelationshipTimelineGroupKind): RelationshipTimelineItem {
  return {
    id: stableId(["timeline", groupKind, event.id]),
    groupKind,
    relationshipId: event.relationshipId,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    title: timelineTitle(event),
    body: timelineBody(event),
    timelineEventId: event.id,
    evidence: sortProjectionEvidence(event.evidence),
    confidence: event.confidence,
  };
}

function timelineItemFromPromise(promise: PromiseRecord): RelationshipTimelineItem {
  return {
    id: stableId(["timeline", "promise-record", promise.id]),
    groupKind: "promises",
    relationshipId: promise.relationshipId,
    occurredAt: promise.dueAt ?? promise.createdAt,
    title: `Promise ${promise.status}`,
    body: promise.title,
    promiseId: promise.id,
    evidence: sortProjectionEvidence(promise.evidence),
    confidence: promise.confidence,
  };
}

function queueIntegrityFindings(
  summary: RelationshipSummaryProjection,
  queueKind: RelationshipQueueKind,
  reasons: QueueItemReason[],
  latestEvidence: RelationshipProjectionEvidencePointer[],
): RelationshipReadModelIssue[] {
  const issues: RelationshipReadModelIssue[] = [];
  if (latestEvidence.length === 0 || latestEvidence.every((pointer) => pointer.evidence.length === 0)) {
    issues.push(error("queue_item_missing_evidence", "Queue item reason did not carry evidence.", {
      relationshipId: summary.relationshipId,
      queueKind,
    }));
  }
  if (summary.ownerVisibility.visibleTo.length === 0) {
    issues.push(warning("queue_item_missing_owner_visibility", "Queue item has no owner visibility.", {
      relationshipId: summary.relationshipId,
      queueKind,
    }));
  }
  if (reasons.some((reason) => reason.code === "missing_owner") && summary.ownerVisibility.evidence.length === 0) {
    issues.push(warning("missing_owner_has_no_assignment_evidence", "Missing owner was explained by canonical assignment state, but no assignment event evidence exists.", {
      relationshipId: summary.relationshipId,
      queueKind,
    }));
  }
  return issues;
}

function relationshipState(summary: RelationshipSummaryProjection): RelationshipReadModelRelationshipState {
  return {
    relationshipId: summary.relationshipId,
    displayName: summary.summary.displayName,
    lifecycle: summary.lifecycleState,
    warmth: summary.warmthState,
    ...(summary.summary.healthScore === undefined ? {} : { healthScore: summary.summary.healthScore }),
    healthConfidence: summary.summary.healthConfidence,
    summaryGeneratedAt: summary.generatedAt,
  };
}

function ownerVisibility(summary: RelationshipSummaryProjection): RelationshipReadModelOwnerVisibility {
  return {
    ...(summary.ownerVisibility.primaryOwnerId ? { ownerId: summary.ownerVisibility.primaryOwnerId } : {}),
    visibleTo: summary.ownerVisibility.visibleTo,
    unassigned: summary.ownerVisibility.unassigned,
    ...(summary.ownerVisibility.latestAssignmentEventId ? { latestAssignmentEventId: summary.ownerVisibility.latestAssignmentEventId } : {}),
    confidence: summary.ownerVisibility.confidence,
  };
}

function lifecycleContext(state: LifecycleState): RelationshipReadModelLifecycleContext {
  const terminal = TERMINAL_LIFECYCLE_STATES.includes(state);
  return {
    state,
    terminal,
    queueEligible: !terminal,
    explanation: terminal
      ? "Terminal lifecycle state is not eligible for active queue read models."
      : "Lifecycle state may be displayed by read models but does not trigger automation.",
  };
}

function latestEvidenceForTimeline(
  summary: RelationshipSummaryProjection,
  timelineEventId?: TimelineEventId,
): RelationshipProjectionEvidencePointer[] {
  if (!timelineEventId) return summary.explanation.latestEvidence.slice(0, 3);
  const matches = summary.explanation.latestEvidence.filter((pointer) => pointer.timelineEventId === timelineEventId);
  return matches.length > 0 ? matches : summary.explanation.latestEvidence.slice(0, 1);
}

function latestQueueEvidence(
  summary: RelationshipSummaryProjection,
  reasons: QueueItemReason[],
): RelationshipProjectionEvidencePointer[] {
  const pointers = reasons.flatMap((reason) => evidencePointersFromEvidence(
    summary,
    reason.evidence,
    reason.confidence,
    reason.explanation,
    reason.timelineEventIds[0],
    reason.promiseIds[0],
    reason.dueAt,
  ));
  return pointers.length > 0 ? pointers : summary.explanation.latestEvidence.slice(0, 3);
}

function evidencePointersFromEvidence(
  summary: RelationshipSummaryProjection,
  evidence: EvidenceRef[],
  confidence: ConfidenceLevel,
  description: string,
  timelineEventId?: TimelineEventId,
  promiseId?: PromiseId,
  occurredAt?: IsoDateString,
): RelationshipProjectionEvidencePointer[] {
  if (evidence.length === 0) return [];
  return [{
    ...(timelineEventId ? { timelineEventId } : {}),
    ...(promiseId ? { promiseId } : {}),
    occurredAt: occurredAt ?? latestEvidenceDate(evidence) ?? summary.generatedAt,
    evidence: sortProjectionEvidence(evidence),
    confidence,
    description,
  }];
}

function timelineTitle(event: TimelineEvent): string {
  switch (event.category) {
    case "touchpoint":
      return `${event.touchpoint.channel} ${event.touchpoint.direction} touchpoint`;
    case "promise":
      return "Promise activity";
    case "lifecycle":
      return "Lifecycle changed";
    case "follow_up":
      return "Follow-up activity";
    case "referral":
      return "Referral activity";
    case "outcome":
      return "Outcome recorded";
    case "owner_assignment":
      return "Ownership changed";
    case "system":
      return "System relationship event";
  }
}

function timelineBody(event: TimelineEvent): string {
  switch (event.category) {
    case "touchpoint":
      return event.touchpoint.subject ?? event.type;
    case "promise":
      return event.summary;
    case "lifecycle":
      return `${event.from} -> ${event.to}: ${event.reason}`;
    case "follow_up":
      return event.reason;
    case "referral":
      return event.description;
    case "outcome":
      return event.outcome.label;
    case "owner_assignment":
      return event.reason;
    case "system":
      return event.type;
  }
}

function feedCategory(event: TimelineEvent): RelationshipFeedItem["category"] {
  switch (event.category) {
    case "promise":
      return "promise";
    case "follow_up":
      return "follow_up";
    case "lifecycle":
    case "owner_assignment":
    case "outcome":
    case "system":
      return "change";
    default:
      return "activity";
  }
}

function compareFeedItems(a: RelationshipFeedItem, b: RelationshipFeedItem): number {
  return compareStrings(b.occurredAt, a.occurredAt)
    || compareStrings(b.recordedAt ?? "", a.recordedAt ?? "")
    || compareStrings(a.relationshipId, b.relationshipId)
    || compareStrings(a.id, b.id);
}

function compareQueueItems(a: RelationshipQueueItem, b: RelationshipQueueItem): number {
  return compareStrings(a.rankKey, b.rankKey)
    || compareStrings(a.relationshipId, b.relationshipId)
    || compareStrings(a.id, b.id);
}

function compareTimelineItems(a: RelationshipTimelineItem, b: RelationshipTimelineItem): number {
  return compareStrings(b.occurredAt, a.occurredAt)
    || compareStrings(b.recordedAt ?? "", a.recordedAt ?? "")
    || compareStrings(a.timelineEventId ?? "", b.timelineEventId ?? "")
    || compareStrings(a.promiseId ?? "", b.promiseId ?? "")
    || compareStrings(a.id, b.id);
}

function compareReasons(a: QueueItemReason, b: QueueItemReason): number {
  return reasonRank(a.code) - reasonRank(b.code)
    || compareStrings(a.dueAt ?? "", b.dueAt ?? "")
    || compareStrings(a.label, b.label);
}

function queueRankKey(
  context: NormalizedRelationshipReadModelContext,
  summary: RelationshipSummaryProjection,
  reasons: QueueItemReason[],
): string {
  const primaryReason = reasons.slice().sort(compareReasons)[0];
  const dueAt = primaryReason?.dueAt ?? "9999-12-31T23:59:59.999Z";
  const activityAge = summary.latestRelationshipActivity
    ? String(daysBetween(summary.latestRelationshipActivity.occurredAt, context.now)).padStart(5, "0")
    : "00000";
  const confidence = confidenceRank(combineConfidence(reasons.map((reason) => reason.confidence)));
  return [
    String(reasonRank(primaryReason?.code ?? "stale_activity")).padStart(2, "0"),
    dueAt,
    String(99999 - Number(activityAge)).padStart(5, "0"),
    String(confidence).padStart(2, "0"),
    summary.relationshipId,
  ].join("|");
}

function reasonRank(code: QueueItemReason["code"]): number {
  switch (code) {
    case "overdue_follow_up":
      return 0;
    case "overdue_promise":
      return 1;
    case "retention_risk_lifecycle":
      return 2;
    case "retention_risk_trace":
      return 3;
    case "stale_activity":
      return 4;
    case "reactivation_lifecycle":
      return 5;
    case "dormant_lifecycle":
      return 6;
    case "warm_opportunity_lifecycle":
      return 7;
    case "warm_opportunity_outcome":
      return 8;
    case "missing_owner":
      return 9;
  }
}

function confidenceRank(value: ConfidenceLevel): number {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
    case "unknown":
      return 3;
  }
}

function combineConfidence(values: ConfidenceLevel[]): ConfidenceLevel {
  if (values.length === 0) return "unknown";
  return values.reduce((lowest, value) => (
    confidenceRank(value) > confidenceRank(lowest) ? value : lowest
  ), "high");
}

function uniqueTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const byId = new Map<TimelineEventId, TimelineEvent>();
  for (const event of events) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()];
}

function groupMany<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    map.set(key, [...(map.get(key) ?? []), item]);
  }
  return map;
}

function groupOne<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of items) {
    map.set(keyOf(item), item);
  }
  return map;
}

function explanation(
  generatedBy: RelationshipReadModelExplanation["generatedBy"],
  generatedAt: IsoDateString,
): RelationshipReadModelExplanation {
  return {
    generatedBy,
    generatedAt,
    inputSources: RELATIONSHIP_OPERATOR_READ_MODEL_BOUNDARY.allowedInputs,
    boundary: RELATIONSHIP_OPERATOR_READ_MODEL_BOUNDARY,
    notes: [
      "Read model is projection-only and must not mutate relationship, timeline, queue, score, or storage state.",
      "Queue ordering uses deterministic sort keys and tie-breakers only; no production scoring weights are applied.",
      "Missing data is exposed as confidence and visibility context, not hidden urgency.",
    ],
  };
}

function latestEvidenceDate(evidence: EvidenceRef[]): IsoDateString | undefined {
  return sortProjectionEvidence(evidence).at(-1)?.observedAt;
}

function isOlderThanDays(value: IsoDateString, now: IsoDateString, days: number): boolean {
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) return false;
  return nowMs - valueMs > days * 24 * 60 * 60 * 1000;
}

function daysBetween(value: IsoDateString, now: IsoDateString): number {
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - valueMs) / (24 * 60 * 60 * 1000)));
}

function isProjectionStale(value: IsoDateString, now: IsoDateString, hours: number): boolean {
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) return false;
  return nowMs - valueMs > hours * 60 * 60 * 1000;
}

function error(
  code: string,
  message: string,
  item?: { relationshipId?: RelationshipId; queueKind?: RelationshipQueueKind },
  timelineEventId?: TimelineEventId,
): RelationshipReadModelIssue {
  return {
    severity: "error",
    code,
    message,
    ...(item?.relationshipId ? { relationshipId: item.relationshipId } : {}),
    ...(item?.queueKind ? { queueKind: item.queueKind } : {}),
    ...(timelineEventId ? { timelineEventId } : {}),
  };
}

function warning(
  code: string,
  message: string,
  item?: { relationshipId?: RelationshipId; queueKind?: RelationshipQueueKind },
  timelineEventId?: TimelineEventId,
): RelationshipReadModelIssue {
  return {
    severity: "warning",
    code,
    message,
    ...(item?.relationshipId ? { relationshipId: item.relationshipId } : {}),
    ...(item?.queueKind ? { queueKind: item.queueKind } : {}),
    ...(timelineEventId ? { timelineEventId } : {}),
  };
}

function result(issues: RelationshipReadModelIssue[]): RelationshipReadModelValidationResult {
  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function stableId(parts: string[]): string {
  let value = 2166136261;
  for (const char of parts.join("|")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return `relationship-read-model:${(value >>> 0).toString(36)}`;
}
