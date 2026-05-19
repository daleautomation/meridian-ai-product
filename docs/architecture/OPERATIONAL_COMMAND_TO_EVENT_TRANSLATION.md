# Operational Command-to-Event Translation

## Purpose

Meridian now has a fixture-only planning layer that shows how future valid
operational commands would translate into canonical operational event envelopes.
It is deterministic dry-run data only. It does not emit events, persist data,
write to Neon, expose mutation endpoints, call repositories, execute commands,
run automation, create reminders, send notifications, execute queues, execute
workflows, calculate production scores, or start autonomous workflows.

## Files

- `lib/relationship-engine/operational/commandTranslation.ts` defines type-only
  translation inputs, outputs, statuses, planned event previews, validation
  issues, conflict issues, dry-run guarantees, and no-write boundary metadata.
- `fixtures/operational-events/command-to-event-translation-fixtures.ts` contains
  fixture commands, planned event previews, duplicate/no-op output, conflict
  output, and validation failure outputs.
- `scripts/check-operational-command-to-event-translation.ts` validates the
  fixture layer and static no-write boundaries.
- `package.json` exposes `npm run operational-events:command-translation`.

## Translation philosophy

Commands are treated as explicit operator or system intents. Translation does
not mean execution. Translation means a deterministic preview of the canonical
event envelope that a future writer could append after a separate write-mode
design exists.

The first fixture examples cover:

| Command | Planned event |
| --- | --- |
| `start_review` | `review_started` |
| `complete_review` | `review_completed` |
| `create_assignment` | `assignment_created` |
| `transfer_assignment` | `assignment_transferred` |
| `prepare_handoff` | `handoff_context_prepared` |
| `acknowledge_handoff` | `handoff_context_acknowledged` |
| `observe_projection` | `workflow_projection_observed` |
| `block_progression` | `workflow_progression_blocked` |

## Why this remains fixture-only

The layer exists to prove shape, ordering, explainability, and validation rules
before any durable writer exists. Fixtures are easier to audit than partial
runtime behavior because every input, preview, issue, and conflict is visible in
source control.

## Dry-run guarantees

Every translation output and planned event preview carries:

- `wouldEmitCanonicalEvent: false`;
- `wouldPersist: false`;
- `wouldWrite: false`;
- `wouldExecuteAutomation: false`;
- `wouldSendReminder: false`;
- `wouldSendNotification: false`;
- `wouldExecuteQueue: false`;
- `wouldExecuteWorkflow: false`.

The no-write boundary also keeps repositories, persistence, Neon writes,
filesystem writes, mutation endpoints, automation intent, reminders,
notifications, queue execution, workflow execution, production scoring, and
autonomous workflows disabled.

## Event preview semantics

Planned event previews use the canonical append-only event envelope shape:

- deterministic event ids;
- deterministic replay ordering metadata;
- deterministic idempotency and dedupe metadata;
- explainability metadata and evidence;
- expected state;
- append-only semantics;
- canonical no-write event boundary.

Previews are not emitted. They are inert examples used by validation scripts.

## Idempotency and conflict behavior

The fixture layer preserves conservative command acceptance semantics:

- exact duplicate command = `exact_duplicate_noop`;
- expected state mismatch = `explicit_conflict`;
- missing evidence = `validation_failed`;
- forbidden automation intent = `validation_failed`;
- forbidden reminder, notification, queue execution, or workflow execution intent
  = `validation_failed`.

Conflicts prevent appending in the preview model. Duplicate no-ops also prevent
append because the future append-only writer would not add the same fact twice.

## Why write mode remains delayed

Write mode still needs dedicated design for storage migrations, repository
interfaces, transaction boundaries, conflict resolution, replay recovery,
operator controls, audit trails, rollback behavior, and production observability.
This fixture layer intentionally stops before those concerns so Meridian can
review the command-to-event contract without introducing irreversible behavior.

## Safe next

- Add more fixture-only command variants.
- Add supersession and reopening conflict fixtures.
- Design repository interfaces as contracts without enabling persistence.
- Draft write-mode acceptance criteria separately.

## Still waits

- Production writes.
- Neon write mode.
- Persistence repositories.
- Mutation endpoints.
- Real command execution.
- Automation.
- Reminders.
- Notifications.
- Queue execution.
- Workflow execution.
- Production scoring.
- Autonomous workflows.
