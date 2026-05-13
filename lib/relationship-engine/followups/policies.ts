// Meridian Relationship Engine — follow-up and promise contracts.

import type {
  ConfidenceLevel,
  EvidenceRef,
  FollowUpPolicyId,
  IsoDateString,
  OperatorId,
  PromiseId,
  RelationshipId,
} from "../primitives";
import type { LifecycleState } from "../relationship/lifecycle";

export type FollowUpCadenceUnit = "hours" | "days" | "weeks" | "months";

export interface FollowUpCadenceWindow {
  value: number;
  unit: FollowUpCadenceUnit;
  graceValue?: number;
  graceUnit?: FollowUpCadenceUnit;
}

export interface FollowUpPolicy {
  id: FollowUpPolicyId;
  label: string;
  defaultCadence: FollowUpCadenceWindow;
  maxSilenceWindow?: FollowUpCadenceWindow;
  appliesToLifecycle: LifecycleState[];
  escalationAfterMisses?: number;
  requiredEvidenceForCompletion: boolean;
  active: boolean;
}

export type PromiseStatus = "open" | "fulfilled" | "missed" | "cancelled" | "superseded";

export interface PromiseRecord {
  id: PromiseId;
  relationshipId: RelationshipId;
  title: string;
  description?: string;
  status: PromiseStatus;
  promisedBy: OperatorId | "relationship" | "system";
  ownerId?: OperatorId;
  createdAt: IsoDateString;
  dueAt?: IsoDateString;
  fulfilledAt?: IsoDateString;
  cancelledAt?: IsoDateString;
  supersededByPromiseId?: PromiseId;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface FollowUpInstruction {
  relationshipId: RelationshipId;
  policyId?: FollowUpPolicyId;
  ownerId?: OperatorId;
  dueAt: IsoDateString;
  reason: string;
  source: "operator" | "engine" | "promise" | "lifecycle" | "outcome";
  confidence: ConfidenceLevel;
  evidence: EvidenceRef[];
}
