import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { CompanyRef } from "@/lib/mcp/types";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";
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
  scopedIdentityKeys,
  unscopedKey,
} from "./durableOutcomeShared";

type StoreWorkspace = {
  latestByKey: Record<string, DurableExecutionOutcome>;
  history: DurableExecutionOutcome[];
};

type StoreFile = {
  version: 1;
  byWorkspace: Record<string, StoreWorkspace>;
};

const STORE_PATH = path.join(process.cwd(), "data", "executionOutcomes.json");
const FILE_VERSION = 1;
const MAX_HISTORY_PER_WORKSPACE = 5000;

let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

function emptyStore(): StoreFile {
  return { version: FILE_VERSION, byWorkspace: {} };
}

async function readStore(): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== FILE_VERSION || typeof parsed.byWorkspace !== "object") return emptyStore();
    return parsed as StoreFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    console.error("[executionOutcomeFileAdapter] read failed", err);
    return emptyStore();
  }
}

async function writeStore(store: StoreFile): Promise<boolean> {
  return safeWriteJson(STORE_PATH, store);
}

function existingFor(ws: StoreWorkspace, input: DurableOutcomeInput): DurableExecutionOutcome | null {
  for (const key of scopedIdentityKeys(input)) {
    if (ws.latestByKey[key]) return ws.latestByKey[key];
  }
  return null;
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

export async function recordDurableOutcomeToFile(
  input: DurableOutcomeInput,
  options: { syncCrm?: boolean } = {},
): Promise<{ outcome: DurableExecutionOutcome; persisted: boolean; crmUpdated: boolean; duplicate: boolean }> {
  return serialize(async () => {
    const store = await readStore();
    const ws = store.byWorkspace[input.workspace] ?? { latestByKey: {}, history: [] };
    const idempotencyKey = deriveIdempotencyKey(input);

    const duplicate = ws.history.find((entry) => entry.idempotencyKey === idempotencyKey);
    if (duplicate) return { outcome: duplicate, persisted: true, crmUpdated: false, duplicate: true };

    const previous = existingFor(ws, input);
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

    for (const key of scopedIdentityKeys(outcome)) {
      ws.latestByKey[key] = outcome;
    }
    ws.history = [...ws.history, outcome].slice(-MAX_HISTORY_PER_WORKSPACE);
    store.byWorkspace[input.workspace] = ws;
    const persisted = await writeStore(store);

    let crmUpdated = false;
    if (persisted && options.syncCrm !== false) {
      crmUpdated = await syncCrmState(outcome, companyRefFrom(input));
    }
    return { outcome, persisted, crmUpdated, duplicate: false };
  });
}

export async function findTerminalDurableOutcomeInFile(
  workspace: string,
  identityKeysInput: Array<string | null | undefined>,
): Promise<DurableExecutionOutcome | null> {
  const store = await readStore();
  const ws = store.byWorkspace[workspace];
  if (!ws) return null;
  const keys = Array.from(new Set(identityKeysInput.filter((key): key is string => typeof key === "string" && key.trim().length > 0)));
  for (const key of keys) {
    const scoped = key.startsWith(`${workspace}:`) ? key : `${workspace}:${key}`;
    const outcome = ws.latestByKey[scoped] ?? ws.latestByKey[key];
    if (outcome && isTerminalDurableOutcome(outcome)) return outcome;
  }
  return null;
}

export async function listDurableOutcomesFromFile(workspace: string): Promise<DurableExecutionOutcome[]> {
  const store = await readStore();
  return store.byWorkspace[workspace]?.history ?? [];
}

export async function loadDurableOutcomeMapFromFile(workspace: string): Promise<Record<string, ExecutionOutcomeMapValue>> {
  const store = await readStore();
  const ws = store.byWorkspace[workspace];
  if (!ws) return {};
  const out: Record<string, ExecutionOutcomeMapValue> = {};
  for (const [key, record] of Object.entries(ws.latestByKey)) {
    out[unscopedKey(workspace, key)] = outcomeMapValue(record);
  }
  return out;
}
