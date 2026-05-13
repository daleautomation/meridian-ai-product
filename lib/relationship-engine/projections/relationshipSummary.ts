// Meridian Relationship Engine — canonical relationship summary projection.

import type { EngineContext, EvidenceRef, IsoDateString, TimelineEventId } from "../primitives";
import type { FollowUpInstruction, PromiseRecord } from "../followups/policies";
import type { RelationshipEntity, RelationshipSummary } from "../relationship/entities";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type {
  FollowUpTimelineEvent,
  OutcomeTimelineEvent,
  OwnerAssignmentTimelineEvent,
  TimelineEvent,
  TouchpointTimelineEvent,
} from "../timeline/events";
import type {
  LatestOutcomeProjection,
  LatestRelationshipActivityProjection,
  LatestTouchpointProjection,
  NextScheduledFollowUpProjection,
  OpenPromiseProjection,
  OverdueFollowUpProjection,
  OwnerVisibilityProjection,
  RelationshipMomentumHint,
  RelationshipProjectionEvidencePointer,
  RelationshipProjectionMissingData,
  RelationshipSummaryProjection,
} from "./dto";
import {
  DEFAULT_STALE_TIMELINE_AFTER_DAYS,
  validateRelationshipSummaryProjection,
} from "./validation";
import {
  isBeforeIso,
  latestByProjectionOrder,
  sortProjectionAssignments,
  sortProjectionEvidence,
  sortProjectionFollowUps,
  sortProjectionPromises,
  sortProjectionTimelineEvents,
  uniqueOperators,
  uniqueStrings,
} from "./ordering";

export interface ProjectRelationshipSummaryInput {
  context: EngineContext;
  relationship: RelationshipEntity;
  timelineEvents?: TimelineEvent[];
  promises?: PromiseRecord[];
  followUpInstructions?: FollowUpInstruction[];
  healthTrace?: HealthScoreTrace | null;
  staleTimelineAfterDays?: number;
}

