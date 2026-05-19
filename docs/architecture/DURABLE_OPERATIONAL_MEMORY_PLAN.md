# Durable Operational Memory Plan

## Purpose

This plan defines Meridian's first safe durable operational memory model for
relationship review, assignment history, workflow continuity, operator handoffs,
and deterministic operational audit trails.

This is a planning contract only. It does not introduce automation, reminders,
notifications, queue execution, production scoring, Neon write mode, autonomous
workflows, production persistence writes, or hidden operational state.

## Current architectural boundary

Meridian already exposes relationship workflow visibility through read-only
relationship-engine projections:

- relationship workflow visibility;
- multi-operator orchestration;
- assignment-aware visibility;
- workflow continuity;
- deterministic workflow projections;
- continuity-aware operator surfaces;
- read-only relationship-engine API and operator integration.

Those layers consume service projections only. They must continue to avoid
repository imports, UI-derived state, queue execution, workflow execution,
assignment mutation, persistence, Neon writes, reminders, notifications,
automation, autonomous workflows, and production scoring.

Durable operational memory is the next contract that will eventually allow
Meridian to preserve operational facts. It must be designed before any write
mode exists so future persistence does not corrupt deterministic replay or
create invisible workflow state.

## Operational memory philosophy

Operational memory is append-only evidence about human-visible workflow facts.
It exists to explain what happened, why it was visible, who was responsible,
which continuity context changed, and how a projection reached its state.

Operational memory is not an executor. It must not decide that work is done,
move a queue, rebalance ownership, notify an operator, create a reminder,
compute production priority, or silently advance a workflow.

The first durable memory design follows these principles:

1. Canonical memory records facts, not UI impressions.
2. Projection memory remains derivable from canonical events and fixed inputs.
3. Every durable event has actor, source, evidence, timestamps, idempotency, and
   explainability metadata.
4. Missing data can lower confidence or explain limits, but cannot become hidden
   priority, hidden routing, or hidden completion.
5. Review completion is never inferred from visibility, card rendering, queue
   membership, tab selection, local filters, or operator panel state.
6. Assignment history records ownership facts and visibility transitions without
   mutating current ownership during this planning phase.
7. Workflow progression is deterministic metadata until explicit operator
   approval semantics and persistence gates exist.

## Canonical event strategy

Future durable operational memory should extend the canonical relationship
memory pattern used by timeline events: immutable facts with `occurredAt`,
`recordedAt`, `source`, `actorId`, evidence references, confidence, and a
dedupe key.

The first operational event family should be separate from projection DTOs but
linked to relationship memory by relationship id, source projection version, and
evidence pointers. Event ids should be deterministic from workspace,
relationship id, event kind, occurred-at timestamp, actor id, source evidence,
and idempotency key.

### Planned event families

| Family | Canonical event examples | Purpose |
| --- | --- | --- |
| Review history | `review_started`, `review_completed`, `review_reopened`, `review_shared`, `review_escalated`, `manager_review_requested`, `manager_review_completed` | Preserve explicit human review facts without inferring review completion from visibility. |
| Assignment history | `assignment_created`, `assignment_transferred`, `assignment_removed`, `assignment_visibility_changed`, `shared_review_started`, `shared_review_ended`, `ownership_clarified` | Preserve ownership and visibility audit trails without auto-assignment. |
| Continuity history | `continuity_context_created`, `continuity_context_changed`, `continuity_context_resolved`, `continuity_gap_observed` | Preserve why handoff or continuity context changed. |
| Workflow progression | `workflow_projection_observed`, `workflow_review_state_changed`, `workflow_progression_blocked`, `workflow_progression_unblocked` | Preserve deterministic progression observations without executing queues. |
| Operator handoff | `handoff_context_prepared`, `handoff_context_acknowledged`, `handoff_context_superseded` | Preserve handoff memory and acknowledgement facts without notifications or reminders. |

### Canonical event envelope

Every future durable operational event should include:

