// Meridian Relationship Engine — event log timeline projection.
//
// Usage events are broad operational facts. This normalizer only maps event
// types that have a clear canonical timeline equivalent; ambiguous analytics
// events stay outside relationship memory until a future contract names them.

import type { SourceUsageEvent, TimelineNormalizationContext } from "../../adapters/sourceTypes";
import { normalizeLifecycleState, validateLifecycleTransition } from "../../lifecycle/validation";
import type {
  FollowUpTimelineEvent,
  LifecycleTimelineEvent,
  OutcomeKind,
  OutcomeTimelineEvent,
  TimelineEvent,
  TouchpointTimelineEvent,
} from "../events";
import {
  asOutcomeId,
  asTouchpointId,
  baseTimelineParts,
  emptyNormalizationResult,
  normalizeIsoTimestamp,
  normalizeOptionalIsoTimestamp,
  stableTimelineEventId,
  type TimelineNormalizationResult,
} from "./common";

export function normalizeUsageEventToTimelineEvent(
  usageEvent: SourceUsageEvent,
  context: TimelineNormalizationContext,
): TimelineNormalizationResult<TimelineEvent> {
  const sourceId = usageEvent.eventId ?? `${usageEvent.timestamp}:${usageEvent.eventType}`;
  const base = baseTimelineParts({
    source: "usage_event",
    sourceId,
    sourceRef: usageEvent,
    context,
    occurredAt: usageEvent.occurredAt ?? usageEvent.timestamp,
    recordedAt: usageEvent.recordedAt ?? usageEvent.timestamp,
    actorId: usageEvent.operatorId ?? usageEvent.userId,
    evidenceLabel: "Usage event",
    evidenceValue: usageEvent.eventType,
    evidenceNotes: usageEvent.influenceReason ?? undefined,
  });
  const outcomeKind = usageOutcomeKind(usageEvent.eventType, usageEvent.outcomeStatus);

  if (outcomeKind) {
    const event: OutcomeTimelineEvent = {
      id: stableTimelineEventId([base.dedupeKey, "outcome_recorded"]),
      relationshipId: base.relationshipId,
      category: "outcome",
      type: "outcome_recorded",
      occurredAt: base.occurredAt,
      recordedAt: base.recordedAt,
      source: base.timelineSource,
      ...(base.actorId ? { actorId: base.actorId } : {}),
      evidence: base.evidence,
      confidence: base.confidence,
      dedupeKey: base.dedupeKey,
      outcome: {
        id: asOutcomeId(`outcome:${sourceId}`),
        relationshipId: base.relationshipId,
        kind: outcomeKind,
        label: usageEvent.outcomeStatus ?? usageEvent.eventType,
        occurredAt: base.occurredAt,
        ...(usageEvent.estimatedValue === null || usageEvent.estimatedValue === undefined
          ? {}
          : { value: usageEvent.estimatedValue }),
        notes: usageEvent.influenceReason ?? undefined,
        evidence: base.evidence,
        confidence: base.confidence,
      },
    };
    return { event, warnings: [] };
  }

  if (usageEvent.eventType === "follow_up_needed" || usageEvent.nextActionDate) {
    const event: FollowUpTimelineEvent = {
      id: stableTimelineEventId([base.dedupeKey, "follow_up_scheduled"]),
      relationshipId: base.relationshipId,
      category: "follow_up",
      type: "follow_up_scheduled",
      occurredAt: base.occurredAt,
      recordedAt: base.recordedAt,
      source: base.timelineSource,
      ...(base.actorId ? { actorId: base.actorId } : {}),
      evidence: base.evidence,
      confidence: base.confidence,
      dedupeKey: base.dedupeKey,
      ...(normalizeOptionalIsoTimestamp(usageEvent.nextActionDate)
        ? { dueAt: normalizeIsoTimestamp(usageEvent.nextActionDate, context.now) }
        : {}),
      ...(base.actorId && base.actorId !== "system" ? { ownerId: base.actorId } : {}),
      reason: usageEvent.nextAction ?? "Usage event requested follow-up",
    };
    return { event, warnings: [] };
  }

  if (usageEvent.eventType === "call_completed") {
    const event: TouchpointTimelineEvent = {
      id: stableTimelineEventId([base.dedupeKey, "call_completed"]),
      relationshipId: base.relationshipId,
      category: "touchpoint",
      type: "call_completed",
      occurredAt: base.occurredAt,
      recordedAt: base.recordedAt,
      source: base.timelineSource,
      ...(base.actorId ? { actorId: base.actorId } : {}),
      evidence: base.evidence,
      confidence: base.confidence,
      dedupeKey: base.dedupeKey,
      touchpoint: {
        id: asTouchpointId(`touchpoint:${sourceId}`),
        relationshipId: base.relationshipId,
        channel: "call",
        direction: "outbound",
        occurredAt: base.occurredAt,
        subject: usageEvent.eventType,
        bodyPreview: usageEvent.influenceReason ?? undefined,
        ...(base.actorId && base.actorId !== "system" ? { operatorId: base.actorId } : {}),
        externalMessageId: sourceId,
        evidence: base.evidence,
      },
    };
    return { event, warnings: [] };
  }

  const previous = normalizeLifecycleState(usageEvent.previousStatus);
  const next = normalizeLifecycleState(usageEvent.nextStatus);
  if (previous && next && previous !== next) {
    const validation = validateLifecycleTransition({
      from: previous,
      to: next,
      reason: usageEvent.influenceReason ?? usageEvent.eventType,
      evidence: base.evidence,
    });
    if (!validation.ok) {
      return emptyNormalizationResult(
        "usage_event",
        sourceId,
        validation.message ?? "Usage event lifecycle transition is invalid.",
      );
    }

    const event: LifecycleTimelineEvent = {
      id: stableTimelineEventId([base.dedupeKey, "lifecycle_transitioned"]),
      relationshipId: base.relationshipId,
      category: "lifecycle",
      type: "lifecycle_transitioned",
      occurredAt: base.occurredAt,
      recordedAt: base.recordedAt,
      source: base.timelineSource,
      ...(base.actorId ? { actorId: base.actorId } : {}),
      evidence: base.evidence,
      confidence: base.confidence,
      dedupeKey: base.dedupeKey,
      from: previous,
      to: next,
      reason: usageEvent.influenceReason ?? usageEvent.eventType,
    };
    return { event, warnings: [] };
  }

  return emptyNormalizationResult(
    "usage_event",
    sourceId,
    `No canonical timeline mapping for usage event type ${usageEvent.eventType}.`,
  );
}

function usageOutcomeKind(eventType: string, outcomeStatus: string | null | undefined): OutcomeKind | null {
  const key = (outcomeStatus ?? eventType).toLowerCase().replaceAll(" ", "_");
  switch (key) {
    case "proposal_sent":
      return "other";
    case "closed_won":
      return "deal_won";
    case "closed_lost":
      return "deal_lost";
    case "not_qualified":
      return "not_fit";
    default:
      return null;
  }
}
