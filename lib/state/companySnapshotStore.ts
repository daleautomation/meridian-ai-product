// Meridian AI — file-based company snapshot persistence.
//
// JSON file at data/companySnapshots.json keyed by companyKey() (see
// lib/mcp/types.ts). Mirrors the atomic-write pattern used by alertStore
// and negotiationStore.
//
// Phase 1 seeded: latest/history per tool.
// Phase 2 extends (additive, backwards-compatible):
//   - profile       canonical company record (survives inspector drift)
//   - status        current pipeline status + statusHistory
//   - notes         operator/sales notes (append-only)
//   - scoreHistory  opportunity level + confidence over time — auto-appended
//                   when a generate_opportunity_summary result is recorded
//   - lastCheckedAt timestamp of the most recent inspection
//
// All new fields are optional. Reads coerce missing values to safe defaults
// so any snapshot written in Phase 1 keeps working untouched.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { CompanyRef, ToolResult } from "@/lib/mcp/types";
import { companyKey } from "@/lib/mcp/types";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { ContactResolution } from "@/lib/contacts/types";

// ── Schema ──────────────────────────────────────────────────────────────

export type CompanyProfile = {
  name: string;
  domain?: string;
  url?: string;
  location?: string;
  placeId?: string;
  canonicalizedAt: string;   // ISO — last time profile fields were upserted
};

export type CompanyNote = {
  id: string;
  author: string;            // userId or "system"
  body: string;
  createdAt: string;         // ISO
  tags?: string[];
};

export type StatusChange = {
  status: string;            // e.g. "NEW" | "CONTACTED" | "QUALIFIED" | "PITCHED" | "CLOSED_WON" | "CLOSED_LOST" | "ARCHIVED"
  changedAt: string;         // ISO
  changedBy: string;         // userId or "system"
  note?: string;
};

export type ScorePoint = {
  at: string;                // ISO — when this score was observed
  opportunityLevel: "HIGH" | "MEDIUM" | "LOW";
  confidence: number;        // 0–100
  recommendedAction: string; // mirrors the summary tool's output
  sourceTool: string;        // which tool produced it (auditability)
};

export type DealAction = {
  type: string;               // e.g. "call", "email", "voicemail", "meeting", "follow_up"
  outcome?: string;           // e.g. "connected", "no_answer", "left_vm", "interested", "not_interested"
  note?: string;
  performedBy: string;
  performedAt: string;        // ISO
};

export type CompanySnapshot = {
  key: string;
  company: CompanyRef;
  createdAt: string;
  updatedAt: string;
  latest: Record<string, ToolResult<unknown>>;
  history: Array<{ tool: string; timestamp: string; result: ToolResult<unknown> }>;
  // ── Phase 2 additive fields ──
  profile?: CompanyProfile;
  status?: string;
  statusHistory?: StatusChange[];
  notes?: CompanyNote[];
  scoreHistory?: ScorePoint[];
  lastCheckedAt?: string;
  // ── Phase 3: deal pipeline fields ──
  lastAction?: DealAction;
  nextAction?: string;        // e.g. "call", "follow_up_email", "send_proposal"
  nextActionDate?: string;    // ISO date
  contactName?: string;       // primary contact at the company
  contactPhone?: string;
  contactEmail?: string;
  dealActions?: DealAction[];  // full action history
  // ── Phase 4: call attempt tracking ──
  callAttempts?: number;
  consecutiveNoAnswers?: number;
  lastAttemptType?: string;
  lastAttemptOutcome?: string;
  escalationStage?: number;   // 0=fresh, 1=first try, 2=second, 3=voicemail+email, 4=deprioritize
  // ── Phase 5: durable contact resolution ──
  // Full ContactResolution payload from the most recent resolveContact run,
  // persisted so first-render UI has real contact paths without a live call.
  // Operator-curated contactPhone / contactEmail / contactName remain
  // authoritative — resolver output is a supplement, not an override.
  contactResolution?: ContactResolution;
  contactResolutionCheckedAt?: string;  // ISO — when resolveContact last ran
  // ── Phase 6: explicit manual override block ──
  // Operator-entered overrides. When present these win over everything —
  // resolver output, contactResolution, and the legacy contactPhone/Email
  // fields. The legacy fields are kept as a soft cache (they may equal the
  // preferred value). Clearing a preferred* field returns control to the
  // resolver.
  preferredPhone?: string;
  preferredEmail?: string;
  preferredContactName?: string;
  preferredContactRole?: string;
  preferredContactSource?: string;
  contactNotes?: string;
  preferredUpdatedAt?: string;         // ISO — when overrides were last set
  preferredUpdatedBy?: string;         // userId or "system"
  // ── Phase 11: trade + service bucket classification ──
  // Optional; when absent the UI falls back to TRADE_DEFAULT ("roofing").
  // Keys match lib/modules/trades.ts. Stored as plain strings to keep
  // the snapshot store decoupled from the module types.
  trade?: string;
  serviceBucket?: string;
};

