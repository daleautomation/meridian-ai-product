// CRM contact storage — durable Postgres vs local file fallback.

const WORKSPACE_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const DURABLE_STORAGE_NOT_CONFIGURED =
  "Durable contact storage is not configured.";

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
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  ];
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
