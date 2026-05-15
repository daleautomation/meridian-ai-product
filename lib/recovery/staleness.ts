export type StaleCategory =
  | "Recently active"
  | "Cooling"
  | "Dormant"
  | "Recovery candidate";

export type RelationshipFreshness =
  | "fresh"
  | "warm"
  | "cooling"
  | "cold"
  | "dormant"
  | "unknown";

export type StalenessInput = {
  lastContactedAt?: string | Date | null;
  lastActivityAt?: string | Date | null;
  recentActivity?: boolean;
  relationshipFreshness?: RelationshipFreshness | string | null;
  activityWindowDays?: number | null;
  now?: string | Date;
};

export type StalenessResult = {
  staleScore: number;
  staleCategory: StaleCategory;
  daysSinceTouch: number | null;
  lastTouchAt: string | null;
};

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function baseScoreFromTouch(daysSinceTouch: number | null): number {
  if (daysSinceTouch === null) return 72;
  if (daysSinceTouch <= 14) return 12;
  if (daysSinceTouch <= 30) return 28;
  if (daysSinceTouch <= 60) return 52;
  if (daysSinceTouch <= 90) return 70;
  return 86;
}

function freshnessAdjustment(value: string | null | undefined): number {
  switch ((value ?? "unknown").trim().toLowerCase()) {
    case "fresh":
      return -14;
    case "warm":
      return -6;
    case "cooling":
      return 6;
    case "cold":
      return 12;
    case "dormant":
      return 18;
    default:
      return 0;
  }
}

function categoryFromScore(score: number): StaleCategory {
  if (score < 30) return "Recently active";
  if (score < 55) return "Cooling";
  if (score < 75) return "Dormant";
  return "Recovery candidate";
}

export function evaluateStaleness(input: StalenessInput): StalenessResult {
  const now = parseDate(input.now) ?? new Date();
  const lastContactedAt = parseDate(input.lastContactedAt);
  const lastActivityAt = parseDate(input.lastActivityAt);
  const daysSinceTouch = lastContactedAt ? daysBetween(now, lastContactedAt) : null;
  const daysSinceActivity = lastActivityAt ? daysBetween(now, lastActivityAt) : null;
  const activityWindowDays = input.activityWindowDays ?? 30;

  let score = baseScoreFromTouch(daysSinceTouch);
  score += freshnessAdjustment(input.relationshipFreshness);

  if (input.recentActivity === true) {
    score -= 8;
  } else if (daysSinceActivity !== null && daysSinceActivity <= activityWindowDays) {
    score -= 6;
  } else if (daysSinceActivity !== null && daysSinceActivity <= activityWindowDays * 2) {
    score -= 2;
  }

  const staleScore = Math.max(0, Math.min(100, Math.round(score)));

  return {
    staleScore,
    staleCategory: categoryFromScore(staleScore),
    daysSinceTouch,
    lastTouchAt: lastContactedAt ? lastContactedAt.toISOString() : null,
  };
}
