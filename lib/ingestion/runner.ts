// Meridian AI — continuous ingestion runner.
//
// Periodically loads new data from all configured sources, appends to the
// primary dataset files, deduplicates, and tags new items. Runs in-process
// as a singleton — start once at server boot, runs on a configurable interval.
//
// This is an APPEND-ONLY pipeline. It never overwrites curated data.
// Existing records are preserved; new records are merged in.
//
// The runner does NOT touch scoring, trust, or engine logic.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { NormalizedWatchRecord, NormalizedRealEstateRecord } from "@/lib/ingestion/types";
import { loadWatchOpportunities, loadRealEstateOpportunities, type SourceSpec } from "@/lib/ingestion/loader";

const DATA_DIR = path.join(process.cwd(), "data");

// ── Configuration ──────────────────────────────────────────────────────

export type IngestionConfig = {
  intervalMs: number;            // default: 5 minutes
  enabled: boolean;
  logging: boolean;
  watches: {
    enabled: boolean;
    datasetPath: string;         // primary dataset to append to
    sources: SourceSpec[];       // supplemental sources to ingest from
  };
  realEstate: {
    enabled: boolean;
    datasetPath: string;
    sources: SourceSpec[];
  };
};

const DEFAULT_CONFIG: IngestionConfig = {
  intervalMs: 5 * 60 * 1000,    // 5 minutes
  enabled: true,
  logging: true,
  watches: {
    enabled: true,
    datasetPath: path.join(DATA_DIR, "watches.json"),
    sources: [
      { path: path.join(DATA_DIR, "sources", "watches.facebook.json"), type: "facebook" },
      { path: path.join(DATA_DIR, "sources", "watches.facebook.manual.json"), type: "facebook_manual" },
      { path: path.join(DATA_DIR, "sources", "watches.reddit.json"), type: "reddit" },
      { type: "reddit_live" },
    ],
  },
  realEstate: {
    enabled: true,
    datasetPath: path.join(DATA_DIR, "real-estate.json"),
    sources: [
      { path: path.join(DATA_DIR, "sources", "real-estate.fsbo.json"), type: "fsbo" },
      { path: path.join(DATA_DIR, "sources", "real-estate.scraped.json"), type: "scraped" },
    ],
  },
};

// ── Freshness tagging ──────────────────────────────────────────────────

const NEW_LISTING_THRESHOLD = 80; // freshnessScore >= 80 → tagged as NEW

function tagNewWatch(r: NormalizedWatchRecord, isNew: boolean): NormalizedWatchRecord {
  const now = new Date().toISOString();
  return { ...r, isNew, ingestedAt: now };
}

function tagNewRealEstate(r: NormalizedRealEstateRecord, isNew: boolean): NormalizedRealEstateRecord {
  const now = new Date().toISOString();
  return { ...r, isNew, ingestedAt: now };
}

// ── Dedup keys (same as loader.ts) ─────────────────────────────────────

