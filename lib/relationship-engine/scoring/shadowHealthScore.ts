// Meridian Relationship Engine — shadow health score entrypoint.
//
// This is not production scoring. It emits an explainable placeholder trace so
// downstream systems can integrate against HealthScoreTrace without embedding
// hidden formulas. Future tests should assert score policy shape, evidence
// propagation, missing-data handling, and deterministic trace IDs.

import type { EvidenceRef, IsoDateString, RelationshipId, ScoreTraceId } from "../primitives";
import type { TimelineEvent } from "../timeline/events";
import type {
  HealthScoreComponentKey,
  HealthScoreTrace,
  HealthScoreTracePolicy,
  ScoreComponentTrace,
} from "./healthScoreTrace";

export const SHADOW_HEALTH_SCORE_MODEL_VERSION = "shadow-foundation-v0";

export const SHADOW_HEALTH_SCORE_POLICY: HealthScoreTracePolicy = {
  modelName: "relationship_health",
  modelVersion: SHADOW_HEALTH_SCORE_MODEL_VERSION,
  scoreRange: { min: 0, max: 100 },
  components: [
    { key: "recency", requiredEvidence: "one_event", defaultMissingDataPolicy: "not_observed", weight: 0 },
    { key: "responsiveness", requiredEvidence: "corroborated_event", defaultMissingDataPolicy: "not_observed", weight: 0 },
    { key: "promise_integrity", requiredEvidence: "one_event", defaultMissingDataPolicy: "not_observed", weight: 0 },
    { key: "lifecycle_fit", requiredEvidence: "operator_verified", defaultMissingDataPolicy: "unknown", weight: 0 },
    { key: "outcome_momentum", requiredEvidence: "one_event", defaultMissingDataPolicy: "not_observed", weight: 0 },
    { key: "warmth", requiredEvidence: "corroborated_event", defaultMissingDataPolicy: "not_observed", weight: 0 },
    { key: "risk", requiredEvidence: "operator_verified", defaultMissingDataPolicy: "unknown", weight: 0 },
  ],
  confidenceRules: [
    "Shadow traces do not calculate production scores.",
    "Missing data is explicit and lowers confidence rather than creating urgency.",
    "Evidence is carried through for future scoring fixtures.",
  ],
};

export interface ShadowHealthScoreInput {
  relationshipId: RelationshipId;
  computedAt: IsoDateString;
  timelineEvents?: TimelineEvent[];
  inputRelationshipVersion?: string;
  evidence?: EvidenceRef[];
}

export function buildShadowHealthScoreTrace(input: ShadowHealthScoreInput): HealthScoreTrace {
  const evidence = input.evidence ?? input.timelineEvents?.flatMap((event) => event.evidence) ?? [];
  const components = SHADOW_HEALTH_SCORE_POLICY.components.map<ScoreComponentTrace>((component) =>
    shadowComponent(component.key, evidence));

  return {
    id: shadowScoreTraceId(input),
    relationshipId: input.relationshipId,
    modelName: "relationship_health",
    modelVersion: SHADOW_HEALTH_SCORE_MODEL_VERSION,
    computedAt: input.computedAt,
    score: 0,
    confidence: "unknown",
    components,
    missingEvidence: SHADOW_HEALTH_SCORE_POLICY.components.map((component) => ({
      component: component.key,
      reason: component.defaultMissingDataPolicy,
      effect: "lowers_confidence",
    })),
    explanation: "Shadow health trace placeholder; no production score has been computed.",
    inputTimelineEventIds: input.timelineEvents?.map((event) => event.id) ?? [],
    ...(input.inputRelationshipVersion ? { inputRelationshipVersion: input.inputRelationshipVersion } : {}),
  };
}

function shadowComponent(
  key: HealthScoreComponentKey,
  evidence: EvidenceRef[],
): ScoreComponentTrace {
  return {
    key,
    label: key.replaceAll("_", " "),
    status: evidence.length > 0 ? "observed" : "missing",
    configuredWeight: 0,
    contribution: 0,
    evidence,
    missingDataPolicy: evidence.length > 0 ? undefined : "not_observed",
    explanation: "Shadow component only carries evidence; scoring formula is intentionally absent.",
    confidence: evidence.length > 0 ? "low" : "unknown",
  };
}

function shadowScoreTraceId(input: ShadowHealthScoreInput): ScoreTraceId {
  const eventIds = input.timelineEvents?.map((event) => event.id).join(",") ?? "";
  return `score-trace:shadow:${hash([input.relationshipId, input.computedAt, eventIds])}` as ScoreTraceId;
}

function hash(parts: string[]): string {
  let value = 2166136261;
  for (const char of parts.join("|")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}
