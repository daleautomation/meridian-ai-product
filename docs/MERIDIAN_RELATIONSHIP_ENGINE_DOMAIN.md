# Meridian Relationship Engine Domain Architecture

This document defines the canonical TypeScript domain architecture for the Meridian Relationship Engine. It is intentionally contract-first: no UI model, storage adapter, Neon dependency, MCP shortcut, or vertical fork is allowed to become the source of truth.

Canonical exports live under `lib/relationship-engine/*`.

## 1. Canonical relationship domain objects

| Object | Purpose | Required fields | Optional fields | Invariants | Relationships |
|---|---|---|---|---|---|
| `RelationshipId` | Stable identity for a relationship. | Branded string. | None. | Never derived from display text alone; never reused after split. | Used by every entity, event, score, queue item, and repository. |
| `RelationshipEntity` | Canonical normalized relationship record. | `id`, `workspaceId`, `identity`, `lifecycle`, `warmth`, `assignments`, `audit`. | `tags`, `attributes`. | Contains no UI labels, no storage metadata, no vertical-specific schema. | Owns lifecycle state and identity; timeline and scores project from it. |
| `RelationshipEvent` | Entity-level change fact. | `id`, `relationshipId`, `kind`, `occurredAt`, `source`, `evidence`, `payload`. | None. | Used for identity/merge/split changes; operational history belongs in `TimelineEvent`. | Feeds timeline normalization and audit trails. |
| `Touchpoint` | Normalized interaction with a relationship. | `id`, `relationshipId`, `channel`, `direction`, `occurredAt`, `evidence`. | `subject`, `bodyPreview`, `operatorId`, `externalMessageId`. | Cannot imply intent or outcome without evidence. | Embedded in `TouchpointTimelineEvent`. |
| `PromiseRecord` | Explicit commitment made by operator, relationship, or system. | `id`, `relationshipId`, `title`, `status`, `promisedBy`, `createdAt`, `evidence`, `confidence`. | `description`, `ownerId`, `dueAt`, fulfillment/cancel/supersession fields. | Open promises require owner or clear source; missed promises must be timeline-visible. | Drives follow-up, health scoring, retention risk, and queue escalation. |
| `FollowUpPolicy` | Canonical cadence and escalation policy. | `id`, `label`, `defaultCadence`, `appliesToLifecycle`, `requiredEvidenceForCompletion`, `active`. | `maxSilenceWindow`, `escalationAfterMisses`. | Policy may vary by vertical, but output remains canonical follow-up instructions. | Consumed by follow-up repository and queue candidate generation. |
| `QueueCandidate` | Explainable work item candidate for an operator. | `id`, `relationshipId`, `generatedAt`, `rankScore`, `whyNow`, `nextBestAction`, `summary`, `visibleTo`, `confidence`, `evidence`. | `ownerId`, `healthTrace`, `overdue`, `warmthDecay`, `escalationReason`. | No candidate without evidence and why-now explanation; missing data lowers confidence, not urgency. | Projects from relationship, timeline, follow-up, score, and assignment state. |
| `RelationshipSummary` | Read model for compact relationship state. | `relationshipId`, `displayName`, `lifecycle`, `warmth`, promise counts, `healthConfidence`, `summaryGeneratedAt`. | Owner, last touchpoint, next follow-up, latest outcome, health score. | Projection only; cannot introduce new facts. | Returned by repositories and embedded in queue candidates. |
| `HealthScoreTrace` | Explainable health score audit trail. | `id`, `relationshipId`, `modelName`, `modelVersion`, `computedAt`, `score`, `confidence`, `components`, `missingEvidence`, `explanation`, inputs. | `inputRelationshipVersion`. | Every score must expose components, evidence, missing-data effects, and model version. | Stored by scoring repository; can be embedded in queue candidates and summaries. |
| `LifecycleState` | Canonical relationship lifecycle. | One value from `LIFECYCLE_STATE`. | Vertical aliases are external only. | Persisted lifecycle state must never be a UI tab or CRM free-form status. | Transitioned by lifecycle timeline events. |
| `RelationshipWarmth` | Evidence-backed engagement temperature. | `band`, `score`, `evidence`, `confidence`. | Last meaningful touchpoint, decay start. | Warmth is projected from touchpoints/outcomes, not edited as copy. | Used by summaries, health traces, and queue warmth decay. |
| `TimelineEvent` | Canonical relationship memory system. | Base event fields plus category-specific payload. | Dedupe key and category-specific fields. | Immutable, normalized, evidence-aware. | Source for summaries, scores, lifecycle audit, and queue candidates. |
| `OutcomeRecord` | Normalized result of relationship work. | `id`, `relationshipId`, `kind`, `label`, `occurredAt`, `evidence`, `confidence`. | `value`, `notes`. | Outcomes cannot be inferred from UI movement alone. | Embedded in outcome timeline events and health scoring. |
| `OperatorAssignment` | Ownership and visibility contract. | `ownerId`, `assignedAt`, `visibility`. | `assignedBy`, `reason`. | Assignment is operational responsibility, not lifecycle state. | Relationship entity, owner assignment events, queue visibility. |

