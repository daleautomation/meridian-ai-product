// Meridian Relationship Engine — canonical relationship memory.
//
// Timeline events are immutable facts. Views, queues, scores, and summaries
// project from this taxonomy rather than inventing their own memory models.

import type {
  ConfidenceLevel,
  EvidenceRef,
  IsoDateString,
  OperatorId,
  OutcomeId,
  PromiseId,
  RelationshipId,
  TimelineEventId,
  TouchpointId,
} from "../primitives";
import type { LifecycleState } from "../relationship/lifecycle";

export type TimelineEventCategory =
  | "touchpoint"
  | "promise"
  | "lifecycle"
  | "follow_up"
  | "referral"
  | "outcome"
  | "owner_assignment"
  | "system";

export type TimelineEventSource = "operator" | "engine" | "mcp" | "api" | "integration";

export interface TimelineEventBase {
  id: TimelineEventId;
  relationshipId: RelationshipId;
  category: TimelineEventCategory;
  type: string;
  occurredAt: IsoDateString;
  recordedAt: IsoDateString;
  source: TimelineEventSource;
  actorId?: OperatorId | "system";
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
  dedupeKey?: string;
}

export type TouchpointChannel =
  | "call"
  | "email"
  | "sms"
  | "meeting"
  | "social"
  | "note"
  | "site_visit"
  | "other";

export type TouchpointDirection = "inbound" | "outbound" | "internal" | "unknown";

export interface Touchpoint {
  id: TouchpointId;
  relationshipId: RelationshipId;
  channel: TouchpointChannel;
  direction: TouchpointDirection;
  occurredAt: IsoDateString;
  subject?: string;
  bodyPreview?: string;
  operatorId?: OperatorId;
  externalMessageId?: string;
  evidence: EvidenceRef[];
}

export interface TouchpointTimelineEvent extends TimelineEventBase {
  category: "touchpoint";
  type:
    | "touchpoint_logged"
    | "call_completed"
    | "email_sent"
    | "email_received"
    | "meeting_completed"
    | "note_added";
  touchpoint: Touchpoint;
}

export interface PromiseTimelineEvent extends TimelineEventBase {
  category: "promise";
  type:
    | "promise_created"
    | "promise_updated"
    | "promise_fulfilled"
    | "promise_missed"
    | "promise_cancelled";
  promiseId: PromiseId;
  dueAt?: IsoDateString;
  ownerId?: OperatorId;
  summary: string;
}

export interface LifecycleTimelineEvent extends TimelineEventBase {
  category: "lifecycle";
  type: "lifecycle_transitioned";
  from: LifecycleState;
  to: LifecycleState;
  reason: string;
}

export interface FollowUpTimelineEvent extends TimelineEventBase {
  category: "follow_up";
  type:
    | "follow_up_scheduled"
    | "follow_up_completed"
    | "follow_up_missed"
    | "follow_up_snoozed";
  dueAt?: IsoDateString;
  completedAt?: IsoDateString;
  ownerId?: OperatorId;
  reason: string;
}

export interface ReferralTimelineEvent extends TimelineEventBase {
  category: "referral";
  type: "referral_given" | "referral_received" | "referral_requested";
  referredRelationshipId?: RelationshipId;
  description: string;
}

export type OutcomeKind =
  | "meeting_booked"
  | "deal_won"
  | "deal_lost"
  | "retained"
  | "referral_created"
  | "no_response"
  | "not_fit"
  | "other";

export interface OutcomeRecord {
  id: OutcomeId;
  relationshipId: RelationshipId;
  kind: OutcomeKind;
  label: string;
  occurredAt: IsoDateString;
  value?: number;
  notes?: string;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
}

export interface OutcomeTimelineEvent extends TimelineEventBase {
  category: "outcome";
  type: "outcome_recorded" | "outcome_updated" | "outcome_reversed";
  outcome: OutcomeRecord;
}

export interface OwnerAssignmentTimelineEvent extends TimelineEventBase {
  category: "owner_assignment";
  type: "owner_assigned" | "owner_reassigned" | "owner_removed";
  fromOwnerId?: OperatorId;
  toOwnerId?: OperatorId;
  reason: string;
}

export interface SystemTimelineEvent extends TimelineEventBase {
  category: "system";
  type:
    | "relationship_created"
    | "relationship_merged"
    | "relationship_split"
    | "identity_resolved"
    | "score_recomputed"
    | "queue_candidate_generated";
  details: Record<string, unknown>;
}

export type TimelineEvent =
  | TouchpointTimelineEvent
  | PromiseTimelineEvent
  | LifecycleTimelineEvent
  | FollowUpTimelineEvent
  | ReferralTimelineEvent
  | OutcomeTimelineEvent
  | OwnerAssignmentTimelineEvent
  | SystemTimelineEvent;
