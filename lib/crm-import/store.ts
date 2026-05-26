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
  crmContactsFileRoots,
  crmImportJobDirs,
  CRM_CONTACTS_LEGACY_PATH,
  CRM_IMPORT_JOBS_PATH,
  CRM_IMPORT_ROLLBACK_DIR,
  DURABLE_STORAGE_NOT_CONFIGURED,
  importJobFilePath,
  isVercelProduction,
  rollbackSnapshotFilePath,
  safePathSegment,
  useCrmNeonStorage,
  workspaceContactsFilePath,
} from "./storageConfig";
import type { CrmContactRecord, CrmImportJob } from "./types";

/**
 * Thrown when a contact READ is attempted in a deployment that has no
 * durable storage configured (Vercel/serverless without
 * DATABASE_URL/POSTGRES_URL).
 *
 * Original bug: this case silently returned [] and a customer workspace
 * looked like it had 0 contacts when in fact storage simply wasn't
 * wired. Callers (`app/personal/page.tsx`, `app/operator/relationship-priority/page.tsx`)
 * catch this error and surface an explicit "storage not configured"
 * state instead of an empty list.
 */
export class ContactStorageUnavailableError extends Error {
  readonly code = "no_durable_storage_in_production";
  readonly workspaceId: string;
  constructor(workspaceId: string, detail: string) {
    super(detail);
    this.name = "ContactStorageUnavailableError";
    this.workspaceId = workspaceId;
  }
}

export type ContactStorageMode = "neon" | "file" | "none";

/** Describe the storage backend currently in use. Pure read. */
export function describeContactStorageMode(): {
  mode: ContactStorageMode;
  durable: boolean;
  detail: string;
} {
  if (useCrmNeonStorage()) {
    return { mode: "neon", durable: true, detail: "DATABASE_URL/POSTGRES_URL configured" };
  }
  if (isVercelProduction()) {
    return {
      mode: "none",
      durable: false,
      detail: "Vercel production without DATABASE_URL — contact reads/writes will fail loud",
    };
  }
  return {
    mode: "file",
    durable: false,
    detail: `local file storage under ${crmContactsFileRoots().join(", ")}`,
  };
}

function normalizeContactRecord(contact: CrmContactRecord): CrmContactRecord {
  return {
    ...contact,
    scoreMetadata: contact.scoreMetadata ?? null,
  };
}

type JobsFile = { jobs: CrmImportJob[] };
type ContactsFile = { contacts: CrmContactRecord[] };

const memoryJobs = new Map<string, CrmImportJob>();
const memoryContactsByWorkspace = new Map<string, CrmContactRecord[]>();
const memoryRollbacks = new Map<
  string,
  { workspaceId: string; contacts: CrmContactRecord[]; createdAt: string }
>();

let persistenceProbe: boolean | null = null;

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

  for (const root of crmContactsFileRoots()) {
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

async function atomicWriteJson(
  parentDir: string,
  fileName: string,
  data: unknown,
): Promise<boolean> {
  const filePath = path.join(parentDir, fileName);
  const tmp = path.join(parentDir, `.${fileName}.${randomUUID()}.tmp`);
  try {
    await fs.mkdir(parentDir, { recursive: true });
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
  for (const root of crmContactsFileRoots()) {
    const filePath = workspaceContactsFilePath(root, workspaceId);
    const data = await safeReadJson<ContactsFile>(filePath);
    if (data?.contacts?.length) {
      return data.contacts.filter((c) => c.workspaceId === workspaceId);
    }
    if (data?.contacts) return [];
  }

  const legacy = await safeReadJson<ContactsFile>(CRM_CONTACTS_LEGACY_PATH);
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
  const fileName = `${safePathSegment(workspaceId)}.json`;
  for (const root of crmContactsFileRoots()) {
    if (await atomicWriteJson(root, fileName, payload)) {
      return true;
    }
  }
  return false;
}

async function readWorkspaceContacts(workspaceId: string): Promise<CrmContactRecord[]> {
  const cached = memoryContactsByWorkspace.get(workspaceId);
  if (cached) return cached;

  if (useCrmNeonStorage()) {
    const rows = (await listContactsNeon(workspaceId)).map(normalizeContactRecord);
    memoryContactsByWorkspace.set(workspaceId, rows);
    return rows;
  }

  // No Neon. In a Vercel-style production environment this is a
  // misconfiguration: the read MUST surface that fact rather than
  // pretend there are 0 contacts. The file roots that follow can never
  // be durable in serverless (deploy bundle is read-only; /tmp is
  // ephemeral) so we refuse to silently return [].
  if (isVercelProduction()) {
    const detail =
      `Contact storage is not configured for workspace "${workspaceId}". ` +
      `DATABASE_URL or POSTGRES_URL must be set for durable contact persistence in production. ` +
      `Until configured, imported contacts cannot be read back across cold starts.`;
    // eslint-disable-next-line no-console
    console.error(`[crm-import] ${detail}`);
    throw new ContactStorageUnavailableError(workspaceId, detail);
  }

  const rows = (await readWorkspaceContactsFromDisk(workspaceId)).map(normalizeContactRecord);
  memoryContactsByWorkspace.set(workspaceId, rows);
  return rows;
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
  const data = await safeReadJson<JobsFile>(CRM_IMPORT_JOBS_PATH);
  return data?.jobs ?? [];
}

async function writeLegacyJobs(jobs: CrmImportJob[]): Promise<void> {
  await safeWriteJson(CRM_IMPORT_JOBS_PATH, { jobs });
}

export async function getImportJob(jobId: string): Promise<CrmImportJob | null> {
  const mem = memoryJobs.get(jobId);
  if (mem?.id === jobId) return mem;

  for (const dir of crmImportJobDirs()) {
    const perJob = await safeReadJson<CrmImportJob>(importJobFilePath(dir, jobId));
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
  const jobFileName = `${safePathSegment(job.id)}.json`;
  for (const dir of crmImportJobDirs()) {
    try {
      if (await atomicWriteJson(dir, jobFileName, job)) {
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

/**
 * Diagnostic: storage-mode + per-workspace contact count for a set of
 * workspaces. Reads through the same path the personal/operator pages
 * use, so a count returned here matches what the workspace renders.
 *
 * Returns one report per workspace; each report carries an `error`
 * field when storage is unavailable so an operator can tell "0
 * contacts" from "storage misconfigured".
 */
export async function getWorkspaceContactCounts(workspaceIds: readonly string[]): Promise<{
  storage: ReturnType<typeof describeContactStorageMode>;
  workspaces: Array<{
    workspaceId: string;
    count: number | null;
    error: string | null;
  }>;
}> {
  const storage = describeContactStorageMode();
  const workspaces: Array<{ workspaceId: string; count: number | null; error: string | null }> = [];
  for (const id of workspaceIds) {
    try {
      const list = await readWorkspaceContacts(id);
      workspaces.push({ workspaceId: id, count: list.length, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      workspaces.push({ workspaceId: id, count: null, error: message });
    }
  }
  return { storage, workspaces };
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
      await fs.mkdir(CRM_IMPORT_ROLLBACK_DIR, { recursive: true });
      const ok = await safeWriteJson(rollbackSnapshotFilePath(snapshotId), payload);
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
          rollbackSnapshotFilePath(snapshotId),
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
