// Meridian — Persist a single lead schedule override.
//
// POST body: {
//   leadId: string,
//   workspaceSlug: string,
//   action: "move_today" | "move_tomorrow" | "move_next_week"
//         | "follow_up" | "skip" | "assign_rep" | "clear",
//   repId?: string  // required when action === "assign_rep"
// }
//
// Response: { ok: true, override: ScheduleOverride }
//
// Auth: requires a valid session. The session user id is recorded as
// the override's updatedBy so post-session review can attribute the
// action.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  setOverride,
  todayIso,
  tomorrowIso,
  nextMondayIso,
  validateWeekdayIso,
  type ScheduleOverride,
  type ScheduleOverrideAction,
} from "@/lib/scheduling/overrideStore";
import { makeEvent, writeEvent } from "@/lib/tracking/eventLog";

const VALID_ACTIONS: ScheduleOverrideAction[] = [
  "move_today",
  "move_tomorrow",
  "move_next_week",
  "move_to_date",
  "follow_up",
  "skip",
  "assign_rep",
  "clear",
];

interface OverrideRequest {
  leadId?: unknown;
  workspaceSlug?: unknown;
  action?: unknown;
  repId?: unknown;
  /** Required when action === "move_to_date" — must be a YYYY-MM-DD
   *  weekday in the future or today. */
  scheduledFor?: unknown;
}

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return bad(401, "Unauthorized");

  let body: OverrideRequest;
  try {
    body = (await req.json()) as OverrideRequest;
  } catch {
    return bad(400, "Invalid JSON");
  }

  const leadId = typeof body.leadId === "string" ? body.leadId : "";
  const workspaceSlug = typeof body.workspaceSlug === "string" ? body.workspaceSlug : "";
  const action = body.action as ScheduleOverrideAction;
  const repId = typeof body.repId === "string" ? body.repId : null;

  if (!leadId) return bad(400, "Missing leadId");
  if (!workspaceSlug) return bad(400, "Missing workspaceSlug");
  if (!VALID_ACTIONS.includes(action)) return bad(400, "Invalid action");
  if (action === "assign_rep" && !repId) return bad(400, "assign_rep requires repId");

  const userWorkspaces = session.workspaces ?? [];
  if (!userWorkspaces.includes(workspaceSlug) && session.id !== workspaceSlug) {
    return bad(403, "Workspace not accessible");
  }

  const now = new Date();
  let scheduledFor: string | null = null;
  if (action === "move_today") scheduledFor = todayIso(now);
  if (action === "move_tomorrow") scheduledFor = tomorrowIso(now);
  if (action === "move_next_week") scheduledFor = nextMondayIso(now);
  if (action === "move_to_date") {
    const validated = validateWeekdayIso(body.scheduledFor, now);
    if (!validated) {
      return bad(400, "move_to_date requires a YYYY-MM-DD weekday in the future");
    }
    scheduledFor = validated;
  }

  const override: ScheduleOverride = {
    leadId,
    workspaceSlug,
    action,
    scheduledFor,
    repId: action === "assign_rep" ? repId : null,
    updatedBy: session.id,
    updatedAt: now.toISOString(),
  };

  const persisted = await setOverride(override);

  // Fire-and-forget tracking event so the post-session review
  // captures every scheduling decision the operator makes.
  try {
    await writeEvent(makeEvent({
      eventType: "schedule_override",
      userId: session.id,
      workspace: workspaceSlug,
      leadId,
      metadata: { action, repId, scheduledFor, persisted },
    }));
  } catch { /* fail silent */ }

  // eslint-disable-next-line no-console
  console.log(
    `[schedule-override] action=${action} lead=${leadId} ` +
    `workspace=${workspaceSlug} user=${session.id} persisted=${persisted}`,
  );

  return NextResponse.json({ ok: true, override, persisted });
}
