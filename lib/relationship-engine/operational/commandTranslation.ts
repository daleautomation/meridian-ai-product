// Meridian Relationship Engine — fixture-only command-to-event translation contracts.
//
// Type-only planning shapes for future command translation. These contracts
// describe deterministic dry-run previews only; they do not write, emit events,
// call repositories, use Neon, run automation, send reminders or notifications,
// execute queues, or execute workflows.

import type {
  OperationalEventCommand,
  OperationalEventCommandConflict,
  OperationalEventCommandKind,
  OperationalEventCommandValidationIssue,
} from "./commands";
import type {
  CanonicalOperationalEventEnvelope,
  CanonicalOperationalEventFamily,
  CanonicalOperationalEventKind,
  CanonicalOperationalExpectedState,
  CanonicalOperationalReplayOrderingMetadata,
} from "./events";
import type {
  OperationalEventId,
  OperationalEventIdempotencyKey,
  RelationshipId,
  WorkspaceId,
} from "../primitives";

export type OperationalCommandToEventTranslationStatus =
  | "planned_no_write"
  | "exact_duplicate_noop"
  | "explicit_conflict"
  | "validation_failed";

export interface OperationalCommandTranslationNoWriteBoundaryMetadata {
  readonly mode: "fixture_only_operational_command_to_event_translation";
  readonly fixtureOnly: true;
  readonly dryRunOnly: true;
  readonly validationOnly: true;
  readonly commandExecutionAllowed: false;
  readonly canonicalEventEmissionAllowed: false;
  readonly mutationEndpointsAllowed: false;
  readonly repositoriesAllowed: false;
  readonly persistenceAllowed: false;
  readonly neonWritesAllowed: false;
  readonly filesystemWritesAllowed: false;
  readonly automationAllowed: false;
  readonly automationIntentAllowed: false;
  readonly remindersAllowed: false;
  readonly notificationsAllowed: false;
  readonly queueExecutionAllowed: false;
  readonly workflowExecutionAllowed: false;
  readonly productionScoringAllowed: false;
  readonly autonomousWorkflowsAllowed: false;
}

export interface OperationalCommandTranslationDryRunGuarantees {
  readonly wouldEmitCanonicalEvent: false;
  readonly wouldPersist: false;
  readonly wouldWrite: false;
  readonly wouldExecuteAutomation: false;
  readonly wouldSendReminder: false;
  readonly wouldSendNotification: false;
  readonly wouldExecuteQueue: false;
  readonly wouldExecuteWorkflow: false;
}

export interface OperationalCommandTranslationInput {
  readonly mode: "fixture_only_translation_input";
  readonly workspaceId: WorkspaceId;
  readonly relationshipId: RelationshipId;
  readonly command: OperationalEventCommand;
  readonly expectedCurrentState: CanonicalOperationalExpectedState;
  readonly existingCommandFingerprint?: OperationalCommandTranslationFingerprint;
  readonly boundary: OperationalCommandTranslationNoWriteBoundaryMetadata;
}

export interface OperationalCommandTranslationFingerprint {
  readonly commandKind: OperationalEventCommandKind;
  readonly idempotencyKey: OperationalEventIdempotencyKey;
  readonly expectedPriorState: CanonicalOperationalExpectedState;
  readonly deterministicCommandInputs: readonly string[];
}

export interface PlannedCanonicalOperationalEventPreview {
  readonly mode: "planned_canonical_event_preview_only";
  readonly previewOnly: true;
  readonly plannedEventId: OperationalEventId;
  readonly plannedEventFamily: CanonicalOperationalEventFamily;
  readonly plannedEventKind: CanonicalOperationalEventKind;
  readonly plannedEvent: CanonicalOperationalEventEnvelope;
  readonly replayOrdering: CanonicalOperationalReplayOrderingMetadata;
  readonly expectedState: CanonicalOperationalExpectedState;
  readonly dryRunGuarantees: OperationalCommandTranslationDryRunGuarantees;
}

export type OperationalCommandTranslationValidationIssue =
  | OperationalEventCommandValidationIssue
  | {
    readonly code:
      | "forbidden_persistence_intent"
      | "forbidden_filesystem_write_intent"
      | "forbidden_canonical_event_emission_intent"
      | "planned_event_family_mismatch"
      | "planned_event_kind_mismatch"
      | "planned_event_not_replay_sortable";
    readonly message: string;
    readonly field:
      | "boundary"
      | "dryRunGuarantees"
      | "plannedEvent"
      | "replayOrdering"
      | "payload";
  };

export interface OperationalCommandTranslationConflictIssue
  extends OperationalEventCommandConflict {
  readonly existingExpectedState: CanonicalOperationalExpectedState;
  readonly incomingExpectedState: CanonicalOperationalExpectedState;
  readonly appendPrevented: true;
}

export interface BaseOperationalCommandTranslationOutput {
  readonly status: OperationalCommandToEventTranslationStatus;
  readonly input: OperationalCommandTranslationInput;
  readonly dryRunGuarantees: OperationalCommandTranslationDryRunGuarantees;
  readonly boundary: OperationalCommandTranslationNoWriteBoundaryMetadata;
}

export interface OperationalCommandTranslationPlannedOutput
  extends BaseOperationalCommandTranslationOutput {
  readonly status: "planned_no_write";
  readonly acceptedForFutureEventPlanning: true;
  readonly plannedEventPreview: PlannedCanonicalOperationalEventPreview;
  readonly issues: readonly [];
  readonly conflicts: readonly [];
}

export interface OperationalCommandTranslationDuplicateNoopOutput
  extends BaseOperationalCommandTranslationOutput {
  readonly status: "exact_duplicate_noop";
  readonly acceptedForFutureEventPlanning: false;
  readonly plannedEventPreview: PlannedCanonicalOperationalEventPreview;
  readonly issues: readonly [];
  readonly conflicts: readonly [OperationalCommandTranslationConflictIssue];
}

export interface OperationalCommandTranslationConflictOutput
  extends BaseOperationalCommandTranslationOutput {
  readonly status: "explicit_conflict";
  readonly acceptedForFutureEventPlanning: false;
  readonly plannedEventPreview?: PlannedCanonicalOperationalEventPreview;
  readonly issues: readonly [];
  readonly conflicts: readonly [
    OperationalCommandTranslationConflictIssue,
    ...OperationalCommandTranslationConflictIssue[],
  ];
}

export interface OperationalCommandTranslationValidationFailedOutput
  extends BaseOperationalCommandTranslationOutput {
  readonly status: "validation_failed";
  readonly acceptedForFutureEventPlanning: false;
  readonly plannedEventPreview?: PlannedCanonicalOperationalEventPreview;
  readonly issues: readonly [
    OperationalCommandTranslationValidationIssue,
    ...OperationalCommandTranslationValidationIssue[],
  ];
  readonly conflicts: readonly [];
}

export type OperationalCommandTranslationOutput =
  | OperationalCommandTranslationPlannedOutput
  | OperationalCommandTranslationDuplicateNoopOutput
  | OperationalCommandTranslationConflictOutput
  | OperationalCommandTranslationValidationFailedOutput;
