begin;

create table if not exists idempotency_keys (
  key text primary key,
  scope text not null,
  first_seen_at timestamptz not null default now(),
  response jsonb not null default '{}'::jsonb
);

create table if not exists execution_outcomes (
  event_id uuid primary key,
  workspace text not null,
  company_key text,
  crm_key text,
  lead_id text,
  task_id text,
  operator_id text not null,
  source_surface text not null,
  outcome_status text not null,
  previous_status text,
  next_status text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  next_action text,
  next_action_date date,
  estimated_value numeric,
  meridian_influenced boolean not null default true,
  influence_reason text not null,
  idempotency_key text not null references idempotency_keys(key),
  metadata jsonb not null default '{}'::jsonb,
  unique (workspace, idempotency_key)
);

create table if not exists execution_outcome_latest (
  workspace text not null,
  identity_key text not null,
  event_id uuid not null references execution_outcomes(event_id),
  updated_at timestamptz not null default now(),
  primary key (workspace, identity_key)
);

create table if not exists company_current_state (
  company_key text primary key,
  company jsonb not null,
  status text,
  status_history jsonb not null default '[]'::jsonb,
  next_action text,
  next_action_date date,
  profile jsonb,
  latest jsonb not null default '{}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  created_at timestamptz not null
);

create table if not exists domain_events (
  event_id uuid primary key,
  event_type text not null,
  workspace text,
  user_id text,
  operator_id text,
  lead_id text,
  task_id text,
  company_key text,
  crm_key text,
  source_surface text,
  idempotency_key text,
  occurred_at timestamptz,
  recorded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  event jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists execution_outcomes_workspace_recorded_idx
  on execution_outcomes (workspace, recorded_at desc);

create index if not exists execution_outcome_latest_event_idx
  on execution_outcome_latest (event_id);

create index if not exists company_current_state_updated_idx
  on company_current_state (updated_at desc);

create index if not exists domain_events_workspace_created_idx
  on domain_events (workspace, created_at desc);

commit;
