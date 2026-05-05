// Meridian — calendar visibility filter.
//
// Pure helper. Given a task list, returns the subset the user has
// chosen to render on the calendar. Does NOT touch the underlying
// schedule, decision data, or task generation — display-only.

export type CalendarVisibility = {
  calls: boolean;
  followUps: boolean;
  product: boolean;
  diagnostics: boolean;
  overflow: boolean;
  completed: boolean;
};

export const DEFAULT_CALENDAR_VISIBILITY: CalendarVisibility = {
  calls: true,
  followUps: true,
  product: true,
  diagnostics: true,
  overflow: false,
  completed: false,
};

export type TaskCategory =
  | "calls"
  | "followUps"
  | "product"
  | "diagnostics"
  | "overflow"
  | "completed";

// Loose shape — matches both buildTasksFromLeads output and any other
// task source the calendar might surface.
type TaskLike = {
  title?: string;
  category?: string;
  status?: string;
  tag?: string;
  overflow?: boolean;
  type?: string;
};

const DIAG_HINTS = ["scan", "audit", "diagnostic", "inspect", "site check", "review site"];
const PRODUCT_HINTS = ["setup", "connect", "source", "wire", "configure", "install"];
const FOLLOWUP_HINTS = ["follow up", "follow-up", "followup", "next action", "remind"];

function lc(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
}

function hintMatch(title: string, hints: string[]): boolean {
  if (!title) return false;
  for (const h of hints) if (title.includes(h)) return true;
  return false;
}

export function getTaskCategory(task: TaskLike | null | undefined): TaskCategory {
  if (!task) return "product";
  const status = lc(task.status);
  const category = lc(task.category);
  const title = lc(task.title);
  const tag = lc(task.tag);

  // Completed first — overrides every other classification.
  if (status === "done" || status === "complete" || status === "completed") return "completed";

  // Explicit overflow flag wins next.
  if (task.overflow === true || tag === "overflow") return "overflow";

  // Calls.
  if (
    tag === "call now" ||
    tag === "call this week" ||
    title.startsWith("call ") ||
    category === "priority"
  ) {
    return "calls";
  }

  // Follow-ups.
  if (
    category === "followup" ||
    category === "follow_up" ||
    hintMatch(title, FOLLOWUP_HINTS)
  ) {
    return "followUps";
  }

  // Diagnostics.
  if (category === "diagnostic" || hintMatch(title, DIAG_HINTS)) {
    return "diagnostics";
  }

  // Product / setup / source / configure.
  if (
    category === "product" ||
    category === "setup" ||
    category === "source" ||
    hintMatch(title, PRODUCT_HINTS)
  ) {
    return "product";
  }

  // Unknown shape → bucket as product (the safe operational default
  // so it shows when product visibility is on, hides when off).
  return "product";
}

export function filterCalendarTasks<T extends TaskLike>(
  tasks: T[] | null | undefined,
  visibility: CalendarVisibility,
): T[] {
  if (!Array.isArray(tasks)) return [];
  return tasks.filter((t) => {
    const c = getTaskCategory(t);
    return visibility[c] === true;
  });
}

// Helper for the "Showing: …" summary string the toggle row prints.
const VISIBILITY_LABELS: Record<keyof CalendarVisibility, string> = {
  calls: "Calls",
  followUps: "Follow-ups",
  product: "Product",
  diagnostics: "Diagnostics",
  overflow: "Overflow",
  completed: "Completed",
};

export function summarizeVisibility(visibility: CalendarVisibility): string {
  const on: string[] = [];
  (Object.keys(VISIBILITY_LABELS) as Array<keyof CalendarVisibility>).forEach((k) => {
    if (visibility[k]) on.push(VISIBILITY_LABELS[k]);
  });
  if (on.length === 0) return "Showing: nothing";
  return `Showing: ${on.join(", ")}`;
}

export const VISIBILITY_LABEL_MAP = VISIBILITY_LABELS;
