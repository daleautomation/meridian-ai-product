// Meridian AI — clear_company_activity tool.
//
// Scoped reset — deletes every CRM activity entry for a single company.
// Does not touch notes, status, follow-ups, or any other company's log.
// The caller must pass `confirm: true` so a stray tool call can't
// accidentally wipe a lead's audit trail.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { companyKey, nowIso } from "@/lib/mcp/types";
import { clearActivitiesForCompany } from "@/lib/state/crmStore";

export type ClearCompanyActivityInput = {
  company: CompanyRef;
  confirm: boolean;
  performedBy: string;
};

export type ClearCompanyActivityData = {
  removed: number;
};

async function handler(
  input: ClearCompanyActivityInput
): Promise<ToolResult<ClearCompanyActivityData>> {
  const { company, confirm, performedBy } = input;
  const timestamp = nowIso();

  if (!confirm) {
    return {
      tool: "clear_company_activity",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { removed: 0 },
      stub: false,
      error: "confirm_required",
    };
  }

  try {
    const key = companyKey(company);
    const removed = await clearActivitiesForCompany(key);
    return {
      tool: "clear_company_activity",
      company,
      timestamp,
      confidence: 95,
      confidenceLabel: "HIGH",
      evidence: [
        {
          kind: "persistence_write",
          source: "data/crmActivities.json",
          observedAt: timestamp,
          detail: `cleared ${removed} activity entries for ${key} by ${performedBy}`,
        },
      ],
      data: { removed },
      stub: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "clear failed";
    return {
      tool: "clear_company_activity",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { removed: 0 },
      stub: false,
      error: message,
    };
  }
}

export const clearCompanyActivityTool: ToolDefinition<ClearCompanyActivityInput, ClearCompanyActivityData> = {
  name: "clear_company_activity",
  description:
    "Delete every CRM activity entry for a single company. Requires confirm=true. Does not affect notes, status, or other companies.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      confirm: { type: "boolean", description: "Must be true to execute" },
      performedBy: { type: "string", description: "User id performing the clear (for audit)" },
    },
    required: ["company", "confirm", "performedBy"],
    additionalProperties: false,
  },
  handler,
};
