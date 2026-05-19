// Meridian — Outcome Loop UI, relationship-state chip.
//
// A tiny, single-line operational chip. Bloomberg/Linear-flavored:
// muted background, hairline border, all states share the same shell
// and differ only in text tone so the surface reads as one quiet
// system, not a status board.
//
// Pure presentational. No state, no effects. Safe in server contexts.

import type { RelationshipState } from "@/lib/recovery/outcomes/state";

const STATE_TEXT_COLOR: Record<RelationshipState, string> = {
  // All states sit on the same neutral chip. Only the text tone shifts
  // and only within a tight palette of operator-grade greys, so no
  // single state ever reads as a "win/loss" pill.
  dormant: "#9aa3ad",
  resurfacing: "#7c6f61",
  reopened: "#5b6d52",
  deferred: "#687381",
  recently_active: "#2f3a46",
};

export interface ContinuityStateChipProps {
  state: RelationshipState;
  label: string;
  className?: string;
}

export function ContinuityStateChip({
  state,
  label,
  className,
}: ContinuityStateChipProps) {
  return (
    <span
      className={className}
      data-meridian="continuity-state-chip"
      data-state={state}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: STATE_TEXT_COLOR[state],
        background: "#fffaf1",
        border: "1px solid #e7e0d6",
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: STATE_TEXT_COLOR[state],
          opacity: 0.55,
        }}
      />
      {label}
    </span>
  );
}
