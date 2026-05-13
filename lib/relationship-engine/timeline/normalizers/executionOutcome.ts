// Meridian Relationship Engine — execution outcome timeline projection.
//
// Execution outcomes already have durable IDs and timestamps. This normalizer
// only projects them into canonical outcome/follow-up/touchpoint events for
// shadow reads; it never records outcomes or syncs CRM state.

import type { SourceExecutionOutcome, TimelineNormalizationContext } from "../../adapters/sourceTypes";
import type {
  FollowUpTimelineEvent,
  OutcomeKind,
  OutcomeTimelineEvent,
  TimelineEvent,
  TouchpointTimelineEvent,
} from "../events";
import {
  asOutcomeId,
  asTouchpointId,
  baseTimelineParts,
  normalizeIsoTimestamp,
  normalizeOptionalIsoTimestamp,
  stableTimelineEventId,
  type TimelineNormalizationResult,
} from "./common";

export function normalizeExecutionOutcomeToTimelineEvent(
  outcome: SourceExecutionOutcome,
  context: TimelineNormalizationContext,
): TimelineNormalizationResult<TimelineEvent> {
  const base = baseTimelineParts({
    source: "execution_outcome",
    sourceId: outcome.eventId,
    sourceRef: outcome,
    context,
    occurredAt: outcome.occurredAt,
    recordedAt: outcome.recordedAt,
    actorId: outcome.operatorId,
    evidenceLabel: "Execution outcome",
    evidenceValue: outcome.outcomeStatus,
    evidenceNotes: outcome.influenceReason,
  });
  const kind = executionOutcomeKind(outcome.outcomeStatus);

  if (kind) {
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
        id: asOutcomeId(`outcome:${outcome.eventId}`),
        relationshipId: base.relationshipId,
        kind,
        label: outcome.outcomeStatus,
        occurredAt: base.occurredAt,
        ...(outcome.estimatedValue === null ? {} : { value: outcome.estimatedValue }),
        notes: outcome.influenceReason,
        evidence: base.evidence,
        confidence: base.confidence,
      },
    };
    return { event, warnings: [] };
  }

  if (outcome.outcomeStatus === "Follow Up") {
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
      ...(normalizeOptionalIsoTimestamp(outcome.nextActionDate)
        ? { dueAt: normalizeIsoTimestamp(outcome.nextActionDate, context.now) }
        : {}),
      ...(base.actorId && base.actorId !== "system" ? { ownerId: base.actorId } : {}),
      reason: outcome.nextAction ?? "Execution outcome requested follow-up",
    };
    return { event, warnings: [] };
  }

  const event: TouchpointTimelineEvent = {
    id: stableTimelineEventId([base.dedupeKey, "touchpoint_logged"]),
    relationshipId: base.relationshipId,
    category: "touchpoint",
    type: outcome.outcomeStatus === "Called" ? "call_completed" : "touchpoint_logged",
    occurredAt: base.occurredAt,
    recordedAt: base.recordedAt,
    source: base.timelineSource,
    ...(base.actorId ? { actorId: base.actorId } : {}),
    evidence: base.evidence,
    confidence: base.confidence,
    dedupeKey: base.dedupeKey,
    touchpoint: {
      id: asTouchpointId(`touchpoint:${outcome.eventId}`),
      relationshipId: base.relationshipId,
      channel: outcome.outcomeStatus === "Called" ? "call" : "other",
      direction: "outbound",
      occurredAt: base.occurredAt,
      subject: outcome.outcomeStatus,
      bodyPreview: outcome.influenceReason,
      ...(base.actorId && base.actorId !== "system" ? { operatorId: base.actorId } : {}),
      externalMessageId: outcome.eventId,
      evidence: base.evidence,
    },
  };
  return { event, warnings: [] };
}

function executionOutcomeKind(status: string): OutcomeKind | null {
  switch (status) {
    case "Qualified":
    case "Proposal Sent":
      return "other";
    case "Closed Won":
      return "deal_won";
    case "Closed Lost":
      return "deal_lost";
    case "Not Qualified":
      return "not_fit";
    default:
      return null;
  }
}
