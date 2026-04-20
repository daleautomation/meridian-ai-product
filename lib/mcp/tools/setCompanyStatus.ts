// Meridian AI — set_company_status tool.
//
// Update the pipeline status of a company and record the change in
// statusHistory for auditability. Accepts any string to avoid boxing
// operators into a rigid taxonomy; the recommended set is documented
// in the description but not enforced.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { setStatus, type StatusChange } from "@/lib/state/companySnapshotStore";

export type SetCompanyStatusInput = {
  company: CompanyRef;
  status: string;
  changedBy?: string;
  note?: string;
};

export type SetCompanyStatusData = {
  change: StatusChange;
  currentStatus: string;
};

async function handler(
  input: SetCompanyStatusInput
): Promise<ToolResult<SetCompanyStatusData>> {
  const { company, status, changedBy, note } = input;
  const timestamp = nowIso();

  if (!status || !status.trim()) {
    return {
      tool: "set_company_status",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: {
        change: { status: "", changedAt: timestamp, changedBy: changedBy ?? "operator" },
        currentStatus: "",
      },
      stub: false,
      error: "empty_status",
    };
  }

  const { snapshot, change } = await setStatus(company, {
    status: status.trim(),
    changedBy: changedBy ?? "operator",
    note,
  });

  return {
    tool: "set_company_status",
    company: snapshot.company,
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `status → "${change.status}" by ${change.changedBy}`,
      },
    ],
    data: { change, currentStatus: snapshot.status ?? change.status },
    stub: false,
    notes: [
      'Recommended set: NEW | CONTACTED | QUALIFIED | PITCHED | CLOSED_WON | CLOSED_LOST | ARCHIVED',
    ],
  };
}

export const setCompanyStatusTool: ToolDefinition<SetCompanyStatusInput, SetCompanyStatusData> = {
  name: "set_company_status",
  description:
    'Update the pipeline status of a company and record the change. Recommended values: NEW | CONTACTED | QUALIFIED | PITCHED | CLOSED_WON | CLOSED_LOST | ARCHIVED.',
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      status: { type: "string", description: "New status label" },
      changedBy: { type: "string", description: 'Author id; defaults to "operator"' },
      note: { type: "string", description: "Optional context for the change" },
    },
    required: ["company", "status"],
    additionalProperties: false,
  },
  handler,
};
