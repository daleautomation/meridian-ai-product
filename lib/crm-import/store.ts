// Meridian CRM import — persistence for jobs, contacts, and rollback snapshots.
//
// Imported contacts are durable in Neon/Postgres when DATABASE_URL or POSTGRES_URL
// is set. Local development without a database uses per-workspace JSON under
// data/crm-contacts/. On Vercel without Postgres, contact import fails loudly.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import {
  listContactsNeon,
  replaceWorkspaceContactsNeon,
  upsertContactsNeon,
} from "./crmContactsNeonAdapter";
import { ensureCrmContactsSchema } from "./initCrmContactsSchema";
import {
  assertDurableCrmStorageConfigured,
  assertWorkspaceSlug,
  DURABLE_STORAGE_NOT_CONFIGURED,
  isVercelProduction,
  useCrmNeonStorage,
} from "./storageConfig";
import type { CrmContactRecord, CrmImportJob } from "./types";

function normalizeContactRecord(contact: CrmContactRecord): CrmContactRecord {
  return {
    ...contact,
    scoreMetadata: contact.scoreMetadata ?? null,
  };
}

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_PATH = path.join(DATA_DIR, "crmImportJobs.json");
const LEGACY_CONTACTS_PATH = path.join(DATA_DIR, "crmContacts.json");
const ROLLBACK_DIR = path.join(DATA_DIR, "crmImportRollbacks");

type JobsFile = { jobs: CrmImportJob[] };
type ContactsFile = { contacts: CrmContactRecord[] };

const memoryJobs = new Map<string, CrmImportJob>();
const memoryContactsByWorkspace = new Map<string, CrmContactRecord[]>();
const memoryRollbacks = new Map<
  string,
  { workspaceId: string; contacts: CrmContactRecord[]; createdAt: string }
>();

let persistenceProbe: boolean | null = null;

function contactsRepoRoot(): string {
  return path.join(DATA_DIR, "crm-contacts");
}

function contactsTmpRoot(): string {
  return process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-crm-contacts")
    : "/tmp/meridian-crm-contacts";
}

function contactsRoots(): string[] {
  const custom = process.env.MERIDIAN_CRM_CONTACTS_DIR?.trim();
  const roots = [custom, contactsRepoRoot()];
  if (!isVercelProduction()) {
    roots.push(contactsTmpRoot());
  }
  return [...new Set(roots.filter((r): r is string => Boolean(r)))];
}

function jobsRepoDir(): string {
  return path.join(DATA_DIR, "crm-import-jobs");
}

function jobsTmpDir(): string {
  return process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-crm-import-jobs")
    : "/tmp/meridian-crm-import-jobs";
}

function jobDirs(): string[] {
  return [...new Set([jobsRepoDir(), jobsTmpDir()])];
}

function workspaceContactsPath(root: string, workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(root, `${safe}.json`);
}

function jobFilePath(dir: string, jobId: string): string {
  const safe = jobId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dir, `${safe}.json`);
}

function rollbackFilePath(snapshotId: string): string {
  const safe = snapshotId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(ROLLBACK_DIR, `${safe}.json`);
}

/** Whether imported contacts can be persisted on this host. */
export async function isCrmImportPersistenceAvailable(): Promise<boolean> {
  if (persistenceProbe !== null) return persistenceProbe;

  if (useCrmNeonStorage()) {
    try {
      await ensureCrmContactsSchema();
      persistenceProbe = true;
      return true;
    } catch (e) {
      console.error("[crm-import] Neon CRM schema unavailable:", e);
      persistenceProbe = false;
      return false;
    }
  }

  if (isVercelProduction()) {
    persistenceProbe = false;
    return false;
  }

  for (const root of contactsRoots()) {
    try {
      await fs.mkdir(root, { recursive: true });
      const probe = path.join(root, ".write-probe");
      await fs.writeFile(probe, "ok", "utf8");
      await fs.unlink(probe);
      persistenceProbe = true;
      return true;
    } catch {
      /* try next root */
    }
  }
  persistenceProbe = false;
  return false;
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<boolean> {
  const dir = path.dirname(filePath);
  const tmpName = `.${path.basename(filePath)}.${randomUUID()}.tmp`;
  const tmp = path.join(dir, tmpName);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, filePath);
    return true;
  } catch (e) {
    console.error(`[crm-import] atomic write failed for ${filePath}:`, e);
    try {
      await fs.unlink(tmp);
    } catch {
      /* ignore */
    }
    return false;
  }
}

