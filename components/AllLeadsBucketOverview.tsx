"use client";

// Meridian — All Leads strategic planning surface.
//
// Three-state navigable surface:
//
//   ┌────────────────────────────────────────────────────────┐
//   │  Breadcrumb:  All Leads / [Trade] / [Bucket?]          │
//   │  Trade strip: [All Trades] [Roofing] [HVAC] [...]      │
//   ├────────────────────────────────────────────────────────┤
//   │  OVERVIEW       (no bucket selected)                    │
//   │  • headline counters                                    │
//   │  • bucket grid                                          │
//   │  • trade-level CTAs                                     │
//   │                                                         │
//   │  DRILL-DOWN     (bucket selected)                       │
//   │  • back-to-overview affordance                          │
//   │  • filtered lead list with selection + bulk actions     │
//   │  • per-lead SchedulingMenu                              │
//   └────────────────────────────────────────────────────────┘
//
// All Trades mode aggregates buckets across every trade — sums the
// counts per serviceId, exposes top trade by count for "strongest
// trade overlap," merges leadsByService into one filtered list.
//
// Browser back behavior: when the user drills into a bucket we push a
// no-op history entry (URL unchanged). The popstate listener pops the
// drill state instead of ejecting from /operator. Trade switches do
// not push history — the trade strip provides instant lateral movement
// and does not need an "undo" stack.
//
// The component is the single source of truth for in-All-Leads
// navigation. Trade selection still propagates back to OperatorConsole
// via onTradeChange so other surfaces (Today queue filters, header
// stats) stay synchronized.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SchedulingMenu from "./SchedulingMenu";
import {
  buildContactTrustDisplay,
  buildRecommendationTrustDisplay,
  type TrustChip,
} from "../lib/display/trustVisibility";

// ─── All Trades id normalization ───────────────────────────────────
// External callers (OperatorConsole's selectedTradeId, breadcrumb
// links, future deep-link URLs) historically used several sentinels
// to mean "aggregate every trade" — "all", "all-trades", "__all__",
// or just nothing. Treating any of those as a real trade id sends
// the bundle lookup off a cliff (returns undefined, totals show 0).
//
// One helper, one source of truth. Use it everywhere the component
// asks "is this an aggregate selection?". Do not abstract further —
// this is the only normalization the surface needs.
const ALL_TRADES_SENTINELS = new Set(["all", "all-trades", "__all__"]);
function isAllTradesId(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "string") return false;
  return ALL_TRADES_SENTINELS.has(value);
}

interface ServiceTag { id: string; label: string; reason?: string }
interface FilteredLeadEntry {
  leadKey: string;
  companyName: string;
  location?: string;
  phone?: string;
  companyKey?: string;
  crmKey?: string;
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
  source?: string;
  lastChecked?: string;
  contactPaths?: unknown;
  phoneTrust?: unknown;
  emailTrust?: unknown;
  contactTrust?: unknown;
}

interface ServiceBucketCard {
  serviceId: string;
  label: string;
  tier: "primary" | "secondary" | "advanced";
  count: number;
  topLeadName: string | null;
  topReason: string | null;
  leadKeys: string[];
  /** Populated only in All Trades aggregated mode — count per real
   *  trade id so the card can show "47 in Roofing · 33 in HVAC". */
  tradeBreakdown?: Record<string, number>;
  /** Populated only in All Trades mode — the single trade id with
   *  the most leads in this bucket. */
  topTradeId?: string;
}

interface TradeBundle {
  cards: ServiceBucketCard[];
  leadsByService: Record<string, FilteredLeadEntry[]>;
}

interface TradeOption {
  id: string;
  label: string;
}

interface RepOption {
  id: string;
  name: string;
}

