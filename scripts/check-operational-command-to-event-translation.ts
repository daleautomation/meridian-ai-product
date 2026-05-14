import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  operationalCommandExamples,
  operationalCommandTranslationAllOutputs,
  operationalCommandTranslationConflictExample,
  operationalCommandTranslationDuplicateNoopExample,
  operationalCommandTranslationOutputs,
  plannedOperationalEventPreviews,
} from "@/fixtures/operational-events/command-to-event-translation-fixtures";
import type { OperationalEventCommandKind } from "@/lib/relationship-engine/operational/commands";
import type {
  CanonicalOperationalEventEnvelope,
  CanonicalOperationalEventFamily,
  CanonicalOperationalEventKind,
} from "@/lib/relationship-engine/operational/events";

const expectedCommandMappings = [
  { commandKind: "start_review", family: "review_history", eventFamily: "review_history", eventKind: "review_started" },
  { commandKind: "complete_review", family: "review_history", eventFamily: "review_history", eventKind: "review_completed" },
  { commandKind: "create_assignment", family: "assignment_history", eventFamily: "assignment_history", eventKind: "assignment_created" },
  { commandKind: "transfer_assignment", family: "assignment_history", eventFamily: "assignment_history", eventKind: "assignment_transferred" },
  { commandKind: "prepare_handoff", family: "operator_handoff", eventFamily: "operator_handoff", eventKind: "handoff_context_prepared" },
  { commandKind: "acknowledge_handoff", family: "operator_handoff", eventFamily: "operator_handoff", eventKind: "handoff_context_acknowledged" },
  { commandKind: "observe_projection", family: "workflow_progression", eventFamily: "workflow_progression", eventKind: "workflow_projection_observed" },
  { commandKind: "block_progression", family: "workflow_progression", eventFamily: "workflow_progression", eventKind: "workflow_progression_blocked" },
] satisfies readonly {
  readonly commandKind: OperationalEventCommandKind;
  readonly family: CanonicalOperationalEventFamily;
  readonly eventFamily: CanonicalOperationalEventFamily;
  readonly eventKind: CanonicalOperationalEventKind;
}[];

const commandFindings = validateCommandExamples();
const mappingFindings = validateMappings();
const dryRunFindings = validateDryRunBoundaries();
const replayFindings = validateReplaySorting(plannedOperationalEventPreviews.map((preview) => preview.plannedEvent));
const idempotencyConflictFindings = validateDuplicateConflictRules();
const staticBoundaryFindings = validateStaticNoWriteBoundary();

console.log("operational command-to-event translation check passed", {
  commandExamples: commandFindings,
  translationMappings: mappingFindings,
  dryRunGuaranteesVerified: dryRunFindings,
  replayOrderingFindings: replayFindings,
  idempotencyConflictFindings,
  staticBoundaryFindings,
  risksFound: [],
  safeNext: [
    "add more fixture-only command variants",
    "expand conflict fixtures for supersession and reopening",
    "design repository interfaces without enabling write mode",
  ],
  stillWaits: [
    "production writes",
    "Neon write mode",
    "persistence repositories",
    "mutation endpoints",
    "real command execution",
    "automation",
    "reminders",
    "notifications",
    "queue execution",
    "workflow execution",
    "production scoring",
    "autonomous workflows",
  ],
});

function validateCommandExamples() {
  assert.equal(operationalCommandExamples.length, expectedCommandMappings.length);
  assert.deepEqual(
    operationalCommandExamples.map((command) => command.kind),
    expectedCommandMappings.map((mapping) => mapping.commandKind),
    "fixture command examples must cover the requested command kinds in deterministic order",
  );

  for (const command of operationalCommandExamples) {
    assert.equal(command.boundary.dryRunOnly, true);
    assert.equal(command.boundary.validationOnly, true);
    assert.equal(command.boundary.commandExecutionAllowed, false);
    assert.equal(command.boundary.canonicalEventEmissionAllowed, false);
    assert.equal(command.boundary.mutationEndpointsAllowed, false);
    assert.equal(command.boundary.repositoriesAllowed, false);
    assert.equal(command.boundary.persistenceAllowed, false);
    assert.equal(command.boundary.neonWritesAllowed, false);
    assert.equal(command.boundary.automationAllowed, false);
    assert.equal(command.boundary.automationIntentAllowed, false);
    assert.equal(command.boundary.remindersAllowed, false);
    assert.equal(command.boundary.notificationsAllowed, false);
    assert.equal(command.boundary.queueExecutionAllowed, false);
    assert.equal(command.boundary.workflowExecutionAllowed, false);
    assert.equal(command.evidence.length > 0, true, `${command.kind} must include evidence`);
    assert.equal(command.reasonCodes.length > 0, true, `${command.kind} must include reason codes`);
    assert.equal(command.idempotency.exactDuplicatePolicy, "noop");
    assert.equal(command.idempotency.expectedStateMismatchPolicy, "explicit_conflict");
    assert.equal(command.idempotency.missingEvidencePolicy, "validation_failure");
    assert.equal(command.idempotency.forbiddenAutomationIntentPolicy, "validation_failure");
    assertNoForbiddenIntent(command.payload, command.kind);
  }

  return {
    totalExamples: operationalCommandExamples.length,
    commandKinds: operationalCommandExamples.map((command) => command.kind),
    missingEvidenceRejectedByPolicy: true,
    forbiddenIntentRejectedByPolicy: true,
  };
}

