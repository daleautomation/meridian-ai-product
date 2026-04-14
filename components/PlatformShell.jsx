"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./SessionProvider";
import MeridianMark from "./MeridianMark";

const MODULES = {
  "real-estate": {
    id: "real-estate",
    label: "Homes",
    abbr: "HM",
    tagline: "Acquisition Engine",
    explanation: "Source, score, and underwrite off-market residential deals — ranked by equity spread and execution risk.",
    accent: "#6B75A4",
    accentRgb: "107,117,164",
    metrics: [
      { label: "Tracked Deals", value: "47" },
      { label: "Avg Score", value: "6.4" },
      { label: "High Conviction", value: "4" },
      { label: "New This Week", value: "11" },
    ],
    items: [
      { id: 1, title: "4821 Prospect Ave", sub: "Kansas City, MO 64130", score: 9.1, label: "ACT NOW", labelType: "green", tag: "Equity Play", arv: "$215K", mao: "$118K", ask: "$109K", risk: "Low", nextAction: "Submit LOI — $109K asking, $5K under MAO", riskFactors: ["Foundation crack noted in listing photos", "12 days on market"] },
      { id: 2, title: "7730 Bellefontaine", sub: "Kansas City, MO 64132", score: 8.3, label: "STRONG", labelType: "green", tag: "BRRRR", arv: "$190K", mao: "$104K", ask: "$98K", risk: "Low-Med", nextAction: "Run comps on NE corner, then engage seller", riskFactors: ["Older HVAC", "School district B-rated"] },
      { id: 3, title: "2244 Mersington Ave", sub: "Kansas City, MO 64127", score: 7.6, label: "MONITOR", labelType: "amber", tag: "Flip", arv: "$178K", mao: "$97K", ask: "$112K", risk: "Medium", nextAction: "Wait — price 15% over MAO. Re-engage at 45 days", riskFactors: ["Overpriced by $15K", "High rehab estimate"] },
      { id: 4, title: "5590 Chestnut Ave", sub: "Independence, MO 64052", score: 7.1, label: "MONITOR", labelType: "amber", tag: "Rental", arv: "$165K", mao: "$90K", ask: "$95K", risk: "Medium", nextAction: "Verify rental comps. Cash flow marginal at ask", riskFactors: ["Asking $5K over MAO", "Rent growth uncertain in submarket"] },
      { id: 5, title: "3310 Olive St", sub: "Kansas City, MO 64109", score: 4.2, label: "PASS", labelType: "red", tag: "Flip", arv: "$145K", mao: "$79K", ask: "$128K", risk: "High", nextAction: "No action — $49K above MAO, no deal structure works", riskFactors: ["48% above MAO", "Structural concerns flagged", "No seller motivation signals"] },
    ],
  },
  "saas": {
    id: "saas",
    label: "SaaS Revenue",
    abbr: "SR",
    tagline: "Revenue Intelligence",
    explanation: "Track account health, expansion signals, and churn risk across your customer book — ranked by revenue at stake.",
    accent: "#C4B1B9",
    accentRgb: "196,177,185",
    metrics: [
      { label: "Total ARR", value: "$4.2M" },
      { label: "At-Risk ARR", value: "$680K" },
      { label: "Expansion Pipe", value: "$1.1M" },
      { label: "Avg Health", value: "71" },
    ],
    items: [
      { id: 1, title: "Meridian Health Systems", sub: "Enterprise · Renewal in 47 days", score: 9.2, label: "EXPAND", labelType: "green", tag: "$320K ARR", arv: "+$85K", mao: "Champion: Sarah Diaz", ask: "EBR Scheduled", risk: "Low", nextAction: "Propose advanced analytics add-on — champion is mobilized", riskFactors: ["IT budget cycle closes Nov 30", "Competing eval noted in Gong call"] },
      { id: 2, title: "Cascade Logistics", sub: "Mid-Market · Health: 43", score: 7.8, label: "PROTECT", labelType: "amber", tag: "$95K ARR", arv: "Last login: 14d ago", mao: "No champion mapped", ask: "QBR overdue", risk: "Medium", nextAction: "Executive outreach this week — engagement cliff, churn risk rising", riskFactors: ["No product login in 14 days", "No mapped champion", "Missed last QBR"] },
      { id: 3, title: "Thornfield Capital", sub: "SMB · Renewal in 12 days", score: 7.4, label: "AT RISK", labelType: "red", tag: "$48K ARR", arv: "Sentiment: Negative", mao: "Open support ticket", ask: "Competitor trial active", risk: "High", nextAction: "Immediate: Escalate to AE + loop in Solutions. Offer concession call", riskFactors: ["Competitor trial confirmed", "Negative NPS response last month", "Unresolved P1 ticket 8 days old"] },
      { id: 4, title: "Vertex Partners", sub: "Enterprise · Expansion signal", score: 8.6, label: "EXPAND", labelType: "green", tag: "$215K ARR", arv: "+$60K potential", mao: "Power user: 3 seats", ask: "Dept head interested", risk: "Low", nextAction: "Run ROI model for 12-seat expansion, bring to VP", riskFactors: ["Budget approval needed above VP level"] },
      { id: 5, title: "Ironclad Manufacturing", sub: "Mid-Market · Health: 58", score: 5.1, label: "WATCH", labelType: "amber", tag: "$72K ARR", arv: "Flat usage 90d", mao: "No expansion signals", ask: "Renewal auto-renews", risk: "Medium", nextAction: "Passive monitor. Check in at 30-day mark before renewal", riskFactors: ["Usage plateau 90+ days", "No expansion signals", "No champion engagement"] },
    ],
  },
  "trading": {
    id: "trading",
    label: "Trading",
    abbr: "TM",
    tagline: "Momentum Engine",
    explanation: "Surface momentum and risk signals across equities and ETFs — ranked by conviction and volatility-adjusted edge.",
    accent: "#E6C9BF",
    accentRgb: "230,201,191",
    metrics: [
      { label: "Signals Active", value: "6" },
      { label: "Avg Momentum", value: "71.4" },
      { label: "High Conviction", value: "2" },
      { label: "Risk-Off Flags", value: "3" },
    ],
    items: [
      { id: 1, title: "NVDA", sub: "NVIDIA Corporation · Large Cap", score: 9.0, label: "STRONG BUY", labelType: "green", tag: "Momentum", arv: "$143.20", mao: "Vol: 2.4x avg", ask: "RS: 89", risk: "Medium", nextAction: "Enter at market open. Stop at $134. Target $158 in 15 sessions", riskFactors: ["Broad market exposure", "Earnings in 22 days — size accordingly"] },
      { id: 2, title: "META", sub: "Meta Platforms · Large Cap", score: 8.2, label: "BUY", labelType: "green", tag: "Breakout", arv: "$578.40", mao: "Vol: 1.8x avg", ask: "RS: 82", risk: "Low-Med", nextAction: "Add on pullback to 21-day EMA. Scale in two tranches", riskFactors: ["Ad revenue sensitivity to macro"] },
      { id: 3, title: "MSTR", sub: "MicroStrategy · Mid Cap", score: 7.1, label: "CAUTION", labelType: "amber", tag: "Volatile", arv: "$1,247", mao: "Vol: 3.1x avg", ask: "RS: 74", risk: "High", nextAction: "No new entries. Existing positions — trail stop to breakeven", riskFactors: ["BTC correlation means 2x volatility", "Dilution risk ongoing", "Vol regime elevated"] },
      { id: 4, title: "SPY", sub: "S&P 500 ETF · Index", score: 6.4, label: "NEUTRAL", labelType: "amber", tag: "Hedge", arv: "$524.80", mao: "Vol: 1.1x avg", ask: "RS: 55", risk: "Low", nextAction: "Reduce beta exposure. SPY below 50-day MA — risk-off positioning", riskFactors: ["Below 50-day MA", "Breadth deteriorating", "VIX rising"] },
      { id: 5, title: "SOXS", sub: "Direxion Semi Bear 3x · ETF", score: 5.8, label: "WATCH", labelType: "amber", tag: "Hedge", arv: "$12.40", mao: "Vol: 1.6x avg", ask: "RS: 61", risk: "V.High", nextAction: "Only as a short-duration hedge. Max 2% allocation if triggered", riskFactors: ["3x leverage — decay risk", "Intraday only or tight stops"] },
      ],
  },
  watches: {
    id: "watches",
    label: "Luxury Goods",
    abbr: "LG",
    tagline: "Flip Engine",
    explanation: "Evaluate flip opportunities by margin, liquidity, and condition — ranked by hold-time-adjusted return.",
    accent: "#8E8DBB",
    accentRgb: "142,141,187",
    metrics: [
      { label: "Active Deals", value: "12" },
      { label: "Avg Margin", value: "18%" },
      { label: "High Conviction", value: "3" },
      { label: "Avg Deal Value", value: "$9K" }
    ],
    items: [
      { id: 1, title: "Rolex Submariner", sub: "2022", score: 9.4, label: "ACT NOW", labelType: "green" },
      { id: 2, title: "Rolex GMT Pepsi", sub: "2021", score: 8.8, label: "STRONG", labelType: "green" },
      { id: 3, title: "Omega Speedmaster", sub: "2023", score: 7.6, label: "MONITOR", labelType: "amber" },
      { id: 4, title: "Cartier Santos", sub: "2020", score: 7.2, label: "MONITOR", labelType: "amber" },
      { id: 5, title: "Tudor BB58", sub: "2019", score: 4.1, label: "PASS", labelType: "red" }
    ]
  },
  roofing: {
    id: "roofing",
    label: "Roofing",
    abbr: "RF",
    tagline: "Lead Prioritization Engine",
    explanation: "Prioritize inbound roofing leads by urgency, job value, and close probability — ranked by revenue-weighted conversion likelihood.",
    accent: "#D4854A",
    accentRgb: "212,133,74",
    metrics: [
      { label: "Active Leads", value: "8" },
      { label: "Avg Close %", value: "54%" },
      { label: "High Priority", value: "3" },
      { label: "Est. Pipeline", value: "$127K" },
    ],
    items: [
      { id: 1, title: "Margaret Chen", sub: "4218 Walnut St, Kansas City, MO 64111", score: 9.4, label: "CALL NOW", labelType: "green", tag: "Storm Damage", arv: "$18,500", mao: "87%", ask: "Urgent", risk: "Low", nextAction: "Call immediately — insurance claim filed, adjuster visiting Thursday", riskFactors: ["Adjuster visit in 2 days — must be present to win", "Homeowner referenced a competing bid"], thesis: "Active hail damage claim with adjuster scheduled this week. Homeowner is motivated and pre-qualified through insurance. First roofer on-site wins.", opportunityTier: "ACTION", executableNow: true },
      { id: 2, title: "David & Sarah Thompson", sub: "8901 Ward Pkwy, Kansas City, MO 64114", score: 8.7, label: "CALL NOW", labelType: "green", tag: "Full Replacement", arv: "$24,200", mao: "78%", ask: "This Week", risk: "Low", nextAction: "Schedule inspection this week — they're collecting three bids by Friday", riskFactors: ["Collecting 3 bids — deadline is Friday", "Premium neighborhood expects premium service"], thesis: "High-value full replacement on an upscale property. Homeowners are actively collecting bids with a decision deadline. Job size and neighborhood justify premium pricing.", opportunityTier: "ACTION", executableNow: true },
      { id: 3, title: "Robert Martinez", sub: "1547 Independence Ave, Kansas City, MO 64124", score: 8.1, label: "CALL TODAY", labelType: "green", tag: "Leak Repair", arv: "$4,800", mao: "82%", ask: "Urgent", risk: "Low-Med", nextAction: "Call today — active leak causing interior damage, high urgency", riskFactors: ["Active interior water damage escalating daily", "Smaller job but fast close and referral potential"], thesis: "Active leak with interior damage creates genuine urgency. Fast-close opportunity with strong referral upside in a dense neighborhood.", opportunityTier: "ACTION", executableNow: true },
      { id: 4, title: "Pinnacle Office Park", sub: "6600 College Blvd, Overland Park, KS 66211", score: 7.8, label: "CALL TODAY", labelType: "green", tag: "Commercial", arv: "$67,000", mao: "45%", ask: "This Month", risk: "Medium", nextAction: "Send capability deck and request site walk — property manager is comparing vendors", riskFactors: ["Commercial approval chain is 3+ stakeholders", "Must carry commercial liability coverage"], thesis: "Large commercial flat-roof opportunity. Lower close rate offset by exceptional job value. Property manager is in active vendor selection.", opportunityTier: "SECONDARY" },
      { id: 5, title: "Linda Whitfield", sub: "3322 Troost Ave, Kansas City, MO 64109", score: 7.2, label: "NURTURE", labelType: "amber", tag: "Storm Damage", arv: "$14,200", mao: "55%", ask: "Exploring", risk: "Medium", nextAction: "Follow up in 3 days — waiting on insurance response, not yet committed", riskFactors: ["Insurance claim pending — timeline uncertain", "Homeowner is passive, needs education on process"], thesis: "Probable storm damage claim but homeowner hasn't committed. Needs process guidance and follow-up once insurance responds.", opportunityTier: "SECONDARY" },
      { id: 6, title: "James & Karen Park", sub: "2100 W 47th St, Westwood, KS 66205", score: 6.5, label: "NURTURE", labelType: "amber", tag: "Aging Roof", arv: "$16,800", mao: "40%", ask: "Next Quarter", risk: "Medium", nextAction: "Add to drip sequence — interested but no trigger event yet, planning for fall", riskFactors: ["No urgency — exploring options for Q3/Q4", "Price-sensitive, will compare 4+ bids"], thesis: "Aging roof with no active failure. Homeowners are planning ahead. Worth nurturing for Q3 close but no urgency to push now.", opportunityTier: "MONITOR" },
      { id: 7, title: "Tom Bradley", sub: "901 E Gregory Blvd, Kansas City, MO 64131", score: 4.8, label: "NURTURE", labelType: "amber", tag: "Gutter Add-On", arv: "$2,100", mao: "62%", ask: "Flexible", risk: "Low", nextAction: "Bundle into next nearby job — too small to dispatch solo", riskFactors: ["Low job value doesn't justify standalone dispatch", "Good candidate for route-bundling with nearby jobs"], thesis: "Small gutter job, easy close but not worth a standalone trip. Bundle with the next job in the 64131 zip code.", opportunityTier: "MONITOR" },
      { id: 8, title: "Patricia Holmes", sub: "5540 Brookside Blvd, Kansas City, MO 64113", score: 3.2, label: "PASS", labelType: "red", tag: "Price Shopping", arv: "$11,500", mao: "12%", ask: "Unknown", risk: "High", nextAction: "No action — sixth contractor contacted, budget expectations unrealistic", riskFactors: ["Has contacted 6+ contractors already", "Expects pricing 40% below market", "No urgency, no damage — cosmetic only"], thesis: "Serial price-shopper with no real urgency and unrealistic budget expectations. Not worth the time investment — move on.", opportunityTier: "LOW" },
    ],
  }
};

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: GridIcon },
  { id: "list", label: "Ranked List", icon: ListIcon },
  { id: "analysis", label: "Analysis", icon: ChartIcon },
  { id: "pipeline", label: "Pipeline", icon: FlowIcon },
];

