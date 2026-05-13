// Meridian Relationship Engine — health score trace contracts.
//
// Scores must be explainable projections of timeline + relationship evidence.
// This file defines trace shape only; it does not implement scoring formulas.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  MissingDataPolicy,
  RelationshipId,
  ScoreTraceId,
  TimelineEventId,
} from "../primitives";

export type HealthScoreComponentKey =
  | "recency"
  | "responsiveness"
  | "promise_integrity"
  | "lifecycle_fit"
  | "outcome_momentum"
  | "warmth"
  | "risk";

export type ScoreComponentStatus = "observed" | "missing" | "not_applicable";

export interface ScoreComponentTrace {
  key: HealthScoreComponentKey;
  label: string;
  status: ScoreComponentStatus;
  rawValue?: number;
  normalizedScore?: number;
  configuredWeight?: number;
  contribution?: number;
  evidence: EvidenceRef[];
  missingDataPolicy?: MissingDataPolicy;
  explanation: string;
  confidence: ConfidenceLevel;
}

export interface HealthScoreTrace {
  id: ScoreTraceId;
  relationshipId: RelationshipId;
  modelName: "relationship_health";
  modelVersion: string;
  computedAt: IsoDateString;
  score: number;
  confidence: ConfidenceLevel;
  components: ScoreComponentTrace[];
  missingEvidence: Array<{
    component: HealthScoreComponentKey;
    reason: MissingDataPolicy;
    effect: "lowers_confidence" | "neutral" | "not_applicable";
  }>;
  explanation: string;
  inputTimelineEventIds: TimelineEventId[];
  inputRelationshipVersion?: string;
}

export interface HealthScoreTracePolicy {
  modelName: "relationship_health";
  modelVersion: string;
  components: Array<{
    key: HealthScoreComponentKey;
    requiredEvidence: "none" | "one_event" | "corroborated_event" | "operator_verified";
    defaultMissingDataPolicy: MissingDataPolicy;
    weight: number;
  }>;
  scoreRange: { min: 0; max: 100 };
  confidenceRules: string[];
}
