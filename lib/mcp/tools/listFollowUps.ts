// Meridian AI — list_follow_ups tool.
//
// Read surface for the follow-up store. Supports two modes:
//   - scope="company": all tasks for a single company (open + completed).
//   - scope="user":    open tasks assigned to a user, optionally scoped to a
//                      due-date window (today / overdue / upcoming).
//
// This is the tool the UI's Follow-Up card and the Follow-Up Queue view
// call into.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { companyKey, nowIso } from "@/lib/mcp/types";
import {
  getFollowUpsByCompany,
  getOpenFollowUpsByUser,
  getFollowUpsDueWithin,
  type FollowUpTask,
} from "@/lib/state/followUpStore";

export type ListFollowUpsInput = {
  scope: "company" | "user";
  company?: CompanyRef;
  userId?: string;
  dueWindow?: "overdue" | "today" | "upcoming" | "all";
};

export type ListFollowUpsData = {
  tasks: FollowUpTask[];
};

function dayBoundariesIso(): { startOfToday: string; endOfToday: string; now: string } {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  return { startOfToday: start.toISOString(), endOfToday: end.toISOString(), now: now.toISOString() };
}

async function handler(
  input: ListFollowUpsInput
): Promise<ToolResult<ListFollowUpsData>> {
  const timestamp = nowIso();
  const companyRef = input.company ?? { name: "" };

  try {
    let tasks: FollowUpTask[] = [];

    if (input.scope === "company") {
      if (!input.company) {
        return {
          tool: "list_follow_ups",
          company: companyRef,
          timestamp,
          confidence: 0, confidenceLabel: "LOW",
          evidence: [],
          data: { tasks: [] },
          stub: false,
          error: "company_required_for_company_scope",
        };
      }
      tasks = await getFollowUpsByCompany(companyKey(input.company));
    } else {
      if (!input.userId) {
        return {
          tool: "list_follow_ups",
          company: companyRef,
          timestamp,
          confidence: 0, confidenceLabel: "LOW",
          evidence: [],
          data: { tasks: [] },
          stub: false,
          error: "userId_required_for_user_scope",
        };
      }
      const window = input.dueWindow ?? "all";
      if (window === "all") {
        tasks = await getOpenFollowUpsByUser(input.userId);
      } else {
        const { startOfToday, endOfToday, now } = dayBoundariesIso();
        if (window === "overdue") {
          tasks = await getFollowUpsDueWithin("0000-01-01T00:00:00.000Z", now, { assignedUserId: input.userId });
          tasks = tasks.filter((t) => t.dueAt && t.dueAt < now);
        } else if (window === "today") {
          tasks = await getFollowUpsDueWithin(startOfToday, endOfToday, { assignedUserId: input.userId });
        } else if (window === "upcoming") {
          const upcomingEnd = new Date(); upcomingEnd.setDate(upcomingEnd.getDate() + 14);
          tasks = await getFollowUpsDueWithin(endOfToday, upcomingEnd.toISOString(), { assignedUserId: input.userId });
        }
      }
    }

    return {
      tool: "list_follow_ups",
      company: companyRef,
      timestamp,
      confidence: 90,
      confidenceLabel: "HIGH",
      evidence: [
        {
          kind: "persistence_read",
          source: "data/followUps.json",
          observedAt: timestamp,
          detail: `returned ${tasks.length} task(s) scope=${input.scope}${input.dueWindow ? ` dueWindow=${input.dueWindow}` : ""}`,
        },
      ],
      data: { tasks },
      stub: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "read failed";
    return {
      tool: "list_follow_ups",
      company: companyRef,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { tasks: [] },
      stub: false,
      error: message,
    };
  }
}

export const listFollowUpsTool: ToolDefinition<ListFollowUpsInput, ListFollowUpsData> = {
  name: "list_follow_ups",
  description:
    "List follow-up tasks. scope='company' returns all tasks for a lead; scope='user' returns open tasks for a user, optionally filtered by dueWindow (overdue | today | upcoming | all).",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["company", "user"] as const, description: "company | user" },
      company: { type: "object", description: "CompanyRef (required when scope=company)" },
      userId: { type: "string", description: "User id (required when scope=user)" },
      dueWindow: {
        type: "string",
        enum: ["overdue", "today", "upcoming", "all"] as const,
        description: "Optional due-date filter when scope=user",
      },
    },
    required: ["scope"],
    additionalProperties: false,
  },
  handler,
};
