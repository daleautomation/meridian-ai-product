// Meridian AI — save_company_snapshot tool.
//
// Persists the latest generate_opportunity_summary (and any previously
// gathered tool results) into data/companySnapshots.json via
// lib/state/companySnapshotStore.ts. Returns the updated snapshot so the
// caller can confirm what was written and when.
//
// This tool intentionally accepts an optional pre-computed summary. If
// none is provided, it runs generate_opportunity_summary itself so a
// single call can inspect + summarize + persist.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { recordToolResult, getSnapshot } from "@/lib/state/companySnapshotStore";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import { inspectWebsiteTool } from "./inspectWebsite";
import { inspectReviewsTool } from "./inspectReviews";
import {
  generateOpportunitySummaryTool,
  type OpportunitySummary,
} from "./generateOpportunitySummary";

export type SaveCompanySnapshotInput = {
  company: CompanyRef;
  summary?: ToolResult<OpportunitySummary>;
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

  // Run inspectors once, persist each independently so the decision engine
  // (lib/scoring/companyDecision.ts) can read hard signals from latest[].
  // If the caller provided a pre-computed summary, trust it and skip the
  // inspector re-run.
  let snapshot: CompanySnapshot;
  let summary: ToolResult<OpportunitySummary>;
  try {
    if (input.summary) {
      summary = input.summary;
    } else {
      const [website, reviews] = await Promise.all([
        inspectWebsiteTool.handler({ company }),
        inspectReviewsTool.handler({ company }),
      ]);
      await recordToolResult(company, website);
      await recordToolResult(company, reviews);
      summary = await generateOpportunitySummaryTool.handler({
        company,
        website,
        reviews,
      });
    }
    snapshot = await recordToolResult(company, summary);
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

  // Confidence here reflects the persistence act, not the underlying
  // summary. The summary carries its own confidence field.
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
    notes: [
      `underlying summary confidence: ${summary.confidence} (${summary.confidenceLabel})`,
    ],
  };
}

export const saveCompanySnapshotTool: ToolDefinition<
  SaveCompanySnapshotInput,
  SaveCompanySnapshotData
> = {
  name: "save_company_snapshot",
  description:
    "Persists a company's latest inspection + summary into the snapshot store. If no summary is provided, it generates one first.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      summary: { type: "object", description: "Optional pre-computed opportunity summary ToolResult" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};

// Convenience re-export for readers (no callers today; future decision
// engine / UI will read snapshots through the store directly).
export { getSnapshot };
