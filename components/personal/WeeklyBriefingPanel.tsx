"use client";

import { type CSSProperties } from "react";
import type {
  WeeklyMode,
  WeeklyPriority,
  WeeklyState,
} from "@/lib/personal-workspace/weeklyState";

interface WeeklyBriefingPanelProps {
  state: WeeklyState;
  mode: WeeklyMode;
  /** Called when an operator clicks a priority row — selects that contact. */
  onSelectContact?: (cardId: string) => void;
}

export default function WeeklyBriefingPanel({
  state,
  mode,
  onSelectContact,
}: WeeklyBriefingPanelProps) {
  if (mode === "monday") return <MondayPanel state={state} onSelectContact={onSelectContact} />;
  if (mode === "midweek") return <MidweekPanel state={state} onSelectContact={onSelectContact} />;
  return <FridayPanel state={state} />;
}

// ── Monday ──────────────────────────────────────────────────────────

function MondayPanel({
  state,
  onSelectContact,
}: {
  state: WeeklyState;
  onSelectContact?: (cardId: string) => void;
}) {
  return (
    <section style={styles.mondayShell} aria-label="Weekly briefing">
      <header style={styles.mondayHeader}>
        <div style={styles.weekLabel}>Week of {state.weekId}</div>
        <h2 style={styles.mondayTitle}>Your workspace is ready</h2>
        <p style={styles.mondaySubtitle}>
          {state.priorities.length} priority relationship
          {state.priorities.length === 1 ? "" : "s"} queued for this week. Every line below
          cites the CRM material that justified it.
        </p>
      </header>

      <div style={styles.mondayBody}>
        <ol style={styles.priorityList}>
          {state.priorities.map((priority) => (
            <PriorityRow
              key={priority.cardId}
              priority={priority}
              onSelectContact={onSelectContact}
            />
          ))}
        </ol>

        <aside style={styles.sidebar}>
          {state.resurfacedRelationship ? (
            <article style={styles.resurfaceCard}>
              <div style={styles.calloutLabel}>Resurfaced relationship</div>
              <div style={styles.resurfaceName}>{state.resurfacedRelationship.name}</div>
              <p style={styles.resurfaceReason}>{state.resurfacedRelationship.reason}</p>
              <p style={styles.resurfaceEvidence}>{state.resurfacedRelationship.evidence}</p>
              {state.resurfacedRelationship.monthsQuiet !== null ? (
                <div style={styles.resurfaceAge}>
                  {state.resurfacedRelationship.monthsQuiet} months quiet
                </div>
              ) : null}
            </article>
          ) : null}

          <article style={styles.insightCard}>
            <div style={styles.calloutLabel}>Continuity insight</div>
            <p style={styles.insightText}>{state.continuityInsight.text}</p>
          </article>

          <article style={styles.rollupCard}>
            <div style={styles.calloutLabel}>This week</div>
            <ul style={styles.rollupList}>
              <li style={styles.rollupRow}>
                <span style={styles.rollupNumber}>{state.outcomeRollup.outcomesCaptured}</span>
                <span style={styles.rollupName}>outcomes captured</span>
              </li>
              <li style={styles.rollupRow}>
                <span style={styles.rollupNumber}>{state.outcomeRollup.meetingsBooked}</span>
                <span style={styles.rollupName}>meetings booked</span>
              </li>
              <li style={styles.rollupRow}>
                <span style={styles.rollupNumber}>{state.outcomeRollup.deprioritized}</span>
                <span style={styles.rollupName}>deprioritized</span>
              </li>
            </ul>
          </article>
        </aside>
      </div>
    </section>
  );
}

// ── Midweek ─────────────────────────────────────────────────────────

function MidweekPanel({
  state,
  onSelectContact,
}: {
  state: WeeklyState;
  onSelectContact?: (cardId: string) => void;
}) {
  const remainingCount = state.priorities.filter((p) => !p.lastOperatorOutcome).length;
  return (
    <section style={styles.midweekShell} aria-label="Week in progress">
      <div style={styles.midweekRow}>
        <div style={styles.midweekLabelCol}>
          <div style={styles.midweekKicker}>Week in progress · {state.weekId}</div>
          <div style={styles.midweekHeadline}>
            {remainingCount} of {state.priorities.length} priorities still open
          </div>
        </div>
        <div style={styles.midweekStats}>
          <span style={styles.midweekStat}>
            <strong>{state.outcomeRollup.outcomesCaptured}</strong> outcomes
          </span>
          <span style={styles.midweekStat}>
            <strong>{state.outcomeRollup.meetingsBooked}</strong> meetings
          </span>
          <span style={styles.midweekStat}>
            <strong>{state.outcomeRollup.deprioritized}</strong> deprioritized
          </span>
        </div>
      </div>
      {remainingCount > 0 ? (
        <ul style={styles.midweekRemainingList}>
          {state.priorities
            .filter((p) => !p.lastOperatorOutcome)
            .map((priority) => (
              <li key={priority.cardId} style={styles.midweekRemainingItem}>
                <button
                  type="button"
                  onClick={() => onSelectContact?.(priority.cardId)}
                  style={styles.midweekRemainingButton}
                >
                  <span style={styles.midweekRemainingRank}>{priority.rank}</span>
                  <span style={styles.midweekRemainingName}>{priority.name}</span>
                  <span style={styles.midweekRemainingHint}>{priority.lastTouchSummary}</span>
                </button>
              </li>
            ))}
        </ul>
      ) : (
        <p style={styles.midweekClearText}>
          Every priority has at least one captured outcome. Next week opens Monday.
        </p>
      )}
    </section>
  );
}

