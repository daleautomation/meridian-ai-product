// CRM contact storage — durable Postgres vs local file fallback.
//
// Path constants are module-scoped under `data/` so Turbopack NFT traces a
// bounded subtree (not the whole repo). Ephemeral /tmp fallbacks use fixed
// absolute paths on Unix.

import path from "node:path";
import { MERIDIAN_DATA_DIR } from "@/lib/meridianDataPaths";

const WORKSPACE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const DURABLE_STORAGE_NOT_CONFIGURED =
  "Durable contact storage is not configured.";

export { MERIDIAN_DATA_DIR };

export const CRM_IMPORT_JOBS_PATH = path.join(MERIDIAN_DATA_DIR, "crmImportJobs.json");
export const CRM_IMPORT_JOBS_DIR = path.join(MERIDIAN_DATA_DIR, "crm-import-jobs");
export const CRM_CONTACTS_DIR = path.join(MERIDIAN_DATA_DIR, "crm-contacts");
export const CRM_CONTACTS_LEGACY_PATH = path.join(MERIDIAN_DATA_DIR, "crmContacts.json");
export const CRM_IMPORT_ROLLBACK_DIR = path.join(MERIDIAN_DATA_DIR, "crmImportRollbacks");

export const SCHEDULING_OVERRIDES_DIR = path.join(MERIDIAN_DATA_DIR, "scheduling");
export const SCHEDULING_OVERRIDES_PATH = path.join(
  SCHEDULING_OVERRIDES_DIR,
  "overrides.json",
);

/** Ephemeral CRM contact dir (local dev / warm containers only). */
export const CRM_CONTACTS_TMP_ROOT =
  process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-crm-contacts")
    : "/tmp/meridian-crm-contacts";

/** Ephemeral per-job JSON dir (local dev / warm containers only). */
export const CRM_IMPORT_JOBS_TMP_DIR =
  process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-crm-import-jobs")
    : "/tmp/meridian-crm-import-jobs";

/** Ephemeral schedule overrides (Vercel read-only deploy bundle). */
export const SCHEDULING_OVERRIDES_TMP_PATH =
  process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-overrides.json")
    : "/tmp/meridian-overrides.json";

export function assertWorkspaceSlug(workspaceId: string): void {
  if (!WORKSPACE_SLUG_RE.test(workspaceId)) {
    throw new Error(`crm-import: invalid workspace slug "${workspaceId}"`);
  }
}

function isPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgres:" || parsed.protocol === "postgresql:";
  } catch {
    return false;
  }
}

/** First available Postgres URL for CRM durable storage. */
export function getCrmDatabaseUrl(): string | null {
  const candidates = [process.env.DATABASE_URL, process.env.POSTGRES_URL];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (trimmed && isPostgresUrl(trimmed)) return trimmed;
  }
  return null;
}

export function useCrmNeonStorage(): boolean {
  return getCrmDatabaseUrl() !== null;
}

export function isVercelProduction(): boolean {
  return process.env.VERCEL === "1";
}

/** Production import requires Postgres; local dev may use writable files. */
export function assertDurableCrmStorageConfigured(): void {
  if (useCrmNeonStorage()) return;
  if (isVercelProduction()) {
    throw new Error(DURABLE_STORAGE_NOT_CONFIGURED);
  }
}

/** Sanitize a slug/id for use as a single path segment under a fixed root. */
export function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Optional MERIDIAN_CRM_CONTACTS_DIR override (local dev).
 * Relative values are scoped under `data/` so NFT stays bounded.
 */
export function resolveMeridianCrmContactsOverrideDir(): string | null {
  const custom = process.env.MERIDIAN_CRM_CONTACTS_DIR?.trim();
  if (!custom) return null;
  if (path.isAbsolute(custom)) return custom;
  const rel = custom.replace(/^(\.\/|\.\.\/)+/, "");
  return path.join(MERIDIAN_DATA_DIR, rel);
}

/** Repo + optional override roots for reading/writing workspace contact JSON. */
export function crmContactsFileRoots(): string[] {
  const roots: string[] = [CRM_CONTACTS_DIR];
  const override = resolveMeridianCrmContactsOverrideDir();
  if (override) roots.unshift(override);
  if (!isVercelProduction()) roots.push(CRM_CONTACTS_TMP_ROOT);
  return [...new Set(roots)];
}

/** Per-job JSON directories (repo first, then /tmp on non-Vercel). */
export function crmImportJobDirs(): string[] {
  const dirs = [CRM_IMPORT_JOBS_DIR];
  if (!isVercelProduction()) dirs.push(CRM_IMPORT_JOBS_TMP_DIR);
  return [...new Set(dirs)];
}

export function workspaceContactsFilePath(root: string, workspaceId: string): string {
  assertWorkspaceSlug(workspaceId);
  return path.join(root, `${safePathSegment(workspaceId)}.json`);
}

export function importJobFilePath(dir: string, jobId: string): string {
  return path.join(dir, `${safePathSegment(jobId)}.json`);
}

export function rollbackSnapshotFilePath(snapshotId: string): string {
  return path.join(CRM_IMPORT_ROLLBACK_DIR, `${safePathSegment(snapshotId)}.json`);
}