export function projectRelationshipSummary(input: ProjectRelationshipSummaryInput): RelationshipSummaryProjection {
  const now = input.context.now;
  const timelineEvents = sortProjectionTimelineEvents(input.timelineEvents ?? []);
  const relationshipTimelineEvents = timelineEvents.filter((event) => event.relationshipId === input.relationship.id);
  const promises = sortProjectionPromises(
    (input.promises ?? []).filter((promise) => promise.relationshipId === input.relationship.id),
  );
  const followUpInstructions = sortProjectionFollowUps(
    (input.followUpInstructions ?? []).filter((instruction) => instruction.relationshipId === input.relationship.id),
  );
  const latestTouchpoint = projectLatestTouchpoint(relationshipTimelineEvents);
  const latestOutcome = projectLatestOutcome(relationshipTimelineEvents);
  const ownerVisibility = projectOwnerVisibility(input.relationship, relationshipTimelineEvents);
  const openPromises = projectOpenPromises(promises, now);
  const overdueFollowUps = projectOverdueFollowUps(followUpInstructions, now);
  const nextScheduledFollowUp = projectNextScheduledFollowUp(followUpInstructions, now);
  const latestRelationshipActivity = projectLatestRelationshipActivity(relationshipTimelineEvents);
  const missingDataEffects = projectMissingDataEffects({
    timelineEvents,
    relationshipTimelineEvents,
    promises: input.promises ?? [],
    relationshipPromises: promises,
    followUpInstructions: input.followUpInstructions ?? [],
    relationshipFollowUpInstructions: followUpInstructions,
    ownerVisibility,
    latestTouchpoint,
    latestOutcome,
    healthTrace: input.healthTrace ?? null,
  });
  const momentumHints = projectMomentumHints({
    latestTouchpoint,
    latestOutcome,
    latestRelationshipActivity,
    openPromises,
    overdueFollowUps,
    ownerVisibility,
    healthTrace: input.healthTrace ?? null,
    now,
    staleTimelineAfterDays: input.staleTimelineAfterDays ?? DEFAULT_STALE_TIMELINE_AFTER_DAYS,
  });
  const timelineReferences = uniqueStrings(
    relationshipTimelineEvents.map((event) => event.id),
  ) as TimelineEventId[];
  const latestEvidence = projectLatestEvidence({
    latestRelationshipActivity,
    latestTouchpoint,
    latestOutcome,
    ownerVisibility,
    openPromises,
    overdueFollowUps,
  });
  const projectionConfidence = combineConfidence([
    input.relationship.warmth.confidence,
    ownerVisibility.confidence,
    latestRelationshipActivity?.confidence,
    latestTouchpoint?.confidence,
    latestOutcome?.confidence,
    input.healthTrace?.confidence,
    ...openPromises.map((promise) => promise.confidence),
    ...overdueFollowUps.map((followUp) => followUp.confidence),
  ]);
  const summary: RelationshipSummary = {
    relationshipId: input.relationship.id,
    displayName: input.relationship.identity.displayName,
    lifecycle: input.relationship.lifecycle,
    warmth: input.relationship.warmth.band,
    ...(ownerVisibility.primaryOwnerId ? { ownerId: ownerVisibility.primaryOwnerId } : {}),
    ...(latestTouchpoint ? { lastTouchpointAt: latestTouchpoint.occurredAt } : {}),
    ...(nextScheduledFollowUp ? { nextFollowUpAt: nextScheduledFollowUp.dueAt } : {}),
    openPromiseCount: openPromises.length,
    overduePromiseCount: openPromises.filter((promise) => promise.overdue).length,
    ...(latestOutcome ? { latestOutcomeLabel: latestOutcome.label } : {}),
    ...(input.healthTrace ? { healthScore: input.healthTrace.score } : {}),
    healthConfidence: input.healthTrace?.confidence ?? "unknown",
    summaryGeneratedAt: now,
  };
  const projection: RelationshipSummaryProjection = {
    kind: "relationship_summary",
    relationshipId: input.relationship.id,
    generatedAt: now,
    summary,
    lifecycleState: input.relationship.lifecycle,
    warmthState: input.relationship.warmth.band,
    ownerVisibility,
    ...(latestTouchpoint ? { latestTouchpoint } : {}),
    ...(latestOutcome ? { latestOutcome } : {}),
    openPromises,
    overdueFollowUps,
    ...(nextScheduledFollowUp ? { nextScheduledFollowUp } : {}),
    ...(latestRelationshipActivity ? { latestRelationshipActivity } : {}),
    momentumHints,
    explanation: {
      generatedBy: "relationship_summary_projection",
      generatedAt: now,
      inputSources: [
        "RelationshipEntity",
        "TimelineEvent",
        "PromiseRecord",
        "HealthScoreTrace",
        "FollowUpInstruction",
      ],
      latestEvidence,
      confidence: projectionConfidence,
      missingDataEffects,
      timelineReferences,
      notes: [
        "Projection is read-only and derives relationship state from canonical entities, timeline events, promise records, health traces, and follow-up instructions.",
        "Momentum hints are descriptive evidence labels, not production scoring, reminders, or automation.",
      ],
    },
    validation: { ok: true, issues: [] },
  };
  return {
    ...projection,
    validation: validateRelationshipSummaryProjection(projection, {
      now,
      timelineEvents,
      staleTimelineAfterDays: input.staleTimelineAfterDays,
    }),
  };
}

function projectLatestTouchpoint(events: TimelineEvent[]): LatestTouchpointProjection | undefined {
  const event = latestByProjectionOrder(events.filter((item): item is TouchpointTimelineEvent => item.category === "touchpoint"));
  if (!event) return undefined;
  return {
    timelineEventId: event.id,
    occurredAt: event.touchpoint.occurredAt,
    channel: event.touchpoint.channel,
    direction: event.touchpoint.direction,
    ...(event.touchpoint.subject ? { subject: event.touchpoint.subject } : {}),
    ...(event.touchpoint.operatorId ? { operatorId: event.touchpoint.operatorId } : {}),
    evidence: sortProjectionEvidence([...event.evidence, ...event.touchpoint.evidence]),
    confidence: event.confidence,
  };
}

