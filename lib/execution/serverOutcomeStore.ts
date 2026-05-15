// Meridian — durable execution outcome store.
//
// Public API remains stable while Phase 1 can route authority to file,
// dual-write, or Neon via MERIDIAN_TRUTH_STORE.

import type { ExecutionOutcomeStatus } from "./executionOutcome";
import {
  dbReadFallbackEnabled,
  dualWriteStrict,
  getTruthStoreMode,
} from "@/lib/truth/types";
import { logDualWrite, timed } from "@/lib/truth/dualWriteLogger";
import {
  findTerminalDurableOutcomeInFile,
  listDurableOutcomesFromFile,
  loadDurableOutcomeMapFromFile,
  recordDurableOutcomeToFile,
} from "./executionOutcomeFileAdapter";
import {
  findTerminalDurableOutcomeInNeon,
  listDurableOutcomesFromNeon,
  loadDurableOutcomeMapFromNeon,
  recordDurableOutcomeToNeon,
} from "./executionOutcomeNeonAdapter";
import {
  crmStatusForOutcome,
  isDurableOutcomeStatusValue,
  isTerminalDurableOutcomeStatusValue,
} from "./durableOutcomeShared";

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

export { crmStatusForOutcome };

export function isDurableOutcomeStatus(value: unknown): value is DurableOutcomeStatus {
  return isDurableOutcomeStatusValue(value);
}

export function isTerminalDurableOutcomeStatus(status: string | null | undefined): boolean {
  return isTerminalDurableOutcomeStatusValue(status);
}

type RecordResult = {
  outcome: DurableExecutionOutcome;
  persisted: boolean;
  crmUpdated: boolean;
  duplicate: boolean;
};

function mergeOutcomeMaps(
  fileMap: Record<string, ExecutionOutcomeMapValue>,
  neonMap: Record<string, ExecutionOutcomeMapValue>,
): Record<string, ExecutionOutcomeMapValue> {
  return { ...fileMap, ...neonMap };
}

function mergeOutcomeLists(
  fileRows: DurableExecutionOutcome[],
  neonRows: DurableExecutionOutcome[],
): DurableExecutionOutcome[] {
  const byEvent = new Map<string, DurableExecutionOutcome>();
  for (const row of fileRows) byEvent.set(row.eventId, row);
  for (const row of neonRows) byEvent.set(row.eventId, row);
  return Array.from(byEvent.values()).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export async function recordDurableOutcome(input: DurableOutcomeInput): Promise<RecordResult> {
  const mode = getTruthStoreMode();
  if (mode === "file") return recordDurableOutcomeToFile(input);

  if (mode === "neon") return recordDurableOutcomeToNeon(input);

  // dual mode — Neon authoritative, file best-effort shadow.
  // Behavior is unchanged from prior dual mode; logging added so the soak
  // is observable with `grep '[truth-store] dual_write'`.
  const identityKey = input.companyKey ?? input.crmKey ?? input.leadId ?? input.taskId ?? null;
  let neonOutcome: "ok" | "fail" = "fail";
  let fileOutcome: "ok" | "fail" | "skip" = "skip";
  let neonMs: number | null = null;
  let fileMs: number | null = null;
  let neonError: string | null = null;
  let fileError: string | null = null;
  try {
    const { result: neonResult, ms } = await timed(() => recordDurableOutcomeToNeon(input));
    neonOutcome = "ok";
    neonMs = ms;
    try {
      const filePromise = timed(() => recordDurableOutcomeToFile(input, { syncCrm: false }));
      const { ms: fms } = await filePromise;
      fileOutcome = "ok";
      fileMs = fms;
    } catch (fileErr) {
      fileOutcome = "fail";
      fileError = fileErr instanceof Error ? fileErr.message : "unknown";
      console.error("[serverOutcomeStore] dual file write failed", fileErr);
    }
    logDualWrite({
      surface: "execution_outcome",
      neon: neonOutcome,
      file: fileOutcome,
      neonMs,
      fileMs,
      workspace: input.workspace,
      identityKey,
      fileError,
    });
    return neonResult;
  } catch (err) {
    neonError = err instanceof Error ? err.message : "unknown";
    console.error("[serverOutcomeStore] dual Neon write failed", err);
    const { result: fileResult, ms } = await timed(() => recordDurableOutcomeToFile(input));
    fileOutcome = "ok";
    fileMs = ms;
    logDualWrite({
      surface: "execution_outcome",
      neon: "fail",
      file: fileOutcome,
      neonMs,
      fileMs,
      workspace: input.workspace,
      identityKey,
      neonError,
    });
    if (dualWriteStrict()) return { ...fileResult, persisted: false, crmUpdated: false };
    return fileResult;
  }
}

export async function findTerminalDurableOutcome(
  workspace: string,
  identityKeysInput: Array<string | null | undefined>,
): Promise<DurableExecutionOutcome | null> {
  const mode = getTruthStoreMode();
  if (mode === "file") return findTerminalDurableOutcomeInFile(workspace, identityKeysInput);

  try {
    const neonHit = await findTerminalDurableOutcomeInNeon(workspace, identityKeysInput);
    if (neonHit || !dbReadFallbackEnabled()) return neonHit;
  } catch (err) {
    if (!dbReadFallbackEnabled()) throw err;
    console.error("[serverOutcomeStore] Neon terminal lookup failed; falling back to file", err);
  }
  return findTerminalDurableOutcomeInFile(workspace, identityKeysInput);
}

export async function listDurableOutcomes(workspace: string): Promise<DurableExecutionOutcome[]> {
  const mode = getTruthStoreMode();
  if (mode === "file") return listDurableOutcomesFromFile(workspace);

  try {
    const neonRows = await listDurableOutcomesFromNeon(workspace);
    if (!dbReadFallbackEnabled()) return neonRows;
    const fileRows = await listDurableOutcomesFromFile(workspace);
    return mergeOutcomeLists(fileRows, neonRows);
  } catch (err) {
    if (!dbReadFallbackEnabled()) throw err;
    console.error("[serverOutcomeStore] Neon outcome list failed; falling back to file", err);
    return listDurableOutcomesFromFile(workspace);
  }
}

export async function loadDurableOutcomeMap(workspace: string): Promise<Record<string, ExecutionOutcomeMapValue>> {
  const mode = getTruthStoreMode();
  if (mode === "file") return loadDurableOutcomeMapFromFile(workspace);

  try {
    const neonMap = await loadDurableOutcomeMapFromNeon(workspace);
    if (!dbReadFallbackEnabled()) return neonMap;
    const fileMap = await loadDurableOutcomeMapFromFile(workspace);
    return mergeOutcomeMaps(fileMap, neonMap);
  } catch (err) {
    if (!dbReadFallbackEnabled()) throw err;
    console.error("[serverOutcomeStore] Neon outcome map failed; falling back to file", err);
    return loadDurableOutcomeMapFromFile(workspace);
  }
}
