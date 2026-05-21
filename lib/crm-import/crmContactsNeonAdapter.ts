import { neon } from "@neondatabase/serverless";
import type { CrmContactRecord } from "./types";
import { assertWorkspaceSlug, getCrmDatabaseUrl } from "./storageConfig";

type ContactRow = Record<string, unknown>;

let crmSql: ReturnType<typeof neon> | null = null;

function getCrmSql() {
  const url = getCrmDatabaseUrl();
  if (!url) throw new Error("CRM Postgres URL is not configured");
  crmSql ??= neon(url);
  return crmSql;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function jsonObject<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function contactToRow(record: CrmContactRecord) {
  const normalized = {
    name: record.name,
    company: record.company,
    phone: record.phone,
    email: record.email,
    address: record.address,
    normalizedPhone: record.normalizedPhone,
    normalizedEmail: record.normalizedEmail,
    normalizedCompany: record.normalizedCompany,
    normalizedName: record.normalizedName,
  };
  const sourceMetadata = {
    importJobId: record.importJobId,
    sourceCrm: record.sourceCrm,
    tags: record.tags,
    notes: record.notes,
    lastInteractionAt: record.lastInteractionAt,
    relationshipScore: record.relationshipScore,
    scoreMetadata: record.scoreMetadata,
  };
  return {
    workspaceId: record.workspaceId,
    contactId: record.id,
    normalized,
    trust: record.dataTrust,
    sourceMetadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function rowToContact(row: ContactRow): CrmContactRecord {
  const normalized = jsonObject<Record<string, unknown>>(row.normalized, {});
  const sourceMetadata = jsonObject<Record<string, unknown>>(row.source_metadata, {});
  const trust = jsonObject<CrmContactRecord["dataTrust"]>(row.trust, {} as CrmContactRecord["dataTrust"]);

  return {
    id: String(row.contact_id),
    workspaceId: String(row.workspace_id),
    importJobId: typeof sourceMetadata.importJobId === "string" ? sourceMetadata.importJobId : null,
    name: String(normalized.name ?? ""),
    company: String(normalized.company ?? ""),
    phone: typeof normalized.phone === "string" ? normalized.phone : null,
    email: typeof normalized.email === "string" ? normalized.email : null,
    address: typeof normalized.address === "string" ? normalized.address : null,
    notes: typeof sourceMetadata.notes === "string" ? sourceMetadata.notes : null,
    tags: Array.isArray(sourceMetadata.tags) ? (sourceMetadata.tags as string[]) : [],
    lastInteractionAt:
      typeof sourceMetadata.lastInteractionAt === "string" ? sourceMetadata.lastInteractionAt : null,
    sourceCrm: typeof sourceMetadata.sourceCrm === "string" ? sourceMetadata.sourceCrm : null,
    normalizedPhone: typeof normalized.normalizedPhone === "string" ? normalized.normalizedPhone : null,
    normalizedEmail: typeof normalized.normalizedEmail === "string" ? normalized.normalizedEmail : null,
    normalizedCompany:
      typeof normalized.normalizedCompany === "string" ? normalized.normalizedCompany : null,
    normalizedName: typeof normalized.normalizedName === "string" ? normalized.normalizedName : null,
    dataTrust: trust,
    relationshipScore:
      typeof sourceMetadata.relationshipScore === "number" ? sourceMetadata.relationshipScore : null,
    scoreMetadata: jsonObject<CrmContactRecord["scoreMetadata"]>(
      sourceMetadata.scoreMetadata,
      null,
    ),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listContactsNeon(workspaceId: string): Promise<CrmContactRecord[]> {
  assertWorkspaceSlug(workspaceId);
  const sql = getCrmSql();
  const rows = (await sql`
    select workspace_id, contact_id, normalized, trust, source_metadata, created_at, updated_at
    from crm_contacts
    where workspace_id = ${workspaceId}
    order by updated_at desc
  `) as ContactRow[];
  return rows.map(rowToContact);
}

export async function upsertContactsNeon(
  records: CrmContactRecord[],
): Promise<{ inserted: number; updated: number }> {
  if (records.length === 0) return { inserted: 0, updated: 0 };

  const sql = getCrmSql();
  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    const row = contactToRow(record);
    const existing = (await sql`
      select 1 as found
      from crm_contacts
      where workspace_id = ${row.workspaceId}
        and contact_id = ${row.contactId}
      limit 1
    `) as Array<{ found: number }>;

    await sql`
      insert into crm_contacts (
        workspace_id,
        contact_id,
        normalized,
        trust,
        source_metadata,
        created_at,
        updated_at
      )
      values (
        ${row.workspaceId},
        ${row.contactId},
        ${JSON.stringify(row.normalized)}::jsonb,
        ${JSON.stringify(row.trust)}::jsonb,
        ${JSON.stringify(row.sourceMetadata)}::jsonb,
        ${row.createdAt}::timestamptz,
        ${row.updatedAt}::timestamptz
      )
      on conflict (workspace_id, contact_id)
      do update set
        normalized = excluded.normalized,
        trust = excluded.trust,
        source_metadata = excluded.source_metadata,
        updated_at = excluded.updated_at
    `;

    if (existing.length > 0) updated += 1;
    else inserted += 1;
  }

  return { inserted, updated };
}

export async function replaceWorkspaceContactsNeon(
  workspaceId: string,
  contacts: CrmContactRecord[],
): Promise<void> {
  assertWorkspaceSlug(workspaceId);
  const sql = getCrmSql();
  await sql`delete from crm_contacts where workspace_id = ${workspaceId}`;
  if (contacts.length === 0) return;
  await upsertContactsNeon(contacts);
}