// ── PRODUCT TIERS ──────────────────────────────────────────────────────
// Controls surface complexity. The engine is identical underneath; tiers
// only change how much is shown.
const TIERS = {
  beginner:    { label: "Beginner",    desc: "Action + risk only",        sections: ["action", "nextAction", "risk"] },
  experienced: { label: "Experienced", desc: "Trust + acquisition",      sections: ["action", "stats", "trust", "thesis", "risk", "acquisition", "nextAction"] },
  pro:         { label: "Pro",         desc: "Full operator view",       sections: ["action", "stats", "trust", "metrics", "thesis", "risk", "acquisition", "objections", "exit", "negotiation", "nextAction"] },
};

// ── DOMINANT ACTION DISPLAY ────────────────────────────────────────────
const ACTION_DISPLAY = {
  EXECUTE_NOW:        { label: "EXECUTE NOW",  color: "#fff",    bg: "#1E3092",                border: "#1E3092" },
  EXECUTE_CONTROLLED: { label: "EXECUTE",      color: "#1E3092", bg: "rgba(30,48,146,0.08)",   border: "rgba(30,48,146,0.22)" },
  PROBE:              { label: "PROBE",        color: "#7A6B2E", bg: "rgba(122,107,46,0.08)",  border: "rgba(122,107,46,0.22)" },
  WAIT:               { label: "WAIT",         color: "rgba(12,7,49,0.45)", bg: "rgba(12,7,49,0.04)", border: "rgba(12,7,49,0.10)" },
  WALK:               { label: "WALK",         color: "#9E3F3A", bg: "rgba(158,63,58,0.08)",   border: "rgba(158,63,58,0.22)" },
};

function ActionBadge({ action, size = "normal" }) {
  const d = ACTION_DISPLAY[action] || ACTION_DISPLAY.WAIT;
  const isSmall = size === "small";
  const isLarge = size === "large";
  return (
    <span style={{
      fontSize: isLarge ? "13px" : isSmall ? "9px" : "11px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      padding: isLarge ? "10px 20px" : isSmall ? "4px 8px" : "6px 14px",
      borderRadius: isLarge ? "8px" : isSmall ? "5px" : "7px",
      background: d.bg,
      color: d.color,
      border: `1.5px solid ${d.border}`,
      whiteSpace: "nowrap",
      fontFamily: "'JetBrains Mono', monospace",
    }}>
      {d.label}
    </span>
  );
}

function ActionHero({ plan, accent }) {
  const dec = plan?.decision;
  if (!dec) return null;
  const d = ACTION_DISPLAY[dec.dominantAction] || ACTION_DISPLAY.WAIT;
  const rawQualifier = (dec.negotiation?.reasoning || "").replace(/^[A-Z_]+ — /, "");
  const qualifier = rawQualifier.length > 70
    ? rawQualifier.slice(0, rawQualifier.indexOf(".", 20) + 1 || 70).trim() || rawQualifier.slice(0, 70) + "…"
    : rawQualifier;
  return (
    <div style={{
      padding: "20px 22px",
      background: d.bg,
      border: `1px solid ${d.border}`,
      borderRadius: "12px",
      marginBottom: "16px",
      boxShadow: dec.dominantAction === "EXECUTE_NOW" ? "0 2px 12px rgba(30,48,146,0.08)" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: qualifier ? "10px" : "0" }}>
        <span style={{
          fontSize: "22px",
          fontWeight: 800,
          letterSpacing: "0.04em",
          color: d.color,
          fontFamily: "'Syne', sans-serif",
          lineHeight: 1,
        }}>
          {d.label}
        </span>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "12px",
          color: "rgba(12,7,49,0.50)",
          fontWeight: 500,
        }}>
          {dec.conviction?.toFixed(1)}/10
        </span>
      </div>
      {qualifier && (
        <div style={{
          fontSize: "14px",
          fontWeight: 400,
          color: "rgba(12,7,49,0.60)",
          lineHeight: 1.5,
        }}>
          {qualifier}
        </div>
      )}
    </div>
  );
}

function GridIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1.5" fill={color || "currentColor"} opacity="0.9"/>
      <rect x="9" y="1" width="6" height="6" rx="1.5" fill={color || "currentColor"} opacity="0.9"/>
      <rect x="1" y="9" width="6" height="6" rx="1.5" fill={color || "currentColor"} opacity="0.9"/>
      <rect x="9" y="9" width="6" height="6" rx="1.5" fill={color || "currentColor"} opacity="0.9"/>
    </svg>
  );
}

function ListIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="3" width="14" height="2" rx="1" fill={color || "currentColor"} opacity="0.9"/>
      <rect x="1" y="7" width="14" height="2" rx="1" fill={color || "currentColor"} opacity="0.9"/>
      <rect x="1" y="11" width="10" height="2" rx="1" fill={color || "currentColor"} opacity="0.9"/>
    </svg>
  );
}

function ChartIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M2 12 L5 8 L8 9 L12 4 L14 6" stroke={color || "currentColor"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx="14" cy="6" r="1.5" fill={color || "currentColor"}/>
    </svg>
  );
}

function FlowIcon({ size = 16, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="3" cy="8" r="2" fill={color || "currentColor"} opacity="0.6"/>
      <circle cx="8" cy="4" r="2" fill={color || "currentColor"}/>
      <circle cx="8" cy="12" r="2" fill={color || "currentColor"} opacity="0.6"/>
      <circle cx="13" cy="8" r="2" fill={color || "currentColor"}/>
      <path d="M5 8 L6 8M8 6 L8 10 M10 8 L11 8" stroke={color || "currentColor"} strokeWidth="1" opacity="0.4"/>
    </svg>
  );
}

function AIIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.2" opacity="0.5"/>
      <circle cx="9" cy="9" r="3" fill="currentColor" opacity="0.8"/>
      <circle cx="9" cy="2.5" r="1" fill="currentColor" opacity="0.4"/>
      <circle cx="9" cy="15.5" r="1" fill="currentColor" opacity="0.4"/>
      <circle cx="2.5" cy="9" r="1" fill="currentColor" opacity="0.4"/>
      <circle cx="15.5" cy="9" r="1" fill="currentColor" opacity="0.4"/>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M1.5 7 L12.5 7 M8.5 3 L12.5 7 L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ScoreRing({ score, accent, size = 44 }) {
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  const fill = (score / 10) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={radius} stroke="rgba(12,7,49,0.08)" strokeWidth="3" fill="none"/>
      <circle cx={size/2} cy={size/2} r={radius} stroke={accent} strokeWidth="3" fill="none"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s ease" }}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ fill: "#0C0731", fontSize: "11px", fontWeight: "600", fontFamily: "'JetBrains Mono', monospace", transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px` }}>
        {score.toFixed(1)}
      </text>
    </svg>
  );
}

const LABEL_STYLES = {
  green: { bg: "rgba(30,48,146,0.08)", color: "#1E3092", border: "rgba(30,48,146,0.20)" },
  amber: { bg: "rgba(139,122,58,0.08)", color: "#8B7A3A", border: "rgba(139,122,58,0.20)" },
  red: { bg: "rgba(160,69,64,0.08)", color: "#A04540", border: "rgba(160,69,64,0.20)" },
};

function getSaasSignal(item) {
  const arr = item.tag;
  const renewalMatch = item.sub.match(/Renewal in (\d+ days)/i);
  const renewal = renewalMatch ? `renewal in ${renewalMatch[1].toLowerCase()}` : null;
  if (item.label === "EXPAND") return renewal ? `${arr} · ${renewal} · expansion signal` : `${arr} · expansion signal`;
  if (item.label === "AT RISK") return renewal ? `${arr} · ${renewal} · negative sentiment` : `${arr} · ${item.riskFactors[0].toLowerCase()}`;
  if (item.label === "PROTECT") return `${arr} · ${item.riskFactors[0].toLowerCase()}`;
  if (item.label === "WATCH") return `${arr} · low engagement signal`;
  return arr;
}

// ── Lightweight markdown renderer for AI assistant messages ────────────
//
// Handles the subset of markdown the module prompts emit:
//   ## h2 / ### h3 / **bold** / *italic* / - or • bullets / --- rule /
//   blank-line paragraph breaks / | pipe | tables (defensively flattened)
//
// Pure functions, no deps. Falls back to plain text on parse error via the
// caller's try/catch wrapper.

