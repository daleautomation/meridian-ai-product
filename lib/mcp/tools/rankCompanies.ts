// Meridian AI — rank_companies tool.
//
// Reads every persisted snapshot, runs the decision engine, and returns a
// ranked list (HIGH → MEDIUM → LOW, score desc, freshness tiebreaker).
// Intended to power the "what should I look at right now" surface.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listSnapshots } from "@/lib/state/companySnapshotStore";
import { rankCompanies, type CompanyDecision } from "@/lib/scoring/companyDecision";

export type RankCompaniesInput = {
  limit?: number;
  minLevel?: "HIGH" | "MEDIUM" | "LOW";
  action?: "CALL NOW" | "TODAY" | "MONITOR";
};

export type RankCompaniesData = {
  total: number;
  ranked: CompanyDecision[];
};

const LEVEL_RANK: Record<"HIGH" | "MEDIUM" | "LOW", number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

async function handler(input: RankCompaniesInput): Promise<ToolResult<RankCompaniesData>> {
  const timestamp = nowIso();
  const snaps = await listSnapshots();
  let ranked = rankCompanies(snaps);

  if (input.minLevel) {
    const floor = LEVEL_RANK[input.minLevel];
    ranked = ranked.filter((d) => LEVEL_RANK[d.opportunityLevel] <= floor);
  }
  if (input.action) {
    ranked = ranked.filter((d) => d.recommendedAction === input.action);
  }

  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const sliced = ranked.slice(0, limit);

  return {
    tool: "rank_companies",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `ranked ${snaps.length} snapshots; returning ${sliced.length} after filter/limit`,
      },
    ],
    data: { total: ranked.length, ranked: sliced },
    stub: false,
  };
}

export const rankCompaniesTool: ToolDefinition<RankCompaniesInput, RankCompaniesData> = {
  name: "rank_companies",
  description:
    "Runs the decision engine across every persisted snapshot and returns a ranked list. Supports optional minLevel and action filters.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max records (default 100, max 500)" },
      minLevel: { type: "string", description: "Floor: HIGH | MEDIUM | LOW", enum: ["HIGH", "MEDIUM", "LOW"] },
      action: { type: "string", description: "Exact match: CALL NOW | TODAY | MONITOR", enum: ["CALL NOW", "TODAY", "MONITOR"] },
    },
    additionalProperties: false,
  },
  handler,
};
