// Meridian Home — the Daily Command Dashboard.
//
// A thin server component over the Reality Pipeline (computeLiveBrief). It answers,
// top to bottom: what changed since the last scan → do this now (1–3) → the state
// of every relationship, grouped into scannable cards with heat labels. Mobile-first:
// one column on a phone, two on a wide screen. No graphs, no fabricated numbers.

import { computeLiveBrief, dataFreshness, loadTodayBrief } from "@/lib/home/pipeline";
import type { RealityResult } from "@/lib/home/pipeline";
import type { DailyBrief, OpportunityCard } from "@/lib/home/brief";
import { getLatestSnapshot } from "@/lib/operator/store";
import { detectChanges } from "@/lib/operator/changeDetection";
import type { ChangeReport, DailySnapshot } from "@/lib/operator/types";
import RecommendationFeedback from "@/components/home/RecommendationFeedback";
import ManualRefresh from "@/components/home/ManualRefresh";
import type { AgingBand, OverdueItem, UpcomingRiskItem, UrgencyEvent } from "@/lib/temporal/types";
import type { TemporalSections, TemporalRow } from "@/lib/temporal/centers";

export const dynamic = "force-dynamic";

const OWNER = "dylan";

// ── Heat label palette ────────────────────────────────────────────────────────
const HEAT: Record<OpportunityCard["heat"], { bg: string; fg: string }> = {
  HOT: { bg: "#3a1518", fg: "#ff6b6b" },
  WARM: { bg: "#3a2c12", fg: "#f0a441" },
  COLD: { bg: "#152534", fg: "#6ba6e0" },
  STALLED: { bg: "#2a1c3a", fg: "#b985e6" },
  CLOSED: { bg: "#1c1f26", fg: "#8a94a6" },
  WATCH: { bg: "#1c1f26", fg: "#a7b0bf" },
};

// Aging band → the traffic-light dot Meridian uses for "how alive is this".
const AGING: Record<AgingBand, { fg: string; label: string }> = {
  green: { fg: "#3ba55d", label: "0–3d healthy" },
  yellow: { fg: "#d9c441", label: "4–7d needs attention" },
  orange: { fg: "#e08b41", label: "8–14d losing momentum" },
  red: { fg: "#e05b5b", label: "15d+ decaying" },
  black: { fg: "#8a94a6", label: "30d+ likely dead" },
};

function HeatBadge({ heat }: { heat: OpportunityCard["heat"] }) {
  const c = HEAT[heat];
  return <span className="mh-badge" style={{ background: c.bg, color: c.fg }}>{heat}</span>;
}

function AgingDot({ band, days }: { band: AgingBand; days: number | null }) {
  const a = AGING[band];
  return (
    <span className="mh-aging" title={a.label} style={{ color: a.fg }}>
      ● {days === null ? "—" : `${days}d`}
    </span>
  );
}

