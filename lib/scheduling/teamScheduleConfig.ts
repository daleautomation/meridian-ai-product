// Meridian — team scheduling configuration.
//
// Single source of truth for the operator team's working hours, daily
// caps, and scheduling horizon. The auto-scheduler reads from this;
// manual overrides do not.

export type DistributionMode = "balanced" | "packed";

export type TeamScheduleConfig = {
  workDays: ("monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday")[];
  /** HARD constraint. When true the auto-scheduler never assigns to Sat/Sun. */
  excludeWeekends: boolean;
  workHours: { start: string; end: string }; // 24h "HH:MM"
  callBlockMinutes: number;
  followUpBlockMinutes: number;
  productBlockMinutes: number;
  maxCallsPerRepPerDay: number;
  maxCallsPerWorkspacePerDay: number;
  maxTasksPerDay: number;
  schedulingHorizonWeeks: number;
  /** Lunch window (24h, end-exclusive) when no calls are scheduled. */
  lunchBreak: { start: string; end: string };
  /**
   * `balanced` (default): round-robin across days — each new lead lands
   * on the least-loaded day in its tier's preferred week. No day gets
   * stacked before the others fill.
   * `packed`: legacy first-fit — fills today before moving to tomorrow.
   */
  distributionMode: DistributionMode;
};

export const DEFAULT_TEAM_SCHEDULE_CONFIG: TeamScheduleConfig = {
  workDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  excludeWeekends: true,
  // Extended end-of-day to 17:00 so a 9-hour window minus a 1-hour
  // lunch yields enough 18-minute slots to actually fit 20 calls/day
  // workspace-wide (10/rep × 2 reps).
  workHours: { start: "09:00", end: "17:00" },
  callBlockMinutes: 18,
  followUpBlockMinutes: 15,
  productBlockMinutes: 30,
  // Daily-volume target: 20 high-quality leads/day across the team.
  maxCallsPerRepPerDay: 10,
  maxCallsPerWorkspacePerDay: 20,
  maxTasksPerDay: 60,
  schedulingHorizonWeeks: 4,
  lunchBreak: { start: "12:00", end: "13:00" },
  distributionMode: "balanced",
};

export function isWeekend(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

/** Advance to the next Mon–Fri. If the input is already a weekday,
 *  returns a copy of that date unchanged. Used by the global scheduler
 *  + manual override surfaces to guarantee no auto-generated date
 *  ever lands on Sat/Sun. Pure — never mutates input. */
export function nextBusinessDay(date: Date): Date {
  const out = new Date(date);
  while (isWeekend(out)) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}
