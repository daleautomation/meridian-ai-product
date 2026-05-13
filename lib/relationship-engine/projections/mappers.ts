// Meridian Relationship Engine — read-only projection consumer mappers.

import type { RelationshipMcpDto } from "../dto/boundaries";
import type { RelationshipSummary } from "../relationship/entities";
import type { RelationshipSummaryProjection } from "./dto";
import type {
  RelationshipFeedProjection,
  RelationshipQueueProjection,
  RelationshipTimelineProjection,
} from "./operatorReadModels";

export interface RelationshipSummaryProjectionMcpOptions {
  allowedActions?: string[];
  evidenceRequired?: string[];
}

export interface RelationshipFeedMcpDto {
  feedKind: RelationshipFeedProjection["feedKind"];
  itemId: string;
  relationshipId: string;
  title: string;
  body: string;
  occurredAt: string;
  confidence: string;
  timelineReferences: string[];
  evidenceRequired: string[];
}

export interface RelationshipQueueMcpDto {
  queueKind: RelationshipQueueProjection["queueKind"];
  itemId: string;
  relationshipId: string;
  rank: number;
  whyItExists: string;
  confidence: string;
  visibleTo: string[];
  timelineReferences: string[];
  evidenceRequired: string[];
  reviewOnly: true;
}

export interface RelationshipTimelineMcpDto {
  relationshipId: string;
  groups: Array<{
    groupKind: RelationshipTimelineProjection["groups"][number]["groupKind"];
    label: string;
    itemCount: number;
  }>;
  evidenceRequired: string[];
  reviewOnly: true;
}

export function relationshipSummaryForQueue(
  projection: RelationshipSummaryProjection,
): RelationshipSummary {
  return projection.summary;
}

export function relationshipSummaryProjectionToMcpDto(
  projection: RelationshipSummaryProjection,
  options: RelationshipSummaryProjectionMcpOptions = {},
): RelationshipMcpDto {
  return {
    relationshipId: projection.relationshipId,
    displayName: projection.summary.displayName,
    lifecycle: projection.summary.lifecycle,
    allowedActions: options.allowedActions ?? [],
    evidenceRequired: options.evidenceRequired ?? projection.explanation.missingDataEffects
      .filter((effect) => effect.effect === "lowers_confidence")
      .map((effect) => effect.field),
    summary: relationshipSummaryProjectionToCompactText(projection),
  };
}

export function relationshipSummaryProjectionToCompactText(
  projection: RelationshipSummaryProjection,
): string {
  const parts = [
    `Lifecycle: ${projection.summary.lifecycle}`,
    `Warmth: ${projection.summary.warmth}`,
    projection.summary.ownerId ? `Owner: ${projection.summary.ownerId}` : "Owner: unassigned",
    projection.latestTouchpoint ? `Last touchpoint: ${projection.latestTouchpoint.occurredAt}` : "Last touchpoint: unknown",
    projection.latestOutcome ? `Latest outcome: ${projection.latestOutcome.label}` : "Latest outcome: unknown",
    `Open promises: ${projection.summary.openPromiseCount}`,
    `Overdue promises: ${projection.summary.overduePromiseCount}`,
    projection.summary.nextFollowUpAt ? `Next follow-up: ${projection.summary.nextFollowUpAt}` : "Next follow-up: none",
    `Confidence: ${projection.explanation.confidence}`,
  ];
  return parts.join("; ");
}

export function relationshipFeedProjectionToMcpDtos(
  projection: RelationshipFeedProjection,
): RelationshipFeedMcpDto[] {
  return projection.items.map((item) => ({
    feedKind: projection.feedKind,
    itemId: item.id,
    relationshipId: item.relationshipId,
    title: item.title,
    body: item.body,
    occurredAt: item.occurredAt,
    confidence: item.confidence,
    timelineReferences: item.timelineReferences,
    evidenceRequired: item.missingDataEffects
      .filter((effect) => effect.effect === "lowers_confidence" || effect.effect === "limits_visibility")
      .map((effect) => effect.field),
  }));
}

export function relationshipQueueProjectionToMcpDtos(
  projection: RelationshipQueueProjection,
): RelationshipQueueMcpDto[] {
  return projection.items.map((item) => ({
    queueKind: projection.queueKind,
    itemId: item.id,
    relationshipId: item.relationshipId,
    rank: item.rank,
    whyItExists: item.whyItExists,
    confidence: item.confidence,
    visibleTo: item.ownerVisibility.visibleTo,
    timelineReferences: item.timelineReferences,
    evidenceRequired: item.missingDataEffects
      .filter((effect) => effect.effect === "lowers_confidence" || effect.effect === "limits_visibility")
      .map((effect) => effect.field),
    reviewOnly: true,
  }));
}

export function relationshipTimelineProjectionToMcpDto(
  projection: RelationshipTimelineProjection,
): RelationshipTimelineMcpDto {
  return {
    relationshipId: projection.relationshipId,
    groups: projection.groups.map((group) => ({
      groupKind: group.groupKind,
      label: group.label,
      itemCount: group.items.length,
    })),
    evidenceRequired: projection.missingDataEffects
      .filter((effect) => effect.effect === "lowers_confidence" || effect.effect === "limits_visibility")
      .map((effect) => effect.field),
    reviewOnly: true,
  };
}