function projectLatestOutcome(events: TimelineEvent[]): LatestOutcomeProjection | undefined {
  const event = latestByProjectionOrder(events.filter((item): item is OutcomeTimelineEvent => item.category === "outcome"));
  if (!event) return undefined;
  return {
    timelineEventId: event.id,
    outcomeId: event.outcome.id,
    kind: event.outcome.kind,
    label: event.outcome.label,
    occurredAt: event.outcome.occurredAt,
    eventType: event.type,
    ...(event.outcome.value === undefined ? {} : { value: event.outcome.value }),
    ...(event.outcome.notes ? { notes: event.outcome.notes } : {}),
    evidence: sortProjectionEvidence([...event.evidence, ...event.outcome.evidence]),
    confidence: event.outcome.confidence,
  };
}

function projectOwnerVisibility(
  relationship: RelationshipEntity,
  events: TimelineEvent[],
): OwnerVisibilityProjection {
  const assignments = sortProjectionAssignments(relationship.assignments);
  const primaryOwnerId = assignments.find((assignment) => assignment.visibility === "primary_owner")?.ownerId;
  const collaboratorIds = uniqueOperators(assignments
    .filter((assignment) => assignment.visibility === "collaborator")
    .map((assignment) => assignment.ownerId));
  const observerIds = uniqueOperators(assignments
    .filter((assignment) => assignment.visibility === "observer")
    .map((assignment) => assignment.ownerId));
  const visibleTo = uniqueOperators([
    ...(primaryOwnerId ? [primaryOwnerId] : []),
    ...collaboratorIds,
    ...observerIds,
  ]);
  const latestAssignment = latestByProjectionOrder(
    events.filter((event): event is OwnerAssignmentTimelineEvent => event.category === "owner_assignment"),
  );
  return {
    ...(primaryOwnerId ? { primaryOwnerId } : {}),
    collaboratorIds,
    observerIds,
    visibleTo,
    unassigned: visibleTo.length === 0,
    ...(latestAssignment ? { latestAssignmentEventId: latestAssignment.id } : {}),
    evidence: latestAssignment ? sortProjectionEvidence(latestAssignment.evidence) : [],
    confidence: latestAssignment?.confidence ?? (visibleTo.length > 0 ? "medium" : "unknown"),
  };
}

function projectOpenPromises(promises: PromiseRecord[], now: IsoDateString): OpenPromiseProjection[] {
  return promises
    .filter((promise) => promise.status === "open")
    .map((promise) => ({
      promiseId: promise.id,
      title: promise.title,
      ...(promise.ownerId ? { ownerId: promise.ownerId } : {}),
      ...(promise.dueAt ? { dueAt: promise.dueAt } : {}),
      overdue: isBeforeIso(promise.dueAt, now),
      evidence: sortProjectionEvidence(promise.evidence),
      confidence: promise.confidence,
    }));
}

function projectOverdueFollowUps(
  instructions: FollowUpInstruction[],
  now: IsoDateString,
): OverdueFollowUpProjection[] {
  return instructions
    .filter((instruction) => instruction.dueAt < now)
    .map((instruction) => ({
      dueAt: instruction.dueAt,
      ...(instruction.ownerId ? { ownerId: instruction.ownerId } : {}),
      reason: instruction.reason,
      source: instruction.source,
      evidence: sortProjectionEvidence(instruction.evidence),
      confidence: instruction.confidence,
    }));
}

function projectNextScheduledFollowUp(
  instructions: FollowUpInstruction[],
  now: IsoDateString,
): NextScheduledFollowUpProjection | undefined {
  const instruction = instructions.find((item) => item.dueAt >= now);
  if (!instruction) return undefined;
  return {
    dueAt: instruction.dueAt,
    ...(instruction.ownerId ? { ownerId: instruction.ownerId } : {}),
    reason: instruction.reason,
    source: instruction.source,
    evidence: sortProjectionEvidence(instruction.evidence),
    confidence: instruction.confidence,
  };
}

