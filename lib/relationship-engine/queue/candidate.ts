// Meridian Relationship Engine — queue candidate contracts.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  QueueCandidateId,
  RelationshipId,
} from "../primitives";
import type { RelationshipSummary, RelationshipWarmthBand } from "../relationship/entities";
import type { HealthScoreTrace } from "../scoring/healthScoreTrace";

export type NextBestActionKind =
  | "call"
  | "email"
  | "schedule_meeting"
  | "send_follow_up"
  | "fulfill_promise"
  | "ask_for_referral"
  | "reactivate"
  | "review_manually";

export type QueueEscalationReason =
  | "overdue_follow_up"
  | "missed_promise"
  | "retention_risk"
  | "warmth_decay"
  | "opportunity_window"
  | "owner_unassigned"
  | "manual_escalation";

export interface OverdueMetadata {
  dueAt: IsoDateString;
  overdueSince: IsoDateString;
  overdueDays: number;
  source: "follow_up" | "promise" | "lifecycle_policy";
}

export interface WarmthDecayMetadata {
  previousBand: RelationshipWarmthBand;
  currentBand: RelationshipWarmthBand;
  decayStartedAt: IsoDateString;
  lastMeaningfulTouchpointAt?: IsoDateString;
}

export interface NextBestAction {
  kind: NextBestActionKind;
  label: string;
  reason: string;
  expectedOutcome?: string;
  requiredEvidenceBeforeAction?: string[];
}

export interface QueueCandidate {
  id: QueueCandidateId;
  relationshipId: RelationshipId;
  ownerId?: OperatorId;
  generatedAt: IsoDateString;
  rankScore: number;
  whyNow: string;
  nextBestAction: NextBestAction;
  summary: RelationshipSummary;
  healthTrace?: HealthScoreTrace;
  overdue?: OverdueMetadata;
  warmthDecay?: WarmthDecayMetadata;
  visibleTo: OperatorId[];
  confidence: ConfidenceLevel;
  escalationReason?: QueueEscalationReason;
  evidence: EvidenceRef[];
}
