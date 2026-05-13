import assert from "node:assert/strict";
import {
  LIFECYCLE_STATE,
  UNKNOWN_OCCURRED_AT,
  normalizeTimelineSources,
  validateLifecycleTransition,
  validateTimelineEventIntegrity,
  type SourceCrmActivity,
  type SourceFollowUpTask,
  type TimelineEvent,
} from "@/lib/relationship-engine";

const now = "2026-05-13T15:30:00.000Z";
const context = { now, workspaceId: "workspace:test" };

const crmCall: SourceCrmActivity = {
  id: "crm-call-1",
  companyKey: "company:alpha",
  companyName: "Alpha Roofing",
  performedAt: "2026-05-13T12:00:00.000Z",
  activityType: "call",
  performedBy: "operator-1",
  outcome: "connected",
  note: "Talked with owner.",
};

const crmEmail: SourceCrmActivity = {
  ...crmCall,
  id: "crm-email-1",
  performedAt: "2026-05-13T12:00:00.000Z",
  activityType: "email",
  note: "Sent recap.",
};

const replayA = normalizeTimelineSources({
  context,
  crmActivities: [crmCall, crmEmail],
});
const replayB = normalizeTimelineSources({
  context,
  crmActivities: [crmEmail, crmCall],
});
assert.deepEqual(
  replayA.events.map((event) => event.id),
  replayB.events.map((event) => event.id),
  "timeline ordering must be stable regardless of source input order",
);

const duplicateImport = normalizeTimelineSources({
  context,
  crmActivities: [crmCall, { ...crmCall }],
});
assert.equal(duplicateImport.events.length, 1, "duplicate imports must collapse to one timeline event");
assert.ok(
  duplicateImport.warnings.some((warning) => warning.reason.includes("duplicate_event")),
  "duplicate imports must emit an explainable warning",
);
assert.equal(
  duplicateImport.events[0].id,
  normalizeTimelineSources({ context, crmActivities: [crmCall] }).events[0].id,
  "duplicate handling must preserve the stable event identity",
);

const invalidEvidence = validateTimelineEventIntegrity({
  ...replayA.events[0],
  evidence: [],
});
assert.equal(invalidEvidence.ok, false, "events without evidence must fail integrity validation");
assert.ok(
  invalidEvidence.issues.some((issue) => issue.code === "missing_event_evidence"),
  "missing evidence must produce a specific validation code",
);

const invalidTaxonomy = validateTimelineEventIntegrity({
  ...replayA.events[0],
  type: "owner_assigned",
} as unknown as TimelineEvent);
assert.equal(invalidTaxonomy.ok, false, "non-overlapping taxonomy must reject cross-category event types");
assert.ok(
  invalidTaxonomy.issues.some((issue) => issue.code === "invalid_category_type"),
  "taxonomy failures must identify invalid category/type pairs",
);

const invalidTimestamp = normalizeTimelineSources({
  context,
  crmActivities: [{
    ...crmCall,
    id: "crm-invalid-time",
    performedAt: "not-a-date",
  }],
});
assert.equal(invalidTimestamp.events.length, 1, "invalid source timestamps should remain inspectable as low-confidence memory");
assert.equal(invalidTimestamp.events[0].occurredAt, UNKNOWN_OCCURRED_AT, "invalid occurredAt must use the stable unknown timestamp");
assert.equal(invalidTimestamp.events[0].confidence, "low", "invalid source timestamps must lower confidence");

const invalidDueFollowUp: SourceFollowUpTask = {
  id: "fu-invalid-due",
  companyKey: "company:alpha",
  companyName: "Alpha Roofing",
  taskType: "follow_up_call",
  title: "Call back",
  dueAt: "0000-not-a-date",
  status: "open",
  assignedUserId: "operator-1",
  createdBy: "operator-1",
  createdAt: "2026-05-13T13:00:00.000Z",
};
const invalidDueResult = normalizeTimelineSources({
  context,
  followUpTasks: [invalidDueFollowUp],
});
assert.equal(invalidDueResult.events.length, 1, "invalid optional due dates should not drop the source fact");
assert.equal(invalidDueResult.events[0].type, "follow_up_scheduled", "invalid due dates must not fabricate missed follow-up urgency");
assert.equal("dueAt" in invalidDueResult.events[0], false, "invalid due dates must be omitted from canonical payloads");

const validLifecycle = validateLifecycleTransition({
  from: LIFECYCLE_STATE.ACTIVE,
  to: LIFECYCLE_STATE.RETAINED,
  reason: "Closed retained deal",
  evidence: replayA.events[0].evidence,
  requireEvidence: true,
});
assert.equal(validLifecycle.ok, true, "valid lifecycle transitions with evidence should pass");

const invalidLifecycle = validateLifecycleTransition({
  from: LIFECYCLE_STATE.CLOSED_LOST,
  to: LIFECYCLE_STATE.ACTIVE,
  reason: "Implicit reopen",
  evidence: replayA.events[0].evidence,
  requireEvidence: true,
});
assert.equal(invalidLifecycle.ok, false, "terminal lifecycle states must stay protected");
assert.equal(invalidLifecycle.code, "invalid_transition", "invalid lifecycle transitions need a stable code");

console.log("timeline normalization validation check passed", {
  stableEventIds: replayA.events.map((event) => event.id),
  duplicateWarnings: duplicateImport.warnings.length,
  invalidTimestampConfidence: invalidTimestamp.events[0].confidence,
  invalidDueType: invalidDueResult.events[0].type,
  invalidLifecycleCode: invalidLifecycle.code,
});
