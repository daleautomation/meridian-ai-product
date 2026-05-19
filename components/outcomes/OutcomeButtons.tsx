"use client";

// Meridian — Outcome Loop UI, one-click capture row.
//
// Client component. Renders a small row of outcome buttons. A click
// POSTs to /api/outcomes/record and (optimistically) calls onRecorded
// with the new entry so the parent can update its local history copy
// without a refetch.
//
// Quiet by design: subtle borders, neutral fill, single-line states.
// No badges, no toasts, no modal. Saving / saved feedback is shown
// inline on the clicked chip and clears after ~1.4s.

import { useCallback, useState } from "react";

import type {
  OutcomeSource,
  OutcomeType,
  RelationshipOutcome,
} from "@/lib/recovery/outcomes/types";
import { outcomeLabel } from "./format";

const DEFAULT_OUTCOMES: readonly OutcomeType[] = [
  "contacted",
  "no_response",
  "follow_up_later",
  "meeting_booked",
  "opportunity_reopened",
  "closed_won",
  "not_worth_pursuing",
];

type Phase = "idle" | "saving" | "saved" | "error";

interface ChipState {
  phase: Phase;
  message?: string;
}

export interface OutcomeButtonsProps {
  customer: string;
  leadKey: string;
  source: OutcomeSource;
  /**
   * Optional subset/order override. Defaults to the canonical 7-button row.
   * Provide a tighter set on dense surfaces (e.g. brief footer).
   */
  outcomes?: readonly OutcomeType[];
  /** Snapshot of the staleness score at capture time, if known. */
  staleScoreAtTime?: number;
  /** Snapshot of the decision bucket at capture time, if known. */
  decisionBucketAtTime?: string;
  /** Called after a successful append, with the persisted record. */
  onRecorded?: (record: RelationshipOutcome) => void;
  className?: string;
}

export function OutcomeButtons({
  customer,
  leadKey,
  source,
  outcomes = DEFAULT_OUTCOMES,
  staleScoreAtTime,
  decisionBucketAtTime,
  onRecorded,
  className,
}: OutcomeButtonsProps) {
  const [chipState, setChipState] = useState<Record<OutcomeType, ChipState>>(() => ({} as Record<OutcomeType, ChipState>));

  const setPhase = useCallback((outcome: OutcomeType, phase: Phase, message?: string) => {
    setChipState((prev) => ({ ...prev, [outcome]: { phase, message } }));
  }, []);

  const handleClick = useCallback(
    async (outcome: OutcomeType) => {
      setPhase(outcome, "saving");
      try {
        const res = await fetch("/api/outcomes/record", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer,
            leadKey,
            outcome,
            source,
            staleScoreAtTime,
            decisionBucketAtTime,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | { ok: true; record: RelationshipOutcome }
          | { ok: false; error?: string }
          | null;
        if (!res.ok || !json || !("ok" in json) || json.ok !== true) {
          const error = json && "error" in json ? json.error ?? "Could not record" : "Could not record";
          setPhase(outcome, "error", error);
          window.setTimeout(() => setPhase(outcome, "idle"), 2400);
          return;
        }
        setPhase(outcome, "saved");
        onRecorded?.(json.record);
        window.setTimeout(() => setPhase(outcome, "idle"), 1400);
      } catch (err) {
        setPhase(outcome, "error", err instanceof Error ? err.message : "Network error");
        window.setTimeout(() => setPhase(outcome, "idle"), 2400);
      }
    },
    [customer, leadKey, source, staleScoreAtTime, decisionBucketAtTime, onRecorded, setPhase],
  );

  return (
    <div
      className={className}
      data-meridian="outcome-buttons"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
      }}
      role="group"
      aria-label="Record relationship outcome"
    >
      {outcomes.map((outcome) => {
        const state = chipState[outcome] ?? { phase: "idle" as Phase };
        const isBusy = state.phase === "saving";
        const isSaved = state.phase === "saved";
        const isError = state.phase === "error";
        return (
          <button
            key={outcome}
            type="button"
            onClick={() => handleClick(outcome)}
            disabled={isBusy}
            aria-label={`Record outcome: ${outcomeLabel(outcome)}`}
            title={isError ? state.message : undefined}
            style={{
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.4,
              letterSpacing: "0.01em",
              color: isError ? "#9b3a3a" : isSaved ? "#2f6f4d" : "#2f3a46",
              background: isSaved ? "#eef7f1" : isError ? "#fbeeee" : "#fbfaf6",
              border: `1px solid ${
                isSaved ? "#cfe6da" : isError ? "#ecd3d3" : "#e4ddd1"
              }`,
              borderRadius: 999,
              padding: "5px 10px",
              cursor: isBusy ? "default" : "pointer",
              transition: "all 160ms cubic-bezier(0.4, 0, 0.2, 1)",
              whiteSpace: "nowrap",
              opacity: isBusy ? 0.65 : 1,
            }}
          >
            {isBusy
              ? `${outcomeLabel(outcome)}…`
              : isSaved
                ? `${outcomeLabel(outcome)} ✓`
                : outcomeLabel(outcome)}
          </button>
        );
      })}
    </div>
  );
}
