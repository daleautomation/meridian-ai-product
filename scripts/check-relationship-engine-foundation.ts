import {
  LIFECYCLE_STATE,
  READ_ONLY_FILE_ADAPTER_CAPABILITIES,
  asIsoDateString,
  asOperatorId,
  buildQueueCandidateSkeleton,
  buildShadowHealthScoreTrace,
  createEmptyReadOnlyTimelineSourceAdapter,
  normalizeTimelineSources,
  validateLifecycleTransition,
} from "@/lib/relationship-engine";

const now = "2026-05-13T14:37:00.000Z";

async function main() {
const normalized = normalizeTimelineSources({
  context: { now, workspaceId: "workspace:test" },
  crmActivities: [
    {
      id: "crm-1",
      companyKey: "company:alpha",
      companyName: "Alpha Roofing",
      performedAt: "2026-05-13T12:00:00.000Z",
      activityType: "call",
      performedBy: "operator-1",
      outcome: "connected",
      note: "Talked with owner.",
    },
  ],
  followUpTasks: [
    {
      id: "fu-1",
      companyKey: "company:alpha",
      companyName: "Alpha Roofing",
      taskType: "follow_up_call",
      title: "Call back with pricing",
      dueAt: "2026-05-14T16:00:00.000Z",
      status: "open",
      assignedUserId: "operator-1",
      createdBy: "operator-1",
      createdAt: "2026-05-13T13:00:00.000Z",
    },
  ],
  usageEvents: [
    {
      eventId: "evt-1",
      eventType: "closed_won",
      userId: "operator-1",
      operatorId: "operator-1",
      workspace: "workspace:test",
      leadId: "lead-1",
      taskId: "task-1",
      companyKey: "company:alpha",
      crmKey: "crm:alpha",
      companyName: "Alpha Roofing",
      previousStatus: "QUALIFIED",
      nextStatus: "CLOSED_WON",
      outcomeStatus: "Closed Won",
      estimatedValue: 5000,
      occurredAt: "2026-05-13T14:00:00.000Z",
      recordedAt: "2026-05-13T14:01:00.000Z",
      timestamp: "2026-05-13T14:01:00.000Z",
      metadata: {},
    },
  ],
  executionOutcomes: [
    {
      eventId: "outcome-1",
      workspace: "workspace:test",
      companyKey: "company:alpha",
      crmKey: "crm:alpha",
      leadId: "lead-1",
      taskId: "task-1",
      operatorId: "operator-1",
      sourceSurface: "operator",
      outcomeStatus: "Follow Up",
      previousStatus: "Called",
      nextStatus: "Follow Up",
      occurredAt: "2026-05-13T14:10:00.000Z",
      recordedAt: "2026-05-13T14:11:00.000Z",
      nextAction: "Send recap",
      nextActionDate: "2026-05-15T15:00:00.000Z",
      estimatedValue: null,
      meridianInfluenced: true,
      influenceReason: "Recorded by operator",
      idempotencyKey: "idem-1",
      metadata: {},
    },
  ],
});

if (normalized.events.length !== 4) {
  throw new Error(`Expected 4 normalized events, received ${normalized.events.length}`);
}
if (normalized.warnings.length !== 0) {
  throw new Error(`Expected no normalization warnings, received ${normalized.warnings.length}`);
}

const invalidTransition = validateLifecycleTransition({
  from: LIFECYCLE_STATE.CLOSED_LOST,
  to: LIFECYCLE_STATE.ACTIVE,
  reason: "Should not reopen in foundation pass",
});
if (invalidTransition.ok || invalidTransition.code !== "invalid_transition") {
  throw new Error("Expected CLOSED_LOST -> ACTIVE to be rejected");
}

const relationshipId = normalized.events[0].relationshipId;
const trace = buildShadowHealthScoreTrace({
  relationshipId,
  computedAt: asIsoDateString(now),
  timelineEvents: normalized.events,
});
if (trace.modelVersion !== "shadow-foundation-v0" || trace.confidence !== "unknown") {
  throw new Error("Shadow health trace did not remain in placeholder mode");
}

const candidate = buildQueueCandidateSkeleton({
  summary: {
    relationshipId,
    displayName: "Alpha Roofing",
    lifecycle: LIFECYCLE_STATE.NURTURING,
    warmth: "unknown",
    ownerId: asOperatorId("operator-1"),
    openPromiseCount: 0,
    overduePromiseCount: 0,
    healthConfidence: "unknown",
    summaryGeneratedAt: asIsoDateString(now),
  },
  generatedAt: asIsoDateString(now),
  whyNow: "Follow-up evidence exists in the shadow timeline.",
  nextBestAction: {
    kind: "review_manually",
    label: "Review relationship",
    reason: "Foundation pass does not automate outreach.",
  },
  evidence: normalized.events[0].evidence,
  visibleTo: [asOperatorId("operator-1")],
  healthTrace: trace,
});
if (candidate.rankScore !== 0 || candidate.visibleTo.length !== 1) {
  throw new Error("Queue candidate skeleton violated foundation defaults");
}

  const adapter = createEmptyReadOnlyTimelineSourceAdapter(READ_ONLY_FILE_ADAPTER_CAPABILITIES);
  const adapterRows = await adapter.listCrmActivities("workspace:test" as never);
  if (adapterRows.length !== 0 || adapter.capabilities.canAppendTimelineEvents) {
    throw new Error("Read-only placeholder adapter must stay empty and non-mutating");
  }

  console.log("relationship-engine foundation check passed", {
    events: normalized.events.map((event) => `${event.category}:${event.type}`),
    warnings: normalized.warnings.length,
    scoreModelVersion: trace.modelVersion,
    candidateId: candidate.id,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
