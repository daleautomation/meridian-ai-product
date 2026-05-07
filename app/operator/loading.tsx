// Meridian — Instant operator loading shell.
//
// Next.js auto-renders this while app/operator/page.tsx (the server
// component) is computing. Streams to the browser before any heavy
// work runs, so the user never sees a white screen even on a cold
// Vercel container that has to do full ingestion + scheduling +
// strategy generation. Match the OperatorConsole frame so the
// transition into the live view is visually quiet.

const palette = {
  surface: "#FFFFFF",
  surfaceMuted: "#FAFBFC",
  border: "#E2E8F0",
  borderLight: "#F1F5F9",
  text: "#1A1A2E",
  textMuted: "#64748B",
  textTertiary: "#94A3B8",
  accent: "#2563EB",
  accentMuted: "#EFF6FF",
};

export default function OperatorLoading() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: palette.surfaceMuted,
        color: palette.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      {/* Top nav frame — matches OperatorConsole header shape so the
          shell-to-live transition is invisible. */}
      <header
        style={{
          height: "51px",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: palette.surface,
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            MERIDIAN
          </div>
          <div
            style={{
              padding: "3px 9px",
              borderRadius: "5px",
              background: palette.accentMuted,
              color: palette.accent,
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.02em",
            }}
          >
            LABORTECH
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <SkeletonPill width={80} />
          <SkeletonPill width={80} />
          <SkeletonPill width={80} />
        </div>
      </header>

      {/* Body frame */}
      <div style={{ display: "flex", height: "calc(100dvh - 51px)" }}>
        {/* Main column */}
        <main
          style={{
            flex: 1,
            padding: "20px 24px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "16px",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: palette.text,
                  marginBottom: "4px",
                }}
              >
                Today&rsquo;s Command Queue
              </div>
              <div style={{ fontSize: "12px", color: palette.textMuted, display: "flex", alignItems: "center", gap: "8px" }}>
                <Spinner />
                Loading today&rsquo;s call plan&hellip;
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <DisabledButton label="Refresh" />
              <DisabledButton label="Export" primary />
            </div>
          </div>

          {/* Trade tab strip */}
          <div
            style={{
              display: "flex",
              gap: "6px",
              marginBottom: "20px",
              borderBottom: `1px solid ${palette.borderLight}`,
              paddingBottom: "10px",
            }}
          >
            {["Roofing", "HVAC", "Plumbing", "Electrical", "Carpentry", "Painting"].map((label, i) => (
              <div
                key={label}
                style={{
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: i === 0 ? palette.text : palette.textTertiary,
                  borderBottom: i === 0 ? `2px solid ${palette.accent}` : "2px solid transparent",
                  cursor: "default",
                }}
              >
                {label}
              </div>
            ))}
          </div>

          {/* Skeleton lead rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </div>

          <div
            style={{
              marginTop: "20px",
              padding: "12px 14px",
              background: palette.surface,
              border: `1px dashed ${palette.border}`,
              borderRadius: "8px",
              fontSize: "12px",
              color: palette.textMuted,
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <Spinner />
            Background intelligence is still loading. Diagnostics, sales strategies, and calendar
            assignments will populate momentarily.
          </div>
        </main>

        {/* Right rail */}
        <aside
          style={{
            width: "340px",
            background: palette.surface,
            borderLeft: `1px solid ${palette.border}`,
            padding: "20px 18px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: palette.text,
              marginBottom: "12px",
            }}
          >
            Assist
          </div>
          <SkeletonBlock height={80} />
          <div style={{ height: "12px" }} />
          <SkeletonBlock height={120} />
          <div style={{ height: "12px" }} />
          <SkeletonBlock height={60} />
        </aside>
      </div>

      {/* Spinner keyframes — inlined so no external CSS is required. */}
      <style>{`
        @keyframes meridian-skeleton-pulse {
          0% { opacity: 0.55; }
          50% { opacity: 0.95; }
          100% { opacity: 0.55; }
        }
        @keyframes meridian-loading-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "14px 14px",
        background: palette.surface,
        border: `1px solid ${palette.borderLight}`,
        borderRadius: "8px",
      }}
    >
      <SkeletonBlock width={32} height={32} radius={8} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
        <SkeletonBlock width="40%" height={12} />
        <SkeletonBlock width="65%" height={10} />
      </div>
      <SkeletonPill width={70} />
      <SkeletonPill width={56} />
    </div>
  );
}

function SkeletonBlock({
  width = "100%",
  height = 14,
  radius = 6,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
}) {
  return (
    <div
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: `${height}px`,
        borderRadius: `${radius}px`,
        background: "linear-gradient(90deg, #E2E8F0 0%, #EEF2F7 50%, #E2E8F0 100%)",
        animation: "meridian-skeleton-pulse 1.4s ease-in-out infinite",
      }}
    />
  );
}

function SkeletonPill({ width }: { width: number }) {
  return <SkeletonBlock width={width} height={22} radius={11} />;
}

function DisabledButton({ label, primary = false }: { label: string; primary?: boolean }) {
  return (
    <div
      aria-disabled="true"
      style={{
        padding: "7px 14px",
        fontSize: "12px",
        fontWeight: 500,
        borderRadius: "7px",
        background: primary ? palette.accentMuted : palette.surface,
        color: primary ? palette.accent : palette.textTertiary,
        border: `1px solid ${primary ? palette.accentMuted : palette.borderLight}`,
        opacity: 0.6,
        cursor: "not-allowed",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

function Spinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        border: `2px solid ${palette.borderLight}`,
        borderTopColor: palette.accent,
        animation: "meridian-loading-spin 0.8s linear infinite",
      }}
      aria-hidden="true"
    />
  );
}
