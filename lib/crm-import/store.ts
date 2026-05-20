// Meridian CRM import — persistence for jobs, contacts, and rollback snapshots.

import { promises as fs } from "node:fs";
import path from "node:path";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { CrmContactRecord, CrmImportJob } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const JOBS_PATH = path.join(DATA_DIR, "crmImportJobs.json");
const CONTACTS_PATH = path.join(DATA_DIR, "crmContacts.json");
const ROLLBACK_DIR = path.join(DATA_DIR, "crmImportRollbacks");

type JobsFile = { jobs: CrmImportJob[] };
type ContactsFile = { contacts: CrmContactRecord[] };

async function readJobs(): Promise<CrmImportJob[]> {
  const data = await safeReadJson<JobsFile>(JOBS_PATH);
  return data?.jobs ?? [];
}

async function writeJobs(jobs: CrmImportJob[]): Promise<void> {
  await safeWriteJson(JOBS_PATH, { jobs });
}

async function readContacts(): Promise<CrmContactRecord[]> {
  const data = await safeReadJson<ContactsFile>(CONTACTS_PATH);
  return data?.contacts ?? [];
}

async function writeContacts(contacts: CrmContactRecord[]): Promise<void> {
  await safeWriteJson(CONTACTS_PATH, { contacts });
}

export async function getImportJob(jobId: string): Promise<CrmImportJob | null> {
  const jobs = await readJobs();
  return jobs.find((j) => j.id === jobId) ?? null;
}

export async function saveImportJob(job: CrmImportJob): Promise<void> {
  const jobs = await readJobs();
  const index = jobs.findIndex((j) => j.id === job.id);
  if (index >= 0) jobs[index] = job;
  else jobs.push(job);
  await writeJobs(jobs);
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
  await fs.mkdir(ROLLBACK_DIR, { recursive: true });
  const snapshotId = `rollback-${workspaceId}-${Date.now()}`;
  const contacts = await listContactsByWorkspace(workspaceId);
  const snapshotPath = path.join(ROLLBACK_DIR, `${snapshotId}.json`);
  await safeWriteJson(snapshotPath, { workspaceId, contacts, createdAt: new Date().toISOString() });
  return snapshotId;
}

export async function rollbackImport(snapshotId: string): Promise<{ restored: number }> {
  const snapshotPath = path.join(ROLLBACK_DIR, `${snapshotId}.json`);
  const snapshot = await safeReadJson<{ workspaceId: string; contacts: CrmContactRecord[] }>(snapshotPath);
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
