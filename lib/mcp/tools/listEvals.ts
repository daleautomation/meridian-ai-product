// Meridian AI — list_evals tool.
//
// Read-only view of the eval ledger. Supports filtering by kind, verdict,
// and subject.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listEvals, type EvalItem, type EvalVerdict } from "@/lib/state/evalStore";

export type ListEvalsInput = {
  kind?: string;
  verdict?: EvalVerdict;
  subjectKey?: string;
  limit?: number;
};

export type ListEvalsData = { total: number; evals: EvalItem[] };

async function handler(input: ListEvalsInput): Promise<ToolResult<ListEvalsData>> {
  const timestamp = nowIso();
  const evals = await listEvals({
    kind: input.kind,
    verdict: input.verdict,
    subjectKey: input.subjectKey,
    limit: input.limit ?? 100,
  });
  return {
    tool: "list_evals",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/evals.json",
        observedAt: timestamp,
        detail: `returning ${evals.length} evals`,
      },
    ],
    data: { total: evals.length, evals },
    stub: false,
  };
}

export const listEvalsTool: ToolDefinition<ListEvalsInput, ListEvalsData> = {
  name: "list_evals",
  description: "Returns recorded evals, optionally filtered by kind, verdict, or subjectKey.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Optional kind filter" },
      verdict: { type: "string", description: "PASS | PARTIAL | FAIL", enum: ["PASS", "PARTIAL", "FAIL"] },
      subjectKey: { type: "string", description: "Optional subject filter" },
      limit: { type: "number", description: "Max records (default 100, max 500)" },
    },
    additionalProperties: false,
  },
  handler,
};
