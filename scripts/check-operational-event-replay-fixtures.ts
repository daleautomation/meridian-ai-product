import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  canonicalOperationalEventFixtureFamilies,
  canonicalOperationalEventFixtures,
} from "@/fixtures/operational-events/canonical-operational-event-fixtures";
import type {
  CanonicalOperationalEventEnvelope,
  CanonicalOperationalEventFamily,
} from "@/lib/relationship-engine/operational/events";

const requiredFamilies = [
  "review_history",
  "assignment_history",
  "continuity_history",
  "workflow_progression",
  "operator_handoff",
] satisfies readonly CanonicalOperationalEventFamily[];

const expectedReplayOrder = sortOperationalEvents(canonicalOperationalEventFixtures).map((event) => event.id);
const replayFindings = validateDeterministicReplay(canonicalOperationalEventFixtures, expectedReplayOrder);
const idempotencyFindings = validateIdempotency(canonicalOperationalEventFixtures);
const appendOnlyFindings = validateAppendOnly(canonicalOperationalEventFixtures);
const auditabilityFindings = validateAuditability(canonicalOperationalEventFixtures);
const staticBoundaryFindings = validateStaticNoWriteBoundary();

console.log("operational event replay fixture check passed", {
  fixtureFamilies: Object.fromEntries(
    requiredFamilies.map((family) => [family, canonicalOperationalEventFixtureFamilies[family].length]),
  ),
  replayGuaranteesVerified: replayFindings,
  idempotencyFindings,
  appendOnlyFindings,
  auditabilityFindings,
  staticBoundaryFindings,
  risksFound: [],
  safeNext: [
    "add more fixture-only event variants",
    "add replay conflict fixtures",
    "draft command contracts behind no-write gates",
  ],
  stillWaits: [
    "production persistence writes",
    "Neon write mode",
    "repositories",
    "automation",
    "reminders",
    "notifications",
    "queue execution",
    "workflow execution",
    "production scoring",
    "autonomous workflows",
  ],
});

function validateDeterministicReplay(
  events: readonly CanonicalOperationalEventEnvelope[],
  expectedOrder: readonly CanonicalOperationalEventEnvelope["id"][],
) {
  assert.equal(events.length, 10, "fixtures must include two events for each operational family");

  for (const family of requiredFamilies) {
    assert.ok(canonicalOperationalEventFixtureFamilies[family].length > 0, `${family} fixtures must exist`);
  }

  const reversedReplayOrder = sortOperationalEvents([...events].reverse()).map((event) => event.id);
  assert.deepEqual(reversedReplayOrder, expectedOrder, "reversed fixture inputs must replay deterministically");

  const shuffledReplayOrder = sortOperationalEvents(shuffleDeterministically(events)).map((event) => event.id);
  assert.deepEqual(shuffledReplayOrder, expectedOrder, "shuffled fixture inputs must replay deterministically");

  for (const event of events) {
    assert.equal(event.ordering.strategy, "deterministic_operational_event_replay_v0");
    assert.equal(event.ordering.hiddenStateInputsAllowed, false);
    assert.equal(
      event.ordering.orderKey,
      `${event.ordering.occurredAt}:${event.ordering.recordedAt}:${event.ordering.familyRank}:${event.ordering.kindRank}:${event.ordering.eventIdTieBreaker}`,
      `${event.id} must carry a reproducible order key`,
    );
  }

  return {
    fixtureEvents: events.length,
    reversedReplayOrder,
    shuffledReplayOrder,
    hiddenStateInputsAllowed: false,
  };
}

function validateIdempotency(events: readonly CanonicalOperationalEventEnvelope[]) {
  const dedupeKeys = new Set<string>();
  for (const event of events) {
    assert.equal(event.idempotency.strategy, "deterministic_operational_event_idempotency_v0");
    assert.equal(event.idempotency.duplicatePolicy, "collapse_exact_duplicate");
    assert.equal(event.idempotency.conflictPolicy, "explicit_conflict_when_expected_state_differs");
    assert.ok(event.idempotency.idempotencyKey);
    assert.ok(event.idempotency.dedupeKey);
    assert.ok(event.idempotency.deterministicIdInputs.length >= 4);
    assert.equal(dedupeKeys.has(event.idempotency.dedupeKey), false, `${event.id} must have a unique dedupe key`);
    dedupeKeys.add(event.idempotency.dedupeKey);
  }

  const duplicateEvent = { ...events[0] } satisfies CanonicalOperationalEventEnvelope;
  const duplicateResult = dedupeOperationalEvents([events[0], duplicateEvent]);
  assert.equal(duplicateResult.events.length, 1, "exact duplicate fixture events must collapse");
  assert.equal(duplicateResult.exactDuplicates, 1, "exact duplicate fixture event must be reported");
  assert.equal(duplicateResult.conflicts.length, 0, "exact duplicate fixture event must not be a conflict");

  const conflictingEvent = {
    ...events[0],
    id: "operational:event:fixture:review-started-conflict" as never,
    expectedState: {
      ...events[0].expectedState,
      reviewState: "reviewed",
    },
  } satisfies CanonicalOperationalEventEnvelope;
  const conflictResult = dedupeOperationalEvents([events[0], conflictingEvent]);
  assert.equal(conflictResult.events.length, 1, "conflicting duplicate fixture should not append");
  assert.equal(conflictResult.conflicts.length, 1, "conflicting duplicate fixture must be reported");

  return {
    uniqueDedupeKeys: dedupeKeys.size,
    exactDuplicatesCollapsed: duplicateResult.exactDuplicates,
    conflictsDetected: conflictResult.conflicts.length,
  };
}