async function readWorkspaceContactsFromDisk(workspaceId: string): Promise<CrmContactRecord[]> {
  assertWorkspaceSlug(workspaceId);
  for (const root of contactsRoots()) {
    const filePath = workspaceContactsPath(root, workspaceId);
    const data = await safeReadJson<ContactsFile>(filePath);
    if (data?.contacts?.length) {
      return data.contacts.filter((c) => c.workspaceId === workspaceId);
    }
    if (data?.contacts) return [];
  }

  const legacy = await safeReadJson<ContactsFile>(LEGACY_CONTACTS_PATH);
  const fromLegacy = (legacy?.contacts ?? []).filter((c) => c.workspaceId === workspaceId);
  if (fromLegacy.length > 0) {
    await writeWorkspaceContactsToFile(workspaceId, fromLegacy);
  }
  return fromLegacy;
}

async function writeWorkspaceContactsToFile(
  workspaceId: string,
  contacts: CrmContactRecord[],
): Promise<boolean> {
  assertWorkspaceSlug(workspaceId);
  const payload: ContactsFile = { contacts };
  for (const root of contactsRoots()) {
    const filePath = workspaceContactsPath(root, workspaceId);
    if (await atomicWriteJson(filePath, payload)) {
      return true;
    }
  }
  return false;
}

async function readWorkspaceContacts(workspaceId: string): Promise<CrmContactRecord[]> {
  const cached = memoryContactsByWorkspace.get(workspaceId);
  if (cached) return cached;

  const records = (
    useCrmNeonStorage()
      ? await listContactsNeon(workspaceId)
      : await readWorkspaceContactsFromDisk(workspaceId)
  ).map(normalizeContactRecord);

  memoryContactsByWorkspace.set(workspaceId, records);
  return records;
}

async function writeWorkspaceContacts(
  workspaceId: string,
  contacts: CrmContactRecord[],
): Promise<boolean> {
  memoryContactsByWorkspace.set(workspaceId, contacts);

  if (useCrmNeonStorage()) {
    await ensureCrmContactsSchema();
    await replaceWorkspaceContactsNeon(workspaceId, contacts);
    return true;
  }

  return writeWorkspaceContactsToFile(workspaceId, contacts);
}

async function readLegacyJobs(): Promise<CrmImportJob[]> {
  const data = await safeReadJson<JobsFile>(JOBS_PATH);
  return data?.jobs ?? [];
}

async function writeLegacyJobs(jobs: CrmImportJob[]): Promise<void> {
  await safeWriteJson(JOBS_PATH, { jobs });
}

export async function getImportJob(jobId: string): Promise<CrmImportJob | null> {
  const mem = memoryJobs.get(jobId);
  if (mem?.id === jobId) return mem;

  for (const dir of jobDirs()) {
    const perJob = await safeReadJson<CrmImportJob>(jobFilePath(dir, jobId));
    if (perJob?.id === jobId) {
      memoryJobs.set(jobId, perJob);
      return perJob;
    }
  }

  const jobs = await readLegacyJobs();
  const legacy = jobs.find((j) => j.id === jobId) ?? null;
  if (legacy) memoryJobs.set(jobId, legacy);
  return legacy;
}

