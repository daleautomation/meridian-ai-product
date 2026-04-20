// Meridian AI — eval_summary tool.
//
// Per-rubric rollup: total, PASS / PARTIAL / FAIL counts, weighted pass rate
// (PASS=1, PARTIAL=0.5, FAIL=0), and last-seen timestamp. Gives operators a
// one-glance view of where the engine is strong vs shaky.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { evalRollup, type EvalRollup } from "@/lib/state/evalStore";

export type EvalSummaryInput = Record<string, never>;

export type EvalSummaryData = {
  rollups: EvalRollup[];
  overallPassRate: number;     // 0–1 across all kinds
  overallTotal: number;
};

async function handler(): Promise<ToolResult<EvalSummaryData>> {
  const timestamp = nowIso();
  const rollups = await evalRollup();
  const overallTotal = rollups.reduce((s, r) => s + r.total, 0);
  const overallPassRate =
    overallTotal === 0
      ? 0
      : rollups.reduce((s, r) => s + r.passRate * r.total, 0) / overallTotal;

  return {
    tool: "eval_summary",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/evals.json",
        observedAt: timestamp,
        detail: `rolled up ${rollups.length} rubric kinds across ${overallTotal} evals`,
      },
    ],
    data: { rollups, overallPassRate, overallTotal },
    stub: false,
  };
}

export const evalSummaryTool: ToolDefinition<EvalSummaryInput, EvalSummaryData> = {
  name: "eval_summary",
  description:
    "Rollup of the eval ledger by rubric kind with weighted pass rate. Lets operators see at a glance where the engine is strongest and weakest.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  handler,
};