function validateMappings() {
  assert.equal(plannedOperationalEventPreviews.length, expectedCommandMappings.length);
  assert.equal(operationalCommandTranslationOutputs.length, expectedCommandMappings.length);

  for (const [index, mapping] of expectedCommandMappings.entries()) {
    const command = operationalCommandExamples[index];
    const output = operationalCommandTranslationOutputs[index];
    const preview = plannedOperationalEventPreviews[index];
    const plannedEvent = preview.plannedEvent;

    assert.equal(command.kind, mapping.commandKind);
    assert.equal(command.family, mapping.family);
    assert.equal(command.dryRunPlan.plannedEventFamily, mapping.eventFamily);
    assert.equal(command.dryRunPlan.plannedEventKind, mapping.eventKind);
    assert.equal(output.status, "planned_no_write");
    assert.equal(output.acceptedForFutureEventPlanning, true);
    assert.equal(preview.mode, "planned_canonical_event_preview_only");
    assert.equal(preview.previewOnly, true);
    assert.equal(preview.plannedEventFamily, mapping.eventFamily);
    assert.equal(preview.plannedEventKind, mapping.eventKind);
    assert.equal(plannedEvent.family, mapping.eventFamily);
    assert.equal(plannedEvent.kind, mapping.eventKind);
    assert.equal(plannedEvent.metadata.family, plannedEvent.family);
    assert.equal(plannedEvent.metadata.kind, plannedEvent.kind);
    assert.deepEqual(preview.expectedState, plannedEvent.expectedState);
    assert.equal(preview.replayOrdering.orderKey, plannedEvent.ordering.orderKey);
  }

  return {
    mappingsChecked: plannedOperationalEventPreviews.length,
    reviewHistoryMappings: expectedCommandMappings.filter((mapping) => mapping.eventFamily === "review_history").length,
    assignmentHistoryMappings: expectedCommandMappings.filter((mapping) => mapping.eventFamily === "assignment_history").length,
    operatorHandoffMappings: expectedCommandMappings.filter((mapping) => mapping.eventFamily === "operator_handoff").length,
    workflowProgressionMappings: expectedCommandMappings.filter((mapping) => mapping.eventFamily === "workflow_progression").length,
  };
}

