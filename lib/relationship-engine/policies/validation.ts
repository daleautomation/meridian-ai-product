// Meridian Relationship Engine — production validation requirements.

export type ValidationSeverity = "error" | "warning";

export interface ValidationRequirement {
  area:
    | "lifecycle_transition"
    | "score_trace"
    | "timeline_normalization"
    | "queue_ranking"
    | "relationship_summary";
  severity: ValidationSeverity;
  requirement: string;
}

export const RELATIONSHIP_ENGINE_VALIDATION_REQUIREMENTS: ValidationRequirement[] = [
  {
    area: "lifecycle_transition",
    severity: "error",
    requirement: "Every transition must be checked against ALLOWED_LIFECYCLE_TRANSITIONS and recorded as a lifecycle timeline event with evidence or operator rationale.",
  },
  {
    area: "score_trace",
    severity: "error",
    requirement: "Every emitted score must include component traces, configured weights, evidence refs, missing-data effects, model name, and model version.",
  },
  {
    area: "timeline_normalization",
    severity: "error",
    requirement: "Every inbound event must normalize into exactly one TimelineEvent category/type pair with relationshipId, occurredAt, recordedAt, source, confidence, and dedupeKey when available.",
  },
  {
    area: "queue_ranking",
    severity: "error",
    requirement: "Every queue candidate must include whyNow, nextBestAction, rankScore, owner visibility, confidence, and evidence; missing data may lower confidence but may not create urgency.",
  },
  {
    area: "relationship_summary",
    severity: "warning",
    requirement: "Summaries must be projections from RelationshipEntity, TimelineEvent, PromiseRecord, and HealthScoreTrace only; no UI labels or storage-only fields.",
  },
];
