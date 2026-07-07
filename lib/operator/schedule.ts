// Meridian Command — scan scheduling (DST-proof, America/Chicago).
//
// Vercel Cron fires in UTC only, with no timezone support, so "8am Central" drifts
// an hour twice a year under DST. We solve it the robust way: the cron fires at the
// UNION of both DST offsets (13:00,14:00,18:00,19:00 UTC) and this guard lets exactly
// one fire per target proceed — the one whose Central-local hour is 8 or 13. Every
// other fire returns early having done nothing. No drift, no double-scan, ever.

/** The two daily scan slots, in America/Chicago local hours (24h). */
export const SCAN_HOURS_CENTRAL = { morning: 8, midday: 13 } as const;
export type ScanSlot = "morning" | "midday";

/** Current hour (0–23) in America/Chicago for the given instant. */
export function centralHour(nowMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hourCycle: "h23",
  });
  return Number(fmt.format(new Date(nowMs)));
}

/** Which scan slot (if any) this instant matches. null = not a scan hour. */
export function scanSlotFor(nowMs: number): ScanSlot | null {
  const h = centralHour(nowMs);
  if (h === SCAN_HOURS_CENTRAL.morning) return "morning";
  if (h === SCAN_HOURS_CENTRAL.midday) return "midday";
  return null;
}

/** Cron guard: should a cron-triggered scan proceed right now? Manual (admin)
 *  runs bypass this — they always proceed. */
export function shouldCronScanRun(nowMs: number): { run: boolean; slot: ScanSlot | null; centralHour: number } {
  const h = centralHour(nowMs);
  const slot = scanSlotFor(nowMs);
  return { run: slot !== null, slot, centralHour: h };
}
