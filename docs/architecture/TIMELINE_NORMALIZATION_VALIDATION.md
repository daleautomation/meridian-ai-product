# Meridian Timeline Normalization Validation

This audit validates the Relationship Engine timeline normalization foundation before relationship scoring, queue automation, reminders, notifications, Neon writes, or production workflow rollout.

## Normalization audit

- Normalizers are pure read projections from source DTOs into immutable `TimelineEvent` objects. They do not import repositories, UI types, MCP tools, CRM stores, or write paths.
- The batch entrypoint now validates every normalized event, drops events with integrity errors, dedupes accepted events deterministically, and returns warnings for rejected, duplicate, or suspicious events.
- `TimelineEvent` remains the canonical relationship memory layer. Summaries, warmth, follow-up logic, trust scoring, lifecycle audit, attribution, and queues must project from it rather than from raw provider payloads.

## Timeline integrity findings

- The event taxonomy is now runtime-validated by category/type matrix:
  - `touchpoint`: contact and note facts only.
  - `promise`: explicit commitment facts only.
  - `lifecycle`: canonical state transitions only.
  - `follow_up`: scheduled, completed, missed, or snoozed follow-up facts only.
  - `referral`: referral request/given/received facts only.
  - `outcome`: work result facts only.
  - `owner_assignment`: ownership responsibility facts only.
  - `system`: engine identity, merge, split, score, and queue trace facts only.
- Cross-category type reuse is rejected. For example, an owner assignment type cannot normalize as a touchpoint.
- Every normalized event must include `relationshipId`, `occurredAt`, `recordedAt`, `source`, `confidence`, evidence, and `dedupeKey` before it can pass the batch boundary.

## Evidence integrity findings

- No accepted timeline event may be evidence-free.
- Evidence refs must include stable id, source, label, observed timestamp, and canonical confidence.
- Unknown or invalid source timestamps use a stable unknown `occurredAt` and lower confidence to `low`.
- Missing or invalid due dates are omitted from canonical follow-up payloads instead of becoming missed follow-ups.
- Missing data may lower confidence or omit optional fields; it must not create urgency.

## Timestamp recommendations

- `occurredAt` is the source event time. It drives timeline ordering and event identity.
- `recordedAt` is the time the source system recorded the fact. It can differ from `occurredAt`, but earlier `recordedAt` values emit warnings for clock review.
- Normalization time should remain in batch context or future ingestion audit metadata; it should not replace unknown source event time.
- Unknown event time must remain stable across replays. Do not use `now` as an identity-bearing `occurredAt` fallback.

## Dedupe and replay strategy

- Use `dedupeKey = source kind + source id + relationship id + occurredAt`.
- Generate event ids from `dedupeKey + canonical event type`.
- Sort by `occurredAt`, then event id, before dedupe.
- Exact duplicate imports are discarded with `duplicate_event` warnings.
- Same dedupe key with different event ids is a `dedupe_conflict`; keep the deterministic first event and investigate the source mapping before enabling writes.
- Repository append must enforce the same dedupe key/idempotency rules as the batch normalizer.

## Lifecycle normalization findings

- Lifecycle aliases normalize through a central alias map and never become persisted states.
- Invalid transitions return stable validation codes and cannot silently normalize.
- Terminal states remain protected: `CLOSED_LOST -> *` is rejected by validation.
- Same-state writes validate as idempotent requests, but should not create lifecycle transition timeline events.
- Current source rows can contain both an outcome and a lifecycle hint. Multi-fact source rows still need an explicit split-event contract before lifecycle scoring or queue effects are trusted.

## Fixture and test strategy

- Add fixture families for CRM activity, follow-up task, usage event, execution outcome, lifecycle alias, and corrupted source rows.
- Cover replay stability: same source rows, different input order, same output ids and ordering.
- Cover duplicate imports: exact duplicates, same source id with changed payload, same dedupe key with different mapped type.
- Cover confidence: missing identity, invalid timestamps, missing optional due dates, missing actor, and source-unavailable cases.
- Cover evidence: empty event evidence, empty nested payload evidence, malformed observed timestamps, non-canonical confidence.
- Cover lifecycle: valid transitions, invalid transitions, alias normalization, terminal-state protection, idempotent same-state writes.
- Cover ordering: equal `occurredAt`, delayed `recordedAt`, source clock skew, unknown event time.
- Cover corruption: invalid category/type pairs, missing dedupe keys, fabricated overdue dates, source rows with multiple facts.

## Biggest risks

- Memory corruption from raw events bypassing normalization.
- Duplicate events causing warmth, promise, or health drift.
- Timestamp drift when unknown source times are replaced with normalization time.
- Lifecycle drift from UI or CRM aliases becoming canonical states.
- Fabricated urgency from missing due dates, missing touchpoints, or unknown lifecycle state.
- Replay instability when source ids are absent or source payloads change meaning.
- Ordering bugs around same-time events and source clock skew.
- Multi-fact rows losing either outcome or lifecycle evidence.

## What must remain canonical

- Event taxonomy and category/type matrix.
- Event identity and dedupe key rules.
- Evidence requirements and confidence vocabulary.
- Timestamp semantics for `occurredAt`, `recordedAt`, and normalization audit time.
- Lifecycle states, aliases, transition validation, and terminal-state protection.
- Normalization as a pure projection boundary before repositories, scoring, summaries, queues, or automation.

## Safe to build next

- Read-only fixture expansion around the normalizers.
- Repository contract tests that assert append idempotency without enabling writes.
- A multi-event normalization contract for source rows that contain both outcome and lifecycle facts.
- Relationship summary projections that read only accepted timeline events.
- Shadow score trace tests that assert evidence propagation and missing-data effects without adding weights.

## Still wait

- Production scoring, warmth, trust scoring, and next-best-action ranking.
- Queue automation, reminders, notifications, and operator dispatch.
- Neon timeline mutation or backfill writes.
- Lifecycle automation from ambiguous CRM or UI status movement.
- Any urgency logic based on missing timestamps, missing due dates, or uncorroborated source hints.
