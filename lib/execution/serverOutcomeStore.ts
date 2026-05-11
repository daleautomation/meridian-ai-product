// Meridian — durable execution outcome store.
//
// Small file-backed authority for revenue attribution. The browser keeps
// localStorage for instant UI, but this store is the cross-device source of
// truth for worked leads, outcome history, and commission evidence.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { CompanyRef } from "@/lib/mcp/types";
import { setNextAction, setStatus } from "@/lib/state/companySnapshotStore";
import { isTerminalStatusValue } from "@/lib/crm/statusTaxonomy";
import type { ExecutionOutcomeStatus } from "./executionOutcome";

export type DurableOutcomeStatus = ExecutionOutcomeStatus;

export type DurableExecutionOutcome = {
  eventId: string;
  workspace: string;
  companyKey: string | null;
  crmKey: string | null;
  leadId: string | null;
  taskId: string | null;
  operatorId: string;
  sourceSurface: string;
  outcomeStatus: DurableOutcomeStatus;
  previousStatus: string | null;
  nextStatus: DurableOutcomeStatus;
  occurredAt: string;
  recordedAt: string;
  nextAction: string | null;
  nextActionDate: string | null;
  estimatedValue: number | null;
  meridianInfluenced: boolean;
  influenceReason: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
};

export type DurableOutcomeInput = {
  workspace: string;
  companyKey?: string | null;
  crmKey?: string | null;
  leadId?: string | null;
  taskId?: string | null;
  operatorId: string;
  sourceSurface: string;
  outcomeStatus: DurableOutcomeStatus;
  occurredAt?: string | null;
  nextAction?: string | null;
  nextActionDate?: string | null;
  estimatedValue?: number | null;
  meridianInfluenced?: boolean | null;
  influenceReason?: string | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
  companyName?: string | null;
};

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

const VALID_OUTCOMES: DurableOutcomeStatus[] = [
  "Not Contacted",
  "Called",
  "Interested",
  "Follow Up",
  "Qualified",
  "Proposal Sent",
  "Closed Won",
  "Closed Lost",
  "Not Qualified",
];

let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isDurableOutcomeStatus(value: unknown): value is DurableOutcomeStatus {
  return typeof value === "string" && VALID_OUTCOMES.includes(value as DurableOutcomeStatus);
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
    console.error("[serverOutcomeStore] read failed", err);
    return emptyStore();
  }
}

async function writeStore(store: StoreFile): Promise<boolean> {
  return safeWriteJson(STORE_PATH, store);
}

function identityKeys(input: {
  workspace: string;
  companyKey?: string | null;
  crmKey?: string | null;
  leadId?: string | null;
  taskId?: string | null;
}): string[] {
  return Array.from(new Set([
    clean(input.taskId),
    clean(input.leadId),
    clean(input.companyKey),
    clean(input.crmKey),
    clean(input.leadId) ? `lead-${clean(input.leadId)}-call` : null,
    clean(input.leadId) ? `lead-${clean(input.leadId)}-followup` : null,
  ].filter((key): key is string => !!key).map((key) => `${input.workspace}:${key}`)));
}

function existingFor(ws: StoreWorkspace, input: DurableOutcomeInput): DurableExecutionOutcome | null {
  for (const key of identityKeys(input)) {
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

export function crmStatusForOutcome(status: DurableOutcomeStatus): string | null {
  switch (status) {
    case "Called":
      return "CONTACTED";
    case "Interested":
    case "Follow Up":
      return "FOLLOW_UP";
    case "Proposal Sent":
    case "Qualified":
      return "QUALIFIED";
    case "Closed Won":
      return "CLOSED_WON";
    case "Closed Lost":
      return "CLOSED_LOST";
    case "Not Qualified":
      return "NOT_QUALIFIED";
    case "Not Contacted":
    default:
      return null;
  }
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

export async function recordDurableOutcome(
  input: DurableOutcomeInput,
): Promise<{ outcome: DurableExecutionOutcome; persisted: boolean; crmUpdated: boolean; duplicate: boolean }> {
  return serialize(async () => {
    const store = await readStore();
    const ws = store.byWorkspace[input.workspace] ?? { latestByKey: {}, history: [] };
    const idempotencyKey =
      clean(input.idempotencyKey)
      ?? `${input.workspace}:${clean(input.taskId) ?? clean(input.leadId) ?? crypto.randomUUID()}:${input.outcomeStatus}:${clean(input.occurredAt) ?? ""}`;

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

    for (const key of identityKeys(outcome)) {
      ws.latestByKey[key] = outcome;
    }
    ws.history = [...ws.history, outcome].slice(-MAX_HISTORY_PER_WORKSPACE);
    store.byWorkspace[input.workspace] = ws;
    const persisted = await writeStore(store);

    let crmUpdated = false;
    if (persisted) {
      crmUpdated = await syncCrmState(outcome, companyRefFrom(input));
    }
    return { outcome, persisted, crmUpdated, duplicate: false };
  });
}

export function isTerminalDurableOutcomeStatus(status: string | null | undefined): boolean {
  return status === "Closed Won" || status === "Closed Lost" || status === "Not Qualified";
}

export async function findTerminalDurableOutcome(
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
    if (outcome && (isTerminalDurableOutcomeStatus(outcome.outcomeStatus) || isTerminalStatusValue(crmStatusForOutcome(outcome.outcomeStatus)))) {
      return outcome;
    }
  }
  return null;
}

export async function listDurableOutcomes(workspace: string): Promise<DurableExecutionOutcome[]> {
  const store = await readStore();
  return store.byWorkspace[workspace]?.history ?? [];
}

export type ExecutionOutcomeMapValue = {
  status: DurableOutcomeStatus;
  contacted: boolean;
  interested: boolean;
  followupNeeded: boolean;
  nextFollowupDate: string | null;
  notes: string;
  estimatedValue: number | null;
  lastActionAt: string | null;
  attributionSource: "Meridian";
};

export async function loadDurableOutcomeMap(workspace: string): Promise<Record<string, ExecutionOutcomeMapValue>> {
  const store = await readStore();
  const ws = store.byWorkspace[workspace];
  if (!ws) return {};
  const out: Record<string, ExecutionOutcomeMapValue> = {};
  for (const [key, record] of Object.entries(ws.latestByKey)) {
    const unscoped = key.startsWith(`${workspace}:`) ? key.slice(workspace.length + 1) : key;
    out[unscoped] = {
      status: record.outcomeStatus,
      contacted: record.outcomeStatus !== "Not Contacted",
      interested: ["Interested", "Qualified", "Proposal Sent", "Closed Won"].includes(record.outcomeStatus),
      followupNeeded: record.outcomeStatus === "Follow Up",
      nextFollowupDate: record.nextActionDate,
      notes: typeof record.metadata.notes === "string" ? record.metadata.notes : "",
      estimatedValue: record.estimatedValue,
      lastActionAt: record.occurredAt,
      attributionSource: "Meridian",
    };
  }
  return out;
}
