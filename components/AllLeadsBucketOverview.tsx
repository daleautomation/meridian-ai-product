"use client";

// Meridian — All Leads strategic planning surface.
//
// Two-state component:
//
//  1. OVERVIEW (default landing for a trade tab inside All Leads):
//     • headline counters (total, ready to call, follow-up, in progress)
//     • service-bucket grid — one card per LaborTech service tier
//       (primary / secondary / advanced) with lead count, top lead,
//       top reason, "View leads" CTA
//     • trade-level actions: View all leads, Start prioritized calling,
//       Schedule for later
//
//  2. DRILL-DOWN (after clicking a bucket card):
//     • back arrow to overview
//     • filtered lead list for that service
//     • per-lead checkbox + "Send selected to Today" bulk action
//     • per-lead trigger that delegates to the existing onSelectLead
//
// All data comes from `serviceBucketsByTrade[trade]` which is already
// in the snapshot — this component is wiring, not generation. The
// bulk-send-to-today action calls /api/scheduling/override per lead;
// keep selections small (the UI shows a count and warns above 25).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SchedulingMenu from "./SchedulingMenu";

interface ServiceTag { id: string; label: string; reason?: string }
interface FilteredLeadEntry {
  leadKey: string;
  companyName: string;
  location?: string;
  phone?: string;
  serviceLabel: string;
  reason: string;
  needScore: number;
  urgency: "call_now" | "build_next" | "monitor";
  suggestedPitch?: string;
  serviceTags?: ServiceTag[];
  leadState?: "ready_to_call" | "in_progress" | "follow_up" | "closed";
  closeProbability?: number;
  closeLabel?: string;
  primaryAngleLabel?: string;
  primaryAngleEvidence?: string;
  primaryAngleImpact?: string;
  recommendedOffer?: string;
  topObjection?: { objection: string; response: string };
}

interface ServiceBucketCard {
  serviceId: string;
  label: string;
  tier: "primary" | "secondary" | "advanced";
  count: number;
  topLeadName: string | null;
  topReason: string | null;
  leadKeys: string[];
}

interface TradeBundle {
  cards: ServiceBucketCard[];
  leadsByService: Record<string, FilteredLeadEntry[]>;
}

interface Props {
  workspaceSlug: string;
  trade: string;
  tradeLabel: string;
  bundle: TradeBundle;
  onSelectLead?: (leadKey: string) => void;
  onViewAllInTrade?: () => void;
  onStartPrioritizedCalling?: () => void;
}

const palette = {
  bg: "#FAFBFC",
  surface: "#FFFFFF",
  border: "#E2E8F0",
  borderLight: "#F1F5F9",
  text: "#1A1A2E",
  textMuted: "#64748B",
  textTertiary: "#94A3B8",
  accent: "#2563EB",
  accentMuted: "#EFF6FF",
  accentBorder: "#BFDBFE",
  primaryTier: "#0F766E",
  primaryTierBg: "#ECFDF5",
  secondaryTier: "#1D4ED8",
  secondaryTierBg: "#EFF6FF",
  advancedTier: "#9333EA",
  advancedTierBg: "#F5F3FF",
  destructive: "#B91C1C",
};

const TIER_STYLE: Record<ServiceBucketCard["tier"], { color: string; bg: string; label: string }> = {
  primary: { color: palette.primaryTier, bg: palette.primaryTierBg, label: "Primary" },
  secondary: { color: palette.secondaryTier, bg: palette.secondaryTierBg, label: "Secondary" },
  advanced: { color: palette.advancedTier, bg: palette.advancedTierBg, label: "Advanced" },
};

