# Meridian Relationship Workflow Integration

## Philosophy

The relationship workflow integration layer lets the Meridian Relationship Engine inform operator workflows without executing them. It is a read-only visibility layer over existing relationship-engine service projections:

- relationship queues explain which relationships may need review;
- workflow groups translate those queues into review surfaces;
- operators see why a relationship appears now, the evidence behind it, confidence, lifecycle context, and missing-data effects;
- no workflow action is dispatched from this layer.

## Safe boundaries

Workflow integration remains review-only and visibility-only.

Allowed inputs:

- `RelationshipQueueProjection`
- `RelationshipFeedProjection`
- service/API metadata from the relationship engine facade

Forbidden behavior:

- workflow execution
- queue dispatch
- notifications
- reminders
- autonomous outreach
- production scoring
- Neon writes
- persistence of workflow projections
- repository imports from workflow or UI layers
- UI-derived workflow state

The workflow layer consumes service projections only. Repositories remain hidden behind `RelationshipEngineReadService`, and UI components render workflow DTOs instead of deriving workflow status.

## DTO surfaces

`RelationshipWorkflowProjection` contains reusable context DTOs for:

- relationship maintenance workflows;
- follow-up review workflows;
- relationship health workflows;
- dormant and reactivation review workflows;
- operator workflow context.

Each workflow-ready relationship summary exposes:

- `whyNow` explanations;
- evidence references;
- confidence;
- missing-data effects;
- lifecycle context;
- owner visibility;
- deterministic order metadata, including source queue rank and rank key.

## Deterministic grouping guarantees

Workflow group order is fixed:

1. `needs_relationship_attention`
2. `stale_relationship_review`
3. `follow_up_review`
4. `retention_review`
5. `warm_opportunity_review`
6. `reactivation_review`

Item ordering uses deterministic source queue rank, source queue rank key, relationship id, and queue item id. The layer does not introduce hidden priority scores or production scoring weights.

## Relationship workflow groupings

The first integration layer exposes these review groups:

- `needs_relationship_attention` from `needs_attention`;
- `stale_relationship_review` from `cooling_relationships`;
- `follow_up_review` from `overdue_follow_ups`;
- `retention_review` from `retention_risk`;
- `warm_opportunity_review` from `warm_opportunities`;
- `reactivation_review` from `reactivation_candidates`.

Derived visibility sets include overdue relationships, dormant relationships, and warm opportunities. These are summaries for operator review only, not action queues.

## Explainability guarantees

Every workflow group and item carries enough context for an operator to understand the surface:

- why the relationship appears now;
- source queue and reason codes;
- evidence pointers and timeline references;
- confidence level;
- missing-data effects;
- lifecycle eligibility context;
- deterministic order metadata.

Missing data is visible as confidence and limitation metadata. It must not be converted into hidden urgency or automation.

## Why automation remains delayed

The relationship engine is now safe to inform workflows, but it should not execute workflows until later phases define:

- explicit operator approval semantics;
- durable audit trails;
- notification/reminder consent and rate limits;
- production scoring governance;
- replay-safe execution idempotency;
- rollback and suppression rules;
- Neon write contracts.

Until those contracts exist, workflow integration must remain read-only.

## Fixture and test plan

Validation should cover:

- workflow replay tests with reversed queue/feed inputs;
- deterministic grouping tests for fixed group and item order;
- stale workflow tests for cooling relationships;
- relationship maintenance tests for attention, stale, and retention groups;
- missing-data workflow tests for no owner and no health trace effects;
- workflow visibility tests for overdue, dormant, and warm opportunity sets;
- read-only boundary tests for no execution, automation, reminders, notifications, persistence, Neon writes, or production scoring.

Current checks:

- `npx tsx scripts/check-relationship-workflow-integration.ts`
- `npx tsx scripts/check-relationship-operator-integration.ts`
- `npx tsx scripts/check-relationship-engine-api.ts`
- `npm run build`
