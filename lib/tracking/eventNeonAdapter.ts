import crypto from "node:crypto";
import { getNeonSql } from "@/lib/db/neon";
import {
  assertNeonMutationAllowed,
  type NeonMutationIntent,
} from "@/lib/db/neonMutationBarrier";
import type { UsageEvent } from "./eventLog";

type EventRow = Record<string, unknown>;
type NeonMutationOptions = { mutation?: NeonMutationIntent };

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
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

function eventFromRow(row: EventRow): UsageEvent {
  const stored = jsonObject(row.event) as Partial<UsageEvent>;
  return {
    ...stored,
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    userId: clean(row.user_id),
    operatorId: clean(row.operator_id),
    workspace: clean(row.workspace),
    leadId: clean(row.lead_id),
    taskId: clean(row.task_id),
    companyKey: clean(row.company_key),
    crmKey: clean(row.crm_key),
    companyName: stored.companyName ?? null,
    tradeId: stored.tradeId ?? null,
    serviceBucketId: stored.serviceBucketId ?? null,
    sourceSurface: clean(row.source_surface),
    idempotencyKey: clean(row.idempotency_key),
    occurredAt: isoOrNull(row.occurred_at),
    recordedAt: isoOrNull(row.recorded_at),
    timestamp: isoOrNull(row.created_at) ?? stored.timestamp ?? new Date().toISOString(),
    metadata: jsonObject(row.metadata),
  };
}

export async function writeEventToNeon(
  event: UsageEvent,
  options: NeonMutationOptions = {},
): Promise<{ ok: boolean; reason?: string }> {
  assertNeonMutationAllowed({
    operation: "domain event write",
    execute: options.mutation?.execute ?? false,
    confirmationEnv: options.mutation?.confirmationEnv,
  });
  try {
    const sql = getNeonSql();
    const eventId = event.eventId ?? crypto.randomUUID();
    if (event.idempotencyKey) {
      await sql`
        insert into idempotency_keys (key, scope, response)
        values (${event.idempotencyKey}, ${`domain_event:${event.eventType}`}, ${JSON.stringify({ eventId })}::jsonb)
        on conflict (key) do nothing
      `;
    }
    await sql`
      insert into domain_events (
        event_id, event_type, workspace, user_id, operator_id, lead_id, task_id,
        company_key, crm_key, source_surface, idempotency_key, occurred_at,
        recorded_at, metadata, event, created_at
      )
      values (
        ${eventId}, ${event.eventType}, ${event.workspace}, ${event.userId},
        ${event.operatorId ?? event.userId}, ${event.leadId}, ${event.taskId},
        ${event.companyKey ?? null}, ${event.crmKey ?? null}, ${event.sourceSurface ?? null},
        ${event.idempotencyKey ?? null}, ${event.occurredAt ?? null}, ${event.recordedAt ?? null},
        ${JSON.stringify(event.metadata ?? {})}::jsonb, ${JSON.stringify({ ...event, eventId })}::jsonb,
        ${event.timestamp}
      )
      on conflict (event_id) do nothing
    `;
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "insert_failed" };
  }
}

export async function readRecentEventsFromNeon(limit = 200): Promise<UsageEvent[]> {
  const sql = getNeonSql();
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  const rows = (await sql`
    select *
    from domain_events
    order by created_at desc
    limit ${boundedLimit}
  `) as unknown as EventRow[];
  return rows.map((row) => eventFromRow(row as EventRow)).reverse();
}
