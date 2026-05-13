// Meridian Relationship Engine — canonical relationship entities.

import type {
  AuditStamp,
  ConfidenceLevel,
  EvidenceRef,
  ExternalEntityRef,
  IsoDateString,
  NonEmptyString,
  OperatorId,
  RelationshipId,
  WorkspaceId,
} from "../primitives";
import type { LifecycleState } from "./lifecycle";

export type RelationshipKind =
  | "person"
  | "company"
  | "household"
  | "partner"
  | "account"
  | "unknown";

export type RelationshipWarmthBand = "cold" | "cool" | "warm" | "hot" | "unknown";

export interface RelationshipWarmth {
  band: RelationshipWarmthBand;
  score: number;
  lastMeaningfulTouchpointAt?: IsoDateString;
  decayStartedAt?: IsoDateString;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface OperatorAssignment {
  ownerId: OperatorId;
  assignedAt: IsoDateString;
  assignedBy?: OperatorId | "system";
  reason?: string;
  visibility: "primary_owner" | "collaborator" | "observer";
}

export interface RelationshipIdentity {
  displayName: NonEmptyString;
  normalizedName: string;
  kind: RelationshipKind;
  primaryEmail?: string;
  primaryPhone?: string;
  primaryLocation?: string;
  externalRefs: ExternalEntityRef[];
}

export interface RelationshipEntity {
  id: RelationshipId;
  workspaceId: WorkspaceId;
  identity: RelationshipIdentity;
  lifecycle: LifecycleState;
  warmth: RelationshipWarmth;
  assignments: OperatorAssignment[];
  tags?: string[];
  attributes?: Record<string, string | number | boolean | null>;
  audit: AuditStamp;
}

export type RelationshipEventKind =
  | "relationship_created"
  | "relationship_merged"
  | "relationship_split"
  | "identity_updated"
  | "attribute_updated";

export interface RelationshipEvent {
  id: string;
  relationshipId: RelationshipId;
  kind: RelationshipEventKind;
  occurredAt: IsoDateString;
  source: "engine" | "operator" | "api" | "mcp" | "integration";
  evidence: EvidenceRef[];
  payload: Record<string, unknown>;
}

export interface RelationshipSummary {
  relationshipId: RelationshipId;
  displayName: string;
  lifecycle: LifecycleState;
  warmth: RelationshipWarmthBand;
  ownerId?: OperatorId;
  lastTouchpointAt?: IsoDateString;
  nextFollowUpAt?: IsoDateString;
  openPromiseCount: number;
  overduePromiseCount: number;
  latestOutcomeLabel?: string;
  healthScore?: number;
  healthConfidence: ConfidenceLevel;
  summaryGeneratedAt: IsoDateString;
}
