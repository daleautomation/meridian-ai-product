-- Meridian Command — Phase 0/1 durable Opportunity Graph schema.
--
-- ADDITIVE and IDEMPOTENT. Nothing here drops or renames existing objects.
-- Apply AFTER db/schema/phase1-neon.sql (which owns domain_events,
-- execution_outcomes, execution_outcome_latest, company_current_state,
-- idempotency_keys). Those tables are REUSED, not recreated.
--
-- Design (see docs/architecture/OPPORTUNITY_GRAPH_PHASE_0_1.md):
--   * graph_nodes + graph_edges = the single source of projected graph truth.
--   * source_records = raw provenance (answers "what created each node/edge").
--   * identity_resolution = the join layer across the previously-disjoint
--     ae-jobs / company / crm-contact keyspaces.
--   * people / companies / opportunities / attention_items are typed VIEWS over
--     graph_nodes. Views cannot drift from the graph; they are typed lenses, not
--     a second copy of the data.
--
-- The graph is a deterministic projection over durable records. It can be
-- dropped and rebuilt from source_records + the phase-1 tables at any time.

begin;

-- ── Raw provenance ────────────────────────────────────────────────────────
-- Every source row Meridian ingested (a JobOpportunity, CompanySnapshot,
-- CrmContactRecord, CareerCalendarEvent, DurableExecutionOutcome...) lands here
-- exactly once, keyed deterministically. Nodes/edges reference these ids in
-- their provenance so any element traces back to its origin.
create table if not exists source_records (
  source_record_id text primary key,       -- "<system>:<type>:<id>"
  source_system    text not null,          -- ae-jobs | company-snapshots | crm-contacts | ae-jobs-calendar | execution-outcomes
  source_type      text not null,          -- opportunity | company | contact | calendar_event | outcome
  source_id        text not null,          -- natural id within the system
  workspace        text,                   -- owning workspace/owner scope when applicable
  payload          jsonb not null default '{}'::jsonb,  -- the raw record as ingested
  content_hash     text not null,          -- sha256 of payload for change detection
  observed_at      timestamptz not null,   -- when the record was last known true
  ingested_at      timestamptz not null default now()
);

create index if not exists source_records_system_type_idx
  on source_records (source_system, source_type);

