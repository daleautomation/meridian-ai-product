"use client";

// Meridian — LaborTech service-bucket panel.
//
// Renders the "LaborTech Services" section inside a trade tab. Two
// modes, driven by selectedServiceId:
//   • null  → grid of service-bucket cards (Primary / Secondary / Advanced)
//   • set   → "Companies needing <service> today" filtered list
//
// All inputs are server-prepared. No fetch, no scheduling change, no
// decision-logic change. Click flips selectedServiceId; clear returns
// to the default grid.

import { useMemo } from "react";
import { palette } from "../lib/theme";

const TIER_LABEL = { primary: "Primary", secondary: "Secondary", advanced: "Advanced" };
const TIER_COLOR = {
  primary:   { fg: palette.danger,        bg: "#FEF2F2", border: "#FECACA" },
  secondary: { fg: palette.warning,       bg: palette.warningBg, border: "#FDE68A" },
  advanced:  { fg: palette.textSecondary, bg: palette.surfaceHover, border: palette.border },
};

const URGENCY_LABEL = { call_now: "Call now", build_next: "Build next", monitor: "Monitor" };

function ServiceCard({ bucket, onClick }) {
  const tier = bucket.tier || "secondary";
  const tone = TIER_COLOR[tier] ?? TIER_COLOR.secondary;
  const empty = !bucket.count || bucket.count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      style={{
        textAlign: "left",
        padding: "14px 14px",
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderLeft: `3px solid ${tone.fg}`,
        borderRadius: "10px",
        cursor: empty ? "default" : "pointer",
        opacity: empty ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        minHeight: "112px",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: palette.textPrimary, lineHeight: 1.3 }}>
          {bucket.label}
        </span>
        <span style={{
          fontSize: "9.5px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          padding: "2px 7px",
          borderRadius: "999px",
          color: tone.fg,
          background: tone.bg,
          border: `1px solid ${tone.border}`,
          whiteSpace: "nowrap",
        }}>
          {TIER_LABEL[tier] ?? tier}
        </span>
      </div>
      <div style={{ fontSize: "11px", fontWeight: 600, color: palette.textSecondary }}>
        {empty ? "0 companies need this" : `${bucket.count} compan${bucket.count === 1 ? "y" : "ies"} need this`}
      </div>
      {bucket.topLeadName ? (
        <div style={{ fontSize: "11px", color: palette.textPrimary, lineHeight: 1.45 }}>
          <strong>Top lead.</strong> {bucket.topLeadName}
        </div>
      ) : null}
      {bucket.topReason ? (
        <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.45 }}>
          {bucket.topReason}
        </div>
      ) : null}
      <div style={{ flex: 1 }} />
      {!empty ? (
        <span style={{
          fontSize: "11px",
          fontWeight: 600,
          color: palette.blue,
          alignSelf: "flex-start",
        }}>
          View companies →
        </span>
      ) : null}
    </button>
  );
}

const LEAD_STATE_TONE = {
  ready_to_call: { fg: "#047857", bg: "rgba(5,150,105,0.10)", border: "rgba(5,150,105,0.30)", label: "Ready to Call" },
  in_progress:   { fg: "#1E40AF", bg: "rgba(37,99,235,0.10)", border: "rgba(37,99,235,0.30)", label: "In Progress" },
  follow_up:     { fg: "#6D28D9", bg: "rgba(124,58,237,0.10)", border: "rgba(124,58,237,0.30)", label: "Follow-Up" },
  closed:        { fg: "#475569", bg: "rgba(100,116,139,0.10)", border: "rgba(100,116,139,0.30)", label: "Closed" },
};

