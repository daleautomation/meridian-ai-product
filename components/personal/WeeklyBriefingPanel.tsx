"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import type {
  WeeklyMode,
  WeeklyPriority,
  WeeklyState,
} from "@/lib/personal-workspace/weeklyState";

// ── Outcome action definitions ──────────────────────────────────────
// Order matters — these are the buttons shown on every priority row.
// Each maps 1:1 to a canonical OutcomeType. No new outcome types
// invented here; the API rejects anything outside the closed set in
// lib/recovery/outcomes/types.ts.

interface OutcomeAction {
  outcome:
    | "contacted"
    | "no_response"
    | "meeting_booked"
    | "follow_up_later"
    | "wrong_contact";
  label: string;
}

const OUTCOME_ACTIONS: readonly OutcomeAction[] = [
  { outcome: "contacted", label: "Sent" },
  { outcome: "no_response", label: "No answer" },
  { outcome: "meeting_booked", label: "Meeting booked" },
  { outcome: "follow_up_later", label: "Follow up later" },
  { outcome: "wrong_contact", label: "Wrong contact" },
];

// Calm post-capture line. Static. Same string every time. No hype.
const REINFORCEMENT_TEXT = "Saved to continuity memory.";

// Honest empty-state lines. Operator-grade tone, no productivity guilt.
const EMPTY_ROLLUP_MONDAY = "Your priorities are still untouched this week.";
const EMPTY_REMAINING_MIDWEEK =
  "Every priority has at least one captured outcome. Next week opens Monday.";
const EMPTY_FRIDAY = "No outcomes were captured this week.";

// ── Local optimistic-capture state shape ───────────────────────────

interface OptimisticOutcome {
  outcome: OutcomeAction["outcome"];
  recordedAt: string;
}

interface WeeklyBriefingPanelProps {
  state: WeeklyState;
  mode: WeeklyMode;
  onSelectContact?: (cardId: string) => void;
}

export default function WeeklyBriefingPanel({
  state,
  mode,
  onSelectContact,
}: WeeklyBriefingPanelProps) {
  // Map of contactId → optimistic outcome captured this session. Layered
  // on top of `state.priorities[i].lastOperatorOutcome` which is the
  // durable server-side overlay from the outcome store.
  const [optimistic, setOptimistic] = useState<Map<string, OptimisticOutcome>>(
    () => new Map(),
  );
  // contactIds we tried to POST but the server rejected; surfaced inline.
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());

  // Effective outcomes view used by every render branch — optimistic
  // overrides server when present (server is authoritative on refresh).
  const effectivePriorities = useMemo<EnrichedPriority[]>(() => {
    return state.priorities.map((p) => {
      const optimisticEntry = optimistic.get(p.contactId);
      if (optimisticEntry) {
        return {
          ...p,
          lastOperatorOutcome: {
            outcome: optimisticEntry.outcome,
            recordedAt: optimisticEntry.recordedAt,
            ageDays: 0,
          },
          capturedThisSession: true,
        };
      }
      return { ...p, capturedThisSession: false };
    });
  }, [state.priorities, optimistic]);

  // Local rollup view = server rollup + optimistic deltas this session.
  // We only increment the counter — the server rollup carries the
  // pre-session counts already, and a duplicate capture would write a
  // new outcome row (the store is append-only).
  const effectiveRollup = useMemo(() => {
    const base = state.outcomeRollup;
    // Coalesce any rollup field a pre-overlay snapshot might be
    // missing (snapshot schema is additive — old files may pre-date
    // followUpsDeferred). Never let NaN reach the UI.
    let outcomesCaptured = base.outcomesCaptured ?? 0;
    let meetingsBooked = base.meetingsBooked ?? 0;
    let followUpsDeferred = base.followUpsDeferred ?? 0;
    let deprioritized = base.deprioritized ?? 0;
    for (const entry of optimistic.values()) {
      outcomesCaptured += 1;
      if (entry.outcome === "meeting_booked") meetingsBooked += 1;
      if (entry.outcome === "follow_up_later") followUpsDeferred += 1;
      if (entry.outcome === "no_response" || entry.outcome === "wrong_contact") {
        deprioritized += 1;
      }
    }
    return { outcomesCaptured, meetingsBooked, followUpsDeferred, deprioritized };
  }, [state.outcomeRollup, optimistic]);

  const captureOutcome = useCallback(
    async (priority: WeeklyPriority, action: OutcomeAction) => {
      const recordedAt = new Date().toISOString();
      // Optimistically mark captured BEFORE the network call.
      setOptimistic((prev) => {
        const next = new Map(prev);
        next.set(priority.contactId, { outcome: action.outcome, recordedAt });
        return next;
      });
      setFailed((prev) => {
        if (!prev.has(priority.contactId)) return prev;
        const next = new Map(prev);
        next.delete(priority.contactId);
        return next;
      });
      try {
        const res = await fetch("/api/outcomes/record", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer: state.workspaceSlug,
            leadKey: priority.contactId,
            outcome: action.outcome,
            source: "operator_console",
          }),
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) message = j.error;
          } catch {
            // ignore body parse failure
          }
          throw new Error(message);
        }
      } catch (err) {
        // Roll back the optimistic state on failure and surface the
        // error inline. Never hide failures.
        setOptimistic((prev) => {
          if (!prev.has(priority.contactId)) return prev;
          const next = new Map(prev);
          next.delete(priority.contactId);
          return next;
        });
        const message = err instanceof Error ? err.message : "Capture failed.";
        setFailed((prev) => {
          const next = new Map(prev);
          next.set(priority.contactId, message);
          return next;
        });
      }
    },
    [state.workspaceSlug],
  );

  if (mode === "monday") {
    return (
      <MondayPanel
        state={state}
        priorities={effectivePriorities}
        rollup={effectiveRollup}
        failed={failed}
        captureOutcome={captureOutcome}
        onSelectContact={onSelectContact}
      />
    );
  }
  if (mode === "midweek") {
    return (
      <MidweekPanel
        state={state}
        priorities={effectivePriorities}
        rollup={effectiveRollup}
        failed={failed}
        captureOutcome={captureOutcome}
        onSelectContact={onSelectContact}
      />
    );
  }
  return <FridayPanel state={state} priorities={effectivePriorities} rollup={effectiveRollup} />;
}