function validateDryRunBoundaries() {
  for (const output of operationalCommandTranslationAllOutputs) {
    assert.equal(output.dryRunGuarantees.wouldEmitCanonicalEvent, false);
    assert.equal(output.dryRunGuarantees.wouldPersist, false);
    assert.equal(output.dryRunGuarantees.wouldWrite, false);
    assert.equal(output.dryRunGuarantees.wouldExecuteAutomation, false);
    assert.equal(output.dryRunGuarantees.wouldSendReminder, false);
    assert.equal(output.dryRunGuarantees.wouldSendNotification, false);
    assert.equal(output.dryRunGuarantees.wouldExecuteQueue, false);
    assert.equal(output.dryRunGuarantees.wouldExecuteWorkflow, false);
    assert.equal(output.boundary.fixtureOnly, true);
    assert.equal(output.boundary.canonicalEventEmissionAllowed, false);
    assert.equal(output.boundary.persistenceAllowed, false);
    assert.equal(output.boundary.neonWritesAllowed, false);
    assert.equal(output.boundary.filesystemWritesAllowed, false);
    assert.equal(output.boundary.automationAllowed, false);
    assert.equal(output.boundary.remindersAllowed, false);
    assert.equal(output.boundary.notificationsAllowed, false);
    assert.equal(output.boundary.queueExecutionAllowed, false);
    assert.equal(output.boundary.workflowExecutionAllowed, false);
  }

  for (const preview of plannedOperationalEventPreviews) {
    assert.equal(preview.dryRunGuarantees.wouldEmitCanonicalEvent, false);
    assert.equal(preview.dryRunGuarantees.wouldPersist, false);
    assert.equal(preview.dryRunGuarantees.wouldWrite, false);
    assert.equal(preview.dryRunGuarantees.wouldExecuteAutomation, false);
    assert.equal(preview.dryRunGuarantees.wouldSendReminder, false);
    assert.equal(preview.dryRunGuarantees.wouldSendNotification, false);
    assert.equal(preview.dryRunGuarantees.wouldExecuteQueue, false);
    assert.equal(preview.dryRunGuarantees.wouldExecuteWorkflow, false);
    assert.equal(preview.plannedEvent.boundary.repositoriesAllowed, false);
    assert.equal(preview.plannedEvent.boundary.persistenceAllowed, false);
    assert.equal(preview.plannedEvent.boundary.neonWritesAllowed, false);
    assert.equal(preview.plannedEvent.boundary.automationAllowed, false);
    assert.equal(preview.plannedEvent.boundary.remindersAllowed, false);
    assert.equal(preview.plannedEvent.boundary.notificationsAllowed, false);
    assert.equal(preview.plannedEvent.boundary.queueExecutionAllowed, false);
    assert.equal(preview.plannedEvent.boundary.workflowExecutionAllowed, false);
  }

  return {
    outputsChecked: operationalCommandTranslationAllOutputs.length,
    plannedPreviewsChecked: plannedOperationalEventPreviews.length,
    wouldEmitCanonicalEvent: false,
    wouldPersist: false,
    wouldWrite: false,
    wouldExecuteAutomation: false,
    wouldSendReminder: false,
    wouldSendNotification: false,
    wouldExecuteQueue: false,
    wouldExecuteWorkflow: false,
  };
}

function validateReplaySorting(events: readonly CanonicalOperationalEventEnvelope[]) {
  const expectedOrder = sortOperationalEvents(events).map((event) => event.id);
  assert.deepEqual(
    sortOperationalEvents([...events].reverse()).map((event) => event.id),
    expectedOrder,
    "planned event previews must be replay-sortable under reversed inputs",
  );
  assert.deepEqual(
    sortOperationalEvents(shuffleDeterministically(events)).map((event) => event.id),
    expectedOrder,
    "planned event previews must be replay-sortable under shuffled inputs",
  );

  const ids = new Set<string>();
  const dedupeKeys = new Set<string>();
  for (const event of events) {
    assert.equal(ids.has(event.id), false, `${event.id} must be unique`);
    assert.equal(dedupeKeys.has(event.idempotency.dedupeKey), false, `${event.id} must have unique dedupe key`);
    ids.add(event.id);
    dedupeKeys.add(event.idempotency.dedupeKey);
    assert.equal(event.ordering.strategy, "deterministic_operational_event_replay_v0");
    assert.equal(event.ordering.hiddenStateInputsAllowed, false);
    assert.equal(
      event.ordering.orderKey,
      `${event.ordering.occurredAt}:${event.ordering.recordedAt}:${event.ordering.familyRank}:${event.ordering.kindRank}:${event.ordering.eventIdTieBreaker}`,
    );
    assert.equal(event.idempotency.strategy, "deterministic_operational_event_idempotency_v0");
    assert.equal(event.idempotency.duplicatePolicy, "collapse_exact_duplicate");
    assert.equal(event.idempotency.conflictPolicy, "explicit_conflict_when_expected_state_differs");
    assert.equal(event.appendOnly.mutationSemanticsAllowed, false);
    assert.equal(event.appendOnly.overwriteSemanticsAllowed, false);
    assert.equal(event.appendOnly.deletionSemanticsAllowed, false);
    assert.ok(Object.keys(event.expectedState).length > 0);
    assert.ok(event.explainability.evidence.length > 0);
    assert.ok(event.explainability.reasonCodes.length > 0);
  }

  return {
    plannedEvents: events.length,
    replayOrder: expectedOrder,
    uniqueDedupeKeys: dedupeKeys.size,
    hiddenStateInputsAllowed: false,
  };
}

