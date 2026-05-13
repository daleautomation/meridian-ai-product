# Multi-Operator Workflow Orchestration

## Purpose

Meridian's first multi-operator workflow layer is a review-only coordination surface for LaborTech's June 2 onboarding of interns, account managers, and multiple operators.

It organizes relationship-engine workflow visibility into operator-readable workload groups without assigning work, executing queues, sending reminders, sending notifications, persisting projection state, writing Neon, or introducing autonomous workflows.

## Assignment visibility philosophy

Assignment visibility is descriptive, not mutative.

- The layer reads canonical `ownerVisibility` from relationship-engine workflow DTOs.
- It can say who appears assigned, why the relationship is visible, and how confident the assignment signal is.
- It cannot create, update, rebalance, or infer durable assignments.
- Unassigned relationships stay unassigned and move into review visibility only.
- Shared relationships stay shared and move into ownership-clarity visibility only.

The UI should render ownership language from DTOs such as `assignedOperator`, `workflowOwnership`, `assignmentVisibility`, and `assignmentConfidence`. It should not derive owner state from lead cards, tabs, local filters, or UI selection.

## DTO surfaces

`MultiOperatorWorkflowOrchestrationProjection` exposes reusable DTOs for:

- assigned operator state;
- workflow ownership state;
- assignment visibility;
- assignment confidence;
- shared workflow state;
- intern review state;
- escalation review state;
- deterministic ordering metadata.

Each item exposes:

- `whyAssigned`;
- `whyVisible`;
- confidence;
- visibility reason;
- lifecycle context;
- missing-data effects;
- source workflow group kinds;
- source queue kind, rank, rank key, and deterministic sort key.

## Workflow ownership rules

The first deterministic ownership segmentation is:

1. `my_relationships` - current operator is the canonical primary owner.
2. `unassigned_review` - no canonical owner exists.
3. `shared_review` - more than one operator is visible.
4. `intern_queue` - relationship has enough confidence and assignment context for intern review visibility.
5. `needs_escalation` - assignment confidence, unassigned state, or missing-data visibility limits require escalation review.
6. `needs_manager_review` - account-manager review is useful before intern/operator action.
7. `follow_up_review` - follow-up visibility separated from reminders and execution.

Group membership is deterministic and may expose a relationship in more than one review lens. The item carries `primaryGroupKind` and `displayedInGroupKinds` so consumers can explain overlap instead of hiding it.

## Explainability guarantees

Every multi-operator surface must expose:

- why the relationship appears in the group;
- why the relationship is assigned or unassigned;
- assignment confidence;
- visibility reason;
- lifecycle context;
- missing-data effects;
- source workflow group;
- source queue rank and rank key;
- deterministic ordering strategy.

Missing data must be shown as confidence and limitation metadata. It must not become hidden urgency, hidden priority, or automatic routing.

## Deterministic orchestration guarantees

The layer consumes `RelationshipWorkflowProjection` only. It does not import repositories or raw storage adapters.

Ordering is fixed by:

- multi-operator group order;
- source workflow group order;
- source workflow sort key;
- relationship id tie-breaker.

With fixed input and fixed `generatedAt`, replaying reversed queue/feed inputs must produce the same orchestration projection.

## Read-only boundary

The boundary explicitly blocks:

- auto-assignment;
- assignment mutation;
- queue execution;
- workflow execution;
- automation;
- reminders;
- notifications;
- persistence;
- Neon writes;
- production scoring;
- UI-derived ownership.

## Why automation remains delayed

Automation should wait until later phases define:

- explicit operator approval semantics;
- durable assignment audit trails;
- notification and reminder consent;
- queue execution idempotency;
- rate limits and suppression rules;
- rollback rules;
- Neon write contracts;
- production scoring governance.

Until those exist, Meridian should coordinate review visibility only.

## Fixture and test plan

Implemented checks:

- deterministic replay of base workflow grouping;
- deterministic replay of multi-operator grouping;
- assigned operator visibility;
- shared queue visibility;
- unassigned review visibility;
- intern queue visibility;
- escalation visibility;
- manager review visibility;
- follow-up review visibility;
- static no-repository and no-mutation checks.

Planned fixture coverage:

- assignment replay tests across multiple operators and role views;
- deterministic segmentation tests with reversed workflow input order;
- shared queue tests with primary owner plus collaborator/observer relationships;
- unassigned queue tests with no owner evidence;
- escalation visibility tests for low-confidence or missing assignment data;
- operator workload visibility tests for intern, operator, and account-manager roles;
- UI snapshot tests verifying the operator panel renders DTO fields without deriving owner logic.

## Safe next builds

Safe next work:

- add richer read-only operator directory labels for display names;
- add fixture-backed role variants for intern and account-manager users;
- add relationship selection from orchestration cards into the read-only timeline API;
- add deeper manual QA scenarios for dense multi-operator queues.

Still waiting:

- auto-assignment;
- workflow automation;
- reminders;
- notifications;
- queue execution;
- production scoring;
- Neon writes;
- autonomous workflows.
