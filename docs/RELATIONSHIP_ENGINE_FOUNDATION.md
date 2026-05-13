# Meridian Relationship Engine Foundation Pass

This pass adds safe internal scaffolding only. It does not enable production scoring, queue execution, reminders, notifications, Neon writes, UI coupling, or autonomous workflows.

## Architecture added

- `lib/relationship-engine/adapters/*` defines minimal source DTO boundaries for existing CRM activity, event log, follow-up tasks, and execution outcomes.
- `lib/relationship-engine/timeline/normalizers/*` projects source DTOs into canonical `TimelineEvent` objects with deterministic IDs, evidence refs, timestamps, confidence, and warnings.
- `lib/relationship-engine/timeline/validation.ts` validates taxonomy/category pairs, evidence, confidence, timestamps, dedupe keys, and category payload integrity before normalized events leave the batch boundary.
- `lib/relationship-engine/lifecycle/validation.ts` validates lifecycle transitions, normalizes legacy status aliases, and enforces transition reasons.
- `lib/relationship-engine/scoring/shadowHealthScore.ts` emits trace-only shadow `HealthScoreTrace` objects with no scoring formula.
- `lib/relationship-engine/queue/builder.ts` enforces queue candidate requirements without ranking or dispatching work.
- `lib/relationship-engine/repositories/*` prepares read-only file/Neon adapter capability boundaries and empty placeholders.

## Boundary rules

- Normalizers are pure functions and never import storage modules or mutate source data.
- Timeline batch normalization validates and dedupes accepted events deterministically, returning warnings for duplicates, conflicts, and integrity issues.
- Repository placeholders fail closed for mutations.
- Queue candidates require why-now, evidence, next-action reason, and owner visibility.
- Shadow score traces carry evidence and missing-data effects, but do not calculate production scores.
- Lifecycle transitions require valid canonical state movement and a non-empty reason.

## Fixture strategy TODOs

- TODO: Expand `scripts/check-timeline-normalization-validation.ts` into table fixtures for calls, notes, meetings, closed-won, closed-lost, and no-response outcomes.
- TODO: Add follow-up task fixtures for scheduled, completed, overdue, unscheduled, and cancelled tasks.
- TODO: Add usage event fixtures for execution outcome event types and invalid lifecycle aliases.
- TODO: Add execution outcome fixtures for terminal and follow-up statuses.
- TODO: Add repository adapter contract tests before enabling file or Neon writes.
- TODO: Add score trace fixture tests before any production score weights are introduced.
- TODO: Add queue candidate fixture tests for deterministic IDs and required evidence.
