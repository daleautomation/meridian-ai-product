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
import { formatStableUtcTimestamp, parseHydrationTime } from "../lib/hydrationTime";

interface Props {
  workspaceSlug: string;
  generatedAt: string | null;
  initialNowIso: string;
  readOnly?: boolean;
  readOnlyReason?: string;
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
  const ts = parseHydrationTime(generatedAtIso);
  if (ts === null) return { label: "snapshot invalid", stale: true };
  const ageMs = Math.max(0, now - ts);
  const stale = ageMs > 12 * 60 * 60 * 1000; // >12h
  if (ageMs < 60_000) return { label: "Updated just now", stale: false };
  if (ageMs < 3_600_000) return { label: `Updated ${Math.floor(ageMs / 60_000)} min ago`, stale: false };
  if (ageMs < 86_400_000) return { label: `Updated ${Math.floor(ageMs / 3_600_000)}h ago`, stale };
  return { label: `Updated ${Math.floor(ageMs / 86_400_000)}d ago`, stale: true };
}

function nextFreshnessTickMs(generatedAtIso: string | null, nowMs: number): number {
  const ts = parseHydrationTime(generatedAtIso);
  if (ts === null) return 60_000;
  const ageMs = Math.max(0, nowMs - ts);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  let nextBoundary = minute;
  if (ageMs >= day) nextBoundary = (Math.floor(ageMs / day) + 1) * day;
  else if (ageMs >= hour) nextBoundary = (Math.floor(ageMs / hour) + 1) * hour;
  else if (ageMs >= minute) nextBoundary = (Math.floor(ageMs / minute) + 1) * minute;
  const untilBoundary = nextBoundary - ageMs + 100;
  return Math.min(Math.max(untilBoundary, 1_000), 60_000);
}

export default function SnapshotFreshnessPill({
  workspaceSlug,
  generatedAt,
  initialNowIso,
  readOnly = false,
  readOnlyReason = "This workspace is read-only.",
}: Props) {
  const router = useRouter();
  const initialNow = useMemo(
    () => parseHydrationTime(initialNowIso) ?? parseHydrationTime(generatedAt) ?? 0,
    [generatedAt, initialNowIso],
  );
  const [now, setNow] = useState(initialNow);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNow(initialNow);
  }, [initialNow]);

  // After hydration, tick only when the visible freshness bucket can change.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        setNow(Date.now());
        schedule();
      }, nextFreshnessTickMs(generatedAt, Date.now()));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [generatedAt]);

  const { label, stale } = useMemo(() => formatRelative(generatedAt, now), [generatedAt, now]);
  const generatedAtTitle = formatStableUtcTimestamp(generatedAt);

  async function handleRefresh() {
    if (readOnly) return;
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
      // The endpoint reports `invalidated: false` on Vercel because
      // the deploy filesystem is read-only at runtime. In that case
      // we still soft-refresh so the relative-time label re-computes,
      // but the underlying snapshot stays unchanged. On dev the write
      // succeeds and the next render genuinely re-runs the slow path.
      const body = await res.json().catch(() => null);
      const trulyInvalidated = body?.invalidated === true;
      router.refresh();
      if (!trulyInvalidated) {
        // Tell the operator honestly that nothing actually changed —
        // a redeploy is required to refresh data on production.
        setError("snapshot stays cached on production — redeploy to refresh");
      }
      setTimeout(() => setRefreshing(false), 800);
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
      title={generatedAtTitle ? `Snapshot generated at ${generatedAtTitle}` : "No snapshot available"}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
        <Dot stale={stale} />
        {refreshing ? "Refreshing intelligence…" : label}
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing || readOnly}
        aria-label="Refresh intelligence"
        title={readOnly ? readOnlyReason : "Refresh intelligence"}
        style={{
          marginLeft: "4px",
          padding: "2px 8px",
          fontSize: "11px",
          fontWeight: 600,
          background: refreshing || readOnly ? palette.pillBorder : "#FFFFFF",
          color: stale ? palette.warningText : palette.pillText,
          border: `1px solid ${stale ? "#FCD34D" : palette.pillBorder}`,
          borderRadius: "999px",
          cursor: readOnly ? "not-allowed" : refreshing ? "wait" : "pointer",
          opacity: readOnly ? 0.7 : 1,
          transition: "background 120ms ease",
        }}
      >
        {refreshing ? <Spinner /> : readOnly ? "Locked" : "Refresh"}
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
