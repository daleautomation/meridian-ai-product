import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getNeonSql } from "../lib/db/neon";
import {
  assertNeonMutationAllowed,
  type NeonMutationIntent,
} from "../lib/db/neonMutationBarrier";
import type { DurableExecutionOutcome } from "../lib/execution/serverOutcomeStore";
import { upsertDurableOutcomeRecordToNeon } from "../lib/execution/executionOutcomeNeonAdapter";
import type { CompanySnapshot } from "../lib/state/companySnapshotStore";
import { upsertSnapshotToNeon } from "../lib/state/companyCurrentStateNeonAdapter";
import type { UsageEvent } from "../lib/tracking/eventLog";
import { writeEventToNeon } from "../lib/tracking/eventNeonAdapter";

type ExecutionStoreFile = {
  version: 1;
  byWorkspace: Record<string, {
    latestByKey: Record<string, DurableExecutionOutcome>;
    history: DurableExecutionOutcome[];
  }>;
};

const ROOT = process.cwd();
const EXECUTION_OUTCOMES_PATH = path.join(ROOT, "data", "executionOutcomes.json");
const COMPANY_SNAPSHOTS_PATH = path.join(ROOT, "data", "companySnapshots.json");
const USAGE_EVENTS_PATH = process.env.MERIDIAN_EVENT_LOG_PATH
  ?? path.join(ROOT, "data", "usage-events.jsonl");

type BackfillConfig = {
  execute: boolean;
  allowProduction: boolean;
  databaseUrl: string;
  directDatabaseUrl: string;
  nodeEnv: string;
  truthStore: string;
  mutation: NeonMutationIntent;
};

type PlannedExecutionOutcome = {
  record: DurableExecutionOutcome;
  latestKeys?: string[];
};

type UsageEventPlan = {
  events: UsageEvent[];
  skippedLines: number;
};

type MigrationPlan = {
  executionOutcomes: PlannedExecutionOutcome[];
  companySnapshots: CompanySnapshot[];
  usageEvents: UsageEventPlan;
};

type BackfillStats = {
  rowsScanned: number;
  rowsInserted: number;
  rowsSkipped: number;
  duplicates: number;
  failures: number;
};

type MigrationSummary = {
  executionOutcomes: BackfillStats;
  companySnapshots: BackfillStats;
  usageEvents: BackfillStats;
  total: BackfillStats;
  durationMs: number;
};

function parseArgs(argv: string[]): { execute: boolean; allowProduction: boolean } {
  const known = new Set(["--dry-run", "--execute", "--allow-production"]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown backfill argument(s): ${unknown.join(", ")}`);
  }
  if (argv.includes("--dry-run") && argv.includes("--execute")) {
    throw new Error("Use either --dry-run or --execute, not both");
  }
  return {
    execute: argv.includes("--execute"),
    allowProduction: argv.includes("--allow-production")
      || process.env.MERIDIAN_BACKFILL_ALLOW_PRODUCTION?.trim().toLowerCase() === "true",
  };
}

function requireEnv(name: "DATABASE_URL" | "DIRECT_DATABASE_URL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Phase 1 Neon backfill safety checks`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("invalid_protocol");
    }
  } catch {
    throw new Error(`${name} must be a valid postgres:// or postgresql:// URL`);
  }
  return value;
}

function loadConfig(): BackfillConfig {
  const args = parseArgs(process.argv.slice(2));
  const truthStore = process.env.MERIDIAN_TRUTH_STORE?.trim().toLowerCase() ?? "file";
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase() ?? "";
  if (truthStore === "neon") {
    throw new Error("Phase 1 backfill is blocked while MERIDIAN_TRUTH_STORE=neon");
  }
  if (nodeEnv === "production" && !args.allowProduction) {
    throw new Error("Phase 1 backfill is blocked under NODE_ENV=production without --allow-production or MERIDIAN_BACKFILL_ALLOW_PRODUCTION=true");
  }
  if (args.execute && process.env.MERIDIAN_BACKFILL_CONFIRM?.trim().toLowerCase() !== "true") {
    throw new Error("Write execution requires --execute and MERIDIAN_BACKFILL_CONFIRM=true");
  }
  return {
    ...args,
    databaseUrl: requireEnv("DATABASE_URL"),
    directDatabaseUrl: requireEnv("DIRECT_DATABASE_URL"),
    nodeEnv: nodeEnv || "(unset)",
    truthStore,
    mutation: {
      execute: args.execute,
      confirmationEnv: "MERIDIAN_BACKFILL_CONFIRM",
    },
  };
}

