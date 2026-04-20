// Meridian AI — record_eval tool.
//
// Append a verdict to the evaluation ledger. Used for MVP human-in-the-loop
// evals today; the same tool is what a future auto-evaluator will call.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { createEval, type EvalItem, type EvalVerdict } from "@/lib/state/evalStore";

export type RecordEvalInput = {
  kind: string;
  subjectKey: string;
  subjectLabel: string;
  verdict: EvalVerdict;
  rubric?: string;
  notes?: string;
  evaluator?: string;
};

export type RecordEvalData = { eval: EvalItem };

async function handler(input: RecordEvalInput): Promise<ToolResult<RecordEvalData>> {
  const timestamp = nowIso();
  if (
    !input.kind?.trim() ||
    !input.subjectKey?.trim() ||
    !input.subjectLabel?.trim() ||
    (input.verdict !== "PASS" && input.verdict !== "PARTIAL" && input.verdict !== "FAIL")
  ) {
    return {
      tool: "record_eval",
      company: { name: input.subjectLabel ?? "?" },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { eval: {} as EvalItem },
      stub: false,
      error: "invalid_input",
    };
  }

  const record = await createEval({
    kind: input.kind.trim(),
    subjectKey: input.subjectKey.trim(),
    subjectLabel: input.subjectLabel.trim(),
    verdict: input.verdict,
    rubric: input.rubric,
    notes: input.notes,
    evaluator: input.evaluator ?? "operator",
  });

  return {
    tool: "record_eval",
    company: { name: record.subjectLabel },
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/evals.json",
        observedAt: timestamp,
        detail: `recorded eval id=${record.id} kind=${record.kind} verdict=${record.verdict}`,
      },
    ],
    data: { eval: record },
    stub: false,
    notes: [
      'Recommended kinds: summary_grounding | weakness_identification | ranking_alignment | action_consistency | pitch_relevance',
    ],
  };
}

export const recordEvalTool: ToolDefinition<RecordEvalInput, RecordEvalData> = {
  name: "record_eval",
  description:
    "Append a verdict (PASS/PARTIAL/FAIL) to the evaluation ledger against a named rubric. Used for MVP human-in-the-loop quality tracking.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Rubric name (free string; recommended set documented in notes)" },
      subjectKey: { type: "string", description: "Stable subject id — typically a companyKey" },
      subjectLabel: { type: "string", description: "Human-readable subject label" },
      verdict: { type: "string", description: "PASS | PARTIAL | FAIL", enum: ["PASS", "PARTIAL", "FAIL"] },
      rubric: { type: "string", description: "The question being judged (one line)" },
      notes: { type: "string", description: "Reviewer commentary" },
      evaluator: { type: "string", description: 'Evaluator id; defaults to "operator"' },
    },
    required: ["kind", "subjectKey", "subjectLabel", "verdict"],
    additionalProperties: false,
  },
  handler,
};
