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

export interface EnvCheckItem {
  key: string; // display label
  ok: boolean;
  vars: string[]; // the exact env var name(s) this check reads
  required: boolean; // hands-off operation requires it
  howTo: string; // exact setup instruction when red
}

/** Every env check the operator needs, with the EXACT var names + setup steps so
 *  the status page can tell the owner precisely what to paste into Vercel. */
export function envChecklist(): EnvCheckItem[] {
  const has = (v?: string | null) => !!v?.trim();
  const ntfy = has(process.env.NTFY_TOPIC);
  const webhook = has(process.env.NOTIFY_WEBHOOK_URL);
  const email = has(process.env.RESEND_API_KEY) && has(process.env.NOTIFY_EMAIL_TO) && has(process.env.NOTIFY_EMAIL_FROM);
  return [
    {
      key: "Cron auth (CRON_SECRET)",
      ok: has(process.env.CRON_SECRET),
      vars: ["CRON_SECRET"],
      required: true,
      howTo: "Vercel → Settings → Environment Variables → add CRON_SECRET = a long random string. Vercel Cron sends it as `Authorization: Bearer …` automatically. Redeploy.",
    },
    {
      key: "Notification channel",
      ok: ntfy || webhook || email,
      vars: ["NTFY_TOPIC", "NOTIFY_WEBHOOK_URL", "RESEND_API_KEY+NOTIFY_EMAIL_TO+NOTIFY_EMAIL_FROM"],
      required: true,
      howTo: "Pick ONE. Easiest: install the ntfy app, subscribe to a topic, set NTFY_TOPIC=<that topic>. Or NOTIFY_WEBHOOK_URL=<Slack/Discord incoming webhook>. Or Resend email: RESEND_API_KEY + NOTIFY_EMAIL_TO + NOTIFY_EMAIL_FROM.",
    },
    {
      key: "Durable snapshots (DATABASE_URL)",
      ok: has(process.env.DATABASE_URL),
      vars: ["DATABASE_URL"],
      required: true,
      howTo: "Set DATABASE_URL to your Neon Postgres connection string (Vercel → Storage → your Neon DB → .env). Without it, snapshots fall back to ephemeral /tmp and 'what changed' resets on cold start.",
    },
    {
      key: "Base URL for links",
      ok: has(process.env.MERIDIAN_BASE_URL) || has(process.env.BASE_URL),
      vars: ["MERIDIAN_BASE_URL"],
      required: false,
      howTo: "Set MERIDIAN_BASE_URL=https://meridianai.work so notification links point at production (defaults to that already).",
    },
  ];
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