function FilteredLeadCard({ entry, isSelected = false, onClick, currentBucketId, onSwitchBucket }) {
  const phone = entry.phone;
  const services = Array.isArray(entry.services) ? entry.services : [];
  // Multi-bucket membership tags. Surfaces every service this lead
  // needs so the user understands the company is classified across
  // multiple buckets, not duplicated. The current bucket is
  // highlighted; other tags are clickable to switch buckets.
  const serviceTags = Array.isArray(entry.serviceTags) ? entry.serviceTags : [];
  // Lead-state pill — one of: ready_to_call / in_progress /
  // follow_up / closed. Surfaced from the canonical classifier so
  // the user reads state + bucket together.
  const stateTone = LEAD_STATE_TONE[entry.leadState] ?? LEAD_STATE_TONE.ready_to_call;
  const clickable = typeof onClick === "function";
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      style={{
        padding: "12px 14px",
        background: isSelected ? "rgba(37,99,235,0.05)" : palette.surface,
        border: `1px solid ${isSelected ? "rgba(37,99,235,0.40)" : palette.border}`,
        borderLeft: isSelected ? `3px solid #2563EB` : `1px solid ${palette.border}`,
        borderRadius: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        cursor: clickable ? "pointer" : "default",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "14px", fontWeight: 700, color: palette.textPrimary }}>
          {entry.companyName}
          {entry.location ? <span style={{ fontWeight: 500, color: palette.textTertiary, marginLeft: "8px" }}>· {entry.location}</span> : null}
          {isSelected ? (
            <span style={{
              marginLeft: "8px",
              fontSize: "9px",
              fontWeight: 800,
              letterSpacing: "0.10em",
              color: "#2563EB",
              textTransform: "uppercase",
            }}>
              · Active
            </span>
          ) : null}
        </span>
        <span style={{ display: "inline-flex", gap: "5px", alignItems: "center" }}>
          <span style={{
            fontSize: "10px", fontWeight: 800, letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: stateTone.fg,
            background: stateTone.bg,
            border: `1px solid ${stateTone.border}`,
            borderRadius: "999px",
            padding: "2px 8px",
            whiteSpace: "nowrap",
          }}>
            {stateTone.label}
          </span>
          {typeof entry.closeProbability === "number" ? (() => {
            const raw = entry.closeProbability;
            // Floor at 15 / ceiling at 95 — mirrors the v2 scorer so
            // older snapshots also display in-range, never raw 0/100.
            const pct = Math.max(15, Math.min(95, Math.round(raw <= 1 ? raw * 100 : raw)));
            const tier = pct >= 80 ? "High" : pct >= 50 ? "Medium" : "Lower";
            const reason = typeof entry.closeReason === "string" && entry.closeReason.length > 0
              ? entry.closeReason
              : (entry.closeLabel ?? "—");
            return (
              <span
                title={`${tier} probability · ${pct}% — ${reason}`}
                style={{
                  fontSize: "10px", fontWeight: 800, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#2563EB",
                  background: "rgba(59,130,246,0.10)",
                  border: "1px solid rgba(59,130,246,0.25)",
                  borderRadius: "999px",
                  padding: "2px 8px",
                  whiteSpace: "nowrap",
                }}
              >
                {tier.toUpperCase()} · {pct}%
              </span>
            );
          })() : null}
          <span style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            color: palette.blue,
            background: palette.bluePale,
            border: `1px solid ${palette.blueBorder}`,
            borderRadius: "999px",
            padding: "2px 8px",
          }}>
            {URGENCY_LABEL[entry.urgency] ?? "Watch"} · need {entry.needScore}
          </span>
        </span>
      </div>
      {serviceTags.length > 0 ? (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "5px",
          alignItems: "center",
          marginTop: "2px",
        }}>
          <span style={{
            fontSize: "9px",
            fontWeight: 800,
            letterSpacing: "0.10em",
            color: palette.textTertiary,
            textTransform: "uppercase",
            marginRight: "2px",
          }}>
            Needs
          </span>
          {serviceTags.map((tag) => {
            const isCurrent = tag.id === currentBucketId;
            const switchable = !isCurrent && typeof onSwitchBucket === "function";
            return (
              <button
                key={tag.id}
                type="button"
                disabled={!switchable}
                onClick={switchable ? (e) => { e.stopPropagation(); onSwitchBucket(tag.id); } : undefined}
                title={tag.reason}
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  padding: "2px 9px",
                  borderRadius: "999px",
                  whiteSpace: "nowrap",
                  cursor: switchable ? "pointer" : "default",
                  color: isCurrent ? "#fff" : palette.blue,
                  background: isCurrent ? "#2563EB" : palette.bluePale,
                  border: `1px solid ${isCurrent ? "#2563EB" : palette.blueBorder}`,
                  transition: "background 120ms ease",
                }}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {Array.isArray(entry.findings) && entry.findings.length > 0 ? (
        <>
          <div style={{ fontSize: "12px", color: palette.textPrimary, lineHeight: 1.5 }}>
            <strong>Problem.</strong>
            <ul style={{ margin: "2px 0 0 16px", padding: 0 }}>
              {entry.findings.map((f, idx) => (
                <li key={idx} style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45 }}>
                  {f.issue} ({f.evidence})
                </li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5 }}>
            <strong style={{ color: palette.textPrimary }}>Why it matters.</strong> {entry.findings[0].impact}
          </div>
        </>
      ) : (
        <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5 }}>
          <strong style={{ color: palette.textPrimary }}>Why.</strong> {entry.reason}
        </div>
      )}
      {services.length > 0 ? (
        <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.5 }}>
          <strong style={{ color: palette.textPrimary }}>LaborTech can sell.</strong>{" "}
          {services.map((s) => s.label).join(", ")}
        </div>
      ) : null}
      {entry.primaryAngleLabel ? (
        <div style={{ fontSize: "12px", color: palette.textPrimary, lineHeight: 1.5 }}>
          <strong>Primary angle.</strong> {entry.primaryAngleLabel}
          {entry.primaryAngleEvidence ? (
            <span style={{ color: palette.textSecondary }}> — {entry.primaryAngleEvidence}</span>
          ) : null}
        </div>
      ) : null}
      {entry.opener ? (
        <div style={{ fontSize: "12px", color: palette.textPrimary, fontStyle: "italic", lineHeight: 1.5 }}>
          <strong style={{ color: palette.textPrimary, fontStyle: "normal" }}>Say this.</strong> “{entry.opener}”
        </div>
      ) : entry.suggestedPitch ? (
        <div style={{ fontSize: "12px", color: palette.textPrimary, fontStyle: "italic", lineHeight: 1.5 }}>
          “{entry.suggestedPitch}”
        </div>
      ) : null}
      {entry.recommendedOffer ? (
        <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.5 }}>
          <strong style={{ color: palette.textPrimary }}>LaborTech should sell.</strong> {entry.recommendedOffer}
        </div>
      ) : null}
      {entry.topObjection ? (
        <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.5 }}>
          <strong style={{ color: palette.textPrimary }}>If they say:</strong> “{entry.topObjection.objection}.”{" "}
          <strong style={{ color: palette.textPrimary }}>Reply:</strong> “{entry.topObjection.response}”
        </div>
      ) : null}
      {phone ? (() => {
        const phoneDigits = String(phone).replace(/\D/g, "");
        const telHref =
          phoneDigits.length === 10
            ? `tel:+1${phoneDigits}`
            : phoneDigits.length === 11 && phoneDigits.startsWith("1")
              ? `tel:+${phoneDigits}`
              : `tel:${phoneDigits}`;
        return (
          <a
            href={telHref}
            onClick={(e) => e.stopPropagation()}
            style={{
              alignSelf: "flex-start",
              fontSize: "11px",
              fontWeight: 700,
              color: palette.blue,
              background: palette.bluePale,
              padding: "5px 12px",
              borderRadius: "999px",
              border: `1px solid ${palette.blueBorder}`,
              textDecoration: "none",
              marginTop: "2px",
            }}
          >
            Call Now
          </a>
        );
      })() : null}
    </div>
  );
}

