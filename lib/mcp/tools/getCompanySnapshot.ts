// Meridian AI — get_company_snapshot tool.
//
// Read-only access to the persisted entity record. Returns latest tool
// outputs, profile, status, notes, score history, and per-tool history.
// No external I/O, no fabrication.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { getSnapshot, type CompanySnapshot } from "@/lib/state/companySnapshotStore";

export type GetCompanySnapshotInput = {
  company: CompanyRef;
};

export type GetCompanySnapshotData = {
  found: boolean;
  snapshot: CompanySnapshot | null;
};

async function handler(
  input: GetCompanySnapshotInput
): Promise<ToolResult<GetCompanySnapshotData>> {
  const { company } = input;
  const timestamp = nowIso();
  const snap = await getSnapshot(company);

  return {
    tool: "get_company_snapshot",
    company: snap?.company ?? company,
    timestamp,
    confidence: snap ? 100 : 0,
    confidenceLabel: labelFromConfidence(snap ? 100 : 0),
    evidence: [
      {
        kind: "store_read",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: snap
          ? `found snapshot key=${snap.key}; notes=${snap.notes?.length ?? 0}, scoreHistory=${snap.scoreHistory?.length ?? 0}, lastCheckedAt=${snap.lastCheckedAt ?? "n/a"}`
          : "no snapshot for this company key",
      },
    ],
    data: { found: !!snap, snapshot: snap },
    stub: false,
  };
}

export const getCompanySnapshotTool: ToolDefinition<
  GetCompanySnapshotInput,
  GetCompanySnapshotData
> = {
  name: "get_company_snapshot",
  description:
    "Returns the persisted entity record for a company: profile, status, notes, score history, and latest tool outputs.",
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
