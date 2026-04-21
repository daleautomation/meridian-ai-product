// Meridian AI — log_crm_activity tool.
//
// Canonical CRM activity logger. Logs to crmStore AND updates
// companySnapshotStore for backward compat. Also auto-updates
// pipeline status and next-action based on outcome.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { companyKey, nowIso } from "@/lib/mcp/types";
import {
  logActivity,
  getCompanySummary,
  type CrmActivity,
  type ActivityType,
  type ActivityOutcome,
  type CloseRecommendation,
  type NoteTag,
  type CompanyCrmSummary,
} from "@/lib/state/crmStore";
import { logDealAction, setNextAction, setStatus } from "@/lib/state/companySnapshotStore";
import { callClaude } from "@/lib/ai/claudeClient";

export type LogCrmActivityInput = {
  company: CompanyRef;
  activityType: ActivityType;
  outcome?: ActivityOutcome;
  note?: string;
  noteTag?: NoteTag;
  performedBy: string;
  nextAction?: string;
  nextActionDate?: string;
  strategicRecommendation?: CloseRecommendation;
  closeConfidence?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export type LogCrmActivityData = {
  activity: CrmActivity;
  summary: CompanyCrmSummary;
};

async function handler(input: LogCrmActivityInput): Promise<ToolResult<LogCrmActivityData>> {
  const { company, activityType, outcome, note, noteTag, performedBy,
    nextAction, nextActionDate, strategicRecommendation, closeConfidence, summary, metadata } = input;
  const timestamp = nowIso();
  const key = companyKey(company);

  // 0. Claude note interpretation — if note provided but no recommendation, extract signals
  let derivedSummary = summary;
  let derivedRecommendation = strategicRecommendation;
  if (note && note.length > 10 && !strategicRecommendation) {
    try {
      const raw = await callClaude([{ role: "user", content:
        `Interpret this CRM call note for a roofing sales outreach. Return ONLY a JSON object.\n\nNote: "${note}"\nOutcome: ${outcome ?? "unknown"}\n\nJSON format:\n{"summary":"one sentence clean summary","recommendation":"close|negotiate|follow_up|hold|walk_away","signals":["extracted signal 1","signal 2"]}` }],
        "You are a CRM assistant. Extract sales signals from operator notes. Be concise. Return strict JSON only.");
      const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
      const parsed = JSON.parse(trimmed);
      if (parsed.summary) derivedSummary = parsed.summary;
      if (parsed.recommendation && !strategicRecommendation) derivedRecommendation = parsed.recommendation;
    } catch { /* Claude unavailable — proceed without interpretation */ }
  }

  // 1. Log to CRM store
  const activity = await logActivity({
    companyKey: key,
    companyName: company.name,
    performedAt: timestamp,
    activityType,
    performedBy,
    outcome: outcome ?? null,
    note: note ?? "",
    summary: derivedSummary,
    noteTag,
    nextAction,
    nextActionDate,
    strategicRecommendation: derivedRecommendation,
    closeConfidence,
    metadata,
  });

  // 2. Sync to snapshot store (backward compat)
  if (activityType !== "note") {
    await logDealAction(company, {
      type: activityType,
      outcome: outcome ?? undefined,
      note: note ?? undefined,
      performedBy,
    });
  }

  // 3. Auto-update pipeline status based on outcome
  const STATUS_MAP: Record<string, string> = {
    connected: "CALLED",
    interested: "INTERESTED",
    meeting_booked: "QUALIFIED",
    proposal_requested: "PITCHED",
    negotiating: "PITCHED",
    closed_won: "CLOSED_WON",
    closed_lost: "CLOSED_LOST",
    not_interested: "CLOSED_LOST",
  };
  if (outcome && STATUS_MAP[outcome]) {
    await setStatus(company, { status: STATUS_MAP[outcome], changedBy: performedBy, note: `Auto from CRM: ${activityType}` });
  } else if (activityType === "call" || activityType === "email" || activityType === "voicemail") {
    // At minimum mark as contacted
    await setStatus(company, { status: "CONTACTED", changedBy: performedBy }).catch(() => {});
  }

  // 4. Auto-set next action if provided
  if (nextAction) {
    await setNextAction(company, { nextAction, nextActionDate });
  } else if (outcome === "no_answer") {
    // Auto-schedule follow-up
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await setNextAction(company, {
      nextAction: "follow_up_call",
      nextActionDate: tomorrow.toISOString().split("T")[0],
    });
  }

  // 5. Get updated summary
  const crmSummary = await getCompanySummary(key, company.name);

  return {
    tool: "log_crm_activity",
    company,
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [{
      kind: "persistence_write",
      source: "data/crmActivities.json",
      observedAt: timestamp,
      detail: `${activityType} → ${outcome ?? "no outcome"} by ${performedBy}`,
    }],
    data: { activity, summary: crmSummary },
    stub: false,
  };
}

export const logCrmActivityTool: ToolDefinition<LogCrmActivityInput, LogCrmActivityData> = {
  name: "log_crm_activity",
  description:
    "Logs a CRM activity (call, email, meeting, etc.) with outcome, notes, and optional strategic recommendation. Auto-syncs pipeline status and next-action scheduling.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      activityType: { type: "string", description: "call|voicemail|email|text|meeting|proposal_sent|close_attempt|closed_won|closed_lost|note" },
      outcome: { type: "string", description: "connected|no_answer|left_vm|interested|not_interested|meeting_booked|proposal_requested|negotiating|closed_won|closed_lost|follow_up_needed" },
      note: { type: "string" },
      noteTag: { type: "string", description: "call_note|objection|negotiation|internal|meeting_recap" },
      performedBy: { type: "string" },
      nextAction: { type: "string" },
      nextActionDate: { type: "string", description: "ISO date" },
      strategicRecommendation: { type: "string", description: "close|negotiate|follow_up|hold|walk_away" },
      closeConfidence: { type: "number" },
      summary: { type: "string", description: "AI-cleaned summary of the note" },
      metadata: { type: "object" },
    },
    required: ["company", "activityType", "performedBy"],
    additionalProperties: false,
  },
  handler,
};
