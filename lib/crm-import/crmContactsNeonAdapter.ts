import { neon } from "@neondatabase/serverless";
import type {
  ContactRepair,
  ContactRepairField,
  ContactRepairSource,
  CrmContactRecord,
} from "./types";
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
  const sourceMetadata: Record<string, unknown> = {
    importJobId: record.importJobId,
    sourceCrm: record.sourceCrm,
    tags: record.tags,
    notes: record.notes,
    lastInteractionAt: record.lastInteractionAt,
    relationshipScore: record.relationshipScore,
    scoreMetadata: record.scoreMetadata,
  };
  // Additive enrichment block. Always nested under `enrichment` so a
  // future provider doesn't pollute the top level.
  if (record.enrichment) {
    sourceMetadata.enrichment = record.enrichment;
  }
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

  // ── Import-time values (immutable, never overwritten) ────────────
  const importName = String(normalized.name ?? "");
  const importCompany = String(normalized.company ?? "");
  const importPhone = typeof normalized.phone === "string" ? normalized.phone : null;
  const importEmail = typeof normalized.email === "string" ? normalized.email : null;
  const importAddress = typeof normalized.address === "string" ? normalized.address : null;

  // ── Repair overlay (chronological, last-write-wins per field) ────
  const repairsRaw = Array.isArray(sourceMetadata.repairs)
    ? (sourceMetadata.repairs as Array<Record<string, unknown>>)
    : [];
  const repairs: CrmContactRecord["repairs"] = repairsRaw
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      field: r.field as ContactRepairField,
      originalValue: typeof r.originalValue === "string" ? r.originalValue : null,
      newValue: String(r.newValue ?? ""),
      source: (r.source as ContactRepairSource) ?? "founder_rehab",
      repairedAt: typeof r.repairedAt === "string" ? r.repairedAt : "",
      operator: typeof r.operator === "string" ? r.operator : undefined,
      note: typeof r.note === "string" ? r.note : undefined,
    }))
    .filter((r) => r.field && r.repairedAt)
    .sort((a, b) => Date.parse(a.repairedAt) - Date.parse(b.repairedAt));

  // Apply repairs in chronological order; last repair per field wins.
  let effectiveName = importName;
  let effectiveCompany = importCompany;
  let effectivePhone = importPhone;
  let effectiveEmail = importEmail;
  let effectiveAddress = importAddress;
  for (const r of repairs) {
    if (r.field === "name") effectiveName = r.newValue;
    else if (r.field === "company") effectiveCompany = r.newValue;
    else if (r.field === "phone") effectivePhone = r.newValue || null;
    else if (r.field === "email") effectiveEmail = r.newValue || null;
    else if (r.field === "address") effectiveAddress = r.newValue || null;
  }

  // Preserve import-time originals visibly when a repair is present;
  // otherwise leave undefined so callers can short-circuit.
  const originalImport = repairs.length > 0
    ? {
        name: importName,
        company: importCompany,
        phone: importPhone,
        email: importEmail,
        address: importAddress,
      }
    : undefined;

  return {
    id: String(row.contact_id),
    workspaceId: String(row.workspace_id),
    importJobId: typeof sourceMetadata.importJobId === "string" ? sourceMetadata.importJobId : null,
    name: effectiveName,
    company: effectiveCompany,
    phone: effectivePhone,
    email: effectiveEmail,
    address: effectiveAddress,
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
    enrichment: jsonObject<CrmContactRecord["enrichment"]>(
      sourceMetadata.enrichment,
      undefined,
    ),
    repairs: repairs.length > 0 ? repairs : undefined,
    originalImport,
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

/**
 * Append a founder-led repair to a contact's `source_metadata.repairs`
 * array. Pure additive. The original `normalized.<field>` JSONB is
 * NEVER overwritten — repairs layer on top and the read path
 * (`rowToContact`) applies them as an overlay.
 *
 * Constitution §1: repairs are T1 operator-entered content; they sit
 * between notes (T1) and imported tags (T3).
 * Constitution §5: same input → same output; the chronological
 * `repairedAt` ordering in the write path determines the deterministic
 * merge order in the read path.
 *
 * Returns true when a row was updated, false when no such
 * (workspace, contact_id) exists.
 */
export async function applyContactRepairNeon(
  workspaceId: string,
  contactId: string,
  repair: ContactRepair,
): Promise<boolean> {
  assertWorkspaceSlug(workspaceId);
  if (!repair.field || !repair.repairedAt) {
    throw new Error("applyContactRepairNeon: repair must carry field + repairedAt");
  }
  const sql = getCrmSql();
  // Concatenate the new repair onto the existing array (or create the
  // array if absent). Touches only source_metadata.repairs.
  const result = (await sql`
    update crm_contacts
       set source_metadata = jsonb_set(
             coalesce(source_metadata, '{}'::jsonb),
             '{repairs}',
             coalesce(source_metadata->'repairs', '[]'::jsonb)
               || ${JSON.stringify([repair])}::jsonb,
             true
           ),
           updated_at = now()
     where workspace_id = ${workspaceId}
       and contact_id = ${contactId}
    returning contact_id
  `) as Array<{ contact_id: string }>;
  return result.length > 0;
}

/**
 * Convenience: write a name repair given just a new full name and the
 * pre-repair original. Used by the surname-shortcut path in
 * scripts/repair-contacts.ts.
 */
export async function applyContactNameRepairNeon(args: {
  workspaceId: string;
  contactId: string;
  originalName: string | null;
  newName: string;
  source?: ContactRepairSource;
  operator?: string;
  note?: string;
  now?: Date;
}): Promise<boolean> {
  const now = (args.now ?? new Date()).toISOString();
  return applyContactRepairNeon(args.workspaceId, args.contactId, {
    field: "name" as ContactRepairField,
    originalValue: args.originalName,
    newValue: args.newName,
    source: args.source ?? "founder_rehab",
    repairedAt: now,
    operator: args.operator,
    note: args.note,
  });
}

/**
 * Merge a single contact's `source_metadata.enrichment.propertyIntelligence`
 * entry. Touches only that nested key — leaves enrichment.hunter and the
 * rest of source_metadata byte-identical.
 *
 * Constitution §1: this writer cannot overwrite T1–T3 CRM truth.
 * Constitution §2: caller MUST pass a fully-provenanced entry; the
 *   non-optional fields of PropertyIntelligenceEntry enforce this at
 *   the type layer.
 *
 * Returns true if a row was updated, false if no such
 * (workspace, contact_id) row exists.
 */
export async function applyContactPropertyIntelligenceNeon(
  workspaceId: string,
  contactId: string,
  entry: import("./types").PropertyIntelligenceEntry,
): Promise<boolean> {
  assertWorkspaceSlug(workspaceId);
  const sql = getCrmSql();
  const result = (await sql`
    update crm_contacts
       set source_metadata = jsonb_set(
             coalesce(source_metadata, '{}'::jsonb),
             '{enrichment,propertyIntelligence}',
             ${JSON.stringify(entry)}::jsonb,
             true
           ),
           updated_at = now()
     where workspace_id = ${workspaceId}
       and contact_id = ${contactId}
    returning contact_id
  `) as Array<{ contact_id: string }>;
  return result.length > 0;
}

/**
 * Merge a single contact's `source_metadata.enrichment` key in place.
 * Never touches normalized / trust / any other source_metadata field.
 * Returns true if a row was updated, false if no such (workspace, contact_id)
 * row exists.
 *
 * Pure additive write — the existing source_metadata is preserved.
 * Other concurrent writes that don't touch `enrichment` cannot lose data.
 */
export async function applyContactEnrichmentNeon(
  workspaceId: string,
  contactId: string,
  enrichment: NonNullable<CrmContactRecord["enrichment"]>,
): Promise<boolean> {
  assertWorkspaceSlug(workspaceId);
  const sql = getCrmSql();
  const result = (await sql`
    update crm_contacts
       set source_metadata = jsonb_set(
             coalesce(source_metadata, '{}'::jsonb),
             '{enrichment}',
             coalesce(source_metadata->'enrichment', '{}'::jsonb) || ${JSON.stringify(enrichment)}::jsonb,
             true
           ),
           updated_at = now()
     where workspace_id = ${workspaceId}
       and contact_id = ${contactId}
    returning contact_id
  `) as Array<{ contact_id: string }>;
  return result.length > 0;
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