export async function saveImportJob(job: CrmImportJob): Promise<void> {
  memoryJobs.set(job.id, job);

  let persisted = false;
  for (const dir of jobDirs()) {
    try {
      await fs.mkdir(dir, { recursive: true });
      if (await atomicWriteJson(jobFilePath(dir, job.id), job)) {
        persisted = true;
        break;
      }
    } catch (e) {
      console.error("[crm-import] job file persist skipped:", job.id, e);
    }
  }

  if (persisted) {
    try {
      const jobs = await readLegacyJobs();
      const index = jobs.findIndex((j) => j.id === job.id);
      if (index >= 0) jobs[index] = job;
      else jobs.push(job);
      await writeLegacyJobs(jobs);
    } catch (e) {
      console.error("[crm-import] legacy job index update skipped:", job.id, e);
    }
  }
}

export async function listContactsByWorkspace(workspaceId: string): Promise<CrmContactRecord[]> {
  return readWorkspaceContacts(workspaceId);
}

export async function upsertContacts(records: CrmContactRecord[]): Promise<{ inserted: number; updated: number }> {
  if (records.length === 0) return { inserted: 0, updated: 0 };

  assertDurableCrmStorageConfigured();

  const canPersist = await isCrmImportPersistenceAvailable();
  if (!canPersist) {
    const message = isVercelProduction()
      ? DURABLE_STORAGE_NOT_CONFIGURED
      : "CRM contacts cannot be saved on this server (no writable storage). " +
        "Import was not completed — configure DATABASE_URL/POSTGRES_URL or MERIDIAN_CRM_CONTACTS_DIR.";
    throw new Error(message);
  }

  if (useCrmNeonStorage()) {
    await ensureCrmContactsSchema();
    const result = await upsertContactsNeon(records);
    const workspaceIds = [...new Set(records.map((r) => r.workspaceId))];
    for (const workspaceId of workspaceIds) {
      memoryContactsByWorkspace.delete(workspaceId);
      await readWorkspaceContacts(workspaceId);
    }
    return result;
  }

  const workspaceIds = [...new Set(records.map((r) => r.workspaceId))];
  let inserted = 0;
  let updated = 0;

  for (const workspaceId of workspaceIds) {
    const workspaceRecords = records.filter((r) => r.workspaceId === workspaceId);
    const existing = await readWorkspaceContacts(workspaceId);
    const byId = new Map(existing.map((c) => [c.id, c]));

    for (const record of workspaceRecords) {
      if (byId.has(record.id)) {
        byId.set(record.id, record);
        updated += 1;
      } else {
        byId.set(record.id, record);
        inserted += 1;
      }
    }

    const merged = [...byId.values()];
    const ok = await writeWorkspaceContacts(workspaceId, merged);
    if (!ok) {
      throw new Error(
        `CRM contacts could not be saved for workspace "${workspaceId}". ` +
          "Import was not completed — do not treat this import as successful.",
      );
    }
  }

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

  if (!useCrmNeonStorage()) {
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
    (useCrmNeonStorage()
      ? null
      : await safeReadJson<{ workspaceId: string; contacts: CrmContactRecord[] }>(
          rollbackFilePath(snapshotId),
        ));
  if (!snapshot) return { restored: 0 };

  assertDurableCrmStorageConfigured();
  const canPersist = await isCrmImportPersistenceAvailable();
  if (!canPersist) {
    throw new Error(
      isVercelProduction()
        ? DURABLE_STORAGE_NOT_CONFIGURED
        : `Could not restore contacts for workspace "${snapshot.workspaceId}" — storage is not writable.`,
    );
  }

  const ok = useCrmNeonStorage()
    ? await (async () => {
        await replaceWorkspaceContactsNeon(snapshot.workspaceId, snapshot.contacts);
        memoryContactsByWorkspace.set(snapshot.workspaceId, snapshot.contacts);
        return true;
      })()
    : await writeWorkspaceContacts(snapshot.workspaceId, snapshot.contacts);

  if (!ok) {
    throw new Error(
      `Could not restore contacts for workspace "${snapshot.workspaceId}" — storage is not writable.`,
    );
  }
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
  memoryContactsByWorkspace.clear();
  memoryRollbacks.clear();
  persistenceProbe = null;
}
