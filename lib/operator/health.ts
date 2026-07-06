// Meridian Command — operator self-health. Deterministic.
//
// Turns a pipeline result + notification outcome + data freshness + env presence
// into an OperatorRun the status page surfaces quietly.

import type { RealityResult } from "@/lib/home/pipeline";
import type { NotifyResult } from "@/lib/home/notify";
import type { EnvPresence, OperatorRun } from "./types";
import type { StorageMode } from "./store";

const HOUR = 3_600_000;
const STALE_HOURS = 36; // inbox older than this → surfaced as stale

export function envPresence(): EnvPresence {
  const notify = !!(process.env.NTFY_TOPIC?.trim() || process.env.NOTIFY_WEBHOOK_URL?.trim() ||
    (process.env.RESEND_API_KEY?.trim() && process.env.NOTIFY_EMAIL_TO?.trim()));
  return {
    cronSecret: !!process.env.CRON_SECRET?.trim(),
    notificationChannel: notify,
    databaseUrl: !!process.env.DATABASE_URL?.trim(),
    baseUrl: !!(process.env.MERIDIAN_BASE_URL?.trim() || process.env.BASE_URL?.trim()),
  };
}

export function buildRun(args: {
  ownerId: string;
  trigger: "cron" | "manual";
  runAtMs: number;
  result: RealityResult;
  notification: NotifyResult;
  freshness: { gmail: string | null; calendar: string | null };
  storage: StorageMode;
  changeHeadline: string;
}): OperatorRun {
  const runAt = new Date(args.runAtMs).toISOString();
  const connectors = args.result.results.map((r) => ({
    id: r.connector, state: r.health.state, observations: r.collected,
    healthy: r.health.state === "ok",
  }));
  const incompleteConnectors = connectors.filter((c) => !c.healthy && c.id !== "google-contacts").map((c) => c.id);

  const newest = [args.freshness.gmail, args.freshness.calendar]
    .filter(Boolean)
    .map((d) => Date.parse(d as string))
    .sort((a, b) => b - a)[0];
  const freshnessHours = newest ? Math.round((args.runAtMs - newest) / HOUR) : null;
  const stale = freshnessHours === null || freshnessHours > STALE_HOURS;

  // Healthy = the core sensor (gmail) produced data and the notification was sent
  // (or intentionally has no channel configured yet).
  const gmailOk = connectors.find((c) => c.id === "gmail")?.healthy ?? false;
  const notifyOk = args.notification.sent || args.notification.channel === "none";
  const ok = gmailOk && notifyOk && !stale;

  return {
    runId: `${args.ownerId}:${runAt}`,
    ownerId: args.ownerId,
    runAt,
    trigger: args.trigger,
    ok,
    connectors,
    notification: { sent: args.notification.sent, channel: args.notification.channel, detail: args.notification.detail },
    freshnessHours,
    stale,
    incompleteConnectors,
    env: envPresence(),
    storage: args.storage,
    changeSummary: args.changeHeadline,
  };
}