// ── One relationship card ─────────────────────────────────────────────────────
function OppCard({ c }: { c: OpportunityCard }) {
  const owes =
    c.waitingOn === "me" ? { text: "You owe the next move", fg: "#ff8a5c" }
    : c.waitingOn === "them" ? { text: "Ball in their court", fg: "#7fb2ff" }
    : { text: "No reply pending", fg: "#8a94a6" };
  const ev = c.evidence[0];
  return (
    <div className="mh-card">
      <div className="mh-card-top">
        <span className="mh-card-title">{c.label}</span>
        <span className="mh-card-badges">
          {c.missed && <span className="mh-chip-missed">MISSED</span>}
          {!c.missed && c.daysOverdue > 0 && <span className="mh-chip-overdue">{c.daysOverdue}d overdue</span>}
          <AgingDot band={c.aging} days={c.daysSinceActivity} />
          <HeatBadge heat={c.heat} />
        </span>
      </div>
      <div className="mh-card-stage">
        {c.stage.replace(/_/g, " ")}{c.domain ? ` · ${c.domain}` : ""} · confidence {c.confidence}
      </div>
      <div className="mh-card-action">→ {c.nextAction}</div>
      <div className="mh-card-meta">
        <span style={{ color: owes.fg }}>{owes.text}</span>
        {c.followUpDate && <span className="mh-dot">·</span>}
        {c.followUpDate && <span>{c.waitingOn === "me" ? "due" : "follow up by"} {c.followUpDate}</span>}
        {c.daysUntilDeadline !== null && c.daysUntilDeadline >= 0 && c.daysOverdue === 0 && (
          <><span className="mh-dot">·</span><span>next deadline in {c.daysUntilDeadline}d</span></>
        )}
        {c.recoveryProbability !== null && (
          <><span className="mh-dot">·</span><span>est. recovery {Math.round(c.recoveryProbability * 100)}%</span></>
        )}
      </div>
      <div className="mh-card-touch">
        {c.latestInboundAt && <span>in {c.latestInboundAt}</span>}
        {c.latestOutboundAt && <span>out {c.latestOutboundAt}</span>}
        {c.latestMeetingAt && <span>met {c.latestMeetingAt}</span>}
        {!c.latestInboundAt && !c.latestOutboundAt && c.lastTouch && <span>last touch {c.lastTouch}</span>}
      </div>
      {ev && (
        <div className="mh-card-ev" title={`${ev.connector} · ${ev.type}`}>
          evidence: {ev.subject ? `"${ev.subject.slice(0, 60)}"` : ev.type} ({ev.connector})
        </div>
      )}
      {c.changeLog && c.changeLog !== "no change since last scan" && (
        <div className="mh-card-change">↑ {c.changeLog}</div>
      )}
    </div>
  );
}

function CardSection({ title, cards, accent }: { title: string; cards: OpportunityCard[]; accent?: string }) {
  return (
    <section className="mh-panel">
      <div className="mh-panel-head">
        <span style={accent ? { color: accent } : undefined}>{title}</span>
        <span className="mh-count">{cards.length}</span>
      </div>
      {cards.length === 0
        ? <div className="mh-empty">— nothing here —</div>
        : cards.map((c) => <OppCard key={c.subjectKey} c={c} />)}
    </section>
  );
}

// ── "What changed since last scan" ────────────────────────────────────────────
function ChangeBanner({ change }: { change: ChangeReport }) {
  const chips: Array<{ label: string; fg: string }> = [];
  for (const l of change.newBeliefs) chips.push({ label: `NEW · ${l}`, fg: "#5fd18a" });
  for (const s of change.stageChanges) chips.push({ label: `${s.label}: ${s.from.replace(/_/g, " ")} → ${s.to.replace(/_/g, " ")}`, fg: "#7fb2ff" });
  for (const l of change.strengthened) chips.push({ label: `↑ ${l}`, fg: "#f0a441" });
  for (const l of change.cooled) chips.push({ label: `↓ ${l}`, fg: "#b985e6" });
  for (const l of change.droppedBeliefs) chips.push({ label: `resolved · ${l}`, fg: "#8a94a6" });

  return (
    <section className="mh-changed">
      <div className="mh-panel-head"><span>What changed since last scan</span></div>
      <div className="mh-headline">{change.headline}</div>
      {chips.length > 0 && (
        <div className="mh-chips">
          {chips.slice(0, 12).map((c, i) => (
            <span key={i} className="mh-chip" style={{ color: c.fg, borderColor: c.fg }}>{c.label}</span>
          ))}
        </div>
      )}
    </section>
  );
}

// ── "What became more urgent" — the temporal lede, shown before everything ─────
function UrgencyLede({ urgency }: { urgency: UrgencyEvent[] }) {
  if (urgency.length === 0) return null;
  const tone: Record<UrgencyEvent["kind"], string> = {
    missed_meeting: "#ff5c5c", overdue: "#ff8a5c", prep_due: "#f0a441",
    response_window_closing: "#e0c341", follow_up_window: "#7fb2ff", inactivity: "#b985e6", decay: "#b985e6",
  };
  return (
    <section className="mh-urgent">
      <div className="mh-panel-head"><span>⏰ What became more urgent</span><span className="mh-count">{urgency.length}</span></div>
      {urgency.map((u) => (
        <div key={u.subjectKey + u.kind} className="mh-urgent-row">
          <span className="mh-urgent-bar" style={{ background: tone[u.kind] }} />
          <span className="mh-urgent-msg">{u.message}</span>
        </div>
      ))}
    </section>
  );
}

