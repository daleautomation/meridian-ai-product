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
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
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
