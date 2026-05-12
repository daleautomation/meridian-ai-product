import { companyKey, type CompanyRef, type ToolResult } from "@/lib/mcp/types";
import { getNeonSql } from "@/lib/db/neon";
import type {
  CompanyProfile,
  CompanySnapshot,
  ScorePoint,
  StatusChange,
} from "./companySnapshotStore";
import { ensureCompanySnapshotShape } from "./companySnapshotFileAdapter";

type SnapshotRow = Record<string, unknown>;

const MAX_HISTORY_PER_TOOL = 20;
const MAX_SCORE_HISTORY = 100;
const MAX_STATUS_HISTORY = 50;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return [];
    }
  }
  return [];
}

function freshSnapshot(company: CompanyRef, now: string): CompanySnapshot {
  return {
    key: companyKey(company),
    company,
    createdAt: now,
    updatedAt: now,
    latest: {},
    history: [],
    statusHistory: [],
    notes: [],
    scoreHistory: [],
  };
}

function snapshotFromRow(row: SnapshotRow): CompanySnapshot {
  const snapshot = jsonObject<CompanySnapshot | null>(row.snapshot, null);
  if (snapshot) return ensureCompanySnapshotShape(snapshot);
  return ensureCompanySnapshotShape({
    key: String(row.company_key),
    company: jsonObject<CompanyRef>(row.company, { name: String(row.company_key) }),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    latest: jsonObject(row.latest, {}),
    history: jsonArray(row.history),
    profile: jsonObject<CompanyProfile | undefined>(row.profile, undefined),
    status: clean(row.status) ?? undefined,
    statusHistory: jsonArray(row.status_history),
    nextAction: clean(row.next_action) ?? undefined,
    nextActionDate: clean(row.next_action_date) ?? undefined,
  });
}

type SummaryData = {
  opportunityLevel?: "HIGH" | "MEDIUM" | "LOW";
  recommendedAction?: string;
};

function maybeAppendScorePoint(snap: CompanySnapshot, result: ToolResult<unknown>): void {
  if (result.tool !== "generate_opportunity_summary") return;
  const data = (result.data ?? {}) as SummaryData;
  if (!data.opportunityLevel) return;
  const point: ScorePoint = {
    at: result.timestamp,
    opportunityLevel: data.opportunityLevel,
    confidence: result.confidence,
    recommendedAction: data.recommendedAction ?? "MONITOR",
    sourceTool: result.tool,
  };
  snap.scoreHistory = [...(snap.scoreHistory ?? []), point].slice(-MAX_SCORE_HISTORY);
}