interface Props {
  workspaceSlug: string;
  /** Currently selected trade id from OperatorConsole. May be the
   *  sentinel "__all__" — represented internally via viewMode rather
   *  than as a bundle key. */
  trade: string;
  /** Full trade-bundle map. Used both for the active-trade view and
   *  for All Trades aggregation. */
  serviceBucketsByTrade: Record<string, TradeBundle>;
  /** Trades that should appear in the persistent trade strip.
   *  OperatorConsole derives this from its existing module list. */
  availableTrades: TradeOption[];
  /** Operator/rep pool for the assignment submenu. Comes from the
   *  workspace's teamWorkload.perRep when available, with a small
   *  fallback the operator console resolves. Empty list disables the
   *  assignment submenu cleanly. */
  reps?: RepOption[];
  /** Called when the user picks a real trade from the strip — keeps
   *  OperatorConsole's selectedTradeId in sync. NOT called when the
   *  user picks "All Trades" (we leave selectedTradeId alone so the
   *  Today queue's last-picked trade survives the side trip). */
  onTradeChange?: (tradeId: string) => void;
  onSelectLead?: (leadKey: string) => void;
  onViewAllInTrade?: () => void;
  onStartPrioritizedCalling?: () => void;
}

const ALL_TRADES_ID = "__all__";

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

// ─── Priority label derivation ─────────────────────────────────────
// Maps existing scoring fields (urgency / closeProbability / closeLabel
// / needScore) to a single high-signal label. No invented scores —
// the inputs are all server-computed values already on each lead row.
//
// Order of precedence:
//   call_now urgency  ─► "Call First"
//   close prob ≥ 0.7  ─► "High Priority"
//   close prob ≥ 0.5  ─► "Strong Fit"
//   need score ≥ 7    ─► "Strong Fit"
//   build_next + ≥ 5  ─► "Medium Fit"
//   build_next        ─► "Nurture"
//   else              ─► "Low Priority"

type PriorityLabel = "Call First" | "High Priority" | "Strong Fit" | "Medium Fit" | "Nurture" | "Low Priority";

function derivePriorityLabel(lead: FilteredLeadEntry): PriorityLabel {
  const urgency = lead.urgency;
  const close = typeof lead.closeProbability === "number" ? lead.closeProbability : null;
  const need = typeof lead.needScore === "number" ? lead.needScore : 0;
  if (urgency === "call_now") return "Call First";
  if (close !== null && close >= 0.7) return "High Priority";
  if ((close !== null && close >= 0.5) || need >= 7) return "Strong Fit";
  if (urgency === "build_next" && need >= 5) return "Medium Fit";
  if (urgency === "build_next") return "Nurture";
  return "Low Priority";
}

const PRIORITY_STYLE: Record<PriorityLabel, { color: string; bg: string }> = {
  "Call First": { color: "#9F1239", bg: "#FFE4E6" },          // rose
  "High Priority": { color: "#9A3412", bg: "#FFEDD5" },       // amber
  "Strong Fit": { color: "#0F766E", bg: "#ECFDF5" },          // teal
  "Medium Fit": { color: "#1D4ED8", bg: "#EFF6FF" },          // blue
  "Nurture": { color: "#475569", bg: "#F1F5F9" },             // slate
  "Low Priority": { color: "#94A3B8", bg: "#F8FAFC" },        // muted slate
};

function trustChipToneStyle(tone: TrustChip["tone"]): { color: string; background: string; borderColor: string } {
  if (tone === "good") return { color: "#15803D", background: "#F0FDF4", borderColor: "#BBF7D0" };
  if (tone === "watch") return { color: "#9A3412", background: "#FFFBEB", borderColor: "#FDE68A" };
  if (tone === "danger") return { color: palette.destructive, background: "#FEF2F2", borderColor: "#FECACA" };
  return { color: palette.textMuted, background: palette.bg, borderColor: palette.borderLight };
}

