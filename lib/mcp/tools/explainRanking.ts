// Meridian AI — explain_ranking tool.
//
// Head-to-head: takes two company refs, runs decideCompany on each, and
// returns a factor-by-factor diff explaining why one outranks the other.
// Read-only. Every claim is grounded in trace entries + evidence refs.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { getSnapshot } from "@/lib/state/companySnapshotStore";
import { decideCompany, type CompanyDecision } from "@/lib/scoring/companyDecision";

export type ExplainRankingInput = {
  a: CompanyRef;
  b: CompanyRef;
};

export type FactorDelta = {
  factor: string;
  aContribution: number;
  bContribution: number;
  delta: number;           // a - b; positive means favors A
  favors: "A" | "B" | "tie";
  note: string;
};

export type ExplainRankingData = {
  a: CompanyDecision | null;
  b: CompanyDecision | null;
  scoreDelta: number;      // a.score - b.score
  winner: "A" | "B" | "tie" | "unknown";
  factorDeltas: FactorDelta[];
  summary: string;
};

async function handler(input: ExplainRankingInput): Promise<ToolResult<ExplainRankingData>> {
  const timestamp = nowIso();
  const [snapA, snapB] = await Promise.all([getSnapshot(input.a), getSnapshot(input.b)]);

  const a = snapA ? decideCompany(snapA) : null;
  const b = snapB ? decideCompany(snapB) : null;

  if (!a || !b) {
    return {
      tool: "explain_ranking",
      company: { name: `${input.a.name} vs ${input.b.name}` },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: {
        a,
        b,
        scoreDelta: (a?.score ?? 0) - (b?.score ?? 0),
        winner: "unknown",
        factorDeltas: [],
        summary: `missing snapshot: ${!a ? input.a.name : ""} ${!b ? input.b.name : ""}`.trim(),
      },
      stub: false,
      error: "missing_snapshot",
    };
  }

  const factorMap = new Map<string, FactorDelta>();
  for (const t of a.trace) {
    factorMap.set(t.factor, {
      factor: t.factor,
      aContribution: t.contribution,
      bContribution: 0,
      delta: t.contribution,
      favors: t.contribution > 0 ? "A" : t.contribution < 0 ? "B" : "tie",
      note: t.note,
    });
  }
  for (const t of b.trace) {
    const existing = factorMap.get(t.factor);
    if (existing) {
      existing.bContribution = t.contribution;
      existing.delta = existing.aContribution - t.contribution;
      existing.favors = existing.delta > 0 ? "A" : existing.delta < 0 ? "B" : "tie";
    } else {
      factorMap.set(t.factor, {
        factor: t.factor,
        aContribution: 0,
        bContribution: t.contribution,
        delta: -t.contribution,
        favors: t.contribution > 0 ? "B" : t.contribution < 0 ? "A" : "tie",
        note: t.note,
      });
    }
  }

  const factorDeltas = Array.from(factorMap.values())
    .filter((f) => f.delta !== 0)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const scoreDelta = a.score - b.score;
  const winner: ExplainRankingData["winner"] =
    scoreDelta > 0 ? "A" : scoreDelta < 0 ? "B" : "tie";

  const topReasons = factorDeltas
    .slice(0, 3)
    .map((f) => `${f.factor} (${f.delta > 0 ? "+" : ""}${f.delta} → ${f.favors})`)
    .join("; ");
  const summary =
    winner === "tie"
      ? `Both score ${a.score}. Top differentiators: ${topReasons || "none"}.`
      : `${winner === "A" ? a.name : b.name} wins by ${Math.abs(scoreDelta)} points. Top drivers: ${topReasons || "none"}.`;

  return {
    tool: "explain_ranking",
    company: { name: `${a.name} vs ${b.name}` },
    timestamp,
    confidence: Math.min(a.confidenceFloor, b.confidenceFloor),
    confidenceLabel:
      Math.min(a.confidenceFloor, b.confidenceFloor) >= 75
        ? "HIGH"
        : Math.min(a.confidenceFloor, b.confidenceFloor) >= 50
        ? "MEDIUM"
        : "LOW",
    evidence: [
      ...a.evidenceRefs.map((r) => ({
        kind: "evidence_ref",
        source: `A:${r.tool}`,
        observedAt: r.timestamp,
        detail: `conf=${r.confidence}${r.stub ? " (stub)" : ""}`,
      })),
      ...b.evidenceRefs.map((r) => ({
        kind: "evidence_ref",
        source: `B:${r.tool}`,
        observedAt: r.timestamp,
        detail: `conf=${r.confidence}${r.stub ? " (stub)" : ""}`,
      })),
    ],
    data: { a, b, scoreDelta, winner, factorDeltas, summary },
    stub: false,
  };
}

export const explainRankingTool: ToolDefinition<ExplainRankingInput, ExplainRankingData> = {
  name: "explain_ranking",
  description:
    "Compares two companies head-to-head. Returns per-factor contribution deltas, a winner, and a plain-English summary — all grounded in trace + evidence refs.",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "object", description: "CompanyRef for side A" },
      b: { type: "object", description: "CompanyRef for side B" },
    },
    required: ["a", "b"],
    additionalProperties: false,
  },
  handler,
};
