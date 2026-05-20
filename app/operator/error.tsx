"use client";

import { useEffect } from "react";

const palette = {
  surface: "#FFFFFF",
  surfaceMuted: "#FAFBFC",
  border: "#E2E8F0",
  text: "#1A1A2E",
  textMuted: "#64748B",
  accent: "#2563EB",
  accentMuted: "#EFF6FF",
  danger: "#B91C1C",
};

export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[operator-boundary]", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: palette.surfaceMuted,
        color: palette.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
        display: "grid",
        placeItems: "center",
        padding: "32px 18px",
      }}
    >
      <section
        style={{
          width: "min(720px, 100%)",
          background: palette.surface,
          border: `1px solid ${palette.border}`,
          borderRadius: "18px",
          boxShadow: "0 18px 55px -34px rgba(15,23,42,0.55)",
          padding: "28px",
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 800, letterSpacing: "0.12em", color: palette.accent, textTransform: "uppercase" }}>
          LaborTech workspace
        </div>
        <h1 style={{ margin: "8px 0 8px", fontSize: "26px", lineHeight: 1.15, letterSpacing: "-0.03em" }}>
          Workspace could not finish loading
        </h1>
        <p style={{ margin: 0, color: palette.textMuted, fontSize: "14px", lineHeight: 1.6 }}>
          Meridian kept the operator shell available instead of rendering a blank screen. Retry the load, or use the digest below for support.
        </p>
        {error?.digest ? (
          <div style={{ marginTop: "18px", fontSize: "12px", color: palette.danger, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            Digest: {error.digest}
          </div>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "22px",
            border: `1px solid ${palette.accent}`,
            background: palette.accentMuted,
            color: palette.accent,
            borderRadius: "10px",
            padding: "11px 16px",
            fontSize: "13px",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Retry workspace load
        </button>
      </section>
    </main>
  );
}
