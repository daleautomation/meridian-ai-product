# Meridian Relationship Engine Service Layer

The first service layer is a read-only orchestration boundary over canonical
relationship memory. It centralizes relationship intelligence access without
adding notifications, reminders, queue execution, production scoring, UI flows,
Neon writes, or autonomous workflows.

## Philosophy

- Services retrieve canonical entities from repository interfaces, normalize
  timeline memory, assemble projections, and return deterministic read models.
- Repositories stay hidden behind services so UI, MCP tools, and future
  operators do not learn storage details or reimplement relationship logic.
- Projection builders remain pure; services own I/O orchestration and expose
  validation warnings, confidence, evidence pointers, and missing-data effects.
- Reads remain deterministic because ordering is delegated to existing
  projection sort keys, timeline dedupe rules, and stable facade envelopes.
- Automation is intentionally delayed: queue services retrieve review-only queue
  projections and never dispatch work, send notifications, or persist queue
  candidates.

## Service architecture

- `RelationshipEngineReadService` is the canonical facade for read consumers.
- `RelationshipProjectionOrchestrationService` retrieves relationships,
  timeline memory, promises, follow-up instructions, and health traces, then
  builds summary, feed, queue, and timeline projections.
- `RelationshipTimelineRetrievalService` is the only service that combines
  timeline repositories and read-only source adapters. It validates and dedupes
  events before downstream projection.
- `RelationshipSummaryReadService`, `RelationshipFeedRetrievalService`, and
  `RelationshipQueueRetrievalService` are thin reusable boundaries for callers
  that need a narrower surface than the facade.

## Repository boundaries

Service constructors accept read-only repository slices:

- relationships: `getById`, `find`, `summarize`
- timeline: `list`
- follow-ups: `listOpenPromises`, `listDueInstructions`
- scoring: `getLatestHealthTrace`, `listHealthTraces`
- timeline sources: `ReadOnlyTimelineSourceAdapter`

Write methods such as `save`, `append`, queue candidate persistence, score
writes, and Neon write mode are outside the service layer. Source adapter
capabilities are asserted read-only during timeline service construction.

## Fixture and test planning

- Service replay tests should instantiate memory repositories, call the facade,
  reverse source fixture ordering, and assert deep equality.
- Deterministic retrieval tests should cover summaries, timelines, feeds, and
  queues with stable `EngineContext.now` values.
- Repository mocking should implement only read slices so tests fail if services
  reach for mutation methods.
- Aggregation consistency tests should compare facade bundles with direct
  summary/feed/queue/timeline service calls.
- Projection integrity tests should assert validation warnings surface through
  service envelopes instead of being dropped.
- Stale timeline service tests should set old timeline events and verify stale
  warnings survive summary, queue, and facade retrieval.

## Still intentionally delayed

Notifications, reminders, automation, queue execution, production scoring,
Brookside UI, Servpro UI, Neon writes, and autonomous workflows still wait for
fixture-backed write-mode design and operator safety review.
