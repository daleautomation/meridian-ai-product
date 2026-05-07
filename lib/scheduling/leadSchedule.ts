// Meridian — lead-call scheduling helper.
//
// Pure, deterministic. Given a decided lead list (each carrying
// lead.decision.bucket and decision.score) returns a per-lead schedule
// entry assigning the call to a specific weekday in the active week.
//
// Spreads the calls across available weekdays so the calendar isn't
// stacked on a single day. Caller is responsible for stamping the
// `scheduledFor` field back on each lead and rendering it.

export type ScheduleTag = "CALL NOW" | "CALL THIS WEEK" | "WATCH";

export type ScheduleEntry = {
  leadKey: string;
  date: string;          // ISO date, midday so EOD vs midnight ambiguity dies
  tag: ScheduleTag;
  title: string;         // "Call <Company>"
  status: "priority";
};

// Structured overflow entry — what the UI / queue surface reads.
// Carries enough fields to render the queue without re-resolving leads.
export type OverflowEntry = {
  leadKey: string;
  companyName: string;
  trade: string;
  bucket: string;
  score: number;
  rank: number;
};

export type ScheduleResult = {
  entries: ScheduleEntry[];
  byKey: Map<string, ScheduleEntry>;
  perDay: Record<string, { calls: number }>;
  // Leads that didn't fit in the active week. Ordered by bucket
  // priority → score desc → trade priority → company name. The next
  // re-render (after a call is marked done) re-runs allocation so
  // these slots roll into the schedule automatically.
  overflowEntries: OverflowEntry[];
  totals: { callNow: number; callThisWeek: number; watch: number; scheduled: number; overflow: number };
};

export type SchedulableLead = {
  id?: string;
  key?: string;
  companyName?: string;
  name?: string;
  trade?: string;
  moduleId?: string;
  decision?: {
    bucket?: string;
    score?: number;
  };
};

export type ScheduleOptions = {
  weekStartDate: string;             // any ISO datetime; week is computed from it
  maxCallNowPerDay?: number;         // default 6
  maxCallThisWeekPerDay?: number;    // default 8
  maxTotalCallsPerDay?: number;      // default 12 — hard global cap per day
  /** @deprecated alias of maxTotalCallsPerDay */
  maxTotalPerDay?: number;
  includeWatch?: boolean;            // default false
  tradePriority?: Record<string, number>; // lower number = higher priority
  // Lead keys already worked (any CRM call/voicemail/email/etc activity).
  // These never consume a slot in the schedule, which means previously
  // overflowed leads automatically get pulled into the freed capacity.
  completedKeys?: ReadonlySet<string>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoDateKey(d: Date): string {
  // Local-date key (YYYY-MM-DD).
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function middayIso(d: Date): string {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x.toISOString();
}

function mondayOf(date: Date): Date {
  const d = startOfDay(date);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // back to Monday
  return new Date(d.getTime() + offset * DAY_MS);
}

function buildDayPlan(weekStart: Date): { weekdays: Date[]; weekends: Date[] } {
  const monday = mondayOf(weekStart);
  const today = startOfDay(new Date());
  const weekdays: Date[] = [];
  const weekends: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getTime() + i * DAY_MS);
    if (d.getTime() < today.getTime()) continue; // never schedule into the past
    const dow = d.getDay();
    if (dow === 0 || dow === 6) weekends.push(d);
    else weekdays.push(d);
  }
  return { weekdays, weekends };
}

function leadKey(l: SchedulableLead): string {
  return l.id ?? l.key ?? `${l.name ?? l.companyName ?? "lead"}-${Math.random().toString(36).slice(2, 8)}`;
}

function leadTitle(l: SchedulableLead): string {
  return `Call ${l.companyName ?? l.name ?? "lead"}`;
}

function bucketRank(b: string | undefined): number {
  if (b === "Call now") return 0;
  if (b === "Call this week") return 1;
  if (b === "Watch") return 2;
  return 3; // Skip / unknown
}