function projectLatestRelationshipActivity(events: TimelineEvent[]): LatestRelationshipActivityProjection | undefined {
  const event = latestByProjectionOrder(events);
  if (!event) return undefined;
  return {
    timelineEventId: event.id,
    category: event.category,
    type: event.type,
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
    evidence: sortProjectionEvidence(event.evidence),
    confidence: event.confidence,
    description: describeTimelineEvent(event),
  };
}

function projectMissingDataEffects(input: {
  timelineEvents: TimelineEvent[];
  relationshipTimelineEvents: TimelineEvent[];
  promises: PromiseRecord[];
  relationshipPromises: PromiseRecord[];
  followUpInstructions: FollowUpInstruction[];
  relationshipFollowUpInstructions: FollowUpInstruction[];
  ownerVisibility: OwnerVisibilityProjection;
  latestTouchpoint?: LatestTouchpointProjection;
  latestOutcome?: LatestOutcomeProjection;
  healthTrace: HealthScoreTrace | null;
}): RelationshipProjectionMissingData[] {
  const effects: RelationshipProjectionMissingData[] = [];
  if (input.relationshipTimelineEvents.length === 0) {
    effects.push({
      field: "timelineReferences",
      reason: "no_timeline_events",
      effect: "lowers_confidence",
      message: "No canonical timeline events were available for this relationship.",
    });
  }
  if (input.timelineEvents.length !== input.relationshipTimelineEvents.length) {
    effects.push({
      field: "timelineEvents",
      reason: "source_filtered_for_relationship",
      effect: "neutral",
      message: "Timeline events for other relationships were ignored.",
    });
  }
  if (input.ownerVisibility.unassigned) {
    effects.push({
      field: "ownerVisibility",
      reason: "no_owner_assignment",
      effect: "limits_visibility",
      message: "No owner assignment is visible from canonical relationship assignment state.",
    });
  }
  if (!input.latestTouchpoint) {
    effects.push({
      field: "latestTouchpoint",
      reason: "no_touchpoint",
      effect: "lowers_confidence",
      message: "No touchpoint timeline event is available.",
    });
  }
  if (!input.latestOutcome) {
    effects.push({
      field: "latestOutcome",
      reason: "no_outcome",
      effect: "neutral",
      message: "No outcome timeline event is available.",
    });
  }
  if (input.promises.length === 0 || input.relationshipPromises.length === 0) {
    effects.push({
      field: "openPromises",
      reason: "no_promise_records",
      effect: "neutral",
      message: "No promise records were available for this relationship.",
    });
  }
  if (input.followUpInstructions.length === 0 || input.relationshipFollowUpInstructions.length === 0) {
    effects.push({
      field: "nextScheduledFollowUp",
      reason: "no_follow_up_instruction",
      effect: "neutral",
      message: "No follow-up instructions were available for this relationship.",
    });
  }
  if (!input.healthTrace) {
    effects.push({
      field: "healthScore",
      reason: "no_health_trace",
      effect: "lowers_confidence",
      message: "No health score trace was provided; the projection does not calculate one.",
    });
  }
  return effects;
}

