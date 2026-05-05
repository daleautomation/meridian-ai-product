// Meridian AI — Task explanation helpers.
//
// Deterministic, pure copy generators. Given a TaskItem we return a
// readable action label, a one-sentence "why this matters," and a
// human-readable priority label with a short reason. Every Calendar
// surface that renders a task can reach for these without duplicating
// the logic in JSX.

import type { TaskItem, TaskPriority } from "./tasks";

export interface TaskActionExplanation {
  actionLabel: string;
  whyItMatters: string;
}

export interface TaskPriorityExplanation {
  label: "Critical" | "High" | "Medium" | "Low";
  reason: string;
}

const PRIORITY_LABEL: Record<TaskPriority, TaskPriorityExplanation["label"]> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  low:      "Low",
};

function isOverdue(t: TaskItem, now: Date): boolean {
  if (t.status === "done") return false;
  const anchor = t.dueDate ?? t.endTime ?? null;
  if (!anchor) return false;
  return new Date(anchor).getTime() < now.getTime();
}

function dueWithinHours(t: TaskItem, now: Date, hours: number): boolean {
  const anchor = t.startTime ?? t.dueDate ?? null;
  if (!anchor) return false;
  const ms = new Date(anchor).getTime() - now.getTime();
  return ms <= hours * 3_600_000 && ms >= -hours * 3_600_000;
}

// ── Priority explainer ────────────────────────────────────────────────

export function explainTaskPriority(
  task: TaskItem,
  now: Date = new Date(),
): TaskPriorityExplanation {
  const label = PRIORITY_LABEL[task.priority] ?? "Medium";
  const overdue = isOverdue(task, now);
  const hasNext = typeof task.nextAction === "string" && task.nextAction.trim().length > 0;
  const hasRevenue = (task.expectedValue ?? task.revenueImpact ?? 0) > 0;
  const dueToday = dueWithinHours(task, now, 24);

  switch (task.priority) {
    case "critical": {
      if (overdue) {
        return { label, reason: "Already overdue and tied to revenue or timing risk." };
      }
      if (hasNext && (dueToday || task.riskIfMissed === "high")) {
        return { label, reason: "Ready to act on now and tied to revenue or timing risk." };
      }
      return { label, reason: "Time-critical — every hour delays the next move." };
    }
    case "high": {
      if (task.category === "admin" || task.category === "product") {
        return { label, reason: "Important setup work that unlocks high-value outreach." };
      }
      if (hasRevenue) {
        return { label, reason: "Strong opportunity with measurable upside; verify and act." };
      }
      return { label, reason: "Strong opportunity — one step still needs verification." };
    }
    case "medium": {
      if (task.category === "admin") {
        return { label, reason: "Important setup task that unlocks outreach." };
      }
      if (task.category === "followup") {
        return { label, reason: "Keeps a warm lead from cooling off." };
      }
      return { label, reason: "Moves the lead forward without immediate revenue urgency." };
    }
    case "low":
    default:
      return { label, reason: "Useful context — not urgent." };
  }
}

// ── Action explainer ──────────────────────────────────────────────────

const TITLE_CALL = /^Call\s+/i;
const TITLE_FOLLOWUP = /^Follow up with\s+/i;
const TITLE_REVENUE = /^Advance revenue opportunity:\s*/i;
const TITLE_DIAGNOSTIC = /^Complete diagnostic scan:\s*/i;
const TITLE_CONTACT = /^Find missing contact info:\s*/i;

function companyFromTitle(title: string): string | null {
  const candidates = [TITLE_CALL, TITLE_FOLLOWUP, TITLE_REVENUE, TITLE_DIAGNOSTIC, TITLE_CONTACT];
  for (const re of candidates) {
    if (re.test(title)) return title.replace(re, "").trim() || null;
  }
  return null;
}

/**
 * Returns a short action label and a one-sentence reason the operator
 * can read in under two seconds.
 */
export function explainTaskAction(task: TaskItem): TaskActionExplanation {
  const title = task.title ?? "";
  const company =
    companyFromTitle(title) ||
    task.linkedCompany ||
    null;

  // Contact-cleanup
  if (task.id?.endsWith("-contact") || TITLE_CONTACT.test(title) || (task.category === "admin" && title.toLowerCase().includes("contact"))) {
    return {
      actionLabel: company ? `Find missing contact info — ${company}` : "Find missing contact info",
      whyItMatters: "Outreach is blocked until phone or email is verified.",
    };
  }

  // Diagnostic / scan
  if (task.id?.endsWith("-diagnostic") || TITLE_DIAGNOSTIC.test(title) || (task.category === "product" && title.toLowerCase().includes("scan"))) {
    // The title was already chosen by lib/diagnostics/scanStatus.ts
    // (Scan complete / Run website scan / Retry scan / Fix missing
    // contact / Blocked) — keep it as the action label and let the
    // card's nextAction carry the specific next step.
    return {
      actionLabel: title || (company ? `Run scan — ${company}` : "Run scan"),
      whyItMatters: task.nextAction || "Specific scan step required before outreach.",
    };
  }

  // Revenue advance
  if (task.id?.endsWith("-revenue") || TITLE_REVENUE.test(title) || task.category === "revenue") {
    return {
      actionLabel: company ? `Advance the deal — ${company}` : "Advance the revenue opportunity",
      whyItMatters: "There is a measurable opportunity ready to move forward.",
    };
  }

  // Follow-up
  if (task.id?.endsWith("-followup") || TITLE_FOLLOWUP.test(title) || task.category === "followup") {
    return {
      actionLabel: company ? `Follow up — ${company}` : "Follow up with the lead",
      whyItMatters: "Keep the conversation warm and lock the next concrete step.",
    };
  }

  // Call (priority bucket)
  if (task.id?.endsWith("-call") || TITLE_CALL.test(title) || task.category === "priority") {
    return {
      actionLabel: company ? `Call ${company}` : "Call this lead",
      whyItMatters: "This lead has a clear reason to contact now.",
    };
  }

  // Meeting fallback
  if (task.category === "meeting") {
    return {
      actionLabel: title || "Hold this meeting",
      whyItMatters: "Hold the meeting and exit with a written next step.",
    };
  }

  // Personal fallback
  if (task.category === "personal") {
    return {
      actionLabel: title || "Personal commitment",
      whyItMatters: "Honor the commitment.",
    };
  }

  // Generic fallback — never invent a reason.
  return {
    actionLabel: title || "Take the next step",
    whyItMatters: typeof task.nextAction === "string" && task.nextAction.trim().length > 0
      ? task.nextAction.trim()
      : "Move this lead forward.",
  };
}