function maskSegment(value: string): string {
  if (value.length <= 2) return "*".repeat(value.length);
  if (value.length <= 6) return `${value[0]}***${value[value.length - 1]}`;
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function describeDatabaseUrl(value: string): { host: string; database: string } {
  const parsed = new URL(value);
  const hostname = parsed.hostname;
  const hostParts = hostname.split(".");
  const host = hostParts.length > 1
    ? [maskSegment(hostParts[0]), ...hostParts.slice(1)].join(".")
    : maskSegment(hostname);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")) || "(none)";
  return {
    host,
    database: maskSegment(databaseName),
  };
}

function emptyStats(rowsScanned = 0): BackfillStats {
  return {
    rowsScanned,
    rowsInserted: 0,
    rowsSkipped: 0,
    duplicates: 0,
    failures: 0,
  };
}

function addStats(a: BackfillStats, b: BackfillStats): BackfillStats {
  return {
    rowsScanned: a.rowsScanned + b.rowsScanned,
    rowsInserted: a.rowsInserted + b.rowsInserted,
    rowsSkipped: a.rowsSkipped + b.rowsSkipped,
    duplicates: a.duplicates + b.duplicates,
    failures: a.failures + b.failures,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function unscopedKey(workspace: string, key: string): string {
  return key.startsWith(`${workspace}:`) ? key.slice(workspace.length + 1) : key;
}

function deterministicUuid(input: string): string {
  const hex = crypto.createHash("sha256").update(input).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

async function loadExecutionOutcomes(): Promise<PlannedExecutionOutcome[]> {
  const store = await readJson<ExecutionStoreFile>(EXECUTION_OUTCOMES_PATH);
  if (!store?.byWorkspace) return [];

  const planned: PlannedExecutionOutcome[] = [];
  for (const [workspace, ws] of Object.entries(store.byWorkspace)) {
    const latestKeysByEvent = new Map<string, string[]>();
    for (const [key, record] of Object.entries(ws.latestByKey ?? {})) {
      const list = latestKeysByEvent.get(record.eventId) ?? [];
      list.push(unscopedKey(workspace, key));
      latestKeysByEvent.set(record.eventId, list);
    }

    for (const record of ws.history ?? []) {
      planned.push({
        record,
        latestKeys: latestKeysByEvent.get(record.eventId),
      });
    }
  }
  return planned;
}

async function loadCompanySnapshots(): Promise<CompanySnapshot[]> {
  const snapshots = await readJson<Record<string, CompanySnapshot>>(COMPANY_SNAPSHOTS_PATH);
  if (!snapshots) return [];

  return Object.values(snapshots);
}

async function loadUsageEvents(): Promise<UsageEventPlan> {
  let raw: string;
  try {
    raw = await fs.readFile(USAGE_EVENTS_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], skippedLines: 0 };
    }
    throw err;
  }

  const events: UsageEvent[] = [];
  let skippedLines = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<UsageEvent>;
      if (!parsed.eventType) {
        skippedLines += 1;
        continue;
      }
      const event: UsageEvent = {
        eventType: parsed.eventType,
        userId: parsed.userId ?? null,
        operatorId: parsed.operatorId ?? parsed.userId ?? null,
        workspace: parsed.workspace ?? null,
        leadId: parsed.leadId ?? null,
        taskId: parsed.taskId ?? null,
        companyKey: parsed.companyKey ?? null,
        crmKey: parsed.crmKey ?? null,
        companyName: parsed.companyName ?? null,
        tradeId: parsed.tradeId ?? null,
        serviceBucketId: parsed.serviceBucketId ?? null,
        sourceSurface: parsed.sourceSurface ?? null,
        previousStatus: parsed.previousStatus ?? null,
        nextStatus: parsed.nextStatus ?? null,
        outcomeStatus: parsed.outcomeStatus ?? null,
        nextAction: parsed.nextAction ?? null,
        nextActionDate: parsed.nextActionDate ?? null,
        estimatedValue: parsed.estimatedValue ?? null,
        meridianInfluenced: parsed.meridianInfluenced ?? false,
        influenceReason: parsed.influenceReason ?? null,
        occurredAt: parsed.occurredAt ?? null,
        recordedAt: parsed.recordedAt ?? null,
        idempotencyKey: parsed.idempotencyKey ?? null,
        timestamp: parsed.timestamp ?? new Date().toISOString(),
        metadata: parsed.metadata ?? {},
        eventId: parsed.eventId ?? deterministicUuid(line),
      };
      events.push(event);
    } catch {
      // Match current reader behavior: malformed JSONL lines are skipped.
      skippedLines += 1;
    }
  }
  return { events, skippedLines };
}

async function loadMigrationPlan(): Promise<MigrationPlan> {
  const [executionOutcomes, companySnapshots, usageEvents] = await Promise.all([
    loadExecutionOutcomes(),
    loadCompanySnapshots(),
    loadUsageEvents(),
  ]);
  return { executionOutcomes, companySnapshots, usageEvents };
}

function logMigrationTarget(config: BackfillConfig, plan: MigrationPlan): void {
  console.log(`[phase1-neon-backfill] ${config.execute ? "WRITE EXECUTION ENABLED" : "DRY RUN ONLY"}`);
  console.log(`[phase1-neon-backfill] ${config.truthStore === "file" ? "FILE MODE ACTIVE" : "NEON WRITE MODE ACTIVE"}`, {
    truthStore: config.truthStore,
  });
  console.log("[phase1-neon-backfill] target", {
    targetMode: "file-to-neon",
    truthStore: config.truthStore,
    nodeEnv: config.nodeEnv,
    execution: config.execute ? "execute" : "dry-run",
    databaseUrl: describeDatabaseUrl(config.databaseUrl),
    directDatabaseUrl: describeDatabaseUrl(config.directDatabaseUrl),
    countsToMigrate: {
      executionOutcomes: plan.executionOutcomes.length,
      companySnapshots: plan.companySnapshots.length,
      usageEvents: plan.usageEvents.events.length,
      skippedUsageEventLines: plan.usageEvents.skippedLines,
    },
  });
}

