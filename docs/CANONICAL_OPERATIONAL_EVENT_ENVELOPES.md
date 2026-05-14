# Canonical Operational Event Envelopes

## Purpose

Meridian's first canonical operational event layer defines type-only envelopes
for future operational memory. These contracts describe review history,
assignment history, continuity history, workflow progression, and operator
handoff facts without enabling production writes.

This phase does not implement persistence, repositories, Neon write mode,
automation, reminders, notifications, queue execution, workflow execution,
production scoring, or autonomous workflows.

## Event philosophy

Operational events are append-only facts about human-visible workflow state.
They explain what happened, why it was visible, who observed or performed it,
which evidence supports it, and how deterministic replay should order it.

They are not commands, jobs, queues, reminders, notifications, or projection
caches. Rendering a card, selecting a tab, viewing a queue, or appearing in a
read model must not create canonical operational memory.

## Envelope contract

Each canonical operational event envelope includes:

- deterministic event id;
- workspace and relationship ids;
- event family and kind;
- occurred-at and recorded-at timestamps;
- actor and source metadata;
- replay ordering metadata;
- idempotency and dedupe metadata;
- expected prior state;
- append-only semantics;
- read-only boundary guarantees;
- explainability metadata;
- family-specific immutable payload.

The first event families are:

| Family | Kinds | Purpose |
| --- | --- | --- |
| Review history | `review_started`, `review_completed`, `review_reopened`, `review_shared`, `review_escalated`, `manager_review_requested`, `manager_review_completed` | Preserve explicit review facts without inferring completion from visibility. |
| Assignment history | `assignment_created`, `assignment_transferred`, `assignment_removed`, `assignment_visibility_changed`, `shared_review_started`, `shared_review_ended`, `ownership_clarified` | Preserve ownership and visibility audit facts without mutating assignments. |
| Continuity history | `continuity_context_created`, `continuity_context_changed`, `continuity_context_resolved`, `continuity_gap_observed` | Preserve why continuity context changed. |
| Workflow progression | `workflow_projection_observed`, `workflow_review_state_changed`, `workflow_progression_blocked`, `workflow_progression_unblocked` | Preserve deterministic progression observations without executing queues. |
| Operator handoff | `handoff_context_prepared`, `handoff_context_acknowledged`, `handoff_context_superseded` | Preserve handoff facts without reminders or notifications. |

## Append-only semantics

Operational events are immutable. Corrections must be represented by later
reversal, supersession, or clarification events. Existing events must not be
mutated, overwritten, deleted, or treated as disposable projection cache.

The type contract exposes append-only flags so future validators can reject
mutation semantics before any writer exists.

## Replay guarantees

Replay must be deterministic from fixed event inputs:

1. sort by `occurredAt`;
2. break ties by `recordedAt`;
3. break ties by family rank;
4. break ties by kind rank;
5. break ties by deterministic event id.

Replay must never depend on database insertion order, network response order,
browser state, UI render order, queue display order, local filters, or hidden
automation state.

## Idempotency philosophy

Every envelope carries:

- caller-provided idempotency key;
- deterministic dedupe key;
- deterministic id input list;
- duplicate policy of collapsing exact duplicates;
- conflict policy requiring explicit conflict when expected state differs.

This prepares future command handlers to avoid duplicate review completion,
assignment transfer, handoff acknowledgement, and progression observation
events without adding a writer in this phase.

## Explainability and auditability

Every event envelope exposes:

- why visible;
- why assigned;
- why escalated;
- why continuity changed;
- missing-data effects;
- confidence context;
- evidence references;
- reason codes;
- actor metadata;
- source metadata.

Events that cannot explain their operational effect should not become canonical
memory. Missing data may lower confidence, limit visibility, or block
progression, but it must not become hidden priority, hidden routing, hidden
completion, or hidden automation.

## Hidden state prevention

The envelope boundary explicitly rejects:

- inferred review completion;
- UI-derived workflow memory;
- projection cache as canonical memory;
- hidden automation state;
- invisible workflow progression;
- assignment mutation;
- queue execution;
- workflow execution;
- reminders;
- notifications;
- Neon writes;
- production scoring.

## Why persistence remains delayed

Persistence remains delayed because Meridian still needs command contracts,
validation rules, conflict behavior, rollback procedures, migration-backed
tables, replay fixtures, and static boundary checks. Defining envelopes first
keeps future storage append-only, idempotency-ready, and audit-ready without
introducing premature write paths.

## Fixture and test planning

Fixture coverage should include:

- replay ordering tests with reversed event inputs;
- idempotency tests for duplicate event keys;
- append-only validation for immutable semantics;
- event envelope validation for required metadata;
- deterministic ordering validation for equal timestamps;
- auditability validation for actor, source, evidence, confidence, reason codes,
  expected state, and explainability;
- static checks for no persistence, repositories, writes, Neon, automation,
  reminders, notifications, queue execution, workflow execution, or production
  scoring in operational event modules.

Safe next work:

- fixture-only review history examples;
- fixture-only assignment history examples;
- read-only replay validators over fixture arrays;
- static boundary checks for future operational modules.

Still waiting:

- production persistence writes;
- Neon write mode;
- automation;
- reminders;
- notifications;
- queue execution;
- workflow execution;
- autonomous workflows;
- production scoring;
- operator-facing controls that emit durable events.
