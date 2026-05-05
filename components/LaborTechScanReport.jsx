"use client";

// Meridian — LaborTech Scan Report.
//
// Premium slide-out report rendered when the operator clicks "View Scan"
// on a Right Now or Up Next card. Reads from task.laborTechScan (the
// structured artifact built during ingestion). Never fabricates data —
// fields that aren't on the scan stay empty rather than filling space
// with filler copy.

import { useEffect } from "react";

const PALETTE = {
  pageBg:        "#F8FAFC",
  cardBg:        "#FFFFFF",
  border:        "#E2E8F0",
  borderSoft:    "#F1F5F9",
  textPrimary:   "#0F172A",
  textSecondary: "#475569",
  muted:         "#94A3B8",
  blue:          "#3B82F6",
  bluePale:      "#EFF6FF",
  blueRing:      "rgba(59,130,246,0.08)",
  blueShadow:    "rgba(59,130,246,0.18)",
  red:           "#DC2626",
  redPale:       "#FEF2F2",
  green:         "#16A34A",
  greenPale:     "#F0FDF4",
  amber:         "#D97706",
  amberPale:     "#FFFBEB",
};

const PAIN_TONE = {
  low:      { fg: PALETTE.muted,        bg: PALETTE.borderSoft,  label: "LOW" },
  medium:   { fg: PALETTE.amber,        bg: PALETTE.amberPale,   label: "MEDIUM" },
  high:     { fg: PALETTE.red,          bg: PALETTE.redPale,     label: "HIGH" },
  critical: { fg: "#fff",               bg: PALETTE.red,         label: "CRITICAL" },
};

const CLOSE_TONE = {
  Weak:          { fg: PALETTE.muted,   bg: PALETTE.borderSoft },
  Moderate:      { fg: PALETTE.amber,   bg: PALETTE.amberPale },
  Strong:        { fg: PALETTE.green,   bg: PALETTE.greenPale },
  "High-Intent": { fg: PALETTE.blue,    bg: PALETTE.bluePale },
};

const URGENCY_TONE = {
  Low:      { fg: PALETTE.muted,        bg: PALETTE.borderSoft },
  Medium:   { fg: PALETTE.textSecondary, bg: PALETTE.borderSoft },
  High:     { fg: PALETTE.amber,        bg: PALETTE.amberPale },
  Critical: { fg: "#fff",               bg: PALETTE.red },
};

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: "10px",
      fontWeight: 800,
      letterSpacing: "0.14em",
      color: PALETTE.muted,
      textTransform: "uppercase",
      marginBottom: "6px",
    }}>
      {children}
    </div>
  );
}

function SectionCard({ children, accent }) {
  return (
    <div style={{
      background: PALETTE.cardBg,
      border: `1px solid ${PALETTE.border}`,
      borderLeft: accent ? `3px solid ${accent}` : `1px solid ${PALETTE.border}`,
      borderRadius: "12px",
      padding: "12px 14px",
      boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
    }}>
      {children}
    </div>
  );
}

function Pill({ tone, children }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      fontSize: "11px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      padding: "3px 10px",
      borderRadius: "999px",
      color: tone.fg,
      background: tone.bg,
    }}>
      {children}
    </span>
  );
}