function TrustChips({ items }: { items: TrustChip[] }) {
  if (!items.length) return null;
  return (
    <span style={{ display: "inline-flex", gap: "4px", flexWrap: "wrap", alignItems: "center", marginTop: "5px" }}>
      {items.map((item) => (
        <span
          key={item.label}
          title={item.title}
          style={{
            padding: "1px 7px",
            fontSize: "10px",
            fontWeight: 650,
            borderRadius: "999px",
            border: `1px solid ${palette.borderLight}`,
            whiteSpace: "nowrap",
            ...trustChipToneStyle(item.tone),
          }}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}

// ─── All Trades aggregation ──────────────────────────────────────────
// Sums per-service bucket counts across every real trade and merges
// the per-service filtered-lead lists. Sorts cards by total count
// descending so the strongest cross-trade campaign opportunities
// surface first. Tracks per-trade contribution so the card can render
// the strongest-trade-overlap subtitle requested for the All Trades
// surface.
function aggregateAcrossTrades(
  map: Record<string, TradeBundle> | null | undefined,
  tradeLabels: Record<string, string>,
): TradeBundle {
  const byService = new Map<string, ServiceBucketCard>();
  const leadsByService: Record<string, FilteredLeadEntry[]> = {};
  if (!map || typeof map !== "object") {
    return { cards: [], leadsByService };
  }
  for (const [tradeId, bundle] of Object.entries(map)) {
    if (!bundle || typeof bundle !== "object") continue;
    const cards = Array.isArray(bundle.cards) ? bundle.cards : [];
    for (const card of cards) {
      if (!card || typeof card.serviceId !== "string") continue;
      // Defensive count coercion — if a snapshot ever ships with a
      // null/undefined count, treat it as 0 rather than NaN-ing the
      // aggregate.
      const cardCount = typeof card.count === "number" && !Number.isNaN(card.count) ? card.count : 0;
      const cardLeadKeys = Array.isArray(card.leadKeys) ? card.leadKeys : [];
      const existing = byService.get(card.serviceId);
      if (existing) {
        existing.count = (existing.count ?? 0) + cardCount;
        existing.leadKeys = [...(existing.leadKeys ?? []), ...cardLeadKeys];
        existing.tradeBreakdown = { ...(existing.tradeBreakdown ?? {}), [tradeId]: cardCount };
        if (cardCount > 0 && !existing.topReason && card.topReason) {
          existing.topReason = card.topReason;
        }
        // Promote the strongest-contributing trade's top lead so the
        // aggregated card surfaces the most representative example.
        const currentTopCount = existing.topTradeId ? (existing.tradeBreakdown?.[existing.topTradeId] ?? 0) : 0;
        if (cardCount > currentTopCount && card.topLeadName) {
          existing.topLeadName = card.topLeadName;
          existing.topTradeId = tradeId;
        }
      } else {
        byService.set(card.serviceId, {
          ...card,
          count: cardCount,
          leadKeys: [...cardLeadKeys],
          tradeBreakdown: { [tradeId]: cardCount },
          topTradeId: cardCount > 0 ? tradeId : undefined,
        });
      }
    }
    const lbs = bundle.leadsByService;
    if (lbs && typeof lbs === "object") {
      for (const [sid, leads] of Object.entries(lbs)) {
        if (!Array.isArray(leads)) continue;
        if (!leadsByService[sid]) leadsByService[sid] = [];
        // Tag each lead with its source trade so the drill-down list
        // can show which vertical the lead belongs to. Mutates a
        // shallow copy — original stays untouched.
        for (const l of leads) {
          if (!l || typeof l !== "object") continue;
          leadsByService[sid].push({
            ...l,
            // The trade label is shown alongside the company name in
            // All Trades mode. Reusing serviceTags would conflict
            // with the existing service-tag chips, so we add a
            // separate label that the renderer reads opportunistically.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ["__sourceTradeLabel" as any]: tradeLabels[tradeId] ?? tradeId,
          });
        }
      }
    }
  }
  return {
    cards: [...byService.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
    leadsByService,
  };
}

export default function AllLeadsBucketOverview({
  workspaceSlug,
  trade,
  serviceBucketsByTrade,
  availableTrades,
  reps,
  onTradeChange,
  onSelectLead,
  onViewAllInTrade,
  onStartPrioritizedCalling,
}: Props) {
  const router = useRouter();
  // Initial view mode follows the incoming trade prop. If the parent
  // hands us "all" / "all-trades" / "__all__" / null, render the
  // aggregated cross-trade view immediately — no extra click required.
  const [viewMode, setViewMode] = useState<"trade" | "all">(() =>
    isAllTradesId(trade) ? "all" : "trade",
  );
  const [drillIntoServiceId, setDrillIntoServiceId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Sync viewMode when the external trade prop changes. Two rules:
  //   • External flip to an aggregate sentinel  → force viewMode "all"
  //   • External flip to a real trade           → force viewMode "trade"
  //
  // The internal "All Trades" pill click does NOT change the trade
  // prop (see handleSelectTrade), so this effect never fights with
  // user-local state — it only reacts to genuine parent updates.
  const prevTradeRef = useRef(trade);
  useEffect(() => {
    if (prevTradeRef.current === trade) return;
    prevTradeRef.current = trade;
    setViewMode(isAllTradesId(trade) ? "all" : "trade");
  }, [trade]);

  // Trade-label lookup keyed by id — used by the All Trades aggregator
  // and the breadcrumb to resolve display strings without an extra
  // Map iteration on every render.
  const tradeLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of availableTrades) out[t.id] = t.label;
    return out;
  }, [availableTrades]);

  // Aggregated bundle is computed lazily. Cards are sorted desc by
  // count so the strongest cross-trade opportunities lead.
  const aggregatedBundle = useMemo(
    () => aggregateAcrossTrades(serviceBucketsByTrade, tradeLabels),
    [serviceBucketsByTrade, tradeLabels],
  );

  // Aggregate mode is reached either by viewMode flip (user clicked
  // the All Trades pill) OR by an aggregate-sentinel trade prop
  // (OperatorConsole says selectedTradeId === "all"). Either path
  // renders the same cross-trade view — no silent empty state from
  // looking up serviceBucketsByTrade["all"].
  const isAggregateMode = viewMode === "all" || isAllTradesId(trade);

  // Resolve which bundle the body should render against.
  const activeBundle = isAggregateMode
    ? aggregatedBundle
    : (serviceBucketsByTrade[trade] ?? null);

  const activeTradeLabel = isAggregateMode
    ? "All Trades"
    : (tradeLabels[trade] ?? trade);

  // ─── Browser-back interception ───────────────────────────────────
  // When the operator drills into a bucket we push a sentinel history
  // entry (URL unchanged). The popstate listener catches the back
  // press and pops the drill state instead of letting the browser
  // eject /operator. We unregister on unmount and on every drill
  // transition so the listener never goes stale.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!drillIntoServiceId) return undefined;
    // Push a sentinel state on the first drill-in. Calling pushState
    // with the existing URL preserves the address bar exactly.
    window.history.pushState({ meridianDrill: drillIntoServiceId }, "");
    function onPop() {
      setDrillIntoServiceId(null);
      setSelected(new Set());
      setBulkError(null);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [drillIntoServiceId]);

  // Cross-trade bucket preservation. When the active trade changes,
  // keep the drill if the new trade has the same service bucket; else
  // drop back to the bucket grid so the operator never sees an empty
  // list because the bucket doesn't exist in the new vertical.
  useEffect(() => {
    if (!drillIntoServiceId) return;
    if (!activeBundle) return;
    const exists = activeBundle.cards.some((c) => c.serviceId === drillIntoServiceId);
    if (!exists) {
      setDrillIntoServiceId(null);
      setSelected(new Set());
    }
  // We deliberately depend on `trade` and `viewMode` so the check
  // fires only on a true context switch, not on every prop reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade, viewMode]);

  // ─── Counters ────────────────────────────────────────────────────
  const totals = useMemo(() => {
    if (!activeBundle) {
      return { total: 0, ready: 0, inProgress: 0, followUp: 0, bucketCount: 0 };
    }
    const allLeads = new Set<string>();
    let ready = 0;
    let inProgress = 0;
    let followUp = 0;
    const lbs = activeBundle.leadsByService ?? {};
    for (const list of Object.values(lbs)) {
      if (!Array.isArray(list)) continue;
      for (const lead of list) {
        // Defensive identity resolution — older snapshots may have
        // shipped without an explicit leadKey field. Fall back to id
        // so the counter never silently zeroes out.
        const key =
          (lead && typeof lead.leadKey === "string" && lead.leadKey)
          || (lead && typeof (lead as unknown as { id?: string }).id === "string"
                ? (lead as unknown as { id: string }).id
                : null);
        if (!key) continue;
        if (allLeads.has(key)) continue;
        allLeads.add(key);
        const state = lead.leadState ?? "ready_to_call";
        if (state === "ready_to_call") ready++;
        else if (state === "in_progress") inProgress++;
        else if (state === "follow_up") followUp++;
      }
    }
    const cards = Array.isArray(activeBundle.cards) ? activeBundle.cards : [];
    return {
      total: allLeads.size,
      ready,
      inProgress,
      followUp,
      bucketCount: cards.filter((c) => (c?.count ?? 0) > 0).length,
    };
  }, [activeBundle]);

  // ─── Trade-strip handlers ────────────────────────────────────────
  function handleSelectTrade(tradeId: string) {
    if (tradeId === ALL_TRADES_ID || isAllTradesId(tradeId)) {
      setViewMode("all");
      // Keep OperatorConsole's selectedTradeId untouched so other
      // surfaces (Today queue) keep their last-picked trade context.
      return;
    }
    setViewMode("trade");
    if (tradeId !== trade) onTradeChange?.(tradeId);
  }

  // ─── Drill controls ──────────────────────────────────────────────
  function handleEnterDrill(serviceId: string) {
    setDrillIntoServiceId(serviceId);
    setSelected(new Set());
    setBulkError(null);
  }

  function handleExitDrill() {
    setDrillIntoServiceId(null);
    setSelected(new Set());
    setBulkError(null);
    // If we entered drill via pushState, pop one history entry so the
    // sentinel doesn't accumulate. The popstate handler will fire and
    // try to clear drill state — that's fine, it's already null.
    if (typeof window !== "undefined" && window.history.state?.meridianDrill) {
      window.history.back();
    }
  }

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
        const lead = drillLeads.find((item) => item.leadKey === leadId);
        const res = await fetch("/api/scheduling/override", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            leadId,
            workspaceSlug,
            action: "move_today",
            companyKey: lead?.companyKey ?? leadId,
            crmKey: lead?.crmKey ?? lead?.companyKey ?? leadId,
          }),
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

  // ─── Drill-down view ─────────────────────────────────────────────
  const drillCard = drillIntoServiceId && activeBundle
    ? activeBundle.cards.find((c) => c.serviceId === drillIntoServiceId) ?? null
    : null;
  const drillLeads = drillIntoServiceId && activeBundle
    ? (activeBundle.leadsByService[drillIntoServiceId] ?? [])
    : [];

  return (
    <section
      style={{
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        borderRadius: "12px",
        padding: "18px 22px 22px",
      }}
    >
      {/* ─── Persistent navigation header ─────────────────────────── */}
      <Breadcrumb
        tradeLabel={activeTradeLabel}
        bucketLabel={drillCard?.label ?? null}
        onClickAllLeads={() => {
          // Reset to overview without forcing a trade pick — keeps
          // the user's last context. Used as a fast escape hatch.
          handleExitDrill();
        }}
        onClickTrade={() => {
          // Click trade segment — exit drill, stay in current trade.
          handleExitDrill();
        }}
      />
      <TradeStrip
        availableTrades={availableTrades}
        activeTradeId={isAggregateMode ? ALL_TRADES_ID : trade}
        onSelect={handleSelectTrade}
      />

      {drillCard ? (
        // ─── DRILL-DOWN BODY ───────────────────────────────────────
        <DrillDown
          card={drillCard}
          leads={drillLeads}
          tradeLabel={activeTradeLabel}
          workspaceSlug={workspaceSlug}
          reps={reps}
          selected={selected}
          bulkPending={bulkPending}
          bulkError={bulkError}
          onExit={handleExitDrill}
          onToggleSelect={toggleSelect}
          onSendSelected={sendSelectedToToday}
          onSelectLead={onSelectLead}
          isAllTradesMode={isAggregateMode}
        />
      ) : (
        // ─── OVERVIEW BODY ─────────────────────────────────────────
        <Overview
          tradeLabel={activeTradeLabel}
          activeBundle={activeBundle}
          totals={totals}
          isAllTradesMode={isAggregateMode}
          onEnterDrill={handleEnterDrill}
          onViewAllInTrade={onViewAllInTrade}
          onStartPrioritizedCalling={onStartPrioritizedCalling}
        />
      )}
    </section>
  );
}

// ─── Breadcrumb ────────────────────────────────────────────────────
// Three-segment breadcrumb. Static "All Leads" anchor, clickable
// trade segment (drill out), clickable bucket segment when drilled.
// All segments use the same hover/active treatment so the operator
// can read hierarchy at a glance without parsing visual chrome.

function Breadcrumb({
  tradeLabel,
  bucketLabel,
  onClickAllLeads,
  onClickTrade,
}: {
  tradeLabel: string;
  bucketLabel: string | null;
  onClickAllLeads: () => void;
  onClickTrade: () => void;
}) {
  return (
    <nav
      aria-label="Scheduling breadcrumb"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "11px",
        fontWeight: 500,
        color: palette.textMuted,
        marginBottom: "10px",
        userSelect: "none",
      }}
    >
      <CrumbButton onClick={onClickAllLeads} muted>Scheduling</CrumbButton>
      <Sep />
      {bucketLabel ? (
        <CrumbButton onClick={onClickTrade} muted>{tradeLabel}</CrumbButton>
      ) : (
        <CrumbCurrent>{tradeLabel}</CrumbCurrent>
      )}
      {bucketLabel ? (
        <>
          <Sep />
          <CrumbCurrent>{bucketLabel}</CrumbCurrent>
        </>
      ) : null}
    </nav>
  );
}

function CrumbButton({ children, onClick, muted }: { children: React.ReactNode; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        fontSize: "11px",
        fontWeight: 500,
        color: muted ? palette.textMuted : palette.text,
        cursor: "pointer",
        textDecoration: "underline",
        textDecorationColor: "transparent",
        transition: "text-decoration-color 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = palette.accent; }}
      onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = "transparent"; }}
    >
      {children}
    </button>
  );
}

