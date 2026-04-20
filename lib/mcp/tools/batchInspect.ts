// Meridian AI — batch_inspect tool.
//
// Walks PASSED raw records that haven't been inspected yet (or whose
// last inspection is older than a threshold) and runs the full snapshot
// pipeline on each: save_company_snapshot internally chains
// inspectWebsite + inspectReviews + generate_opportunity_summary and
// persists each tool result to companySnapshotStore.
//
// Concurrency capped (default 4) so we don't saturate the Anthropic API.
// Per-record errors are captured on the raw record — the batch continues.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listRaw, setInspected } from "@/lib/state/rawCompaniesStore";
import { saveCompanySnapshotTool } from "./saveCompanySnapshot";
import { getSnapshot } from "@/lib/state/companySnapshotStore";

export type BatchInspectInput = {
  limit?: number;              // max records to inspect in this run (default 50)
  concurrency?: number;        // parallel workers (default 4, max 8)
  staleDays?: number;          // re-inspect if older than this (default 14; 0 = always)
};

export type BatchInspectData = {
  considered: number;
  processed: number;
  succeeded: number;
  failed: number;
  skippedFresh: number;
  failures: Array<{ key: string; name: string; error: string }>;
};

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

async function handler(input: BatchInspectInput): Promise<ToolResult<BatchInspectData>> {
  const timestamp = nowIso();
  const limit = Math.max(1, Math.min(500, input.limit ?? 50));
  const concurrency = Math.max(1, Math.min(8, input.concurrency ?? 4));
  const staleDays = input.staleDays ?? 14;

  const passed = await listRaw({ verdict: "PASSED", limit: 5000 });

  // Filter to records that need work: no existing snapshot, or snapshot older
  // than the threshold.
  const candidates: typeof passed = [];
  let skippedFresh = 0;
  for (const r of passed) {
    const snap = await getSnapshot({ name: r.name, domain: r.website, url: r.website });
    const age = daysSince(snap?.lastCheckedAt);
    if (age !== null && age < staleDays) {
      skippedFresh++;
      continue;
    }
    candidates.push(r);
    if (candidates.length >= limit) break;
  }

  let succeeded = 0;
  let failed = 0;
  const failures: BatchInspectData["failures"] = [];

  // Simple concurrency pool — no external dep.
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const idx = cursor++;
      const r = candidates[idx];
      const startedAt = new Date().toISOString();
      await setInspected(r.key, { startedAt });
      try {
        const res = await saveCompanySnapshotTool.handler({
          company: { name: r.name, domain: r.website, url: r.website, location: r.city },
        });
        if (res.error) throw new Error(res.error);
        succeeded++;
        await setInspected(r.key, { startedAt, completedAt: new Date().toISOString() });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown error";
        failed++;
        failures.push({ key: r.key, name: r.name, error: msg });
        await setInspected(r.key, {
          startedAt,
          completedAt: new Date().toISOString(),
          error: msg,
        });
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return {
    tool: "batch_inspect",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "batch_run",
        source: "batchInspect",
        observedAt: timestamp,
        detail: `passed=${passed.length} considered=${candidates.length} succeeded=${succeeded} failed=${failed} skippedFresh=${skippedFresh} concurrency=${concurrency}`,
      },
      ...failures.slice(0, 5).map((f) => ({
        kind: "batch_failure",
        source: "batchInspect",
        observedAt: timestamp,
        detail: `${f.name}: ${f.error.slice(0, 160)}`,
      })),
    ],
    data: {
      considered: candidates.length,
      processed: candidates.length,
      succeeded,
      failed,
      skippedFresh,
      failures,
    },
    stub: false,
    notes: [
      'Concurrency default 4. Raise for faster runs, lower if you see 429s from Anthropic.',
      'staleDays=0 re-inspects everyone; default 14d avoids redundant work.',
    ],
  };
}

export const batchInspectTool: ToolDefinition<BatchInspectInput, BatchInspectData> = {
  name: "batch_inspect",
  description:
    "Runs save_company_snapshot across PASSED raw records (skipping those with a fresh snapshot). Concurrency-capped. Per-record failures captured, batch continues.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max records to inspect (default 50, max 500)" },
      concurrency: { type: "number", description: "Parallel workers (default 4, max 8)" },
      staleDays: {
        type: "number",
        description: "Skip records whose last inspection is newer than this (default 14; 0 = always re-inspect)",
      },
    },
    additionalProperties: false,
  },
  handler,
};