// ── Sub-component types ────────────────────────────────────────────

type EnrichedPriority = WeeklyPriority & { capturedThisSession: boolean };
type EffectiveRollup = {
  outcomesCaptured: number;
  meetingsBooked: number;
  followUpsDeferred: number;
  deprioritized: number;
};

// ── Monday ──────────────────────────────────────────────────────────

function MondayPanel({
  state,
  priorities,
  rollup,
  failed,
  captureOutcome,
  onSelectContact,
}: {
  state: WeeklyState;
  priorities: EnrichedPriority[];
  rollup: EffectiveRollup;
  failed: Map<string, string>;
  captureOutcome: (p: WeeklyPriority, a: OutcomeAction) => Promise<void>;
  onSelectContact?: (cardId: string) => void;
}) {
  const active = priorities.filter((p) => p.lastOperatorOutcome === null);
  const completed = priorities.filter((p) => p.lastOperatorOutcome !== null);
  return (
    <section style={styles.mondayShell} aria-label="Weekly briefing">
      <header style={styles.mondayHeader}>
        <div style={styles.weekLabel}>Week of {state.weekId}</div>
        <h2 style={styles.mondayTitle}>Your workspace is ready</h2>
        <p style={styles.mondaySubtitle}>
          {priorities.length} priority relationship
          {priorities.length === 1 ? "" : "s"} queued for this week. Every line below
          cites the CRM material that justified it.
        </p>
      </header>

      <div style={styles.mondayBody}>
        <ol style={styles.priorityList}>
          {active.map((priority) => (
            <PriorityRow
              key={priority.cardId}
              priority={priority}
              failedMessage={failed.get(priority.contactId) ?? null}
              captureOutcome={captureOutcome}
              onSelectContact={onSelectContact}
            />
          ))}
          {completed.length > 0 ? (
            <li style={styles.capturedDivider}>
              <span>Captured this week ({completed.length})</span>
            </li>
          ) : null}
          {completed.map((priority) => (
            <PriorityRow
              key={priority.cardId}
              priority={priority}
              failedMessage={failed.get(priority.contactId) ?? null}
              captureOutcome={captureOutcome}
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
            {rollup.outcomesCaptured === 0 ? (
              <p style={styles.rollupEmpty}>{EMPTY_ROLLUP_MONDAY}</p>
            ) : (
              <ul style={styles.rollupList}>
                <li style={styles.rollupRow}>
                  <span style={styles.rollupNumber}>{rollup.outcomesCaptured}</span>
                  <span style={styles.rollupName}>outcomes captured</span>
                </li>
                <li style={styles.rollupRow}>
                  <span style={styles.rollupNumber}>{rollup.meetingsBooked}</span>
                  <span style={styles.rollupName}>meetings booked</span>
                </li>
                <li style={styles.rollupRow}>
                  <span style={styles.rollupNumber}>{rollup.followUpsDeferred}</span>
                  <span style={styles.rollupName}>follow-ups deferred</span>
                </li>
                <li style={styles.rollupRow}>
                  <span style={styles.rollupNumber}>{rollup.deprioritized}</span>
                  <span style={styles.rollupName}>deprioritized</span>
                </li>
              </ul>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}

// ── Midweek ─────────────────────────────────────────────────────────

function MidweekPanel({
  state,
  priorities,
  rollup,
  failed,
  captureOutcome,
  onSelectContact,
}: {
  state: WeeklyState;
  priorities: EnrichedPriority[];
  rollup: EffectiveRollup;
  failed: Map<string, string>;
  captureOutcome: (p: WeeklyPriority, a: OutcomeAction) => Promise<void>;
  onSelectContact?: (cardId: string) => void;
}) {
  const remaining = priorities.filter((p) => p.lastOperatorOutcome === null);
  return (
    <section style={styles.midweekShell} aria-label="Week in progress">
      <div style={styles.midweekRow}>
        <div style={styles.midweekLabelCol}>
          <div style={styles.midweekKicker}>Week in progress · {state.weekId}</div>
          <div style={styles.midweekHeadline}>
            {remaining.length} of {priorities.length} priorities still open
          </div>
        </div>
        <div style={styles.midweekStats}>
          <span style={styles.midweekStat}>
            <strong>{rollup.outcomesCaptured}</strong> outcomes
          </span>
          <span style={styles.midweekStat}>
            <strong>{rollup.meetingsBooked}</strong> meetings
          </span>
          <span style={styles.midweekStat}>
            <strong>{rollup.followUpsDeferred}</strong> deferred
          </span>
          <span style={styles.midweekStat}>
            <strong>{rollup.deprioritized}</strong> deprioritized
          </span>
        </div>
      </div>
      {remaining.length > 0 ? (
        <ul style={styles.midweekRemainingList}>
          {remaining.map((priority) => (
            <li key={priority.cardId} style={styles.midweekRemainingItem}>
              <PriorityRow
                priority={priority}
                failedMessage={failed.get(priority.contactId) ?? null}
                captureOutcome={captureOutcome}
                onSelectContact={onSelectContact}
                density="compact"
              />
            </li>
          ))}
        </ul>
      ) : (
        <p style={styles.midweekClearText}>{EMPTY_REMAINING_MIDWEEK}</p>
      )}
    </section>
  );
}

// ── Friday ──────────────────────────────────────────────────────────

function FridayPanel({
  state,
  priorities,
  rollup,
}: {
  state: WeeklyState;
  priorities: EnrichedPriority[];
  rollup: EffectiveRollup;
}) {
  const touched = priorities.filter((p) => p.lastOperatorOutcome !== null);
  const returningNext = priorities.filter(
    (p) => p.lastOperatorOutcome?.outcome === "follow_up_later",
  );
  return (
    <section style={styles.fridayShell} aria-label="Week summary">
      <header style={styles.fridayHeader}>
        <div style={styles.weekLabel}>Week summary · {state.weekId}</div>
        <h2 style={styles.fridayTitle}>
          {rollup.outcomesCaptured === 0
            ? EMPTY_FRIDAY
            : `You captured ${rollup.outcomesCaptured} outcome${rollup.outcomesCaptured === 1 ? "" : "s"} this week.`}
        </h2>
      </header>
      <div style={styles.fridayBody}>
        <article style={styles.fridayCard}>
          <div style={styles.calloutLabel}>Priorities touched</div>
          <p style={styles.fridayCardBody}>
            {touched.length} of {priorities.length} priority relationships received at
            least one outcome this week.
          </p>
        </article>
        <article style={styles.fridayCard}>
          <div style={styles.calloutLabel}>Meetings booked</div>
          <p style={styles.fridayCardBody}>{rollup.meetingsBooked}</p>
        </article>
        <article style={styles.fridayCard}>
          <div style={styles.calloutLabel}>Follow-ups deferred</div>
          <p style={styles.fridayCardBody}>{rollup.followUpsDeferred}</p>
        </article>
        {returningNext.length > 0 ? (
          <article style={styles.fridayCard}>
            <div style={styles.calloutLabel}>Returning next week</div>
            <ul style={styles.returningList}>
              {returningNext.map((p) => (
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

// ── Priority row (now stateful: outcome buttons + completed state) ─

function PriorityRow({
  priority,
  failedMessage,
  captureOutcome,
  onSelectContact,
  density = "default",
}: {
  priority: EnrichedPriority;
  failedMessage: string | null;
  captureOutcome: (p: WeeklyPriority, a: OutcomeAction) => Promise<void>;
  onSelectContact?: (cardId: string) => void;
  density?: "default" | "compact";
}) {
  const trustColor =
    priority.trustLevel === "HIGH"
      ? styles.trustHigh
      : priority.trustLevel === "MED"
        ? styles.trustMed
        : styles.trustWeak;
  const isCompleted = priority.lastOperatorOutcome !== null;
  const rowStyle: CSSProperties = {
    ...styles.priorityRow,
    ...(isCompleted ? styles.priorityRowCompleted : null),
    ...(density === "compact" ? styles.priorityRowCompact : null),
  };
  return (
    <article style={rowStyle}>
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
        {density === "default" ? (
          <p style={styles.priorityOpener}>{priority.suggestedOpener}</p>
        ) : null}
        <div style={styles.priorityMeta}>
          {density === "default" ? (
            <>
              <span style={styles.priorityMetaItem}>{priority.supportingEvidence}</span>
              <span style={styles.priorityMetaDot}>·</span>
            </>
          ) : null}
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

      {isCompleted ? (
        <div style={styles.reinforcementRow}>
          <span style={styles.reinforcementText}>{REINFORCEMENT_TEXT}</span>
        </div>
      ) : (
        <div style={styles.actionsRow} role="group" aria-label={`Capture outcome for ${priority.name}`}>
          {OUTCOME_ACTIONS.map((action) => (
            <button
              key={action.outcome}
              type="button"
              onClick={() => void captureOutcome(priority, action)}
              style={styles.actionButton}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {failedMessage ? (
        <div style={styles.failedRow}>
          <span style={styles.failedText}>Capture failed: {failedMessage}</span>
        </div>
      ) : null}
    </article>
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
  mondayHeader: { marginBottom: 20 },
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
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #ece8de",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  priorityRowCompleted: {
    background: "#f4f3ee",
    opacity: 0.78,
  },
  priorityRowCompact: {
    padding: "10px 12px",
  },
  priorityButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: 0,
    background: "transparent",
    border: 0,
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
  actionsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  actionButton: {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 7,
    background: "#ffffff",
    border: "1px solid #d9d3c4",
    color: "#3a352c",
    cursor: "pointer",
  },
  reinforcementRow: {
    marginTop: 4,
  },
  reinforcementText: {
    fontSize: 12,
    color: "#5b6a52",
    fontStyle: "italic",
  },
  failedRow: { marginTop: 4 },
  failedText: { fontSize: 12, color: "#8a3a3a" },
  capturedDivider: {
    listStyle: "none",
    fontSize: 11,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#8c7e63",
    padding: "12px 0 2px",
    borderTop: "1px dashed #d9d3c4",
    margin: "6px 0 0",
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
  rollupEmpty: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
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
    gap: 6,
  },
  midweekRemainingItem: {},
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
  fridayHeader: { marginBottom: 14 },
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
