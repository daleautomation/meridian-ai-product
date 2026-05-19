"use client";

// Meridian — Outcome Loop UI, per-lead capture block.
//
// Composes the continuity primitives (ContinuityStrip OR the richer
// state chip + continuity lines) with OutcomeButtons + OutcomeHistory
// into one block. Owns its own optimistic state: a click on a button
// appends locally, the strip/chip/history re-derive immediately, no
// parent rerender needed.
//
// Variants:
//   strip   — one quiet line summary. Operator console default.
//   memory  — small state chip + up to three deterministic continuity
//             lines. Used by the Recovery Brief to make each card feel
//             like a remembered relationship instead of a static row.
//
// Initial outcomes can be passed in (server-fetched for the brief) or
// fetched on mount (operator console). When neither is supplied, the
// block renders as if there is no history yet — the buttons are still
// fully functional.

import { useEffect, useMemo, useState } from "react";

import {
  relationshipMovementSummary,
  sortDescending,
} from "@/lib/recovery/outcomes/continuity";
import {
  buildContinuityLines,
  deriveRelationshipState,
} from "@/lib/recovery/outcomes/state";
import type {
  OutcomeSource,
  OutcomeType,
  RelationshipOutcome,
} from "@/lib/recovery/outcomes/types";

import { ContinuityLines } from "./ContinuityLines";
import { ContinuityStateChip } from "./ContinuityStateChip";
import { ContinuityStrip } from "./ContinuityStrip";
import { OutcomeButtons } from "./OutcomeButtons";
import { OutcomeHistory } from "./OutcomeHistory";

export type LeadOutcomeBlockVariant = "strip" | "memory";

export interface LeadOutcomeBlockProps {
  customer: string;
  leadKey: string;
  source: OutcomeSource;
  /** Outcomes already known at render time. Optional. */
  initialOutcomes?: readonly RelationshipOutcome[];
  /** When true, the block fetches /api/outcomes/list on mount. */
  fetchOnMount?: boolean;
  /** Optional staleness score snapshot to embed in new records. */
  staleScoreAtTime?: number;
  /** Optional decision bucket snapshot to embed in new records. */
  decisionBucketAtTime?: string;
  /** Subset/order override for the button row. */
  outcomes?: readonly OutcomeType[];
  /** Reference "now" for deterministic SSR rendering of the strip. */
  now?: Date;
  /**
   * Visual variant. "strip" (default) renders one quiet line. "memory"
   * renders the relationship-state chip + up to three continuity lines
   * so the surface feels like a remembered relationship.
   */
  variant?: LeadOutcomeBlockVariant;
  /**
   * Memory-variant only: CSV staleness fallback so a never-touched
   * relationship still surfaces "Last meaningful touch: N days ago".
   */
  fallbackDaysSinceTouch?: number | null;
  className?: string;
}

export function LeadOutcomeBlock({
  customer,
  leadKey,
  source,
  initialOutcomes,
  fetchOnMount = false,
  staleScoreAtTime,
  decisionBucketAtTime,
  outcomes,
  now,
  variant = "strip",
  fallbackDaysSinceTouch = null,
  className,
}: LeadOutcomeBlockProps) {
  const [entries, setEntries] = useState<RelationshipOutcome[]>(() =>
    initialOutcomes ? [...initialOutcomes] : [],
  );

  // Refresh on mount when no SSR-supplied initial set was available.
  useEffect(() => {
    if (!fetchOnMount) return;
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ customer, leadKey });
        const res = await fetch(`/api/outcomes/list?${params.toString()}`, {
          credentials: "include",
        });
        const json = (await res.json().catch(() => null)) as
          | { ok: true; outcomes: RelationshipOutcome[] }
          | { ok: false }
          | null;
        if (!cancelled && json && "ok" in json && json.ok && Array.isArray(json.outcomes)) {
          setEntries(json.outcomes);
        }
      } catch {
        // Silent — the buttons still work, the strip just stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customer, leadKey, fetchOnMount]);

  const movement = useMemo(
    () => relationshipMovementSummary(entries, leadKey),
    [entries, leadKey],
  );
  const history = useMemo(() => sortDescending(entries), [entries]);

  const memoryState = useMemo(
    () => (variant === "memory" ? deriveRelationshipState(movement, now) : null),
    [variant, movement, now],
  );
  const memoryLines = useMemo(
    () =>
      variant === "memory"
        ? buildContinuityLines({ movement, history, fallbackDaysSinceTouch, now })
        : null,
    [variant, movement, history, fallbackDaysSinceTouch, now],
  );

  return (
    <div
      className={className}
      data-meridian="lead-outcome-block"
      data-variant={variant}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {variant === "memory" && memoryState && memoryLines ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <ContinuityLines lines={memoryLines} />
          <ContinuityStateChip state={memoryState.state} label={memoryState.label} />
        </div>
      ) : (
        <ContinuityStrip movement={movement} now={now} />
      )}
      <OutcomeButtons
        customer={customer}
        leadKey={leadKey}
        source={source}
        outcomes={outcomes}
        staleScoreAtTime={staleScoreAtTime}
        decisionBucketAtTime={decisionBucketAtTime}
        onRecorded={(record) => setEntries((prev) => [...prev, record])}
      />
      <OutcomeHistory history={history} now={now} />
    </div>
  );
}