function boundHistory(snap: CompanySnapshot): void {
  const perTool = new Map<string, typeof snap.history>();
  for (const entry of snap.history) {
    const list = perTool.get(entry.tool) ?? [];
    list.push(entry);
    perTool.set(entry.tool, list);
  }
  snap.history = [];
  for (const list of perTool.values()) {
    snap.history.push(...list.slice(-MAX_HISTORY_PER_TOOL));
  }
  snap.history.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function upsertSnapshotToNeon(snapshot: CompanySnapshot): Promise<CompanySnapshot> {
  const sql = getNeonSql();
  const normalized = ensureCompanySnapshotShape(snapshot);
  await sql`
    insert into company_current_state (
      company_key, company, status, status_history, next_action, next_action_date,
      profile, latest, history, snapshot, updated_at, created_at
    )
    values (
      ${normalized.key}, ${JSON.stringify(normalized.company)}::jsonb, ${normalized.status ?? null},
      ${JSON.stringify(normalized.statusHistory ?? [])}::jsonb, ${normalized.nextAction ?? null},
      ${normalized.nextActionDate ?? null}, ${JSON.stringify(normalized.profile ?? null)}::jsonb,
      ${JSON.stringify(normalized.latest ?? {})}::jsonb, ${JSON.stringify(normalized.history ?? [])}::jsonb,
      ${JSON.stringify(normalized)}::jsonb, ${normalized.updatedAt}, ${normalized.createdAt}
    )
    on conflict (company_key)
    do update set
      company = excluded.company,
      status = excluded.status,
      status_history = excluded.status_history,
      next_action = excluded.next_action,
      next_action_date = excluded.next_action_date,
      profile = excluded.profile,
      latest = excluded.latest,
      history = excluded.history,
      snapshot = excluded.snapshot,
      updated_at = excluded.updated_at
  `;
  return normalized;
}

export async function getSnapshotFromNeon(company: CompanyRef): Promise<CompanySnapshot | null> {
  const sql = getNeonSql();
  const rows = (await sql`
    select *
    from company_current_state
    where company_key = ${companyKey(company)}
    limit 1
  `) as unknown as SnapshotRow[];
  return rows[0] ? snapshotFromRow(rows[0] as SnapshotRow) : null;
}

export async function listSnapshotsFromNeon(): Promise<CompanySnapshot[]> {
  const sql = getNeonSql();
  const rows = (await sql`
    select *
    from company_current_state
    order by updated_at desc
  `) as unknown as SnapshotRow[];
  return rows.map((row) => snapshotFromRow(row as SnapshotRow));
}

export async function recordToolResultToNeon<T>(
  company: CompanyRef,
  result: ToolResult<T>,
): Promise<CompanySnapshot> {
  const now = new Date().toISOString();
  const existing = await getSnapshotFromNeon(company);
  const snap: CompanySnapshot = existing
    ? {
        ...existing,
        company: { ...existing.company, ...company },
        updatedAt: now,
        lastCheckedAt: now,
        latest: { ...existing.latest, [result.tool]: result as ToolResult<unknown> },
        history: [
          ...existing.history,
          { tool: result.tool, timestamp: result.timestamp, result: result as ToolResult<unknown> },
        ],
      }
    : {
        ...freshSnapshot(company, now),
        lastCheckedAt: now,
        latest: { [result.tool]: result as ToolResult<unknown> },
        history: [
          { tool: result.tool, timestamp: result.timestamp, result: result as ToolResult<unknown> },
        ],
      };
  maybeAppendScorePoint(snap, result as ToolResult<unknown>);
  boundHistory(snap);
  return upsertSnapshotToNeon(snap);
}

export async function setStatusToNeon(
  company: CompanyRef,
  change: { status: string; changedBy: string; note?: string },
): Promise<{ snapshot: CompanySnapshot; change: StatusChange }> {
  const now = new Date().toISOString();
  const existing = await getSnapshotFromNeon(company) ?? freshSnapshot(company, now);
  const entry: StatusChange = {
    status: change.status,
    changedAt: now,
    changedBy: change.changedBy,
    note: change.note,
  };
  const next: CompanySnapshot = {
    ...existing,
    company: { ...existing.company, ...company },
    status: change.status,
    statusHistory: [...(existing.statusHistory ?? []), entry].slice(-MAX_STATUS_HISTORY),
    updatedAt: now,
  };
  return { snapshot: await upsertSnapshotToNeon(next), change: entry };
}

export async function setNextActionToNeon(
  company: CompanyRef,
  update: { nextAction: string; nextActionDate?: string; contactName?: string; contactPhone?: string; contactEmail?: string },
): Promise<CompanySnapshot> {
  const now = new Date().toISOString();
  const existing = await getSnapshotFromNeon(company) ?? freshSnapshot(company, now);
  const next: CompanySnapshot = {
    ...existing,
    company: { ...existing.company, ...company },
    nextAction: update.nextAction,
    nextActionDate: update.nextActionDate,
    contactName: update.contactName ?? existing.contactName,
    contactPhone: update.contactPhone ?? existing.contactPhone,
    contactEmail: update.contactEmail ?? existing.contactEmail,
    updatedAt: now,
  };
  return upsertSnapshotToNeon(next);
}