function validateDuplicateConflictRules() {
  assert.equal(operationalCommandTranslationDuplicateNoopExample.status, "exact_duplicate_noop");
  assert.equal(operationalCommandTranslationDuplicateNoopExample.acceptedForFutureEventPlanning, false);
  assert.equal(operationalCommandTranslationDuplicateNoopExample.conflicts[0].code, "exact_duplicate_noop");
  assert.equal(operationalCommandTranslationDuplicateNoopExample.conflicts[0].resolution, "noop_exact_duplicate");
  assert.equal(operationalCommandTranslationDuplicateNoopExample.conflicts[0].appendPrevented, true);

  assert.equal(operationalCommandTranslationConflictExample.status, "explicit_conflict");
  assert.equal(operationalCommandTranslationConflictExample.acceptedForFutureEventPlanning, false);
  assert.equal(operationalCommandTranslationConflictExample.conflicts[0].code, "expected_state_mismatch");
  assert.equal(operationalCommandTranslationConflictExample.conflicts[0].resolution, "reject_until_expected_state_is_refreshed");
  assert.notDeepEqual(
    operationalCommandTranslationConflictExample.conflicts[0].existingExpectedState,
    operationalCommandTranslationConflictExample.conflicts[0].incomingExpectedState,
  );

  const validationFailureCodes = operationalCommandTranslationAllOutputs
    .filter((output) => output.status === "validation_failed")
    .flatMap((output) => output.issues.map((issue) => issue.code));
  assert.ok(validationFailureCodes.includes("missing_evidence"));
  assert.ok(validationFailureCodes.includes("forbidden_automation_intent"));
  assert.ok(validationFailureCodes.includes("forbidden_reminder_intent"));
  assert.ok(validationFailureCodes.includes("forbidden_notification_intent"));
  assert.ok(validationFailureCodes.includes("forbidden_queue_execution_intent"));
  assert.ok(validationFailureCodes.includes("forbidden_workflow_execution_intent"));

  return {
    exactDuplicateCommand: "noop",
    expectedStateMismatch: "explicit_conflict",
    missingEvidence: "validation_failure",
    forbiddenAutomationIntent: "validation_failure",
    forbiddenReminderIntent: "validation_failure",
    forbiddenNotificationIntent: "validation_failure",
    forbiddenQueueExecutionIntent: "validation_failure",
    forbiddenWorkflowExecutionIntent: "validation_failure",
  };
}

function validateStaticNoWriteBoundary() {
  const sourceFiles = [
    "lib/relationship-engine/operational/commandTranslation.ts",
    "fixtures/operational-events/command-to-event-translation-fixtures.ts",
  ];
  const forbiddenSourcePatterns = [
    { label: "repository import", pattern: /from\s+["'][^"']*(?:\/repositories|relationship-engine\/repositories)[^"']*["']/ },
    { label: "Neon import", pattern: /from\s+["'](?:@neondatabase\/serverless|[^"']*\/db\/neon)["']/ },
    { label: "Neon call", pattern: /\b(?:neon|getNeonSql)\s*\(/ },
    { label: "filesystem write", pattern: /\b(?:writeFile|appendFile|mkdir|rm|unlink)\s*(?:Sync)?\s*\(/ },
    { label: "repository construction", pattern: /\bnew\s+\w*Repository\b/ },
    { label: "persistence call", pattern: /\b(?:persist|save|insert|upsert|update|delete|writeOperatorSnapshot)\w*\s*\(/ },
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

  const commandMutationEndpointFiles = listFiles("app")
    .filter((file) => file.endsWith("route.ts"))
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      return /command-to-event|commandTranslation|operationalCommandTranslation|start_review|complete_review|create_assignment|transfer_assignment|prepare_handoff|acknowledge_handoff|observe_projection|block_progression/.test(source)
        && /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source);
    });
  assert.deepEqual(commandMutationEndpointFiles, [], "fixture command translation must not expose mutation endpoints");

  return {
    sourceFilesChecked: sourceFiles,
    routeFilesChecked: listFiles("app").filter((file) => file.endsWith("route.ts")).length,
    mutationEndpointsFound: commandMutationEndpointFiles.length,
    repositoryImportsFound: 0,
    neonCallsFound: 0,
    filesystemWritesFound: 0,
    persistenceCallsFound: 0,
    automationCallsFound: 0,
    reminderCallsFound: 0,
    notificationCallsFound: 0,
    queueExecutionCallsFound: 0,
    workflowExecutionCallsFound: 0,
  };
}

function assertNoForbiddenIntent(payload: object, commandKind: OperationalEventCommandKind): void {
  const serialized = stableStringify(payload);
  for (const forbiddenTrueIntent of [
    '"automationIntent":true',
    '"reminderIntent":true',
    '"notificationIntent":true',
    '"queueExecutionIntent":true',
    '"workflowExecutionIntent":true',
    '"assignmentMutationIntent":true',
  ]) {
    assert.equal(serialized.includes(forbiddenTrueIntent), false, `${commandKind} must not include ${forbiddenTrueIntent}`);
  }
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
