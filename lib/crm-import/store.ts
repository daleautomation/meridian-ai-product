// Meridian CRM import — persistence for jobs, contacts, and rollback snapshots.
//
// Layered storage for serverless (Vercel): in-memory is always written first so
// preview → import works within a warm session; file writes are best-effort for
// local dev durability and are never required for the API to succeed.

import { promises as fs } from "node:fs";
import path from "node:path";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { CrmContactRecord, CrmImportJob } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_PATH = path.join(DATA_DIR, "crmImportJobs.json");
const JOBS_DIR = path.join(DATA_DIR, "crm-import-jobs");
const CONTACTS_PATH = path.join(DATA_DIR, "crmContacts.json");
const ROLLBACK_DIR = path.join(DATA_DIR, "crmImportRollbacks");

type JobsFile = { jobs: CrmImportJob[] };
type ContactsFile = { contacts: CrmContactRecord[] };

const memoryJobs = new Map<string, CrmImportJob>();
let memoryContacts: CrmContactRecord[] | null = null;
const memoryRollbacks = new Map<
  string,
  { workspaceId: string; contacts: CrmContactRecord[]; createdAt: string }
>();

let fileWritesEnabled: boolean | null = null;

function jobFilePath(jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(JOBS_DIR, `${safe}.json`);
}

function rollbackFilePath(snapshotId: string): string {
  const safe = snapshotId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(ROLLBACK_DIR, `${safe}.json`);
}

async function probeFileWrites(): Promise<boolean> {
  if (fileWritesEnabled !== null) return fileWritesEnabled;
  if (process.env.VERCEL === "1") {
    fileWritesEnabled = false;
    return false;
  }
  try {
    await fs.mkdir(JOBS_DIR, { recursive: true });
    const probe = path.join(JOBS_DIR, ".write-probe");
    await fs.writeFile(probe, "ok", "utf8");
    await fs.unlink(probe);
    fileWritesEnabled = true;
  } catch {
    fileWritesEnabled = false;
  }
  return fileWritesEnabled;
}

async function readLegacyJobs(): Promise<CrmImportJob[]> {
  const data = await safeReadJson<JobsFile>(JOBS_PATH);
  return data?.jobs ?? [];
}

async function writeLegacyJobs(jobs: CrmImportJob[]): Promise<boolean> {
  if (!(await probeFileWrites())) return false;
  return safeWriteJson(JOBS_PATH, { jobs });
}

async function readContactsFromDisk(): Promise<CrmContactRecord[]> {
  const data = await safeReadJson<ContactsFile>(CONTACTS_PATH);
  return data?.contacts ?? [];
}

function readContactsMemory(): CrmContactRecord[] {
  return memoryContacts ?? [];
}

async function readContacts(): Promise<CrmContactRecord[]> {
  if (memoryContacts !== null) return memoryContacts;
  const disk = await readContactsFromDisk();
  memoryContacts = disk;
  return disk;
}

async function writeContacts(contacts: CrmContactRecord[]): Promise<void> {
  memoryContacts = contacts;
  if (await probeFileWrites()) {
    const ok = await safeWriteJson(CONTACTS_PATH, { contacts });
    if (!ok) {
      throw new Error(
        "CRM contacts could not be saved to disk. Import data is held in memory for this session only.",
      );
    }
  }
}

export async function getImportJob(jobId: string): Promise<CrmImportJob | null> {
  const mem = memoryJobs.get(jobId);
  if (mem?.id === jobId) return mem;

  const perJob = await safeReadJson<CrmImportJob>(jobFilePath(jobId));
  if (perJob?.id === jobId) {
    memoryJobs.set(jobId, perJob);
    return perJob;
  }

  const jobs = await readLegacyJobs();
  const legacy = jobs.find((j) => j.id === jobId) ?? null;
  if (legacy) memoryJobs.set(jobId, legacy);
  return legacy;
}

export async function saveImportJob(job: CrmImportJob): Promise<void> {
  memoryJobs.set(job.id, job);

  if (!(await probeFileWrites())) return;

  try {
    await fs.mkdir(JOBS_DIR, { recursive: true });
    const ok = await safeWriteJson(jobFilePath(job.id), job);
    if (!ok) return;

    const jobs = await readLegacyJobs();
    const index = jobs.findIndex((j) => j.id === job.id);
    if (index >= 0) jobs[index] = job;
    else jobs.push(job);
    await writeLegacyJobs(jobs);
  } catch (e) {
    console.error("[crm-import] file persist skipped for job:", job.id, e);
  }
}

export async function listContactsByWorkspace(workspaceId: string): Promise<CrmContactRecord[]> {
  const contacts = await readContacts();
  return contacts.filter((c) => c.workspaceId === workspaceId);
}

export async function upsertContacts(records: CrmContactRecord[]): Promise<{ inserted: number; updated: number }> {
  const existing = await readContacts();
  const byId = new Map(existing.map((c) => [c.id, c]));
  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    if (byId.has(record.id)) {
      byId.set(record.id, record);
      updated += 1;
    } else {
      byId.set(record.id, record);
      inserted += 1;
    }
  }

  await writeContacts([...byId.values()]);
  return { inserted, updated };
}

export async function createRollbackSnapshot(workspaceId: string): Promise<string> {
  const snapshotId = `rollback-${workspaceId}-${Date.now()}`;
  const contacts = await listContactsByWorkspace(workspaceId);
  const payload = {
    workspaceId,
    contacts,
    createdAt: new Date().toISOString(),
  };
  memoryRollbacks.set(snapshotId, payload);

  if (await probeFileWrites()) {
    try {
      await fs.mkdir(ROLLBACK_DIR, { recursive: true });
      const ok = await safeWriteJson(rollbackFilePath(snapshotId), payload);
      if (!ok) {
        console.warn("[crm-import] rollback file write failed; snapshot kept in memory:", snapshotId);
      }
    } catch (e) {
      console.error("[crm-import] rollback file persist skipped:", snapshotId, e);
    }
  }

  return snapshotId;
}

export async function rollbackImport(snapshotId: string): Promise<{ restored: number }> {
  const mem = memoryRollbacks.get(snapshotId);
  const snapshot =
    mem ??
    (await safeReadJson<{ workspaceId: string; contacts: CrmContactRecord[] }>(
      rollbackFilePath(snapshotId),
    ));
  if (!snapshot) return { restored: 0 };

  const all = await readContacts();
  const others = all.filter((c) => c.workspaceId !== snapshot.workspaceId);
  await writeContacts([...others, ...snapshot.contacts]);
  return { restored: snapshot.contacts.length };
}

export function newContactId(workspaceId: string, rowIndex: number): string {
  return `crm-${workspaceId}-${rowIndex}-${Date.now().toString(36)}`;
}

export function newJobId(workspaceId: string): string {
  return `import-${workspaceId}-${Date.now().toString(36)}`;
}

/** Test-only: reset in-memory layer between smoke checks. */
export function __resetCrmImportMemoryForTests(): void {
  memoryJobs.clear();
  memoryContacts = null;
  memoryRollbacks.clear();
  fileWritesEnabled = null;
}