function validateAppendOnly(events: readonly CanonicalOperationalEventEnvelope[]) {
  const eventSnapshots = new Map(events.map((event) => [event.id, stableStringify(event)]));
  const ids = new Set<string>();

  for (const event of events) {
    assert.equal(ids.has(event.id), false, `${event.id} must be unique`);
    ids.add(event.id);
    assert.equal(event.family, event.metadata.family);
    assert.equal(event.kind, event.metadata.kind);
    assert.equal(event.appendOnly.strategy, "append_only_operational_memory_v0");
    assert.equal(event.appendOnly.mutationSemanticsAllowed, false);
    assert.equal(event.appendOnly.overwriteSemanticsAllowed, false);
    assert.equal(event.appendOnly.deletionSemanticsAllowed, false);
    assert.equal(event.appendOnly.correctionStrategy, "append_reversal_or_supersession_event");
    assert.equal(event.appendOnly.projectionCacheCanonical, false);
    assert.equal(event.boundary.appendOnly, true);
    assert.equal(event.boundary.immutable, true);
    assert.equal(event.boundary.repositoriesAllowed, false);
    assert.equal(event.boundary.persistenceAllowed, false);
    assert.equal(event.boundary.neonWritesAllowed, false);
    assert.equal(event.boundary.automationAllowed, false);
    assert.equal(event.boundary.queueExecutionAllowed, false);
    assert.equal(event.boundary.workflowExecutionAllowed, false);
    assert.equal(event.boundary.remindersAllowed, false);
    assert.equal(event.boundary.notificationsAllowed, false);
    assert.equal(event.boundary.productionScoringAllowed, false);
    assert.equal(event.boundary.inferredReviewCompletionAllowed, false);
    assert.equal(event.boundary.uiDerivedWorkflowMemoryAllowed, false);
    assert.equal(event.boundary.projectionCacheCanonicalAllowed, false);
    assert.equal(event.boundary.hiddenAutomationStateAllowed, false);
    assert.equal(event.boundary.invisibleWorkflowProgressionAllowed, false);
  }

  for (const event of events) {
    assert.equal(eventSnapshots.get(event.id), stableStringify(event), `${event.id} changed during validation`);
  }

  return {
    immutableEventsChecked: events.length,
    mutationSemanticsAllowed: false,
    overwriteSemanticsAllowed: false,
    deletionSemanticsAllowed: false,
  };
}

function validateAuditability(events: readonly CanonicalOperationalEventEnvelope[]) {
  for (const event of events) {
    assert.ok(event.metadata.actor.actorId, `${event.id} must have an actor id`);
    assert.ok(event.metadata.actor.role, `${event.id} must have an actor role`);
    assert.ok(event.metadata.actor.source, `${event.id} must have an actor source`);
    assert.ok(event.metadata.source, `${event.id} must have source metadata`);
    assert.ok(Object.keys(event.expectedState).length > 0, `${event.id} must define expected replay state`);
    assert.ok(event.explainability.evidence.length > 0, `${event.id} must include evidence`);
    assert.ok(event.explainability.reasonCodes.length > 0, `${event.id} must include reason codes`);
    assert.ok(event.explainability.confidence.level, `${event.id} must include confidence level`);
    assert.ok(event.explainability.confidence.rationale, `${event.id} must include confidence rationale`);
    assertExplanation(event, "whyVisible");
    assertExplanation(event, "whyAssigned");
    assertExplanation(event, "whyEscalated");
    assertExplanation(event, "whyContinuityChanged");
    assert.ok(event.explainability.missingDataEffects.length > 0, `${event.id} must explain missing data effects`);
  }

  return {
    eventsAudited: events.length,
    actorRequired: true,
    sourceRequired: true,
    evidenceRequired: true,
    confidenceRequired: true,
    reasonCodesRequired: true,
    expectedStateRequired: true,
    explainabilityRequired: true,
  };
}

