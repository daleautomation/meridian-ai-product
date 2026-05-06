// Meridian — Persistent Cached Ingestion: shared types.
//
// Cache layer between Google Places and the operator UI. Stores
// normalized lead pools so the operator page renders without
// hammering the API on every refresh.

import type { DecidedLead } from "../loadWorkspaceLeads";

export type IngestionSourceId = "google_places" | "seed_fallback" | "manual";

export type IngestionCacheStatus =
  | "hit"      // fresh cache, returned without re-ingestion
  | "miss"     // no cache entry, ingested fresh
  | "stale"    // expired cache, ingested fresh
  | "refresh"  // forceRefresh=true, ingested fresh
  | "error";   // ingestion failed; returned stale-if-available or empty

export interface IngestionCacheEntry {
  workspaceSlug: string;
  moduleId: string;
  batchId: string;            // YYYY-MM-DD by default; the ingestion batch date
  generatedAt: string;        // ISO timestamp
  expiresAt: string;          // ISO timestamp; entries are stale after this
  source: IngestionSourceId;
  leads: DecidedLead[];
  diagnostics: {
    requestedLimit: number;
    returnedCount: number;
    googleKeyPresent: boolean;
    sourceErrors: string[];
  };
}

/**
 * Storage abstraction. Implementations may persist to memory, /tmp,
 * KV, Postgres, or Blob — the wrapper API is identical.
 *
 * IMPORTANT: Vercel serverless filesystem is NOT durable across cold
 * starts. The default in-memory + /tmp store is best-effort within
 * a warm container's lifetime (typically 5–15 min). For sustained
 * production durability, plug in a KV/Postgres/Blob-backed store.
 */
export interface IngestionCacheStore {
  get(key: string): Promise<IngestionCacheEntry | null>;
  set(key: string, entry: IngestionCacheEntry): Promise<void>;
  clear(key?: string): Promise<void>;
  /** Implementation tag for diagnostics. */
  readonly id: string;
}

export interface CachedLoadOptions {
  workspaceSlug: string;
  moduleId: string;
  limit?: number;
  /** When true, skip cache lookup and run a fresh ingestion. */
  forceRefresh?: boolean;
  /** Override the default 24h TTL. Number in milliseconds. */
  ttlMs?: number;
  /** Override the default batch id (defaults to today's YYYY-MM-DD). */
  batchId?: string;
  /** Override the storage backend. */
  store?: IngestionCacheStore;
}

export interface CachedLoadResult {
  leads: DecidedLead[];
  status: IngestionCacheStatus;
  cacheKey: string;
  diagnostics: IngestionCacheEntry["diagnostics"] & { storeId: string };
}

export const DEFAULT_INGESTION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
