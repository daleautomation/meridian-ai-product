# Relationship Engine API Boundary

This API layer is the first safe read-only exposure point for Meridian
Relationship Engine intelligence. It is retrieval-only, projection-only, and
service-backed.

## Endpoint philosophy

- `GET /api/relationship-engine/summary?workspace=&relationshipId=`
- `GET /api/relationship-engine/timeline?workspace=&relationshipId=`
- `GET /api/relationship-engine/feeds?workspace=`
- `GET /api/relationship-engine/queues?workspace=`
- `GET /api/relationship-engine/projection?workspace=&relationshipId=`
- `GET /api/relationship-engine/health?workspace=`

Routes do not read repositories, parse timeline events, derive queue ordering,
execute queues, persist projections, send notifications, create reminders,
write Neon, or compute production scores. They authenticate, authorize
workspace access, call `RelationshipEngineReadService`, and serialize the
service result.

## Read-only guarantees

Every endpoint only supports `GET`. Mutation methods return `405` with a
read-only boundary payload. The response metadata declares:

- `retrievalOnly: true`
- `projectionOnly: true`
- `mutations: false`
- `queueExecution: false`
- `notifications: false`
- `reminders: false`
- `productionScoring: false`
- `neonWrites: false`
- `timelinePersistence: false`

## Service-layer orchestration

The API boundary constructs an authorized `EngineContext` and invokes only the
read facade:

- `getRelationshipSummary`
- `getRelationshipTimeline`
- `getRelationshipFeeds`
- `getRelationshipQueues`
- `getRelationshipProjection`

Repository wiring is isolated behind
`createRelationshipEngineReadServiceForWorkspace`. The current mode is
`read_only_unwired`, which safely returns empty read repositories until explicit
file or Neon read adapters exist.

## Auth and access rules

Requests require a valid Meridian session. Each request must target a workspace
the session can access through `getWorkspaceAccess`.

Client workspaces require an operator role: `admin_operator` or `client_user`.
Demo workspaces may be read by roles already authorized for the demo workspace,
including advisor/demo viewers. No endpoint is public.

## Validation behavior

The boundary validates:

- workspace presence and workspace authorization
- required `relationshipId` for summary, timeline, and projection endpoints
- canonical lifecycle filters
- ISO timestamps for `asOf`, `updatedAfter`, and `followUpDueBefore`
- page limits between `1` and `500`
- relationship id list size, capped at `100`

The service layer validates relationship existence, lifecycle integrity,
projection integrity, queue integrity, stale timeline/projection conditions,
evidence availability, confidence, and missing-data effects. Service warnings
and issues are surfaced under `meta.validation`, `meta.warnings`,
`meta.confidence`, `meta.evidence`, and `meta.missingDataEffects`.

## Deterministic response guarantees

Responses are stable when callers provide the same canonical data and the same
`asOf` timestamp. The API serializes object keys deterministically and emits
feeds and queues as ordered arrays:

- feeds: `relationship_activity`, `operator_relationship`,
  `relationship_momentum`, `overdue_relationship`, `relationship_change`
- queues: `needs_attention`, `overdue_follow_ups`, `cooling_relationships`,
  `retention_risk`, `warm_opportunities`, `reactivation_candidates`

Queue and feed ordering still comes from the projection services. Route
handlers never rank or sort items by business meaning.

## Safe diagnostics

Response metadata includes `generatedAt`, validation warnings, confidence,
evidence, missing-data effects, access mode, read-only guarantees, collection
ordering, and repository mode. It does not expose secrets, private debug logs,
raw storage handles, table names, connection strings, or repository internals.

## Fixture and test planning

Current API checks live in `scripts/check-relationship-engine-api.ts` and cover:

- unauthenticated access
- workspace authorization boundaries
- invalid lifecycle input
- relationship-not-found validation
- mutation method rejection
- deterministic queue serialization with fixed `asOf`
- projection-safe feed and queue arrays
- health endpoint read facade usage

Next fixture-backed tests should add:

- replay tests against file/Neon read adapters once they exist
- serialization snapshots for summary, timeline, feeds, queues, and projection
- admin/operator versus demo/advisor boundary matrices
- workspace assignment denial tests
- stale summary and stale timeline fixtures
- queue integrity fixtures for missing evidence and terminal lifecycle states

## Still intentionally waiting

Notifications, reminders, automation, queue execution, production scoring,
Neon writes, Brookside UI, Servpro UI, and autonomous workflows remain outside
this API boundary.