// ── Overdue Center — everything past due, sorted by expected impact ────────────
function OverdueCenter({ items }: { items: OverdueItem[] }) {
  const impactColor = { high: "#ff6b6b", medium: "#f0a441", low: "#8a94a6" } as const;
  return (
    <section className="mh-overdue">
      <div className="mh-panel-head"><span style={{ color: "#ff7a7a" }}>Overdue center</span><span className="mh-count">{items.length}</span></div>
      {items.length === 0
        ? <div className="mh-empty">Nothing overdue. You&apos;re current.</div>
        : items.map((o) => (
          <div key={o.subjectKey} className="mh-od-row">
            <div className="mh-od-top">
              <span className="mh-od-reason">{o.reason}</span>
              <span className="mh-od-days">{o.daysOverdue}d overdue</span>
            </div>
            <div className="mh-od-label">{o.label}
              <span className="mh-od-impact" style={{ color: impactColor[o.impactBand] }}> · {o.impactBand} impact</span>
              {o.recoveryProbability !== null && <span className="mh-od-rec"> · est. recovery {Math.round(o.recoveryProbability * 100)}%</span>}
            </div>
            <div className="mh-od-action">→ {o.expectedAction}</div>
          </div>
        ))}
    </section>
  );
}

// ── Upcoming Risk Center — what will become overdue soon ───────────────────────
function UpcomingRisk({ items }: { items: UpcomingRiskItem[] }) {
  return (
    <section className="mh-upcoming">
      <div className="mh-panel-head"><span>Upcoming risk</span><span className="mh-count">{items.length}</span></div>
      {items.length === 0
        ? <div className="mh-empty">No deadlines closing in the next few days.</div>
        : items.map((r, i) => (
          <div key={r.subjectKey + i} className="mh-up-row">
            <span className="mh-up-when">{r.whenLabel}</span>
            <span className="mh-up-pred">{r.prediction}</span>
          </div>
        ))}
    </section>
  );
}

// ── The eight time-based sections ──────────────────────────────────────────────
function TimeSection({ title, rows, accent }: { title: string; rows: TemporalRow[]; accent?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="mh-ts">
      <div className="mh-ts-head" style={accent ? { color: accent } : undefined}>{title} <span className="mh-count">{rows.length}</span></div>
      {rows.map((row) => (
        <div key={row.subjectKey} className="mh-ts-row">
          <span className="mh-ts-label">{row.label}</span>
          <span className="mh-ts-metric">{row.metric}</span>
        </div>
      ))}
    </div>
  );
}

function TemporalSectionsGrid({ s }: { s: TemporalSections }) {
  const any = Object.values(s).some((rows) => rows.length > 0);
  if (!any) return null;
  return (
    <section className="mh-panel" style={{ marginTop: 16 }}>
      <div className="mh-panel-head"><span>Time-based sections</span></div>
      <div className="mh-tsgrid">
        <TimeSection title="Today's deadlines" rows={s.todaysDeadlines} accent="#f0a441" />
        <TimeSection title="Overdue" rows={s.overdue} accent="#ff7a7a" />
        <TimeSection title="Recently missed" rows={s.recentlyMissed} accent="#ff5c5c" />
        <TimeSection title="Upcoming deadlines" rows={s.upcomingDeadlines} />
        <TimeSection title="Waiting too long" rows={s.waitingTooLong} accent="#b985e6" />
        <TimeSection title="Needs scheduling" rows={s.needsScheduling} accent="#5fd18a" />
        <TimeSection title="Expected replies this week" rows={s.expectedRepliesThisWeek} />
        <TimeSection title="Expected meetings this week" rows={s.expectedMeetingsThisWeek} accent="#7fb2ff" />
      </div>
    </section>
  );
}

