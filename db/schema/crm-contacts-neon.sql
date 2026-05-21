begin;

create table if not exists crm_contacts (
  workspace_id text not null,
  contact_id text not null,
  normalized jsonb not null default '{}'::jsonb,
  trust jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, contact_id)
);

create index if not exists crm_contacts_workspace_updated_idx
  on crm_contacts (workspace_id, updated_at desc);

commit;