## 2. Canonical lifecycle model

Canonical states are `NEW`, `QUALIFIED`, `ACTIVE`, `NURTURING`, `OPPORTUNITY`, `RETAINED`, `REFERRAL_SOURCE`, `DORMANT`, `REACTIVATION`, `RETENTION_RISK`, and `CLOSED_LOST`.

Allowed transitions are declared in `ALLOWED_LIFECYCLE_TRANSITIONS`. Any transition not listed there is invalid, except idempotent same-state writes. Important invalid examples:

- `CLOSED_LOST -> *`: invalid; reopening requires a new relationship event or explicit future reopen contract.
- `NEW -> OPPORTUNITY`: invalid; relationship must become `QUALIFIED` first.
- `DORMANT -> OPPORTUNITY`: invalid; must pass through `REACTIVATION`.
- `RETAINED -> OPPORTUNITY`: invalid; retained expansion requires a future expansion state or active motion, not direct opportunity drift.

Lifecycle invariants:

- Lifecycle is evidence-backed relationship state, not UI grouping.
- Every state change must produce a `LifecycleTimelineEvent`.
- Terminal states cannot emit active queue candidates without a new canonical event.
- Vertical aliases may rename states but cannot add persisted states.

## 3. Timeline event taxonomy

Timeline events are the canonical memory system. Categories:

- `touchpoint`: calls, emails, meetings, notes, site visits, inbound/outbound contact.
- `promise`: promise created, updated, fulfilled, missed, cancelled.
- `lifecycle`: lifecycle transition with `from`, `to`, and reason.
- `follow_up`: scheduled, completed, missed, snoozed follow-ups.
- `referral`: requested, given, or received referrals.
- `outcome`: booked meetings, won/lost deals, retention, referral creation, no response, not fit.
- `owner_assignment`: assigned, reassigned, removed owner.
- `system`: relationship created/merged/split, identity resolved, score recomputed, queue candidate generated.

All timeline events require `relationshipId`, `occurredAt`, `recordedAt`, `source`, `evidence`, and `confidence`. Raw provider payloads must normalize into this taxonomy before they influence scoring or queues.

## 4. Health score trace architecture

Health scores are trace-first. Components are `recency`, `responsiveness`, `promise_integrity`, `lifecycle_fit`, `outcome_momentum`, `warmth`, and `risk`.

Requirements:

- Each component has `status`, `normalizedScore`, `configuredWeight`, `contribution`, evidence refs, explanation, and confidence.
- Missing data is represented through `missingEvidence`; it may lower confidence or be neutral, but must not fabricate urgency.
- The trace includes `modelName`, `modelVersion`, input timeline IDs, score range policy, and confidence rules.
- UI may display trace output but may not recompute it.
- Arbitrary weights are forbidden; weights must come from score policy or approved vertical config.

## 5. Queue candidate contracts

Every queue candidate must answer:

- Why now: deterministic `whyNow`, backed by evidence.
- What is overdue: `OverdueMetadata` when due dates or promises are late.
- What decayed: `WarmthDecayMetadata` when engagement has cooled.
- What to do next: `NextBestAction` with action kind, label, reason, expected outcome, and evidence prerequisites.
- Who can see it: `visibleTo` plus optional `ownerId`.
- How confident the engine is: `confidence` and evidence.
- Why it escalated: `QueueEscalationReason` when urgency exceeds ordinary cadence.

## 6. Repository boundaries

Repository interfaces:

- `RelationshipRepository`: load, query, save canonical relationships, and return summaries.
- `TimelineRepository`: append immutable timeline events and list normalized memory.
- `FollowUpRepository`: manage promises and due follow-up instructions.
- `ScoringRepository`: persist and retrieve health score traces.
- `QueueRepository`: persist, list, and clear queue candidates.

Repositories must not import UI types, MCP DTOs, Neon clients, file-store helpers, or React modules. Storage adapters sit outside these interfaces.

## 7. Vertical configuration layer

Verticals may customize:

- Display labels and copy labels.
- Cadence windows by canonical lifecycle state.
- Event weights with rationale.
- Workflow emphasis.
- Lifecycle aliases.
- Health component weights through approved policy.

Verticals must not customize:

- Entity identity semantics.
- Canonical lifecycle values or transition validity.
- Timeline categories.
- Score trace structure and evidence requirements.
- Queue candidate evidence and why-now fields.
- Repository responsibilities.
- DTO boundary ownership.

## 8. DTO boundaries

Boundaries:

- Internal engine entities: branded IDs, canonical objects, evidence-rich structures.
- API DTOs: serialized contracts with plain strings and no UI-only labels beyond API fields.
- MCP DTOs: action-safe projections that must call engine use cases and cannot write repositories directly.
- UI DTOs: display projections with labels, but no scoring, lifecycle transition, or queue ranking logic.

Serialization must be centralized through engine mappers. Storage adapters return internal entities, not UI DTOs.

## 9. Naming conventions

Use these folders under `lib/relationship-engine`:

- `relationship/*`: identity, lifecycle, summaries, assignment.
- `timeline/*`: immutable relationship memory.
- `scoring/*`: score traces and score policies.
- `followups/*`: promises, cadence, follow-up instructions.
- `queue/*`: explainable operator candidate contracts.
- `repositories/*`: persistence interfaces only.
- `verticals/*`: allowed customization.
- `dto/*`: API, MCP, and UI boundary contracts.
- `policies/*`: validation and future engine policies.

## 10. Validation requirements before production

- Lifecycle transitions: validate against canonical transition map and require timeline event recording.
- Score traces: assert component totals, evidence presence, model version, missing-data effects, and score range.
- Timeline normalization: dedupe, category/type validation, timestamp validation, source validation, confidence validation.
- Queue ranking: require why-now, next-best-action, owner visibility, confidence, evidence, and deterministic tie-breakers.
- Relationship summaries: prove summaries project from canonical entities, timeline, promise records, and health traces only.

## 11. Biggest architectural risks

- Identity fragmentation: duplicate relationships across integrations.
- Lifecycle drift: UI or CRM statuses becoming persisted state.
- Schema explosion: verticals adding fields instead of config.
- Scoring inconsistency: multiple hidden score functions.
- Vertical forks: copied engines per market.
- Queue hallucinations: urgency without evidence.
- Repository coupling: domain interfaces importing storage details.
- DTO bypass: MCP or UI mutating repositories without engine rules.
- Memory corruption: raw events skipping timeline normalization.
- Confidence inflation: missing data treated as positive signal.

## 12. What remains canonical forever

- `RelationshipId` as the relationship identity spine.
- `RelationshipEntity` as the normalized internal record.
- `TimelineEvent` as the canonical memory system.
- `LifecycleState` values and transition validation.
- Evidence-backed `HealthScoreTrace`.
- Explainable `QueueCandidate`.
- Repository boundaries free of UI and storage coupling.
- DTO separation between internal, API, MCP, and UI projections.
- Vertical configuration as policy input, not schema ownership.
