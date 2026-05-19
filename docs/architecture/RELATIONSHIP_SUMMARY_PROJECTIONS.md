# Relationship Summary Projections

`TimelineEvent` is Meridian's canonical relationship memory system. Operators, queues, MCP tools, and UI surfaces should not parse timeline memory directly. They should consume canonical projections built by `lib/relationship-engine/projections/*`.

## Why projections exist

- Provide stable read models over canonical relationship memory.
- Keep relationship calculations out of UI components, MCP tools, queues, and storage adapters.
- Make summaries explainable with evidence, confidence, missing-data effects, and timeline references.
- Preserve replay consistency: the same canonical inputs produce the same projection.

## Canonical memory vs projections

- Canonical memory: `RelationshipEntity`, normalized `TimelineEvent`, `PromiseRecord`, `HealthScoreTrace`, and `FollowUpInstruction`.
- Projection: `RelationshipSummaryProjection`, which wraps the compact `RelationshipSummary` plus explanation metadata and validation findings.
- Persistence: projections are read-only and are not cached or written yet.

## Projection boundary

Allowed inputs:

- `RelationshipEntity`
- `TimelineEvent`
- `PromiseRecord`
- `HealthScoreTrace`
- `FollowUpInstruction`

Forbidden inputs:

- React component state or UI labels.
- MCP free-form summaries.
- Queue rank scores or urgency labels.
- CRM status aliases that have not been normalized.
- Neon storage metadata.
- Random values or wall-clock timestamps outside `EngineContext.now`.

## What summaries may derive

- Lifecycle state from `RelationshipEntity.lifecycle`.
- Warmth band from `RelationshipEntity.warmth.band`.
- Owner visibility from `RelationshipEntity.assignments` and owner assignment timeline evidence.
- Latest touchpoint, latest outcome, latest activity, and timeline references from normalized `TimelineEvent`.
- Open and overdue promise counts from `PromiseRecord`.
- Overdue and next scheduled follow-ups from `FollowUpInstruction`.
- Health score and health confidence by copying an existing `HealthScoreTrace`.
- Momentum hints that describe evidence already present in canonical inputs.

## What summaries must never derive

- Production scores or hidden weights.
- Notifications, reminders, autonomous workflows, or queue automation.
- Lifecycle transitions from UI movement.
- Warmth or urgency from display labels.
- Relationship mutations, repository writes, or Neon writes.
- Vertical-specific schema fields.
- Unexplained urgency from missing data.

## Validation and fixtures

Projection validation checks:

- Summary fields match projected detail fields.
- Owner visibility is explicit and primary owners are visible.
- Lifecycle values and lifecycle timeline transitions are canonical.
- Latest activity has timeline evidence and is not stale without a warning.
- Missing timeline, owner, touchpoint, outcome, promise, follow-up, and health inputs are explained.
- Timeline references point to supplied timeline events.

Fixture strategy:

- Summary fixture: one complete relationship with owner, touchpoint, outcome, promise, follow-up, and health trace.
- Replay validation: reorder timeline, promise, and follow-up inputs and assert identical projection output.
- Ordering validation: same-timestamp timeline events resolve by stable event id.
- Stale relationship validation: old latest activity emits stale warnings and descriptive momentum hints.
- Projection integrity tests: mismatch summary/detail fields and invalid lifecycle timeline transitions.
- Missing-data projection tests: no timeline, no owner, no health trace, no follow-up, and no promises.
