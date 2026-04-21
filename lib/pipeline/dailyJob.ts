// Meridian AI — Daily Pipeline Job.
//
// Orchestrates the full daily pipeline refresh:
// 1. Import new companies (from seed or external source)
// 2. Deduplicate (handled by rawCompaniesStore)
// 3. Prefilter
// 4. Enrich (batch inspect — website + opportunity summary)
// 5. Score via decision engine (happens on-read via rankCompanies)
// 6. Merge into existing pipeline (preserves CRM history, notes, status)
// 7. Recompute rankings (automatic — rankCompanies reads fresh snapshots)
// 8. Apply rotation (closed/stale removed from top 25)
//
// Error handling: each step is independent. If enrichment fails for some
// companies, those companies still exist — they just don't get rescored.
// Data is NEVER wiped. Append-only semantics.

import { callTool } from "@/lib/mcp/registry";
import { listSnapshots } from "@/lib/state/companySnapshotStore";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";
import { promises as fs } from "node:fs";
import path from "node:path";

export type DailyJobResult = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: {
    import: { received: number; inserted: number; duplicates: number; total: number } | null;
    prefilter: { scanned: number; passed: number; filtered: number } | null;
    enrich: { considered: number; succeeded: number; failed: number; skipped: number } | null;
    ranking: { total: number; high: number; medium: number; low: number } | null;
    rotation: { removed: number; staleDeprioritized: number } | null;
  };
  errors: string[];
};

export type DailyJobOptions = {
  tenantId?: string;
  importSource?: "seed" | "none";       // "seed" = from data/seed/, "none" = skip import
  enrichLimit?: number;                  // max companies to enrich per run (default 25)
  enrichConcurrency?: number;            // parallel workers (default 3)
  staleDays?: number;                    // re-enrich if older than this (default 7)
  rotationStaleDays?: number;            // rotate out of top 25 if no activity in N days (default 30)
};

const SEED_PATH = path.join(process.cwd(), "data", "seed", "kc-roofing-companies.json");

export async function runDailyPipeline(opts: DailyJobOptions = {}): Promise<DailyJobResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const steps: DailyJobResult["steps"] = {
    import: null,
    prefilter: null,
    enrich: null,
    ranking: null,
    rotation: null,
  };

  const enrichLimit = opts.enrichLimit ?? 25;
  const enrichConcurrency = opts.enrichConcurrency ?? 3;
  const staleDays = opts.staleDays ?? 7;

  // ── Step 1: Import ────────────────────────────────────────────────────
  if (opts.importSource !== "none") {
    try {
      const seedRaw = await fs.readFile(SEED_PATH, "utf8");
      const companies = JSON.parse(seedRaw);
      const res = await callTool("import_companies", {
        source: `daily_pipeline_${opts.tenantId ?? "default"}`,
        companies,
      });
      const data = res.data as Record<string, number> | null;
      steps.import = {
        received: data?.received ?? 0,
        inserted: data?.inserted ?? 0,
        duplicates: data?.duplicates ?? 0,
        total: data?.total ?? 0,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "import failed";
      errors.push(`import: ${msg}`);
      steps.import = { received: 0, inserted: 0, duplicates: 0, total: 0 };
    }
  }

  // ── Step 2: Prefilter ─────────────────────────────────────────────────
  try {
    const res = await callTool("prefilter_companies", { reapply: false });
    const data = res.data as Record<string, number> | null;
    steps.prefilter = {
      scanned: data?.scanned ?? 0,
      passed: data?.passed ?? 0,
      filtered: data?.filtered ?? 0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "prefilter failed";
    errors.push(`prefilter: ${msg}`);
  }

  // ── Step 3: Enrich (batch inspect) ────────────────────────────────────
  // Only enriches companies that are stale or not yet inspected.
  // NEVER re-inspects companies that already have fresh data.
  // CRM history, notes, pipeline status are untouched by this step.
  try {
    const res = await callTool("batch_inspect", {
      limit: enrichLimit,
      concurrency: enrichConcurrency,
      staleDays,
    });
    const data = res.data as Record<string, number> | null;
    steps.enrich = {
      considered: data?.considered ?? 0,
      succeeded: data?.succeeded ?? 0,
      failed: data?.failed ?? 0,
      skipped: data?.skippedFresh ?? 0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "enrich failed";
    errors.push(`enrich: ${msg}`);
  }

  // ── Step 4: Rankings (computed on-read, just verify) ───────────────────
  try {
    const res = await callTool("rank_companies", { limit: 100 });
    const data = res.data as { total: number; ranked: Array<{ opportunityLevel: string }> } | null;
    const ranked = data?.ranked ?? [];
    steps.ranking = {
      total: data?.total ?? 0,
      high: ranked.filter((r) => r.opportunityLevel === "HIGH").length,
      medium: ranked.filter((r) => r.opportunityLevel === "MEDIUM").length,
      low: ranked.filter((r) => r.opportunityLevel === "LOW").length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ranking failed";
    errors.push(`ranking: ${msg}`);
  }

  // ── Step 5: Rotation ──────────────────────────────────────────────────
  // This doesn't delete anything. The ranking function already excludes
  // CLOSED_WON / CLOSED_LOST / ARCHIVED via the `blocked` filter.
  // Here we identify stale companies (no activity in rotationStaleDays)
  // that are still in the pipeline and could be rotated to lower priority.
  const rotationStaleDays = opts.rotationStaleDays ?? 30;
  try {
    const snapshots = await listSnapshots();
    let staleCount = 0;
    const now = Date.now();
    for (const snap of snapshots) {
      const status = (snap.status ?? "").toUpperCase();
      if (["CLOSED_WON", "CLOSED_LOST", "ARCHIVED"].includes(status)) continue;
      if (status === "NEW") continue; // never contacted — not stale, just unworked

      const lastTouch = snap.lastAction?.performedAt ?? snap.updatedAt;
      const daysSince = Math.round((now - new Date(lastTouch).getTime()) / 86_400_000);
      if (daysSince > rotationStaleDays) {
        staleCount++;
        // We don't archive automatically — just track for reporting.
        // The scoring engine already deprioritizes stale companies via
        // lower deal heat and urgency scores.
      }
    }
    steps.rotation = { removed: 0, staleDeprioritized: staleCount };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "rotation check failed";
    errors.push(`rotation: ${msg}`);
  }

  const completedAt = new Date().toISOString();
  return {
    startedAt,
    completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    steps,
    errors,
  };
}

// ── Job history persistence ─────────────────────────────────────────────

const HISTORY_PATH = path.join(process.cwd(), "data", "pipelineJobHistory.json");
const MAX_HISTORY = 30;

export async function saveJobResult(result: DailyJobResult): Promise<void> {
  let history: DailyJobResult[] = [];
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    history = JSON.parse(raw);
    if (!Array.isArray(history)) history = [];
  } catch { /* file doesn't exist yet */ }

  history.unshift(result);
  history = history.slice(0, MAX_HISTORY);
  await safeWriteJson(HISTORY_PATH, history);
}

export async function getJobHistory(): Promise<DailyJobResult[]> {
  try {
    const raw = await fs.readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
