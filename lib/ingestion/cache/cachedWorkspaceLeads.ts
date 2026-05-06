// Meridian — Persistent Cached Ingestion: cache-first wrapper.
//
// Drop-in replacement for `loadWorkspaceLeads` that:
//   1. Checks cache by (workspaceSlug, moduleId, batchId).
//   2. Returns cached leads if fresh.
//   3. Otherwise runs Google Places ingestion, stores the result,
//      and returns it.
//
// One-line operator-page swap: `loadWorkspaceLeads(opts)` →
// `cachedLoadWorkspaceLeads(opts)`. No scheduler, projection, or UI
// changes required.

import { loadWorkspaceLeads, type DecidedLead } from "../loadWorkspaceLeads";
import {
  getDefaultCacheStore,
  todayBatchId,
  cacheKeyFor,
  isExpired,
} from "./ingestionCache";
import {
  DEFAULT_INGESTION_TTL_MS,
  type CachedLoadOptions,
  type CachedLoadResult,
  type IngestionCacheEntry,
  type IngestionCacheStatus,
} from "./ingestionCacheTypes";

// In-flight request dedup. Multiple concurrent calls for the same
// cache key collapse to a single underlying ingestion. Prevents the
// thundering-herd problem when the operator page renders for
// multiple users (or in multiple modules) at the same time.
const inflight = new Map<string, Promise<DecidedLead[]>>();

async function ingestFresh(
  workspaceSlug: string,
  moduleId: string,
  limit: number,
): Promise<DecidedLead[]> {
  const key = `${workspaceSlug}::${moduleId}::${limit}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await loadWorkspaceLeads({ workspaceSlug, moduleId, limit });
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * Cache-first lead loader. Returns the same `DecidedLead[]` shape
 * `loadWorkspaceLeads` produces — drop-in compatible.
 *
 * Diagnostics surface the cache status and store backend so the
 * operator page can log [ingestion-cache] status=hit|miss|stale|
 * refresh returned=N for each module.
 */
export async function cachedLoadWorkspaceLeads(
  opts: CachedLoadOptions,
): Promise<CachedLoadResult> {
  const { workspaceSlug, moduleId } = opts;
  const limit = opts.limit ?? 60;
  const ttlMs = opts.ttlMs ?? DEFAULT_INGESTION_TTL_MS;
  const batchId = opts.batchId ?? todayBatchId();
  const store = opts.store ?? getDefaultCacheStore();
  const cacheKey = cacheKeyFor(workspaceSlug, moduleId, batchId);
  const googleKeyPresent = !!(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY);

  let status: IngestionCacheStatus = "miss";
  let cachedEntry: IngestionCacheEntry | null = null;

  if (!opts.forceRefresh) {
    cachedEntry = await store.get(cacheKey);
    if (cachedEntry && !isExpired(cachedEntry)) {
      status = "hit";
      // eslint-disable-next-line no-console
      console.log(
        `[ingestion-cache] workspace=${workspaceSlug} module=${moduleId} ` +
        `batchId=${batchId} status=hit returned=${cachedEntry.leads.length} ` +
        `store=${store.id}`,
      );
      return {
        leads: cachedEntry.leads,
        status,
        cacheKey,
        diagnostics: { ...cachedEntry.diagnostics, storeId: store.id },
      };
    }
    if (cachedEntry && isExpired(cachedEntry)) status = "stale";
  } else {
    status = "refresh";
  }

  // Fresh ingestion — run the underlying loader and cache the result.
  const sourceErrors: string[] = [];
  let leads: DecidedLead[] = [];
  try {
    leads = await ingestFresh(workspaceSlug, moduleId, limit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sourceErrors.push(msg);
    // Stale-if-available: when ingestion fails AND we have a stale
    // cache entry, return the stale leads rather than empty.
    if (cachedEntry) {
      // eslint-disable-next-line no-console
      console.log(
        `[ingestion-cache] workspace=${workspaceSlug} module=${moduleId} ` +
        `batchId=${batchId} status=error stale-if-available=true ` +
        `returned=${cachedEntry.leads.length} store=${store.id} reason="${msg}"`,
      );
      return {
        leads: cachedEntry.leads,
        status: "error",
        cacheKey,
        diagnostics: { ...cachedEntry.diagnostics, storeId: store.id, sourceErrors },
      };
    }
    leads = [];
  }

  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const entry: IngestionCacheEntry = {
    workspaceSlug,
    moduleId,
    batchId,
    generatedAt,
    expiresAt,
    source: "google_places",
    leads,
    diagnostics: {
      requestedLimit: limit,
      returnedCount: leads.length,
      googleKeyPresent,
      sourceErrors,
    },
  };
  await store.set(cacheKey, entry);

  // eslint-disable-next-line no-console
  console.log(
    `[ingestion-cache] workspace=${workspaceSlug} module=${moduleId} ` +
    `batchId=${batchId} status=${status} returned=${leads.length} ` +
    `store=${store.id} googleKeyPresent=${googleKeyPresent}`,
  );

  return {
    leads,
    status,
    cacheKey,
    diagnostics: { ...entry.diagnostics, storeId: store.id },
  };
}