export default function LaborTechServicesPanel({
  tradeLabel,
  tradeId,
  buckets,                 // ServiceBucketCard[]
  filteredLeads,           // FilteredLead[] when selectedServiceId is set
  selectedServiceId,
  onSelectService,
  onClearService,
  // Cross-tab selection — when supplied, FilteredLeadCards become
  // clickable and the parent's selectedKey state drives the active
  // card highlight.
  selectedLeadKey,
  onSelectLead,
}) {
  const sectionsByTier = useMemo(() => {
    const out = { primary: [], secondary: [], advanced: [] };
    for (const b of (buckets ?? [])) {
      const t = b.tier ?? "secondary";
      if (out[t]) out[t].push(b);
    }
    return out;
  }, [buckets]);

  const selectedBucket = useMemo(
    () => (buckets ?? []).find((b) => b.serviceId === selectedServiceId) ?? null,
    [buckets, selectedServiceId],
  );

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: 800, color: palette.textPrimary, margin: 0, letterSpacing: "-0.01em" }}>
            All Leads by Service Need
          </h2>
          <p style={{ fontSize: "13px", color: palette.textSecondary, margin: "6px 0 0", lineHeight: 1.5, maxWidth: "640px" }}>
            Every {tradeLabel?.toLowerCase() ?? "trade"} company organized by the LaborTech services they need today.
            A company can appear in more than one bucket when it needs multiple services.
          </p>
        </div>
        {selectedServiceId ? (
          <button
            type="button"
            onClick={onClearService}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: palette.blue,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            ← All services
          </button>
        ) : null}
      </div>

      {!selectedServiceId ? (
        ["primary", "secondary", "advanced"].map((tier) => {
          const list = sectionsByTier[tier] ?? [];
          if (list.length === 0) return null;
          return (
            <div key={tier} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{
                fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
                color: palette.textTertiary, textTransform: "uppercase",
              }}>
                {TIER_LABEL[tier]}
              </div>
              <div style={{
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              }}>
                {list.map((b) => (
                  <ServiceCard
                    key={b.serviceId}
                    bucket={b}
                    onClick={() => {
                      if (typeof onSelectService === "function" && b.count > 0) onSelectService(b.serviceId);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            fontSize: "13px", fontWeight: 700, color: palette.textPrimary,
            display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px",
          }}>
            <span>Ready-to-call companies that need {selectedBucket?.label ?? "this service"}</span>
            <span style={{ fontSize: "11px", fontWeight: 600, color: palette.textSecondary }}>
              {filteredLeads?.length ?? 0} · {tradeLabel} · {selectedBucket?.label ?? selectedServiceId}
            </span>
          </div>
          {(filteredLeads ?? []).length === 0 ? (
            <div style={{
              fontSize: "12px",
              color: palette.textSecondary,
              padding: "16px",
              background: palette.surfaceHover,
              border: `1px solid ${palette.border}`,
              borderRadius: "10px",
            }}>
              No companies in {tradeLabel} need this service right now.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(filteredLeads ?? []).map((entry) => (
                <FilteredLeadCard
                  key={entry.leadKey}
                  entry={entry}
                  isSelected={selectedLeadKey != null && entry.leadKey === selectedLeadKey}
                  onClick={typeof onSelectLead === "function" && entry.leadKey
                    ? () => onSelectLead(entry.leadKey)
                    : undefined}
                  currentBucketId={selectedServiceId}
                  onSwitchBucket={typeof onSelectService === "function"
                    ? (sid) => onSelectService(sid)
                    : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
