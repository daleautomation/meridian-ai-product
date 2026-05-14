# Operator Workflow Continuity

## Purpose

Meridian's first operator workflow continuity layer preserves review context, handoff visibility, assignment context, relationship continuity, and workflow progression visibility for LaborTech's June 2 onboarding.

The layer is visibility-only. It does not automate work, execute queues, mutate assignments, persist projections, write Neon, send reminders, send notifications, or create hidden workflow state.

## Continuity philosophy

Continuity answers human handoff questions:

- why is this relationship visible now?
- which review state is visible?
- who is the assignment anchor?
- what evidence supports the handoff?
- what lifecycle and assignment context should an operator preserve?
- what missing data limits confidence?
- how is the item ordered deterministically?

Continuity does not answer execution questions. It cannot decide that work is complete, assign a new owner, start outreach, dispatch a queue, or notify an operator.

## DTO surfaces

`WorkflowContinuityProjection` consumes:

- `RelationshipWorkflowProjection`;
- `MultiOperatorWorkflowOrchestrationProjection`.

Each continuity item exposes:

- review-state visibility;
- previous reviewer DTO;
- latest reviewer DTO;
- latest review timestamp when evidence exists;
- workflow continuity summary;
- assignment continuity context;
- relationship continuity context;
- handoff confidence;
- why visible;
- latest evidence;
- lifecycle context;
- missing-data effects;
- deterministic ordering metadata.

The current read model does not expose canonical completed-review history. `previousReviewer` and `latestReviewer` therefore preserve observed assignment anchors or explicitly show `not_observed`; they do not infer completed reviews.

## Review-state visibility

Supported review states are:

1. `not_reviewed`
2. `in_review`
3. `reviewed`
4. `shared_review`
5. `escalated_review`
6. `manager_review`
7. `waiting_for_followup_review`
8. `dormant_review`

`reviewed` is reserved for future canonical review evidence. Until that evidence exists, continuity surfaces must not infer reviewed state from UI selection, queue order, assignment ownership, or card visibility.

## Continuity groupings

The first deterministic continuity grouping order is:

1. `in_review` - active operator review visibility.
2. `shared_review` - multiple operators are visible, so handoff context stays explicit.
3. `escalated_review` - assignment or evidence gaps require human escalation review.
4. `manager_review` - account-manager review context is visible.
5. `waiting_for_review` - no canonical completed-review state is available.
6. `dormant_relationship_review` - dormant and reactivation continuity without outreach automation.
7. `follow_up_continuity_review` - follow-up continuity without reminders or execution.

An item may appear in more than one continuity group. The item carries `primaryGroupKind`, `displayedInGroupKinds`, source workflow group, source multi-operator group, source queue rank key, and item rank so overlap remains explainable.

## Explainability guarantees

Every continuity surface must expose:

- why visible;
- latest evidence;
- review continuity reason;
- lifecycle context;
- assignment context;
- confidence;
- missing-data effects;
- deterministic ordering metadata.

Missing data can lower confidence or change visibility language. It must not become hidden urgency, hidden routing, hidden review completion, or automation.

## Deterministic guarantees

Continuity ordering uses:

- fixed continuity group order;
- fixed review state order;
- fixed source multi-operator group order;
- fixed source workflow group order;
- source queue rank key;
- relationship id tie-breaker.

With fixed inputs and fixed `generatedAt`, continuity replay must be stable under queue/feed/workflow input reordering.

## Read-only and canonical boundaries

The continuity layer:

- consumes relationship-engine projections only;
- imports no repositories;
- exposes no write handles;
- keeps UI from deriving continuity state;
- keeps relationship-engine assignment and lifecycle visibility canonical;
- blocks hidden workflow state;
- blocks auto-assignment;
- blocks assignment mutation;
- blocks queue execution;
- blocks workflow execution;
- blocks automation;
- blocks reminders;
- blocks notifications;
- blocks persistence;
- blocks Neon writes;
- blocks production scoring.

## Why automation remains delayed

Automation should wait until Meridian has explicit contracts for:

- operator approval semantics;
- durable review history;
- durable assignment audit trails;
- queue execution idempotency;
- reminder and notification consent;
- suppression and rate limits;
- rollback behavior;
- Neon write contracts;
- production scoring governance.

Before those contracts exist, continuity should help humans understand the workflow, not move the workflow.

## Fixture and test plan

Implemented fixture checks should cover:

- continuity replay tests with reversed workflow inputs;
- operator handoff DTO tests for assigned, unassigned, and shared relationships;
- deterministic continuity ordering tests;
- shared review continuity tests;
- escalation continuity tests;
- dormant continuity tests;
- workflow progression visibility tests;
- read-only boundary tests for no assignment mutation, execution, automation, reminders, notifications, persistence, Neon writes, or production scoring;
- static source checks that continuity does not import repositories or expose mutation calls.

Planned next coverage:

- role-specific intern/account-manager continuity fixtures;
- canonical review-history fixtures once a read-only review-history source exists;
- UI snapshot tests that verify the operator panel renders continuity DTOs without deriving review state;
- dense handoff fixtures with multiple collaborators and missing assignment evidence.

## Safe next builds

Safe next work:

- read-only operator directory labels for reviewer display names;
- relationship selection from continuity cards into the read-only timeline API;
- fixture-backed intern and account-manager role variants;
- review-history read adapters once canonical review events exist.

Still waiting:

- auto-assignment;
- workflow automation;
- queue execution;
- reminders;
- notifications;
- production scoring;
- Neon writes;
- autonomous workflows.