- `id`: deterministic event id;
- `workspaceId`;
- `relationshipId`;
- `kind`;
- `occurredAt`: when the operational fact happened;
- `recordedAt`: when Meridian recorded the fact;
- `source`: `operator`, `engine`, `api`, `integration`, or `system`;
- `actorId`: operator id or `system` only for explicitly system-observed facts;
- `idempotencyKey`;
- `dedupeKey`;
- `schemaVersion`;
- `projectionVersion`: source projection version when event came from a read
  model observation;
- `evidence`: canonical evidence references or projection evidence pointers;
- `confidence`;
- `reasonCodes`;
- `explainability`: why visible, why assigned, why escalated, missing-data
  effects, and confidence context where applicable;
- `payload`: event-family-specific immutable fact data.

## What becomes canonical memory

Canonical memory should include only events that can be replayed, explained,
deduped, and audited:

- explicit review start and completion submitted through a future write-gated
  review contract;
- explicit escalation review decisions and manager review decisions;
- explicit assignment creation, transfer, removal, shared-review transition, and
  ownership clarification events;
- explicit operator handoff preparation, acknowledgement, and supersession;
- continuity changes caused by canonical review, assignment, lifecycle, evidence,
  or missing-data facts;
- deterministic workflow progression observations recorded through an approved
  event writer after write mode exists.

## What must never become canonical

The following must never be persisted as canonical operational memory:

- UI tab selection, card focus, hover state, local sort, local filter, or local
  route state;
- queue position alone without the source canonical evidence and fixed ordering
  metadata;
- inferred review completion from visibility, queue absence, owner presence, or
  card removal;
- inferred assignment from who opened a relationship or who last viewed it;
- hidden workflow state not visible in DTO explainability;
- automation intent, reminder intent, notification intent, or queue execution
  intent before explicit future contracts exist;
- production scores or priority weights from the current read-only planning
  phase;
- raw storage internals, connection strings, private diagnostics, or repository
  implementation details.

## What remains projection-only

Projection-only data remains derivable and should not be durably written as
memory in this phase:

- workflow group membership;
- continuity group membership;
- multi-operator group membership;
- source queue rank and rank key;
- deterministic item sort keys;
- DTO labels and display copy;
- stale warnings derived from fixed `asOf`;
- aggregate group counts;
- projection metadata that can be rebuilt from canonical events and fixed
  service inputs.

## What remains visibility-only

Visibility-only surfaces continue to explain current review context without
recording new facts:

- review-start visibility before explicit review-start writes exist;
- review-complete visibility before explicit review-complete writes exist;
- escalation, shared review, and manager review visibility;
- assignment-aware visibility in operator panels;
- continuity cards, handoff summaries, and missing-data effects;
- read-only diagnostics and replay metadata.

## Durable review history contracts

Future review history should be explicit and event-backed. Until write mode is
approved, Meridian may only display review state from projections.

Planned review contracts:

- `review_started`: actor explicitly begins review for a relationship.
- `review_completed`: actor explicitly completes review with outcome, evidence,
  and confidence context.
- `review_reopened`: actor or approved system rule reopens a completed review
  because new canonical evidence changed the context.
- `review_shared`: review is made visible to multiple operators for a stated
  reason.
- `review_escalated`: review requires escalation because assignment, evidence,
  lifecycle, or confidence context requires human review.
- `manager_review_requested`: manager review becomes explicitly requested.
- `manager_review_completed`: manager review is explicitly completed.

Review events must carry:

- review scope and relationship id;
- actor id and role;
- prior review state and next review state;
- reason code;
- evidence pointers;
- missing-data effects;
- confidence context;
- deterministic idempotency key;
- projection version observed by the operator.

`reviewed` should remain invisible in continuity projections unless backed by a
canonical `review_completed` event.

## Assignment audit trail model

Assignment audit trails should preserve ownership facts and visibility changes
without performing assignment mutation in the current phase.

Planned assignment events:

- `assignment_created`: a primary owner is explicitly assigned.
- `assignment_transferred`: ownership moves from one operator to another.
- `assignment_removed`: ownership is removed with reason and evidence.
- `assignment_visibility_changed`: visibility changes without ownership changing.
- `shared_review_started`: more than one operator is explicitly visible in review.
- `shared_review_ended`: shared review ends or collapses to single-owner review.
- `ownership_clarified`: ambiguity is resolved without changing underlying
  ownership.

