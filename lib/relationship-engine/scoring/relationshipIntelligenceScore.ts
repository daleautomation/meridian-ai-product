// Bridge relationship-intelligence scoring into health score trace shape.

import type { RelationshipId, IsoDateString } from "../primitives";
import type { HealthScoreTrace, ScoreComponentTrace } from "./healthScoreTrace";
import { computeRelationshipScore, type RelationshipScoreFactor } from "@/lib/relationship-intelligence/scoring";

export const RELATIONSHIP_INTELLIGENCE_MODEL_VERSION = "relationship-intelligence-v1";

const FACTOR_TO_COMPONENT: Partial<Record<RelationshipScoreFactor, ScoreComponentTrace["key"]>> = {
  recency: "recency",
  response_history: "responsiveness",
  relationship_strength: "warmth",
  dormant_opportunity_boost: "risk",
  missing_data_penalty: "risk",
};

export function buildRelationshipIntelligenceHealthTrace(input: {
  relationshipId: RelationshipId;
  computedAt: IsoDateString;
  lastInteractionAt: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  tags?: string[];
}): HealthScoreTrace {
  const score = computeRelationshipScore({
    lastInteractionAt: input.lastInteractionAt,
    tags: input.tags ?? [],
    hasPhone: input.hasPhone,
    hasEmail: input.hasEmail,
    notesLength: 0,
  });

  const components: ScoreComponentTrace[] = score.factors.map((factor) => ({
    key: FACTOR_TO_COMPONENT[factor.factor] ?? "lifecycle_fit",
    label: factor.label,
    status: factor.confidence === "unknown" ? "missing" : "observed",
    normalizedScore: factor.score,
    configuredWeight: factor.weight,
    contribution: factor.contribution,
    evidence: [],
    explanation: factor.explanation,
    confidence: factor.confidence === "high" ? "high" : factor.confidence === "medium" ? "medium" : "low",
  }));

  return {
    id: `score-trace:ri:${input.relationshipId}:${input.computedAt}` as HealthScoreTrace["id"],
    relationshipId: input.relationshipId,
    modelName: "relationship_health",
    modelVersion: RELATIONSHIP_INTELLIGENCE_MODEL_VERSION,
    computedAt: input.computedAt,
    score: score.total,
    confidence: score.confidence,
    components,
    missingEvidence: score.missingDataFlags.map((flag) => ({
      component: "lifecycle_fit",
      reason: "unknown",
      effect: "lowers_confidence" as const,
    })),
    explanation: score.explanation,
    inputTimelineEventIds: [],
  };
}
