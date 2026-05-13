// Meridian Relationship Engine — read-only projection consumer mappers.

import type { RelationshipMcpDto } from "../dto/boundaries";
import type { RelationshipSummary } from "../relationship/entities";
import type { RelationshipSummaryProjection } from "./dto";

export interface RelationshipSummaryProjectionMcpOptions {
  allowedActions?: string[];
  evidenceRequired?: string[];
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
