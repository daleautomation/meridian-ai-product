import crypto from "node:crypto";
import type { CompanyRef } from "@/lib/mcp/types";
import { getNeonSql } from "@/lib/db/neon";
import { setNextAction, setStatus } from "@/lib/state/companySnapshotStore";
import type {
  DurableExecutionOutcome,
  DurableOutcomeInput,
  ExecutionOutcomeMapValue,
} from "./serverOutcomeStore";
import {
  clean,
  crmStatusForOutcome,
  deriveIdempotencyKey,
  isTerminalDurableOutcome,
  numberOrNull,
  outcomeMapValue,
  unscopedIdentityKeys,
} from "./durableOutcomeShared";

type OutcomeRow = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return clean(value);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function recordFromRow(row: OutcomeRow): DurableExecutionOutcome {
  return {
    eventId: String(row.event_id),
    workspace: String(row.workspace),
    companyKey: clean(row.company_key),
    crmKey: clean(row.crm_key),
    leadId: clean(row.lead_id),
    taskId: clean(row.task_id),
    operatorId: String(row.operator_id),
    sourceSurface: String(row.source_surface),
    outcomeStatus: row.outcome_status as DurableExecutionOutcome["outcomeStatus"],
    previousStatus: clean(row.previous_status),
    nextStatus: row.next_status as DurableExecutionOutcome["nextStatus"],
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    nextAction: clean(row.next_action),
    nextActionDate: dateOnly(row.next_action_date),
    estimatedValue: numberOrNull(row.estimated_value),
    meridianInfluenced: row.meridian_influenced !== false,
    influenceReason: String(row.influence_reason),
    idempotencyKey: String(row.idempotency_key),
    metadata: jsonObject(row.metadata),
  };
}

function companyRefFrom(input: DurableOutcomeInput): CompanyRef | null {
  const companyName = clean(input.companyName)
    ?? clean(input.companyKey)?.replace(/^name:/, "")
    ?? clean(input.crmKey)?.replace(/^name:/, "")
    ?? clean(input.leadId);
  if (!companyName) return null;
  const domainKey = [clean(input.companyKey), clean(input.crmKey)]
    .find((key) => key?.startsWith("domain:"));
  const domain = domainKey ? domainKey.replace(/^domain:/, "") : undefined;
  return { name: companyName, ...(domain ? { domain } : {}) };
}

async function syncCrmState(record: DurableExecutionOutcome, company: CompanyRef | null): Promise<boolean> {
  if (!company) return false;
  let updated = false;
  const status = crmStatusForOutcome(record.outcomeStatus);
  if (status) {
    await setStatus(company, {
      status,
      changedBy: record.operatorId,
      note: `Execution outcome: ${record.outcomeStatus}`,
    });
    updated = true;
  }
  if (record.outcomeStatus === "Follow Up" && record.nextActionDate) {
    await setNextAction(company, {
      nextAction: record.nextAction ?? "follow_up_call",
      nextActionDate: record.nextActionDate,
    });
    updated = true;
  }
  return updated;
}

async function findDuplicate(workspace: string, idempotencyKey: string): Promise<DurableExecutionOutcome | null> {
  const sql = getNeonSql();
  const rows = (await sql`
    select *
    from execution_outcomes
    where workspace = ${workspace}
      and idempotency_key = ${idempotencyKey}
    limit 1
  `) as unknown as OutcomeRow[];
  return rows[0] ? recordFromRow(rows[0] as OutcomeRow) : null;
}

async function existingFor(input: DurableOutcomeInput): Promise<DurableExecutionOutcome | null> {
  const sql = getNeonSql();
  for (const key of unscopedIdentityKeys(input)) {
    const rows = (await sql`
      select eo.*
      from execution_outcome_latest latest
      join execution_outcomes eo on eo.event_id = latest.event_id
      where latest.workspace = ${input.workspace}
        and latest.identity_key = ${key}
      limit 1
    `) as unknown as OutcomeRow[];
    if (rows[0]) return recordFromRow(rows[0] as OutcomeRow);
  }
  return null;
}

async function insertOutcome(record: DurableExecutionOutcome, latestKeys: string[]): Promise<boolean> {
  const sql = getNeonSql();
  const response = JSON.stringify({ outcome: record });
  await sql`
    insert into idempotency_keys (key, scope, response)
    values (${record.idempotencyKey}, ${`execution_outcome:${record.workspace}`}, ${response}::jsonb)
    on conflict (key) do nothing
  `;
  const inserted = (await sql`
    insert into execution_outcomes (
      event_id, workspace, company_key, crm_key, lead_id, task_id, operator_id,
      source_surface, outcome_status, previous_status, next_status, occurred_at,
      recorded_at, next_action, next_action_date, estimated_value,
      meridian_influenced, influence_reason, idempotency_key, metadata
    )
    values (
      ${record.eventId}, ${record.workspace}, ${record.companyKey}, ${record.crmKey},
      ${record.leadId}, ${record.taskId}, ${record.operatorId}, ${record.sourceSurface},
      ${record.outcomeStatus}, ${record.previousStatus}, ${record.nextStatus},
      ${record.occurredAt}, ${record.recordedAt}, ${record.nextAction},
      ${record.nextActionDate}, ${record.estimatedValue}, ${record.meridianInfluenced},
      ${record.influenceReason}, ${record.idempotencyKey}, ${JSON.stringify(record.metadata)}::jsonb
    )
    on conflict (workspace, idempotency_key) do nothing
    returning event_id
  `) as unknown as OutcomeRow[];
  if (!inserted[0]) return false;
  for (const key of latestKeys) {
    await sql`
      insert into execution_outcome_latest (workspace, identity_key, event_id, updated_at)
      values (${record.workspace}, ${key}, ${record.eventId}, ${record.recordedAt})
      on conflict (workspace, identity_key)
      do update set event_id = excluded.event_id, updated_at = excluded.updated_at
    `;
  }
  return true;
}