function renderInline(text, baseKey) {
  const out = [];
  let i = 0;
  let plainStart = 0;
  let key = 0;
  while (i < text.length) {
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1 && end > i + 2) {
        if (i > plainStart) out.push(<span key={`${baseKey}-${key++}`}>{text.slice(plainStart, i)}</span>);
        out.push(<strong key={`${baseKey}-${key++}`} style={{ color: "#0C0731", fontWeight: 600 }}>{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        plainStart = i;
        continue;
      }
    } else if (text[i] === "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1 && text[end + 1] !== "*" && text[end - 1] !== " ") {
        if (i > plainStart) out.push(<span key={`${baseKey}-${key++}`}>{text.slice(plainStart, i)}</span>);
        out.push(<em key={`${baseKey}-${key++}`} style={{ fontStyle: "italic", color: "rgba(12,7,49,0.85)" }}>{text.slice(i + 1, end)}</em>);
        i = end + 1;
        plainStart = i;
        continue;
      }
    } else if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1 && end > i + 1) {
        if (i > plainStart) out.push(<span key={`${baseKey}-${key++}`}>{text.slice(plainStart, i)}</span>);
        out.push(<code key={`${baseKey}-${key++}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.92em", padding: "1px 5px", borderRadius: "4px", background: "rgba(12,7,49,0.08)", color: "#0C0731" }}>{text.slice(i + 1, end)}</code>);
        i = end + 1;
        plainStart = i;
        continue;
      }
    }
    i++;
  }
  if (plainStart < text.length) out.push(<span key={`${baseKey}-${key++}`}>{text.slice(plainStart)}</span>);
  return out;
}

function renderMarkdown(text, accent) {
  if (!text) return null;
  const lines = text.split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      blocks.push({ type: "spacer", key: `s-${i}` });
      i++;
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      blocks.push({ type: "hr", key: `hr-${i}` });
      i++;
      continue;
    }
    if (trimmed.startsWith("### ")) {
      blocks.push({ type: "h3", content: trimmed.slice(4), key: `h3-${i}` });
      i++;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      blocks.push({ type: "h2", content: trimmed.slice(3), key: `h2-${i}` });
      i++;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push({ type: "h2", content: trimmed.slice(2), key: `h1-${i}` });
      i++;
      continue;
    }
    // Markdown table separator row → skip
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) {
      i++;
      continue;
    }
    // Markdown table data row → flatten to " · " separated paragraph
    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed
        .split("|")
        .slice(1, -1)
        .map(c => c.trim())
        .filter(Boolean);
      blocks.push({ type: "p", content: cells.join("  ·  "), key: `tr-${i}` });
      i++;
      continue;
    }
    // Bullet group
    if (/^[-*•]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, key: `ul-${i}` });
      continue;
    }
    // Paragraph: collect consecutive non-special lines
    const para = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (
        t === "" ||
        /^#{1,3}\s/.test(t) ||
        /^[-*•]\s/.test(t) ||
        /^---+$/.test(t) ||
        /^\|.*\|$/.test(t)
      ) break;
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "p", content: para.join(" "), key: `p-${i}` });
  }

  return blocks.map(b => {
    if (b.type === "spacer") return <div key={b.key} style={{ height: "6px" }} />;
    if (b.type === "hr") return <div key={b.key} style={{ height: "1px", background: "rgba(12,7,49,0.10)", margin: "10px 0 8px" }} />;
    if (b.type === "h2") {
      return (
        <div key={b.key} style={{
          fontSize: "14px",
          fontWeight: 700,
          color: "#0C0731",
          marginTop: "10px",
          marginBottom: "5px",
          letterSpacing: "-0.01em",
        }}>{renderInline(b.content, b.key)}</div>
      );
    }
    if (b.type === "h3") {
      return (
        <div key={b.key} style={{
          fontSize: "10px",
          fontWeight: 700,
          color: accent,
          marginTop: "8px",
          marginBottom: "3px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}>{renderInline(b.content, b.key)}</div>
      );
    }
    if (b.type === "list") {
      return (
        <div key={b.key} style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px", marginBottom: "4px" }}>
          {b.items.map((item, j) => (
            <div key={j} style={{ display: "flex", gap: "8px", paddingLeft: "2px" }}>
              <span style={{ color: accent, flexShrink: 0, lineHeight: "1.62" }}>•</span>
              <div style={{ flex: 1 }}>{renderInline(item, `${b.key}-${j}`)}</div>
            </div>
          ))}
        </div>
      );
    }
    return <div key={b.key} style={{ marginBottom: "5px" }}>{renderInline(b.content, b.key)}</div>;
  });
}

function CapitalAllocationPanel({ accent, accentRgb }) {
  const [budgetInput, setBudgetInput] = useState("20000");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAllocation = useCallback(async (b) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/watches/allocate?budget=${b}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const b = Number(budgetInput);
    if (!Number.isFinite(b) || b <= 0) return;
    const t = setTimeout(() => fetchAllocation(b), 400);
    return () => clearTimeout(t);
  }, [budgetInput, fetchAllocation]);

  const fmtUsd = (n) => `$${(n ?? 0).toLocaleString("en-US")}`;

  return (
    <div style={{
      padding: "18px 28px",
      borderBottom: "1px solid rgba(12,7,49,0.06)",
      background: `rgba(${accentRgb},0.025)`,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: result || error ? "14px" : "0" }}>
        <div style={{
          fontSize: "10px",
          letterSpacing: "0.13em",
          color: "rgba(12,7,49,0.55)",
          fontWeight: 600,
          textTransform: "uppercase",
        }}>
          Capital Allocation
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          background: "rgba(12,7,49,0.06)",
          border: "1px solid rgba(12,7,49,0.12)",
          borderRadius: "7px",
          padding: "5px 11px",
          transition: "border-color 0.15s",
        }}>
          <span style={{ fontSize: "13px", color: "rgba(12,7,49,0.55)", fontFamily: "'JetBrains Mono', monospace" }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value.replace(/[^0-9]/g, ""))}
            style={{
              background: "transparent",
              border: "none",
              color: "#0C0731",
              fontSize: "13px",
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 500,
              width: "82px",
              outline: "none",
              padding: 0,
            }}
            placeholder="20000"
          />
        </div>
        {loading && (
          <span style={{
            fontSize: "10px",
            color: "rgba(12,7,49,0.45)",
            letterSpacing: "0.05em",
            fontStyle: "italic",
          }}>
            computing…
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: "12px", color: "#D4726A" }}>Error: {error}</div>
      )}

      {result && !error && (
        <div style={{ display: "flex", gap: "16px", alignItems: "stretch", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "260px", display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
            {result.selected.length === 0 ? (
              <span style={{ fontSize: "12px", color: "rgba(240,239,245,0.45)" }}>
                {result.excluded?.length
                  ? `${result.excluded.length} items indexed. No deployable set at $${Number(budgetInput).toLocaleString("en-US")} — adjust budget or review the ranked list below.`
                  : "No items available yet."}
              </span>
            ) : (
              result.selected.map((sel) => {
                const trustColors = sel.trustTier === "CAUTION"
                  ? { bg: "rgba(237,218,186,0.14)", color: "#EDDABA", border: "rgba(237,218,186,0.28)" }
                  : { bg: "rgba(104,236,244,0.14)", color: "#68ECF4", border: "rgba(104,236,244,0.28)" };
                return (
                  <div key={sel.id} style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    padding: "6px 11px",
                    background: `rgba(${accentRgb},0.08)`,
                    border: `1px solid rgba(${accentRgb},0.22)`,
                    borderRadius: "7px",
                  }}>
                    <span style={{ fontSize: "11.5px", color: "#0C0731", fontWeight: 500 }}>
                      {sel.title}
                    </span>
                    <span style={{
                      fontSize: "10.5px",
                      color: accent,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 500,
                    }}>
                      {fmtUsd(sel.buyPriceUsd)}
                    </span>
                    {sel.trustTier && (
                      <span style={{
                        fontSize: "8px",
                        fontWeight: 700,
                        letterSpacing: "0.11em",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        background: trustColors.bg,
                        color: trustColors.color,
                        border: `1px solid ${trustColors.border}`,
                        whiteSpace: "nowrap",
                      }}>
                        {sel.trustTier === "SOFT_REJECT" ? "REVIEW" : sel.trustTier}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div style={{
            display: "flex",
            gap: "22px",
            paddingLeft: "18px",
            borderLeft: "1px solid rgba(12,7,49,0.08)",
            flexShrink: 0,
            alignSelf: "center",
          }}>
            <AllocStat label="Deployed" value={fmtUsd(result.totalCost)} color={accent}/>
            <AllocStat label="Profit"   value={`+${fmtUsd(result.expectedDollarProfit)}`} color="#68ECF4"/>
            <AllocStat label="Annualized" value={`${result.portfolioAnnualized}%`} color={accent}/>
          </div>
        </div>
      )}
    </div>
  );
}

function NegotiationControls({ itemId, openingOffer, currentState, accent, accentRgb }) {
  const router = useRouter();
  const [loadingAction, setLoadingAction] = useState(null);
  const [counterPrice, setCounterPrice] = useState("");
  const [error, setError] = useState(null);

  const lastOfferSent =
    currentState?.lastOfferSent ?? openingOffer ?? 0;

  const post = useCallback(
    async (action, payload) => {
      setError(null);
      setLoadingAction(action);
      try {
        const res = await fetch("/api/negotiation/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || `Request failed (${res.status})`);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingAction(null);
      }
    },
    [router]
  );

  const clearState = useCallback(async () => {
    setError(null);
    setLoadingAction("clear");
    try {
      const res = await fetch(
        `/api/negotiation/state?itemId=${encodeURIComponent(itemId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setCounterPrice("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingAction(null);
    }
  }, [itemId, router]);

  const baseAction = (sellerResponse, lastActionTaken, extras = {}) => ({
    itemId,
    negotiationState: {
      currentPhase: "counter",
      lastActionTaken,
      sellerResponse,
      timeSinceLastActionHours: 0,
      ...extras,
    },
    lastOfferSent,
  });

  const sentOffer = () => {
    if (!openingOffer) return;
    post(
      "sent",
      baseAction("none", `Sent offer of $${openingOffer.toLocaleString("en-US")}`)
    );
  };

  const sellerRejected = () =>
    post(
      "rejected",
      baseAction(
        "rejected",
        currentState?.lastActionTaken ?? `Sent offer of $${lastOfferSent.toLocaleString("en-US")}`
      )
    );

  const sellerCountered = () => {
    const cleaned = counterPrice.replace(/[^0-9]/g, "");
    const price = parseInt(cleaned, 10);
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a valid counter price");
      return;
    }
    post(
      "countered",
      baseAction(
        "countered",
        currentState?.lastActionTaken ?? `Sent offer of $${lastOfferSent.toLocaleString("en-US")}`,
        { sellerCounterPrice: price }
      )
    );
    setCounterPrice("");
  };

  const sellerStalled = () =>
    post(
      "stalled",
      baseAction(
        "stalled",
        currentState?.lastActionTaken ?? `Sent offer of $${lastOfferSent.toLocaleString("en-US")}`
      )
    );

  const responseColors = {
    none: "rgba(12,7,49,0.55)",
    countered: accent,
    rejected: "#D4726A",
    accepted: "#68ECF4",
    stalled: "#EDDABA",
  };

  const btn = (disabled, primary) => ({
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.03em",
    padding: "7px 11px",
    borderRadius: "6px",
    background: primary
      ? `rgba(${accentRgb},0.12)`
      : "rgba(12,7,49,0.06)",
    border: primary
      ? `1px solid rgba(${accentRgb},0.28)`
      : "1px solid rgba(12,7,49,0.12)",
    color: primary ? accent : "rgba(12,7,49,0.70)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    whiteSpace: "nowrap",
    transition: "all 0.12s",
  });

  const dangerBtn = (disabled) => ({
    ...btn(disabled, false),
    color: "rgba(212,114,106,0.75)",
    border: "1px solid rgba(212,114,106,0.22)",
  });

  const anyLoading = loadingAction !== null;

  return (
    <div style={S_DETAIL_SECTION_MARGIN}>
      <div style={S_DETAIL_SECTION_LABEL}>NEGOTIATION CONTROLS</div>

      {currentState && (
        <div style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          padding: "9px 13px",
          background: "rgba(12,7,49,0.03)",
          border: "1px solid rgba(12,7,49,0.08)",
          borderRadius: "7px",
          marginBottom: "8px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "11px",
          color: "rgba(12,7,49,0.60)",
        }}>
          <span>
            Last offer:{" "}
            <span style={{ color: "#0C0731", fontWeight: 600 }}>
              {currentState.lastOfferSent != null
                ? `$${currentState.lastOfferSent.toLocaleString("en-US")}`
                : "—"}
            </span>
          </span>
          <span>
            Response:{" "}
            <span style={{
              color: responseColors[currentState.sellerResponse] || "rgba(12,7,49,0.55)",
              fontWeight: 700,
              letterSpacing: "0.05em",
            }}>
              {currentState.sellerResponse?.toUpperCase() || "—"}
            </span>
          </span>
          <span>
            {currentState.timeSinceLastActionHours != null
              ? `${currentState.timeSinceLastActionHours.toFixed(1)}h elapsed`
              : "—"}
          </span>
          {currentState.sellerCounterPrice != null && (
            <span>
              Counter:{" "}
              <span style={{ color: accent, fontWeight: 600 }}>
                ${currentState.sellerCounterPrice.toLocaleString("en-US")}
              </span>
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
        <button onClick={sentOffer} disabled={anyLoading || !openingOffer} style={btn(anyLoading || !openingOffer, true)}>
          {loadingAction === "sent" ? "..." : "Sent offer"}
        </button>
        <button onClick={sellerRejected} disabled={anyLoading} style={btn(anyLoading, false)}>
          {loadingAction === "rejected" ? "..." : "Seller rejected"}
        </button>

        <div style={{
          display: "flex",
          alignItems: "stretch",
          gap: "0",
          background: "rgba(12,7,49,0.06)",
          border: "1px solid rgba(12,7,49,0.12)",
          borderRadius: "6px",
          overflow: "hidden",
        }}>
          <span style={{
            display: "flex",
            alignItems: "center",
            padding: "0 0 0 10px",
            color: "rgba(12,7,49,0.55)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: "12px",
          }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={counterPrice}
            onChange={(e) => setCounterPrice(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") sellerCountered();
            }}
            placeholder="counter"
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#0C0731",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "12px",
              fontWeight: 500,
              padding: "7px 8px",
              width: "78px",
            }}
          />
          <button
            onClick={sellerCountered}
            disabled={anyLoading || !counterPrice}
            style={{
              ...btn(anyLoading || !counterPrice, true),
              borderRadius: 0,
              borderTop: "none",
              borderBottom: "none",
              borderRight: "none",
              borderLeft: `1px solid rgba(${accentRgb},0.18)`,
            }}
          >
            {loadingAction === "countered" ? "..." : "Countered"}
          </button>
        </div>

        <button onClick={sellerStalled} disabled={anyLoading} style={btn(anyLoading, false)}>
          {loadingAction === "stalled" ? "..." : "Mark stalled"}
        </button>

        {currentState && (
          <button onClick={clearState} disabled={anyLoading} style={dangerBtn(anyLoading)}>
            {loadingAction === "clear" ? "..." : "Clear"}
          </button>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: "8px",
          fontSize: "11px",
          color: "#D4726A",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

const S_DETAIL_SECTION_MARGIN = { marginBottom: "12px" };
const S_DETAIL_SECTION_LABEL = {
  fontSize: "9px",
  letterSpacing: "0.1em",
  color: "rgba(12,7,49,0.45)",
  marginBottom: "6px",
  fontWeight: "600",
};

function AllocStat({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: "9px",
        letterSpacing: "0.13em",
        color: "rgba(12,7,49,0.50)",
        fontWeight: 600,
        textTransform: "uppercase",
        marginBottom: "4px",
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "17px",
        fontWeight: 600,
        color,
        letterSpacing: "-0.005em",
      }}>
        {value}
      </div>
    </div>
  );
}

// ── Collapsible tier section ───────────────────────────────────────────

function TierSection({ sectionKey, label, color, count, collapsible, defaultCollapsed, dimmed, children }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed && collapsible);
  const MAX_COLLAPSED = 3;
  const isDeploy = sectionKey === "DEPLOY";

  const items = Array.isArray(children) ? children : [children];
  const visibleItems = collapsed ? items.slice(0, MAX_COLLAPSED) : items;
  const hiddenCount = collapsed ? Math.max(0, items.length - MAX_COLLAPSED) : 0;

  return (
    <div style={{ marginBottom: isDeploy ? "24px" : dimmed ? "12px" : "18px" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        marginBottom: isDeploy ? "14px" : "8px",
        padding: "0 4px",
      }}>
        <span style={{ fontSize: isDeploy ? "11px" : "10px", fontWeight: 700, letterSpacing: "0.12em", color }}>
          {label}
        </span>
        <span style={{ fontSize: "10px", color: "rgba(12,7,49,0.30)", fontFamily: "'JetBrains Mono', monospace" }}>
          {count}
        </span>
        <div style={{ flex: 1, height: "1px", background: "rgba(12,7,49,0.05)" }}/>
        {collapsible && (
          <button
            onClick={() => setCollapsed(c => !c)}
            style={{
              fontSize: "10px",
              color: "rgba(12,7,49,0.40)",
              letterSpacing: "0.04em",
              padding: "4px 10px",
              borderRadius: "6px",
              background: "rgba(12,7,49,0.03)",
              border: "1px solid rgba(12,7,49,0.08)",
              cursor: "pointer",
            }}
          >
            {collapsed ? `Show all ${count}` : "Collapse"}
          </button>
        )}
      </div>
      <div style={{ opacity: dimmed ? 0.40 : 1 }}>
        {visibleItems}
        {hiddenCount > 0 && (
          <button
            onClick={() => setCollapsed(false)}
            style={{
              display: "block",
              width: "100%",
              padding: "10px",
              textAlign: "center",
              fontSize: "11px",
              color: "rgba(12,7,49,0.40)",
              background: "rgba(12,7,49,0.03)",
              border: "1px solid rgba(12,7,49,0.06)",
              borderRadius: "8px",
              cursor: "pointer",
              marginTop: "4px",
            }}
          >
            +{hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}

// ── Alert bar (dashboard only) ─────────────────────────────────────────

const SEVERITY_COLORS = {
  CRITICAL: { bg: "rgba(104,236,244,0.10)", border: "rgba(104,236,244,0.30)", color: "#68ECF4", label: "CRITICAL" },
  HIGH:     { bg: "rgba(104,236,244,0.07)", border: "rgba(104,236,244,0.20)", color: "#68ECF4", label: "HIGH" },
  MEDIUM:   { bg: "rgba(142,141,187,0.07)", border: "rgba(142,141,187,0.20)", color: "#4A9EFF", label: "MEDIUM" },
  LOW:      { bg: "rgba(237,218,186,0.07)", border: "rgba(237,218,186,0.20)", color: "#EDDABA", label: "LOW" },
};

function AlertBar() {
  const [alerts, setAlerts] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/alerts")
      .then(r => r.ok ? r.json() : { alerts: [] })
      .then(d => { if (!cancelled) { setAlerts(d.alerts || []); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const dismiss = useCallback(async (alertId) => {
    setAlerts(prev => prev.filter(a => a.id !== alertId));
    await fetch("/api/alerts/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    }).catch(() => {});
  }, []);

  const markRead = useCallback(async (alertId) => {
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, isRead: true } : a));
    await fetch("/api/alerts/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId }),
    }).catch(() => {});
  }, []);

  const unread = alerts.filter(a => !a.isRead);
  if (!loaded || unread.length === 0) return null;

  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{
        fontSize: "10px",
        letterSpacing: "0.12em",
        color: "rgba(12,7,49,0.50)",
        fontWeight: 600,
        marginBottom: "8px",
      }}>
        ALERTS ({unread.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {unread.slice(0, 5).map(alert => {
          const sev = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.LOW;
          return (
            <div
              key={alert.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 14px",
                background: sev.bg,
                border: `1px solid ${sev.border}`,
                borderRadius: "8px",
              }}
            >
              <span style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                padding: "3px 8px",
                borderRadius: "4px",
                background: sev.bg,
                color: sev.color,
                border: `1px solid ${sev.border}`,
                fontFamily: "'JetBrains Mono', monospace",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}>
                {sev.label}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#0C0731" }}>
                  {alert.title}
                </div>
                <div style={{ fontSize: "11px", color: "rgba(12,7,49,0.55)", marginTop: "2px" }}>
                  {alert.reason}
                </div>
              </div>
              <button
                onClick={() => markRead(alert.id)}
                style={{
                  fontSize: "10px",
                  color: "rgba(12,7,49,0.45)",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  background: "rgba(12,7,49,0.06)",
                  border: "1px solid rgba(12,7,49,0.08)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Read
              </button>
              <button
                onClick={() => dismiss(alert.id)}
                style={{
                  fontSize: "10px",
                  color: "rgba(12,7,49,0.40)",
                  padding: "4px 6px",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DashboardView({ allowedModules, activeModuleId, switchModule, accent, accentRgb, realEstateItems, watchesItems }) {
  const modulesWithItems = useMemo(() => {
    return allowedModules.map(m => {
      let items = m.items;
      if (m.id === "real-estate" && realEstateItems) items = realEstateItems;
      if (m.id === "watches" && watchesItems) items = watchesItems;
      return { ...m, items };
    });
  }, [allowedModules, realEstateItems, watchesItems]);

  const actNowItems = useMemo(() => {
    const all = [];
    modulesWithItems.forEach(m => {
      m.items.forEach(item => {
        if (item.labelType === "green") {
          all.push({ ...item, _module: m });
        }
      });
    });
    return all.sort((a, b) => b.score - a.score);
  }, [modulesWithItems]);

  const watchItems = useMemo(() => {
    const all = [];
    modulesWithItems.forEach(m => {
      m.items.forEach(item => {
        if (item.labelType === "amber") {
          all.push({ ...item, _module: m });
        }
      });
    });
    return all.sort((a, b) => b.score - a.score).slice(0, 3);
  }, [modulesWithItems]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
      <AlertBar />
      {/* Module cards — compact */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(modulesWithItems.length, 4)}, 1fr)`,
        gap: "12px",
        marginBottom: "28px",
      }}>
        {modulesWithItems.map(m => (
          <button
            key={m.id}
            onClick={() => switchModule(m.id)}
            style={{
              padding: "16px",
              background: m.id === activeModuleId
                ? `rgba(${m.accentRgb},0.07)`
                : "rgba(12,7,49,0.03)",
              border: `1px solid ${m.id === activeModuleId ? `rgba(${m.accentRgb},0.22)` : "rgba(12,7,49,0.08)"}`,
              borderRadius: "10px",
              textAlign: "left",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
              <div style={{
                width: "28px",
                height: "28px",
                borderRadius: "7px",
                background: m.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "9px",
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
                color: "#0C0731",
              }}>{m.abbr}</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0C0731" }}>{m.label}</div>
            </div>
            <div style={{ display: "flex", gap: "16px" }}>
              {m.metrics.slice(0, 2).map(met => (
                <div key={met.label}>
                  <div style={{ fontSize: "9px", letterSpacing: "0.1em", color: "rgba(12,7,49,0.45)", textTransform: "uppercase", marginBottom: "2px" }}>{met.label}</div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "20px", fontWeight: 600, color: m.accent }}>{met.value}</div>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>

      {/* Act Now — primary list */}
      {actNowItems.length > 0 && (
        <div style={{ marginBottom: "24px" }}>
          <div style={{
            fontSize: "10px",
            letterSpacing: "0.12em",
            color: "#68ECF4",
            fontWeight: 700,
            marginBottom: "10px",
          }}>
            ACT NOW
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {actNowItems.map((item) => (
              <button
                key={`${item._module.id}-${item.id}`}
                onClick={() => switchModule(item._module.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "130px 1fr",
                  alignItems: "center",
                  gap: "16px",
                  width: "100%",
                  padding: "14px 16px",
                  background: "rgba(104,236,244,0.04)",
                  border: "1px solid rgba(104,236,244,0.15)",
                  borderRadius: "10px",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.12s",
                }}
              >
                {item.acquisitionPlan?.decision?.dominantAction ? (
                  <ActionBadge action={item.acquisitionPlan.decision.dominantAction} size="large" />
                ) : (
                  <div style={{
                    fontSize: "12px", fontWeight: 700, letterSpacing: "0.09em",
                    padding: "8px 16px", borderRadius: "7px",
                    background: "rgba(104,236,244,0.12)", color: "#68ECF4",
                    border: "1px solid rgba(104,236,244,0.25)",
                    fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap",
                  }}>{item.label}</div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                  <div style={{
                    width: "18px", height: "18px", borderRadius: "4px",
                    background: item._module.accent,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "7px", fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace", color: "#0C0731",
                    flexShrink: 0,
                  }}>{item._module.abbr}</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#0C0731" }}>{item.title}</div>
                  <div style={{ fontSize: "11px", color: "rgba(12,7,49,0.45)", marginLeft: "auto", fontFamily: "'JetBrains Mono', monospace" }}>{item.score.toFixed(1)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Watch list — secondary */}
      {watchItems.length > 0 && (
        <div>
          <div style={{
            fontSize: "9px",
            letterSpacing: "0.12em",
            color: "rgba(12,7,49,0.40)",
            fontWeight: 600,
            marginBottom: "8px",
          }}>
            MONITORING
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {watchItems.map((item) => (
              <button
                key={`${item._module.id}-${item.id}`}
                onClick={() => switchModule(item._module.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  padding: "8px 12px",
                  background: "transparent",
                  border: "1px solid rgba(12,7,49,0.06)",
                  borderRadius: "6px",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <div style={{ flex: 1, fontSize: "12px", color: "rgba(12,7,49,0.55)" }}>{item.title}</div>
                <div style={{ fontSize: "10px", fontFamily: "'JetBrains Mono', monospace", color: "rgba(12,7,49,0.35)" }}>{item.score.toFixed(1)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {import("../lib/types").DecisionItem[] | null} [props.realEstateItems]
 * @param {import("../lib/types").DecisionItem[] | null} [props.watchesItems]
 */
export default function App({ realEstateItems = null, watchesItems = null, initialModule = null }) {
  const { user, logout } = useSession();
  const allowedModules = useMemo(
    () => Object.values(MODULES).filter(m => user?.modules?.includes(m.id)),
    [user]
  );
  const [activeModuleId, setActiveModuleId] = useState(() => {
    if (initialModule) {
      const allowed = Object.values(MODULES).filter(m => user?.modules?.includes(m.id));
      if (allowed.some(m => m.id === initialModule)) return initialModule;
    }
    const allowed = Object.values(MODULES).filter(m => user?.modules?.includes(m.id));
    return allowed[0]?.id || "real-estate";
  });
  const [activeNavId, setActiveNavId] = useState(() => initialModule ? "list" : "dashboard");
  const [aiOpen, setAiOpen] = useState(true);
  const [tier, setTier] = useState("experienced");
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const moduleRef = useRef(MODULES[activeModuleId]);

  useEffect(() => { moduleRef.current = MODULES[activeModuleId]; }, [activeModuleId]);

  const module = useMemo(() => {
    const base = MODULES[activeModuleId];
    if (activeModuleId === "real-estate" && realEstateItems) {
      return { ...base, items: realEstateItems };
    }
    if (activeModuleId === "watches" && watchesItems) {
      return { ...base, items: watchesItems };
    }
    return base;
  }, [activeModuleId, realEstateItems, watchesItems]);

  useEffect(() => {
    console.log("[MERIDIAN DEBUG]", {
      activeModuleId,
      activeNavId,
      userModules: user?.modules,
      watchesItemsLength: Array.isArray(watchesItems) ? watchesItems.length : null,
      realEstateItemsLength: Array.isArray(realEstateItems) ? realEstateItems.length : null,
      moduleId: module?.id,
      moduleLabel: module?.label,
      moduleItemsLength: Array.isArray(module?.items) ? module.items.length : null,
      firstModuleItem: Array.isArray(module?.items) && module.items.length ? module.items[0] : null,
    });
  }, [activeModuleId, activeNavId, user, watchesItems, realEstateItems, module]);



  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages]);

  const switchModule = useCallback((id) => {
    if (id === activeModuleId) return;
    if (!allowedModules.some(m => m.id === id)) return;
    setTransitioning(true);
    setSelectedItem(null);
    setTimeout(() => {
      setActiveModuleId(id);
      setAiMessages([]);
      setTransitioning(false);
    }, 200);
  }, [activeModuleId, allowedModules]);

  const sendToAi = useCallback(async (text, itemContext) => {
    const history = aiMessages;
    setAiInput("");
    setAiMessages(prev => [...prev, { role: "user", content: text }]);
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleId: module.id,
          message: text,
          selectedItem: itemContext ?? null,
          pipelineItems: module.items ?? null,
          history,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setAiMessages(prev => [...prev, { role: "assistant", content: data.reply || "" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiMessages(prev => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setAiLoading(false);
    }
  }, [module, aiMessages]);

  const sendAiMessage = useCallback(() => {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    sendToAi(text, selectedItem);
  }, [aiInput, aiLoading, selectedItem, sendToAi]);

  const sendContextual = useCallback((text, itemContext) => {
    if (aiLoading) return;
    setAiOpen(true);
    sendToAi(text, itemContext);
  }, [aiLoading, sendToAi]);

  const S = styles(module.accent, module.accentRgb);

  const contextLabel = "Ask AI";

  return (
    <div style={S.root}>
      <nav style={S.nav}>
        <div style={S.navBrand}>
          <MeridianMark size={24} color="#1E3092" bg="#EDEAE4" />
          <div>
            <div style={S.brandName}>MERIDIAN</div>
            <div style={S.brandSub}>Decision Platform</div>
          </div>
        </div>

        <div style={S.moduleSection}>
          <div style={S.sectionLabel}>MODULES</div>
          {allowedModules.map(m => (
            <button key={m.id} onClick={() => switchModule(m.id)} style={S.moduleBtn(m.id === activeModuleId, m.accent)}>
              <div style={S.moduleAbbr(m.id === activeModuleId, m.accent)}>{m.abbr}</div>
              <div>
                <div style={S.moduleBtnLabel(m.id === activeModuleId)}>{m.label}</div>
                <div style={S.moduleBtnSub}>{m.tagline}</div>
              </div>
              {m.id === activeModuleId && <div style={S.activeIndicator(m.accent)}/>}
            </button>
          ))}
        </div>

        <div style={S.moduleSection}>
          <div style={S.sectionLabel}>NAVIGATE</div>
          {NAV_ITEMS.map(n => {
            const Icon = n.icon;
            const active = n.id === activeNavId;
            return (
              <button key={n.id} onClick={() => setActiveNavId(n.id)} style={S.navBtn(active)}>
                <Icon size={15} color={active ? module.accent : "rgba(12,7,49,0.50)"}/>
                <span style={{ color: active ? "#0C0731" : "rgba(12,7,49,0.50)", fontSize: "13px", fontWeight: active ? "500" : "400" }}>{n.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: "12px 12px 4px" }}>
          <div style={S.sectionLabel}>DETAIL LEVEL</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            {Object.entries(TIERS).map(([key, t]) => (
              <button key={key} onClick={() => setTier(key)} style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: "7px 10px",
                fontSize: "11px",
                fontWeight: tier === key ? 600 : 400,
                letterSpacing: "0.02em",
                borderRadius: "6px",
                background: tier === key ? `rgba(${module.accentRgb},0.10)` : "transparent",
                border: tier === key ? `1px solid rgba(${module.accentRgb},0.20)` : "1px solid transparent",
                color: tier === key ? module.accent : "rgba(12,7,49,0.55)",
                cursor: "pointer",
                transition: "all 0.15s",
                textAlign: "left",
              }}>
                <span>{t.label}</span>
                <span style={{ fontSize: "9px", color: tier === key ? `rgba(${module.accentRgb},0.65)` : "rgba(12,7,49,0.30)", fontWeight: 400 }}>{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{
          marginTop: "auto",
          padding: "12px 16px 8px",
          borderTop: "1px solid rgba(12,7,49,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div style={{ fontSize: "11px", color: "rgba(12,7,49,0.60)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
            <div style={{ fontSize: "9px", color: "rgba(12,7,49,0.40)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{user?.id}</div>
          </div>
          <button onClick={logout} style={{
            fontSize: "10px",
            padding: "5px 8px",
            borderRadius: "5px",
            background: "rgba(12,7,49,0.06)",
            border: "1px solid rgba(12,7,49,0.10)",
            color: "rgba(12,7,49,0.60)",
            cursor: "pointer",
            letterSpacing: "0.05em",
            flexShrink: 0,
          }}>SIGN OUT</button>
        </div>

        <div style={S.navFooter}>
          <div style={S.onlineDot}/>
          <span style={{ fontSize: "10px", color: "rgba(12,7,49,0.30)" }}>Live</span>
        </div>
      </nav>

      <div style={S.main}>
        {activeNavId === "dashboard" ? (
          <>
            <header style={S.topBar}>
              <div style={{ minWidth: 0 }}>
                <div style={S.moduleTitle}>Dashboard</div>
              </div>
              <div style={S.topBarRight}>
                <div style={S.refreshBadge}>LIVE</div>
                <button onClick={() => setAiOpen(o => !o)} style={S.aiToggleBtn(aiOpen, module.accent)}>
                  <AIIcon size={16}/>
                  <span>AI Panel</span>
                </button>
              </div>
            </header>
            <DashboardView
              allowedModules={allowedModules}
              activeModuleId={activeModuleId}
              switchModule={(id) => { switchModule(id); setActiveNavId("list"); }}
              accent={module.accent}
              accentRgb={module.accentRgb}
              realEstateItems={realEstateItems}
              watchesItems={watchesItems}
            />
          </>
        ) : (
          <>
        <header style={S.topBar}>
          <div style={{ minWidth: 0, maxWidth: "640px" }}>
            <div style={S.moduleTitle}>{module.label}</div>
            <div style={{
              ...S.moduleTagline,
              marginTop: "3px",
            }}>
              {module.tagline}
            </div>
          </div>
          <div style={S.topBarRight}>
            <div style={S.refreshBadge}>LIVE</div>
            <button onClick={() => setAiOpen(o => !o)} style={S.aiToggleBtn(aiOpen, module.accent)}>
              <AIIcon size={16}/>
              <span>AI Panel</span>
            </button>
          </div>
        </header>

        <div style={S.metricsRow}>
          {module.metrics.map(m => (
            <div key={m.label} style={S.metricCard}>
              <div style={S.metricLabel}>{m.label}</div>
              <div style={S.metricValue(module.accent)}>{m.value}</div>
            </div>
          ))}
        </div>

        {module.id === "watches" && (
          <CapitalAllocationPanel accent={module.accent} accentRgb={module.accentRgb}/>
        )}


        {/* Opportunity volume strip */}
        {module.items.length > 0 && (() => {
          const deployable = module.items.filter(it => it.opportunityTier === "ACTION" && it.executableNow).length;
          const actionTotal = module.items.filter(it => it.opportunityTier === "ACTION").length;
          const secondary = module.items.filter(it => it.opportunityTier === "SECONDARY").length;
          const monitoring = module.items.filter(it => it.opportunityTier === "MONITOR").length;
          const low = module.items.filter(it => (it.opportunityTier || "LOW") === "LOW").length;
          return (
            <div style={{
              display: "flex",
              gap: "16px",
              padding: "10px 28px",
              borderBottom: "1px solid rgba(12,7,49,0.06)",
              flexShrink: 0,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: "11px",
            }}>
              <span style={{ color: "#68ECF4" }}>{deployable} deploy now{actionTotal > deployable ? ` (+${actionTotal - deployable})` : ""}</span>
              <span style={{ color: module.accent }}>{secondary} opportunities</span>
              <span style={{ color: "rgba(12,7,49,0.50)" }}>{monitoring} monitoring</span>
              <span style={{ color: "rgba(12,7,49,0.30)" }}>{low} low</span>
              <span style={{ marginLeft: "auto", color: "rgba(12,7,49,0.30)" }}>{module.items.length} total</span>
            </div>
          );
        })()}

        <div style={{ ...S.itemList, opacity: transitioning ? 0 : 1, transform: transitioning ? "translateY(10px)" : "translateY(0)", transition: "opacity 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
          {module.items.length === 0 && (
            <div style={{ padding: "84px 24px 60px", textAlign: "center" }}>
              <div style={{
                width: "56px",
                height: "56px",
                margin: "0 auto 20px",
                borderRadius: "14px",
                background: `rgba(${module.accentRgb},0.08)`,
                border: `1px solid rgba(${module.accentRgb},0.22)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: module.accent,
                boxShadow: `0 0 0 8px rgba(${module.accentRgb},0.04)`,
              }}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.55"/>
                  <path d="M11 7 L11 11 L13.8 12.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "#0C0731",
                marginBottom: "10px",
                letterSpacing: "-0.01em",
              }}>
                {(user?.geo?.length === 0 && module.id === "real-estate")
                  ? "No geography configured"
                  : "No opportunities loaded yet"}
              </div>
              <div style={{
                fontSize: "12px",
                color: "rgba(12,7,49,0.45)",
                maxWidth: "300px",
                margin: "0 auto",
                lineHeight: 1.5,
              }}>
                {(user?.geo?.length === 0 && module.id === "real-estate")
                  ? "Configure a target geography to begin."
                  : "New opportunities will appear here as sources are ingested."}
              </div>
            </div>
          )}

          {(() => {
            // Split ACTION tier into deployable vs overflow
            const actionItems = module.items.filter(it => (it.opportunityTier || "LOW") === "ACTION");
            const deployable = actionItems.filter(it => it.executableNow);
            const overflow = actionItems.filter(it => !it.executableNow);

            const SECTIONS = [
              { key: "DEPLOY", label: "DEPLOY NOW", color: "#68ECF4", items: deployable },
              ...(overflow.length > 0 ? [{ key: "OVERFLOW", label: "OUTSIDE CAPITAL", color: "rgba(12,7,49,0.50)", items: overflow }] : []),
              { key: "SECONDARY", label: "OPPORTUNITIES", color: module.accent, items: module.items.filter(it => (it.opportunityTier || "LOW") === "SECONDARY") },
              { key: "MONITOR", label: "MONITORING", color: "rgba(12,7,49,0.55)", items: module.items.filter(it => (it.opportunityTier || "LOW") === "MONITOR") },
              { key: "LOW", label: "LOW PRIORITY", color: "rgba(12,7,49,0.35)", items: module.items.filter(it => (it.opportunityTier || "LOW") === "LOW") },
            ];

            let globalIdx = 0;
            return SECTIONS.map(({ key: sectionKey, label: sectionLabel, color: sectionColor, items: sectionItems }) => {
              if (sectionItems.length === 0) return null;
              const isLow = sectionKey === "LOW";
              return (
                <TierSection
                  key={sectionKey}
                  sectionKey={sectionKey}
                  label={sectionLabel}
                  color={sectionColor}
                  count={sectionItems.length}
                  collapsible={isLow}
                  defaultCollapsed={isLow}
                  dimmed={isLow}
                >
                  {sectionItems.map((item) => {
            const i = globalIdx++;
            const selected = selectedItem?.id === item.id;
            const isRejected = item.trustTier === "REJECTED";
            const isTopPick = !isRejected && sectionKey === "DEPLOY" && i === 0;
            return (
              <div key={item.id}>
                <button
                  onClick={() => setSelectedItem(selected ? null : item)}
                  style={{
                    ...S.itemRow(selected, module.accent, isTopPick),
                    ...(isRejected && !selected ? {
                      opacity: 0.55,
                      background: "rgba(212,114,106,0.05)",
                      border: "1px solid rgba(212,114,106,0.22)",
                      boxShadow: "none",
                    } : {}),
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                    {item.acquisitionPlan?.decision?.dominantAction ? (
                      <ActionBadge action={item.acquisitionPlan.decision.dominantAction} size="large" />
                    ) : (
                      <div style={S.labelBadgeLarge(item.labelType)}>{item.label}</div>
                    )}
                    {item.trustTier && (
                      <div style={S.trustBadge(item.trustTier)}>
                        {item.trustTier === "SOFT_REJECT" ? "REVIEW" : item.trustTier}
                      </div>
                    )}
                  </div>
                  <div style={S.itemMeta}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={S.itemTitle}>{item.title}</div>
                      {item.capitalSlot === "PRIMARY" && (
                        <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.1em", padding: "2px 6px", borderRadius: "3px", background: "rgba(104,236,244,0.12)", color: "#68ECF4", border: "1px solid rgba(104,236,244,0.20)" }}>PRIMARY</span>
                      )}
                      {item.capitalSlot === "BACKUP" && (
                        <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.1em", padding: "2px 6px", borderRadius: "3px", background: "rgba(142,141,187,0.12)", color: "#4A9EFF", border: "1px solid rgba(142,141,187,0.20)" }}>BACKUP</span>
                      )}
                    </div>
                    <div style={S.itemSub}>
                      {item.sub}{item.tag ? ` · ${item.tag}` : ""}
                      {item.sourcePlatform && (
                        <span style={S.sourceTag}>
                          {" · "}{item.sourcePlatform.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                          {item.sellerName ? ` · ${item.sellerName}` : ""}
                        </span>
                      )}
                      {item.lastChecked && (() => {
                        const ms = Date.now() - new Date(item.lastChecked).getTime();
                        const mins = Math.floor(ms / 60000);
                        const label = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins/60)}h ago` : `${Math.floor(mins/1440)}d ago`;
                        return <span style={S.checkedTag}>{" · Checked "}{label}</span>;
                      })()}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                    <div style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "12px",
                      fontWeight: 500,
                      color: "rgba(12,7,49,0.50)",
                    }}>
                      {item.score.toFixed(1)}
                    </div>
                    {item.listingUrl ? (
                      <a
                        href={item.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={S.viewListingBtn}
                      >
                        View Listing ↗
                      </a>
                    ) : (
                      <span style={S.viewListingDisabled}>No Link</span>
                    )}
                  </div>
                </button>

                {selected && (
                  <div style={S.detailPanel(module.accent)}>
                    {/* ═══ LEVEL 1: Hero verdict ═══ */}
                    {TIERS[tier].sections.includes("action") && item.acquisitionPlan && (
                      <ActionHero plan={item.acquisitionPlan} accent={module.accent} />
                    )}

                    {/* ═══ LEVEL 2: CTA + Economics ═══ */}
                    {TIERS[tier].sections.includes("nextAction") && item.nextAction && (
                      <div style={{
                        padding: "16px 20px",
                        background: `rgba(${module.accentRgb},0.12)`,
                        border: `1.5px solid rgba(${module.accentRgb},0.30)`,
                        borderRadius: "10px",
                        marginBottom: "18px",
                        cursor: "pointer",
                        textAlign: "center",
                      }}>
                        <div style={{
                          fontSize: "16px",
                          fontWeight: 700,
                          color: module.accent,
                          lineHeight: 1.4,
                          letterSpacing: "0.01em",
                        }}>
                          {item.nextAction}
                        </div>
                      </div>
                    )}

                    {TIERS[tier].sections.includes("stats") && (
                      <div style={{
                        display: "flex",
                        gap: "0",
                        marginBottom: "18px",
                        borderRadius: "10px",
                        overflow: "hidden",
                        border: "1px solid rgba(12,7,49,0.08)",
                      }}>
                        {Object.entries({
                          [module.id === "roofing" ? "Est. Value" : module.id === "trading" ? "Price" : module.id === "saas" ? "ARR" : module.id === "watches" ? "Price" : "ARV"]: item.arv,
                          [module.id === "roofing" ? "Close %" : module.id === "trading" ? "Rel.Str." : module.id === "saas" ? "Expansion" : module.id === "watches" ? "Market" : "MAO"]: item.mao,
                          [module.id === "roofing" ? "Urgency" : module.id === "trading" ? "Price" : module.id === "saas" ? "Status" : module.id === "watches" ? "Margin" : "Asking"]: item.ask,
                          [module.id === "watches" ? "Liquidity" : "Risk"]: item.risk,
                        }).map(([k, v], idx) => (
                          <div key={k} style={{
                            flex: 1,
                            padding: "12px 14px",
                            background: "rgba(12,7,49,0.03)",
                            borderRight: idx < 3 ? "1px solid rgba(12,7,49,0.06)" : "none",
                          }}>
                            <div style={S.detailStatLabel}>{k}</div>
                            <div style={S.detailStatValue}>{v ?? "—"}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ═══ LEVEL 2: Execution strip (acquisition plan) ═══ */}
                    {TIERS[tier].sections.includes("acquisition") && item.acquisitionPlan && item.labelType !== "red" && (() => {
                      const plan = item.acquisitionPlan;
                      const styleColorMap = { Aggressive: "#68ECF4", Confident: "#68ECF4", Balanced: module.accent, Patient: "#EDDABA", "Walk-ready": "#D4726A" };
                      const urgencyMap = { "act-now": { label: "ACT NOW", color: "#68ECF4" }, "this-week": { label: "THIS WEEK", color: module.accent }, "this-month": { label: "THIS MONTH", color: "#EDDABA" }, "passive": { label: "PASSIVE", color: "rgba(12,7,49,0.55)" } };
                      const priorityMap = { anchor: { label: "ANCHOR", color: "#68ECF4" }, core: { label: "CORE", color: module.accent }, satellite: { label: "SATELLITE", color: "#EDDABA" }, skip: { label: "SKIP", color: "#D4726A" } };
                      const styleColor = styleColorMap[plan.negotiationStyle] || module.accent;
                      const urg = urgencyMap[plan.urgency] || urgencyMap.passive;
                      const pri = priorityMap[plan.capitalPriority] || priorityMap.satellite;
                      const fmt = (n) => `$${(n ?? 0).toLocaleString("en-US")}`;
                      const pill = (color) => ({ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", padding: "6px 12px", borderRadius: "6px", background: `${color}1A`, color, border: `1px solid ${color}44`, whiteSpace: "nowrap", textTransform: "uppercase" });
                      return (
                        <>
                          {/* Execution strip — one horizontal band */}
                          <div style={{
                            display: "flex",
                            alignItems: "flex-end",
                            gap: "28px",
                            padding: "18px 20px",
                            background: "rgba(12,7,49,0.03)",
                            borderRadius: "10px",
                            marginBottom: "14px",
                            flexWrap: "wrap",
                          }}>
                            <div>
                              <div style={{ fontSize: "9px", letterSpacing: "0.12em", color: "rgba(12,7,49,0.50)", fontWeight: 600, textTransform: "uppercase", marginBottom: "6px" }}>Open</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "22px", fontWeight: 700, color: module.accent, letterSpacing: "-0.01em", lineHeight: 1 }}>{fmt(plan.openingOffer)}</div>
                            </div>
                            <div style={{ color: "rgba(12,7,49,0.15)", fontSize: "18px", lineHeight: 1, marginBottom: "2px" }}>→</div>
                            <div>
                              <div style={{ fontSize: "9px", letterSpacing: "0.12em", color: "rgba(12,7,49,0.50)", fontWeight: 600, textTransform: "uppercase", marginBottom: "6px" }}>Target</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "22px", fontWeight: 700, color: "#0C0731", letterSpacing: "-0.01em", lineHeight: 1 }}>{fmt(plan.targetBuy)}</div>
                            </div>
                            <div style={{ color: "rgba(12,7,49,0.15)", fontSize: "18px", lineHeight: 1, marginBottom: "2px" }}>→</div>
                            <div>
                              <div style={{ fontSize: "9px", letterSpacing: "0.12em", color: "rgba(12,7,49,0.50)", fontWeight: 600, textTransform: "uppercase", marginBottom: "6px" }}>Ceiling</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "22px", fontWeight: 700, color: "rgba(12,7,49,0.50)", letterSpacing: "-0.01em", lineHeight: 1 }}>{fmt(plan.hardCeiling)}</div>
                            </div>
                            <div style={{ marginLeft: "auto", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                              <div style={pill(styleColor)}>{plan.negotiationStyle}</div>
                              <div style={pill(urg.color)}>{urg.label}</div>
                              <div style={pill(pri.color)}>{pri.label}</div>
                            </div>
                          </div>

                          {/* Strategy — one clean block, no nested boxes */}
                          <div style={{ marginBottom: "14px", padding: "0 2px" }}>
                            <div style={{ fontSize: "13px", color: "rgba(12,7,49,0.55)", lineHeight: 1.55, marginBottom: "8px" }}>
                              {plan.negotiationReasoning}
                            </div>
                            {plan.counterStrategy && (
                              <div style={{ fontSize: "13px", color: "rgba(12,7,49,0.55)", lineHeight: 1.5 }}>
                                <span style={{ color: module.accent, fontWeight: 600 }}>Counter: </span>{plan.counterStrategy}
                              </div>
                            )}
                          </div>

                          {/* Objections — inline, no box */}
                          {plan.likelyObjections && plan.likelyObjections.length > 0 && (
                            <div style={{ marginBottom: "14px", padding: "0 2px" }}>
                              {plan.likelyObjections.map((obj, oi) => (
                                <div key={oi} style={{ fontSize: "12px", color: "rgba(12,7,49,0.55)", display: "flex", gap: "8px", lineHeight: 1.5, marginBottom: "3px" }}>
                                  <span style={{ color: "rgba(12,7,49,0.30)", flexShrink: 0 }}>•</span>
                                  <span>{obj}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Exit line — flat, no container */}
                          <div style={{
                            display: "flex",
                            gap: "24px",
                            alignItems: "baseline",
                            flexWrap: "wrap",
                            fontSize: "12px",
                            color: "rgba(12,7,49,0.55)",
                            marginBottom: plan.walkAwayTrigger ? "8px" : "14px",
                            padding: "0 2px",
                          }}>
                            <span><span style={{ color: "rgba(12,7,49,0.55)", fontWeight: 500 }}>Hold</span> ~{plan.estimatedHoldDays}d</span>
                            <span><span style={{ color: "rgba(12,7,49,0.55)", fontWeight: 500 }}>Exit</span> {plan.exitPlatform}</span>
                          </div>

                          {plan.walkAwayTrigger && (
                            <div style={{ fontSize: "12px", color: "rgba(12,7,49,0.55)", lineHeight: 1.5, marginBottom: "14px", padding: "0 2px" }}>
                              <span style={{ color: "#D4726A", fontWeight: 600 }}>Walk: </span>{plan.walkAwayTrigger}
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* ═══ LEVEL 3: Trust (compact) ═══ */}
                    {TIERS[tier].sections.includes("trust") && item.trustScore != null && (() => {
                      const tierColorMap = { TRUSTED: "#68ECF4", CAUTION: "#EDDABA", SOFT_REJECT: "#D4726A", REJECTED: "#D4726A" };
                      const tierColor = tierColorMap[item.trustTier] || "rgba(12,7,49,0.55)";
                      const reasons = item.trustReasons || [];
                      return (
                        <div style={{ marginBottom: "14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: reasons.length > 0 ? "6px" : 0 }}>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "18px", fontWeight: 600, color: tierColor, lineHeight: 1 }}>{item.trustScore}</span>
                            <div style={S.trustBadge(item.trustTier)}>{item.trustTier === "SOFT_REJECT" ? "REVIEW" : item.trustTier}</div>
                            <div style={{ flex: 1, height: "3px", borderRadius: "2px", background: "rgba(12,7,49,0.08)", overflow: "hidden", minWidth: "30px" }}>
                              <div style={{ width: `${item.trustScore}%`, height: "100%", background: tierColor, transition: "width 0.4s ease" }}/>
                            </div>
                          </div>
                          {reasons.length > 0 && (
                            <div style={{ padding: "0 2px" }}>
                              {reasons.slice(0, 3).map((r, ri) => (
                                <div key={ri} style={{ fontSize: "11px", color: "rgba(12,7,49,0.55)", display: "flex", gap: "7px", lineHeight: 1.5, marginBottom: "2px" }}>
                                  <span style={{ color: tierColor, flexShrink: 0 }}>•</span><span>{r}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ═══ LEVEL 3: Thesis (one line, no box) ═══ */}
                    {TIERS[tier].sections.includes("thesis") && item.thesis && (
                      <div style={{ fontSize: "13px", color: "rgba(12,7,49,0.55)", lineHeight: 1.55, marginBottom: "14px", padding: "0 2px" }}>
                        {item.thesis}
                      </div>
                    )}

                    {/* ═══ LEVEL 3: Platform metrics (compact) ═══ */}
                    {TIERS[tier].sections.includes("metrics") && item.platformMetrics && (
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "11px", color: "rgba(12,7,49,0.55)", lineHeight: 1.7, whiteSpace: "pre-line", marginBottom: "14px", padding: "0 2px" }}>
                        {item.platformMetrics}
                      </div>
                    )}

                    {/* ═══ LEVEL 4: Risk (flat list) ═══ */}
                    {TIERS[tier].sections.includes("risk") && item.riskFactors && item.riskFactors.length > 0 && (
                      <div style={{ marginBottom: "14px", padding: "0 2px" }}>
                        {item.riskFactors.map((r, ri) => (
                          <div key={ri} style={{ fontSize: "12px", color: "rgba(12,7,49,0.55)", display: "flex", alignItems: "center", marginBottom: "3px" }}>
                            <span style={{ color: "#D4726A", marginRight: "8px", fontSize: "10px" }}>▲</span>{r}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ═══ Negotiation controls (Pro only) ═══ */}
                    {TIERS[tier].sections.includes("negotiation") && item.acquisitionPlan && item.labelType !== "red" && (
                      <NegotiationControls
                        itemId={String(item.id)}
                        openingOffer={item.acquisitionPlan.openingOffer}
                        currentState={item.negotiationState ?? null}
                        accent={module.accent}
                        accentRgb={module.accentRgb}
                      />
                    )}

                    <button
                      onClick={() => sendContextual(
                        [
                          `Analyze: ${item.title}`,
                          item.score != null ? `score ${item.score}` : null,
                          item.label ? `label ${item.label}` : null,
                          item.risk ? `risk ${item.risk}` : null,
                          item.nextAction ? `next action: ${item.nextAction}` : null,
                        ].filter(Boolean).join(" · "),
                        item
                      )}
                      style={S.askAiBtn(module.accent)}
                    >
                      <AIIcon size={13}/> {contextLabel}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
                </TierSection>
              );
            });
          })()}
        </div>
          </>
        )}
      </div>

      {aiOpen && (
        <aside style={S.aiPanel(module.accent)}>
          <div style={S.aiHeader}>
            <div style={S.aiHeaderLeft}>
              <div style={S.aiPulse(module.accent)}/>
              <span style={S.aiHeaderTitle}>AI Analyst</span>
            </div>
            <div style={S.aiModuleTag(module.accent)}>{module.abbr}</div>
          </div>

          <div style={S.aiMessages}>
            {aiMessages.length === 0 && (
              <div style={S.aiEmpty}>
                <div style={S.aiEmptyIcon(module.accent)}><AIIcon size={22}/></div>
                <div style={S.aiEmptyTitle}>Ready</div>
                <div style={S.aiEmptySub}>Ask about any item or your full pipeline.</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "16px" }}>
                  {[
                    module.id === "real-estate" ? "Which deals have the best equity spread?" : module.id === "saas" ? "Which accounts are most at risk this quarter?" : "What's my highest conviction trade right now?",
                    module.id === "real-estate" ? "What's the risk profile on deal #1?" : module.id === "saas" ? "How should I prioritize expansion this month?" : "Explain the current market risk environment.",
                  ].map(q => (
                    <button key={q} onClick={() => { setAiInput(q); inputRef.current?.focus(); }} style={S.aiSuggestion(module.accent)}>{q}</button>
                  ))}
                </div>
              </div>
            )}

            {aiMessages.map((m, i) => (
              <div key={i} style={S.aiMessage(m.role, module.accent)}>
                {m.role === "assistant" && <div style={S.aiAssistantLabel(module.accent)}>ANALYST</div>}
                <div style={{
                  ...S.aiMessageText(m.role),
                  ...(m.role === "assistant" ? { whiteSpace: "normal" } : {}),
                }}>
                  {m.role === "assistant"
                    ? (() => { try { return renderMarkdown(m.content, module.accent); } catch { return m.content; } })()
                    : m.content}
                </div>
              </div>
            ))}

            {aiLoading && (
              <div style={S.aiMessage("assistant", module.accent)}>
                <div style={S.aiAssistantLabel(module.accent)}>ANALYST</div>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "11px 13px",
                  background: "rgba(12,7,49,0.04)",
                  border: "1px solid rgba(12,7,49,0.08)",
                  borderRadius: "9px",
                }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {[0, 1, 2].map(d => (
                      <div key={d} style={{ width: "5px", height: "5px", borderRadius: "50%", background: module.accent, animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${d * 0.2}s` }}/>
                    ))}
                  </div>
                  <span style={{ fontSize: "12px", color: "rgba(12,7,49,0.55)", letterSpacing: "0.02em" }}>Analyzing</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef}/>
          </div>

          <div style={S.aiInputArea(module.accent)}>
            <textarea
              ref={inputRef}
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }}}
              placeholder="Ask the analyst..."
              rows={2}
              style={S.aiTextarea}
            />
            <button onClick={sendAiMessage} disabled={!aiInput.trim() || aiLoading} style={S.aiSendBtn(module.accent, !aiInput.trim() || aiLoading)}>
              <SendIcon/>
            </button>
          </div>
        </aside>
      )}

      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(12,7,49,0.10); border-radius: 6px; transition: background 0.2s; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(12,7,49,0.18); }
        textarea:focus {
          outline: none;
          border-color: rgba(12,7,49,0.18) !important;
          background: #fff !important;
        }
        textarea::placeholder { color: rgba(12,7,49,0.30); }
        button { cursor: pointer; border: none; background: none; }
      `}</style>
    </div>
  );
}

function styles(accent, accentRgb) {
  // Light-theme tokens matching public site
  const bg = "#F5F3EF";
  const surface = "#FFFFFF";
  const surfaceElevated = "#FFFFFF";
  const text = "#0C0731";
  const textSec = "rgba(12,7,49,0.62)";
  const textLabel = "rgba(12,7,49,0.50)";
  const border = "rgba(12,7,49,0.10)";
  const borderLight = "rgba(12,7,49,0.07)";
  const borderStrong = "rgba(12,7,49,0.16)";
  const cobalt = "#1E3092";

  return {
    root: {
      display: "flex",
      height: "100vh",
      background: bg,
      color: text,
      fontFamily: "'DM Sans', sans-serif",
      overflow: "hidden",
    },
    nav: {
      width: "240px",
      flexShrink: 0,
      background: surface,
      borderRight: `1px solid ${borderLight}`,
      display: "flex",
      flexDirection: "column",
      padding: "0",
      gap: "0",
      overflowY: "auto",
    },
    navBrand: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "22px 18px",
      borderBottom: `1px solid ${borderLight}`,
    },
    brandMark: { flexShrink: 0 },
    brandName: {
      fontFamily: "'Syne', sans-serif",
      fontWeight: "700",
      fontSize: "15px",
      letterSpacing: "0.04em",
      color: text,
    },
    brandSub: { fontSize: "10px", color: textLabel, letterSpacing: "0.05em" },
    moduleSection: { padding: "18px 14px 10px" },
    sectionLabel: {
      fontSize: "10px",
      letterSpacing: "0.12em",
      color: textLabel,
      fontWeight: "700",
      padding: "0 4px",
      marginBottom: "8px",
      textTransform: "uppercase",
    },
    moduleBtn: (active, ac) => ({
      display: "flex",
      alignItems: "center",
      gap: "10px",
      width: "100%",
      padding: "8px 8px",
      borderRadius: "8px",
      background: active ? `rgba(${accentRgb},0.10)` : "transparent",
      border: active ? `1px solid rgba(${accentRgb},0.20)` : "1px solid transparent",
      cursor: "pointer",
      position: "relative",
      marginBottom: "3px",
      transition: "all 0.15s ease",
    }),
    moduleAbbr: (active, ac) => ({
      width: "30px",
      height: "30px",
      borderRadius: "7px",
      background: active ? cobalt : "rgba(12,7,49,0.06)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "9px",
      fontWeight: "700",
      fontFamily: "'JetBrains Mono', monospace",
      color: active ? "#fff" : textLabel,
      flexShrink: 0,
      transition: "all 0.15s ease",
    }),
    moduleBtnLabel: (active) => ({
      fontSize: "12px",
      fontWeight: active ? "600" : "400",
      color: active ? text : textSec,
      lineHeight: 1.2,
    }),
    moduleBtnSub: {
      fontSize: "10px",
      color: textLabel,
      marginTop: "1px",
    },
    activeIndicator: (ac) => ({
      position: "absolute",
      right: "8px",
      width: "5px",
      height: "5px",
      borderRadius: "50%",
      background: cobalt,
    }),
    navBtn: (active) => ({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      padding: "7px 8px",
      borderRadius: "6px",
      background: active ? "rgba(12,7,49,0.05)" : "transparent",
      marginBottom: "2px",
      transition: "background 0.1s",
    }),
    navFooter: {
      marginTop: "auto",
      padding: "16px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      borderTop: `1px solid ${borderLight}`,
    },
    onlineDot: {
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: cobalt,
      animation: "blink 2s ease-in-out infinite",
    },
    main: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    topBar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "20px 28px",
      borderBottom: `1px solid ${borderLight}`,
      background: bg,
      flexShrink: 0,
    },
    moduleTitle: {
      fontFamily: "'Syne', sans-serif",
      fontSize: "22px",
      fontWeight: "700",
      letterSpacing: "-0.01em",
      color: text,
    },
    moduleTagline: { fontSize: "12px", color: textLabel, marginTop: "3px", letterSpacing: "0.01em" },
    topBarRight: { display: "flex", alignItems: "center", gap: "10px" },
    refreshBadge: {
      fontSize: "9px",
      fontWeight: "700",
      letterSpacing: "0.1em",
      padding: "3px 7px",
      borderRadius: "4px",
      background: "rgba(30,48,146,0.08)",
      color: cobalt,
      border: "1px solid rgba(30,48,146,0.18)",
    },
    aiToggleBtn: (open, ac) => ({
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "7px 12px",
      borderRadius: "7px",
      background: open ? `rgba(${accentRgb},0.10)` : "rgba(12,7,49,0.04)",
      border: `1px solid ${open ? `rgba(${accentRgb},0.22)` : border}`,
      color: open ? text : textSec,
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.15s",
    }),
    metricsRow: {
      display: "flex",
      gap: "10px",
      padding: "16px 28px",
      borderBottom: `1px solid ${borderLight}`,
      flexShrink: 0,
    },
    metricCard: {
      flex: 1,
      padding: "16px 18px",
      background: surface,
      border: `1px solid ${borderLight}`,
      borderRadius: "12px",
      boxShadow: "0 1px 4px rgba(12,7,49,0.03)",
    },
    metricLabel: { fontSize: "10px", color: textLabel, letterSpacing: "0.1em", marginBottom: "6px", textTransform: "uppercase", fontWeight: "600" },
    metricValue: (ac) => ({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "24px",
      fontWeight: "600",
      color: cobalt,
      letterSpacing: "-0.015em",
    }),
    itemList: {
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "20px 28px 28px",
    },
    listHeader: {
      display: "grid",
      gridTemplateColumns: "150px 1fr 40px",
      padding: "0 16px 10px",
      gap: "16px",
    },
    listHeaderLabel: {
      fontSize: "9px",
      letterSpacing: "0.12em",
      color: textLabel,
      fontWeight: "600",
    },
    itemRow: (selected, ac, isTopPick) => ({
      display: "grid",
      gridTemplateColumns: "150px 1fr 40px",
      alignItems: "center",
      gap: "18px",
      width: "100%",
      padding: isTopPick ? "18px 20px" : "14px 18px",
      background: selected
        ? `rgba(${accentRgb},0.06)`
        : surfaceElevated,
      border: `1px solid ${
        selected
          ? `rgba(${accentRgb},0.22)`
          : isTopPick
          ? borderStrong
          : border
      }`,
      borderRadius: selected ? "12px 12px 0 0" : "12px",
      cursor: "pointer",
      marginBottom: selected ? "0" : "10px",
      textAlign: "left",
      transition: "all 0.2s ease",
      boxShadow: isTopPick && !selected
        ? `0 2px 12px rgba(12,7,49,0.06)`
        : "none",
    }),
    itemMeta: { display: "flex", flexDirection: "column", gap: "3px" },
    itemTitle: { fontSize: "16px", fontWeight: "600", color: text, letterSpacing: "-0.01em" },
    itemSub: { fontSize: "12px", color: textSec, lineHeight: 1.4 },
    sourceTag: { color: textLabel, fontSize: "11px" },
    checkedTag: { color: textLabel, fontSize: "11px", fontStyle: "italic" },
    viewListingBtn: {
      fontSize: "10px",
      fontWeight: 600,
      color: cobalt,
      textDecoration: "none",
      padding: "3px 8px",
      borderRadius: "5px",
      border: `1px solid rgba(30,48,146,0.18)`,
      background: "rgba(30,48,146,0.04)",
      letterSpacing: "0.02em",
      whiteSpace: "nowrap",
      cursor: "pointer",
    },
    viewListingDisabled: {
      fontSize: "10px",
      color: textLabel,
      padding: "3px 8px",
      letterSpacing: "0.02em",
    },
    labelBadge: (type) => {
      const ls = LABEL_STYLES[type];
      return {
        fontSize: "10px",
        fontWeight: "700",
        letterSpacing: "0.09em",
        padding: "5px 9px",
        borderRadius: "5px",
        background: ls.bg,
        color: ls.color,
        border: `1px solid ${ls.border}`,
        whiteSpace: "nowrap",
        textAlign: "center",
      };
    },
    labelBadgeLarge: (type) => {
      const ls = LABEL_STYLES[type];
      return {
        fontSize: "13px",
        fontWeight: "700",
        letterSpacing: "0.08em",
        padding: "10px 20px",
        borderRadius: "8px",
        background: ls.bg,
        color: ls.color,
        border: `1.5px solid ${ls.border}`,
        whiteSpace: "nowrap",
        textAlign: "center",
        fontFamily: "'JetBrains Mono', monospace",
      };
    },
    trustBadge: (tier) => {
      const palette = {
        TRUSTED:     { bg: "rgba(30,48,146,0.08)",  color: "#1E3092", border: "rgba(30,48,146,0.18)" },
        CAUTION:     { bg: "rgba(139,122,58,0.08)", color: "#8B7A3A", border: "rgba(139,122,58,0.18)" },
        SOFT_REJECT: { bg: "rgba(160,69,64,0.08)",  color: "#A04540", border: "rgba(160,69,64,0.18)" },
        REJECTED:    { bg: "rgba(160,69,64,0.12)",  color: "#A04540", border: "rgba(160,69,64,0.28)" },
      };
      const p = palette[tier] || palette.TRUSTED;
      return {
        fontSize: "8px",
        fontWeight: "700",
        letterSpacing: "0.11em",
        padding: "2px 6px",
        borderRadius: "4px",
        background: p.bg,
        color: p.color,
        border: `1px solid ${p.border}`,
        whiteSpace: "nowrap",
        textAlign: "center",
      };
    },
    detailPanel: (ac) => ({
      background: surface,
      border: `1px solid ${borderLight}`,
      borderTop: "none",
      borderRadius: "0 0 12px 12px",
      padding: "24px 22px",
      marginBottom: "8px",
      boxShadow: "0 2px 8px rgba(12,7,49,0.03)",
    }),
    detailGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "10px",
      marginBottom: "18px",
    },
    detailStat: {
      background: bg,
      borderRadius: "10px",
      padding: "10px 12px",
      border: `1px solid ${borderLight}`,
    },
    detailStatLabel: { fontSize: "10px", color: textLabel, letterSpacing: "0.08em", marginBottom: "5px", textTransform: "uppercase", fontWeight: "600" },
    detailStatValue: { fontSize: "16px", fontWeight: "600", fontFamily: "'JetBrains Mono', monospace", color: text },
    detailSection: { marginBottom: "16px" },
    detailSectionLabel: {
      fontSize: "10px",
      letterSpacing: "0.12em",
      color: textLabel,
      marginBottom: "8px",
      fontWeight: "700",
      textTransform: "uppercase",
    },
    detailAction: (ac) => ({
      fontSize: "15px",
      color: cobalt,
      fontWeight: "600",
      padding: "14px 16px",
      background: "rgba(30,48,146,0.06)",
      borderRadius: "8px",
      borderLeft: `3px solid ${cobalt}`,
    }),
    riskItem: {
      fontSize: "13px",
      color: textSec,
      display: "flex",
      alignItems: "center",
    },
    askAiBtn: (ac) => ({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      marginTop: "16px",
      padding: "10px 16px",
      borderRadius: "8px",
      background: "rgba(30,48,146,0.06)",
      border: `1px solid rgba(30,48,146,0.15)`,
      color: cobalt,
      fontSize: "13px",
      fontWeight: "500",
      cursor: "pointer",
    }),
    aiPanel: (ac) => ({
      width: "380px",
      flexShrink: 0,
      background: surface,
      borderLeft: `1px solid ${borderLight}`,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }),
    aiHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 16px",
      borderBottom: `1px solid ${borderLight}`,
      flexShrink: 0,
    },
    aiHeaderLeft: { display: "flex", alignItems: "center", gap: "8px" },
    aiPulse: (ac) => ({
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      background: cobalt,
      animation: "blink 2s ease-in-out infinite",
    }),
    aiHeaderTitle: {
      fontFamily: "'Syne', sans-serif",
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: "0.05em",
      color: text,
    },
    aiModuleTag: (ac) => ({
      fontSize: "9px",
      fontWeight: "700",
      letterSpacing: "0.1em",
      padding: "3px 7px",
      borderRadius: "4px",
      background: "rgba(30,48,146,0.08)",
      color: cobalt,
      border: "1px solid rgba(30,48,146,0.18)",
    }),
    aiMessages: {
      flex: 1,
      overflowY: "auto",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    },
    aiEmpty: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
      padding: "24px 0",
    },
    aiEmptyIcon: (ac) => ({
      width: "44px",
      height: "44px",
      borderRadius: "12px",
      background: "rgba(30,48,146,0.06)",
      border: "1px solid rgba(30,48,146,0.15)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: cobalt,
      marginBottom: "12px",
    }),
    aiEmptyTitle: { fontSize: "14px", fontWeight: "500", color: text, marginBottom: "6px" },
    aiEmptySub: { fontSize: "12px", color: textSec, lineHeight: "1.5" },
    aiSuggestion: (ac) => ({
      width: "100%",
      padding: "8px 10px",
      background: bg,
      border: `1px solid ${borderLight}`,
      borderRadius: "7px",
      color: textSec,
      fontSize: "11px",
      textAlign: "left",
      cursor: "pointer",
      lineHeight: "1.4",
      transition: "all 0.1s",
    }),
    aiMessage: (role, ac) => ({
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      alignSelf: role === "user" ? "flex-end" : "flex-start",
      maxWidth: "85%",
    }),
    aiAssistantLabel: (ac) => ({
      fontSize: "9px",
      fontWeight: "700",
      letterSpacing: "0.14em",
      color: cobalt,
    }),
    aiMessageText: (role) => ({
      fontSize: "14px",
      lineHeight: "1.62",
      color: text,
      background: role === "user" ? "rgba(30,48,146,0.04)" : bg,
      border: `1px solid ${borderLight}`,
      borderRadius: "9px",
      padding: "11px 13px",
      whiteSpace: "pre-wrap",
    }),
    aiInputArea: (ac) => ({
      padding: "14px",
      borderTop: `1px solid ${borderLight}`,
      display: "flex",
      gap: "10px",
      alignItems: "flex-end",
      flexShrink: 0,
    }),
    aiTextarea: {
      flex: 1,
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: "9px",
      color: text,
      fontSize: "13px",
      padding: "11px 13px",
      resize: "none",
      fontFamily: "'DM Sans', sans-serif",
      lineHeight: "1.55",
      transition: "border-color 0.15s, background 0.15s",
    },
    aiSendBtn: (ac, disabled) => ({
      width: "40px",
      height: "40px",
      borderRadius: "9px",
      background: disabled ? "rgba(12,7,49,0.04)" : cobalt,
      border: `1px solid ${disabled ? border : cobalt}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: disabled ? "rgba(12,7,49,0.40)" : "#fff",
      cursor: disabled ? "not-allowed" : "pointer",
      flexShrink: 0,
      transition: "all 0.15s",
    }),
  };
}
