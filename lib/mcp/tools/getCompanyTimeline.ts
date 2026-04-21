// Meridian AI — get_company_timeline tool.
//
// Returns the full CRM activity timeline for a company plus
// the computed CRM summary (stage, recommendation, touch counts).

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { companyKey, nowIso } from "@/lib/mcp/types";
import { getTimeline, getCompanySummary, type CrmActivity, type CompanyCrmSummary } from "@/lib/state/crmStore";

export type GetCompanyTimelineInput = { company: CompanyRef; limit?: number };

export type GetCompanyTimelineData = {
  timeline: CrmActivity[];
  summary: CompanyCrmSummary;
};

async function handler(input: GetCompanyTimelineInput): Promise<ToolResult<GetCompanyTimelineData>> {
  const { company } = input;
  const timestamp = nowIso();
  const key = companyKey(company);
  const limit = input.limit ?? 50;

  const [timeline, summary] = await Promise.all([
    getTimeline(key),
    getCompanySummary(key, company.name),
  ]);

  return {
    tool: "get_company_timeline",
    company,
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [{
      kind: "store_read",
      source: "data/crmActivities.json",
      observedAt: timestamp,
      detail: `${timeline.length} activities for ${company.name}`,
    }],
    data: { timeline: timeline.slice(0, limit), summary },
    stub: false,
  };
}

export const getCompanyTimelineTool: ToolDefinition<GetCompanyTimelineInput, GetCompanyTimelineData> = {
  name: "get_company_timeline",
  description: "Returns the CRM activity timeline and summary for a company.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      limit: { type: "number", description: "Max activities (default 50)" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
