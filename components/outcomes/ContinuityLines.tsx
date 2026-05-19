// Meridian — Outcome Loop UI, continuity lines.
//
// Renders the deterministic continuity lines from
// lib/recovery/outcomes/state.ts as a tight, low-noise stack. Each
// line is plain text; the leading dot is the only visual ornament and
// stays the same calm tone as the rest of the brief.
//
// When `lines` is empty the component renders null so the surrounding
// section can collapse silently — better than dead placeholder copy.

export interface ContinuityLinesProps {
  lines: readonly string[];
  className?: string;
}

export function ContinuityLines({ lines, className }: ContinuityLinesProps) {
  if (lines.length === 0) return null;
  return (
    <ul
      className={className}
      data-meridian="continuity-lines"
      style={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {lines.map((line) => (
        <li
          key={line}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            color: "#2f3a46",
            fontSize: 12.5,
            lineHeight: 1.5,
            letterSpacing: "0.005em",
          }}
        >
          <span
            aria-hidden
            style={{
              flex: "0 0 auto",
              width: 3,
              height: 3,
              borderRadius: "50%",
              background: "#cbc4b7",
              marginTop: 7,
            }}
          />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}