function projectMomentumHints(input: {
  latestTouchpoint?: LatestTouchpointProjection;
  latestOutcome?: LatestOutcomeProjection;
  latestRelationshipActivity?: LatestRelationshipActivityProjection;
  openPromises: OpenPromiseProjection[];
  overdueFollowUps: OverdueFollowUpProjection[];
  ownerVisibility: OwnerVisibilityProjection;
  healthTrace: HealthScoreTrace | null;
  now: IsoDateString;
  staleTimelineAfterDays: number;
}): RelationshipMomentumHint[] {
  const hints: RelationshipMomentumHint[] = [];
  if (input.latestTouchpoint) {
    hints.push({
      kind: "latest_touchpoint_observed",
      label: "Latest touchpoint observed",
      explanation: "The latest touchpoint is copied from a normalized touchpoint timeline event.",
      evidence: input.latestTouchpoint.evidence,
      timelineEventIds: [input.latestTouchpoint.timelineEventId],
      confidence: input.latestTouchpoint.confidence,
    });
  }
  if (input.latestOutcome && ["meeting_booked", "deal_won", "retained", "referral_created"].includes(input.latestOutcome.kind)) {
    hints.push({
      kind: "recent_positive_outcome",
      label: "Positive outcome observed",
      explanation: `Latest outcome is ${input.latestOutcome.label}.`,
      evidence: input.latestOutcome.evidence,
      timelineEventIds: [input.latestOutcome.timelineEventId],
      confidence: input.latestOutcome.confidence,
    });
  }
  if (input.openPromises.length > 0) {
    const evidence = input.openPromises.flatMap((promise) => promise.evidence);
    hints.push({
      kind: "open_promise",
      label: "Open promise",
      explanation: `${input.openPromises.length} open promise record(s) are present.`,
      evidence: sortProjectionEvidence(evidence),
      timelineEventIds: [],
      confidence: combineConfidence(input.openPromises.map((promise) => promise.confidence)),
    });
  }
  if (input.overdueFollowUps.length > 0) {
    const evidence = input.overdueFollowUps.flatMap((followUp) => followUp.evidence);
    hints.push({
      kind: "overdue_follow_up",
      label: "Overdue follow-up",
      explanation: `${input.overdueFollowUps.length} follow-up instruction(s) are overdue.`,
      evidence: sortProjectionEvidence(evidence),
      timelineEventIds: [],
      confidence: combineConfidence(input.overdueFollowUps.map((followUp) => followUp.confidence)),
    });
  }
  if (input.ownerVisibility.unassigned) {
    hints.push({
      kind: "missing_owner",
      label: "Missing owner",
      explanation: "No canonical assignment makes this relationship visible to an owner.",
      evidence: input.ownerVisibility.evidence,
      timelineEventIds: input.ownerVisibility.latestAssignmentEventId ? [input.ownerVisibility.latestAssignmentEventId] : [],
      confidence: input.ownerVisibility.confidence,
    });
  }
  if (!input.latestRelationshipActivity) {
    hints.push({
      kind: "insufficient_timeline",
      label: "Insufficient timeline",
      explanation: "No canonical timeline events are available for relationship activity.",
      evidence: [],
      timelineEventIds: [],
      confidence: "unknown",
    });
  } else if (isOlderThanDays(input.latestRelationshipActivity.occurredAt, input.now, input.staleTimelineAfterDays)) {
    hints.push({
      kind: "stale_activity",
      label: "Stale activity",
      explanation: `Latest relationship activity is older than ${input.staleTimelineAfterDays} days.`,
      evidence: input.latestRelationshipActivity.evidence,
      timelineEventIds: [input.latestRelationshipActivity.timelineEventId],
      confidence: input.latestRelationshipActivity.confidence,
    });
  }
  if (!input.healthTrace) {
    hints.push({
      kind: "missing_health_trace",
      label: "Missing health trace",
      explanation: "No health score trace was provided; the summary copied no score.",
      evidence: [],
      timelineEventIds: [],
      confidence: "unknown",
    });
  }
  return hints.sort((a, b) => momentumHintRank(a.kind) - momentumHintRank(b.kind) || a.kind.localeCompare(b.kind));
}