-- ── Identity resolution ───────────────────────────────────────────────────
-- Maps a raw handle (email, phone, opportunity id, company key, name+company)
-- to a canonical graph node id. This is the layer that turns the audit's three
-- disjoint keyspaces into one graph. Merges are additive rows and reversible.
create table if not exists identity_resolution (
  handle        text primary key,          -- "email:foo@bar.com", "companyKey:domain:bar.com", "opp:opp-123"
  handle_kind   text not null,             -- email | phone | company_key | opportunity_id | person_name | calendar_event | outcome
  node_id       text not null,             -- resolved canonical graph node id
  confidence    integer not null default 100, -- 0–100, deterministic
  resolved_by   text not null,             -- projector rule that made the link
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists identity_resolution_node_idx
  on identity_resolution (node_id);

-- ── Graph nodes ───────────────────────────────────────────────────────────
-- Every important object is a node. Thin nodes, rich edges. Attributes are
-- typed-per-node in jsonb; provenance is an array of source_record ids.
create table if not exists graph_nodes (
  node_id       text primary key,          -- "company:domain:x", "person:email:x", "opportunity:opp-1", "self:dylan"
  node_type     text not null,             -- self | person | company | job_opportunity | meeting | revenue_outcome
  label         text not null,             -- human-readable display label
  owner_scope   text not null default 'dylan', -- whose graph this belongs to (self-centered OS)
  canonical_key text not null,             -- normalized natural key (identity target)
  attributes    jsonb not null default '{}'::jsonb,
  provenance    jsonb not null default '[]'::jsonb, -- [{sourceRecordId, sourceSystem, sourceType, sourceId}]
  source_count  integer not null default 0,
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null
);

create index if not exists graph_nodes_type_idx  on graph_nodes (node_type);
create index if not exists graph_nodes_owner_idx  on graph_nodes (owner_scope);
create index if not exists graph_nodes_lastseen_idx on graph_nodes (last_seen_at desc);

-- ── Graph edges ───────────────────────────────────────────────────────────
-- Relationships between nodes. edge_id is the natural key "src|type|dst" so
-- projection is idempotent. Weight is a STRUCTURAL default (not a predictive
-- score — Phase 1 does no scoring). evidence references source_record ids.
create table if not exists graph_edges (
  edge_id        text primary key,         -- "<src>|<edge_type>|<dst>"
  src_node_id    text not null references graph_nodes(node_id) on delete cascade,
  dst_node_id    text not null references graph_nodes(node_id) on delete cascade,
  edge_type      text not null,            -- KNOWS | WORKS_AT | PURSUING | AT_COMPANY | FOR_OPPORTUNITY | ATTENDS | GENERATED_VALUE
  directed       boolean not null default true,
  weight         numeric not null default 0, -- structural default weight, 0–1
  attributes     jsonb not null default '{}'::jsonb,
  evidence       jsonb not null default '[]'::jsonb, -- [{sourceRecordId,...}]
  first_observed_at timestamptz not null,
  last_observed_at  timestamptz not null
);

create index if not exists graph_edges_src_idx  on graph_edges (src_node_id, edge_type);
create index if not exists graph_edges_dst_idx  on graph_edges (dst_node_id, edge_type);
create index if not exists graph_edges_type_idx on graph_edges (edge_type);

-- ── Typed read VIEWS (zero-drift lenses over graph_nodes) ──────────────────
-- These satisfy "schema for people / companies / opportunities / attention_items"
-- without a second copy of the data. Future scoring reads these; it never has to
-- rewrite the graph.

create or replace view people as
select
  node_id                              as person_id,
  label                                as name,
  attributes ->> 'company'             as company,
  attributes ->> 'email'               as email,
  attributes ->> 'phone'               as phone,
  attributes ->> 'sourceCrm'           as source_crm,
  (attributes ->> 'relationshipScore') as relationship_score,
  attributes ->> 'lastInteractionAt'   as last_interaction_at,
  owner_scope,
  source_count,
  first_seen_at,
  last_seen_at
from graph_nodes
where node_type = 'person';

create or replace view companies as
select
  node_id                    as company_id,
  label                      as name,
  attributes ->> 'domain'    as domain,
  attributes ->> 'status'    as status,
  attributes ->> 'trade'     as trade,
  attributes ->> 'nextAction' as next_action,
  attributes ->> 'origin'    as origin,   -- company-snapshot | opportunity | contact | outcome
  owner_scope,
  source_count,
  first_seen_at,
  last_seen_at
from graph_nodes
where node_type = 'company';

create or replace view opportunities as
select
  node_id                        as opportunity_id,
  label                          as title,
  attributes ->> 'company'       as company,
  attributes ->> 'roleTitle'     as role_title,
  attributes ->> 'stage'         as stage,
  attributes ->> 'priority'      as priority,
  attributes ->> 'nextAction'    as next_action,
  attributes ->> 'followUpDate'  as follow_up_date,
  attributes ->> 'source'        as source,
  owner_scope,
  source_count,
  first_seen_at,
  last_seen_at
from graph_nodes
where node_type = 'job_opportunity';

-- Unified "things that may deserve attention" read model — the durable seam the
-- Command Brief (later phase) will consume WITHOUT rewriting the graph. Phase 1
-- unifies job opportunities and meetings; more kinds attach here later.
create or replace view attention_items as
select
  node_id                       as item_id,
  'job_opportunity'             as kind,
  label                         as title,
  attributes ->> 'company'      as company,
  attributes ->> 'nextAction'   as next_action,
  attributes ->> 'followUpDate' as due_at,
  attributes ->> 'priority'     as priority,
  owner_scope,
  last_seen_at
from graph_nodes
where node_type = 'job_opportunity'
union all
select
  node_id                        as item_id,
  'meeting'                      as kind,
  label                          as title,
  attributes ->> 'company'       as company,
  attributes ->> 'notes'         as next_action,
  attributes ->> 'startDateTime' as due_at,
  attributes ->> 'eventType'     as priority,
  owner_scope,
  last_seen_at
from graph_nodes
where node_type = 'meeting';

commit;
