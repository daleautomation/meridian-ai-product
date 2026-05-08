// Meridian — Business-day date helpers.
//
// One source of truth for "today" across server and client renders.
// Resolves YYYY-MM-DD in a fixed business timezone (default
// America/Chicago) so the operator console behaves the same regardless
// of the server's locale (Vercel functions run in UTC) or the user's
// wall clock. Use these helpers for:
//
//   • Today queue filtering
//   • Calendar current-day highlight
//   • Schedule / task date grouping
//   • Rollover decisions
//   • Override comparisons
//
// All helpers accept ISO YYYY-MM-DD strings or Date objects and emit
// YYYY-MM-DD strings (the canonical comparable form). Weekend logic
// is workday-only — Sat/Sun never appear in any auto-generated date.

export const DEFAULT_BUSINESS_TIMEZONE = "America/Chicago";

/** Immutable historical launch day for LaborTech. Friday May 8, 2026.
 *  Used ONLY for historical labels ("Day 1 was Friday May 8") and
 *  one-time launch-week UI emphasis. Never anchors auto-scheduling —
 *  the demo schedule still resolves Day One dynamically via
 *  getBusinessTodayWeekdayIso(). */
export const LAUNCH_DAY_ISO = "2026-05-08";

/** True when the operator's business today is the launch day or
 *  earlier. Once we pass launch day this returns false and any
 *  launch-day UI affordances should hide gracefully. */
export function isLaunchDayOrBefore(timezone: string = DEFAULT_BUSINESS_TIMEZONE): boolean {
  return getBusinessTodayIso(timezone) <= LAUNCH_DAY_ISO;
}

const ymdFormatters = new Map<string, Intl.DateTimeFormat>();
function ymdFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = ymdFormatters.get(timezone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  ymdFormatters.set(timezone, fmt);
  return fmt;
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Resolve today's YYYY-MM-DD in the business timezone. Calls Date()
 *  fresh on every invocation so a long-running server doesn't drift
 *  to the day it booted. */
export function getBusinessTodayIso(timezone: string = DEFAULT_BUSINESS_TIMEZONE): string {
  return ymdFormatter(timezone).format(new Date());
}

/** Coerce any ISO datetime / YYYY-MM-DD / Date into the business
 *  timezone's YYYY-MM-DD. Returns "" if the input can't be parsed. */
export function toBusinessDateIso(
  value: string | Date,
  timezone: string = DEFAULT_BUSINESS_TIMEZONE,
): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Already in the canonical form. Don't run it through the
    // formatter — that would shift it across timezones for "00:00 UTC"
    // dates near a tz boundary.
    return value;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return ymdFormatter(timezone).format(d);
}

/** True when the given YYYY-MM-DD is a Sat or Sun. Parses the date
 *  as local-civil so timezone shifts at midnight don't flip the day. */
export function isWeekendIso(dateIso: string): boolean {
  if (typeof dateIso !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  return dow === 0 || dow === 6;
}

/** Push a YYYY-MM-DD forward to the next Mon–Fri. No-op on weekdays.
 *  Used for rollover and weekend-skip semantics across the platform. */
export function nextBusinessDayIso(dateIso: string): string {
  if (typeof dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  while (true) {
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) break;
    dt.setDate(dt.getDate() + 1);
  }
  return ymdLocal(dt);
}

/** Add N business days to a YYYY-MM-DD. Skips weekends. */
export function addBusinessDaysIso(dateIso: string, n: number): string {
  if (typeof dateIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  let added = 0;
  const step = n >= 0 ? 1 : -1;
  const target = Math.abs(n);
  while (added < target) {
    dt.setDate(dt.getDate() + step);
    const dow = dt.getDay();
    if (dow === 0 || dow === 6) continue;
    added++;
  }
  return ymdLocal(dt);
}

/** True if `a` is strictly before `b` (string compare on
 *  YYYY-MM-DD is sound because it sorts chronologically). */
export function isBeforeIso(a: string, b: string): boolean {
  return a < b;
}

/** Resolve "today" coerced to the next business day if today is
 *  itself a weekend. The operator console anchors auto-scheduling
 *  to this — Sat/Sun visits return Monday's view. */
export function getBusinessTodayWeekdayIso(
  timezone: string = DEFAULT_BUSINESS_TIMEZONE,
): string {
  return nextBusinessDayIso(getBusinessTodayIso(timezone));
}

/** Monday of the current business week. The team operating board
 *  always shows Mon-Fri columns; this resolves the leftmost column.
 *  If business today is Sunday, returns the upcoming Monday (because
 *  Sunday rolls forward via the weekday helpers). */
export function getWeekStartIso(timezone: string = DEFAULT_BUSINESS_TIMEZONE): string {
  const today = getBusinessTodayIso(timezone);
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay(); // 0 Sun .. 6 Sat
  const offsetToMonday = dow === 0 ? 1 : 1 - dow;
  dt.setDate(dt.getDate() + offsetToMonday);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Friendly "Mon, May 11" / "Tue, May 12" label for a YYYY-MM-DD.
 *  Used in headers like "Week of {label}". Pure formatter — never
 *  shifts dates across timezones. */
export function formatWeekStartLabel(dateIso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return dateIso;
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