const STORE_PATH = path.join(process.cwd(), "data", "companySnapshots.json");
const MAX_HISTORY_PER_TOOL = 20;
const MAX_SCORE_HISTORY = 100;
const MAX_STATUS_HISTORY = 50;

// In-process serializer. batch_inspect runs multiple workers that each call
// recordToolResult several times; chained promises keep read-modify-write
// pairs from clobbering the temp file during rename.
let writeQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

// ── IO ──────────────────────────────────────────────────────────────────

async function readAll(): Promise<Record<string, CompanySnapshot>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, CompanySnapshot>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[companySnapshotStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, CompanySnapshot>): Promise<void> {
  await safeWriteJson(STORE_PATH, data);
}

// ── Internal helpers ────────────────────────────────────────────────────

function ensureShape(snap: CompanySnapshot): CompanySnapshot {
  // Normalize any snapshot read from disk so new fields are present.
  return {
    ...snap,
    statusHistory: snap.statusHistory ?? [],
    notes: snap.notes ?? [],
    scoreHistory: snap.scoreHistory ?? [],
  };
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

type SummaryData = {
  opportunityLevel?: "HIGH" | "MEDIUM" | "LOW";
  recommendedAction?: string;
};

function maybeAppendScorePoint(
  snap: CompanySnapshot,
  result: ToolResult<unknown>
): void {
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

// ── Public API: Phase 1 (unchanged signatures) ──────────────────────────

export async function getSnapshot(company: CompanyRef): Promise<CompanySnapshot | null> {
  const all = await readAll();
  const hit = all[companyKey(company)];
  return hit ? ensureShape(hit) : null;
}

export async function listSnapshots(): Promise<CompanySnapshot[]> {
  const all = await readAll();
  return Object.values(all)
    .map(ensureShape)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function recordToolResult<T>(
  company: CompanyRef,
  result: ToolResult<T>
): Promise<CompanySnapshot> {
  return serialize(() => recordToolResultUnsafe(company, result));
}

async function recordToolResultUnsafe<T>(
  company: CompanyRef,
  result: ToolResult<T>
): Promise<CompanySnapshot> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : null;

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

  all[key] = snap;
  await writeAll(all);
  return snap;
}

// ── Public API: Phase 2 additive ────────────────────────────────────────

export async function upsertProfile(
  company: CompanyRef,
  profile: Partial<Omit<CompanyProfile, "canonicalizedAt">>
): Promise<CompanySnapshot> {
  return serialize(() => upsertProfileUnsafe(company, profile));
}

async function upsertProfileUnsafe(
  company: CompanyRef,
  profile: Partial<Omit<CompanyProfile, "canonicalizedAt">>
): Promise<CompanySnapshot> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  const nextProfile: CompanyProfile = {
    name: profile.name ?? existing.profile?.name ?? company.name,
    domain: profile.domain ?? existing.profile?.domain ?? company.domain,
    url: profile.url ?? existing.profile?.url ?? company.url,
    location: profile.location ?? existing.profile?.location ?? company.location,
    placeId: profile.placeId ?? existing.profile?.placeId ?? company.placeId,
    canonicalizedAt: now,
  };

  const next: CompanySnapshot = {
    ...existing,
    company: { ...existing.company, ...company },
    profile: nextProfile,
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return next;
}

export async function addNote(
  company: CompanyRef,
  note: { author: string; body: string; tags?: string[] }
): Promise<{ snapshot: CompanySnapshot; note: CompanyNote }> {
  return serialize(() => addNoteUnsafe(company, note));
}

async function addNoteUnsafe(
  company: CompanyRef,
  note: { author: string; body: string; tags?: string[] }
): Promise<{ snapshot: CompanySnapshot; note: CompanyNote }> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  const entry: CompanyNote = {
    id: crypto.randomUUID(),
    author: note.author,
    body: note.body,
    createdAt: now,
    tags: note.tags,
  };

  const next: CompanySnapshot = {
    ...existing,
    notes: [...(existing.notes ?? []), entry],
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return { snapshot: next, note: entry };
}

export async function setStatus(
  company: CompanyRef,
  change: { status: string; changedBy: string; note?: string }
): Promise<{ snapshot: CompanySnapshot; change: StatusChange }> {
  return serialize(() => setStatusUnsafe(company, change));
}

async function setStatusUnsafe(
  company: CompanyRef,
  change: { status: string; changedBy: string; note?: string }
): Promise<{ snapshot: CompanySnapshot; change: StatusChange }> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  const entry: StatusChange = {
    status: change.status,
    changedAt: now,
    changedBy: change.changedBy,
    note: change.note,
  };

  const history = [...(existing.statusHistory ?? []), entry].slice(-MAX_STATUS_HISTORY);

  const next: CompanySnapshot = {
    ...existing,
    status: change.status,
    statusHistory: history,
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return { snapshot: next, change: entry };
}

// ── Phase 3: deal pipeline actions ─────────────────────────────────────

const MAX_DEAL_ACTIONS = 100;

export async function logDealAction(
  company: CompanyRef,
  action: Omit<DealAction, "performedAt"> & { performedAt?: string }
): Promise<{ snapshot: CompanySnapshot; action: DealAction }> {
  return serialize(() => logDealActionUnsafe(company, action));
}

async function logDealActionUnsafe(
  company: CompanyRef,
  action: Omit<DealAction, "performedAt"> & { performedAt?: string }
): Promise<{ snapshot: CompanySnapshot; action: DealAction }> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  const entry: DealAction = {
    type: action.type,
    outcome: action.outcome,
    note: action.note,
    performedBy: action.performedBy,
    performedAt: action.performedAt ?? now,
  };

  // Call attempt tracking
  const isCallAttempt = ["call", "voicemail"].includes(action.type);
  const callAttempts = (existing.callAttempts ?? 0) + (isCallAttempt ? 1 : 0);
  const isNoAnswer = action.outcome === "no_answer" || action.outcome === "left_vm";
  const consecutiveNoAnswers = isNoAnswer
    ? (existing.consecutiveNoAnswers ?? 0) + 1
    : (action.outcome === "connected" || action.outcome === "interested") ? 0 : (existing.consecutiveNoAnswers ?? 0);

  // Escalation stage: auto-advance based on consecutive no-answers
  let escalationStage = existing.escalationStage ?? 0;
  if (isCallAttempt) {
    if (consecutiveNoAnswers === 0) escalationStage = 0;
    else if (consecutiveNoAnswers === 1) escalationStage = 1;
    else if (consecutiveNoAnswers === 2) escalationStage = 2;
    else if (consecutiveNoAnswers === 3) escalationStage = 3;
    else escalationStage = 4;
  }

  const next: CompanySnapshot = {
    ...existing,
    lastAction: entry,
    dealActions: [...(existing.dealActions ?? []), entry].slice(-MAX_DEAL_ACTIONS),
    callAttempts,
    consecutiveNoAnswers,
    lastAttemptType: isCallAttempt ? action.type : (existing.lastAttemptType ?? undefined),
    lastAttemptOutcome: isCallAttempt ? action.outcome : (existing.lastAttemptOutcome ?? undefined),
    escalationStage,
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return { snapshot: next, action: entry };
}

// ── Phase 5: contact resolution persistence ────────────────────────────
// Stores the full ContactResolution payload from resolveContact() so first
// render has real contact data without another round trip. Also lifts the
// best phone/email into the legacy contactPhone/Email fields, but ONLY if
// those fields are empty — operator-curated values always win.

export async function upsertContactResolution(
  company: CompanyRef,
  resolution: ContactResolution,
): Promise<CompanySnapshot> {
  return serialize(() => upsertContactResolutionUnsafe(company, resolution));
}

async function upsertContactResolutionUnsafe(
  company: CompanyRef,
  resolution: ContactResolution,
): Promise<CompanySnapshot> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  // Lift into legacy contactPhone/Email fields only when no operator value
  // is already stored. Matches the project rule that operator-curated data
  // is authoritative.
  const resolvedPhone = resolution.phone ?? undefined;
  const resolvedEmail = resolution.email ?? undefined;
  // `resolution.contactName` is the enriched person-level name (Hunter,
  // site-derived, etc.). `matchedName` is the business entity and must
  // never be backfilled into the person slot — otherwise "Acme Roofing
  // LLC" ends up rendered as the contact person on the UI.
  const resolvedPersonName = resolution.contactName ?? undefined;

  const next: CompanySnapshot = {
    ...existing,
    company: { ...existing.company, ...company },
    contactResolution: resolution,
    contactResolutionCheckedAt: resolution.lastCheckedAt ?? now,
    contactPhone: existing.contactPhone ?? resolvedPhone,
    contactEmail: existing.contactEmail ?? resolvedEmail,
    contactName: existing.contactName ?? resolvedPersonName,
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return next;
}

// ── Phase 6: manual contact overrides ──────────────────────────────────
// Operator-entered values that take precedence over resolver output. Only
// fields present in `update` are changed; pass an empty string ("") to
// clear a field and return that slot to resolver control.

export type ContactPreferencesUpdate = {
  preferredPhone?: string;
  preferredEmail?: string;
  preferredContactName?: string;
  preferredContactRole?: string;
  preferredContactSource?: string;
  contactNotes?: string;
  performedBy: string;
};

export async function setContactPreferences(
  company: CompanyRef,
  update: ContactPreferencesUpdate,
): Promise<CompanySnapshot> {
  return serialize(() => setContactPreferencesUnsafe(company, update));
}

async function setContactPreferencesUnsafe(
  company: CompanyRef,
  update: ContactPreferencesUpdate,
): Promise<CompanySnapshot> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  // Treat empty strings as "clear this field" so operators can remove an
  // override without touching the JSON.
  const merge = <T extends string | undefined>(incoming: T, current: T): T => {
    if (incoming === undefined) return current;
    if (incoming === "") return undefined as T;
    return incoming;
  };

  const next: CompanySnapshot = {
    ...existing,
    company: { ...existing.company, ...company },
    preferredPhone: merge(update.preferredPhone, existing.preferredPhone),
    preferredEmail: merge(update.preferredEmail, existing.preferredEmail),
    preferredContactName: merge(update.preferredContactName, existing.preferredContactName),
    preferredContactRole: merge(update.preferredContactRole, existing.preferredContactRole),
    preferredContactSource: merge(update.preferredContactSource, existing.preferredContactSource),
    contactNotes: merge(update.contactNotes, existing.contactNotes),
    preferredUpdatedAt: now,
    preferredUpdatedBy: update.performedBy,
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return next;
}

export async function setNextAction(
  company: CompanyRef,
  update: { nextAction: string; nextActionDate?: string; contactName?: string; contactPhone?: string; contactEmail?: string }
): Promise<CompanySnapshot> {
  return serialize(() => setNextActionUnsafe(company, update));
}

async function setNextActionUnsafe(
  company: CompanyRef,
  update: { nextAction: string; nextActionDate?: string; contactName?: string; contactPhone?: string; contactEmail?: string }
): Promise<CompanySnapshot> {
  const all = await readAll();
  const key = companyKey(company);
  const now = new Date().toISOString();
  const existing = all[key] ? ensureShape(all[key]) : freshSnapshot(company, now);

  const next: CompanySnapshot = {
    ...existing,
    nextAction: update.nextAction,
    nextActionDate: update.nextActionDate,
    contactName: update.contactName ?? existing.contactName,
    contactPhone: update.contactPhone ?? existing.contactPhone,
    contactEmail: update.contactEmail ?? existing.contactEmail,
    updatedAt: now,
  };

  all[key] = next;
  await writeAll(all);
  return next;
}
