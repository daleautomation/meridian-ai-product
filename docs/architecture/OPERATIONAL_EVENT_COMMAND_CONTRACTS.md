# Operational Event Command Contracts

## Purpose

Meridian now has the first no-write command contracts for future canonical
operational event creation. These contracts describe command shapes and dry-run
validation outcomes only. They do not create events, persist data, expose
mutation endpoints, write to Neon, call repositories, run automation, create
reminders, send notifications, execute queues, execute workflows, compute
production scores, or start autonomous workflows.

## Files

- `lib/relationship-engine/operational/commands.ts` defines type-only command
  envelopes, no-write boundaries, idempotency requirements, approval semantics,
  dry-run plans, validation results, and conflict results.
- `scripts/check-operational-event-command-contracts.ts` validates command
  coverage, required fields, dry-run statuses, idempotency rules, and static
  no-write boundaries.
- `package.json` exposes `npm run operational-events:command-contracts`.

## Command contracts added

| Family | Commands | Future event families |
| --- | --- | --- |
| Review history | `start_review`, `complete_review`, `reopen_review`, `escalate_review`, `request_manager_review` | `review_started`, `review_completed`, `review_reopened`, `review_escalated`, `manager_review_requested` |
| Assignment history | `create_assignment`, `transfer_assignment`, `remove_assignment`, `change_assignment_visibility`, `clarify_ownership` | `assignment_created`, `assignment_transferred`, `assignment_removed`, `assignment_visibility_changed`, `ownership_clarified` |
| Operator handoff | `prepare_handoff`, `acknowledge_handoff`, `supersede_handoff` | `handoff_context_prepared`, `handoff_context_acknowledged`, `handoff_context_superseded` |
| Workflow progression | `observe_projection`, `block_progression`, `unblock_progression` | `workflow_projection_observed`, `workflow_progression_blocked`, `workflow_progression_unblocked` |

## Required command fields

Every command envelope requires:

- `workspaceId`;
- `relationshipId`;
- `actor`;
- `idempotencyKey`;
- idempotency requirements;
- expected prior state;
- source projection version;
- source projection metadata;
- evidence;
- reason codes;
- explainability;
- approval semantics;
- dry-run plan;
- no-write boundary policy;
- immutable payload.

## No-write command boundary

The command boundary requires:

- dry-run only;
- validation only;
- command execution disabled;
- canonical event emission disabled;
- mutation endpoints disabled;
- repositories disabled;
- persistence disabled;
- Neon writes disabled;
- automation and automation intent disabled;
- reminders disabled;
- notifications disabled;
- queue execution disabled;
- workflow execution disabled;
- production scoring disabled;
- autonomous workflows disabled.

## Dry-run validation model

Dry-run results can only be:

- `valid_no_write`: the command shape is valid for future event creation, but
  no event is emitted and nothing is written.
- `exact_duplicate_noop`: the command matches an existing idempotency key and
  expected state, so future execution would no-op.
- `explicit_conflict`: the command matches an existing idempotency key but has
  different expected state, so future execution must reject until state is
  refreshed.
- `validation_failed`: required command evidence, state, actor, reason,
  explainability, or no-write constraints are missing or violated.

All dry-run plans explicitly say they would not emit a canonical event, persist,
execute automation, send reminders, send notifications, execute queues, execute
workflows, or write.

## Idempotency and conflict rules

Every command must declare:

- deterministic idempotency key;
- dedupe scope;
- deterministic command inputs;
- exact duplicate policy of `noop`;
- expected state mismatch policy of `explicit_conflict`;
- missing evidence policy of `validation_failure`;
- forbidden automation intent policy of `validation_failure`.

Conflict handling is intentionally conservative:

- exact duplicate = no-op;
- expected state mismatch = explicit conflict;
- missing evidence = validation failure;
- forbidden automation intent = validation failure;
- reminder, notification, queue execution, and workflow execution intent =
  validation failure.

## Approval semantics

Commands require explicit approval semantics before future event creation can be
considered:

- explicit operator approval for operator-originated review, assignment, and
  handoff commands;
- explicit manager approval for manager review commands;
- system observation without execution for workflow projection observations;
- approval evidence is required;
- implicit approval is not allowed;
- automation approval is not allowed.

## Static no-write validation

The command check proves the command contract module has:

- no exported runtime functions, constants, or classes;
- no POST, PATCH, PUT, or DELETE endpoint exports;
- no repository imports or construction;
- no Neon imports or calls;
- no filesystem writes;
- no persistence calls;
- no automation, reminder, notification, queue execution, or workflow execution
  calls.

It also scans app route files for operational command mutation endpoints and
expects none.

## Risks found

No command-layer risks are expected when the check passes. Remaining risk is
future implementation risk: command execution, durable storage, conflict
resolution, rollback behavior, and operator controls still need dedicated design
and validation before writes become safe.

## Safe next

- Add type-level command examples.
- Add fixture-only dry-run validation cases.
- Add fixture-only command-to-event mapping examples behind no-write gates.
- Expand command conflict fixtures for review completion, assignment transfer,
  handoff acknowledgement, and workflow progression observations.

## Still waits

- Production writes.
- Neon write mode.
- Persistence repositories.
- Mutation endpoints.
- Automation.
- Reminders.
- Notifications.
- Queue execution.
- Workflow execution.
- Production scoring.
- Autonomous workflows.
- Operator-facing controls that emit durable operational events.
