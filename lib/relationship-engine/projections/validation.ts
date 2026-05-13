// Meridian Relationship Engine — projection integrity validation.

import type { IsoDateString } from "../primitives";
import { validateLifecycleTransition } from "../lifecycle/validation";
import { isLifecycleState } from "../relationship/lifecycle";
import type { TimelineEvent } from "../timeline/events";
import type {
  RelationshipSummaryProjection,
  RelationshipSummaryProjectionIssue,
  RelationshipSummaryProjectionValidationResult,
} from "./dto";

export interface RelationshipSummaryProjectionValidationContext {
  now: IsoDateString;
  timelineEvents?: TimelineEvent[];
  staleTimelineAfterDays?: number;
}

export const DEFAULT_STALE_TIMELINE_AFTER_DAYS = 90;

export function validateRelationshipSummaryProjection(
  projection: RelationshipSummaryProjection,
  context: RelationshipSummaryProjectionValidationContext,
): RelationshipSummaryProjectionValidationResult {
  const issues: RelationshipSummaryProjectionIssue[] = [];
  const summary = projection.summary;

  if (projection.kind !== "relationship_summary") {
    issues.push(error("invalid_projection_kind", "Relationship summary projection has an invalid kind."));
  }
  if (summary.relationshipId !== projection.relationshipId) {
    issues.push(error("relationship_id_mismatch", "Projection relationshipId must match summary relationshipId."));
  }
  if (summary.summaryGeneratedAt !== projection.generatedAt) {
    issues.push(error("generated_at_mismatch", "summaryGeneratedAt must match projection generatedAt."));
  }
  if (!isValidIso(projection.generatedAt)) {
    issues.push(error("invalid_generated_at", "Projection generatedAt must be a valid ISO timestamp."));
  }
  if (!isLifecycleState(projection.lifecycleState)) {
    issues.push(error("invalid_lifecycle", "Projection lifecycleState must be canonical."));
  }
  if (summary.lifecycle !== projection.lifecycleState) {
    issues.push(error("summary_lifecycle_mismatch", "Summary lifecycle must match projection lifecycleState."));
  }
  if (summary.warmth !== projection.warmthState) {
    issues.push(error("summary_warmth_mismatch", "Summary warmth must match projection warmthState."));
  }
  if (summary.openPromiseCount !== projection.openPromises.length) {
    issues.push(error("open_promise_count_mismatch", "Summary openPromiseCount must match projected open promises."));
  }
  const overduePromiseCount = projection.openPromises.filter((promise) => promise.overdue).length;
  if (summary.overduePromiseCount !== overduePromiseCount) {
    issues.push(error("overdue_promise_count_mismatch", "Summary overduePromiseCount must match overdue open promises."));
  }
  if (summary.ownerId !== projection.ownerVisibility.primaryOwnerId) {
    issues.push(error("owner_mismatch", "Summary ownerId must match projected primary owner visibility."));
  }
  if (
    projection.ownerVisibility.primaryOwnerId
    && !projection.ownerVisibility.visibleTo.includes(projection.ownerVisibility.primaryOwnerId)
  ) {
    issues.push(error("primary_owner_not_visible", "Primary owner must be included in visibleTo."));
  }
  if (projection.ownerVisibility.visibleTo.length === 0) {
    issues.push(warning("missing_owner_visibility", "Projection has no owner visibility; queues must not infer visibility."));
  }
  if (!projection.latestRelationshipActivity) {
    issues.push(warning("missing_timeline_activity", "Projection has no latest relationship activity."));
  }
  if (projection.explanation.timelineReferences.length === 0) {
    issues.push(warning("missing_timeline_references", "Projection has no timeline references."));
  }
  if (projection.latestTouchpoint && projection.latestTouchpoint.evidence.length === 0) {
    issues.push(warning("latest_touchpoint_missing_evidence", "Latest touchpoint projection has no evidence."));
  }
  if (projection.latestOutcome && projection.latestOutcome.evidence.length === 0) {
    issues.push(warning("latest_outcome_missing_evidence", "Latest outcome projection has no evidence."));
  }
  if (projection.summary.nextFollowUpAt !== projection.nextScheduledFollowUp?.dueAt) {
    issues.push(error("next_follow_up_mismatch", "Summary nextFollowUpAt must match projected next scheduled follow-up."));
  }
  if (projection.latestRelationshipActivity) {
    const staleAfterDays = context.staleTimelineAfterDays ?? DEFAULT_STALE_TIMELINE_AFTER_DAYS;
    if (isOlderThanDays(projection.latestRelationshipActivity.occurredAt, context.now, staleAfterDays)) {
      issues.push(warning(
        "stale_timeline_activity",
        `Latest relationship activity is older than ${staleAfterDays} days.`,
      ));
    }
  }
  if (context.timelineEvents) {
    issues.push(...validateTimelineInput(projection, context.timelineEvents));
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function validateTimelineInput(
  projection: RelationshipSummaryProjection,
  events: TimelineEvent[],
): RelationshipSummaryProjectionIssue[] {
  const issues: RelationshipSummaryProjectionIssue[] = [];
  const eventIds = new Set(events.map((event) => event.id));

  for (const reference of projection.explanation.timelineReferences) {
    if (!eventIds.has(reference)) {
      issues.push(error("unknown_timeline_reference", `Projection references missing timeline event ${reference}.`));
    }
  }
  for (const event of events) {
    if (event.relationshipId !== projection.relationshipId) {
      issues.push(warning(
        "timeline_relationship_mismatch",
        `Timeline event ${event.id} belongs to a different relationship and must be filtered before projection.`,
      ));
    }
    if (event.category === "lifecycle") {
      const transition = validateLifecycleTransition({
        from: event.from,
        to: event.to,
        reason: event.reason,
        evidence: event.evidence,
      });
      if (!transition.ok) {
        issues.push(error(
          "invalid_lifecycle_event",
          transition.message ?? `Lifecycle event ${event.id} is invalid.`,
        ));
      }
    }
  }
  return issues;
}

function isOlderThanDays(value: IsoDateString, now: IsoDateString, days: number): boolean {
  const valueMs = Date.parse(value);
  const nowMs = Date.parse(now);
  if (Number.isNaN(valueMs) || Number.isNaN(nowMs)) return false;
  return nowMs - valueMs > days * 24 * 60 * 60 * 1000;
}

function isValidIso(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function error(code: string, message: string): RelationshipSummaryProjectionIssue {
  return { severity: "error", code, message };
}

function warning(code: string, message: string): RelationshipSummaryProjectionIssue {
  return { severity: "warning", code, message };
}
