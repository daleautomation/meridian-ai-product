# Meridian Relationship Engine Read Adapters

## Philosophy

The first real Relationship Engine data integration is read-only. Adapters read existing safe sources and expose canonical repository contracts to services. They do not expose raw files, store clients, UI props, write handles, queue executors, notification hooks, reminder hooks, or Neon mutation paths.

## Read-only guarantees

- Relationship, timeline, follow-up, and scoring repositories expose only read methods through `RelationshipEngineReadRepositories`.
- Mutation methods remain outside the service binding (`save`, `append`, `savePromise`, `saveHealthTrace`, queue writes).
- Timeline source capabilities must pass `assertReadOnlyCapabilities`.
- Health traces use shadow trace retrieval only; no production scoring formula runs.
- No adapter writes files, persists timelines, backfills Neon, executes queues, sends notifications, creates reminders, or starts automation.

## Deterministic replay guarantees

Same source data plus same `asOf` yields the same projections, queues, feeds, and diagnostics metadata.

- Source rows are sorted by stable identifiers and source timestamps.
- Relationship IDs derive from canonical source identity (`workspace`, `companyKey`, `crmKey`, `leadId`, `taskId`, `companyName`).
- Timeline normalization and dedupe remain centralized in the timeline retrieval service.
- Duplicate timeline imports collapse by canonical dedupe keys and surface normalization warnings.
- Repository source reads are memoized per service binding so one request sees a consistent read set.

## Repository modes

- `read_only_unwired`: service facade active, no real adapter data.
- `read_only_file`: deterministic file-backed sources are available. This includes mixed file reads where an operator snapshot participates in identity discovery; diagnostics expose `sourceReadiness.operatorSnapshot` separately.
- `read_only_memory`: available for deterministic in-memory fixtures.

Repository readiness only reports ready when read adapters are wired and stores expose no mutation paths.

## Validation boundaries

- Adapters validate source shape enough to avoid leaking malformed raw rows.
- Lifecycle values pass through canonical alias normalization.
- Timeline events pass canonical timeline validation after normalization.
- Duplicate handling happens before projections consume timeline memory.
- Projection stale warnings remain derived by canonical projection services from `asOf`.

## Canonical projection flow

1. Existing safe sources are read: operator snapshots, CRM activities, follow-up tasks, usage events, execution outcomes, and snapshot state.
2. Relationship repositories expose canonical `RelationshipEntity` rows.
3. Timeline sources expose source DTOs; the timeline service normalizes, validates, dedupes, and orders canonical `TimelineEvent` memory.
4. Follow-up repositories expose open promises and due instructions derived from read-only task/activity/outcome evidence.
5. Scoring repositories expose deterministic shadow `HealthScoreTrace` records only.
6. Services project summaries, timelines, feeds, queues, health, and diagnostics.
7. APIs and operator surfaces consume service outputs only.

## Fixture and test plan

- Replay tests: compare two adapter-backed projections from the same fixture data and fixed `asOf`.
- Duplicate import tests: ingest duplicate CRM source rows and assert one projected timeline memory item plus a warning.
- Timeline integrity tests: assert timeline projection IDs are unique and canonically ordered.
- Repository adapter tests: assert repository read methods return canonical models and no write methods are present.
- Stale relationship tests: run projections with stale thresholds and fixed `asOf`.
- Deterministic ordering tests: verify sorted relationships, timeline items, follow-ups, and queues.
- Adapter consistency tests: verify repository readiness mode and source counts from fixtures.

## What remains intentionally out of scope

Notifications, reminders, queue execution, autonomous workflows, production scoring, Neon writes, timeline persistence, Brookside UI, Servpro UI, and write APIs still wait for a separate design and migration-backed safety pass.