async function executionOutcomeExists(record: DurableExecutionOutcome): Promise<boolean> {
  const sql = getNeonSql();
  const rows = (await sql`
    select 1
    from execution_outcomes
    where workspace = ${record.workspace}
      and idempotency_key = ${record.idempotencyKey}
    limit 1
  `) as unknown[];
  return rows.length > 0;
}

async function companySnapshotExists(snapshot: CompanySnapshot): Promise<boolean> {
  const sql = getNeonSql();
  const rows = (await sql`
    select 1
    from company_current_state
    where company_key = ${snapshot.key}
    limit 1
  `) as unknown[];
  return rows.length > 0;
}

async function usageEventExists(event: UsageEvent): Promise<boolean> {
  const sql = getNeonSql();
  const rows = (await sql`
    select 1
    from domain_events
    where event_id = ${event.eventId}
    limit 1
  `) as unknown[];
  return rows.length > 0;
}

async function backfillExecutionOutcomes(config: BackfillConfig, plan: PlannedExecutionOutcome[]): Promise<BackfillStats> {
  const stats = emptyStats(plan.length);
  if (!config.execute) {
    stats.rowsSkipped = plan.length;
    return stats;
  }

  for (const item of plan) {
    try {
      const duplicate = await executionOutcomeExists(item.record);
      if (duplicate) stats.duplicates += 1;
      await upsertDurableOutcomeRecordToNeon(item.record, item.latestKeys, { mutation: config.mutation });
      if (!duplicate) stats.rowsInserted += 1;
    } catch (err) {
      stats.failures += 1;
      console.error("[phase1-neon-backfill] execution outcome failed", {
        workspace: item.record.workspace,
        eventId: item.record.eventId,
        reason: errorMessage(err),
      });
    }
  }
  return stats;
}

async function backfillCompanySnapshots(config: BackfillConfig, plan: CompanySnapshot[]): Promise<BackfillStats> {
  const stats = emptyStats(plan.length);
  if (!config.execute) {
    stats.rowsSkipped = plan.length;
    return stats;
  }

  for (const snapshot of plan) {
    try {
      const duplicate = await companySnapshotExists(snapshot);
      if (duplicate) stats.duplicates += 1;
      await upsertSnapshotToNeon(snapshot, { mutation: config.mutation });
      if (!duplicate) stats.rowsInserted += 1;
    } catch (err) {
      stats.failures += 1;
      console.error("[phase1-neon-backfill] company snapshot failed", {
        companyKey: snapshot.key,
        reason: errorMessage(err),
      });
    }
  }
  return stats;
}

async function backfillUsageEvents(config: BackfillConfig, plan: UsageEventPlan): Promise<BackfillStats> {
  const stats = emptyStats(plan.events.length + plan.skippedLines);
  stats.rowsSkipped = plan.skippedLines;
  if (!config.execute) {
    stats.rowsSkipped += plan.events.length;
    return stats;
  }

  for (const event of plan.events) {
    try {
      const duplicate = await usageEventExists(event);
      if (duplicate) stats.duplicates += 1;
      const result = await writeEventToNeon(event, { mutation: config.mutation });
      if (!result.ok) {
        stats.failures += 1;
        console.error("[phase1-neon-backfill] usage event failed", {
          eventId: event.eventId,
          reason: result.reason ?? "insert_failed",
        });
      } else if (!duplicate) {
        stats.rowsInserted += 1;
      }
    } catch (err) {
      stats.failures += 1;
      console.error("[phase1-neon-backfill] usage event failed", {
        eventId: event.eventId,
        reason: errorMessage(err),
      });
    }
  }
  return stats;
}

async function runBackfill(config: BackfillConfig, plan: MigrationPlan): Promise<MigrationSummary> {
  if (config.execute) {
    assertNeonMutationAllowed({
      operation: "phase1 backfill",
      ...config.mutation,
    });
  }
  const started = Date.now();
  const executionOutcomes = await backfillExecutionOutcomes(config, plan.executionOutcomes);
  const companySnapshots = await backfillCompanySnapshots(config, plan.companySnapshots);
  const usageEvents = await backfillUsageEvents(config, plan.usageEvents);
  const total = [executionOutcomes, companySnapshots, usageEvents].reduce(
    (acc, stats) => addStats(acc, stats),
    emptyStats(),
  );
  return {
    executionOutcomes,
    companySnapshots,
    usageEvents,
    total,
    durationMs: Date.now() - started,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const plan = await loadMigrationPlan();
  logMigrationTarget(config, plan);
  const summary = await runBackfill(config, plan);
  console.log("[phase1-neon-backfill] complete", summary);
}

main().catch((err) => {
  console.error("[phase1-neon-backfill] failed", err);
  process.exitCode = 1;
});
