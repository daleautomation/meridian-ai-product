// Meridian — Persistent Cached Ingestion: storage backends.
//
// Layered storage strategy for Vercel serverless reality:
//
//   1. MemoryCacheStore       — module-scoped Map. Fast, best-effort,
//                               survives within a warm function
//                               invocation. Lost on cold start.
//   2. TmpFileCacheStore      — /tmp/meridian-cache JSON files.
//                               Writable on Vercel; ephemeral
//                               (lifetime of one warm container,
//                               typically 5–15 min). Useful in dev
//                               and as a best-effort warm-container
//                               speedup in prod.
//   3. CompositeCacheStore    — read-through: try memory, then tmp;
//                               write-through to both.
//
// For DURABLE production caching, swap CompositeCacheStore for a
// KV/Postgres/Blob-backed implementation. The interface is stable.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  IngestionCacheEntry,
  IngestionCacheStore,
} from "./ingestionCacheTypes";

// ── In-memory store ────────────────────────────────────────────────

class MemoryCacheStore implements IngestionCacheStore {
  readonly id = "memory";
  private map = new Map<string, IngestionCacheEntry>();
  async get(key: string): Promise<IngestionCacheEntry | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, entry: IngestionCacheEntry): Promise<void> {
    this.map.set(key, entry);
  }
  async clear(key?: string): Promise<void> {
    if (typeof key === "string") this.map.delete(key);
    else this.map.clear();
  }
}

// ── Tmp file store ────────────────────────────────────────────────

const CACHE_DIR_BASE = process.env.MERIDIAN_CACHE_DIR
  ?? (process.platform === "win32"
    ? path.join(process.env.TEMP ?? ".", "meridian-cache")
    : "/tmp/meridian-cache");

function safeKeyToFilename(key: string): string {
  // Replace anything that isn't [a-zA-Z0-9._-] with _ so the key is
  // safe across all filesystems.
  return key.replace(/[^a-zA-Z0-9._-]/g, "_") + ".json";
}

class TmpFileCacheStore implements IngestionCacheStore {
  readonly id = "tmp-file";
  private dir: string;
  constructor(dir: string = CACHE_DIR_BASE) {
    this.dir = dir;
  }
  private async ensureDir(): Promise<boolean> {
    try {
      await fs.mkdir(this.dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
  async get(key: string): Promise<IngestionCacheEntry | null> {
    try {
      const filePath = path.join(this.dir, safeKeyToFilename(key));
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.leads)) {
        return parsed as IngestionCacheEntry;
      }
      return null;
    } catch {
      return null;
    }
  }
  async set(key: string, entry: IngestionCacheEntry): Promise<void> {
    const ok = await this.ensureDir();
    if (!ok) return;
    try {
      const filePath = path.join(this.dir, safeKeyToFilename(key));
      await fs.writeFile(filePath, JSON.stringify(entry), "utf8");
    } catch {
      /* fail silent — tmp filesystem is best-effort */
    }
  }
  async clear(key?: string): Promise<void> {
    if (typeof key === "string") {
      try { await fs.unlink(path.join(this.dir, safeKeyToFilename(key))); } catch { /* */ }
      return;
    }
    try {
      const files = await fs.readdir(this.dir);
      await Promise.all(files.map((f) => fs.unlink(path.join(this.dir, f)).catch(() => {})));
    } catch { /* */ }
  }
}

// ── Composite store ──────────────────────────────────────────────

class CompositeCacheStore implements IngestionCacheStore {
  readonly id: string;
  private layers: IngestionCacheStore[];
  constructor(layers: IngestionCacheStore[]) {
    this.layers = layers;
    this.id = layers.map((l) => l.id).join("+");
  }
  async get(key: string): Promise<IngestionCacheEntry | null> {
    for (const layer of this.layers) {
      const hit = await layer.get(key);
      if (hit) {
        // Back-fill the faster layers above this one.
        for (const upper of this.layers) {
          if (upper === layer) break;
          await upper.set(key, hit);
        }
        return hit;
      }
    }
    return null;
  }
  async set(key: string, entry: IngestionCacheEntry): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.set(key, entry)));
  }
  async clear(key?: string): Promise<void> {
    await Promise.all(this.layers.map((layer) => layer.clear(key)));
  }
}

// ── Default store ────────────────────────────────────────────────
//
// Module-scoped singleton — a fresh import in the same Node runtime
// reuses the same memory layer (cache hits within a warm container).

let defaultStore: IngestionCacheStore | null = null;

export function getDefaultCacheStore(): IngestionCacheStore {
  if (defaultStore) return defaultStore;
  defaultStore = new CompositeCacheStore([
    new MemoryCacheStore(),
    new TmpFileCacheStore(),
  ]);
  return defaultStore;
}

// Test helper — drop the singleton so a fresh store is created on the
// next call. Production code should never call this.
export function __resetDefaultCacheStore(): void {
  defaultStore = null;
}

// Re-exports so consumers can import everything from one path.
export { MemoryCacheStore, TmpFileCacheStore, CompositeCacheStore };

// ── Key + freshness helpers ─────────────────────────────────────

export function todayBatchId(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function cacheKeyFor(workspaceSlug: string, moduleId: string, batchId: string): string {
  return `${workspaceSlug}::${moduleId}::${batchId}`;
}

export function isExpired(entry: IngestionCacheEntry, now: Date = new Date()): boolean {
  try {
    const expiresAt = new Date(entry.expiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return true;
    return now.getTime() >= expiresAt;
  } catch {
    return true;
  }
}
