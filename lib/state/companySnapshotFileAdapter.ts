import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { CompanyRef, ToolResult } from "@/lib/mcp/types";
import { companyKey } from "@/lib/mcp/types";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { ContactResolution } from "@/lib/contacts/types";
import type {
  CompanyNote,
  CompanyProfile,
  CompanySnapshot,
  ContactPreferencesUpdate,
  DealAction,
  PaidPresence,
  PaidPresenceOverride,
  StatusChange,
} from "./companySnapshotStore";

const STORE_PATH = path.join(process.cwd(), "data", "companySnapshots.json");
const MAX_HISTORY_PER_TOOL = 20;
const MAX_SCORE_HISTORY = 100;
const MAX_STATUS_HISTORY = 50;
const MAX_DEAL_ACTIONS = 100;

let writeQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

async function readAll(): Promise<Record<string, CompanySnapshot>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, CompanySnapshot>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[companySnapshotFileAdapter] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, CompanySnapshot>): Promise<void> {
  await safeWriteJson(STORE_PATH, data);
}

export function ensureCompanySnapshotShape(snap: CompanySnapshot): CompanySnapshot {
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

function maybeAppendScorePoint(snap: CompanySnapshot, result: ToolResult<unknown>): void {
  // AI-authored summaries are narrative artifacts only; never persist them as
  // score history because scoreHistory is consumed as operational truth.
  if (result.tool !== "generate_opportunity_summary") return;
  snap.scoreHistory = [...(snap.scoreHistory ?? [])].slice(-MAX_SCORE_HISTORY);
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

export async function getSnapshotFromFile(company: CompanyRef): Promise<CompanySnapshot | null> {
  const all = await readAll();
  const hit = all[companyKey(company)];
  return hit ? ensureCompanySnapshotShape(hit) : null;
}

export async function listSnapshotsFromFile(): Promise<CompanySnapshot[]> {
  const all = await readAll();
  return Object.values(all)
    .map(ensureCompanySnapshotShape)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function upsertSnapshotToFile(snapshot: CompanySnapshot): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    all[snapshot.key] = ensureCompanySnapshotShape(snapshot);
    await writeAll(all);
    return all[snapshot.key];
  });
}

export async function recordToolResultToFile<T>(
  company: CompanyRef,
  result: ToolResult<T>,
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : null;

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
  });
}

export async function upsertProfileToFile(
  company: CompanyRef,
  profile: Partial<Omit<CompanyProfile, "canonicalizedAt">>,
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);

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
  });
}

export async function addNoteToFile(
  company: CompanyRef,
  note: { author: string; body: string; tags?: string[] },
): Promise<{ snapshot: CompanySnapshot; note: CompanyNote }> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
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
  });
}

export async function setStatusToFile(
  company: CompanyRef,
  change: { status: string; changedBy: string; note?: string },
): Promise<{ snapshot: CompanySnapshot; change: StatusChange }> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
    const entry: StatusChange = {
      status: change.status,
      changedAt: now,
      changedBy: change.changedBy,
      note: change.note,
    };
    const next: CompanySnapshot = {
      ...existing,
      status: change.status,
      statusHistory: [...(existing.statusHistory ?? []), entry].slice(-MAX_STATUS_HISTORY),
      updatedAt: now,
    };
    all[key] = next;
    await writeAll(all);
    return { snapshot: next, change: entry };
  });
}

export async function logDealActionToFile(
  company: CompanyRef,
  action: Omit<DealAction, "performedAt"> & { performedAt?: string },
): Promise<{ snapshot: CompanySnapshot; action: DealAction }> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
    const entry: DealAction = {
      type: action.type,
      outcome: action.outcome,
      note: action.note,
      performedBy: action.performedBy,
      performedAt: action.performedAt ?? now,
    };
    const isCallAttempt = ["call", "voicemail"].includes(action.type);
    const callAttempts = (existing.callAttempts ?? 0) + (isCallAttempt ? 1 : 0);
    const isNoAnswer = action.outcome === "no_answer" || action.outcome === "left_vm";
    const consecutiveNoAnswers = isNoAnswer
      ? (existing.consecutiveNoAnswers ?? 0) + 1
      : (action.outcome === "connected" || action.outcome === "interested") ? 0 : (existing.consecutiveNoAnswers ?? 0);
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
  });
}

export async function upsertContactResolutionToFile(
  company: CompanyRef,
  resolution: ContactResolution,
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
    const resolvedPhone = resolution.phone ?? undefined;
    const resolvedEmail = resolution.email ?? undefined;
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
  });
}

export async function upsertPaidPresenceToFile(
  company: CompanyRef,
  presence: PaidPresence,
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
    const next: CompanySnapshot = {
      ...existing,
      company: { ...existing.company, ...company },
      paidPresence: presence,
      paidPresenceCheckedAt: presence.asOf ?? now,
      updatedAt: now,
    };
    all[key] = next;
    await writeAll(all);
    return next;
  });
}

export async function setPaidPresenceOverrideToFile(
  company: CompanyRef,
  override: PaidPresenceOverride,
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
    const next: CompanySnapshot = {
      ...existing,
      company: { ...existing.company, ...company },
      paidPresenceOverride: { ...override, updatedAt: override.updatedAt ?? now },
      updatedAt: now,
    };
    all[key] = next;
    await writeAll(all);
    return next;
  });
}

export async function clearPaidPresenceOverrideFromFile(company: CompanyRef): Promise<CompanySnapshot | null> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const existing = all[key];
    if (!existing) return null;
    const { paidPresenceOverride: _drop, ...rest } = ensureCompanySnapshotShape(existing);
    void _drop;
    const next: CompanySnapshot = { ...rest, updatedAt: new Date().toISOString() };
    all[key] = next;
    await writeAll(all);
    return next;
  });
}

export async function setContactPreferencesToFile(
  company: CompanyRef,
  update: ContactPreferencesUpdate,
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
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
  });
}

export async function setNextActionToFile(
  company: CompanyRef,
  update: { nextAction: string; nextActionDate?: string; contactName?: string; contactPhone?: string; contactEmail?: string },
): Promise<CompanySnapshot> {
  return serialize(async () => {
    const all = await readAll();
    const key = companyKey(company);
    const now = new Date().toISOString();
    const existing = all[key] ? ensureCompanySnapshotShape(all[key]) : freshSnapshot(company, now);
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
  });
}
