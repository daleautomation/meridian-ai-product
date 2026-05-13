// Meridian Relationship Engine — follow-up task timeline projection.
//
// Existing follow-up tasks are normalized as observed schedule/completion facts.
// Cancelled tasks are deliberately not coerced into a canonical event until the
// follow-up taxonomy adds a cancellation type.

import type { SourceFollowUpTask, TimelineNormalizationContext } from "../../adapters/sourceTypes";
import type { FollowUpTimelineEvent } from "../events";
import {
  asOperatorId,
  baseTimelineParts,
  emptyNormalizationResult,
  isValidTimestampInput,
  normalizeIsoTimestamp,
  normalizeOptionalIsoTimestamp,
  stableTimelineEventId,
  type TimelineNormalizationResult,
} from "./common";

export function normalizeFollowUpTaskToTimelineEvent(
  task: SourceFollowUpTask,
  context: TimelineNormalizationContext,
): TimelineNormalizationResult<FollowUpTimelineEvent> {
  if (task.status === "cancelled") {
    return emptyNormalizationResult(
      "follow_up_task",
      task.id,
      "Cancelled follow-ups are skipped until canonical follow_up_cancelled support exists.",
    ) as TimelineNormalizationResult<FollowUpTimelineEvent>;
  }

  const type = followUpEventType(task, context.now);
  const dueAt = normalizeOptionalIsoTimestamp(task.dueAt);
  const completedAt = normalizeOptionalIsoTimestamp(task.completedAt);
  const createdAt = normalizeOptionalIsoTimestamp(task.createdAt);
  const occurredAt = type === "follow_up_completed"
    ? completedAt ?? dueAt ?? createdAt
    : dueAt ?? createdAt;
  const base = baseTimelineParts({
    source: "follow_up_task",
    sourceId: task.id,
    sourceRef: task,
    context,
    occurredAt,
    actorId: task.completedBy ?? task.assignedUserId ?? task.createdBy,
    evidenceLabel: "Follow-up task",
    evidenceValue: task.status,
    evidenceNotes: task.description ?? task.title,
  });

  const event: FollowUpTimelineEvent = {
    id: stableTimelineEventId([base.dedupeKey, type]),
    relationshipId: base.relationshipId,
    category: "follow_up",
    type,
    occurredAt: base.occurredAt,
    recordedAt: base.recordedAt,
    source: base.timelineSource,
    ...(base.actorId ? { actorId: base.actorId } : {}),
    evidence: base.evidence,
    confidence: base.confidence,
    dedupeKey: base.dedupeKey,
    ...(dueAt ? { dueAt } : {}),
    ...(type === "follow_up_completed" ? { completedAt: base.occurredAt } : {}),
    ...(task.assignedUserId ? { ownerId: asOperatorId(task.assignedUserId) } : {}),
    reason: task.title,
  };
  return { event, warnings: [] };
}

function followUpEventType(
  task: SourceFollowUpTask,
  now: string,
): FollowUpTimelineEvent["type"] {
  if (task.status === "completed") return "follow_up_completed";
  if (
    task.status === "open"
    && isValidTimestampInput(task.dueAt)
    && normalizeIsoTimestamp(task.dueAt, now) < normalizeIsoTimestamp(now, now)
  ) {
    return "follow_up_missed";
  }
  return "follow_up_scheduled";
}