export default async function MeridianHome() {
  // Compute live from committed batches so /home always works (even on Vercel's
  // read-only filesystem). Falls back to the last persisted brief on failure.
  let result: RealityResult | null = null;
  let brief: DailyBrief | null = null;
  try {
    result = await computeLiveBrief(Date.now(), "Dylan");
    brief = result.brief;
  } catch {
    brief = await loadTodayBrief();
  }
  const freshness = await dataFreshness().catch(() => ({ gmail: null, calendar: null }));

  // Diff current reality against the last persisted scan (intraday-aware).
  let change: ChangeReport | null = null;
  if (result && brief) {
    const last = await getLatestSnapshot(OWNER).catch(() => null);
    const todaySnap: DailySnapshot = {
      date: brief.generatedAt.slice(0, 10), ownerId: OWNER, generatedAt: brief.generatedAt,
      observationCount: result.observations.length, connectors: [],
      beliefs: result.beliefs, recommendations: result.recommendations, brief,
    };
    change = detectChanges(todaySnap, last);
  }

  if (!brief) {
    return (
      <main className="mh-wrap">
        <Style />
        <h1 style={{ fontSize: 22 }}>Meridian Home</h1>
        <p className="mh-muted">No data yet. Add a Gmail batch at <code>data/gmail/inbox-batch.json</code> (and optionally calendar + LinkedIn), then the brief appears automatically.</p>
        <a href="/home/status" className="mh-link">operator status →</a>
      </main>
    );
  }

  const r = brief.realitySummary;
  return (
    <main className="mh-wrap">
      <Style />

      <header className="mh-header">
        <div>
          <h1 className="mh-h1">Good morning, {brief.owner}.</h1>
          <p className="mh-sub">{r.newlyFormed} new · {r.changed} updated · {r.totalBeliefs} relationships tracked</p>
        </div>
        <div className="mh-header-actions">
          <ManualRefresh />
          <a href="/home/status" className="mh-link">operator status →</a>
        </div>
      </header>
      <p className="mh-stamp">
        Last scan {brief.generatedAt.slice(0, 16).replace("T", " ")} UTC
        {freshness.gmail ? ` · inbox synced ${freshness.gmail.slice(0, 10)}` : ""}
      </p>

      {/* Temporal lede — what became more urgent, before everything else. */}
      <UrgencyLede urgency={brief.urgency} />

      {/* Overdue + Upcoming risk, side by side on wide screens. */}
      <div className="mh-centers">
        <OverdueCenter items={brief.overdueCenter} />
        <UpcomingRisk items={brief.upcomingRisk} />
      </div>

      {change && <ChangeBanner change={change} />}

      {/* Do this now — the 1–3 highest-leverage moves. */}
      <section className="mh-nowpanel">
        <div className="mh-panel-head"><span>Do this now</span><span className="mh-count">{brief.topActions.length}</span></div>
        {brief.topActions.length === 0 && (
          <div className="mh-empty">Nothing clears the bar right now. That&apos;s an honest answer — no busywork.</div>
        )}
        {brief.topActions.map((a) => (
          <div key={a.rank} className="mh-now">
            <div className="mh-now-rank">{a.rank}</div>
            <div className="mh-now-body">
              <div className="mh-now-action">{a.action}</div>
              <div className="mh-now-why">{a.why}</div>
              <div className="mh-now-meta">
                confidence {a.confidence} · {a.changeLog} · costs: {a.opportunityCost}
              </div>
              {a.memoryUsed.length > 0 && (
                <div className="mh-now-mem">memory used (+{a.memoryBoost}): {a.memoryUsed.join(" · ")}</div>
              )}
              {a.memoryConflict && <div className="mh-now-conflict">⚠ {a.memoryConflict}</div>}
              <RecommendationFeedback subjectKey={a.subjectKey} subjectLabel={a.subjectLabel} rank={a.rank} />
            </div>
          </div>
        ))}
      </section>

      {/* Every relationship, grouped. Ordered by "who owes the move" first. */}
      <div className="mh-cats">
        <CardSection title="Waiting on me" cards={brief.waitingOnMe} accent="#ff8a5c" />
        <CardSection title="Meetings requiring action" cards={brief.meetingsRequiringAction} accent="#7fb2ff" />
        <CardSection title="Momentum rising" cards={brief.momentumRising} accent="#f0a441" />
        <CardSection title="Momentum fading" cards={brief.momentumFalling} accent="#b985e6" />
        <CardSection title="New opportunities" cards={brief.newOpportunities} accent="#5fd18a" />
        <CardSection title="Waiting on them" cards={brief.waitingOnThem} />
        <CardSection title="Risks / stalled" cards={brief.risks} accent="#ff6b6b" />
      </div>

      <TemporalSectionsGrid s={brief.temporalSections} />

      <details className="mh-details">
        <summary>Revenue outlook &amp; professional capital</summary>
        <p className="mh-outlook">{brief.revenueOutlook}</p>
        <ul className="mh-caplist">{brief.capitalSummary.map((c, i) => <li key={i}>{c}</li>)}</ul>
        {brief.companiesToWatch.length > 0 && (
          <p className="mh-watch">Watching: {brief.companiesToWatch.map((c) => c.company).join(" · ")}</p>
        )}
      </details>
    </main>
  );
}

