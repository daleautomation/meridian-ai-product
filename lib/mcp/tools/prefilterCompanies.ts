// Meridian AI — prefilter_companies tool.
//
// Walks the raw pool, applies the explainable prefilter rules, and
// persists verdicts + reasons back onto each record. Cheap (pure local
// logic; no network). Run this before batch_inspect so Claude/API budget
// goes only toward viable candidates.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listRaw, bulkSetPrefilter } from "@/lib/state/rawCompaniesStore";
import { prefilter } from "@/lib/scoring/companyPrefilter";

export type PrefilterCompaniesInput = {
  reapply?: boolean;             // if true, re-run on records that already have a verdict
};

export type PrefilterReasonTally = { reason: string; count: number };

export type PrefilterCompaniesData = {
  scanned: number;
  passed: number;
  filtered: number;
  skipped: number;               // already had verdict, reapply=false
  reasons: PrefilterReasonTally[];
};

async function handler(
  input: PrefilterCompaniesInput
): Promise<ToolResult<PrefilterCompaniesData>> {
  const timestamp = nowIso();
  const all = await listRaw({ limit: 5000 });

  const reapply = input.reapply ?? false;
  const targets = reapply ? all : all.filter((r) => !r.prefilter);
  const skipped = all.length - targets.length;

  let passed = 0;
  let filtered = 0;
  const reasonCounts = new Map<string, number>();
  const decisions: Array<{ key: string; verdict: "PASSED" | "FILTERED"; reasons: string[] }> = [];

  for (const r of targets) {
    const res = prefilter(r);
    decisions.push({ key: r.key, verdict: res.verdict, reasons: res.reasons });
    if (res.verdict === "PASSED") passed++;
    else filtered++;
    // Tally first reason only to keep the histogram legible.
    for (const reason of res.reasons) {
      const head = reason.split(" (")[0];
      reasonCounts.set(head, (reasonCounts.get(head) ?? 0) + 1);
    }
  }

  await bulkSetPrefilter(decisions);

  const reasons: PrefilterReasonTally[] = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    tool: "prefilter_companies",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "prefilter_run",
        source: "companyPrefilter",
        observedAt: timestamp,
        detail: `scanned=${targets.length} passed=${passed} filtered=${filtered} skipped=${skipped}`,
      },
      ...reasons.slice(0, 5).map((r) => ({
        kind: "filter_reason",
        source: "companyPrefilter",
        observedAt: timestamp,
        detail: `${r.reason}: ${r.count}`,
      })),
    ],
    data: {
      scanned: targets.length,
      passed,
      filtered,
      skipped,
      reasons,
    },
    stub: false,
  };
}

export const prefilterCompaniesTool: ToolDefinition<
  PrefilterCompaniesInput,
  PrefilterCompaniesData
> = {
  name: "prefilter_companies",
  description:
    "Applies explainable prefilter rules (dedupe-on-write already handled at import; this enforces KC metro, no-footprint, national-brand, non-roofing-category rules). Persists verdicts + reasons.",
  inputSchema: {
    type: "object",
    properties: {
      reapply: {
        type: "boolean",
        description: "If true, re-evaluate records that already have a verdict (default false)",
      },
    },
    additionalProperties: false,
  },
  handler,
};