function CrumbCurrent({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: "11px", fontWeight: 600, color: palette.text }}>{children}</span>
  );
}

function Sep() {
  return <span style={{ color: palette.textTertiary }}>›</span>;
}

// ─── Trade strip ───────────────────────────────────────────────────
// Persistent horizontal pill row. "All Trades" pill is always first;
// real trades follow. Active pill renders with the accent border so
// the operator knows where they are at every level of the hierarchy.

function TradeStrip({
  availableTrades,
  activeTradeId,
  onSelect,
}: {
  availableTrades: TradeOption[];
  activeTradeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Trade selector"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        marginBottom: "16px",
        padding: "6px",
        background: palette.bg,
        border: `1px solid ${palette.borderLight}`,
        borderRadius: "8px",
      }}
    >
      <TradePill
        id={ALL_TRADES_ID}
        label="All Trades"
        active={activeTradeId === ALL_TRADES_ID}
        onClick={() => onSelect(ALL_TRADES_ID)}
        emphasized
      />
      <span style={{ width: "1px", background: palette.borderLight, alignSelf: "stretch", margin: "0 2px" }} aria-hidden="true" />
      {availableTrades.map((t) => (
        <TradePill
          key={t.id}
          id={t.id}
          label={t.label}
          active={activeTradeId === t.id}
          onClick={() => onSelect(t.id)}
        />
      ))}
    </div>
  );
}

