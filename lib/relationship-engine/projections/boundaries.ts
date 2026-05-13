// Meridian Relationship Engine — projection boundaries.

import type { RelationshipSummaryProjectionBoundaryPolicy } from "./dto";

export const RELATIONSHIP_SUMMARY_PROJECTION_BOUNDARY: RelationshipSummaryProjectionBoundaryPolicy = {
  allowedInputs: [
    "RelationshipEntity",
    "TimelineEvent",
    "PromiseRecord",
    "HealthScoreTrace",
    "FollowUpInstruction",
  ],
  forbiddenInputs: [
    "React component state",
    "UI labels",
    "MCP free-form text",
    "Queue rank scores",
    "CRM status aliases",
    "Neon storage metadata",
    "Random values",
    "Wall-clock timestamps outside EngineContext.now",
  ],
  readOnly: true,
  deterministic: true,
  persistsProjection: false,
  computesProductionScore: false,
  mutatesRepositories: false,
};

export const RELATIONSHIP_SUMMARY_PROJECTION_RULES = [
  "RelationshipSummaryProjection reads canonical inputs and never mutates repositories.",
  "RelationshipSummaryProjection may expose missing data effects, but missing data must not create urgency.",
  "Lifecycle and warmth state come from RelationshipEntity unless a future canonical state projector replaces that source.",
  "Latest touchpoints, outcomes, activities, and timeline references come from normalized TimelineEvent objects only.",
  "Promise and follow-up counts come from PromiseRecord and FollowUpInstruction inputs only.",
  "Health score values may be copied from HealthScoreTrace but are never recalculated by the summary projector.",
  "Consumers such as UI, MCP tools, and queues should consume projections or projection mappers instead of parsing raw timeline events.",
] as const;
