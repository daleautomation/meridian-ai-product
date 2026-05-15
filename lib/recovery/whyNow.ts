import type { StaleCategory } from "@/lib/recovery/staleness";

export type WhyNowInput = {
  daysSinceTouch?: number | null;
  staleCategory?: StaleCategory;
  recentActivity?: boolean;
  activityLabel?: string | null;
  priorInterest?: boolean;
  relationshipFreshness?: string | null;
  crmStatus?: string | null;
  lastAction?: string | null;
  hasVerifiedContactPath?: boolean;
};

function cleanSentence(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function cleanFragment(value: string | null | undefined): string | null {
  const sentence = cleanSentence(value);
  return sentence ? sentence.slice(0, -1) : null;
}

function isQualifiedStatus(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["qualified", "open", "proposal", "demo", "interested", "warm"].includes(normalized);
}

export function generateWhyNow(input: WhyNowInput): string {
  const days = input.daysSinceTouch;
  const stale = input.staleCategory === "Dormant" || input.staleCategory === "Recovery candidate";
  const activity = cleanSentence(input.activityLabel);
  const lastAction = cleanFragment(input.lastAction);

  if (typeof days === "number" && days >= 21) {
    if (activity) {
      return `${activity} Last touch was ${days} days ago, so the follow-up has a real business reason.`;
    }
    if (lastAction) {
      return `Last note: ${lastAction}. No touch for ${days} days, which gives the operator a specific thread to reopen.`;
    }
    if (input.priorInterest === true || isQualifiedStatus(input.crmStatus)) {
      return `Prior interest is on file and the relationship has been quiet for ${days} days. Reopen around the unresolved next step.`;
    }
    if (input.hasVerifiedContactPath && stale) {
      return `Reachable account with ${days} days of silence. Worth a direct, low-pressure re-entry before it goes fully cold.`;
    }
    return `No touch for ${days} days. Enough time has passed for a useful follow-up without forcing urgency.`;
  }

  if (input.recentActivity === true) {
    return activity ?? "Recent account activity gives the operator a timely reason to reconnect.";
  }

  if (input.priorInterest === true && stale) {
    return "Past interest is logged, but no recent outreach has closed the loop.";
  }

  if (isQualifiedStatus(input.crmStatus) && stale) {
    return "Previously qualified account with no recent touch.";
  }

  if (input.hasVerifiedContactPath && stale) {
    return "Reachable contact path exists after a quiet period.";
  }

  if ((input.relationshipFreshness ?? "").toLowerCase() === "cooling") {
    return "Relationship is cooling and still close enough for a soft touch.";
  }

  return "No recent outreach on file.";
}
