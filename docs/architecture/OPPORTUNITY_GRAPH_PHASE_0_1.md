# Opportunity Graph — Phase 0 & Phase 1

> The durable foundation for Meridian Command. See [`MERIDIAN_AUDIT.md`](../../MERIDIAN_AUDIT.md)
> (constitution) and [`MERIDIAN_COMMAND_ARCHITECTURE.md`](../../MERIDIAN_COMMAND_ARCHITECTURE.md)
> (intelligence-layer design). This document covers only what Phases 0 and 1 ship:
> a durable, queryable, explainable Opportunity Graph. **No scoring, no notifications,
> no new UI, no AI** — those are later phases.

## What these two phases give you

Meridian can now answer, from a single durable store:

- **What people do I know?** → `person` nodes + `self —KNOWS→ person` edges
- **What companies matter?** → `company` nodes (deduped by `companyKey`)
- **What opportunities exist?** → `job_opportunity` nodes + `self —PURSUING→` edges
- **What connects people, companies, jobs, and revenue?** → `WORKS_AT`, `AT_COMPANY`,
  `FOR_OPPORTUNITY`, `ATTENDS`, `GENERATED_VALUE` edges
- **What data source created each node/edge?** → every element carries `provenance`/
  `evidence` pointing at a row in `source_records`
- **Can it survive deploys/restarts?** → yes, it lives in Neon Postgres, not JSON files
- **Can future scoring use it without a rewrite?** → yes, via the typed views and the
  stable `GraphNode`/`GraphEdge`/`AttentionItem` interfaces

Current projection over today's data: **349 nodes** (203 companies, 139 people, 3 job
opportunities, 3 meetings, 1 `self`) and **289 edges**, from 189 CRM contacts, 72 company
snapshots, 3 AE opportunities, and 3 calendar events. Identity resolution collapsed 189
raw contacts into 139 unique people and merged company references into 203 unique
companies — the fix for the three disjoint keyspaces called out in the audit.

## Phase 0 — durable schema

`db/schema/phase2-graph.sql` (additive, idempotent). It **reuses** the dormant Phase-1
tables (`domain_events`, `execution_outcomes`, `company_current_state`) and adds:

| Object | Kind | Purpose |
|---|---|---|
| `source_records` | table | Raw ingested records, keyed `<system>:<type>:<id>`. The provenance backbone. |
| `identity_resolution` | table | `handle → node_id`. The cross-keyspace join layer. |
| `graph_nodes` | table | Every object. Thin nodes; typed attributes in jsonb; provenance array. |
| `graph_edges` | table | Relationships. Natural-key `src\|type\|dst` id → idempotent. Structural weights only. |
| `people` | view | Typed lens over `graph_nodes` where type = person. |
| `companies` | view | Typed lens over company nodes. |
| `opportunities` | view | Typed lens over job-opportunity nodes. |
| `attention_items` | view | Unified opportunities + meetings — the seam the Command Brief will read later. |

**Why views, not tables, for people/companies/opportunities/attention_items?** So they
can never drift from the graph. There is one source of projected truth (`graph_nodes`);
the views are typed queries over it. Future scoring reads the views and never has to
rewrite the graph.

## Phase 1 — projection

- `lib/graph/types.ts` — `GraphNode`, `GraphEdge`, `AttentionItem`, `Opportunity`,
  `ExecutionOutcome`, `SourceRecord`, `IdentityLink`, node/edge enums.
- `lib/graph/ids.ts` — deterministic id + normalization helpers. **Reuses the existing
  `companyKey()`** so ae-jobs, snapshots, contacts, and outcomes resolve to the same
  company node.
- `lib/graph/projection.ts` — **pure, deterministic** record → graph. No DB, no network,
  no `Date.now()`. Same inputs + same `asOf` → byte-identical output.
- `lib/graph/repository.ts` — idempotent Neon upserts + read helpers (raw SQL via the
  existing `getNeonSql()`).
- `lib/graph/fileInputs.ts` — read-only loader for the existing JSON stores.
- `lib/graph/relationshipEngineFeed.ts` — a neutral feed the read-only relationship
  engine can project from. **Imports nothing from `lib/relationship-engine`; changes none
  of its files.** Wiring is a deliberate later step — Phase 1 only makes the feed available
  so the engine is *fed*, not rebuilt.

## How to run it

```bash
# 0. Provision the schema (idempotent; safe to re-run)
DATABASE_URL=... npx tsx scripts/apply-graph-schema.ts            # dry-run: prints the 16 statements
DATABASE_URL=... npx tsx scripts/apply-graph-schema.ts --execute  # apply
#   (production: psql "$DIRECT_DATABASE_URL" -f db/schema/phase2-graph.sql)

# 1. Backfill the graph from existing JSON (read-only source; idempotent target)
DATABASE_URL=... npm run graph:backfill:dry                       # plan only, no writes
DATABASE_URL=... MERIDIAN_BACKFILL_CONFIRM=true npm run graph:backfill

# Validate (works with OR without a DB)
npm run graph:check
```

`graph:check` runs the projection over the real files and asserts 16 invariants (self
node present, people/companies/opportunities projected, the island-join edges exist, no
orphan edges, every node/edge has traceable provenance, and the projection is
deterministic across runs). With `DATABASE_URL` set and the tables applied, it also
verifies the persisted graph. It requires no DB to pass, so it fits the existing CI gate.

## Turning on durable persistence (Phase 0 activation)

The graph writes to Neon regardless of `MERIDIAN_TRUTH_STORE`. To move the *rest* of
Meridian Command onto durable storage (the audit's #1 risk — silent write loss on
Vercel's read-only FS), set `MERIDIAN_TRUTH_STORE=dual` (then `neon`) and run the
existing `scripts/backfill-phase1-neon.ts`. That is complementary to this graph work.

## Guardrails honored

No new dashboard. No notifications. No AI/live scoring. No black-box ranking. No existing
feature deleted. No large renames. Career Brief untouched. The relationship engine is
**fed, not rebuilt**. Everything added is additive and behind explicit scripts.

## What Phase 2 builds on this (not now)

The scoring layer reads `graph_nodes`/`graph_edges` (and the typed views) and writes a
`node_scores` projection + the `ExpectedROI` ranker. It never rewrites the graph. The
`attention_items` view is the exact seam the Command Brief will consume.
