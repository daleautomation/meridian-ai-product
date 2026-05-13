# Meridian Relationship Engine Observability

This layer adds safe operational visibility for the Meridian Relationship
Engine. It inspects health, validation, projection integrity, queue integrity,
timeline normalization, repository readiness, and consumer boundaries without
adding notifications, reminders, automation, queue execution, production
scoring, UI implementation, Neon writes, or autonomous workflows.

## Observability philosophy

- Diagnostics are read-only metadata surfaces over canonical read services.
- Internal callers must use API endpoints or service-layer facades, never
  repositories.
- Diagnostics explain readiness and warnings without exposing secrets, raw
  storage handles, raw env values, cookies, tokens, table names, or private
  client data.
- Queue diagnostics remain review-only. They can count, validate, and explain
  queue projections, but cannot dispatch or clear work.
- Missing data and confidence are first-class diagnostic facts, not hidden
  urgency signals.

## Internal diagnostics boundaries

Admin-only endpoints:

- `GET /api/internal/relationship-engine/diagnostics`
- `GET /api/internal/relationship-engine/health`
- `GET /api/internal/relationship-engine/validation`

Every internal diagnostics endpoint is:

- admin-only
- GET-only
- metadata-only
- service-backed
- deterministic when callers pass a fixed `asOf`
- explicit about read-only guarantees

Mutation methods return `405`. Non-admin users receive `403`, and unauthenticated
requests receive `401`.

## Health model

The health response exposes:

- normalization status
- projection status
- queue validation status
- timeline validation status
- repository mode
- deterministic replay status
- stale projection warnings
- missing-data warnings
- read-only guarantees

Repository mode currently supports `read_only_unwired`, which is operationally
safe but reports repository readiness as not configured until explicit read
adapters are wired.

## Diagnostic metadata

Diagnostics include:

- `generatedAt`
- deterministic ordering metadata for feeds and queues
- validation warning summaries
- confidence summaries
- missing-data summaries
- repository mode
- read-only guarantees
- admin/internal/safe metadata flags

Diagnostics do not include raw timeline rows, raw repository objects, raw
storage internals, secrets, raw env values, cookies, tokens, or write handles.

## Deterministic replay guarantees

Diagnostics call the existing `RelationshipEngineReadService` facade for feed
and queue projections. With identical canonical inputs and a fixed `asOf`,
diagnostics replay to identical JSON because:

- service outputs use deterministic projection ordering
- relationship id inputs are sorted and deduped
- internal responses are serialized with stable object key ordering
- feed order and queue order are exposed as explicit metadata

## Consumer integration rules

Safe internal consumers are registered in
`RELATIONSHIP_ENGINE_INTERNAL_CONSUMER_BOUNDARIES`:

- `operator_workspace`
- `future_admin_dashboard`
- `future_mcp_tooling`
- `future_diagnostics_panel`

Consumers may only use:

- internal admin diagnostics APIs
- relationship-engine service facades

Consumers must not import repositories, infer storage details, execute queues,
write projections, trigger automation, send notifications, create reminders,
write Neon, or expose raw internals.

## Safe operator integration strategy

The operator workspace can safely add server-only health panels next by calling
the service-facade diagnostics consumer or the internal admin endpoints. The UI
should display status, warning summaries, confidence, missing-data summaries,
and repository readiness only. It should not parse raw events, derive queues,
write state, or trigger workflows.

## Fixture and test planning

Current verification should cover:

- diagnostics replay tests with fixed `asOf`
- queue integrity diagnostics tests for evidence, visibility, and terminal
  lifecycle safety
- projection warning tests for stale summaries and stale activity
- stale relationship diagnostics tests across feeds and queues
- consumer integration boundary tests proving repositories are disallowed
- admin access tests for unauthenticated, non-admin, and admin sessions
- repository leakage tests checking metadata does not expose storage internals

Future fixture-backed tests should add:

- file and Neon read-adapter readiness fixtures once adapters exist
- normalization warning fixtures for each source adapter type
- API boundary matrix tests across workspace assignment and admin roles
- MCP diagnostics serialization snapshots
- operator panel tests after UI work is explicitly approved

## Still intentionally waiting

- notifications
- reminders
- automation
- queue execution
- production scoring
- Brookside UI
- Servpro UI
- Neon writes
- autonomous workflows