Assignment events must carry:

- previous owner, next owner, visible operators, and visibility scope;
- assignment confidence before and after the event;
- why assigned;
- why visible;
- source evidence;
- missing-data effects;
- reason code;
- actor id;
- deterministic idempotency key.

Current assignment DTOs remain descriptive until a future write-gated assignment
repository exists.

## Continuity persistence strategy

Continuity memory should preserve why handoff context changed, not duplicate the
entire continuity projection.

Future continuity events should record:

- continuity reason;
- previous continuity state and next continuity state;
- review state involved;
- assignment context involved;
- lifecycle context involved;
- source relationship evidence;
- source review or assignment event ids;
- missing-data effects and confidence context;
- deterministic ordering metadata snapshot sufficient for audit.

Continuity projection rows should remain rebuildable from canonical relationship
memory, operational events, and fixed `generatedAt`. Persisting a projection
cache may be allowed later only as a derived cache with a source event watermark,
not as canonical memory.

## Deterministic workflow progression memory

Workflow progression memory should record explicit observations or approvals,
not execute work.

Allowed future progression facts:

- a review state changed because a canonical review event exists;
- a relationship became escalation-visible because canonical evidence and fixed
  projection rules explain it;
- progression is blocked because required evidence, assignment clarity, or
  confidence is missing;
- progression is unblocked because the missing fact became canonical.

Still forbidden:

- queue dispatch;
- workflow execution;
- invisible completion;
- UI-derived progression;
- auto-advancement after viewing;
- hidden automation state.

## Replay guarantees

Durable operational memory must preserve Meridian's deterministic replay
contract:

- fixed canonical events plus fixed source data plus fixed `asOf` or
  `generatedAt` produce identical projections;
- event ordering is by `occurredAt`, then `recordedAt`, then event family rank,
  then deterministic event id;
- duplicate submissions collapse by idempotency key or dedupe key;
- replay never depends on database insertion order, network return order, UI
  render order, local browser state, or queue display order;
- projection caches, if later introduced, are disposable derived data and must
  include source event watermarks;
- event schema migrations must be replayable from older event envelopes.

## Idempotency rules

Every future write-gated event command should require:

- command idempotency key from the caller;
- deterministic event dedupe key;
- relationship id and workspace id;
- actor id and source;
- expected prior state or source projection version when the command is based on
  an operator-visible projection;
- no-op response when the same command is safely replayed;
- explicit conflict response when the expected prior state no longer matches.

Idempotency must prevent duplicate review completion, duplicate assignment
transfer, duplicate handoff acknowledgement, and duplicate progression
observation events.

## Explainability requirements

Every future durable operational memory event that affects operator surfaces must
preserve or link to:

- why visible;
- why assigned;
- why escalated;
- why continuity changed;
- missing-data effects;
- confidence context;
- latest evidence;
- source projection metadata;
- actor and source;
- deterministic ordering context.

If an event cannot explain a state change, it should not be accepted as
canonical memory.

## Hidden state prevention

The durable memory design explicitly prevents:

- invisible workflow completion;
- hidden review state;
- UI-derived progression;
- non-canonical workflow memory;
- implicit automation state;
- hidden assignment mutation;
- hidden reminders or notifications;
- production scoring side effects;
- Neon writes before write mode is explicitly enabled.

Operator surfaces may render durable facts after read adapters exist, but they
must not generate durable facts from rendering.

## Future persistence boundaries

### Repository boundaries

Future persistence should introduce a separate operational memory repository
interface only after the event contracts are finalized. It should be append-only
for canonical events and separate from read-model projection services.

Read services may consume operational memory through read adapters. Projection
builders must not receive write handles.

### Event persistence boundaries

Event persistence should accept only validated canonical event commands. It
should reject projection DTOs, UI state, queue display state, and unversioned
payloads.

The first writer should support dry-run validation and fixture-backed replay
before any production write path exists.

### Neon readiness boundaries

Neon write readiness should require:

- migration-reviewed event tables;
- append-only constraints;
- unique idempotency and dedupe indexes;
- event schema versioning;
- actor/source audit columns;
- read-after-write consistency expectations;
- rollback and replay procedures;
- fixture parity between in-memory/file adapters and Neon read adapters;
- explicit feature gating outside normal read-only service construction.

### Write-mode gating

Write mode remains delayed until Meridian has:

- explicit operator approval semantics;
- review event command contracts;
- assignment event command contracts;
- handoff acknowledgement semantics;
- idempotency and conflict handling;
- rollback procedures;
- audit review procedures;
- migration-backed Neon persistence design;
- automated replay validation;
- static checks proving operator/UI surfaces do not bypass service boundaries.

### Rollback safety

Rollback must treat canonical events as append-only. Corrections should use
reversal or supersession events rather than deleting or rewriting history.

Derived projections and caches may be discarded and rebuilt. Canonical events
must remain auditable.

### Auditability guarantees

Every future durable event must answer:

- what happened;
- who or what recorded it;
- when it occurred;
- when it was recorded;
- why it happened;
- what evidence supports it;
- what state was expected;
- what state changed;
- whether missing data affected confidence;
- how replay orders it deterministically.

## Validation and test planning

Before any durable memory implementation ships, Meridian should add fixture and
static checks for:

- replay validation from canonical operational events plus fixed source data;
- idempotency validation for duplicate review, assignment, handoff, and
  progression commands;
- assignment-history replay across creation, transfer, shared review, visibility
  change, removal, and ownership clarification;
- continuity replay across review, assignment, lifecycle, evidence, and
  missing-data changes;
- audit trail validation that every event has actor, source, evidence,
  confidence, reason code, timestamps, and deterministic idempotency metadata;
- progression ordering validation with reversed input events and equal
  timestamps;
- read-only boundary validation that projection builders and UI surfaces do not
  import write repositories;
- no-automation validation for reminders, notifications, queue execution,
  workflow execution, autonomous workflows, production scoring, and Neon writes.

Current validation for this planning phase should include:

- `npm run build`;
- static source checks for no new operational write paths;
- static source checks for no automation/reminder/notification/queue execution
  additions;
- deterministic replay checks already covered by workflow integration fixtures;
- read-only guarantee checks already covered by API and operator integration
  fixtures.

## Safe next builds

Safe next work:

- type-only operational event envelopes in a non-wired module;
- fixture-only review history examples with no repository writes;
- fixture-only assignment audit trail examples with deterministic replay tests;
- read-only adapter design for future operational memory fixtures;
- static boundary tests that reject operational memory writes from UI and
  projection layers;
- documentation that maps current review visibility states to future canonical
  review event requirements.

Still waiting:

- production persistence writes;
- Neon write mode;
- automation;
- reminders;
- notifications;
- queue execution;
- workflow execution;
- auto-assignment;
- autonomous workflows;
- production scoring;
- operator-facing controls that emit durable events.

## Risks and mitigations

- Risk: review completion gets inferred from visibility. Mitigation: keep
  `reviewed` invisible until backed by canonical `review_completed` events.
- Risk: assignment visibility is mistaken for assignment mutation. Mitigation:
  separate descriptive DTOs from future assignment event commands.
- Risk: projection caches become hidden canonical state. Mitigation: make caches
  disposable and watermark them from source event ids.
- Risk: event insertion order changes replay. Mitigation: deterministic ordering
  by event timestamps, family rank, and event id.
- Risk: future write mode leaks into UI. Mitigation: write repositories stay out
  of projection builders and operator surfaces, with static checks.
- Risk: missing data becomes hidden urgency. Mitigation: persist missing-data
  effects as explainability context, never as priority or routing.

## Why write mode remains delayed

Write mode remains delayed because Meridian still needs event command contracts,
idempotency semantics, conflict behavior, rollback procedures, migration-backed
Neon tables, replay validation, and static boundary tests.

Until those exist, durable operational memory should remain a plan and future
contract. Meridian can keep improving read-only visibility and deterministic
fixtures without accepting production writes or operational side effects.
