// Meridian AI — list_companies tool.
//
// Returns compact summaries of every persisted company so the decision
// engine (and Phase 3 ranking) can iterate over the pipeline without
// loading full histories.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listSnapshots } from "@/lib/state/companySnapshotStore";

export type ListCompaniesInput = {
  status?: string;            // optional filter
  limit?: number;
};

export type CompanyListing = {
  key: string;
  name: string;
  domain?: string;
  location?: string;
  status?: string;
  lastCheckedAt?: string;
  latestOpportunityLevel?: "HIGH" | "MEDIUM" | "LOW";
  latestConfidence?: number;
  latestRecommendedAction?: string;
  noteCount: number;
  scorePointCount: number;
};

export type ListCompaniesData = {
  total: number;
  companies: CompanyListing[];
};

async function handler(input: ListCompaniesInput): Promise<ToolResult<ListCompaniesData>> {
  const timestamp = nowIso();
  const all = await listSnapshots();

  const filtered = input.status
    ? all.filter((s) => (s.status ?? "").toLowerCase() === input.status!.toLowerCase())
    : all;

  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const sliced = filtered.slice(0, limit);

  const companies: CompanyListing[] = sliced.map((s) => {
    const last = s.scoreHistory && s.scoreHistory.length > 0
      ? s.scoreHistory[s.scoreHistory.length - 1]
      : null;
    return {
      key: s.key,
      name: s.company.name,
      domain: s.company.domain,
      location: s.company.location,
      status: s.status,
      lastCheckedAt: s.lastCheckedAt,
      latestOpportunityLevel: last?.opportunityLevel,
      latestConfidence: last?.confidence,
      latestRecommendedAction: last?.recommendedAction,
      noteCount: s.notes?.length ?? 0,
      scorePointCount: s.scoreHistory?.length ?? 0,
    };
  });

  return {
    tool: "list_companies",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `read ${all.length} snapshots, returning ${companies.length} after filter/limit`,
      },
    ],
    data: { total: filtered.length, companies },
    stub: false,
  };
}

export const listCompaniesTool: ToolDefinition<ListCompaniesInput, ListCompaniesData> = {
  name: "list_companies",
  description:
    "Lists persisted companies with their current status, latest opportunity level, and counts. Supports optional status filter and limit.",
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", description: "Optional status filter (case-insensitive)" },
      limit: { type: "number", description: "Max records to return (default 100, max 500)" },
    },
    additionalProperties: false,
  },
  handler,
};
