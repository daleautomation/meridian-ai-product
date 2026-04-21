// Meridian AI — log_deal_action tool.
//
// Records a sales action (call, email, meeting, etc.) against a company
// snapshot. Persists to dealActions[] and updates lastAction.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { logDealAction, type DealAction } from "@/lib/state/companySnapshotStore";

export type LogDealActionInput = {
  company: CompanyRef;
  type: string;           // "call" | "email" | "voicemail" | "meeting" | "follow_up"
  outcome?: string;       // "connected" | "no_answer" | "left_vm" | "interested" | "not_interested"
  note?: string;
  performedBy: string;
};

export type LogDealActionData = {
  action: DealAction;
  totalActions: number;
};

async function handler(input: LogDealActionInput): Promise<ToolResult<LogDealActionData>> {
  const { company, type, outcome, note, performedBy } = input;
  const timestamp = nowIso();

  if (!type?.trim()) {
    return {
      tool: "log_deal_action",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { action: { type: "", performedBy: "", performedAt: timestamp }, totalActions: 0 },
      stub: false,
      error: "missing_type",
    };
  }

  const { snapshot, action } = await logDealAction(company, {
    type: type.trim(),
    outcome: outcome?.trim(),
    note: note?.trim(),
    performedBy: performedBy || "operator",
  });

  return {
    tool: "log_deal_action",
    company: snapshot.company,
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `logged ${action.type} (${action.outcome ?? "no outcome"}) by ${action.performedBy}`,
      },
    ],
    data: {
      action,
      totalActions: snapshot.dealActions?.length ?? 1,
    },
    stub: false,
  };
}

export const logDealActionTool: ToolDefinition<LogDealActionInput, LogDealActionData> = {
  name: "log_deal_action",
  description:
    "Records a sales action (call, email, voicemail, meeting, follow_up) against a company. Updates lastAction and appends to dealActions history.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      type: { type: "string", description: "Action type: call | email | voicemail | meeting | follow_up" },
      outcome: { type: "string", description: "Outcome: connected | no_answer | left_vm | interested | not_interested" },
      note: { type: "string", description: "Free-text note" },
      performedBy: { type: "string", description: "User ID of the performer" },
    },
    required: ["company", "type", "performedBy"],
    additionalProperties: false,
  },
  handler,
};
