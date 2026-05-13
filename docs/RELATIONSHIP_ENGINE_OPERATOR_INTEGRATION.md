# Relationship Engine Operator Integration

This document defines the first safe operator-facing integration layer for the
Meridian Relationship Engine. The goal is visibility, review, and diagnostics;
not automation.

## Operator integration philosophy

Operator surfaces may show relationship intelligence only after it has crossed a
Relationship Engine boundary:

1. Relationship Engine read service facade.
2. Relationship Engine read-only HTTP API.
3. Internal admin diagnostics API for admin-only metadata.

The first implementation uses `buildRelationshipEngineOperatorSurface`, which
calls `createRelationshipEngineReadServiceForWorkspace` and
`createRelationshipEngineFacadeDiagnosticsConsumer`. The operator UI receives a
serialized surface and renders it in the `Relationships` tab. It does not import
repositories, parse raw timeline events, rank queues, recompute projections, or
derive relationship state from lead UI data.

## Read-only guarantees

Operator integration remains:

- retrieval-only
- projection-only
- review-only
- visibility-only
- explainability-first

The surface explicitly blocks:

- writes
- queue execution
- automation
- reminders
- notifications
- production scoring
- Neon writes
- timeline persistence
- autonomous workflows

There are no execute, dispatch, notify, remind, mutate, save, or persistence
controls in the operator relationship panel.

## Explainability philosophy

Every operator-facing relationship surface should expose the service metadata
that explains why something is visible:

- why-now explanations from queue item `whyItExists` and reason records
- evidence reference counts and latest evidence descriptions
- confidence levels from read models and service envelopes
- missing-data effects with field, reason, and effect
- lifecycle context and queue eligibility
- deterministic ordering metadata, including strategy, sort keys, tie breakers,
  and production scoring disabled state
- replay metadata from diagnostics, including `replaySafeWithFixedAsOf`

UI components may format this metadata, but must not invent urgency, perform
ranking, or hide missing-data effects.

## Diagnostics visibility rules

Operator visibility includes safe health and validation metadata:

- relationship-engine health
- normalization status
- projection status and stale projection warnings
- queue validation status
- timeline validation status
- repository readiness status
- deterministic replay status
- missing-data warnings

Admin-only visibility may include the safe diagnostics envelope returned by the
facade diagnostics consumer or internal admin diagnostics API. It must remain
metadata-only and must not expose secrets, storage handles, raw repository
internals, connection strings, table names, private debug logs, or raw timeline
payloads.

## Service/API-only consumption rules

Allowed:

- `RelationshipEngineReadService`
- `createRelationshipEngineReadServiceForWorkspace`
- `createRelationshipEngineFacadeDiagnosticsConsumer`
- `GET /api/relationship-engine/*`
- `GET /api/internal/relationship-engine/*` for admin-only diagnostics

Forbidden:

- direct repository imports in operator surfaces
- direct timeline event parsing in UI
- UI-derived queue ordering
- projection recomputation in UI
- mutation methods
- queue execution calls
- notification, reminder, or workflow automation calls
- Neon write adapters

## Surfaces added

- Operator relationship health overview.
- Review-only relationship queue panel.
- Relationship timeline display readiness panel.
- Relationship summary display counts.
- Safe diagnostics panel.
- Admin-only diagnostics metadata panel.
- Stale relationship and missing-data visibility through diagnostics metadata.
- Deterministic replay and ordering metadata display.

The current repository binding is still `read_only_unwired`, so real
relationship rows, timelines, and queue items render as honest empty states
until read adapters are wired.

## Fixture and test planning

Current check:

- `scripts/check-relationship-operator-integration.ts`

Planned fixture-backed coverage:

- Operator replay tests: build the operator surface twice with fixed `now` and
  fixture repositories, then assert deep equality.
- Queue rendering consistency tests: render queue projections with reversed
  canonical input order and assert queue order, rank keys, explanations,
  evidence references, and missing-data effects remain stable.
- Diagnostics panel tests: verify health, normalization, projection, queue,
  repository, and deterministic replay metadata render without raw internals.
- Stale relationship visibility tests: seed stale timeline/projection fixtures
  and assert stale warnings remain visible in health and diagnostics panels.
- Missing-data visibility tests: seed no-owner, no-health-trace, no-touchpoint,
  and no-follow-up fixtures and assert effects render with confidence impact.
- Admin/operator access tests: assert admin sessions receive admin diagnostics,
  client operator sessions receive only safe operator metadata, and non-operator
  sessions cannot access client workspace relationship APIs.
- Repository leakage tests: statically reject repository imports, mutation HTTP
  methods, queue execution calls, notification calls, reminder calls, and Neon
  write paths in operator relationship surfaces.

## Safe next builds

Safe next work:

- Wire read-only file or Neon read adapters behind the existing service factory.
- Add fixture-backed operator replay snapshots.
- Add relationship selection from queue item to timeline API.
- Add admin diagnostics route consumption for a dedicated admin page.

Still waiting:

- notifications
- reminders
- automation
- queue execution
- production scoring
- Neon writes
- Brookside UI
- Servpro UI
- autonomous workflows
