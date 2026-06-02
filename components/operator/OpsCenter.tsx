// Meridian Operations Center — founder-facing surface.
//
// Renders the consolidated BLOCKING / REVIEW / HEALTHY snapshot produced
// by `npm run ops` (data/ops/ops-report.json). Display-only: it reads the
// snapshot and groups it. No scoring, no Neon, no product logic.

import type { CSSProperties } from "react";
import type { OpsReport, OpsStatus, OpsCheckResult } from "@/lib/ops/opsCenter";

const TONE: Record<OpsStatus, { bg: string; fg: string; glyph: string }> = {
  BLOCKING: { bg: "#FCE8E6", fg: "#B3261E", glyph: "✗" },
  REVIEW: { bg: "#FEF3C7", fg: "#92400E", glyph: "▲" },
  HEALTHY: { bg: "#EDF5F0", fg: "#3D7A5C", glyph: "✓" },
};

const ORDER: OpsStatus[] = ["BLOCKING", "REVIEW", "HEALTHY"];

export default function OpsCenter({ report }: { report: OpsReport | null }) {
  if (!report) {
    return (
      <main style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.eyebrow}>Meridian Operations Center</div>
          <h1 style={styles.title}>No snapshot yet</h1>
          <p style={styles.subtitle}>
            Run <code style={styles.code}>npm run ops</code> to generate the operational status report.
          </p>
        </header>
      </main>
    );
  }

  const tone = TONE[report.overall];
  const generated = formatTimestamp(report.generatedAt);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div style={styles.eyebrow}>Meridian Operations Center</div>
        <div style={{ ...styles.banner, background: tone.bg, color: tone.fg }}>
          <span style={styles.bannerGlyph}>{tone.glyph}</span>
          <span style={styles.bannerStatus}>{report.overall}</span>
          <span style={styles.bannerCounts}>
            {report.counts.blocking} blocking · {report.counts.review} review · {report.counts.healthy} healthy
          </span>
        </div>
        <p style={styles.subtitle}>Generated {generated} · consolidates existing validation checks only</p>
      </header>

      {ORDER.map((status) => {
        const rows = report.checks.filter((c) => c.status === status);
        if (rows.length === 0) return null;
        return (
          <section key={status} style={styles.section}>
            <h2 style={{ ...styles.sectionTitle, color: TONE[status].fg }}>
              {TONE[status].glyph} {status} <span style={styles.sectionCount}>({rows.length})</span>
            </h2>
            <div style={styles.cardList}>
              {rows.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </div>
          </section>
        );
      })}

      <section style={styles.section}>
        <h2 style={{ ...styles.sectionTitle, color: TONE[deploymentTone(report)].fg }}>
          {TONE[deploymentTone(report)].glyph} Deployment
        </h2>
        <div style={styles.cardList}>
          <div style={styles.row}>
            <span style={styles.rowLabel}>{report.deployment.branch} @ {report.deployment.head}</span>
            <span style={styles.rowDetail}>{report.deployment.note}</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function CheckRow({ check }: { check: OpsCheckResult }) {
  const tone = TONE[check.status];
  return (
    <div style={styles.row}>
      <span style={{ ...styles.categoryChip, color: tone.fg, background: tone.bg }}>{check.category}</span>
      <span style={styles.rowLabel}>{check.label}</span>
      <span style={styles.rowDetail}>{check.detail}</span>
      {check.outcome !== "PASS" ? (
        <span style={styles.outcomeChip}>{check.outcome.toLowerCase().replace("_", " ")}</span>
      ) : null}
    </div>
  );
}

/** Deployment posture mirrors the runner's deploymentStatus() result; we
 *  recompute the badge from the persisted facts so the surface stays a
 *  pure renderer of the snapshot. */
function deploymentTone(report: OpsReport): OpsStatus {
  const d = report.deployment;
  return !d.ciConfigured || !d.productionTracksMain ? "REVIEW" : "HEALTHY";
}

function formatTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toUTCString();
}

const styles: Record<string, CSSProperties> = {
  shell: { maxWidth: "920px", margin: "0 auto", padding: "32px 24px", fontFamily: "system-ui, sans-serif", color: "#1F2937" },
  header: { marginBottom: "24px" },
  eyebrow: { fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", color: "#6B7280", fontWeight: 600 },
  title: { margin: "6px 0", fontSize: "24px", fontWeight: 700 },
  subtitle: { margin: "8px 0 0", color: "#6B7280", fontSize: "13px" },
  code: { background: "#F3F4F6", padding: "1px 6px", borderRadius: "4px", fontSize: "12px" },
  banner: { display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", borderRadius: "10px", marginTop: "10px" },
  bannerGlyph: { fontSize: "20px", fontWeight: 700 },
  bannerStatus: { fontSize: "20px", fontWeight: 800, letterSpacing: "0.04em" },
  bannerCounts: { marginLeft: "auto", fontSize: "13px", fontWeight: 600 },
  section: { marginTop: "20px" },
  sectionTitle: { fontSize: "14px", fontWeight: 700, margin: "0 0 8px" },
  sectionCount: { color: "#9CA3AF", fontWeight: 500 },
  cardList: { display: "flex", flexDirection: "column", gap: "6px" },
  row: { display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "8px", background: "#FAFAFA", border: "1px solid #EEF0F2" },
  categoryChip: { fontSize: "10px", fontWeight: 700, textTransform: "uppercase", padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap" },
  rowLabel: { fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" },
  rowDetail: { fontSize: "12px", color: "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  outcomeChip: { marginLeft: "auto", fontSize: "10px", fontWeight: 700, color: "#92400E", background: "#FEF3C7", padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap" },
};
