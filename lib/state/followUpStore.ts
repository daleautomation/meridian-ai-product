// Meridian AI — Follow-up Task Store.
//
// The lead_tasks side of the embedded CRM. Persists scheduled follow-up
// actions (call, email, case study send, pricing send, custom) per lead
// so the rep never has to remember what to do next.
//
// Activities are recorded separately in crmStore (source of truth for
// execution history). This store is the source of truth for *intent* —
// "what still needs to happen". The two are linked via companyKey; each
// task resolution also emits a CRM activity via the MCP tool layer.
//
// Storage: data/followUps.json keyed by companyKey.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";

// ── Types ──────────────────────────────────────────────────────────────

export type FollowUpTaskType =
  | "follow_up_call"
  | "follow_up_email"
  | "send_case_study"
  | "send_pricing"
  | "custom";

export type FollowUpStatus = "open" | "completed" | "cancelled";

export type FollowUpTask = {
  id: string;
  companyKey: string;
  companyName: string;
  taskType: FollowUpTaskType;
  title: string;
  description?: string;
  dueAt?: string;           // ISO datetime — optional (tasks may be unscheduled)
  status: FollowUpStatus;
  assignedUserId?: string;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
  completedBy?: string;
};

// ── Store ──────────────────────────────────────────────────────────────

const STORE_PATH = path.join(process.cwd(), "data", "followUps.json");

let writeQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => {});
  return next;
}

type StoreShape = Record<string, FollowUpTask[]>; // keyed by companyKey

async function readAll(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as StoreShape;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[followUpStore] read failed", e);
    return {};
  }
}

async function writeAll(data: StoreShape): Promise<void> {
  await safeWriteJson(STORE_PATH, data);
}

// ── Public API ─────────────────────────────────────────────────────────

export async function createFollowUp(
  input: Omit<FollowUpTask, "id" | "status" | "createdAt">
): Promise<FollowUpTask> {
  return serialize(async () => {
    const all = await readAll();
    const task: FollowUpTask = {
      ...input,
      id: crypto.randomUUID(),
      status: "open",
      createdAt: new Date().toISOString(),
    };
    const list = all[task.companyKey] ?? [];
    list.push(task);
    all[task.companyKey] = list;
    await writeAll(all);
    return task;
  });
}

export async function completeFollowUp(
  taskId: string,
  completedBy: string
): Promise<FollowUpTask | null> {
  return serialize(async () => {
    const all = await readAll();
    for (const key of Object.keys(all)) {
      const list = all[key];
      const idx = list.findIndex((t) => t.id === taskId);
      if (idx === -1) continue;
      const task = list[idx];
      if (task.status === "completed") return task;
      const updated: FollowUpTask = {
        ...task,
        status: "completed",
        completedAt: new Date().toISOString(),
        completedBy,
      };
      list[idx] = updated;
      await writeAll(all);
      return updated;
    }
    return null;
  });
}

export async function cancelFollowUp(
  taskId: string,
  cancelledBy: string
): Promise<FollowUpTask | null> {
  return serialize(async () => {
    const all = await readAll();
    for (const key of Object.keys(all)) {
      const list = all[key];
      const idx = list.findIndex((t) => t.id === taskId);
      if (idx === -1) continue;
      const task = list[idx];
      if (task.status !== "open") return task;
      const updated: FollowUpTask = {
        ...task,
        status: "cancelled",
        completedAt: new Date().toISOString(),
        completedBy: cancelledBy,
      };
      list[idx] = updated;
      await writeAll(all);
      return updated;
    }
    return null;
  });
}

export async function getFollowUpsByCompany(companyKey: string): Promise<FollowUpTask[]> {
  const all = await readAll();
  return (all[companyKey] ?? []).slice().sort((a, b) => {
    // Open tasks first, sorted by dueAt ascending (unscheduled last)
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const ad = a.dueAt ?? "";
    const bd = b.dueAt ?? "";
    if (!ad && !bd) return a.createdAt.localeCompare(b.createdAt);
    if (!ad) return 1;
    if (!bd) return -1;
    return ad.localeCompare(bd);
  });
}

export async function getOpenFollowUpsByUser(userId: string): Promise<FollowUpTask[]> {
  const all = await readAll();
  const out: FollowUpTask[] = [];
  for (const list of Object.values(all)) {
    for (const t of list) {
      if (t.status === "open" && t.assignedUserId === userId) out.push(t);
    }
  }
  out.sort((a, b) => (a.dueAt ?? "￿").localeCompare(b.dueAt ?? "￿"));
  return out;
}

export async function getFollowUpsDueWithin(
  sinceIso: string,
  untilIso: string,
  opts?: { assignedUserId?: string }
): Promise<FollowUpTask[]> {
  const all = await readAll();
  const out: FollowUpTask[] = [];
  for (const list of Object.values(all)) {
    for (const t of list) {
      if (t.status !== "open") continue;
      if (!t.dueAt) continue;
      if (t.dueAt < sinceIso || t.dueAt > untilIso) continue;
      if (opts?.assignedUserId && t.assignedUserId !== opts.assignedUserId) continue;
      out.push(t);
    }
  }
  out.sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  return out;
}

export async function getFollowUpById(taskId: string): Promise<FollowUpTask | null> {
  const all = await readAll();
  for (const list of Object.values(all)) {
    const hit = list.find((t) => t.id === taskId);
    if (hit) return hit;
  }
  return null;
}
