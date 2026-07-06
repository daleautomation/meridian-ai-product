// Meridian — operator status. For Dylan only. Very small. Quietly shows whether
// the autonomous morning operator is healthy. No product data, just its heartbeat.

import { getLatestRun } from "@/lib/operator/store";
import { envPresence } from "@/lib/operator/health";
import { getLatestDailyReview } from "@/lib/review/store";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = {
  maxWidth: 620, margin: "0 auto", padding: "48px 24px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#e6e6e6", background: "#0b0d12", minHeight: "100vh", lineHeight: 1.6,
};
const muted: React.CSSProperties = { color: "#8a94a6" };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #171b23" };

function dot(ok: boolean) {
  return <span style={{ color: ok ? "#3ba55d" : "#d9534f" }}>{ok ? "● green" : "● red"}</span>;
}

export default async function OperatorStatus() {
  const run = await getLatestRun("dylan").catch(() => null);
  const review = await getLatestDailyReview("dylan").catch(() => null);
  const env = envPresence();

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Operator status</h1>
      <p style={{ ...muted, fontSize: 13 }}>
        <a href="/home" style={{ color: "#7fb2ff" }}>← back to brief</a>
      </p>

      {!run && (
        <p style={muted}>No operator run recorded yet. The first 7am cron (or the &quot;Run manual refresh&quot; button on /home) will populate this.</p>
      )}

      {run && (
        <>
          <div style={{ margin: "16px 0" }}>
            <div style={row}><span style={muted}>Overall</span>{dot(run.ok)}</div>
            <div style={row}><span style={muted}>Last scan</span><span>{run.runAt.slice(0, 16).replace("T", " ")} UTC ({run.trigger})</span></div>
            <div style={row}><span style={muted}>Last notification</span><span>{run.notification.sent ? `sent · ${run.notification.channel}` : `not sent · ${run.notification.channel}`}</span></div>
            <div style={row}><span style={muted}>Reality freshness</span><span>{run.freshnessHours === null ? "unknown" : `${run.freshnessHours}h old`} {run.stale ? "· ⚠ stale" : ""}</span></div>
            <div style={row}><span style={muted}>Storage</span><span>{run.storage}</span></div>
            <div style={row}><span style={muted}>Change</span><span style={{ maxWidth: 320, textAlign: "right" }}>{run.changeSummary}</span></div>
          </div>

          <h2 style={{ fontSize: 13, ...muted, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 20 }}>Connectors</h2>
          {run.connectors.map((c) => (
            <div key={c.id} style={row}><span style={muted}>{c.id}</span><span>{dot(c.healthy)} · {c.observations} obs</span></div>
          ))}
          {run.incompleteConnectors.length > 0 && (
            <p style={{ color: "#d9a441", fontSize: 13 }}>Incomplete: {run.incompleteConnectors.join(", ")}</p>
          )}
        </>
      )}

      {review && (
        <>
          <h2 style={{ fontSize: 13, ...muted, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 20 }}>Last nightly review ({review.date})</h2>
          <div style={row}><span style={muted}>Recommendation accuracy</span><span>{review.accuracy.accuracyPct === null ? "unknown (no feedback)" : `${review.accuracy.accuracyPct}% of ${review.accuracy.scored} scored`}</span></div>
          <div style={row}><span style={muted}>Produced value</span><span>{review.narrative.producedValue.join(", ") || "—"}</span></div>
          <div style={row}><span style={muted}>Failed</span><span>{review.narrative.failed.join(", ") || "—"}</span></div>
          <div style={{ padding: "6px 0", ...muted, fontSize: 13 }}>Believe differently: {review.narrative.believeDifferently.join(" · ")}</div>
        </>
      )}

      <h2 style={{ fontSize: 13, ...muted, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 20 }}>Environment</h2>
      <div style={row}><span style={muted}>CRON_SECRET (cron auth)</span>{dot(env.cronSecret)}</div>
      <div style={row}><span style={muted}>Notification channel</span>{dot(env.notificationChannel)}</div>
      <div style={row}><span style={muted}>DATABASE_URL (durable snapshots)</span>{dot(env.databaseUrl)}</div>
      {(!env.cronSecret || !env.notificationChannel) && (
        <p style={{ color: "#d9a441", fontSize: 13, marginTop: 10 }}>
          Set the red items in Vercel → Settings → Environment Variables, then redeploy, for fully hands-off mornings.
        </p>
      )}
    </main>
  );
}