export default function AllLeadsBucketOverview({
  workspaceSlug,
  trade,
  tradeLabel,
  bundle,
  onSelectLead,
  onViewAllInTrade,
  onStartPrioritizedCalling,
}: Props) {
  const router = useRouter();
  const [drillIntoServiceId, setDrillIntoServiceId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const allLeads = new Set<string>();
    let ready = 0;
    let inProgress = 0;
    let followUp = 0;
    for (const list of Object.values(bundle.leadsByService)) {
      for (const lead of list) {
        if (allLeads.has(lead.leadKey)) continue;
        allLeads.add(lead.leadKey);
        const state = lead.leadState ?? "ready_to_call";
        if (state === "ready_to_call") ready++;
        else if (state === "in_progress") inProgress++;
        else if (state === "follow_up") followUp++;
      }
    }
    return {
      total: allLeads.size,
      ready,
      inProgress,
      followUp,
      bucketCount: bundle.cards.filter((c) => c.count > 0).length,
    };
  }, [bundle]);

  const drillCard = drillIntoServiceId
    ? bundle.cards.find((c) => c.serviceId === drillIntoServiceId) ?? null
    : null;
  const drillLeads = drillIntoServiceId
    ? (bundle.leadsByService[drillIntoServiceId] ?? [])
    : [];

  function toggleSelect(leadKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leadKey)) next.delete(leadKey);
      else next.add(leadKey);
      return next;
    });
  }

  async function sendSelectedToToday() {
    if (selected.size === 0 || bulkPending) return;
    setBulkPending(true);
    setBulkError(null);
    const ids = Array.from(selected);
    let failed = 0;
    for (const leadId of ids) {
      try {
        const res = await fetch("/api/scheduling/override", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ leadId, workspaceSlug, action: "move_today" }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
    }
    setBulkPending(false);
    if (failed > 0) {
      setBulkError(`${failed} of ${ids.length} could not be moved`);
    } else {
      setSelected(new Set());
    }
    router.refresh();
  }

  // ─── Drill-down view ───────────────────────────────────────────────
  if (drillCard) {
    return (
      <section
        style={{
          background: palette.surface,
          border: `1px solid ${palette.border}`,
          borderRadius: "12px",
          padding: "20px 22px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: "14px",
            gap: "12px",
          }}
        >
          <div>
            <button
              type="button"
              onClick={() => {
                setDrillIntoServiceId(null);
                setSelected(new Set());
                setBulkError(null);
              }}
              style={{
                background: "transparent",
                border: "none",
                fontSize: "12px",
                color: palette.textMuted,
                cursor: "pointer",
                padding: 0,
                marginBottom: "6px",
              }}
            >
              ‹ Back to {tradeLabel} buckets
            </button>
            <div style={{ fontSize: "18px", fontWeight: 700, color: palette.text }}>
              {drillCard.label}
            </div>
            <div style={{ fontSize: "12px", color: palette.textMuted, marginTop: "2px" }}>
              {drillCard.count} {drillCard.count === 1 ? "lead" : "leads"} •{" "}
              <TierBadge tier={drillCard.tier} />
              {drillCard.topReason ? <> • {drillCard.topReason}</> : null}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <SelectionPill count={selected.size} />
            <button
              type="button"
              onClick={sendSelectedToToday}
              disabled={selected.size === 0 || bulkPending}
              style={{
                padding: "7px 14px",
                fontSize: "12px",
                fontWeight: 600,
                background: selected.size > 0 ? palette.accent : palette.borderLight,
                color: selected.size > 0 ? "#FFFFFF" : palette.textTertiary,
                border: "none",
                borderRadius: "7px",
                cursor: selected.size === 0 || bulkPending ? "not-allowed" : "pointer",
              }}
            >
              {bulkPending ? "Moving…" : "Send selected to Today"}
            </button>
          </div>
        </div>
        {selected.size >= 25 ? (
          <div
            style={{
              padding: "8px 10px",
              marginBottom: "12px",
              background: "#FEF3C7",
              border: "1px solid #FCD34D",
              borderRadius: "7px",
              fontSize: "11px",
              color: "#92400E",
            }}
          >
            Selecting {selected.size} leads. The daily call cap is 20 — moving more than that will overflow.
          </div>
        ) : null}
        {bulkError ? (
          <div
            role="alert"
            style={{
              padding: "8px 10px",
              marginBottom: "12px",
              background: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderRadius: "7px",
              fontSize: "11px",
              color: palette.destructive,
            }}
          >
            {bulkError}
          </div>
        ) : null}

        {drillLeads.length === 0 ? (
          <EmptyHint label={`No leads currently match ${drillCard.label}.`} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {drillLeads.map((lead) => {
              const isSelected = selected.has(lead.leadKey);
              return (
                <div
                  key={lead.leadKey}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 14px",
                    background: isSelected ? palette.accentMuted : palette.surface,
                    border: `1px solid ${isSelected ? palette.accentBorder : palette.borderLight}`,
                    borderRadius: "8px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(lead.leadKey)}
                    aria-label={`Select ${lead.companyName}`}
                    style={{ cursor: "pointer", width: "14px", height: "14px" }}
                  />
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: onSelectLead ? "pointer" : "default" }}
                    onClick={() => onSelectLead?.(lead.leadKey)}
                  >
                    <div style={{ fontSize: "13px", fontWeight: 600, color: palette.text }}>
                      {lead.companyName}
                      {lead.closeLabel ? (
                        <span
                          style={{
                            marginLeft: "8px",
                            padding: "2px 6px",
                            fontSize: "10px",
                            fontWeight: 500,
                            background: palette.accentMuted,
                            color: palette.accent,
                            borderRadius: "4px",
                          }}
                        >
                          {lead.closeLabel}
                        </span>
                      ) : null}
                    </div>
                    {lead.primaryAngleLabel ? (
                      <div
                        style={{
                          fontSize: "11px",
                          color: palette.textMuted,
                          marginTop: "3px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {lead.primaryAngleLabel}
                        {lead.location ? <> · {lead.location}</> : null}
                      </div>
                    ) : lead.location ? (
                      <div style={{ fontSize: "11px", color: palette.textMuted, marginTop: "3px" }}>
                        {lead.location}
                      </div>
                    ) : null}
                  </div>
                  {lead.serviceTags && lead.serviceTags.length > 0 ? (
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {lead.serviceTags.slice(0, 2).map((t) => (
                        <span
                          key={t.id}
                          title={t.reason}
                          style={{
                            padding: "2px 6px",
                            fontSize: "10px",
                            background: palette.borderLight,
                            color: palette.text,
                            borderRadius: "4px",
                          }}
                        >
                          {t.label}
                        </span>
                      ))}
                      {lead.serviceTags.length > 2 ? (
                        <span style={{ fontSize: "10px", color: palette.textTertiary }}>
                          +{lead.serviceTags.length - 2}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div onClick={(e) => e.stopPropagation()}>
                    <SchedulingMenu
                      leadId={lead.leadKey}
                      workspaceSlug={workspaceSlug}
                      leadName={lead.companyName}
                      variant="icon"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  // ─── Overview (default) ───────────────────────────────────────────
  return (
    <section
      style={{
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: "12px",
        padding: "20px 22px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px",
          marginBottom: "16px",
        }}
      >
        <div>
          <div style={{ fontSize: "11px", fontWeight: 600, color: palette.textTertiary, letterSpacing: "0.04em" }}>
            ALL LEADS · {tradeLabel.toUpperCase()}
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: palette.text, marginTop: "2px" }}>
            Service-bucket overview
          </div>
          <div style={{ fontSize: "12px", color: palette.textMuted, marginTop: "4px" }}>
            Pick the sales motion. Drill into any bucket to see the companies that need it.
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {onStartPrioritizedCalling ? (
            <button
              type="button"
              onClick={onStartPrioritizedCalling}
              style={{
                padding: "7px 14px",
                fontSize: "12px",
                fontWeight: 600,
                background: palette.accent,
                color: "#FFFFFF",
                border: "none",
                borderRadius: "7px",
                cursor: "pointer",
              }}
            >
              Start prioritized calling
            </button>
          ) : null}
          {onViewAllInTrade ? (
            <button
              type="button"
              onClick={onViewAllInTrade}
              style={{
                padding: "7px 14px",
                fontSize: "12px",
                fontWeight: 500,
                background: palette.surface,
                color: palette.text,
                border: `1px solid ${palette.border}`,
                borderRadius: "7px",
                cursor: "pointer",
              }}
            >
              View all leads in this trade
            </button>
          ) : null}
        </div>
      </div>

      {/* Headline counters */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
        <Counter label="Total leads" value={totals.total} />
        <Counter label="Ready to call" value={totals.ready} accent="positive" />
        <Counter label="In progress" value={totals.inProgress} />
        <Counter label="Follow-up" value={totals.followUp} />
        <Counter label="Active buckets" value={totals.bucketCount} />
      </div>

      {/* Bucket grid */}
      {bundle.cards.filter((c) => c.count > 0).length === 0 ? (
        <EmptyHint label={`No service buckets yet for ${tradeLabel}. Run the slow-path refresh to regenerate.`} />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          {bundle.cards
            .filter((c) => c.count > 0)
            .map((card) => (
              <BucketCard
                key={card.serviceId}
                card={card}
                onClick={() => setDrillIntoServiceId(card.serviceId)}
              />
            ))}
        </div>
      )}
    </section>
  );
}

function Counter({ label, value, accent }: { label: string; value: number; accent?: "positive" }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: palette.bg,
        border: `1px solid ${palette.borderLight}`,
        borderRadius: "9px",
      }}
    >
      <div style={{ fontSize: "10px", fontWeight: 600, color: palette.textTertiary, letterSpacing: "0.04em" }}>
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: "22px",
          fontWeight: 700,
          marginTop: "4px",
          color: accent === "positive" ? "#0F766E" : palette.text,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function BucketCard({ card, onClick }: { card: ServiceBucketCard; onClick: () => void }) {
  const tier = TIER_STYLE[card.tier];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "14px 16px",
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: "10px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = palette.accentBorder;
        e.currentTarget.style.boxShadow = "0 4px 12px rgba(37,99,235,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = palette.border;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: palette.text }}>{card.label}</div>
        <span
          style={{
            padding: "2px 7px",
            fontSize: "10px",
            fontWeight: 600,
            background: tier.bg,
            color: tier.color,
            borderRadius: "4px",
          }}
        >
          {tier.label}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
        <div style={{ fontSize: "22px", fontWeight: 700, color: palette.text, lineHeight: 1 }}>
          {card.count}
        </div>
        <div style={{ fontSize: "11px", color: palette.textMuted }}>
          {card.count === 1 ? "lead" : "leads"}
        </div>
      </div>
      {card.topLeadName ? (
        <div style={{ fontSize: "11px", color: palette.textMuted, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 500, color: palette.text }}>{card.topLeadName}</span>
          {card.topReason ? <span> — {card.topReason}</span> : null}
        </div>
      ) : null}
      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: palette.accent,
          marginTop: "auto",
        }}
      >
        View leads ›
      </div>
    </button>
  );
}

function TierBadge({ tier }: { tier: ServiceBucketCard["tier"] }) {
  const t = TIER_STYLE[tier];
  return (
    <span
      style={{
        padding: "2px 7px",
        fontSize: "10px",
        fontWeight: 600,
        background: t.bg,
        color: t.color,
        borderRadius: "4px",
      }}
    >
      {t.label}
    </span>
  );
}

function SelectionPill({ count }: { count: number }) {
  return (
    <span
      style={{
        padding: "4px 10px",
        fontSize: "11px",
        fontWeight: 500,
        background: count > 0 ? palette.accentMuted : palette.borderLight,
        color: count > 0 ? palette.accent : palette.textMuted,
        border: `1px solid ${count > 0 ? palette.accentBorder : palette.borderLight}`,
        borderRadius: "999px",
        userSelect: "none",
      }}
    >
      {count} selected
    </span>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        textAlign: "center",
        background: palette.bg,
        border: `1px dashed ${palette.border}`,
        borderRadius: "8px",
        fontSize: "12px",
        color: palette.textMuted,
      }}
    >
      {label}
    </div>
  );
}
