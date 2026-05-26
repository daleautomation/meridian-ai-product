// Meridian — runtime fingerprint.
//
// The single source of truth for "what code/runtime is actually serving
// this request?" Used by:
//   • /api/debug/runtime-fingerprint   (operator-visible JSON)
//   • /api/crm-import/execute          (post-import log)
//   • /personal page                    (per-render log)
//   • The one-time runtime banner log emitted on first import.
//
// Pure read of environment variables — no side effects. The masked
// database host never includes credentials.

import { describeContactStorageMode } from "@/lib/crm-import/store";
import { getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";

export interface RuntimeFingerprint {
  /** Full commit SHA serving this process, or "unknown" when not exposed. */
  commit: string;
  /** Short 7-char commit SHA. */
  commitShort: string;
  /** Branch name (Vercel: VERCEL_GIT_COMMIT_REF), or "unknown". */
  branch: string;
  /** "production" / "preview" / "development" / "local". */
  env: string;
  /** ISO build-time stamp if BUILD_TIME is wired at build, else "unknown". */
  buildTime: string;
  /** "neon" / "file" / "none" — current contact storage backend. */
  storageMode: "neon" | "file" | "none";
  /** Whether the storage backend is durable. */
  durable: boolean;
  /** Masked database host (no user/password), e.g. "ep-rapid-lake-xxx.neon.tech". */
  dbHost: string | null;
  /** Database name parsed from the connection URL. */
  dbName: string | null;
  /** Node process pid + start time — useful for noticing cold starts. */
  process: {
    pid: number;
    nodeVersion: string;
    uptimeSeconds: number;
  };
}

function readEnv(name: string): string | null {
  const v = process.env[name];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function maskedHostFromUrl(url: string | null): { host: string | null; database: string | null } {
  if (!url) return { host: null, database: null };
  try {
    const parsed = new URL(url);
    const host = parsed.host || null;
    const database = parsed.pathname.replace(/^\//, "") || null;
    return { host, database };
  } catch {
    return { host: null, database: null };
  }
}

/** Resolve the fingerprint from current process env. Pure. */
export function describeRuntimeFingerprint(): RuntimeFingerprint {
  const commit =
    readEnv("VERCEL_GIT_COMMIT_SHA") ??
    readEnv("GIT_COMMIT_SHA") ??
    readEnv("MERIDIAN_BUILD_COMMIT") ??
    "unknown";
  const branch =
    readEnv("VERCEL_GIT_COMMIT_REF") ??
    readEnv("GIT_BRANCH") ??
    readEnv("MERIDIAN_BUILD_BRANCH") ??
    "unknown";
  const env =
    readEnv("VERCEL_ENV") ?? readEnv("NODE_ENV") ?? "local";
  const buildTime =
    readEnv("VERCEL_DEPLOYMENT_CREATED_AT") ??
    readEnv("MERIDIAN_BUILD_TIME") ??
    "unknown";

  const storage = describeContactStorageMode();
  const url = getCrmDatabaseUrl();
  const { host, database } = maskedHostFromUrl(url);

  return {
    commit,
    commitShort: commit === "unknown" ? "unknown" : commit.slice(0, 7),
    branch,
    env,
    buildTime,
    storageMode: storage.mode,
    durable: storage.durable,
    dbHost: host,
    dbName: database,
    process: {
      pid: typeof process.pid === "number" ? process.pid : -1,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
    },
  };
}

// ── One-time runtime banner ───────────────────────────────────────

let bannerLogged = false;

/**
 * Log a single line summarizing the live runtime on first call. Safe
 * to call many times — only the first call prints. Call this from
 * surfaces that handle a real request (the import API + the personal
 * page) so the banner appears once per warm container.
 */
export function logRuntimeBannerOnce(): void {
  if (bannerLogged) return;
  bannerLogged = true;
  const fp = describeRuntimeFingerprint();
  // eslint-disable-next-line no-console
  console.log(
    `[runtime] commit=${fp.commitShort} branch=${fp.branch} env=${fp.env} ` +
      `storageMode=${fp.storageMode} durable=${fp.durable} ` +
      `dbHost=${fp.dbHost ?? "(none)"} dbName=${fp.dbName ?? "(none)"} ` +
      `nodeVersion=${fp.process.nodeVersion} pid=${fp.process.pid}`,
  );
}
