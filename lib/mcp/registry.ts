// Meridian AI — MCP tool registry.
//
// Central index of all tools the MCP layer exposes. New tools land here
// and become available via /api/mcp automatically. This file is the only
// thing the HTTP transport imports — tools stay decoupled from transport.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { inspectWebsiteTool } from "./tools/inspectWebsite";
import { inspectReviewsTool } from "./tools/inspectReviews";
import { generateOpportunitySummaryTool } from "./tools/generateOpportunitySummary";
import { saveCompanySnapshotTool } from "./tools/saveCompanySnapshot";
import { getCompanySnapshotTool } from "./tools/getCompanySnapshot";
import { addCompanyNoteTool } from "./tools/addCompanyNote";
import { setCompanyStatusTool } from "./tools/setCompanyStatus";
import { listCompaniesTool } from "./tools/listCompanies";
import { decideCompanyTool } from "./tools/decideCompany";
import { rankCompaniesTool } from "./tools/rankCompanies";
import { explainRankingTool } from "./tools/explainRanking";
import { createReviewTool } from "./tools/createReview";
import { listPendingReviewsTool } from "./tools/listPendingReviews";
import { resolveReviewTool } from "./tools/resolveReview";
import { findStaleCompaniesTool } from "./tools/findStaleCompanies";
import { refreshCompanyTool } from "./tools/refreshCompany";
import { recordEvalTool } from "./tools/recordEval";
import { listEvalsTool } from "./tools/listEvals";
import { evalSummaryTool } from "./tools/evalSummary";
import { knowledgeAddTool } from "./tools/knowledgeAdd";
import { knowledgeSearchTool } from "./tools/knowledgeSearch";
import { generatePitchTool } from "./tools/generatePitch";
import { importCompaniesTool } from "./tools/importCompanies";
import { prefilterCompaniesTool } from "./tools/prefilterCompanies";
import { batchInspectTool } from "./tools/batchInspect";
import { topOpportunitiesTool } from "./tools/topOpportunities";
import { generateCallScriptTool } from "./tools/generateCallScript";
import { logDealActionTool } from "./tools/logDealAction";
import { setNextActionTool } from "./tools/setNextAction";
import { logCrmActivityTool } from "./tools/logCrmActivity";
import { getCompanyTimelineTool } from "./tools/getCompanyTimeline";
import { getCalendarEventsTool } from "./tools/getCalendarEvents";
import { findBestContactTool } from "./tools/findBestContact";
import { batchResolveContactsTool } from "./tools/batchResolveContacts";
import { setContactPreferencesTool } from "./tools/setContactPreferences";
import { createFollowUpTool } from "./tools/createFollowUp";
import { completeFollowUpTool } from "./tools/completeFollowUp";
import { listFollowUpsTool } from "./tools/listFollowUps";
import { clearCompanyActivityTool } from "./tools/clearCompanyActivity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: ToolDefinition<any, any>[] = [
  // Phase 1 — inspection + persistence
  inspectWebsiteTool,
  inspectReviewsTool,
  generateOpportunitySummaryTool,
  saveCompanySnapshotTool,
  // Phase 2 — entity layer read/write
  getCompanySnapshotTool,
  addCompanyNoteTool,
  setCompanyStatusTool,
  listCompaniesTool,
  // Phase 3 — decision + ranking
  decideCompanyTool,
  rankCompaniesTool,
  // Phase 4 — trust/evidence (head-to-head explanation)
  explainRankingTool,
  // Phase 5 — human review checkpoints
  createReviewTool,
  listPendingReviewsTool,
  resolveReviewTool,
  // Phase 6 — refresh / recheck
  findStaleCompaniesTool,
  refreshCompanyTool,
  // Phase 7 — evaluation ledger (MVP, human-in-the-loop)
  recordEvalTool,
  listEvalsTool,
  evalSummaryTool,
  // Phase 8 — retrieval-ready knowledge base (minimal, vector-compatible interface)
  knowledgeAddTool,
  knowledgeSearchTool,
  // Execution layer — grounded pitch composer (uses snapshot + knowledge)
  generatePitchTool,
  // Wide-funnel lead intelligence pipeline
  importCompaniesTool,
  prefilterCompaniesTool,
  batchInspectTool,
  topOpportunitiesTool,
  // LaborTech execution layer — call scripts + deal pipeline
  generateCallScriptTool,
  logDealActionTool,
  setNextActionTool,
  // CRM layer — activity log, timeline, calendar
  logCrmActivityTool,
  getCompanyTimelineTool,
  getCalendarEventsTool,
  // Contact resolution engine
  findBestContactTool,
  batchResolveContactsTool,
  setContactPreferencesTool,
  // CRM follow-up layer — scheduled tasks with auto-logged activities
  createFollowUpTool,
  completeFollowUpTool,
  listFollowUpsTool,
  // CRM scoped reset — per-company activity wipe (confirm-gated)
  clearCompanyActivityTool,
];

const TOOL_INDEX = new Map(TOOLS.map((t) => [t.name, t]));

export function listTools(): Array<{
  name: string;
  description: string;
  inputSchema: ToolDefinition<unknown, unknown>["inputSchema"];
}> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export async function callTool(
  name: string,
  input: unknown
): Promise<ToolResult<unknown>> {
  const tool = TOOL_INDEX.get(name);
  if (!tool) {
    return {
      tool: name,
      company: { name: "" },
      timestamp: new Date().toISOString(),
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: null,
      stub: false,
      error: `unknown_tool: ${name}`,
    };
  }
  return tool.handler(input);
}

export function hasTool(name: string): boolean {
  return TOOL_INDEX.has(name);
}
