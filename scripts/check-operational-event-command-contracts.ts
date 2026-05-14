import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type {
  OperationalEventCommandFamily,
  OperationalEventCommandKind,
} from "@/lib/relationship-engine/operational/commands";
import type {
  CanonicalOperationalEventFamily,
  CanonicalOperationalEventKind,
} from "@/lib/relationship-engine/operational/events";

interface CommandContractSpec {
  readonly family: OperationalEventCommandFamily;
  readonly kind: OperationalEventCommandKind;
  readonly plannedEventFamily: CanonicalOperationalEventFamily;
  readonly plannedEventKind: CanonicalOperationalEventKind;
}

const commandContracts = [
  { family: "review_history", kind: "start_review", plannedEventFamily: "review_history", plannedEventKind: "review_started" },
  { family: "review_history", kind: "complete_review", plannedEventFamily: "review_history", plannedEventKind: "review_completed" },
  { family: "review_history", kind: "reopen_review", plannedEventFamily: "review_history", plannedEventKind: "review_reopened" },
  { family: "review_history", kind: "escalate_review", plannedEventFamily: "review_history", plannedEventKind: "review_escalated" },
  { family: "review_history", kind: "request_manager_review", plannedEventFamily: "review_history", plannedEventKind: "manager_review_requested" },
  { family: "assignment_history", kind: "create_assignment", plannedEventFamily: "assignment_history", plannedEventKind: "assignment_created" },
  { family: "assignment_history", kind: "transfer_assignment", plannedEventFamily: "assignment_history", plannedEventKind: "assignment_transferred" },
  { family: "assignment_history", kind: "remove_assignment", plannedEventFamily: "assignment_history", plannedEventKind: "assignment_removed" },
  { family: "assignment_history", kind: "change_assignment_visibility", plannedEventFamily: "assignment_history", plannedEventKind: "assignment_visibility_changed" },
  { family: "assignment_history", kind: "clarify_ownership", plannedEventFamily: "assignment_history", plannedEventKind: "ownership_clarified" },
  { family: "operator_handoff", kind: "prepare_handoff", plannedEventFamily: "operator_handoff", plannedEventKind: "handoff_context_prepared" },
  { family: "operator_handoff", kind: "acknowledge_handoff", plannedEventFamily: "operator_handoff", plannedEventKind: "handoff_context_acknowledged" },
  { family: "operator_handoff", kind: "supersede_handoff", plannedEventFamily: "operator_handoff", plannedEventKind: "handoff_context_superseded" },
  { family: "workflow_progression", kind: "observe_projection", plannedEventFamily: "workflow_progression", plannedEventKind: "workflow_projection_observed" },
  { family: "workflow_progression", kind: "block_progression", plannedEventFamily: "workflow_progression", plannedEventKind: "workflow_progression_blocked" },
  { family: "workflow_progression", kind: "unblock_progression", plannedEventFamily: "workflow_progression", plannedEventKind: "workflow_progression_unblocked" },
] satisfies readonly CommandContractSpec[];

const contractSourcePath = "lib/relationship-engine/operational/commands.ts";
const contractSource = readFileSync(contractSourcePath, "utf8");
const commandContractFindings = validateCommandContractModel();
const dryRunFindings = validateDryRunModel();
const conflictFindings = validateIdempotencyAndConflicts();
const staticBoundaryFindings = validateStaticNoWriteBoundary();

console.log("operational event command contract check passed", {
  commandContracts: commandContractFindings,
  dryRunValidationModel: dryRunFindings,
  idempotencyConflictRules: conflictFindings,
  staticBoundaryFindings,
  risksFound: [],
  safeNext: [
    "add type-level command examples",
    "add fixture-only dry-run validation cases",
    "draft future command-to-event mapping fixtures behind no-write gates",
  ],
  stillWaits: [
    "production writes",
    "Neon write mode",
    "persistence repositories",
    "mutation endpoints",
    "automation",
    "reminders",
    "notifications",
    "queue execution",
    "workflow execution",
    "production scoring",
    "autonomous workflows",
  ],
});

function validateCommandContractModel() {
  const expectedKinds = [
    "start_review",
    "complete_review",
    "reopen_review",
    "escalate_review",
    "request_manager_review",
    "create_assignment",
    "transfer_assignment",
    "remove_assignment",
    "change_assignment_visibility",
    "clarify_ownership",
    "prepare_handoff",
    "acknowledge_handoff",
    "supersede_handoff",
    "observe_projection",
    "block_progression",
    "unblock_progression",
  ] satisfies readonly OperationalEventCommandKind[];

  assert.deepEqual(commandContracts.map((contract) => contract.kind), expectedKinds);
  assert.equal(new Set(commandContracts.map((contract) => contract.kind)).size, expectedKinds.length);

  for (const requiredField of [
    "workspaceId",
    "relationshipId",
    "actor",
    "idempotencyKey",
    "expectedPriorState",
    "sourceProjectionVersion",
    "evidence",
    "reasonCodes",
    "explainability",
  ]) {
    assert.match(contractSource, new RegExp(`readonly ${requiredField}\\b`), `command contracts must require ${requiredField}`);
  }

  for (const boundaryFlag of [
    "dryRunOnly",
    "validationOnly",
    "commandExecutionAllowed",
    "canonicalEventEmissionAllowed",
    "mutationEndpointsAllowed",
    "repositoriesAllowed",
    "persistenceAllowed",
    "neonWritesAllowed",
    "automationAllowed",
    "automationIntentAllowed",
    "remindersAllowed",
    "notificationsAllowed",
    "queueExecutionAllowed",
    "workflowExecutionAllowed",
    "productionScoringAllowed",
    "autonomousWorkflowsAllowed",
  ]) {
    assert.match(contractSource, new RegExp(`readonly ${boundaryFlag}\\b`), `command boundary must include ${boundaryFlag}`);
  }

  return {
    totalCommands: commandContracts.length,
    reviewCommands: commandContracts.filter((contract) => contract.family === "review_history").length,
    assignmentCommands: commandContracts.filter((contract) => contract.family === "assignment_history").length,
    handoffCommands: commandContracts.filter((contract) => contract.family === "operator_handoff").length,
    workflowObservationCommands: commandContracts.filter((contract) => contract.family === "workflow_progression").length,
    requiredFieldsPresent: true,
    noWriteBoundaryPresent: true,
  };
}

