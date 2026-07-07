// Meridian Command — morning-brief notification.
//
// Simplest working channels first, no new dependencies (native fetch). Tries, in
// order: ntfy (phone push), a generic webhook (Slack/Discord/Zapier), then email
// via Resend. If NONE is configured it does not fabricate — it returns sent:false
// with a reason, and the operator logs it. Every channel is opt-in via env.

import type { DailyBrief } from "./brief";

export interface NotifyResult {
  sent: boolean;
  channel: "ntfy" | "webhook" | "email" | "none";
  detail: string;
}

export function baseUrl(): string {
  return (process.env.MERIDIAN_BASE_URL ?? process.env.BASE_URL ?? "https://meridianai.work").replace(/\/$/, "");
}

export interface NotifyMeta {
  /** How many meaningful changes since the last scan (drives the headline). */
  changeCount?: number;
  /** The single most urgent temporal event ("SoftDoes is 28 days overdue…"). */
  topUrgency?: string;
  /** Count of overdue relationships, surfaced in the push. */
  overdueCount?: number;
}

/** Short push: "Meridian scan complete", most-urgent change, top action, link. */
export function buildNotification(brief: DailyBrief, meta: NotifyMeta = {}): { title: string; body: string; url: string } {
  const url = `${baseUrl()}/home`;
  const top = brief.topActions[0];
  const n = meta.changeCount;
  const title = n && n > 0 ? `Meridian scan complete — ${n} change${n === 1 ? "" : "s"}` : "Meridian scan complete";
  const lines: string[] = [];
  if (meta.topUrgency) lines.push(`⏰ ${meta.topUrgency}`);
  if (meta.overdueCount && meta.overdueCount > 0) lines.push(`${meta.overdueCount} overdue.`);
  else if (n !== undefined) lines.push(n === 0 ? "No changes." : `${n} change${n === 1 ? "" : "s"}.`);
  if (top) lines.push(`▶ Do first: ${top.action}`);
  else if (!meta.topUrgency) lines.push("Nothing clears the bar right now.");
  lines.push(`Open: ${url}`);
  return { title, body: lines.join("\n"), url };
}

export async function sendBriefNotification(brief: DailyBrief, meta: NotifyMeta = {}): Promise<NotifyResult> {
  const { title, body, url } = buildNotification(brief, meta);

  // 1) ntfy — phone push, free, no account. Subscribe to the topic in the ntfy app.
  const ntfyTopic = process.env.NTFY_TOPIC?.trim();
  if (ntfyTopic) {
    try {
      const server = (process.env.NTFY_SERVER ?? "https://ntfy.sh").replace(/\/$/, "");
      const res = await fetch(`${server}/${ntfyTopic}`, {
        method: "POST",
        headers: { Title: title, Click: url, Tags: "briefcase" },
        body,
      });
      if (res.ok) return { sent: true, channel: "ntfy", detail: `pushed to ntfy topic ${ntfyTopic}` };
    } catch (err) {
      // fall through to next channel
      console.error("[notify] ntfy failed", err);
    }
  }

  // 2) Generic webhook — Slack/Discord/Zapier/Make.
  const webhook = process.env.NOTIFY_WEBHOOK_URL?.trim();
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${title}*\n${body}`, title, body, url }),
      });
      if (res.ok) return { sent: true, channel: "webhook", detail: "posted to NOTIFY_WEBHOOK_URL" };
    } catch (err) {
      console.error("[notify] webhook failed", err);
    }
  }

  // 3) Email via Resend (HTTP API, no SDK).
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.NOTIFY_EMAIL_TO?.trim();
  const from = process.env.NOTIFY_EMAIL_FROM?.trim();
  if (resendKey && to && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: title, text: body }),
      });
      if (res.ok) return { sent: true, channel: "email", detail: `emailed ${to} via Resend` };
      return { sent: false, channel: "email", detail: `Resend error ${res.status}` };
    } catch (err) {
      return { sent: false, channel: "email", detail: `Resend failed: ${String(err)}` };
    }
  }

  return { sent: false, channel: "none", detail: "no notification channel configured (set NTFY_TOPIC, NOTIFY_WEBHOOK_URL, or RESEND_API_KEY+NOTIFY_EMAIL_TO/FROM)" };
}
