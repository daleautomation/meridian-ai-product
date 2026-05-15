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

function isQualifiedStatus(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["qualified", "open", "proposal", "demo", "interested", "warm"].includes(normalized);
}

export function generateWhyNow(input: WhyNowInput): string {
  const days = input.daysSinceTouch;
  const stale = input.staleCategory === "Dormant" || input.staleCategory === "Recovery candidate";

  if (typeof days === "number" && days >= 21) {
    return `No follow-up in ${days} days after prior contact.`;
  }

  if (input.recentActivity === true) {
    return cleanSentence(input.activityLabel) ?? "Recent website update suggests active growth.";
  }

  if (input.priorInterest === true && stale) {
    return "Past interest logged but no recent outreach.";
  }

  if (isQualifiedStatus(input.crmStatus) && stale) {
    return "Previously qualified lead with no recent touch.";
  }

  if (input.hasVerifiedContactPath && stale) {
    return "Reachable contact path exists after a quiet period.";
  }

  if ((input.relationshipFreshness ?? "").toLowerCase() === "cooling") {
    return "Relationship is cooling and still close enough for a soft touch.";
  }

  return "No recent outreach on file.";
}
