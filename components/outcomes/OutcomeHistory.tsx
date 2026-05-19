// Meridian — Outcome Loop UI, compact append-only history.
//
// One <details> block per lead. Closed by default. When open, shows
// every recorded outcome newest-first as a quiet "May 18 · meeting
// booked" line. Optional note text is displayed inline. No timeline
// visualization. No activity feed UI.

import type { RelationshipOutcome } from "@/lib/recovery/outcomes/types";
import { outcomeLabel, shortDate } from "./format";

export interface OutcomeHistoryProps {
  /** History entries newest-first. Caller is expected to sort. */
  history: readonly RelationshipOutcome[];
  /** Reference "now" for date formatting (deterministic SSR). */
  now?: Date;
  className?: string;
}

export function OutcomeHistory({ history, now, className }: OutcomeHistoryProps) {
  if (history.length === 0) return null;

  return (
    <details
      className={className}
      data-meridian="outcome-history"
      style={{
        marginTop: 8,
        fontSize: 12,
        color: "#687381",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: "#687381",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          listStyle: "none",
          userSelect: "none",
        }}
      >
        History · {history.length}
      </summary>
      <ul
        style={{
          margin: "8px 0 0",
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {history.map((entry) => (
          <li
            key={entry.id}
            style={{
              display: "grid",
              gridTemplateColumns: "60px 1fr",
              gap: 10,
              color: "#2f3a46",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <span style={{ color: "#9aa3ad", fontVariantNumeric: "tabular-nums" }}>
              {shortDate(entry.recordedAt, now)}
            </span>
            <span>
              {outcomeLabel(entry.outcome).toLowerCase()}
              {entry.note ? (
                <span style={{ color: "#687381" }}> — {entry.note}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
