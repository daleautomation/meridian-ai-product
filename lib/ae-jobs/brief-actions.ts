import type {
  ChecklistKey,
  JobOpportunity,
  NeedsDylanCategory,
  OpportunityChecklist,
} from "./types";

export type BriefExecutionAction = "mark_done" | "snooze" | "log_touchpoint";

export interface BriefActionPatch {
  checklist?: Partial<OpportunityChecklist>;
  fields?: Partial<
    Pick<
      JobOpportunity,
      "nextAction" | "followUpDate" | "priority" | "stage" | "notes" | "lastTouchpoint" | "prepRequired" | "waitingOnReply"
    >
  >;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function appendNote(existing: string, note: string): string {
  const trimmed = note.trim();
  if (!trimmed) return existing;
  const stamp = todayIso();
  const line = `[${stamp}] ${trimmed}`;
  return existing.trim() ? `${existing.trim()}\n${line}` : line;
}

/** Deterministic patch for "Mark done" based on the execute-now category. */
export function resolveMarkDonePatch(
  opp: JobOpportunity,
  category: NeedsDylanCategory,
): BriefActionPatch {
  switch (category) {
    case "loom_due":
      return {
        checklist: { loom_recorded: true },
        fields: { prepRequired: false },
      };
    case "follow_up_overdue":
      return {
        checklist: { follow_up_sent: true },
        fields: { followUpDate: null },
      };
    case "prep_required": {
      const checklist: Partial<Record<ChecklistKey, boolean>> = {};
      if (
        (opp.stage === "interview" || opp.stage === "hiring_manager") &&
        !opp.checklist.interview_scheduled
      ) {
        checklist.interview_scheduled = true;
      }
      return {
        checklist,
        fields: { prepRequired: false },
      };
    }
    case "interview_reminder_48h":
    case "interview_reminder_24h":
      return {
        fields: { prepRequired: false },
      };
    default:
      return { fields: { followUpDate: null } };
  }
}

export function resolveSnoozePatch(): BriefActionPatch {
  return {
    fields: { followUpDate: addDays(todayIso(), 2) },
  };
}

export function resolveTouchpointPatch(opp: JobOpportunity, note: string): BriefActionPatch {
  return {
    fields: {
      lastTouchpoint: todayIso(),
      notes: appendNote(opp.notes, note),
    },
  };
}

export function resolveBriefActionPatch(
  opp: JobOpportunity,
  action: BriefExecutionAction,
  options: { category?: NeedsDylanCategory; note?: string } = {},
): BriefActionPatch {
  switch (action) {
    case "mark_done":
      if (!options.category) {
        throw new Error("category required for mark_done");
      }
      return resolveMarkDonePatch(opp, options.category);
    case "snooze":
      return resolveSnoozePatch();
    case "log_touchpoint":
      return resolveTouchpointPatch(opp, options.note ?? "");
    default:
      throw new Error(`Unknown action: ${action as string}`);
  }
}
