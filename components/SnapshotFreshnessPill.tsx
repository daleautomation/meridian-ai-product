"use client";

// Meridian — Snapshot freshness indicator + manual refresh.
//
// Sits in the operator header. Reads the snapshot timestamp passed
// down from the server, renders a relative-time pill, and offers a
// "Refresh" affordance that POSTs to /api/snapshots/refresh and then
// triggers a soft router refresh so the next render runs the slow
// path against fresh data.
//
// Visual goal: muted pill that doesn't compete with the operator
// surface. Becomes interactive when hovered. Refresh state is
// signalled with a small spinner and a brief "Refreshing…" label.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  workspaceSlug: string;
  generatedAt: string | null;
}

const palette = {
  pillBg: "#F1F5F9",
  pillBorder: "#E2E8F0",
  pillText: "#475569",
  pillTextMuted: "#94A3B8",
  pillHover: "#E2E8F0",
  spinnerTrack: "#E2E8F0",
  spinnerFill: "#2563EB",
  warningBg: "#FEF3C7",
  warningText: "#92400E",
};

function formatRelative(generatedAtIso: string | null, now: number): { label: string; stale: boolean } {
  if (!generatedAtIso) return { label: "no snapshot", stale: true };
  const ts = new Date(generatedAtIso).getTime();
  if (!Number.isFinite(ts)) return { label: "snapshot invalid", stale: true };
  const ageMs = now - ts;
  const stale = ageMs > 12 * 60 * 60 * 1000; // >12h
  if (ageMs < 60_000) return { label: "Updated just now", stale: false };
  if (ageMs < 3_600_000) return { label: `Updated ${Math.floor(ageMs / 60_000)} min ago`, stale: false };
  if (ageMs < 86_400_000) return { label: `Updated ${Math.floor(ageMs / 3_600_000)}h ago`, stale };
  return { label: `Updated ${Math.floor(ageMs / 86_400_000)}d ago`, stale: true };
}

export default function SnapshotFreshnessPill({ workspaceSlug, generatedAt }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tick once a minute so the relative time stays current without
  // burning cycles on a re-render storm.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { label, stale } = useMemo(() => formatRelative(generatedAt, now), [generatedAt, now]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/snapshots/refresh?workspace=${encodeURIComponent(workspaceSlug)}`,
        { method: "POST", credentials: "same-origin" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Soft refresh — the next page render will run the slow path
      // and produce a new snapshot.
      router.refresh();
      // Hold the spinner briefly so the user sees the action took.
      setTimeout(() => setRefreshing(false), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "refresh failed");
      setRefreshing(false);
    }
  }

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 8px 4px 10px",
        background: stale ? palette.warningBg : palette.pillBg,
        border: `1px solid ${stale ? "#FCD34D" : palette.pillBorder}`,
        borderRadius: "999px",
        fontSize: "11px",
        fontWeight: 500,
        color: stale ? palette.warningText : palette.pillText,
        userSelect: "none",
      }}
      title={generatedAt ? `Snapshot generated at ${new Date(generatedAt).toLocaleString()}` : "No snapshot available"}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
        <Dot stale={stale} />
        {refreshing ? "Refreshing intelligence…" : label}
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label="Refresh intelligence"
        style={{
          marginLeft: "4px",
          padding: "2px 8px",
          fontSize: "11px",
          fontWeight: 600,
          background: refreshing ? palette.pillBorder : "#FFFFFF",
          color: stale ? palette.warningText : palette.pillText,
          border: `1px solid ${stale ? "#FCD34D" : palette.pillBorder}`,
          borderRadius: "999px",
          cursor: refreshing ? "wait" : "pointer",
          transition: "background 120ms ease",
        }}
      >
        {refreshing ? <Spinner /> : "Refresh"}
      </button>
      {error ? (
        <span
          role="alert"
          style={{ marginLeft: "6px", fontSize: "10px", color: "#B91C1C" }}
          title={error}
        >
          ⚠
        </span>
      ) : null}
    </div>
  );
}

function Dot({ stale }: { stale: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: stale ? "#D97706" : "#22C55E",
        display: "inline-block",
      }}
    />
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "10px",
        height: "10px",
        borderRadius: "50%",
        border: `2px solid ${palette.spinnerTrack}`,
        borderTopColor: palette.spinnerFill,
        animation: "meridian-spin 0.8s linear infinite",
      }}
    />
  );
}