function watchDedupeKey(r: NormalizedWatchRecord): string {
  const titleKey = (r.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return titleKey || String(r.id || "");
}

function realEstateDedupeKey(r: NormalizedRealEstateRecord): string {
  const titleKey = (r.title || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  return titleKey ? `${titleKey} ${r.zip}` : String(r.id || "");
}

// ── File I/O helpers ───────────────────────────────────────────────────

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, data: T[]): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

// ── Core ingestion logic ───────────────────────────────────────────────

export type IngestionResult = {
  vertical: string;
  existing: number;
  incoming: number;
  newItems: number;
  totalAfter: number;
  timestamp: string;
};

async function ingestWatches(
  config: IngestionConfig["watches"],
  logging: boolean
): Promise<IngestionResult> {
  const existing = await readJsonArray<NormalizedWatchRecord>(config.datasetPath);
  const existingKeys = new Set(existing.map(watchDedupeKey));

  const incoming = await loadWatchOpportunities(config.sources);

  let newCount = 0;
  const newRecords: NormalizedWatchRecord[] = [];

  for (const record of incoming) {
    const key = watchDedupeKey(record);
    if (!key || existingKeys.has(key)) continue;

    existingKeys.add(key);
    const isNew = (record.freshnessScore ?? 0) >= NEW_LISTING_THRESHOLD;
    newRecords.push(tagNewWatch(record, isNew));
    newCount++;
  }

  if (newRecords.length > 0) {
    const merged = [...existing, ...newRecords];
    await writeJsonArray(config.datasetPath, merged);
  }

  const result: IngestionResult = {
    vertical: "watches",
    existing: existing.length,
    incoming: incoming.length,
    newItems: newCount,
    totalAfter: existing.length + newCount,
    timestamp: new Date().toISOString(),
  };

  if (logging) {
    console.log(
      `[ingestion] watches: ${newCount} new items (${incoming.length} scanned, ${existing.length} existing → ${result.totalAfter} total)`
    );
  }

  return result;
}

async function ingestRealEstate(
  config: IngestionConfig["realEstate"],
  logging: boolean
): Promise<IngestionResult> {
  const existing = await readJsonArray<NormalizedRealEstateRecord>(config.datasetPath);
  const existingKeys = new Set(existing.map(realEstateDedupeKey));

  const incoming = await loadRealEstateOpportunities(config.sources);

  let newCount = 0;
  const newRecords: NormalizedRealEstateRecord[] = [];

  for (const record of incoming) {
    const key = realEstateDedupeKey(record);
    if (!key || existingKeys.has(key)) continue;

    existingKeys.add(key);
    const isNew = (record.freshnessScore ?? 0) >= NEW_LISTING_THRESHOLD;
    newRecords.push(tagNewRealEstate(record, isNew));
    newCount++;
  }

  if (newRecords.length > 0) {
    const merged = [...existing, ...newRecords];
    await writeJsonArray(config.datasetPath, merged);
  }

  const result: IngestionResult = {
    vertical: "realEstate",
    existing: existing.length,
    incoming: incoming.length,
    newItems: newCount,
    totalAfter: existing.length + newCount,
    timestamp: new Date().toISOString(),
  };

  if (logging) {
    console.log(
      `[ingestion] realEstate: ${newCount} new items (${incoming.length} scanned, ${existing.length} existing → ${result.totalAfter} total)`
    );
  }

  return result;
}

// ── Single run (both verticals) ────────────────────────────────────────

export async function runIngestion(
  config: IngestionConfig = DEFAULT_CONFIG
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];

  if (config.watches.enabled) {
    results.push(await ingestWatches(config.watches, config.logging));
  }
  if (config.realEstate.enabled) {
    results.push(await ingestRealEstate(config.realEstate, config.logging));
  }

  // Update status on every run (manual or scheduled)
  lastRunAt = new Date().toISOString();
  lastResults = results;
  runCount++;

  return results;
}

// ── Last-run status (in-memory) ────────────────────────────────────────

export type RunnerStatus = {
  active: boolean;
  lastRunAt: string | null;
  lastResults: IngestionResult[];
  runCount: number;
};

let lastRunAt: string | null = null;
let lastResults: IngestionResult[] = [];
let runCount = 0;

export function getRunnerStatus(): RunnerStatus {
  return {
    active: intervalHandle !== null,
    lastRunAt,
    lastResults,
    runCount,
  };
}

// ── Continuous runner (singleton) ──────────────────────────────────────

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startIngestionRunner(
  config: Partial<IngestionConfig> = {}
): void {
  if (intervalHandle) return; // already running

  // Deep merge: top-level scalars from caller, nested objects from defaults
  const merged: IngestionConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    watches: { ...DEFAULT_CONFIG.watches, ...config.watches },
    realEstate: { ...DEFAULT_CONFIG.realEstate, ...config.realEstate },
  };
  if (!merged.enabled) return;

  const interval = Math.max(30_000, merged.intervalMs); // minimum 30s

  if (merged.logging) {
    console.log(`[ingestion] runner started — interval ${Math.round(interval / 1000)}s`);
  }

  // Run once immediately, then on interval
  tick(merged);
  intervalHandle = setInterval(() => tick(merged), interval);
}

export function stopIngestionRunner(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[ingestion] runner stopped");
  }
}

export function isRunnerActive(): boolean {
  return intervalHandle !== null;
}

async function tick(config: IngestionConfig): Promise<void> {
  if (running) return; // skip if previous run hasn't finished
  running = true;
  try {
    await runIngestion(config);
  } catch (e) {
    console.error("[ingestion] run failed:", e);
  } finally {
    running = false;
  }
}

// ── Export config for external use ─────────────────────────────────────

export { DEFAULT_CONFIG };
