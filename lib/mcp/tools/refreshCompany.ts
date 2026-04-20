// Meridian AI — refresh_company tool.
//
// Re-runs the inspection + summary pipeline for a persisted company and
// reports deltas vs the prior snapshot: score change, level change,
// recommended-action change, new weaknesses, resolved weaknesses.
//
// This is the Phase 6 refresh surface — it reuses Phase 1 tools and
// Phase 2 persistence; nothing new is stored beyond what save_company_snapshot
// already writes. Delta detection reads scoreHistory and the prior
// inspect_website result.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { getSnapshot } from "@/lib/state/companySnapshotStore";
import { saveCompanySnapshotTool } from "./saveCompanySnapshot";
import { decideCompany, type CompanyDecision } from "@/lib/scoring/companyDecision";

export type RefreshCompanyInput = {
  company: CompanyRef;
};

export type RefreshDelta = {
  scoreBefore: number | null;
  scoreAfter: number;
  scoreDelta: number;
  levelBefore: string | null;
  levelAfter: string;
  actionBefore: string | null;
  actionAfter: string;
  weaknessesAdded: string[];
  weaknessesResolved: string[];
  lastCheckedBefore: string | null;
  lastCheckedAfter: string | null;
};

export type RefreshCompanyData = {
  decision: CompanyDecision;
  delta: RefreshDelta;
};

function weaknessesFromSnapshot(tools: Record<string, { data?: unknown }> | undefined): string[] {
  const w: string[] = [];
  const web = tools?.inspect_website?.data as { weaknesses?: string[] } | undefined;
  const sum = tools?.generate_opportunity_summary?.data as { weaknesses?: string[]; topWeakness?: string } | undefined;
  if (sum?.topWeakness) w.push(sum.topWeakness);
  for (const x of sum?.weaknesses ?? []) if (!w.includes(x)) w.push(x);
  for (const x of web?.weaknesses ?? []) if (!w.includes(x)) w.push(x);
  return w;
}

async function handler(input: RefreshCompanyInput): Promise<ToolResult<RefreshCompanyData>> {
  const { company } = input;
  const timestamp = nowIso();

  // 1. Capture "before" state.
  const before = await getSnapshot(company);
  const beforeWeaknesses = weaknessesFromSnapshot(before?.latest);
  const priorScorePoint =
    before?.scoreHistory && before.scoreHistory.length > 0
      ? before.scoreHistory[before.scoreHistory.length - 1]
      : null;
  const beforeDecision = before ? decideCompany(before) : null;
  const lastCheckedBefore = before?.lastCheckedAt ?? null;

  // 2. Refresh by re-running save_company_snapshot (which runs inspectors).
  const saveResult = await saveCompanySnapshotTool.handler({ company });
  if (saveResult.error) {
    return {
      tool: "refresh_company",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: saveResult.evidence,
      data: {
        decision: {
          key: "",
          name: company.name,
          score: 0,
          opportunityLevel: "LOW",
          recommendedAction: "MONITOR",
          closeProbability: "Low",
          topWeaknesses: [],
          pitchAngle: null,
          rationale: "refresh failed",
          trace: [],
          evidenceRefs: [],
          confidenceFloor: 0,
          staleDays: null,
        },
        delta: {
          scoreBefore: priorScorePoint ? beforeDecision?.score ?? null : null,
          scoreAfter: 0,
          scoreDelta: 0,
          levelBefore: beforeDecision?.opportunityLevel ?? null,
          levelAfter: "LOW",
          actionBefore: beforeDecision?.recommendedAction ?? null,
          actionAfter: "MONITOR",
          weaknessesAdded: [],
          weaknessesResolved: [],
          lastCheckedBefore,
          lastCheckedAfter: null,
        },
      },
      stub: false,
      error: saveResult.error,
    };
  }

  // 3. Capture "after" state.
  const after = await getSnapshot(company);
  if (!after) {
    return {
      tool: "refresh_company",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: {} as RefreshCompanyData,
      stub: false,
      error: "after_snapshot_missing",
    };
  }
  const afterDecision = decideCompany(after);
  const afterWeaknesses = weaknessesFromSnapshot(after.latest);

  const weaknessesAdded = afterWeaknesses.filter((w) => !beforeWeaknesses.includes(w));
  const weaknessesResolved = beforeWeaknesses.filter((w) => !afterWeaknesses.includes(w));

  const delta: RefreshDelta = {
    scoreBefore: beforeDecision?.score ?? null,
    scoreAfter: afterDecision.score,
    scoreDelta: afterDecision.score - (beforeDecision?.score ?? afterDecision.score),
    levelBefore: beforeDecision?.opportunityLevel ?? null,
    levelAfter: afterDecision.opportunityLevel,
    actionBefore: beforeDecision?.recommendedAction ?? null,
    actionAfter: afterDecision.recommendedAction,
    weaknessesAdded,
    weaknessesResolved,
    lastCheckedBefore,
    lastCheckedAfter: after.lastCheckedAt ?? null,
  };

  return {
    tool: "refresh_company",
    company: after.company,
    timestamp,
    confidence: afterDecision.confidenceFloor,
    confidenceLabel: labelFromConfidence(afterDecision.confidenceFloor),
    evidence: [
      {
        kind: "refresh_delta",
        source: "meridian_mcp",
        observedAt: timestamp,
        detail: `score ${delta.scoreBefore ?? "∅"} → ${delta.scoreAfter} (${delta.scoreDelta >= 0 ? "+" : ""}${delta.scoreDelta}); +${weaknessesAdded.length} / -${weaknessesResolved.length} weaknesses`,
      },
      ...afterDecision.evidenceRefs.map((r) => ({
        kind: "evidence_ref",
        source: r.tool,
        observedAt: r.timestamp,
        detail: `conf=${r.confidence}${r.stub ? " (stub)" : ""}`,
      })),
    ],
    data: { decision: afterDecision, delta },
    stub: false,
    notes:
      delta.levelBefore && delta.levelBefore !== delta.levelAfter
        ? [`opportunity level changed: ${delta.levelBefore} → ${delta.levelAfter}`]
        : undefined,
  };
}

export const refreshCompanyTool: ToolDefinition<RefreshCompanyInput, RefreshCompanyData> = {
  name: "refresh_company",
  description:
    "Re-runs inspect_website + inspect_reviews + summary for a company, persists the new snapshot, and reports score / level / action / weakness deltas versus the prior snapshot.",
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
