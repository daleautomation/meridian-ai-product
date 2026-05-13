// Meridian Relationship Engine — read-only source DTO boundaries.
//
// These shapes intentionally mirror only the fields needed to project legacy
// LaborTech data into canonical TimelineEvent facts. They do not import from
// crmStore, followUpStore, eventLog, or executionOutcome modules so the engine
// cannot accidentally couple to storage, UI, MCP, or write paths.

export interface SourceRelationshipRef {
  relationshipId?: string | null;
  workspace?: string | null;
  companyKey?: string | null;
  crmKey?: string | null;
  leadId?: string | null;
  taskId?: string | null;
  companyName?: string | null;
}

export interface SourceCrmActivity extends SourceRelationshipRef {
  id: string;
  companyKey: string;
  companyName: string;
  performedAt: string;
  activityType: string;
  performedBy: string;
  outcome: string | null;
  note: string;
  summary?: string;
  noteTag?: string;
  nextAction?: string;
  nextActionDate?: string;
  strategicRecommendation?: string;
  closeConfidence?: number;
  metadata?: Record<string, unknown>;
}

export interface SourceFollowUpTask extends SourceRelationshipRef {
  id: string;
  companyKey: string;
  companyName: string;
  taskType: string;
  title: string;
  description?: string;
  dueAt?: string;
  status: "open" | "completed" | "cancelled" | string;
  assignedUserId?: string;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  completedBy?: string;
}

export interface SourceUsageEvent extends SourceRelationshipRef {
  eventId?: string;
  eventType: string;
  userId: string | null;
  operatorId?: string | null;
  workspace: string | null;
  leadId: string | null;
  taskId: string | null;
  companyKey?: string | null;
  crmKey?: string | null;
  companyName: string | null;
  sourceSurface?: string | null;
  previousStatus?: string | null;
  nextStatus?: string | null;
  outcomeStatus?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  estimatedValue?: number | null;
  meridianInfluenced?: boolean;
  influenceReason?: string | null;
  occurredAt?: string | null;
  recordedAt?: string | null;
  idempotencyKey?: string | null;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface SourceExecutionOutcome extends SourceRelationshipRef {
  eventId: string;
  workspace: string;
  companyKey: string | null;
  crmKey: string | null;
  leadId: string | null;
  taskId: string | null;
  operatorId: string;
  sourceSurface: string;
  outcomeStatus: string;
  previousStatus: string | null;
  nextStatus: string;
  occurredAt: string;
  recordedAt: string;
  nextAction: string | null;
  nextActionDate: string | null;
  estimatedValue: number | null;
  meridianInfluenced: boolean;
  influenceReason: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
}

export interface TimelineNormalizationContext {
  now: string;
  workspaceId?: string;
  defaultRecordedAt?: string;
}

export type TimelineSourceKind =
  | "crm_activity"
  | "follow_up_task"
  | "usage_event"
  | "execution_outcome";

export type TimelineNormalizationWarningSource =
  | TimelineSourceKind
  | "timeline_event";

export interface TimelineNormalizationWarning {
  source: TimelineNormalizationWarningSource;
  sourceId: string;
  reason: string;
}
