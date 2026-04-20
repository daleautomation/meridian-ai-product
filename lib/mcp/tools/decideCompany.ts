// Meridian AI — decide_company tool.
//
// Read-only deterministic decision for a single company: runs the scoring
// engine against the persisted snapshot and returns the full decision +
// contribution trace. No network calls, no Claude, no mutation.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { getSnapshot } from "@/lib/state/companySnapshotStore";
import { decideCompany, type CompanyDecision } from "@/lib/scoring/companyDecision";

export type DecideCompanyInput = { company: CompanyRef };

export type DecideCompanyData = {
  found: boolean;
  decision: CompanyDecision | null;
};

async function handler(input: DecideCompanyInput): Promise<ToolResult<DecideCompanyData>> {
  const { company } = input;
  const timestamp = nowIso();
  const snap = await getSnapshot(company);

  if (!snap) {
    return {
      tool: "decide_company",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [
        {
          kind: "store_read",
          source: "data/companySnapshots.json",
          observedAt: timestamp,
          detail: "no snapshot for this company key — run save_company_snapshot first",
        },
      ],
      data: { found: false, decision: null },
      stub: false,
      error: "no_snapshot",
    };
  }

  const decision = decideCompany(snap);

  return {
    tool: "decide_company",
    company: snap.company,
    timestamp,
    confidence: decision.confidenceFloor,
    confidenceLabel: labelFromConfidence(decision.confidenceFloor),
    evidence: [
      {
        kind: "store_read",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `decided from ${Object.keys(snap.latest).length} tool result(s); lastCheckedAt=${snap.lastCheckedAt ?? "n/a"}`,
      },
      ...decision.trace.map((t) => ({
        kind: "score_trace",
        source: "companyDecision",
        observedAt: timestamp,
        detail: `${t.factor}: ${t.contribution > 0 ? "+" : ""}${t.contribution} — ${t.note}`,
      })),
    ],
    data: { found: true, decision },
    stub: false,
  };
}

export const decideCompanyTool: ToolDefinition<DecideCompanyInput, DecideCompanyData> = {
  name: "decide_company",
  description:
    "Runs the deterministic decision engine against a single persisted snapshot. Returns score, opportunity level, recommended action, close probability, ranked weaknesses, pitch angle, and a full weighted contribution trace.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
