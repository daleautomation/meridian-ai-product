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

  // Phrasings below are governed by docs/copywriting-principles.md
  // (banned-phrase list) and docs/scoring-principles.md (every line must
  // anchor on the observable signal that drove it). Banned tropes removed:
  //   - "so the follow-up has a real business reason"
  //   - "the operator" used in third person inside a reader-facing line
  //   - "low-pressure re-entry"
  //   - "to reconnect"

  if (typeof days === "number" && days >= 21) {
    if (activity) {
      // Activity boost from a CSV-supplied activityLabel column.
      return `${activity} The last meaningful interaction was ${days} days ago — recent enough to anchor a call on the original thread.`;
    }
    if (lastAction) {
      // Quote the customer's exact note. The note text is the signal.
      return `The last note reads "${lastAction}." ${days} days have passed without a closing move, which keeps the original thread the cleanest way back in.`;
    }
    if (input.priorInterest === true || isQualifiedStatus(input.crmStatus)) {
      return `Previously qualified and quiet for ${days} days. The original yes is still on the record — reopen around the unresolved next step.`;
    }
    if (input.hasVerifiedContactPath && stale) {
      return `Contact path on file; ${days} days of silence on an account that was already reachable is the cleanest recovery window.`;
    }
    return `${days} days of silence with no closed-out reason. Worth a single, specific check-in before it slides out of the recovery window.`;
  }

  if (input.recentActivity === true) {
    return activity ?? "The account has shown movement on their end while we paused. A targeted reopen meets them where they are.";
  }

  if (input.priorInterest === true && stale) {
    return "Past interest is logged, but no recent outreach has closed the loop.";
  }

  if (isQualifiedStatus(input.crmStatus) && stale) {
    return "Previously qualified account with no recent touch.";
  }

  if (input.hasVerifiedContactPath && stale) {
    return "Contact path is still warm after a quiet stretch. Worth a single, narrow check-in.";
  }

  if ((input.relationshipFreshness ?? "").toLowerCase() === "cooling") {
    return "Relationship is cooling and still close enough for a soft touch.";
  }

  return "No recent outreach on file.";
}
