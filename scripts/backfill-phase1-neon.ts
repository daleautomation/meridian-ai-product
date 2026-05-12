import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
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

if (process.env.DIRECT_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
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

async function backfillExecutionOutcomes(): Promise<number> {
  const store = await readJson<ExecutionStoreFile>(EXECUTION_OUTCOMES_PATH);
  if (!store?.byWorkspace) return 0;

  let count = 0;
  for (const [workspace, ws] of Object.entries(store.byWorkspace)) {
    const latestKeysByEvent = new Map<string, string[]>();
    for (const [key, record] of Object.entries(ws.latestByKey ?? {})) {
      const list = latestKeysByEvent.get(record.eventId) ?? [];
      list.push(unscopedKey(workspace, key));
      latestKeysByEvent.set(record.eventId, list);
    }

    for (const record of ws.history ?? []) {
      await upsertDurableOutcomeRecordToNeon(record, latestKeysByEvent.get(record.eventId));
      count += 1;
    }
  }
  return count;
}

async function backfillCompanySnapshots(): Promise<number> {
  const snapshots = await readJson<Record<string, CompanySnapshot>>(COMPANY_SNAPSHOTS_PATH);
  if (!snapshots) return 0;

  let count = 0;
  for (const snapshot of Object.values(snapshots)) {
    await upsertSnapshotToNeon(snapshot);
    count += 1;
  }
  return count;
}

async function backfillUsageEvents(): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(USAGE_EVENTS_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }

  let count = 0;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<UsageEvent>;
      if (!parsed.eventType) continue;
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
      const result = await writeEventToNeon(event);
      if (result.ok) count += 1;
    } catch {
      // Match current reader behavior: malformed JSONL lines are skipped.
    }
  }
  return count;
}

async function main(): Promise<void> {
  const executionOutcomes = await backfillExecutionOutcomes();
  const companySnapshots = await backfillCompanySnapshots();
  const usageEvents = await backfillUsageEvents();
  console.log("[phase1-neon-backfill] complete", {
    executionOutcomes,
    companySnapshots,
    usageEvents,
  });
}

main().catch((err) => {
  console.error("[phase1-neon-backfill] failed", err);
  process.exitCode = 1;
});
