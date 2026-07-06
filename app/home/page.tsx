// Meridian Home — the Daily Command Brief. One page. No graphs, no widgets.
// A thin server component that renders the brief produced by the Reality Pipeline
// (npm run reality:scan -- --live --write). Mirrors the heartbeat page pattern:
// the page renders; the pipeline computes.

import { computeLiveBrief, dataFreshness, loadTodayBrief } from "@/lib/home/pipeline";
import type { DailyBrief } from "@/lib/home/brief";
import RecommendationFeedback from "@/components/home/RecommendationFeedback";
import ManualRefresh from "@/components/home/ManualRefresh";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = {
  maxWidth: 820, margin: "0 auto", padding: "48px 24px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#e6e6e6", background: "#0b0d12", minHeight: "100vh", lineHeight: 1.55,
};
const h: React.CSSProperties = { fontSize: 13, letterSpacing: 2, color: "#8a94a6", margin: "28px 0 8px", textTransform: "uppercase" };
const card: React.CSSProperties = { background: "#12151c", borderRadius: 10, padding: "14px 18px", margin: "8px 0" };
const muted: React.CSSProperties = { color: "#8a94a6" };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={h}>{title}</div>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <div style={{ ...muted, fontSize: 14 }}>— nothing here —</div>;
  return <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((t, i) => <li key={i} style={{ margin: "3px 0" }}>{t}</li>)}</ul>;
}

export default async function MeridianHome() {
  // Compute live from committed batches so /home always works (even on Vercel's
  // read-only filesystem, where a persisted file may be stale/absent). Falls back
  // to the last persisted brief only if a live compute fails.
  let brief: DailyBrief | null = null;
  try {
    brief = (await computeLiveBrief(Date.now(), "Dylan")).brief;
  } catch {
    brief = await loadTodayBrief();
  }
  const freshness = await dataFreshness().catch(() => ({ gmail: null, calendar: null }));

  if (!brief) {
    return (
      <main style={wrap}>
        <h1 style={{ fontSize: 22 }}>Meridian Home</h1>
        <p style={muted}>No data yet. Add a Gmail batch at <code>data/gmail/inbox-batch.json</code> (and optionally calendar + LinkedIn), then the morning brief appears automatically.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 24, marginBottom: 2 }}>Good morning, {brief.owner}.</h1>
      <p style={muted}>
        Reality changed overnight — {brief.realitySummary.newlyFormed} new, {brief.realitySummary.changed} updated,
        {" "}{brief.realitySummary.totalBeliefs} relationships tracked.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "6px 0 4px" }}>
        <span style={{ ...muted, fontSize: 12 }}>
          Last updated {brief.generatedAt.slice(0, 16).replace("T", " ")} UTC
          {freshness.gmail ? ` · inbox synced ${freshness.gmail.slice(0, 10)}` : ""}
        </span>
        <ManualRefresh />
        <a href="/home/status" style={{ ...muted, fontSize: 12, color: "#7fb2ff" }}>operator status</a>
      </div>

      <Section title="Highest-leverage actions">
        {brief.topActions.length === 0 && <div style={{ ...muted, fontSize: 14 }}>Nothing clears the bar today. That&apos;s an honest answer.</div>}
        {brief.topActions.map((r) => (
          <div key={r.rank} style={card}>
            <div style={{ fontWeight: 600 }}>{r.rank}. {r.action}</div>
            <div style={{ fontSize: 14, margin: "4px 0" }}>{r.why}</div>
            <div style={{ ...muted, fontSize: 13 }}>opportunity cost: {r.opportunityCost}</div>
            <div style={{ ...muted, fontSize: 13 }}>confidence: {r.confidence} · {r.changeLog} · falsifier: {r.falsifier}</div>
            <RecommendationFeedback subjectKey={r.subjectKey} subjectLabel={r.subjectLabel} rank={r.rank} />
          </div>
        ))}
      </Section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Section title="Momentum rising"><List items={brief.momentumRising.map((m) => `${m.label} — ${m.claim}`)} /></Section>
        <Section title="Momentum fading (act or lose)"><List items={brief.momentumFalling.map((m) => `${m.label} — ${m.claim}`)} /></Section>
        <Section title="Waiting on me"><List items={brief.waitingOnMe.map((w) => `${w.label} (since ${w.since})`)} /></Section>
        <Section title="Waiting on them"><List items={brief.waitingOnThem.map((w) => `${w.label} (since ${w.since})`)} /></Section>
        <Section title="Meetings requiring action"><List items={brief.meetingsRequiringAction.map((m) => `${m.label} — ${m.detail}`)} /></Section>
        <Section title="New opportunities"><List items={brief.newOpportunities.map((o) => `${o.label} — ${o.claim}`)} /></Section>
        <Section title="Risks / stalled"><List items={brief.risks.map((r) => `${r.label} — ${r.detail}`)} /></Section>
        <Section title="Companies to watch"><List items={brief.companiesToWatch.map((c) => c.company)} /></Section>
      </div>

      <Section title="Revenue outlook">
        <div style={{ ...card, fontSize: 14 }}>{brief.revenueOutlook}</div>
      </Section>
      <Section title="Professional capital">
        <div style={card}><List items={brief.capitalSummary} /></div>
      </Section>
    </main>
  );
}
