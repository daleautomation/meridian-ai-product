// Meridian — operator status. For Dylan only. Shows whether the autonomous
// operator can run hands-off: its last scan, connector coverage, nightly review,
// and — critically — the EXACT env vars still missing, with setup steps.

import { getLatestRun } from "@/lib/operator/store";
import { envChecklist } from "@/lib/operator/health";
import { getConnectorCoverage } from "@/lib/operator/coverage";
import { scanSlotFor } from "@/lib/operator/schedule";
import { getLatestDailyReview } from "@/lib/review/store";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = {
  maxWidth: 720, margin: "0 auto", padding: "40px 20px 64px",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
  color: "#e6e6e6", background: "#0b0d12", minHeight: "100vh", lineHeight: 1.55,
};
const muted: React.CSSProperties = { color: "#8a94a6" };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid #171b23" };
const head: React.CSSProperties = { fontSize: 12, color: "#8a94a6", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 26, marginBottom: 6, fontWeight: 600 };

function dot(ok: boolean, amber = false) {
  const color = ok ? "#3ba55d" : amber ? "#d9a441" : "#d9534f";
  return <span style={{ color, whiteSpace: "nowrap" }}>{ok ? "● green" : amber ? "● amber" : "● red"}</span>;
}

export default async function OperatorStatus() {
  const run = await getLatestRun("dylan").catch(() => null);
  const review = await getLatestDailyReview("dylan").catch(() => null);
  const env = envChecklist();
  const coverage = await getConnectorCoverage();
  const missingRequired = env.filter((e) => e.required && !e.ok);

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Operator status</h1>
      <p style={{ ...muted, fontSize: 13 }}>
        <a href="/home" style={{ color: "#7fb2ff" }}>← back to dashboard</a>
      </p>

      {missingRequired.length > 0 && (
        <div style={{ background: "#2a1416", border: "1px solid #5a2a2e", borderRadius: 10, padding: "12px 14px", marginTop: 14 }}>
          <div style={{ color: "#ff8a8a", fontWeight: 600, fontSize: 14 }}>
            {missingRequired.length} setting{missingRequired.length === 1 ? "" : "s"} still needed for hands-off operation
          </div>
          <div style={{ ...muted, fontSize: 12, marginTop: 2 }}>
            Missing: {missingRequired.flatMap((e) => e.vars).join(", ")}. Steps below.
          </div>
        </div>
      )}

      {/* ── Last scan ─────────────────────────────────────────────── */}
      <h2 style={head}>Last scan</h2>
      {!run && <p style={muted}>No scan recorded yet. The next 8am/1pm Central cron (or &quot;Run manual refresh&quot; on the dashboard) will populate this.</p>}
      {run && (
        <>
          <div style={row}><span style={muted}>Overall</span>{dot(run.ok)}</div>
          <div style={row}><span style={muted}>Ran at</span><span>{run.runAt.slice(0, 16).replace("T", " ")} UTC ({run.trigger})</span></div>
          <div style={row}><span style={muted}>Notification</span><span>{run.notification.sent ? `sent · ${run.notification.channel}` : `not sent · ${run.notification.detail}`}</span></div>
          <div style={row}><span style={muted}>Data freshness</span><span>{run.freshnessHours === null ? "unknown" : `${run.freshnessHours}h old`}{run.stale ? " · ⚠ stale" : ""}</span></div>
          <div style={row}><span style={muted}>Storage</span><span>{run.storage}{run.storage !== "neon" ? " · ⚠ not durable" : ""}</span></div>
          <div style={row}><span style={muted}>Change</span><span style={{ maxWidth: 340, textAlign: "right" }}>{run.changeSummary}</span></div>
        </>
      )}

      {/* ── Connector coverage (what's actually scanned) ──────────── */}
      <h2 style={head}>Connector coverage</h2>
      {coverage.map((c) => (
        <div key={c.id} style={{ padding: "8px 0", borderBottom: "1px solid #171b23" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14 }}>{c.channel}</span>
            {dot(c.state === "ok", c.state !== "ok")}
          </div>
          <div style={{ ...muted, fontSize: 12 }}>{c.scans}</div>
          <div style={{ color: "#5b6472", fontSize: 11 }}>{c.source} — {c.detail}</div>
        </div>
      ))}
      {run && run.connectors.length > 0 && (
        <p style={{ ...muted, fontSize: 12, marginTop: 8 }}>
          Last scan observations: {run.connectors.map((c) => `${c.id} ${c.observations}`).join(" · ")}
        </p>
      )}

      {/* ── Environment (exact vars + setup) ──────────────────────── */}
      <h2 style={head}>Environment</h2>
      {env.map((e) => (
        <div key={e.key} style={{ padding: "8px 0", borderBottom: "1px solid #171b23" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14 }}>{e.key}{!e.required && <span style={{ ...muted, fontSize: 11 }}> (optional)</span>}</span>
            {dot(e.ok, !e.required && !e.ok)}
          </div>
          {!e.ok && (
            <div style={{ marginTop: 3 }}>
              <div style={{ color: "#d9a441", fontSize: 12 }}>Set: <code>{e.vars.join(" or ")}</code></div>
              <div style={{ ...muted, fontSize: 12 }}>{e.howTo}</div>
            </div>
          )}
        </div>
      ))}

      {/* ── Schedule ──────────────────────────────────────────────── */}
      <h2 style={head}>Schedule</h2>
      <div style={row}><span style={muted}>Scans</span><span>8:00 AM &amp; 1:00 PM America/Chicago (DST-proof)</span></div>
      <div style={row}><span style={muted}>Cron (UTC)</span><span>13,14,18,19 · guarded to Central 8 &amp; 13</span></div>
      <div style={row}><span style={muted}>Right now</span><span>{scanSlotFor(Date.now()) ? `scan hour (${scanSlotFor(Date.now())})` : "between scans"}</span></div>

      {/* ── Nightly review ────────────────────────────────────────── */}
      {review && (
        <>
          <h2 style={head}>Last nightly review ({review.date})</h2>
          <div style={row}><span style={muted}>Recommendation accuracy</span><span>{review.accuracy.accuracyPct === null ? "unknown (no feedback yet)" : `${review.accuracy.accuracyPct}% of ${review.accuracy.scored} scored`}</span></div>
          <div style={{ ...muted, fontSize: 13, padding: "6px 0" }}>Believe differently: {review.narrative.believeDifferently.join(" · ") || "—"}</div>
        </>
      )}
    </main>
  );
}