// ── Friday ──────────────────────────────────────────────────────────

function FridayPanel({ state }: { state: WeeklyState }) {
  const completedCount = state.priorities.filter((p) => p.lastOperatorOutcome).length;
  const followUpLater = state.priorities.filter(
    (p) => p.lastOperatorOutcome?.outcome === "follow_up_later",
  );
  return (
    <section style={styles.fridayShell} aria-label="Week summary">
      <header style={styles.fridayHeader}>
        <div style={styles.weekLabel}>Week summary · {state.weekId}</div>
        <h2 style={styles.fridayTitle}>
          You captured {state.outcomeRollup.outcomesCaptured} outcome
          {state.outcomeRollup.outcomesCaptured === 1 ? "" : "s"} this week.
        </h2>
      </header>
      <div style={styles.fridayBody}>
        <article style={styles.fridayCard}>
          <div style={styles.calloutLabel}>Priorities touched</div>
          <p style={styles.fridayCardBody}>
            {completedCount} of {state.priorities.length} priority relationships received at
            least one outcome this week.
          </p>
        </article>
        <article style={styles.fridayCard}>
          <div style={styles.calloutLabel}>Meetings booked</div>
          <p style={styles.fridayCardBody}>{state.outcomeRollup.meetingsBooked}</p>
        </article>
        {followUpLater.length > 0 ? (
          <article style={styles.fridayCard}>
            <div style={styles.calloutLabel}>Returning next week</div>
            <ul style={styles.returningList}>
              {followUpLater.map((p) => (
                <li key={p.cardId} style={styles.returningRow}>
                  {p.name}
                </li>
              ))}
            </ul>
          </article>
        ) : null}
        <article style={styles.fridayCard}>
          <div style={styles.calloutLabel}>Next week</div>
          <p style={styles.fridayCardBody}>Your next workspace opens Monday morning.</p>
        </article>
      </div>
    </section>
  );
}

// ── Priority row ────────────────────────────────────────────────────

function PriorityRow({
  priority,
  onSelectContact,
}: {
  priority: WeeklyPriority;
  onSelectContact?: (cardId: string) => void;
}) {
  const trustColor =
    priority.trustLevel === "HIGH"
      ? styles.trustHigh
      : priority.trustLevel === "MED"
        ? styles.trustMed
        : styles.trustWeak;
  return (
    <li style={styles.priorityRow}>
      <button
        type="button"
        onClick={() => onSelectContact?.(priority.cardId)}
        style={styles.priorityButton}
      >
        <div style={styles.priorityHeader}>
          <span style={styles.priorityRank}>{priority.rank}</span>
          <span style={styles.priorityName}>{priority.name}</span>
          {priority.company ? (
            <span style={styles.priorityCompany}>· {priority.company}</span>
          ) : null}
          <span style={{ ...styles.trustChip, ...trustColor }}>{priority.trustLevel}</span>
        </div>
        <p style={styles.priorityOpener}>{priority.suggestedOpener}</p>
        <div style={styles.priorityMeta}>
          <span style={styles.priorityMetaItem}>{priority.supportingEvidence}</span>
          <span style={styles.priorityMetaDot}>·</span>
          <span style={styles.priorityMetaItem}>{priority.lastTouchSummary}</span>
          {priority.lastOperatorOutcome ? (
            <>
              <span style={styles.priorityMetaDot}>·</span>
              <span style={styles.lastOutcomeChip}>
                Last outcome: {priority.lastOperatorOutcome.outcome} ·{" "}
                {priority.lastOperatorOutcome.ageDays}d ago
              </span>
            </>
          ) : null}
        </div>
      </button>
    </li>
  );
}

