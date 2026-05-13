// Meridian Relationship Engine — timeline integrity validation.
//
// This module is runtime guardrail code for normalized TimelineEvent objects.
// It keeps taxonomy, evidence, confidence, timestamps, and category payloads
// explicit before timeline memory can feed scoring, queues, or summaries.

import type { ConfidenceLevel, EvidenceRef } from "../primitives";
import type {
  TimelineEvent,
  TimelineEventCategory,
  TimelineEventSource,
} from "./events";
import { UNKNOWN_OCCURRED_AT } from "./normalizers/common";

export const TIMELINE_EVENT_TYPES_BY_CATEGORY = {
  touchpoint: [
    "touchpoint_logged",
    "call_completed",
    "email_sent",
    "email_received",
    "meeting_completed",
    "note_added",
  ],
  promise: [
    "promise_created",
    "promise_updated",
    "promise_fulfilled",
    "promise_missed",
    "promise_cancelled",
  ],
  lifecycle: ["lifecycle_transitioned"],
  follow_up: [
    "follow_up_scheduled",
    "follow_up_completed",
    "follow_up_missed",
    "follow_up_snoozed",
  ],
  referral: ["referral_given", "referral_received", "referral_requested"],
  outcome: ["outcome_recorded", "outcome_updated", "outcome_reversed"],
  owner_assignment: ["owner_assigned", "owner_reassigned", "owner_removed"],
  system: [
    "relationship_created",
    "relationship_merged",
    "relationship_split",
    "identity_resolved",
    "score_recomputed",
    "queue_candidate_generated",
  ],
} as const satisfies Record<TimelineEventCategory, readonly string[]>;

export type TimelineIntegritySeverity = "error" | "warning";

export interface TimelineIntegrityIssue {
  severity: TimelineIntegritySeverity;
  code: string;
  message: string;
}

export interface TimelineIntegrityValidationResult {
  ok: boolean;
  issues: TimelineIntegrityIssue[];
}

const VALID_CONFIDENCE: ConfidenceLevel[] = ["high", "medium", "low", "unknown"];
const VALID_SOURCE: TimelineEventSource[] = ["operator", "engine", "mcp", "api", "integration"];

export function validateTimelineEventIntegrity(event: TimelineEvent): TimelineIntegrityValidationResult {
  const issues: TimelineIntegrityIssue[] = [];

  if (!event.id || !event.id.startsWith("timeline:")) {
    issues.push(error("invalid_event_id", "Timeline events require a stable timeline: event id."));
  }
  if (!event.relationshipId) {
    issues.push(error("missing_relationship_id", "Timeline events require a relationshipId."));
  }
  if (!TIMELINE_EVENT_TYPES_BY_CATEGORY[event.category]?.includes(event.type as never)) {
    issues.push(error(
      "invalid_category_type",
      `Timeline event type ${event.type} is not valid for category ${event.category}.`,
    ));
  }
  if (!isValidIso(event.occurredAt)) {
    issues.push(error("invalid_occurred_at", "Timeline events require a valid occurredAt ISO timestamp."));
  }
  if (!isValidIso(event.recordedAt)) {
    issues.push(error("invalid_recorded_at", "Timeline events require a valid recordedAt ISO timestamp."));
  }
  if (isValidIso(event.occurredAt) && isValidIso(event.recordedAt) && event.recordedAt < event.occurredAt) {
    issues.push(warning("recorded_before_occurred", "recordedAt is earlier than occurredAt; source clock ordering should be reviewed."));
  }
  if (event.occurredAt === UNKNOWN_OCCURRED_AT && !["low", "unknown"].includes(event.confidence)) {
    issues.push(error(
      "unknown_time_confidence",
      "Events with fallback occurredAt must lower confidence to low or unknown.",
    ));
  }
  if (!VALID_SOURCE.includes(event.source)) {
    issues.push(error("invalid_source", `Timeline event source ${event.source} is not canonical.`));
  }
  if (!VALID_CONFIDENCE.includes(event.confidence)) {
    issues.push(error("invalid_confidence", `Timeline event confidence ${event.confidence} is not canonical.`));
  }
  if (!event.dedupeKey || event.dedupeKey.trim().length === 0) {
    issues.push(error("missing_dedupe_key", "Timeline events require a dedupeKey before repository append."));
  }
  issues.push(...validateEvidenceRefs(event.evidence));
  issues.push(...validateCategoryPayload(event));

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues,
  };
}

function validateCategoryPayload(event: TimelineEvent): TimelineIntegrityIssue[] {
  switch (event.category) {
    case "touchpoint":
      return [
        ...validateEvidenceRefs(event.touchpoint.evidence, "touchpoint"),
        ...(!event.touchpoint.id ? [error("missing_touchpoint_id", "Touchpoint events require touchpoint.id.")] : []),
      ];
    case "promise":
      return event.summary.trim().length > 0
        ? []
        : [error("missing_promise_summary", "Promise events require a summary.")];
    case "lifecycle":
      return [
        ...(event.from === event.to
          ? [error("idempotent_lifecycle_event", "Same-state writes should not create lifecycle transition events.")]
          : []),
        ...(event.reason.trim().length > 0
          ? []
          : [error("missing_lifecycle_reason", "Lifecycle events require an explicit reason.")]),
      ];
    case "follow_up":
      return event.reason.trim().length > 0
        ? []
        : [error("missing_follow_up_reason", "Follow-up events require a reason.")];
    case "referral":
      return event.description.trim().length > 0
        ? []
        : [error("missing_referral_description", "Referral events require a description.")];
    case "outcome":
      return [
        ...validateEvidenceRefs(event.outcome.evidence, "outcome"),
        ...(!event.outcome.id ? [error("missing_outcome_id", "Outcome events require outcome.id.")] : []),
      ];
    case "owner_assignment":
      return event.reason.trim().length > 0
        ? []
        : [error("missing_owner_assignment_reason", "Owner assignment events require a reason.")];
    case "system":
      return Object.keys(event.details).length > 0
        ? []
        : [warning("empty_system_details", "System events should explain their details payload.")];
  }
}

function validateEvidenceRefs(
  evidence: EvidenceRef[],
  prefix = "event",
): TimelineIntegrityIssue[] {
  const issues: TimelineIntegrityIssue[] = [];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return [error(`missing_${prefix}_evidence`, "Timeline events require at least one evidence reference.")];
  }
  for (const ref of evidence) {
    if (!ref.id || ref.id.trim().length === 0) {
      issues.push(error(`missing_${prefix}_evidence_id`, "Evidence requires a stable id."));
    }
    if (!ref.source || ref.source.trim().length === 0) {
      issues.push(error(`missing_${prefix}_evidence_source`, "Evidence requires a source."));
    }
    if (!ref.label || ref.label.trim().length === 0) {
      issues.push(error(`missing_${prefix}_evidence_label`, "Evidence requires a label."));
    }
    if (!isValidIso(ref.observedAt)) {
      issues.push(error(`invalid_${prefix}_evidence_observed_at`, "Evidence requires a valid observedAt ISO timestamp."));
    }
    if (!VALID_CONFIDENCE.includes(ref.confidence)) {
      issues.push(error(`invalid_${prefix}_evidence_confidence`, `Evidence confidence ${ref.confidence} is not canonical.`));
    }
  }
  return issues;
}

function isValidIso(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
}

function error(code: string, message: string): TimelineIntegrityIssue {
  return { severity: "error", code, message };
}

function warning(code: string, message: string): TimelineIntegrityIssue {
  return { severity: "warning", code, message };
}