export async function upsertDurableOutcomeRecordToNeon(
  record: DurableExecutionOutcome,
  latestKeys = unscopedIdentityKeys(record),
): Promise<void> {
  const inserted = await insertOutcome(record, latestKeys);
  if (!inserted) {
    const sql = getNeonSql();
    for (const key of latestKeys) {
      await sql`
        insert into execution_outcome_latest (workspace, identity_key, event_id, updated_at)
        values (${record.workspace}, ${key}, ${record.eventId}, ${record.recordedAt})
        on conflict (workspace, identity_key)
        do update set event_id = excluded.event_id, updated_at = excluded.updated_at
      `;
    }
  }
}

export async function recordDurableOutcomeToNeon(
  input: DurableOutcomeInput,
): Promise<{ outcome: DurableExecutionOutcome; persisted: boolean; crmUpdated: boolean; duplicate: boolean }> {
  const idempotencyKey = deriveIdempotencyKey(input);
  const duplicate = await findDuplicate(input.workspace, idempotencyKey);
  if (duplicate) return { outcome: duplicate, persisted: true, crmUpdated: false, duplicate: true };

  const previous = await existingFor(input);
  const recordedAt = new Date().toISOString();
  const outcome: DurableExecutionOutcome = {
    eventId: crypto.randomUUID(),
    workspace: input.workspace,
    companyKey: clean(input.companyKey),
    crmKey: clean(input.crmKey),
    leadId: clean(input.leadId),
    taskId: clean(input.taskId),
    operatorId: input.operatorId,
    sourceSurface: clean(input.sourceSurface) ?? "unknown",
    outcomeStatus: input.outcomeStatus,
    previousStatus: previous?.outcomeStatus ?? null,
    nextStatus: input.outcomeStatus,
    occurredAt: clean(input.occurredAt) ?? recordedAt,
    recordedAt,
    nextAction: clean(input.nextAction),
    nextActionDate: clean(input.nextActionDate),
    estimatedValue: numberOrNull(input.estimatedValue),
    meridianInfluenced: input.meridianInfluenced !== false,
    influenceReason: clean(input.influenceReason) ?? "Recorded from Meridian execution workflow",
    idempotencyKey,
    metadata: input.metadata ?? {},
  };

  const inserted = await insertOutcome(outcome, unscopedIdentityKeys(outcome));
  if (!inserted) {
    const racedDuplicate = await findDuplicate(input.workspace, idempotencyKey);
    if (racedDuplicate) return { outcome: racedDuplicate, persisted: true, crmUpdated: false, duplicate: true };
    return { outcome, persisted: false, crmUpdated: false, duplicate: false };
  }

  const crmUpdated = await syncCrmState(outcome, companyRefFrom(input));
  return { outcome, persisted: true, crmUpdated, duplicate: false };
}

export async function findTerminalDurableOutcomeInNeon(
  workspace: string,
  identityKeysInput: Array<string | null | undefined>,
): Promise<DurableExecutionOutcome | null> {
  const sql = getNeonSql();
  const keys = Array.from(new Set(identityKeysInput.filter((key): key is string => typeof key === "string" && key.trim().length > 0)));
  for (const key of keys) {
    const scoped = key.startsWith(`${workspace}:`) ? key.slice(workspace.length + 1) : key;
    const rows = (await sql`
      select eo.*
      from execution_outcome_latest latest
      join execution_outcomes eo on eo.event_id = latest.event_id
      where latest.workspace = ${workspace}
        and latest.identity_key = ${scoped}
      limit 1
    `) as unknown as OutcomeRow[];
    if (rows[0]) {
      const outcome = recordFromRow(rows[0] as OutcomeRow);
      if (isTerminalDurableOutcome(outcome)) return outcome;
    }
  }
  return null;
}

export async function listDurableOutcomesFromNeon(workspace: string): Promise<DurableExecutionOutcome[]> {
  const sql = getNeonSql();
  const rows = (await sql`
    select *
    from execution_outcomes
    where workspace = ${workspace}
    order by recorded_at asc
    limit 5000
  `) as unknown as OutcomeRow[];
  return rows.map((row) => recordFromRow(row as OutcomeRow));
}

export async function loadDurableOutcomeMapFromNeon(workspace: string): Promise<Record<string, ExecutionOutcomeMapValue>> {
  const sql = getNeonSql();
  const rows = (await sql`
    select latest.identity_key, eo.*
    from execution_outcome_latest latest
    join execution_outcomes eo on eo.event_id = latest.event_id
    where latest.workspace = ${workspace}
  `) as unknown as OutcomeRow[];
  const out: Record<string, ExecutionOutcomeMapValue> = {};
  for (const row of rows as OutcomeRow[]) {
    const key = clean(row.identity_key);
    if (key) out[key] = outcomeMapValue(recordFromRow(row));
  }
  return out;
}
