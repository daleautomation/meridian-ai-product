// Meridian Relationship Engine — shared domain primitives.
//
// Contract-only types. No persistence, UI, MCP, or vertical-specific imports.

type Brand<T, B extends string> = T & { readonly __brand: B };

export type RelationshipId = Brand<string, "RelationshipId">;
export type TimelineEventId = Brand<string, "TimelineEventId">;
export type OperationalEventId = Brand<string, "OperationalEventId">;
export type OperationalEventDedupeKey = Brand<string, "OperationalEventDedupeKey">;
export type OperationalEventIdempotencyKey = Brand<string, "OperationalEventIdempotencyKey">;
export type TouchpointId = Brand<string, "TouchpointId">;
export type PromiseId = Brand<string, "PromiseId">;
export type FollowUpPolicyId = Brand<string, "FollowUpPolicyId">;
export type OutcomeId = Brand<string, "OutcomeId">;
export type OperatorId = Brand<string, "OperatorId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type VerticalId = Brand<string, "VerticalId">;
export type QueueCandidateId = Brand<string, "QueueCandidateId">;
export type ScoreTraceId = Brand<string, "ScoreTraceId">;

export type IsoDateString = Brand<string, "IsoDateString">;
export type NonEmptyString = Brand<string, "NonEmptyString">;

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type SourceSystem =
  | "engine"
  | "operator"
  | "mcp"
  | "api"
  | "calendar"
  | "email"
  | "crm"
  | "import"
  | "integration";

export interface ExternalEntityRef {
  source: SourceSystem | string;
  sourceId: string;
  sourceUrl?: string;
  observedAt?: IsoDateString;
}

export interface EvidenceRef {
  id: string;
  source: SourceSystem | string;
  label: string;
  value?: string | number | boolean;
  observedAt: IsoDateString;
  confidence: ConfidenceLevel;
  url?: string;
  notes?: string;
}

export interface AuditStamp {
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  createdBy?: OperatorId | "system";
  updatedBy?: OperatorId | "system";
}

export interface EngineContext {
  workspaceId: WorkspaceId;
  verticalId?: VerticalId;
  now: IsoDateString;
}

export type MissingDataPolicy =
  | "unknown"
  | "not_applicable"
  | "withheld"
  | "not_observed"
  | "source_unavailable";