function TradePill({
  label,
  active,
  onClick,
  emphasized,
}: {
  id: string;
  label: string;
  active: boolean;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: active ? 700 : 500,
        background: active ? palette.surface : "transparent",
        color: active ? palette.accent : palette.text,
        border: `1px solid ${active ? palette.accentBorder : "transparent"}`,
        borderRadius: "6px",
        cursor: "pointer",
        boxShadow: active ? "0 1px 2px rgba(15,23,42,0.04)" : "none",
        letterSpacing: emphasized ? "0.02em" : "normal",
      }}
    >
      {label}
    </button>
  );
}

// ─── Overview body ─────────────────────────────────────────────────

function Overview({
  tradeLabel,
  activeBundle,
  totals,
  isAllTradesMode,
  onEnterDrill,
  onViewAllInTrade,
  onStartPrioritizedCalling,
}: {
  tradeLabel: string;
  activeBundle: TradeBundle | null;
  totals: { total: number; ready: number; inProgress: number; followUp: number; bucketCount: number };
  isAllTradesMode: boolean;
  onEnterDrill: (serviceId: string) => void;
  onViewAllInTrade?: () => void;
  onStartPrioritizedCalling?: () => void;
}) {
  const populatedCards = activeBundle?.cards.filter((c) => c.count > 0) ?? [];
  return (
    <>
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
            SCHEDULING · {tradeLabel.toUpperCase()}
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: palette.text, marginTop: "2px" }}>
            {isAllTradesMode ? "Cross-trade scheduling overview" : "Service-bucket scheduling"}
          </div>
          <div style={{ fontSize: "12px", color: palette.textMuted, marginTop: "4px" }}>
            {isAllTradesMode
              ? "Aggregated across every trade. Pick the strongest service motion to run a cross-vertical campaign."
              : "Pick the sales motion. Drill into any bucket to see the companies that need it."}
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
          {onViewAllInTrade && !isAllTradesMode ? (
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
      {populatedCards.length === 0 ? (
        <EmptyHint
          label={
            isAllTradesMode
              ? "No service buckets are populated across any trade yet. Refresh intelligence or check ingestion supply."
              : `No service buckets yet for ${tradeLabel}. Refresh intelligence to regenerate.`
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          {populatedCards.map((card) => (
            <BucketCard
              key={card.serviceId}
              card={card}
              isAllTradesMode={isAllTradesMode}
              onClick={() => onEnterDrill(card.serviceId)}
            />
          ))}
        </div>
      )}
    </>
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

function BucketCard({
  card,
  isAllTradesMode,
  onClick,
}: {
  card: ServiceBucketCard;
  isAllTradesMode: boolean;
  onClick: () => void;
}) {
  const tier = TIER_STYLE[card.tier];
  // Build the "strongest trade overlap" subtitle for All Trades mode
  // — top 2 contributing trades plus a remainder count so the card
  // never gets visually busy.
  const breakdownLine = isAllTradesMode && card.tradeBreakdown
    ? buildBreakdownLine(card.tradeBreakdown)
    : null;
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
      {breakdownLine ? (
        <div style={{ fontSize: "10px", color: palette.textMuted, lineHeight: 1.4 }}>
          {breakdownLine}
        </div>
      ) : card.topLeadName ? (
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

function buildBreakdownLine(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "";
  const top = entries.slice(0, 2);
  const remainder = entries.slice(2);
  const remainderTotal = remainder.reduce((acc, [, c]) => acc + c, 0);
  const parts = top.map(([id, count]) => `${count} ${id}`);
  if (remainderTotal > 0) {
    parts.push(`+${remainderTotal} other`);
  }
  return parts.join(" · ");
}

// ─── Drill-down body ───────────────────────────────────────────────

function DrillDown({
  card,
  leads,
  tradeLabel,
  workspaceSlug,
  reps,
  selected,
  bulkPending,
  bulkError,
  onExit,
  onToggleSelect,
  onSendSelected,
  onSelectLead,
  isAllTradesMode,
}: {
  card: ServiceBucketCard;
  leads: FilteredLeadEntry[];
  tradeLabel: string;
  workspaceSlug: string;
  reps?: RepOption[];
  selected: Set<string>;
  bulkPending: boolean;
  bulkError: string | null;
  onExit: () => void;
  onToggleSelect: (leadKey: string) => void;
  onSendSelected: () => void;
  onSelectLead?: (leadKey: string) => void;
  isAllTradesMode: boolean;
}) {
  // Build a quick lookup so the assigned-rep pill on each row can
  // resolve a repId to a display name. Stable for the lifetime of
  // this drill-down render.
  const repLookup: Record<string, string> = {};
  if (reps) for (const r of reps) repLookup[r.id] = r.name;
  return (
    <>
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
            onClick={onExit}
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
            {card.label}
          </div>
          <div style={{ fontSize: "12px", color: palette.textMuted, marginTop: "2px" }}>
            {card.count} {card.count === 1 ? "lead" : "leads"} •{" "}
            <TierBadge tier={card.tier} />
            {card.topReason ? <> • {card.topReason}</> : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <SelectionPill count={selected.size} />
          <button
            type="button"
            onClick={onSendSelected}
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

      {leads.length === 0 ? (
        <EmptyHint label={`No leads currently match ${card.label}.`} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {leads.map((lead) => {
            const isSelected = selected.has(lead.leadKey);
            // Source-trade label only present in All Trades aggregated
            // mode — read it dynamically so the type stays clean.
            const sourceTrade =
              isAllTradesMode
                ? ((lead as unknown) as Record<string, string>)["__sourceTradeLabel"] ?? null
                : null;
            // Priority label is derived from existing scoring fields
            // — never invented. Surfaces who matters first without
            // forcing the operator to open every Deep Report.
            const priority = derivePriorityLabel(lead);
            const priorityStyle = PRIORITY_STYLE[priority];
            // Assigned operator (set via override). Pulled off the
            // tagged lead — applyScheduleOverrides stamps assignedRepId
            // on every override-affected lead.
            const assignedRepId =
              ((lead as unknown) as { assignedRepId?: string }).assignedRepId ?? null;
            const assignedRepName = assignedRepId ? (repLookup[assignedRepId] ?? assignedRepId) : null;
            const trustInput = lead as unknown as Parameters<typeof buildRecommendationTrustDisplay>[0];
            const recommendationTrust = buildRecommendationTrustDisplay(trustInput, "All leads prioritization");
            const contactTrust = buildContactTrustDisplay(
              trustInput,
              "phone",
              { phoneTrust: lead.phoneTrust, contactTrust: lead.contactTrust } as Parameters<typeof buildContactTrustDisplay>[2],
            );
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
                  onChange={() => onToggleSelect(lead.leadKey)}
                  aria-label={`Select ${lead.companyName}`}
                  style={{ cursor: "pointer", width: "14px", height: "14px" }}
                />
                <span
                  title={`${priority} — derived from urgency + close probability`}
                  style={{
                    padding: "3px 8px",
                    fontSize: "10px",
                    fontWeight: 700,
                    background: priorityStyle.bg,
                    color: priorityStyle.color,
                    borderRadius: "4px",
                    flexShrink: 0,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                  }}
                >
                  {priority}
                </span>
                <div
                  style={{ flex: 1, minWidth: 0, cursor: onSelectLead ? "pointer" : "default" }}
                  onClick={() => onSelectLead?.(lead.leadKey)}
                >
                  <div style={{ fontSize: "13px", fontWeight: 600, color: palette.text }}>
                    {lead.companyName}
                    {sourceTrade ? (
                      <span
                        style={{
                          marginLeft: "8px",
                          padding: "2px 6px",
                          fontSize: "10px",
                          fontWeight: 600,
                          background: palette.bg,
                          color: palette.textMuted,
                          border: `1px solid ${palette.borderLight}`,
                          borderRadius: "4px",
                          textTransform: "capitalize",
                        }}
                      >
                        {sourceTrade}
                      </span>
                    ) : null}
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
                    {assignedRepName ? (
                      <span
                        title={`Assigned to ${assignedRepName}`}
                        style={{
                          marginLeft: "8px",
                          padding: "2px 6px",
                          fontSize: "10px",
                          fontWeight: 600,
                          background: "#FFF7ED",
                          color: "#9A3412",
                          border: "1px solid #FED7AA",
                          borderRadius: "4px",
                        }}
                      >
                        ◇ {assignedRepName}
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
                  <TrustChips items={[...recommendationTrust.chips.slice(0, 4), ...contactTrust.chips.slice(1, 3)]} />
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
                    companyKey={lead.companyKey ?? null}
                    crmKey={lead.crmKey ?? lead.companyKey ?? null}
                    leadName={lead.companyName}
                    reps={reps}
                    hasOverride={
                      ((lead as unknown) as { scheduleOverride?: unknown }).scheduleOverride != null
                    }
                    variant="icon"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
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
