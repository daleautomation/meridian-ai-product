// Meridian Relationship Engine — queue candidate skeleton builder.
//
// This module enforces the candidate contract without ranking, automating, or
// dispatching work. Production queue generation must add fixture coverage for
// why-now text, evidence, owner visibility, rank determinism, and tie-breakers.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  QueueCandidateId,
} from "../primitives";
import type { RelationshipSummary } from "../relationship/entities";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";
import type {
  NextBestAction,
  QueueCandidate,
  QueueEscalationReason,
} from "./candidate";
import type { RelationshipSummaryProjection } from "../projections/dto";

export type QueueCandidateSummaryInput = RelationshipSummary | RelationshipSummaryProjection;

export interface QueueCandidateSkeletonInput {
  summary: QueueCandidateSummaryInput;
  generatedAt: IsoDateString;
  whyNow: string;
  nextBestAction: NextBestAction;
  evidence: EvidenceRef[];
  visibleTo: OperatorId[];
  ownerId?: OperatorId;
  rankScore?: number;
  confidence?: ConfidenceLevel;
  healthTrace?: HealthScoreTrace;
  escalationReason?: QueueEscalationReason;
}

export interface QueueCandidateRequirementFailure {
  field: "whyNow" | "evidence" | "visibleTo" | "nextBestAction";
  message: string;
}

export class InvalidQueueCandidateError extends Error {
  readonly failures: QueueCandidateRequirementFailure[];

  constructor(failures: QueueCandidateRequirementFailure[]) {
    super(`Queue candidate failed ${failures.length} requirement(s).`);
    this.name = "InvalidQueueCandidateError";
    this.failures = failures;
  }
}

export function validateQueueCandidateSkeleton(
  input: QueueCandidateSkeletonInput,
): QueueCandidateRequirementFailure[] {
  const failures: QueueCandidateRequirementFailure[] = [];
  if (input.whyNow.trim().length === 0) {
    failures.push({ field: "whyNow", message: "Queue candidates require an explicit why-now explanation." });
  }
  if (input.evidence.length === 0) {
    failures.push({ field: "evidence", message: "Queue candidates require at least one evidence reference." });
  }
  if (input.visibleTo.length === 0) {
    failures.push({ field: "visibleTo", message: "Queue candidates require at least one visible operator." });
  }
  if (input.nextBestAction.reason.trim().length === 0) {
    failures.push({ field: "nextBestAction", message: "Next best action requires a reason." });
  }
  return failures;
}

export function buildQueueCandidateSkeleton(input: QueueCandidateSkeletonInput): QueueCandidate {
  const failures = validateQueueCandidateSkeleton(input);
  if (failures.length > 0) throw new InvalidQueueCandidateError(failures);
  const summary = resolveQueueSummary(input.summary);

  return {
    id: deterministicCandidateId(input),
    relationshipId: summary.relationshipId,
    ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    generatedAt: input.generatedAt,
    rankScore: input.rankScore ?? 0,
    whyNow: input.whyNow,
    nextBestAction: input.nextBestAction,
    summary,
    ...(input.healthTrace ? { healthTrace: input.healthTrace } : {}),
    visibleTo: input.visibleTo,
    confidence: input.confidence ?? "unknown",
    ...(input.escalationReason ? { escalationReason: input.escalationReason } : {}),
    evidence: input.evidence,
  };
}

export function noQueueCandidates(reason: string): {
  candidates: QueueCandidate[];
  reason: string;
} {
  return {
    candidates: [],
    reason,
  };
}

function deterministicCandidateId(input: QueueCandidateSkeletonInput): QueueCandidateId {
  const summary = resolveQueueSummary(input.summary);
  const parts = [
    summary.relationshipId,
    input.generatedAt,
    input.whyNow,
    input.nextBestAction.kind,
    input.visibleTo.join(","),
  ];
  return `queue-candidate:${hash(parts)}` as QueueCandidateId;
}

function resolveQueueSummary(input: QueueCandidateSummaryInput): RelationshipSummary {
  return "summary" in input && input.kind === "relationship_summary" ? input.summary : input;
}

function hash(parts: string[]): string {
  let value = 2166136261;
  for (const char of parts.join("|")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}
