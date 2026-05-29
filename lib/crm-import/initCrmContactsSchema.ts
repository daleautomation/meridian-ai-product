import { neon } from "@neondatabase/serverless";
import { getCrmDatabaseUrl } from "./storageConfig";

let schemaReady: boolean | null = null;

/** Idempotent CRM contacts table bootstrap for Neon/Postgres. */
export async function ensureCrmContactsSchema(): Promise<void> {
  if (schemaReady) return;
  const url = getCrmDatabaseUrl();
  if (!url) {
    throw new Error("CRM Postgres URL is not configured");
  }

  const sql = neon(url);
  await sql`
    create table if not exists crm_contacts (
      workspace_id text not null,
      contact_id text not null,
      normalized jsonb not null default '{}'::jsonb,
      trust jsonb not null default '{}'::jsonb,
      source_metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (workspace_id, contact_id)
    )
  `;
  await sql`
    create index if not exists crm_contacts_workspace_updated_idx
      on crm_contacts (workspace_id, updated_at desc)
  `;

  schemaReady = true;
}

export function __resetCrmSchemaReadyForTests(): void {
  schemaReady = null;
}
