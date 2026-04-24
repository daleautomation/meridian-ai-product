// Meridian AI — create_follow_up tool.
//
// Schedules a follow-up task against a lead and records the creation as
// a CRM activity so the rep's timeline shows "follow_up_created". Does
// not set next action on the snapshot — that's handled by set_next_action
// when the rep wants the follow-up surfaced in the header.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { companyKey, nowIso } from "@/lib/mcp/types";
import {
  createFollowUp,
  type FollowUpTask,
  type FollowUpTaskType,
} from "@/lib/state/followUpStore";
import { logActivity } from "@/lib/state/crmStore";

export type CreateFollowUpInput = {
  company: CompanyRef;
  taskType: FollowUpTaskType;
  title: string;
  description?: string;
  dueAt?: string;
  assignedUserId?: string;
  createdBy: string;
};

export type CreateFollowUpData = {
  task: FollowUpTask;
};

async function handler(
  input: CreateFollowUpInput
): Promise<ToolResult<CreateFollowUpData>> {
  const { company, taskType, title, description, dueAt, assignedUserId, createdBy } = input;
  const timestamp = nowIso();
  const key = companyKey(company);

  if (!title || !title.trim()) {
    return {
      tool: "create_follow_up",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { task: {} as FollowUpTask },
      stub: false,
      error: "empty_title",
    };
  }

  try {
    const task = await createFollowUp({
      companyKey: key,
      companyName: company.name,
      taskType,
      title: title.trim(),
      description: description?.trim() || undefined,
      dueAt: dueAt || undefined,
      assignedUserId: assignedUserId || createdBy,
      createdBy,
    });

    // Record the creation as a CRM activity so it shows up in the
    // rep's timeline alongside calls / emails / notes.
    await logActivity({
      companyKey: key,
      companyName: company.name,
      performedAt: timestamp,
      activityType: "note",
      performedBy: createdBy,
      outcome: null,
      note: `Follow-up created: ${task.title}${task.dueAt ? ` (due ${task.dueAt})` : ""}`,
      noteTag: "internal",
      metadata: { kind: "follow_up_created", taskId: task.id, taskType: task.taskType },
    });

    return {
      tool: "create_follow_up",
      company,
      timestamp,
      confidence: 95,
      confidenceLabel: "HIGH",
      evidence: [
        {
          kind: "persistence_write",
          source: "data/followUps.json",
          observedAt: timestamp,
          detail: `created task id=${task.id} type=${task.taskType}`,
        },
      ],
      data: { task },
      stub: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist failed";
    return {
      tool: "create_follow_up",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { task: {} as FollowUpTask },
      stub: false,
      error: message,
    };
  }
}

export const createFollowUpTool: ToolDefinition<CreateFollowUpInput, CreateFollowUpData> = {
  name: "create_follow_up",
  description:
    "Schedule a follow-up task against a lead (call, email, case study, pricing, custom). Automatically records a 'follow_up_created' activity on the lead's timeline.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      taskType: {
        type: "string",
        description: "follow_up_call | follow_up_email | send_case_study | send_pricing | custom",
      },
      title: { type: "string", description: "Short title for the follow-up" },
      description: { type: "string", description: "Optional long-form note" },
      dueAt: { type: "string", description: "ISO datetime when the task is due" },
      assignedUserId: { type: "string", description: "User id the task is assigned to" },
      createdBy: { type: "string", description: "User id creating the task" },
    },
    required: ["company", "taskType", "title", "createdBy"],
    additionalProperties: false,
  },
  handler,
};
