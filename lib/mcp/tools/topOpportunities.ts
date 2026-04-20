// Meridian AI — top_opportunities tool.
//
// Operator-ready slice of the ranked pipeline. Returns:
//   - top N CALL NOW companies (default 10)
//   - next M TODAY companies (default 15)
// Plus a one-line evidence summary and pitch angle per entry.
//
// Composes existing rank_companies + get_company_snapshot; no new scoring.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listSnapshots } from "@/lib/state/companySnapshotStore";
import { rankCompanies } from "@/lib/scoring/companyDecision";

export type TopOpportunitiesInput = {
  callNowLimit?: number;       // default 10
  todayLimit?: number;         // default 15
};

export type CompanyEntry = {
  name: string;
  city?: string;
  domain?: string;
  opportunityLevel: "HIGH" | "MEDIUM" | "LOW";
  recommendedAction: "CALL NOW" | "TODAY" | "MONITOR";
  score: number;
  confidence: number;
  topWeaknesses: string[];
  evidenceSummary: string;
  pitchAngle: string | null;
  lastCheckedAt: string | null;
};

export type TopOpportunitiesData = {
  summary: {
    totalPipeline: number;
    totalHigh: number;
    totalMedium: number;
    totalLow: number;
    callNowCount: number;
    todayCount: number;
  };
  callNow: CompanyEntry[];
  today: CompanyEntry[];
};

async function handler(input: TopOpportunitiesInput): Promise<ToolResult<TopOpportunitiesData>> {
  const timestamp = nowIso();
  const callNowLimit = Math.max(1, Math.min(100, input.callNowLimit ?? 10));
  const todayLimit = Math.max(1, Math.min(100, input.todayLimit ?? 15));

  const snaps = await listSnapshots();
  const ranked = rankCompanies(snaps);
  const snapByKey = new Map(snaps.map((s) => [s.key, s]));

  const toEntry = (d: typeof ranked[number]): CompanyEntry => {
    const snap = snapByKey.get(d.key);
    const evidenceLines: string[] = [];
    const web = snap?.latest?.inspect_website;
    if (web?.evidence) {
      for (const e of web.evidence.slice(0, 2)) {
        evidenceLines.push(e.detail);
      }
    }
    return {
      name: d.name,
      domain: d.domain,
      city: snap?.company.location,
      opportunityLevel: d.opportunityLevel,
      recommendedAction: d.recommendedAction,
      score: d.score,
      confidence: d.confidenceFloor,
      topWeaknesses: d.topWeaknesses.slice(0, 3),
      evidenceSummary: evidenceLines.join(" · ") || d.rationale,
      pitchAngle: d.pitchAngle,
      lastCheckedAt: snap?.lastCheckedAt ?? null,
    };
  };

  const callNow = ranked
    .filter((d) => d.recommendedAction === "CALL NOW")
    .slice(0, callNowLimit)
    .map(toEntry);
  const today = ranked
    .filter((d) => d.recommendedAction === "TODAY")
    .slice(0, todayLimit)
    .map(toEntry);

  const totalHigh = ranked.filter((d) => d.opportunityLevel === "HIGH").length;
  const totalMedium = ranked.filter((d) => d.opportunityLevel === "MEDIUM").length;
  const totalLow = ranked.filter((d) => d.opportunityLevel === "LOW").length;

  return {
    tool: "top_opportunities",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "rank_slice",
        source: "rankCompanies",
        observedAt: timestamp,
        detail: `pipeline=${ranked.length} HIGH=${totalHigh} MED=${totalMedium} LOW=${totalLow} callNow=${callNow.length} today=${today.length}`,
      },
    ],
    data: {
      summary: {
        totalPipeline: ranked.length,
        totalHigh,
        totalMedium,
        totalLow,
        callNowCount: callNow.length,
        todayCount: today.length,
      },
      callNow,
      today,
    },
    stub: false,
  };
}

export const topOpportunitiesTool: ToolDefinition<TopOpportunitiesInput, TopOpportunitiesData> = {
  name: "top_opportunities",
  description:
    "Operator-ready top slice: top-N CALL NOW and next-M TODAY with evidence summary and pitch angle per entry. Composes rank_companies + snapshot reads.",
  inputSchema: {
    type: "object",
    properties: {
      callNowLimit: { type: "number", description: "Max CALL NOW entries (default 10, max 100)" },
      todayLimit: { type: "number", description: "Max TODAY entries (default 15, max 100)" },
    },
    additionalProperties: false,
  },
  handler,
};
