// Meridian AI — set_next_action tool.
//
// Sets the next scheduled action for a company (what to do + when).
// Also optionally captures contact info for the primary contact.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { setNextAction } from "@/lib/state/companySnapshotStore";

export type SetNextActionInput = {
  company: CompanyRef;
  nextAction: string;          // "call" | "follow_up_email" | "send_proposal" | "schedule_meeting"
  nextActionDate?: string;     // ISO date or datetime
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
};

export type SetNextActionData = {
  nextAction: string;
  nextActionDate: string | null;
  contactName: string | null;
};

async function handler(input: SetNextActionInput): Promise<ToolResult<SetNextActionData>> {
  const { company, nextAction, nextActionDate, contactName, contactPhone, contactEmail } = input;
  const timestamp = nowIso();

  if (!nextAction?.trim()) {
    return {
      tool: "set_next_action",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { nextAction: "", nextActionDate: null, contactName: null },
      stub: false,
      error: "missing_next_action",
    };
  }

  const snapshot = await setNextAction(company, {
    nextAction: nextAction.trim(),
    nextActionDate: nextActionDate?.trim(),
    contactName: contactName?.trim(),
    contactPhone: contactPhone?.trim(),
    contactEmail: contactEmail?.trim(),
  });

  return {
    tool: "set_next_action",
    company: snapshot.company,
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `next: ${nextAction}${nextActionDate ? ` on ${nextActionDate}` : ""}`,
      },
    ],
    data: {
      nextAction: snapshot.nextAction ?? nextAction,
      nextActionDate: snapshot.nextActionDate ?? null,
      contactName: snapshot.contactName ?? null,
    },
    stub: false,
  };
}

export const setNextActionTool: ToolDefinition<SetNextActionInput, SetNextActionData> = {
  name: "set_next_action",
  description:
    "Sets the next scheduled action for a company (e.g. follow_up_email on 2026-04-22). Optionally captures contact name/phone/email.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      nextAction: { type: "string", description: "Next action: call | follow_up_email | send_proposal | schedule_meeting" },
      nextActionDate: { type: "string", description: "When to do it (ISO date)" },
      contactName: { type: "string", description: "Primary contact name" },
      contactPhone: { type: "string", description: "Contact phone" },
      contactEmail: { type: "string", description: "Contact email" },
    },
    required: ["company", "nextAction"],
    additionalProperties: false,
  },
  handler,
};