export default function LaborTechScanReport({ open, onClose, onBack, scan, company, service, trade, emailStatus, verifiedEmail }) {
  // ESC closes.
  useEffect(() => {
    if (!open || typeof window === "undefined") return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Log the open event once per open. Must run before any conditional
  // return so React's hook order stays stable across renders.
  useEffect(() => {
    if (!open || !scan) return;
    // eslint-disable-next-line no-console
    console.log(
      `[scan-report] opened="${company ?? "(unknown)"}" ` +
      `service="${scan.primaryService ?? ""}" closeability="${scan.closeability?.label ?? ""}"`,
    );
  }, [open, scan, company]);

  if (!open) return null;

  const safe = scan ?? null;
  const painTone = PAIN_TONE[safe?.painLevel ?? "low"] ?? PAIN_TONE.low;
  const closeTone = CLOSE_TONE[safe?.closeability?.label ?? "Moderate"] ?? CLOSE_TONE.Moderate;
  const urgencyTone = URGENCY_TONE[safe?.urgency?.label ?? "Medium"] ?? URGENCY_TONE.Medium;

  const evidence = Array.isArray(safe?.evidence) ? safe.evidence : [];
  const impact = Array.isArray(safe?.businessImpact) ? safe.businessImpact : [];
  const risks = Array.isArray(safe?.risks) ? safe.risks : [];

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`LaborTech Deep Report for ${company ?? "lead"}`}
      style={{
        // Layout-neutral. The drawer's Deep Report cell owns surface,
        // motion, and the single scroll boundary. This component
        // contributes content only — no own scroll, no own motion.
        width: "100%",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
      }}
    >
        {/* Header — premium "consultant brief" treatment. Stronger
            eyebrow + the report ID line so this surface reads as a
            distinct intelligence layer, not a longer copy of the
            operator panel. Back button (when supplied by the drawer)
            sits in the header row, left of the title — never
            absolutely positioned, never covering the title text. */}
        <header style={{
          padding: "18px 22px 16px",
          background: PALETTE.cardBg,
          borderBottom: `1px solid ${PALETTE.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", minWidth: 0, flex: 1 }}>
            {typeof onBack === "function" ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to lead"
                title="Back to lead"
                style={{
                  flexShrink: 0,
                  marginTop: "2px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: PALETTE.blue,
                  background: PALETTE.cardBg,
                  border: `1px solid rgba(37,99,235,0.30)`,
                  borderRadius: "999px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                ← Back
              </button>
            ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: "11px", fontWeight: 900, letterSpacing: "0.18em",
              color: PALETTE.blue, textTransform: "uppercase",
            }}>
              LaborTech Deep Report
            </div>
            <div style={{
              fontSize: "21px", fontWeight: 700, color: PALETTE.textPrimary,
              marginTop: "4px", lineHeight: 1.2, letterSpacing: "-0.005em",
            }}>
              {company ?? "Lead"}
            </div>
            <div style={{
              fontSize: "12px", color: PALETTE.textSecondary, marginTop: "4px",
              lineHeight: 1.5,
            }}>
              Full intelligence brief — proof, angle, and confidence
              {trade ? <> · <span style={{ color: PALETTE.muted }}>{trade}</span></> : null}
            </div>
            {(() => {
              // Email enrichment status — never invent an address.
              if (emailStatus === "verified" && verifiedEmail) {
                return (
                  <div style={{
                    fontSize: "11px", color: PALETTE.green, marginTop: "6px",
                    fontWeight: 600,
                  }}>
                    Verified email · <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{verifiedEmail}</span>
                  </div>
                );
              }
              const status = emailStatus ?? "not_searched";
              const hint =
                status === "searching" ? "Email enrichment in progress…"
                : status === "needs_manual_review" ? "Email needs manual review."
                : status === "not_found" ? "No verified email found yet — phone-first outreach."
                : "No verified email found yet — phone-first outreach.";
              return (
                <div style={{
                  fontSize: "11px", color: PALETTE.muted, marginTop: "6px",
                  fontStyle: "italic",
                }}>
                  {hint}
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
              {safe?.primaryService ? (
                <Pill tone={{ fg: PALETTE.blue, bg: PALETTE.bluePale }}>
                  {safe.primaryService}
                </Pill>
              ) : null}
              <Pill tone={painTone}>Pain · {painTone.label}</Pill>
              <Pill tone={urgencyTone}>Urgency · {(safe?.urgency?.label ?? "Medium").toUpperCase()}</Pill>
              <Pill tone={closeTone}>
                {(safe?.closeability?.label ?? "Moderate").toUpperCase()}
              </Pill>
              {typeof safe?.closeability?.score === "number" ? (
                <Pill tone={{ fg: "#2563EB", bg: "rgba(59,130,246,0.10)" }}>
                  Closeability {Math.max(0, Math.min(100, Math.round(safe.closeability.score <= 1 ? safe.closeability.score * 100 : safe.closeability.score)))}%
                </Pill>
              ) : null}
            </div>
          </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: "20px",
              color: PALETTE.muted,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        {/* Scrollable body — independent scroll, contained so wheel
            events never bleed into the operator panel or the body.
            Slate-tinted page bg here distinguishes the Deep Report's
            depth surface from the operator panel's white quick-action
            surface. Section cards inside still render on white. */}
        <div style={{
          padding: "16px 22px 32px",
          background: "#F8FAFC",
          // Inner scroll removed — the LeadWorkflowDrawer's
          // `.deep-scroll` wrapper is the single scroll owner so
          // wheel events are unambiguous.
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}>
          {!safe ? (
            <div style={{ color: PALETTE.textSecondary, fontSize: "13px" }}>
              No scan available for this lead.
            </div>
          ) : (
            <>
              {/* A. Executive Readout */}
              <SectionCard accent={PALETTE.blue}>
                <SectionLabel>Executive Readout</SectionLabel>
                <div style={{ fontSize: "13px", color: PALETTE.textPrimary, lineHeight: 1.55 }}>
                  {safe.reportSummary}
                </div>
              </SectionCard>

              {/* B. Primary Pain Point */}
              <SectionCard>
                <SectionLabel>Primary Pain Point</SectionLabel>
                <div style={{ fontSize: "14px", fontWeight: 700, color: PALETTE.textPrimary, lineHeight: 1.35 }}>
                  {safe.primaryPain}
                </div>
                {safe.qualificationReason ? (
                  <div style={{ fontSize: "11px", color: PALETTE.muted, marginTop: "6px" }}>
                    Qualifier: {safe.qualificationReason}
                  </div>
                ) : null}
              </SectionCard>

              {/* C. Why It Matters */}
              {impact.length > 0 ? (
                <SectionCard>
                  <SectionLabel>Why It Matters</SectionLabel>
                  <ul style={{
                    margin: 0, paddingLeft: "18px",
                    fontSize: "13px", color: PALETTE.textSecondary, lineHeight: 1.55,
                  }}>
                    {impact.map((line, i) => (
                      <li key={`impact-${i}`} style={{ marginBottom: "4px" }}>{line}</li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              {/* D. Evidence Found */}
              {evidence.length > 0 ? (
                <SectionCard>
                  <SectionLabel>Evidence Found</SectionLabel>
                  <ul style={{
                    margin: 0, paddingLeft: "18px",
                    fontSize: "13px", color: PALETTE.textSecondary, lineHeight: 1.55,
                  }}>
                    {evidence.map((e, i) => (
                      <li key={`ev-${i}`} style={{ marginBottom: "4px" }}>{e}</li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              {/* E. Recommended LaborTech Offer */}
              <SectionCard accent={PALETTE.blue}>
                <SectionLabel>Recommended LaborTech Offer</SectionLabel>
                <div style={{ fontSize: "14px", fontWeight: 700, color: PALETTE.blue, marginBottom: "4px" }}>
                  {safe.primaryService}
                </div>
                <div style={{ fontSize: "13px", color: PALETTE.textSecondary, lineHeight: 1.5 }}>
                  {safe.serviceFit}
                </div>
              </SectionCard>

              {/* F. Sales Angle */}
              <SectionCard accent={PALETTE.blue}>
                <SectionLabel>Sales Angle</SectionLabel>
                <div style={{ fontSize: "10px", fontWeight: 700, color: PALETTE.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "4px" }}>
                  Opener
                </div>
                <div style={{
                  fontSize: "13px", color: PALETTE.textPrimary, lineHeight: 1.55,
                  fontStyle: "italic",
                  background: PALETTE.bluePale,
                  border: `1px solid ${PALETTE.borderSoft}`,
                  borderRadius: "10px",
                  padding: "10px 12px",
                }}>
                  “{safe.salesAngle?.opener}”
                </div>
                {safe.salesAngle?.objection ? (
                  <div style={{ marginTop: "10px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: PALETTE.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "4px" }}>
                      Likely Objection
                    </div>
                    <div style={{ fontSize: "12px", color: PALETTE.textSecondary, lineHeight: 1.5 }}>
                      {safe.salesAngle.objection}
                    </div>
                  </div>
                ) : null}
                {safe.salesAngle?.rebuttal ? (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, color: PALETTE.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "4px" }}>
                      Rebuttal
                    </div>
                    <div style={{ fontSize: "13px", color: PALETTE.textPrimary, lineHeight: 1.5 }}>
                      {safe.salesAngle.rebuttal}
                    </div>
                  </div>
                ) : null}
              </SectionCard>

              {/* G. Closeability */}
              <SectionCard>
                <SectionLabel>Closeability</SectionLabel>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                  <Pill tone={closeTone}>{safe.closeability?.label ?? "Moderate"}</Pill>
                  {typeof safe.closeability?.score === "number" ? (() => {
                    const raw = safe.closeability.score;
                    const pct = Math.max(0, Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw)));
                    return (
                      <span style={{
                        fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#2563EB",
                        background: "rgba(59,130,246,0.10)",
                        border: "1px solid rgba(59,130,246,0.25)",
                        borderRadius: "999px",
                        padding: "3px 10px",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        Closeability {pct}%
                      </span>
                    );
                  })() : null}
                </div>
                {safe.closeability?.reason ? (
                  <div style={{
                    fontSize: "12px", color: PALETTE.textSecondary, lineHeight: 1.55, marginTop: "8px",
                  }}>
                    Why: {safe.closeability.reason}
                  </div>
                ) : null}
                {safe.urgency?.reason ? (
                  <div style={{
                    fontSize: "12px", color: PALETTE.textSecondary, lineHeight: 1.55, marginTop: "4px",
                  }}>
                    Urgency: {safe.urgency.reason}
                  </div>
                ) : null}
              </SectionCard>

              {/* H. Risks / Missing Proof */}
              {risks.length > 0 ? (
                <SectionCard accent={PALETTE.amber}>
                  <SectionLabel>Risks / Missing Proof</SectionLabel>
                  <ul style={{
                    margin: 0, paddingLeft: "18px",
                    fontSize: "12px", color: PALETTE.textSecondary, lineHeight: 1.55,
                  }}>
                    {risks.map((r, i) => (
                      <li key={`risk-${i}`} style={{ marginBottom: "4px" }}>{r}</li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              {/* I. Next Action */}
              <SectionCard accent={PALETTE.blue}>
                <SectionLabel>Next Action</SectionLabel>
                <div style={{ fontSize: "14px", fontWeight: 700, color: PALETTE.textPrimary, lineHeight: 1.4 }}>
                  {safe.recommendedAction}
                </div>
              </SectionCard>
            </>
          )}
        </div>

        <footer style={{
          padding: "12px 22px",
          borderTop: `1px solid ${PALETTE.border}`,
          background: PALETTE.cardBg,
          display: "flex",
          justifyContent: "flex-end",
        }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: PALETTE.textSecondary,
              background: "transparent",
              border: `1px solid ${PALETTE.border}`,
              borderRadius: "10px",
              padding: "8px 14px",
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            Close
          </button>
        </footer>
    </aside>
  );
}
