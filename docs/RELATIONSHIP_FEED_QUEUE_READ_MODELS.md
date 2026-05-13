# Relationship Feed and Queue Read Models

This pass adds the first safe operator read models for the Meridian Relationship Engine. They are projection-only DTO surfaces for feeds, queues, and timelines. They do not notify, remind, dispatch, execute queue work, write Neon, or power Brookside/Servpro UI.

## Philosophy

Operators should eventually consume readable relationship state without parsing raw events or recreating ranking logic in UI. The canonical path is:

1. Normalize source activity into `TimelineEvent`.
2. Project `RelationshipSummaryProjection`.
3. Build operator read models from summaries, timeline events, promises, follow-up instructions, and health traces.
4. Let UI, MCP tools, or API layers display DTOs without deriving state or rank.

## Feed read models

`projectRelationshipFeed` and `projectAllRelationshipFeeds` produce:

- `relationship_activity`: canonical activity feed over timeline events.
- `operator_relationship`: operator-visible activity feed filtered by summary owner visibility.
- `relationship_momentum`: descriptive momentum hints copied from summary projections.
- `overdue_relationship`: overdue promises and follow-up instructions.
- `relationship_change`: lifecycle, ownership, outcome, promise, and system changes.

Each feed item includes relationship state, lifecycle context, owner visibility, latest evidence, timeline references, confidence, and missing-data effects.

## Queue read models

`projectRelationshipQueue` and `projectAllRelationshipQueues` produce read-only queues for:

- `needs_attention`
- `overdue_follow_ups`
- `cooling_relationships`
- `retention_risk`
- `warm_opportunities`
- `reactivation_candidates`

Queue items explain why they exist through reason records. Reasons are evidence-backed and expose missing data as confidence or visibility context, not hidden urgency.

## Deterministic ranking

Queue rank is scaffolding only. It is not production scoring.

Ordering uses stable sort keys:

- reason tier
- due date when present
- activity age when relevant
- confidence rank
- relationship id and stable item id tie-breakers

The same canonical inputs replay to the same feed, queue, and timeline outputs even if input arrays arrive in a different order.

## Timeline read models

`projectRelationshipTimeline` creates operator-readable groups:

- grouped activity
- promises
- lifecycle changes
- outcomes
- follow-ups
- ownership changes
- relationship momentum

Groups copy canonical facts into readable rows and keep evidence attached. No group mutates relationship state or invents a lifecycle transition.

## Integrity validation

Queue and feed validation checks:

- evidence presence for queue items
- owner visibility instead of inferred visibility
- relationship references
- timeline references
- stale summary projections
- terminal lifecycle queue eligibility
- missing-owner and missing-evidence warnings

Validation findings travel with the projection so consumers do not need hidden rules.

## MCP DTO boundary

`relationshipFeedProjectionToMcpDtos`, `relationshipQueueProjectionToMcpDtos`, and `relationshipTimelineProjectionToMcpDto` serialize the read models for MCP consumption. Queue MCP DTOs are marked `reviewOnly: true` so tools can display explainable surfaces without dispatching actions.

## Fixture and test plan

Current fixture coverage lives in `scripts/check-relationship-read-models.ts`:

- queue replay tests with reversed input ordering
- feed ordering tests with reversed input ordering
- stale relationship and stale projection warnings
- deterministic ranking stability
- duplicate event collapse into one feed item
- missing owner visibility warnings
- terminal lifecycle exclusion from active queues
- grouped timeline coverage for activity, promises, lifecycle changes, ownership, and momentum

Future table fixtures should add:

- invalid timeline reference failures
- health-trace missing-data combinations
- owner reassignment visibility changes
- promise fulfilled/cancelled/superseded cases
- lifecycle transition edge cases for dormant/reactivation/closed states

## What remains intentionally delayed

- notifications
- reminders
- automation
- queue execution
- production scoring weights
- Neon writes
- Brookside UI
- Servpro UI
- autonomous workflows
