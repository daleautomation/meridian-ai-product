// Meridian AI — get_calendar_events tool.
//
// Returns CRM activities and follow-up-due events for a date range,
// formatted as calendar-compatible events.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { getCalendarEvents, type CalendarEvent } from "@/lib/state/crmStore";

export type GetCalendarEventsInput = {
  startDate?: string;  // ISO date, default: 7 days ago
  endDate?: string;    // ISO date, default: 7 days from now
};

export type GetCalendarEventsData = {
  events: CalendarEvent[];
  todayCount: number;
  overdueCount: number;
  closedCount: number;
};

async function handler(input: GetCalendarEventsInput): Promise<ToolResult<GetCalendarEventsData>> {
  const timestamp = nowIso();
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 7);
  const defaultEnd = new Date(today);
  defaultEnd.setDate(defaultEnd.getDate() + 7);

  const startDate = input.startDate ?? defaultStart.toISOString().split("T")[0];
  const endDate = input.endDate ?? defaultEnd.toISOString().split("T")[0];
  const todayStr = today.toISOString().split("T")[0];

  const events = await getCalendarEvents(startDate, endDate);

  return {
    tool: "get_calendar_events",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [{
      kind: "store_read",
      source: "data/crmActivities.json",
      observedAt: timestamp,
      detail: `${events.length} events from ${startDate} to ${endDate}`,
    }],
    data: {
      events,
      todayCount: events.filter((e) => e.date === todayStr).length,
      overdueCount: events.filter((e) => e.isOverdue).length,
      closedCount: events.filter((e) => e.isClosed).length,
    },
    stub: false,
  };
}

export const getCalendarEventsTool: ToolDefinition<GetCalendarEventsInput, GetCalendarEventsData> = {
  name: "get_calendar_events",
  description: "Returns CRM activities and follow-up-due events for a date range. Calendar-compatible format.",
  inputSchema: {
    type: "object",
    properties: {
      startDate: { type: "string", description: "ISO date (default: 7 days ago)" },
      endDate: { type: "string", description: "ISO date (default: 7 days from now)" },
    },
    additionalProperties: false,
  },
  handler,
};
