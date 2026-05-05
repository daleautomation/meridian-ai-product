// Meridian — read-only source readiness strip.
//
// Renders a compact horizontal strip showing which lead-data sources
// are currently connected. Surfaced inside the workspace so an operator
// can tell at a glance why a bucket might be empty. No interactions.

import type { SourceReadinessItem } from "../lib/sources/readiness";

const dotColor = (status: SourceReadinessItem["status"]): string => {
  if (status === "Connected") return "#16A34A";    // green
  if (status === "Available") return "#2563EB";    // blue
  if (status === "Error") return "#DC2626";        // red
  return "#94A3B8";                                 // slate (Not connected)
};

export default function SourceReadiness({
  items,
  compact = false,
}: {
  items: SourceReadinessItem[];
  compact?: boolean;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Source readiness"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: compact ? "8px" : "10px",
        padding: compact ? "8px 10px" : "10px 12px",
        background: "#FAFBFC",
        border: "1px solid #E2E8F0",
        borderRadius: "10px",
        fontSize: "11px",
        color: "#1A1A2E",
        lineHeight: 1.4,
      }}
    >
      <span style={{
        fontSize: "10px",
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: "#64748B",
        textTransform: "uppercase",
        marginRight: "4px",
        alignSelf: "center",
      }}>
        Sources
      </span>
      {items.map((it) => (
        <span
          key={it.id}
          title={it.detail || it.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 8px",
            borderRadius: "999px",
            background: "#FFFFFF",
            border: "1px solid #E2E8F0",
          }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              background: dotColor(it.status),
              display: "inline-block",
            }}
          />
          <span style={{ fontWeight: 600 }}>{it.label}</span>
          <span style={{ color: "#64748B" }}>· {it.status}</span>
        </span>
      ))}
    </div>
  );
}