// ── Styles ──────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  // Monday
  mondayShell: {
    margin: "0 0 24px",
    padding: "28px 28px 24px",
    borderRadius: 18,
    background: "#fbfaf7",
    border: "1px solid #e8e3d8",
    boxShadow: "0 1px 0 rgba(0,0,0,0.02)",
  },
  mondayHeader: {
    marginBottom: 20,
  },
  weekLabel: {
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#7a6f5a",
    marginBottom: 6,
  },
  mondayTitle: {
    fontSize: 28,
    lineHeight: 1.2,
    fontWeight: 600,
    color: "#23211c",
    margin: "0 0 8px",
  },
  mondaySubtitle: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "#5b5346",
    margin: 0,
    maxWidth: 640,
  },
  mondayBody: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(260px, 320px)",
    gap: 24,
    alignItems: "start",
  },
  priorityList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  priorityRow: {
    listStyle: "none",
  },
  priorityButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "14px 16px",
    borderRadius: 12,
    background: "#ffffff",
    border: "1px solid #ece8de",
    cursor: "pointer",
  },
  priorityHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  },
  priorityRank: {
    display: "inline-block",
    minWidth: 20,
    fontSize: 12,
    fontWeight: 600,
    color: "#8c7e63",
  },
  priorityName: {
    fontSize: 15,
    fontWeight: 600,
    color: "#23211c",
  },
  priorityCompany: {
    fontSize: 13,
    color: "#7a6f5a",
  },
  trustChip: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    padding: "2px 7px",
    borderRadius: 6,
    marginLeft: "auto",
  },
  trustHigh: { background: "#e9f1e4", color: "#2f5c2c" },
  trustMed: { background: "#eef0f5", color: "#34466b" },
  trustWeak: { background: "#f1ece0", color: "#6e5b30" },
  priorityOpener: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "#3a352c",
    margin: "8px 0 6px",
  },
  priorityMeta: {
    fontSize: 12,
    color: "#7a6f5a",
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    alignItems: "center",
  },
  priorityMetaItem: { whiteSpace: "nowrap" },
  priorityMetaDot: { opacity: 0.6 },
  lastOutcomeChip: {
    background: "#efece4",
    padding: "2px 7px",
    borderRadius: 6,
    color: "#5b5346",
  },

  // Sidebar
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  calloutLabel: {
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#7a6f5a",
    marginBottom: 6,
  },
  resurfaceCard: {
    padding: "14px 16px",
    borderRadius: 12,
    background: "#fff6e9",
    border: "1px solid #ecd9b3",
  },
  resurfaceName: {
    fontSize: 16,
    fontWeight: 600,
    color: "#23211c",
    marginBottom: 6,
  },
  resurfaceReason: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#3a352c",
    margin: "0 0 6px",
  },
  resurfaceEvidence: {
    fontSize: 12,
    color: "#6e5b30",
    margin: "0 0 4px",
    fontStyle: "italic",
  },
  resurfaceAge: {
    fontSize: 11,
    color: "#7a6f5a",
  },
  insightCard: {
    padding: "14px 16px",
    borderRadius: 12,
    background: "#ffffff",
    border: "1px solid #ece8de",
  },
  insightText: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#3a352c",
    margin: 0,
  },
  rollupCard: {
    padding: "14px 16px",
    borderRadius: 12,
    background: "#ffffff",
    border: "1px solid #ece8de",
  },
  rollupList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  rollupRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  },
  rollupNumber: {
    fontSize: 18,
    fontWeight: 600,
    color: "#23211c",
    minWidth: 24,
  },
  rollupName: {
    fontSize: 12,
    color: "#5b5346",
  },

  // Midweek
  midweekShell: {
    margin: "0 0 20px",
    padding: "16px 20px",
    borderRadius: 14,
    background: "#fbfaf7",
    border: "1px solid #ece8de",
  },
  midweekRow: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  midweekLabelCol: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  midweekKicker: {
    fontSize: 11,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#7a6f5a",
  },
  midweekHeadline: {
    fontSize: 16,
    fontWeight: 600,
    color: "#23211c",
  },
  midweekStats: {
    display: "flex",
    gap: 16,
    fontSize: 13,
    color: "#5b5346",
  },
  midweekStat: { whiteSpace: "nowrap" },
  midweekRemainingList: {
    listStyle: "none",
    padding: 0,
    margin: "12px 0 0",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  midweekRemainingItem: {},
  midweekRemainingButton: {
    display: "flex",
    width: "100%",
    alignItems: "baseline",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    background: "transparent",
    border: "1px solid transparent",
    textAlign: "left",
    cursor: "pointer",
  },
  midweekRemainingRank: {
    minWidth: 18,
    fontSize: 11,
    color: "#8c7e63",
    fontWeight: 600,
  },
  midweekRemainingName: {
    fontSize: 13,
    color: "#23211c",
    fontWeight: 500,
  },
  midweekRemainingHint: {
    fontSize: 11,
    color: "#7a6f5a",
    marginLeft: "auto",
  },
  midweekClearText: {
    margin: "10px 0 0",
    fontSize: 13,
    color: "#5b5346",
  },

  // Friday
  fridayShell: {
    margin: "0 0 20px",
    padding: "20px 22px",
    borderRadius: 14,
    background: "#f5f7f4",
    border: "1px solid #d9e3d7",
  },
  fridayHeader: {
    marginBottom: 14,
  },
  fridayTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: "#23211c",
    margin: 0,
    lineHeight: 1.3,
  },
  fridayBody: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  fridayCard: {
    padding: "12px 14px",
    borderRadius: 10,
    background: "#ffffff",
    border: "1px solid #e1e7df",
  },
  fridayCardBody: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "#3a352c",
    margin: 0,
  },
  returningList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  returningRow: {
    fontSize: 13,
    color: "#23211c",
  },
};