function validateStaticNoWriteBoundary() {
  const sourceFiles = [
    "lib/relationship-engine/operational/events.ts",
    "fixtures/operational-events/canonical-operational-event-fixtures.ts",
  ];

  const forbiddenSourcePatterns = [
    { label: "repository import", pattern: /from\s+["'][^"']*(?:\/repositories|relationship-engine\/repositories)[^"']*["']/ },
    { label: "Neon import", pattern: /from\s+["'](?:@neondatabase\/serverless|[^"']*\/db\/neon)["']/ },
    { label: "Neon call", pattern: /\b(?:neon|getNeonSql)\s*\(/ },
    { label: "repository construction", pattern: /\bnew\s+\w*Repository\b/ },
    { label: "automation call", pattern: /\b(?:runAutomation|scheduleAutomation|executeAutomation)\s*\(/ },
    { label: "reminder call", pattern: /\b(?:createReminder|scheduleReminder|sendReminder)\s*\(/ },
    { label: "notification call", pattern: /\b(?:sendNotification|enqueueNotification|notifyOperator)\s*\(/ },
    { label: "queue execution call", pattern: /\b(?:executeQueue|runQueue|drainQueue)\s*\(/ },
    { label: "workflow execution call", pattern: /\b(?:executeWorkflow|runWorkflow|advanceWorkflow)\s*\(/ },
    { label: "mutation endpoint export", pattern: /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/ },
    { label: "mutation fetch method", pattern: /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/ },
  ] satisfies readonly { readonly label: string; readonly pattern: RegExp }[];

  for (const sourceFile of sourceFiles) {
    const source = readFileSync(sourceFile, "utf8");
    for (const check of forbiddenSourcePatterns) {
      assert.equal(check.pattern.test(source), false, `${sourceFile} must not contain ${check.label}`);
    }
  }

  const mutationEndpointFiles = listFiles("app")
    .filter((file) => file.endsWith("route.ts"))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return /operational_event|canonicalOperational|CanonicalOperational|review_history|assignment_history|continuity_history|workflow_progression|operator_handoff/.test(source)
        && /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source);
    });
  assert.deepEqual(mutationEndpointFiles, [], "canonical operational events must not expose mutation endpoints");

  return {
    sourceFilesChecked: sourceFiles,
    mutationEndpointFilesChecked: listFiles("app").filter((file) => file.endsWith("route.ts")).length,
    mutationEndpointsFound: mutationEndpointFiles.length,
    noWriteBoundaryVerified: true,
  };
}

function sortOperationalEvents(
  events: readonly CanonicalOperationalEventEnvelope[],
): readonly CanonicalOperationalEventEnvelope[] {
  return [...events].sort((a, b) => {
    const occurred = a.ordering.occurredAt.localeCompare(b.ordering.occurredAt);
    if (occurred !== 0) return occurred;
    const recorded = a.ordering.recordedAt.localeCompare(b.ordering.recordedAt);
    if (recorded !== 0) return recorded;
    const family = a.ordering.familyRank - b.ordering.familyRank;
    if (family !== 0) return family;
    const kind = a.ordering.kindRank - b.ordering.kindRank;
    if (kind !== 0) return kind;
    return a.ordering.eventIdTieBreaker.localeCompare(b.ordering.eventIdTieBreaker);
  });
}

function dedupeOperationalEvents(events: readonly CanonicalOperationalEventEnvelope[]) {
  const accepted = new Map<string, CanonicalOperationalEventEnvelope>();
  const conflicts: { readonly dedupeKey: string; readonly existingId: string; readonly incomingId: string }[] = [];
  let exactDuplicates = 0;

  for (const event of events) {
    const existing = accepted.get(event.idempotency.dedupeKey);
    if (!existing) {
      accepted.set(event.idempotency.dedupeKey, event);
      continue;
    }

    if (stableStringify(existing) === stableStringify(event)) {
      exactDuplicates += 1;
      continue;
    }

    conflicts.push({
      dedupeKey: event.idempotency.dedupeKey,
      existingId: existing.id,
      incomingId: event.id,
    });
  }

  return {
    events: [...accepted.values()],
    exactDuplicates,
    conflicts,
  };
}

function assertExplanation<
  Key extends keyof CanonicalOperationalEventEnvelope["explainability"],
>(event: CanonicalOperationalEventEnvelope, key: Key): void {
  const explanation = event.explainability[key];
  assert.ok(explanation && typeof explanation === "object" && "summary" in explanation, `${event.id} must include ${String(key)}`);
  if ("state" in explanation && explanation.state === "explained") {
    assert.ok(explanation.summary, `${event.id} ${String(key)} must have a summary`);
    assert.ok(explanation.evidenceIds.length > 0, `${event.id} ${String(key)} must cite evidence`);
    const evidenceIds = new Set(event.explainability.evidence.map((evidence) => evidence.id));
    for (const evidenceId of explanation.evidenceIds) {
      assert.ok(evidenceIds.has(evidenceId), `${event.id} ${String(key)} cites unknown evidence ${evidenceId}`);
    }
  }
}

function shuffleDeterministically(
  events: readonly CanonicalOperationalEventEnvelope[],
): readonly CanonicalOperationalEventEnvelope[] {
  return events.map((event, index) => ({ event, index }))
    .sort((a, b) => ((b.index * 7) % 11) - ((a.index * 7) % 11))
    .map(({ event }) => event);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);

  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(",")}}`;
}

function listFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];

  const results: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}
