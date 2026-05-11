// Meridian — Lightweight Execution Outcome layer.
//
// Captures what happened after a lead was worked. Client-side only;
// localStorage persistence keyed by stable task id. Designed for the
// 7-day field test + the commission attribution conversation, NOT
// for full CRM functionality.
//
// Rules:
//   • One canonical type, one canonical map. No schemas, no migrations.
//   • Never mutates the lead or task object directly — outcome is
//     read-merged into the operator view.
//   • SSR-safe (every storage call is guarded).
//   • Versioned key so a future server move is a one-time export.

export type ExecutionOutcomeStatus =
  | "Not Contacted"
  | "Called"
  | "Interested"
  | "Follow Up"
  | "Qualified"
  | "Proposal Sent"
  | "Closed Won"
  | "Closed Lost"
  | "Not Qualified";

export interface ExecutionOutcome {
  status: ExecutionOutcomeStatus;
  contacted: boolean;
  interested: boolean;
  followupNeeded: boolean;
  nextFollowupDate: string | null;
  notes: string;
  estimatedValue: number | null;
  lastActionAt: string | null;
  attributionSource: "Meridian" | "Manual" | "Unknown";
}

export const EXECUTION_OUTCOME_STORAGE_KEY = "meridian.executionOutcomes.v1";
export const EXECUTION_OUTCOME_CHANGED_EVENT = "meridian:executionOutcomesChanged";

export const EXECUTION_OUTCOME_STATUSES: ExecutionOutcomeStatus[] = [
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

export function getDefaultExecutionOutcome(): ExecutionOutcome {
  return {
    status: "Not Contacted",
    contacted: false,
    interested: false,
    followupNeeded: false,
    nextFollowupDate: null,
    notes: "",
    estimatedValue: null,
    lastActionAt: null,
    attributionSource: "Meridian",
  };
}

export function normalizeExecutionOutcome(input: unknown): ExecutionOutcome {
  const base = getDefaultExecutionOutcome();
  if (!input || typeof input !== "object") return base;
  const o = input as Partial<ExecutionOutcome>;
  const status = EXECUTION_OUTCOME_STATUSES.includes(o.status as ExecutionOutcomeStatus)
    ? (o.status as ExecutionOutcomeStatus)
    : base.status;
  return {
    status,
    contacted: typeof o.contacted === "boolean" ? o.contacted : status !== "Not Contacted",
    interested: typeof o.interested === "boolean" ? o.interested : status === "Interested",
    followupNeeded: typeof o.followupNeeded === "boolean" ? o.followupNeeded : status === "Follow Up",
    nextFollowupDate: typeof o.nextFollowupDate === "string" ? o.nextFollowupDate : null,
    notes: typeof o.notes === "string" ? o.notes : "",
    estimatedValue: typeof o.estimatedValue === "number" && Number.isFinite(o.estimatedValue) ? o.estimatedValue : null,
    lastActionAt: typeof o.lastActionAt === "string" ? o.lastActionAt : null,
    attributionSource:
      o.attributionSource === "Meridian" || o.attributionSource === "Manual" || o.attributionSource === "Unknown"
        ? o.attributionSource
        : "Meridian",
  };
}

export function updateExecutionOutcome(
  current: ExecutionOutcome | null | undefined,
  patch: Partial<ExecutionOutcome>,
): ExecutionOutcome {
  const base = current ? normalizeExecutionOutcome(current) : getDefaultExecutionOutcome();
  const merged = { ...base, ...patch };
  // Cohesion rules — keep the contacted/interested/followupNeeded
  // booleans aligned with the status when only the status changes.
  if (patch.status && patch.contacted === undefined) {
    merged.contacted = patch.status !== "Not Contacted";
  }
  if (patch.status && patch.interested === undefined) {
    merged.interested = patch.status === "Interested" || patch.status === "Qualified" || patch.status === "Proposal Sent" || patch.status === "Closed Won";
  }
  if (patch.status && patch.followupNeeded === undefined) {
    merged.followupNeeded = patch.status === "Follow Up";
  }
  // Stamp lastActionAt on any write — caller can override by passing
  // an explicit value in the patch.
  if (patch.lastActionAt === undefined) {
    merged.lastActionAt = new Date().toISOString();
  }
  return normalizeExecutionOutcome(merged);
}

// ── localStorage helpers ────────────────────────────────────────────

function readMap(): Record<string, ExecutionOutcome> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXECUTION_OUTCOME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ExecutionOutcome> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && k.length > 0) {
        out[k] = normalizeExecutionOutcome(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, ExecutionOutcome>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EXECUTION_OUTCOME_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(EXECUTION_OUTCOME_CHANGED_EVENT));
  } catch {
    /* quota exceeded / private mode — fail silently */
  }
}

export function loadExecutionOutcome(taskId: string | null | undefined): ExecutionOutcome | null {
  if (!taskId) return null;
  const map = readMap();
  return map[taskId] ?? null;
}

function compactKeys(keys: Array<string | null | undefined>): string[] {
  return Array.from(new Set(keys.filter((key): key is string => typeof key === "string" && key.trim().length > 0)));
}

export function resolveExecutionOutcome(
  map: Record<string, ExecutionOutcome>,
  taskId: string | null | undefined,
  identityKeys: Array<string | null | undefined> = [],
): ExecutionOutcome | null {
  for (const key of compactKeys([taskId, ...identityKeys])) {
    if (map[key]) return map[key];
  }
  return null;
}

export function loadExecutionOutcomeByIdentity(
  taskId: string | null | undefined,
  identityKeys: Array<string | null | undefined> = [],
): ExecutionOutcome | null {
  const map = readMap();
  return resolveExecutionOutcome(map, taskId, identityKeys);
}

export function loadAllExecutionOutcomes(): Record<string, ExecutionOutcome> {
  return readMap();
}

export function saveExecutionOutcome(
  taskId: string,
  outcome: ExecutionOutcome,
  identityKeys: Array<string | null | undefined> = [],
): void {
  if (!taskId) return;
  const map = readMap();
  const normalized = normalizeExecutionOutcome(outcome);
  for (const key of compactKeys([taskId, ...identityKeys])) {
    map[key] = normalized;
  }
  writeMap(map);
}

export function clearExecutionOutcome(taskId: string): void {
  if (!taskId) return;
  const map = readMap();
  if (taskId in map) {
    delete map[taskId];
    writeMap(map);
  }
}
