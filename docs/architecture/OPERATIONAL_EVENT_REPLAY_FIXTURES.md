# Operational Event Replay Fixtures

## Purpose

Meridian now has a fixture-only replay validation layer for canonical
operational events. These fixtures prove that the envelope model is
deterministic, idempotency-ready, append-only, and audit-ready before any
production writer exists.

This layer does not implement production writes, Neon write mode, persistence
repositories, automation, reminders, notifications, queue execution, workflow
execution, production scoring, mutation endpoints, or autonomous workflows.

## Files

- `fixtures/operational-events/canonical-operational-event-fixtures.ts` contains
  canonical fixture arrays only.
- `scripts/check-operational-event-replay-fixtures.ts` validates replay,
  idempotency, append-only boundaries, auditability, and static no-write rules.
- `scripts/check-canonical-operational-events.ts` now validates the canonical
  event envelope contract against the shared fixtures.

## Fixture families

| Family | Fixture events | Replay purpose |
| --- | --- | --- |
| Review history | `review_started`, `review_shared` | Preserve explicit review facts without inferred completion. |
| Assignment history | `assignment_created`, `assignment_visibility_changed` | Preserve ownership and visibility history without assignment mutation. |
| Continuity history | `continuity_context_created`, `continuity_context_changed` | Preserve why continuity context exists or changes. |
| Workflow progression | `workflow_projection_observed`, `workflow_progression_blocked` | Preserve deterministic observations without queue or workflow execution. |
| Operator handoff | `handoff_context_prepared`, `handoff_context_acknowledged` | Preserve handoff facts without reminders or notifications. |

## Replay guarantees verified

The replay validator sorts every fixture by:

1. `occurredAt`;
2. `recordedAt`;
3. family rank;
4. kind rank;
5. deterministic event id tie breaker.

It validates both reversed and deterministically shuffled inputs to prove replay
does not depend on insertion order, array order, UI render order, queue order,
network response order, or hidden state.

## Idempotency findings

The fixture check requires every event to carry:

- deterministic idempotency key;
- deterministic dedupe key;
- deterministic id input list;
- exact duplicate collapse policy;
- explicit conflict policy when expected state differs.

The validator proves an exact duplicate collapses to one accepted event and a
same-dedupe, different-expected-state fixture is reported as a conflict.

## Append-only findings

Every fixture is validated as immutable append-only memory:

- mutation semantics are not allowed;
- overwrite semantics are not allowed;
- deletion semantics are not allowed;
- corrections must be represented by reversal or supersession events;
- projection cache is not canonical;
- event family and kind must match metadata family and kind.

## Auditability findings

Every fixture must include:

- actor id, role, and source;
- source metadata;
- evidence references;
- confidence level and rationale;
- reason codes;
- expected replay state;
- explainability for visibility, assignment, escalation, continuity, and missing
  data effects.

Explained states must cite evidence that exists on the envelope.

## Static no-write boundary checks

The fixture check scans the canonical operational event contract and fixture
module for repository imports, Neon imports or calls, repository construction,
automation calls, reminder calls, notification calls, queue execution calls,
workflow execution calls, mutation endpoint exports, and mutation fetch methods.

It also scans relationship route files for canonical operational event mutation
endpoints and expects none.

## Risks found

No fixture-layer risks are expected when the check passes. Remaining risk is
architectural: future writer work must still design command contracts, conflict
handling, migration-backed append-only storage, rollback behavior, and operator
controls before production persistence is safe.

## Safe next

- Add more fixture-only variants for the remaining event kinds.
- Add fixture-only conflict examples for review completion, assignment transfer,
  handoff acknowledgement, and progression observation.
- Draft future command contracts behind explicit no-write gates.

## Still waits

- Production persistence writes.
- Neon write mode.
- Persistence repositories.
- Automation.
- Reminders.
- Notifications.
- Queue execution.
- Workflow execution.
- Production scoring.
- Autonomous workflows.
- Operator-facing controls that emit durable operational events.
