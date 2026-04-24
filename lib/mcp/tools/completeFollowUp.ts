// Meridian AI — complete_follow_up tool.
//
// Marks a follow-up task as completed and logs a corresponding
// "follow_up_completed" activity so the timeline reflects the close.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import {
  completeFollowUp,
  getFollowUpById,
  type FollowUpTask,
} from "@/lib/state/followUpStore";
import { logActivity } from "@/lib/state/crmStore";

export type CompleteFollowUpInput = {
  taskId: string;
  completedBy: string;
};

export type CompleteFollowUpData = {
  task: FollowUpTask | null;
};

async function handler(
  input: CompleteFollowUpInput
): Promise<ToolResult<CompleteFollowUpData>> {
  const { taskId, completedBy } = input;
  const timestamp = nowIso();

  const existing = await getFollowUpById(taskId);
  const fallbackCompany: CompanyRef = { name: existing?.companyName ?? "" };

  if (!existing) {
    return {
      tool: "complete_follow_up",
      company: fallbackCompany,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { task: null },
      stub: false,
      error: "task_not_found",
    };
  }

  try {
    const task = await completeFollowUp(taskId, completedBy);
    if (task) {
      await logActivity({
        companyKey: task.companyKey,
        companyName: task.companyName,
        performedAt: timestamp,
        activityType: "note",
        performedBy: completedBy,
        outcome: null,
        note: `Follow-up completed: ${task.title}`,
        noteTag: "internal",
        metadata: { kind: "follow_up_completed", taskId: task.id, taskType: task.taskType },
      });
    }
    return {
      tool: "complete_follow_up",
      company: fallbackCompany,
      timestamp,
      confidence: 95,
      confidenceLabel: "HIGH",
      evidence: [
        {
          kind: "persistence_write",
          source: "data/followUps.json",
          observedAt: timestamp,
          detail: `completed task id=${taskId}`,
        },
      ],
      data: { task },
      stub: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist failed";
    return {
      tool: "complete_follow_up",
      company: fallbackCompany,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { task: null },
      stub: false,
      error: message,
    };
  }
}

export const completeFollowUpTool: ToolDefinition<CompleteFollowUpInput, CompleteFollowUpData> = {
  name: "complete_follow_up",
  description:
    "Mark a follow-up task as completed and log a 'follow_up_completed' activity on the lead's timeline.",
  inputSchema: {
    type: "object",
    properties: {
      taskId: { type: "string", description: "Follow-up task id" },
      completedBy: { type: "string", description: "User id completing the task" },
    },
    required: ["taskId", "completedBy"],
    additionalProperties: false,
  },
  handler,
};