function comparator(tradePriority?: Record<string, number>) {
  return (a: SchedulableLead, z: SchedulableLead) => {
    const ar = bucketRank(a.decision?.bucket);
    const zr = bucketRank(z.decision?.bucket);
    if (ar !== zr) return ar - zr;
    const as = a.decision?.score ?? 0;
    const zs = z.decision?.score ?? 0;
    if (as !== zs) return zs - as; // score desc
    if (tradePriority) {
      const at = a.trade ?? a.moduleId ?? "";
      const zt = z.trade ?? z.moduleId ?? "";
      const ap = tradePriority[at] ?? Number.MAX_SAFE_INTEGER;
      const zp = tradePriority[zt] ?? Number.MAX_SAFE_INTEGER;
      if (ap !== zp) return ap - zp;
    } else {
      const at = (a.trade ?? a.moduleId ?? "").toLowerCase();
      const zt = (z.trade ?? z.moduleId ?? "").toLowerCase();
      if (at !== zt) return at < zt ? -1 : 1;
    }
    const an = (a.companyName ?? a.name ?? "").toLowerCase();
    const zn = (z.companyName ?? z.name ?? "").toLowerCase();
    if (an !== zn) return an < zn ? -1 : 1;
    return 0;
  };
}

export function buildLeadSchedule(
  leads: SchedulableLead[],
  options: ScheduleOptions,
): ScheduleResult {
  const maxCallNow = Math.max(0, options.maxCallNowPerDay ?? 6);
  const maxCallWeek = Math.max(0, options.maxCallThisWeekPerDay ?? 8);
  const maxTotal = Math.max(
    0,
    options.maxTotalCallsPerDay ?? options.maxTotalPerDay ?? 12,
  );
  const includeWatch = options.includeWatch === true;

  const startSeed = new Date(options.weekStartDate);
  const seed = Number.isFinite(startSeed.getTime()) ? startSeed : new Date();
  const { weekdays } = buildDayPlan(seed);
  const dayPool: Date[] = [...weekdays];
  // HARD weekend exclusion. Auto-scheduling never emits Sat/Sun
  // dates. Leads that exceed weekday capacity drop into the overflow
  // queue and pull forward when a slot opens, rather than spilling
  // onto a non-working day. Manual weekend placement is a separate
  // explicit feature — see app/api/scheduling/override (validateWeekdayIso
  // currently rejects weekends; only relax that under an explicit flag).
  const overflowDays: Date[] = [];

  // Per-day counters — weekday-only by construction.
  const perDay: Record<string, { calls: number; callNow: number; callWeek: number }> = {};
  for (const d of dayPool) {
    perDay[isoDateKey(d)] = { calls: 0, callNow: 0, callWeek: 0 };
  }

  // Sort, then drop completed-keys so previously-overflowed leads
  // get the freed slots automatically.
  const completedKeys = options.completedKeys ?? new Set<string>();
  const sorted = leads
    .filter((l) => !completedKeys.has(leadKey(l)))
    .sort(comparator(options.tradePriority));
  const callNow = sorted.filter((l) => l.decision?.bucket === "Call now");
  const callWeek = sorted.filter((l) => l.decision?.bucket === "Call this week");
  const watch = sorted.filter((l) => l.decision?.bucket === "Watch");

  const entries: ScheduleEntry[] = [];
  const byKey = new Map<string, ScheduleEntry>();
  const overflowLeadsRaw: SchedulableLead[] = [];
  let overflow = 0;

  // Round-robin assignment within capacity.
  function assign(
    pool: SchedulableLead[],
    tag: ScheduleTag,
    perDayCap: number,
    counterField: "callNow" | "callWeek",
  ) {
    if (pool.length === 0) return;
    const days = [...dayPool];
    if (days.length === 0) days.push(...overflowDays); // last resort
    let idx = 0;
    for (const lead of pool) {
      // Find the first day with available capacity, starting from idx
      // and wrapping. This both spreads the load AND respects the caps.
      let placed = false;
      for (let probe = 0; probe < days.length && !placed; probe++) {
        const day = days[(idx + probe) % days.length];
        const k = isoDateKey(day);
        const counts = perDay[k];
        if (counts[counterField] >= perDayCap) continue;
        if (counts.calls >= maxTotal) continue;
        const entry: ScheduleEntry = {
          leadKey: leadKey(lead),
          date: middayIso(day),
          tag,
          title: leadTitle(lead),
          status: "priority",
        };
        entries.push(entry);
        byKey.set(entry.leadKey, entry);
        counts[counterField]++;
        counts.calls++;
        placed = true;
        idx = (idx + probe + 1) % days.length; // advance so next lead favors the next day
      }
      if (!placed) {
        // Weekday capacity exhausted. Drop to the overflow queue
        // instead of spilling onto Sat/Sun. The pull-forward
        // mechanic (next render after a call is marked done) frees
        // the slot and admits the next overflow lead automatically.
        overflow++;
        overflowLeadsRaw.push(lead);
      }
    }
  }

  assign(callNow, "CALL NOW", maxCallNow, "callNow");
  assign(callWeek, "CALL THIS WEEK", maxCallWeek, "callWeek");
  if (includeWatch) {
    // Watch leads share the call-this-week capacity; they just live with a
    // softer tag so the UI can render them differently if it ever wants to.
    assign(watch, "WATCH", maxCallWeek, "callWeek");
  }
  // Skip leads (decision.bucket === "Skip") are intentionally excluded — never scheduled.

  const exposedPerDay: Record<string, { calls: number }> = {};
  for (const [k, v] of Object.entries(perDay)) exposedPerDay[k] = { calls: v.calls };

  // Build the structured overflow queue. Already in priority order
  // because overflowLeadsRaw was populated in the same comparator
  // sequence we used for scheduling.
  const overflowEntries: OverflowEntry[] = overflowLeadsRaw.map((lead, idx) => ({
    leadKey: leadKey(lead),
    companyName: lead.companyName ?? lead.name ?? "(unknown)",
    trade: lead.trade ?? lead.moduleId ?? "",
    bucket: lead.decision?.bucket ?? "",
    score: lead.decision?.score ?? 0,
    rank: idx + 1,
  }));

  return {
    entries,
    byKey,
    perDay: exposedPerDay,
    overflowEntries,
    totals: {
      callNow: callNow.length,
      callThisWeek: callWeek.length,
      watch: watch.length,
      scheduled: entries.length,
      overflow,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// Global helper.
//
// Same algorithm, but defaults tuned for a single workspace-wide pool
// across every trade: one call list, one daily cap. The sort already
// honors trade priority (via tradePriority) for tie-breaks, so feeding
// the merged decided[] into this helper produces a globally-ordered
// schedule where the highest-readiness leads (regardless of trade)
// occupy the earliest slots.
// ──────────────────────────────────────────────────────────────────────
export function buildGlobalLeadSchedule(
  leads: SchedulableLead[],
  options: ScheduleOptions,
): ScheduleResult {
  return buildLeadSchedule(leads, {
    ...options,
    maxCallNowPerDay: options.maxCallNowPerDay ?? 8,
    maxCallThisWeekPerDay: options.maxCallThisWeekPerDay ?? 8,
    maxTotalCallsPerDay: options.maxTotalCallsPerDay ?? options.maxTotalPerDay ?? 12,
    includeWatch: options.includeWatch === true,
    completedKeys: options.completedKeys,
  });
}

// ──────────────────────────────────────────────────────────────────────
// Rolling-horizon team schedule.
//
// Spreads leads across N weeks, respects per-rep capacity, hard-skips
// weekends (unless an existing manual assignment claims one), and
// emits real time-slot ISO strings the calendar can stamp on tasks.
// ──────────────────────────────────────────────────────────────────────

import {
  DEFAULT_TEAM_SCHEDULE_CONFIG,
  isWeekend,
  type TeamScheduleConfig,
} from "./teamScheduleConfig";
import {
  DEFAULT_TEAM_MEMBERS,
  repsForTrade,
  type TeamMember,
} from "./teamMembers";
import {
  classifyLeadTier,
  compareForTier,
  type LeadTier,
  type TierableLead,
} from "./leadTier";

export type AssignmentSource = "auto" | "manual";

export type ScheduleAssignment = {
  leadKey: string;
  companyName: string;
  trade: string;
  date: string;        // YYYY-MM-DD (local)
  startIso: string;    // full ISO datetime
  repId: string;
  tag: ScheduleTag;
  source: AssignmentSource;
  locked: boolean;
  /** Operator-tier classification for the day (CLOSE_NOW/STRONG/TEST). */
  leadTier?: LeadTier;
};

export type RollingScheduleOptions = {
  startDate: string;                       // any ISO datetime; rolling horizon starts at the start-of-week
  horizonWeeks?: number;
  teamMembers?: TeamMember[];
  config?: Partial<TeamScheduleConfig>;
  existingAssignments?: ScheduleAssignment[];
  tradePriority?: Record<string, number>;
  includeWatch?: boolean;
  completedKeys?: ReadonlySet<string>;
};

export type RollingScheduleResult = {
  assignments: ScheduleAssignment[];
  byKey: Map<string, ScheduleAssignment>;
  perDay: Record<
    string,
    {
      calls: number;
      perRep: Record<string, number>;
      perTier: Record<LeadTier, number>;
      perTrade: Record<string, number>;
    }
  >;
  perWeek: Record<string, number>;       // YYYY-MM-DD of Monday → calls in that week
  overflowEntries: OverflowEntry[];
  totals: { scheduled: number; overflow: number };
  weekendSkips: number;
};

const DAY_MS_RT = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfDayLocal(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function mondayOfRT(d: Date): Date {
  const x = startOfDayLocal(d);
  const dow = x.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  return new Date(x.getTime() + offset * DAY_MS_RT);
}
function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((s) => Number(s));
  return { h: Number.isFinite(h) ? h : 9, m: Number.isFinite(m) ? m : 0 };
}
function withTime(date: Date, h: number, m: number): Date {
  const x = new Date(date);
  x.setHours(h, m, 0, 0);
  return x;
}
function buildDailySlots(date: Date, cfg: TeamScheduleConfig): Date[] {
  const start = parseHM(cfg.workHours.start);
  const end = parseHM(cfg.workHours.end);
  const lunchStart = parseHM(cfg.lunchBreak.start);
  const lunchEnd = parseHM(cfg.lunchBreak.end);
  const block = Math.max(5, cfg.callBlockMinutes);
  const slots: Date[] = [];
  let cur = withTime(date, start.h, start.m);
  const last = withTime(date, end.h, end.m);
  const lunchA = withTime(date, lunchStart.h, lunchStart.m);
  const lunchB = withTime(date, lunchEnd.h, lunchEnd.m);
  while (cur.getTime() <= last.getTime()) {
    if (cur.getTime() >= lunchA.getTime() && cur.getTime() < lunchB.getTime()) {
      // skip lunch window
    } else {
      slots.push(new Date(cur));
    }
    cur = new Date(cur.getTime() + block * 60 * 1000);
  }
  return slots;
}

function leadKeyOf(l: SchedulableLead): string {
  return l.id ?? l.key ?? `${l.name ?? l.companyName ?? "lead"}`;
}

function tagForBucket(b: string | undefined): ScheduleTag {
  if (b === "Call now") return "CALL NOW";
  if (b === "Call this week") return "CALL THIS WEEK";
  return "WATCH";
}

export function buildRollingTeamSchedule(
  leads: SchedulableLead[],
  options: RollingScheduleOptions,
): RollingScheduleResult {
  const cfg: TeamScheduleConfig = { ...DEFAULT_TEAM_SCHEDULE_CONFIG, ...(options.config ?? {}) };
  const team = options.teamMembers ?? DEFAULT_TEAM_MEMBERS;
  const horizon = Math.max(1, options.horizonWeeks ?? cfg.schedulingHorizonWeeks);
  const includeWatch = options.includeWatch === true;
  const completedKeys = options.completedKeys ?? new Set<string>();

  // ── Build the rolling weekday list ───────────────────────────
  const seed = new Date(options.startDate);
  const monday = mondayOfRT(Number.isFinite(seed.getTime()) ? seed : new Date());
  const today = startOfDayLocal(new Date());
  const weeks: Date[][] = [];           // weeks[w][i] = day Date
  const weekKeys: string[] = [];
  let weekendSkips = 0;
  for (let w = 0; w < horizon; w++) {
    const wkStart = new Date(monday.getTime() + w * 7 * DAY_MS_RT);
    weekKeys.push(ymd(wkStart));
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(wkStart.getTime() + i * DAY_MS_RT);
      if (d.getTime() < today.getTime()) continue;        // never schedule into the past
      if (cfg.excludeWeekends && isWeekend(d)) {
        weekendSkips++;
        continue;
      }
      days.push(d);
    }
    weeks.push(days);
  }

  // ── Pre-compute slot inventories ─────────────────────────────
  // dayInventory[ymd][repId] = [Date, Date, …] free slots in time order
  const dayInventory: Record<string, Record<string, Date[]>> = {};
  const perDay: Record<
    string,
    {
      calls: number;
      perRep: Record<string, number>;
      perTier: Record<LeadTier, number>;
      perTrade: Record<string, number>;
    }
  > = {};
  for (const wk of weeks) {
    for (const day of wk) {
      const key = ymd(day);
      const slots = buildDailySlots(day, cfg);
      const perRep: Record<string, Date[]> = {};
      for (const r of team) {
        // Each rep gets the full slot list capped to their daily max.
        perRep[r.id] = slots.slice(0, Math.min(slots.length, r.maxCallsPerDay));
      }
      dayInventory[key] = perRep;
      perDay[key] = {
        calls: 0,
        perRep: Object.fromEntries(team.map((r) => [r.id, 0])),
        perTier: { CLOSE_NOW: 0, STRONG: 0, TEST: 0 },
        perTrade: {},
      };
    }
  }

  // ── Apply existing manual assignments (locked, weekend-allowed) ──
  const assignments: ScheduleAssignment[] = [];
  const byKey = new Map<string, ScheduleAssignment>();
  if (Array.isArray(options.existingAssignments)) {
    for (const a of options.existingAssignments) {
      if (!a || !a.leadKey || !a.startIso || !a.repId) continue;
      const dt = new Date(a.startIso);
      if (!Number.isFinite(dt.getTime())) continue;
      const dayKey = ymd(dt);
      // Manual assignments may live on weekends or off-horizon — they
      // always win and are never overwritten.
      const inv = dayInventory[dayKey];
      if (inv && inv[a.repId]) {
        // Remove the slot if it matches an auto-eligible slot.
        inv[a.repId] = inv[a.repId].filter((s) => s.getTime() !== dt.getTime());
      }
      const final: ScheduleAssignment = {
        leadKey: a.leadKey,
        companyName: a.companyName ?? "",
        trade: a.trade ?? "",
        date: dayKey,
        startIso: dt.toISOString(),
        repId: a.repId,
        tag: a.tag ?? "CALL THIS WEEK",
        source: "manual",
        locked: a.locked === false ? false : true,
      };
      assignments.push(final);
      byKey.set(final.leadKey, final);
      if (perDay[dayKey]) {
        perDay[dayKey].calls++;
        perDay[dayKey].perRep[a.repId] = (perDay[dayKey].perRep[a.repId] ?? 0) + 1;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[manual-assignment] lead=${a.leadKey} date=${dayKey} time=${pad2(dt.getHours())}:${pad2(dt.getMinutes())} rep=${a.repId} locked=${final.locked}`,
      );
    }
  }

  // ── Sort + filter callable leads ─────────────────────────────
  const callable = leads
    .filter((l) => !completedKeys.has(leadKeyOf(l)))
    .filter((l) => byKey.has(leadKeyOf(l)) === false)
    .filter((l) => {
      const b = l.decision?.bucket;
      if (b === "Call now" || b === "Call this week") return true;
      if (b === "Watch") return includeWatch;
      return false;
    });

  // ── Group by trade, sort each group by tier → close → urgency ──
  const tradeGroups = new Map<string, SchedulableLead[]>();
  for (const l of callable) {
    const trade = (l.trade ?? l.moduleId ?? "").toLowerCase();
    const list = tradeGroups.get(trade) ?? [];
    list.push(l);
    tradeGroups.set(trade, list);
  }
  for (const [, list] of tradeGroups) {
    list.sort((a, b) => compareForTier(a as TierableLead, b as TierableLead));
  }

  // Trade order — honor the optional tradePriority map first, else
  // alphabetical. Used for round-robin ordering within a day.
  const tradeOrder: string[] = Array.from(tradeGroups.keys()).sort((a, b) => {
    const pa = options.tradePriority?.[a] ?? Number.MAX_SAFE_INTEGER;
    const pb = options.tradePriority?.[b] ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const overflowLeads: SchedulableLead[] = [];

  function placeLeadOnDay(
    lead: SchedulableLead,
    dayKey: string,
    dayCounts: typeof perDay[string],
  ): boolean {
    const trade = (lead.trade ?? lead.moduleId ?? "").toLowerCase();
    const eligibleReps = repsForTrade(team, trade);
    // Load-balance reps: prefer the one with the most remaining capacity.
    const repOrder = eligibleReps.slice().sort((a, b) => {
      const ra = a.maxCallsPerDay - (dayCounts.perRep[a.id] ?? 0);
      const rb = b.maxCallsPerDay - (dayCounts.perRep[b.id] ?? 0);
      return rb - ra;
    });
    for (const rep of repOrder) {
      if ((dayCounts.perRep[rep.id] ?? 0) >= rep.maxCallsPerDay) continue;
      const inv = dayInventory[dayKey]?.[rep.id];
      if (!inv || inv.length === 0) continue;
      const slot = inv.shift();
      if (!slot) continue;
      const tier = classifyLeadTier(lead as TierableLead);
      const tag = tagForBucket(lead.decision?.bucket);
      const final: ScheduleAssignment = {
        leadKey: leadKeyOf(lead),
        companyName: lead.companyName ?? lead.name ?? "",
        trade,
        date: dayKey,
        startIso: slot.toISOString(),
        repId: rep.id,
        tag,
        source: "auto",
        locked: false,
        leadTier: tier,
      };
      assignments.push(final);
      byKey.set(final.leadKey, final);
      dayCounts.calls++;
      dayCounts.perRep[rep.id] = (dayCounts.perRep[rep.id] ?? 0) + 1;
      dayCounts.perTier[tier] = (dayCounts.perTier[tier] ?? 0) + 1;
      dayCounts.perTrade[trade] = (dayCounts.perTrade[trade] ?? 0) + 1;
      return true;
    }
    return false;
  }

  // ── Day-by-day balanced trade round-robin ────────────────────
  //
  // For each day in the rolling horizon:
  //   1. Compute remaining workspace capacity for that day.
  //   2. Round-robin across trades — pulling 1 lead at a time from
  //      each trade group's front (already sorted: CLOSE_NOW first,
  //      then STRONG, then TEST). This keeps every day balanced
  //      across trades AND keeps high-quality leads at the front.
  //   3. If a trade has no room (all reps full / bucket exhausted),
  //      skip it. Continue until the day hits its workspace cap or
  //      no trade has anything left to give.
  //
  // After the rolling horizon is exhausted, anything left in any
  // trade group is overflow — feeds the next render's pool.
  const flatDays: Date[] = [];
  for (const wk of weeks) for (const d of wk) flatDays.push(d);

  for (const day of flatDays) {
    const dayKey = ymd(day);
    const dayCounts = perDay[dayKey];
    if (!dayCounts) continue;
    const cap = cfg.maxCallsPerWorkspacePerDay;
    if (dayCounts.calls >= cap) continue;

    let didPlaceThisRound = true;
    while (didPlaceThisRound && dayCounts.calls < cap) {
      didPlaceThisRound = false;
      // Trade order each round prefers the trade with the FEWEST
      // calls placed so far on this day → strict balance. Within
      // ties we fall back to the static tradeOrder above.
      const roundTrades = tradeOrder.slice().sort((a, b) => {
        const ca = dayCounts.perTrade[a] ?? 0;
        const cb = dayCounts.perTrade[b] ?? 0;
        if (ca !== cb) return ca - cb;
        return tradeOrder.indexOf(a) - tradeOrder.indexOf(b);
      });
      for (const trade of roundTrades) {
        if (dayCounts.calls >= cap) break;
        const list = tradeGroups.get(trade);
        if (!list || list.length === 0) continue;
        const lead = list[0];
        const placed = placeLeadOnDay(lead, dayKey, dayCounts);
        if (placed) {
          list.shift();
          didPlaceThisRound = true;
        } else {
          // Couldn't place on this day — leave at front of group so
          // a later day with available reps can take it. Skip to next
          // trade in this round.
          continue;
        }
      }
    }
  }

  // Any leads still in trade groups after the horizon = overflow.
  for (const trade of tradeOrder) {
    const list = tradeGroups.get(trade);
    if (!list) continue;
    for (const l of list) overflowLeads.push(l);
  }

  // ── Diagnostics ──────────────────────────────────────────────
  const perWeek: Record<string, number> = {};
  for (let w = 0; w < weeks.length; w++) {
    let count = 0;
    for (const day of weeks[w]) count += perDay[ymd(day)]?.calls ?? 0;
    perWeek[weekKeys[w]] = count;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[balanced-schedule] mode=${cfg.distributionMode} horizon=${horizon}w ` +
    `maxPerDay=${cfg.maxCallsPerWorkspacePerDay} maxPerRep=${cfg.maxCallsPerRepPerDay}`,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[team-schedule] horizon=${horizon}w leads=${leads.length} ` +
    `scheduled=${assignments.length} overflow=${overflowLeads.length}`,
  );
  for (let w = 0; w < weeks.length; w++) {
    const weekStartKey = weekKeys[w];
    let weekCalls = 0;
    for (const day of weeks[w]) weekCalls += perDay[ymd(day)]?.calls ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[team-week] start=${weekStartKey} calls=${weekCalls}`);
  }
  for (let w = 0; w < weeks.length; w++) {
    for (const day of weeks[w]) {
      const k = ymd(day);
      const counts = perDay[k];
      if (!counts || counts.calls === 0) continue;
      const repBreakdown = Object.entries(counts.perRep)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `${id}=${n}`)
        .join(" ");
      // eslint-disable-next-line no-console
      console.log(`[team-day] date=${k} calls=${counts.calls} ${repBreakdown}`);
    }
  }
  if (cfg.excludeWeekends && weekendSkips > 0) {
    // eslint-disable-next-line no-console
    console.log(`[weekend-skip] horizonWeeks=${horizon} skipped=${weekendSkips}`);
  }

  // ── Build overflow entries ──
  const overflowEntries: OverflowEntry[] = overflowLeads.map((lead, idx) => ({
    leadKey: leadKeyOf(lead),
    companyName: lead.companyName ?? lead.name ?? "(unknown)",
    trade: lead.trade ?? lead.moduleId ?? "",
    bucket: lead.decision?.bucket ?? "",
    score: lead.decision?.score ?? 0,
    rank: idx + 1,
  }));

  return {
    assignments,
    byKey,
    perDay,
    perWeek,
    overflowEntries,
    totals: { scheduled: assignments.length, overflow: overflowLeads.length },
    weekendSkips,
  };
}
