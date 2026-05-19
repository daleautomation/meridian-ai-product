// Meridian — save_company_snapshot tool.
//
// Persists the latest deterministic inspector results (website + reviews)
// into the snapshot store via lib/state/companySnapshotStore.ts. The
// AI-generated opportunity summary that used to be recorded alongside
// the inspectors was removed in the AI-theater removal pass: every
// signal persisted here is now observable and source-traceable.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { recordToolResult, getSnapshot } from "@/lib/state/companySnapshotStore";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import { inspectWebsiteTool } from "./inspectWebsite";
import { inspectReviewsTool } from "./inspectReviews";

export type SaveCompanySnapshotInput = {
  company: CompanyRef;
};

export type SaveCompanySnapshotData = {
  key: string;
  updatedAt: string;
  latestTools: string[];
  historyCount: number;
};

async function handler(
  input: SaveCompanySnapshotInput
): Promise<ToolResult<SaveCompanySnapshotData>> {
  const { company } = input;
  const timestamp = nowIso();

  let snapshot: CompanySnapshot;
  try {
    const [website, reviews] = await Promise.all([
      inspectWebsiteTool.handler({ company }),
      inspectReviewsTool.handler({ company }),
    ]);
    await recordToolResult(company, website);
    snapshot = await recordToolResult(company, reviews);
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist failed";
    return {
      tool: "save_company_snapshot",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [
        {
          kind: "persistence_error",
          source: "companySnapshotStore",
          observedAt: timestamp,
          detail: message,
        },
      ],
      data: { key: "", updatedAt: "", latestTools: [], historyCount: 0 },
      stub: false,
      error: message,
    };
  }

  return {
    tool: "save_company_snapshot",
    company: snapshot.company,
    timestamp,
    confidence: 95,
    confidenceLabel: labelFromConfidence(95),
    evidence: [
      {
        kind: "persistence_write",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `wrote snapshot key=${snapshot.key}, tools=${Object.keys(snapshot.latest).length}, history=${snapshot.history.length}`,
      },
    ],
    data: {
      key: snapshot.key,
      updatedAt: snapshot.updatedAt,
      latestTools: Object.keys(snapshot.latest),
      historyCount: snapshot.history.length,
    },
    stub: false,
  };
}

export const saveCompanySnapshotTool: ToolDefinition<
  SaveCompanySnapshotInput,
  SaveCompanySnapshotData
> = {
  name: "save_company_snapshot",
  description:
    "Persists a company's latest deterministic inspector results (website + reviews) into the snapshot store.",
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

// Convenience re-export for readers (no callers today; future decision
// engine / UI will read snapshots through the store directly).
export { getSnapshot };