function projectLatestEvidence(input: {
  latestRelationshipActivity?: LatestRelationshipActivityProjection;
  latestTouchpoint?: LatestTouchpointProjection;
  latestOutcome?: LatestOutcomeProjection;
  ownerVisibility: OwnerVisibilityProjection;
  openPromises: OpenPromiseProjection[];
  overdueFollowUps: OverdueFollowUpProjection[];
}): RelationshipProjectionEvidencePointer[] {
  const pointers: RelationshipProjectionEvidencePointer[] = [];
  if (input.latestRelationshipActivity) {
    pointers.push({
      timelineEventId: input.latestRelationshipActivity.timelineEventId,
      occurredAt: input.latestRelationshipActivity.occurredAt,
      category: input.latestRelationshipActivity.category,
      type: input.latestRelationshipActivity.type,
      evidence: input.latestRelationshipActivity.evidence,
      confidence: input.latestRelationshipActivity.confidence,
      description: input.latestRelationshipActivity.description,
    });
  }
  if (input.latestTouchpoint) {
    pointers.push({
      timelineEventId: input.latestTouchpoint.timelineEventId,
      occurredAt: input.latestTouchpoint.occurredAt,
      category: "touchpoint",
      type: "touchpoint_logged",
      evidence: input.latestTouchpoint.evidence,
      confidence: input.latestTouchpoint.confidence,
      description: "Latest touchpoint evidence.",
    });
  }
  if (input.latestOutcome) {
    pointers.push({
      timelineEventId: input.latestOutcome.timelineEventId,
      occurredAt: input.latestOutcome.occurredAt,
      category: "outcome",
      type: input.latestOutcome.eventType,
      evidence: input.latestOutcome.evidence,
      confidence: input.latestOutcome.confidence,
      description: `Latest outcome evidence: ${input.latestOutcome.label}.`,
    });
  }
  if (input.ownerVisibility.latestAssignmentEventId) {
    pointers.push({
      timelineEventId: input.ownerVisibility.latestAssignmentEventId,
      evidence: input.ownerVisibility.evidence,
      confidence: input.ownerVisibility.confidence,
      description: "Latest owner assignment evidence.",
    });
  }
  for (const promise of input.openPromises.slice(0, 3)) {
    pointers.push({
      promiseId: promise.promiseId,
      occurredAt: promise.dueAt,
      evidence: promise.evidence,
      confidence: promise.confidence,
      description: `Open promise evidence: ${promise.title}.`,
    });
  }
  for (const followUp of input.overdueFollowUps.slice(0, 3)) {
    pointers.push({
      occurredAt: followUp.dueAt,
      evidence: followUp.evidence,
      confidence: followUp.confidence,
      description: `Overdue follow-up evidence: ${followUp.reason}.`,
    });
  }
  return pointers;
}

function describeTimelineEvent(event: TimelineEvent): string {
  switch (event.category) {
    case "touchpoint":
      return `${event.touchpoint.channel} ${event.touchpoint.direction} touchpoint`;
    case "promise":
      return event.summary;
    case "lifecycle":
      return `Lifecycle transitioned ${event.from} -> ${event.to}`;
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

function combineConfidence(values: Array<"high" | "medium" | "low" | "unknown" | undefined>): "high" | "medium" | "low" | "unknown" {
  const present = values.filter((value): value is "high" | "medium" | "low" | "unknown" => Boolean(value));
  if (present.length === 0) return "unknown";
  const ranks = { unknown: 0, low: 1, medium: 2, high: 3 } as const;
  return present.reduce((lowest, value) => (ranks[value] < ranks[lowest] ? value : lowest), "high");
}

function momentumHintRank(kind: RelationshipMomentumHint["kind"]): number {
  switch (kind) {
    case "overdue_follow_up":
      return 0;
    case "open_promise":
      return 1;
    case "recent_positive_outcome":
      return 2;
    case "latest_touchpoint_observed":
      return 3;
    case "stale_activity":
      return 4;
    case "missing_owner":
      return 5;
    case "missing_health_trace":
      return 6;
    case "insufficient_timeline":
      return 7;
  }
}

function isOlderThanDays(value: IsoDateString, now: IsoDateString, days: number): boolean {
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) return false;
  return nowMs - valueMs > days * 24 * 60 * 60 * 1000;
}
