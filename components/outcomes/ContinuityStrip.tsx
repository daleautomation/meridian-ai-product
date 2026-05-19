// Meridian — Outcome Loop UI, one-line continuity summary.
//
// Renders a single quiet line describing where the relationship sits:
//   "Last touched 14d ago · resurfaced 2× · current outcome: contacted"
//
// Pure presentation: every value comes from `relationshipMovementSummary`.
// No state. No effects. Safe in server or client contexts.

import type { RelationshipMovement } from "@/lib/recovery/outcomes/continuity";
import { outcomeLabel, relativeAgo } from "./format";

export interface ContinuityStripProps {
  movement: RelationshipMovement;
  /** Optional now override for deterministic testing / SSR. */
  now?: Date;
  /** Compact mode drops the resurfacing chip when count <= 1. */
  compact?: boolean;
  className?: string;
}

export function ContinuityStrip({
  movement,
  now,
  compact = false,
  className,
}: ContinuityStripProps) {
  const segments: string[] = [];

  if (movement.lastContactAt) {
    const ago = relativeAgo(movement.lastContactAt, now);
    segments.push(ago ? `Last touched ${ago}` : "Touched once");
  }

  if (movement.resurfacings > 1 || !compact) {
    if (movement.resurfacings > 0) {
      segments.push(`resurfaced ${movement.resurfacings}×`);
    }
  }

  if (movement.lastOutcome) {
    segments.push(`current outcome: ${outcomeLabel(movement.lastOutcome).toLowerCase()}`);
  }

  if (movement.closed) {
    segments.push("loop closed");
  }

  const text = segments.length > 0 ? segments.join(" · ") : "No continuity recorded yet.";

  return (
    <p
      className={className}
      data-meridian="continuity-strip"
      style={{
        margin: 0,
        color: "#687381",
        fontSize: 12,
        lineHeight: 1.5,
        letterSpacing: "0.01em",
      }}
    >
      {text}
    </p>
  );
}
