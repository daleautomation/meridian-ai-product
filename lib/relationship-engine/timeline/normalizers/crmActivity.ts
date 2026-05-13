// Meridian Relationship Engine — CRM activity timeline projection.
//
// This adapter treats existing CRM activity as read-only evidence. It does not
// update CRM summaries, lead status, follow-up tasks, or execution outcomes.

import type { SourceCrmActivity, TimelineNormalizationContext } from "../../adapters/sourceTypes";
import type {
  OutcomeKind,
  OutcomeTimelineEvent,
  TimelineEvent,
  TouchpointChannel,
  TouchpointDirection,
  TouchpointTimelineEvent,
} from "../events";
import {
  asOutcomeId,
  asTimelineEventId,
  asTouchpointId,
  baseTimelineParts,
  stableTimelineEventId,
  type TimelineNormalizationResult,
} from "./common";

export function normalizeCrmActivityToTimelineEvent(
  activity: SourceCrmActivity,
  context: TimelineNormalizationContext,
): TimelineNormalizationResult<TimelineEvent> {
  const base = baseTimelineParts({
    source: "crm_activity",
    sourceId: activity.id,
    sourceRef: activity,
    context,
    occurredAt: activity.performedAt,
    actorId: activity.performedBy,
    evidenceLabel: "CRM activity",
    evidenceValue: activity.activityType,
    evidenceNotes: activity.summary ?? activity.note,
  });
  const outcomeKind = crmOutcomeKind(activity.activityType, activity.outcome);

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
        id: asOutcomeId(`outcome:${activity.id}`),
        relationshipId: base.relationshipId,
        kind: outcomeKind,
        label: activity.outcome ?? activity.activityType,
        occurredAt: base.occurredAt,
        notes: activity.summary ?? activity.note,
        evidence: base.evidence,
        confidence: base.confidence,
      },
    };
    return { event, warnings: [] };
  }

  const event: TouchpointTimelineEvent = {
    id: asTimelineEventId(stableTimelineEventId([base.dedupeKey, "touchpoint_logged"])),
    relationshipId: base.relationshipId,
    category: "touchpoint",
    type: touchpointEventType(activity.activityType),
    occurredAt: base.occurredAt,
    recordedAt: base.recordedAt,
    source: base.timelineSource,
    ...(base.actorId ? { actorId: base.actorId } : {}),
    evidence: base.evidence,
    confidence: base.confidence,
    dedupeKey: base.dedupeKey,
    touchpoint: {
      id: asTouchpointId(`touchpoint:${activity.id}`),
      relationshipId: base.relationshipId,
      channel: touchpointChannel(activity.activityType),
      direction: touchpointDirection(activity.activityType),
      occurredAt: base.occurredAt,
      subject: activity.summary ?? activity.nextAction ?? activity.activityType,
      bodyPreview: activity.note,
      ...(base.actorId && base.actorId !== "system" ? { operatorId: base.actorId } : {}),
      externalMessageId: activity.id,
      evidence: base.evidence,
    },
  };
  return { event, warnings: [] };
}

function crmOutcomeKind(activityType: string, outcome: string | null): OutcomeKind | null {
  const key = (outcome ?? activityType).toLowerCase();
  if (key === "closed_won") return "deal_won";
  if (key === "closed_lost") return "deal_lost";
  if (key === "meeting_booked") return "meeting_booked";
  if (key === "not_interested") return "not_fit";
  if (key === "no_answer") return "no_response";
  return null;
}

function touchpointEventType(activityType: string): TouchpointTimelineEvent["type"] {
  switch (activityType) {
    case "call":
    case "voicemail":
      return "call_completed";
    case "email":
      return "email_sent";
    case "meeting":
      return "meeting_completed";
    case "note":
      return "note_added";
    default:
      return "touchpoint_logged";
  }
}

function touchpointChannel(activityType: string): TouchpointChannel {
  switch (activityType) {
    case "call":
    case "voicemail":
      return "call";
    case "email":
      return "email";
    case "text":
      return "sms";
    case "meeting":
      return "meeting";
    case "note":
      return "note";
    default:
      return "other";
  }
}

function touchpointDirection(activityType: string): TouchpointDirection {
  if (activityType === "note") return "internal";
  return "outbound";
}