function validateDryRunModel() {
  for (const status of [
    "valid_no_write",
    "exact_duplicate_noop",
    "explicit_conflict",
    "validation_failed",
  ]) {
    assert.match(contractSource, new RegExp(`"${status}"`), `dry-run validation must include ${status}`);
  }

  for (const dryRunFlag of [
    "wouldEmitCanonicalEvent",
    "wouldPersist",
    "wouldExecuteAutomation",
    "wouldSendReminder",
    "wouldSendNotification",
    "wouldExecuteQueue",
    "wouldExecuteWorkflow",
    "wouldWrite",
  ]) {
    assert.match(contractSource, new RegExp(`readonly ${dryRunFlag}\\b`), `dry-run model must include ${dryRunFlag}`);
  }

  return {
    statuses: ["valid_no_write", "exact_duplicate_noop", "explicit_conflict", "validation_failed"],
    wouldWrite: false,
    wouldPersist: false,
    wouldEmitCanonicalEvent: false,
  };
}

function validateIdempotencyAndConflicts() {
  for (const policy of [
    'exactDuplicatePolicy: "noop"',
    'expectedStateMismatchPolicy: "explicit_conflict"',
    'missingEvidencePolicy: "validation_failure"',
    'forbiddenAutomationIntentPolicy: "validation_failure"',
  ]) {
    assert.ok(contractSource.includes(policy), `command idempotency policy must include ${policy}`);
  }

  for (const failureCode of [
    "missing_evidence",
    "forbidden_automation_intent",
    "forbidden_reminder_intent",
    "forbidden_notification_intent",
    "forbidden_queue_execution_intent",
    "forbidden_workflow_execution_intent",
  ]) {
    assert.match(contractSource, new RegExp(`"${failureCode}"`), `validation failure code must include ${failureCode}`);
  }

  return {
    exactDuplicate: "noop",
    expectedStateMismatch: "explicit_conflict",
    missingEvidence: "validation_failure",
    forbiddenAutomationIntent: "validation_failure",
  };
}

function validateStaticNoWriteBoundary() {
  const sourceFiles = [contractSourcePath];
  const forbiddenSourcePatterns = [
    { label: "repository import", pattern: /from\s+["'][^"']*(?:\/repositories|relationship-engine\/repositories)[^"']*["']/ },
    { label: "Neon import", pattern: /from\s+["'](?:@neondatabase\/serverless|[^"']*\/db\/neon)["']/ },
    { label: "Neon call", pattern: /\b(?:neon|getNeonSql)\s*\(/ },
    { label: "filesystem write", pattern: /\b(?:writeFile|appendFile|mkdir|rm|unlink)\s*(?:Sync)?\s*\(/ },
    { label: "repository construction", pattern: /\bnew\s+\w*Repository\b/ },
    { label: "automation call", pattern: /\b(?:runAutomation|scheduleAutomation|executeAutomation)\s*\(/ },
    { label: "reminder call", pattern: /\b(?:createReminder|scheduleReminder|sendReminder)\s*\(/ },
    { label: "notification call", pattern: /\b(?:sendNotification|enqueueNotification|notifyOperator)\s*\(/ },
    { label: "queue execution call", pattern: /\b(?:executeQueue|runQueue|drainQueue)\s*\(/ },
    { label: "workflow execution call", pattern: /\b(?:executeWorkflow|runWorkflow|advanceWorkflow)\s*\(/ },
    { label: "mutation endpoint export", pattern: /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/ },
    { label: "mutation fetch method", pattern: /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/ },
    { label: "runtime command function", pattern: /export\s+(?:async\s+)?function\s+\w+|export\s+const\s+\w+\s*=/ },
    { label: "runtime command class", pattern: /export\s+class\s+\w+/ },
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
      return /OperationalEventCommand|operational-event-command|operational command|start_review|complete_review|create_assignment|prepare_handoff|observe_projection/.test(source)
        && /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(source);
    });
  assert.deepEqual(commandMutationEndpointFiles, [], "operational event commands must not expose mutation endpoints");

  return {
    sourceFilesChecked: sourceFiles,
    routeFilesChecked: listFiles("app").filter((file) => file.endsWith("route.ts")).length,
    mutationEndpointsFound: commandMutationEndpointFiles.length,
    runtimeWritersFound: 0,
    noWriteBoundaryVerified: true,
  };
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