// Scoped styles: inline-style-heavy codebase, but the dashboard needs media
// queries (mobile-first) and hover, so it ships one small style block.
function Style() {
  return (
    <style>{`
      .mh-wrap { max-width: 1080px; margin: 0 auto; padding: 24px 16px 64px;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        color: #e6e6e6; background: #0b0d12; min-height: 100vh; line-height: 1.5; }
      .mh-muted { color: #8a94a6; }
      .mh-link { color: #7fb2ff; font-size: 13px; text-decoration: none; white-space: nowrap; }
      .mh-link:hover { text-decoration: underline; }
      .mh-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
      .mh-header-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .mh-h1 { font-size: 22px; margin: 0 0 2px; font-weight: 650; }
      .mh-sub { color: #8a94a6; font-size: 13px; margin: 0; }
      .mh-stamp { color: #6b7280; font-size: 12px; margin: 4px 0 18px; }

      .mh-panel-head { display: flex; justify-content: space-between; align-items: baseline;
        font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: #8a94a6;
        margin-bottom: 8px; font-weight: 600; }
      .mh-count { background: #1c1f26; color: #a7b0bf; border-radius: 999px; padding: 1px 8px; font-size: 11px; letter-spacing: 0; }
      .mh-empty { color: #5b6472; font-size: 13px; padding: 4px 0; }

      /* Temporal lede */
      .mh-urgent { background: #16101a; border: 1px solid #33223a; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
      .mh-urgent-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
      .mh-urgent-bar { flex: 0 0 4px; height: 16px; border-radius: 2px; }
      .mh-urgent-msg { font-size: 14px; color: #e6dff0; }

      /* Overdue + upcoming centers */
      .mh-centers { display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 20px; }
      .mh-overdue { background: #1a1113; border: 1px solid #43242a; border-radius: 12px; padding: 14px 16px; }
      .mh-od-row { border-top: 1px solid #2a1a1d; padding: 8px 0; }
      .mh-od-row:first-of-type { border-top: none; }
      .mh-od-top { display: flex; justify-content: space-between; gap: 8px; }
      .mh-od-reason { font-size: 12px; font-weight: 700; color: #ff9a8a; text-transform: uppercase; letter-spacing: 0.5px; }
      .mh-od-days { font-size: 12px; color: #ff7a7a; font-weight: 600; white-space: nowrap; }
      .mh-od-label { font-size: 14px; font-weight: 600; margin: 1px 0; }
      .mh-od-impact { font-size: 12px; font-weight: 500; }
      .mh-od-rec { font-size: 12px; color: #8a94a6; }
      .mh-od-action { font-size: 13px; color: #d5c0bb; }
      .mh-upcoming { background: #101319; border: 1px solid #232a36; border-radius: 12px; padding: 14px 16px; }
      .mh-up-row { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid #1a1e27; align-items: baseline; }
      .mh-up-row:first-of-type { border-top: none; }
      .mh-up-when { flex: 0 0 84px; font-size: 12px; color: #f0a441; font-weight: 600; }
      .mh-up-pred { font-size: 13px; color: #cdd6e4; }

      /* Time-based sections grid */
      .mh-tsgrid { display: grid; grid-template-columns: 1fr; gap: 14px; }
      .mh-ts-head { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #8a94a6; font-weight: 600; margin-bottom: 4px; }
      .mh-ts-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; padding: 2px 0; }
      .mh-ts-label { color: #dbe3ef; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mh-ts-metric { color: #8a94a6; font-size: 12px; white-space: nowrap; }

      /* Card temporal badges */
      .mh-card-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .mh-aging { font-size: 11px; white-space: nowrap; }
      .mh-chip-missed { font-size: 10px; font-weight: 700; background: #3a1518; color: #ff5c5c; border-radius: 5px; padding: 2px 6px; }
      .mh-chip-overdue { font-size: 10px; font-weight: 700; background: #2a1a12; color: #ff8a5c; border-radius: 5px; padding: 2px 6px; }

      .mh-changed { background: #101722; border: 1px solid #1e2a3a; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
      .mh-headline { font-size: 14px; color: #cdd6e4; }
      .mh-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .mh-chip { font-size: 11px; border: 1px solid; border-radius: 6px; padding: 2px 7px; opacity: 0.9; }

      .mh-nowpanel { background: linear-gradient(180deg,#141922,#10141b); border: 1px solid #232a36;
        border-radius: 12px; padding: 14px 16px; margin-bottom: 20px; }
      .mh-now { display: flex; gap: 12px; padding: 10px 0; border-top: 1px solid #1a1f29; }
      .mh-now:first-of-type { border-top: none; }
      .mh-now-rank { flex: 0 0 26px; height: 26px; border-radius: 999px; background: #2a3140;
        color: #cfe0ff; font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; }
      .mh-now-body { flex: 1; min-width: 0; }
      .mh-now-action { font-weight: 600; font-size: 15px; }
      .mh-now-why { font-size: 13px; color: #b6bfce; margin: 3px 0; }
      .mh-now-meta { font-size: 12px; color: #6b7280; }
      .mh-now-mem { font-size: 12px; color: #9ab0d6; margin-top: 3px; }
      .mh-now-conflict { font-size: 12px; color: #d9a441; margin-top: 2px; }

      .mh-cats { display: grid; grid-template-columns: 1fr; gap: 16px; }
      .mh-panel { background: #12151c; border: 1px solid #1c202a; border-radius: 12px; padding: 14px 16px; }
      .mh-card { border-top: 1px solid #1a1e27; padding: 10px 0; }
      .mh-card:first-of-type { border-top: none; }
      .mh-card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .mh-card-title { font-weight: 600; font-size: 14px; }
      .mh-badge { font-size: 10px; font-weight: 700; letter-spacing: 0.5px; border-radius: 5px; padding: 2px 6px; }
      .mh-card-stage { font-size: 12px; color: #8a94a6; text-transform: capitalize; margin: 2px 0; }
      .mh-card-action { font-size: 13px; color: #dbe3ef; margin: 4px 0; }
      .mh-card-meta { font-size: 12px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; color: #a7b0bf; }
      .mh-card-touch { font-size: 11px; color: #6b7280; display: flex; gap: 10px; flex-wrap: wrap; margin-top: 3px; }
      .mh-card-ev { font-size: 11px; color: #5b6472; margin-top: 3px; font-style: italic;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .mh-card-change { font-size: 11px; color: #7fb2ff; margin-top: 3px; }
      .mh-dot { color: #3a414d; }

      .mh-details { margin-top: 22px; background: #101319; border: 1px solid #1a1e27; border-radius: 12px; padding: 8px 16px; }
      .mh-details summary { cursor: pointer; font-size: 13px; color: #8a94a6; padding: 6px 0; }
      .mh-outlook { font-size: 13px; color: #b6bfce; }
      .mh-caplist { font-size: 13px; color: #a7b0bf; padding-left: 18px; }
      .mh-watch { font-size: 12px; color: #6b7280; }

      @media (min-width: 900px) {
        .mh-wrap { padding: 40px 28px 80px; }
        .mh-cats { grid-template-columns: 1fr 1fr; align-items: start; }
        .mh-centers { grid-template-columns: 3fr 2fr; align-items: start; }
        .mh-tsgrid { grid-template-columns: 1fr 1fr; }
      }
    `}</style>
  );
}
