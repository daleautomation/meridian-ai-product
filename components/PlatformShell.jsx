"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./SessionProvider";

const FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');
`;

const MODULES = {
  "real-estate": {
    id: "real-estate",
    label: "Real Estate",
    abbr: "RE",
    tagline: "Acquisition Engine",
    explanation: "Source, score, and underwrite off-market residential deals — ranked by equity spread and execution risk.",
    accent: "#C8873A",
    accentRgb: "200,135,58",
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
    accent: "#4A9EFF",
    accentRgb: "74,158,255",
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
    accent: "#3DD68C",
    accentRgb: "61,214,140",
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
    label: "Watches",
    abbr: "WM",
    tagline: "Flip Engine",
    explanation: "Evaluate flip opportunities by margin, liquidity, and condition — ranked by hold-time-adjusted return.",
    accent: "#BF94FF",
    accentRgb: "191,148,255",
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
  }
};

const NAV_ITEMS = [
  { id: "dashboard", label: "Overview", icon: GridIcon },
  { id: "list", label: "Ranked List", icon: ListIcon },
  { id: "analysis", label: "Analysis", icon: ChartIcon },
  { id: "pipeline", label: "Pipeline", icon: FlowIcon },
];

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
      <circle cx={size/2} cy={size/2} r={radius} stroke="rgba(255,255,255,0.06)" strokeWidth="3" fill="none"/>
      <circle cx={size/2} cy={size/2} r={radius} stroke={accent} strokeWidth="3" fill="none"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.6s ease" }}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ fill: "#E8EAF0", fontSize: "11px", fontWeight: "600", fontFamily: "'JetBrains Mono', monospace", transform: "rotate(90deg)", transformOrigin: `${size/2}px ${size/2}px` }}>
        {score.toFixed(1)}
      </text>
    </svg>
  );
}

const LABEL_STYLES = {
  green: { bg: "rgba(61,214,140,0.12)", color: "#3DD68C", border: "rgba(61,214,140,0.2)" },
  amber: { bg: "rgba(200,135,58,0.12)", color: "#C8873A", border: "rgba(200,135,58,0.2)" },
  red: { bg: "rgba(255,85,85,0.12)", color: "#FF5555", border: "rgba(255,85,85,0.2)" },
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
        out.push(<strong key={`${baseKey}-${key++}`} style={{ color: "#F0F2F8", fontWeight: 600 }}>{text.slice(i + 2, end)}</strong>);
        i = end + 2;
        plainStart = i;
        continue;
      }
    } else if (text[i] === "*") {
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && end > i + 1 && text[end + 1] !== "*" && text[end - 1] !== " ") {
        if (i > plainStart) out.push(<span key={`${baseKey}-${key++}`}>{text.slice(plainStart, i)}</span>);
        out.push(<em key={`${baseKey}-${key++}`} style={{ fontStyle: "italic", color: "rgba(255,255,255,0.88)" }}>{text.slice(i + 1, end)}</em>);
        i = end + 1;
        plainStart = i;
        continue;
      }
    } else if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1 && end > i + 1) {
        if (i > plainStart) out.push(<span key={`${baseKey}-${key++}`}>{text.slice(plainStart, i)}</span>);
        out.push(<code key={`${baseKey}-${key++}`} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.92em", padding: "1px 5px", borderRadius: "4px", background: "rgba(255,255,255,0.07)", color: "#E8EAF0" }}>{text.slice(i + 1, end)}</code>);
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
    if (b.type === "hr") return <div key={b.key} style={{ height: "1px", background: "rgba(255,255,255,0.08)", margin: "10px 0 8px" }} />;
    if (b.type === "h2") {
      return (
        <div key={b.key} style={{
          fontSize: "14px",
          fontWeight: 700,
          color: "#F0F2F8",
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
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      background: `rgba(${accentRgb},0.025)`,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: result || error ? "14px" : "0" }}>
        <div style={{
          fontSize: "10px",
          letterSpacing: "0.13em",
          color: "rgba(255,255,255,0.4)",
          fontWeight: 600,
          textTransform: "uppercase",
        }}>
          Capital Allocation
        </div>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "7px",
          padding: "5px 11px",
          transition: "border-color 0.15s",
        }}>
          <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", fontFamily: "'JetBrains Mono', monospace" }}>$</span>
          <input
            type="text"
            inputMode="numeric"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value.replace(/[^0-9]/g, ""))}
            style={{
              background: "transparent",
              border: "none",
              color: "#F0F2F8",
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
            color: "rgba(255,255,255,0.3)",
            letterSpacing: "0.05em",
            fontStyle: "italic",
          }}>
            computing…
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: "12px", color: "#FF5555" }}>Error: {error}</div>
      )}

      {result && !error && (
        <div style={{ display: "flex", gap: "16px", alignItems: "stretch", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "260px", display: "flex", flexWrap: "wrap", gap: "7px", alignItems: "center" }}>
            {result.selected.length === 0 ? (
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", fontStyle: "italic" }}>
                No deployable subset within this budget — try a larger amount.
              </span>
            ) : (
              result.selected.map((sel) => {
                const trustColors = sel.trustTier === "CAUTION"
                  ? { bg: "rgba(200,135,58,0.14)", color: "#C8873A", border: "rgba(200,135,58,0.28)" }
                  : { bg: "rgba(61,214,140,0.14)", color: "#3DD68C", border: "rgba(61,214,140,0.28)" };
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
                    <span style={{ fontSize: "11.5px", color: "#F0F2F8", fontWeight: 500 }}>
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
            borderLeft: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
            alignSelf: "center",
          }}>
            <AllocStat label="Deployed" value={fmtUsd(result.totalCost)} color={accent}/>
            <AllocStat label="Profit"   value={`+${fmtUsd(result.expectedDollarProfit)}`} color="#3DD68C"/>
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
    none: "rgba(255,255,255,0.5)",
    countered: accent,
    rejected: "#FF5555",
    accepted: "#3DD68C",
    stalled: "#C8873A",
  };

  const btn = (disabled, primary) => ({
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.03em",
    padding: "7px 11px",
    borderRadius: "6px",
    background: primary
      ? `rgba(${accentRgb},0.12)`
      : "rgba(255,255,255,0.04)",
    border: primary
      ? `1px solid rgba(${accentRgb},0.28)`
      : "1px solid rgba(255,255,255,0.1)",
    color: primary ? accent : "rgba(255,255,255,0.7)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    whiteSpace: "nowrap",
    transition: "all 0.12s",
  });

  const dangerBtn = (disabled) => ({
    ...btn(disabled, false),
    color: "rgba(255,85,85,0.75)",
    border: "1px solid rgba(255,85,85,0.22)",
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
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.05)",
          borderRadius: "7px",
          marginBottom: "8px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "11px",
          color: "rgba(255,255,255,0.55)",
        }}>
          <span>
            Last offer:{" "}
            <span style={{ color: "#E8EAF0", fontWeight: 600 }}>
              {currentState.lastOfferSent != null
                ? `$${currentState.lastOfferSent.toLocaleString("en-US")}`
                : "—"}
            </span>
          </span>
          <span>
            Response:{" "}
            <span style={{
              color: responseColors[currentState.sellerResponse] || "rgba(255,255,255,0.5)",
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
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "6px",
          overflow: "hidden",
        }}>
          <span style={{
            display: "flex",
            alignItems: "center",
            padding: "0 0 0 10px",
            color: "rgba(255,255,255,0.4)",
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
              color: "#F0F2F8",
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
          color: "#FF5555",
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
  color: "rgba(255,255,255,0.2)",
  marginBottom: "6px",
  fontWeight: "600",
};

function AllocStat({ label, value, color }) {
  return (
    <div>
      <div style={{
        fontSize: "9px",
        letterSpacing: "0.13em",
        color: "rgba(255,255,255,0.32)",
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

/**
 * @param {object} props
 * @param {import("../lib/types").DecisionItem[] | null} [props.realEstateItems]
 * @param {import("../lib/types").DecisionItem[] | null} [props.watchesItems]
 */
export default function App({ realEstateItems = null, watchesItems = null }) {
  const { user, logout } = useSession();
  const allowedModules = useMemo(
    () => Object.values(MODULES).filter(m => user?.modules?.includes(m.id)),
    [user]
  );
  const [activeModuleId, setActiveModuleId] = useState(
    () => allowedModules[0]?.id || "real-estate"
  );
  const [activeNavId, setActiveNavId] = useState("list");
  const [aiOpen, setAiOpen] = useState(true);
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
    const style = document.createElement("style");
    style.textContent = FONTS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

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

  const contextLabel = module.id === "saas"
    ? "Ask AI about this account"
    : module.id === "trading"
    ? "Ask AI about this trade"
    : "Ask AI about this deal";

  return (
    <div style={S.root}>
      <nav style={S.nav}>
        <div style={S.navBrand}>
          <div style={S.brandMark}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <polygon points="11,2 20,7 20,15 11,20 2,15 2,7" stroke={module.accent} strokeWidth="1.5" fill="none"/>
              <polygon points="11,6 16,9 16,13 11,16 6,13 6,9" fill={module.accent} opacity="0.15"/>
              <circle cx="11" cy="11" r="2" fill={module.accent}/>
            </svg>
          </div>
          <div>
            <div style={S.brandName}>APEX</div>
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
                <Icon size={15} color={active ? module.accent : "rgba(255,255,255,0.35)"}/>
                <span style={{ color: active ? "#E8EAF0" : "rgba(255,255,255,0.35)", fontSize: "13px", fontWeight: active ? "500" : "400" }}>{n.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{
          marginTop: "auto",
          padding: "12px 16px 8px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name}</div>
            <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{user?.id}</div>
          </div>
          <button onClick={logout} style={{
            fontSize: "10px",
            padding: "5px 8px",
            borderRadius: "5px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.55)",
            cursor: "pointer",
            letterSpacing: "0.05em",
            flexShrink: 0,
          }}>SIGN OUT</button>
        </div>

        <div style={S.navFooter}>
          <div style={S.onlineDot}/>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>System operational</span>
        </div>
      </nav>

      <div style={S.main}>
        <header style={S.topBar}>
          <div style={{ minWidth: 0, maxWidth: "640px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px", flexWrap: "wrap" }}>
              <div style={S.moduleTitle}>{module.label}</div>
              <div style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.35)",
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {module.items.length} {module.items.length === 1 ? "ITEM" : "ITEMS"}
              </div>
            </div>
            <div style={{
              ...S.moduleTagline,
              maxWidth: "560px",
              marginTop: "6px",
            }}>
              {module.explanation || module.tagline}
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

        <div style={{ ...S.itemList, opacity: transitioning ? 0 : 1, transform: transitioning ? "translateY(10px)" : "translateY(0)", transition: "opacity 0.28s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
          <div style={S.listHeader}>
            <span style={S.listHeaderLabel}>RANK</span>
            <span style={S.listHeaderLabel}>OPPORTUNITY</span>
            <span style={S.listHeaderLabel}>SIGNAL</span>
            <span style={S.listHeaderLabel}>SCORE</span>
            <span style={S.listHeaderLabel}>STATUS</span>
          </div>

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
                color: "#F0F2F8",
                marginBottom: "10px",
                letterSpacing: "-0.01em",
              }}>
                {(user?.geo?.length === 0 && module.id === "real-estate")
                  ? "No geography configured"
                  : module.id === "watches"
                  ? "Your portfolio is empty"
                  : "Your pipeline is empty"}
              </div>
              <div style={{
                fontSize: "12.5px",
                color: "rgba(255,255,255,0.42)",
                maxWidth: "360px",
                margin: "0 auto",
                lineHeight: 1.65,
              }}>
                {(user?.geo?.length === 0 && module.id === "real-estate")
                  ? "Set a target ZIP code on this account to start sourcing off-market deals."
                  : module.id === "watches"
                  ? "Add your first watch to data/watches.json to start scoring it."
                  : "New opportunities will appear here as they're indexed."}
              </div>
            </div>
          )}

          {module.items.map((item, i) => {
            const selected = selectedItem?.id === item.id;
            const isRejected = item.trustTier === "REJECTED";
            const isTopPick = !isRejected && i === 0 && item.labelType === "green";
            return (
              <div key={item.id}>
                <button
                  onClick={() => setSelectedItem(selected ? null : item)}
                  style={{
                    ...S.itemRow(selected, module.accent, isTopPick),
                    ...(isRejected && !selected ? {
                      opacity: 0.55,
                      background: "rgba(255,85,85,0.05)",
                      border: "1px solid rgba(255,85,85,0.22)",
                      boxShadow: "none",
                    } : {}),
                  }}
                >
                  <span style={{ ...S.rank, ...(isTopPick ? { color: module.accent, fontWeight: 700 } : {}) }}>#{i + 1}</span>
                  <div style={S.itemMeta}>
                    <div style={S.itemTitle}>{item.title}</div>
                    <div style={S.itemSub}>{item.sub}</div>
                    {module.id === "saas" && (
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "3px", letterSpacing: "0.01em", lineHeight: 1.3 }}>
                        {getSaasSignal(item)}
                      </div>
                    )}
                  </div>
                  <div style={S.itemTag(module.accent)}>{item.tag || "—"}</div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <ScoreRing score={item.score} accent={module.accent} size={48}/>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px" }}>
                    <div style={S.labelBadge(item.labelType)}>{item.label}</div>
                    {item.trustTier && (
                      <div style={S.trustBadge(item.trustTier)}>
                        {item.trustTier === "SOFT_REJECT" ? "REVIEW" : item.trustTier}
                      </div>
                    )}
                  </div>
                </button>

                {selected && (
                  <div style={S.detailPanel(module.accent)}>
                    <div style={S.detailGrid}>
                      {Object.entries({
                        [module.id === "trading" ? "Price" : module.id === "saas" ? "ARR" : module.id === "watches" ? "Price" : "ARV"]: item.arv,
                        [module.id === "trading" ? "Rel.Str." : module.id === "saas" ? "Expansion" : module.id === "watches" ? "Market" : "MAO"]: item.mao,
                        [module.id === "trading" ? "Price" : module.id === "saas" ? "Status" : module.id === "watches" ? "Margin" : "Asking"]: item.ask,
                        [module.id === "watches" ? "Liquidity" : "Risk"]: item.risk,
                      }).map(([k, v]) => (
                        <div key={k} style={S.detailStat}>
                          <div style={S.detailStatLabel}>{k}</div>
                          <div style={S.detailStatValue}>{v ?? "—"}</div>
                        </div>
                      ))}
                    </div>
                    {item.trustScore != null && (() => {
                      const tierColorMap = {
                        TRUSTED: "#3DD68C",
                        CAUTION: "#C8873A",
                        SOFT_REJECT: "#FF5555",
                        REJECTED: "#FF5555",
                      };
                      const tierColor = tierColorMap[item.trustTier] || "rgba(255,255,255,0.4)";
                      const reasons = item.trustReasons || [];
                      return (
                        <div style={S.detailSection}>
                          <div style={S.detailSectionLabel}>TRUST ANALYSIS</div>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                            padding: "11px 14px",
                            background: "rgba(255,255,255,0.025)",
                            border: "1px solid rgba(255,255,255,0.05)",
                            borderRadius: "7px",
                            marginBottom: reasons.length > 0 ? "8px" : 0,
                          }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: "2px", flexShrink: 0 }}>
                              <span style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: "22px",
                                fontWeight: 600,
                                color: tierColor,
                                letterSpacing: "-0.01em",
                                lineHeight: 1,
                              }}>{item.trustScore}</span>
                              <span style={{
                                fontFamily: "'JetBrains Mono', monospace",
                                fontSize: "10px",
                                color: "rgba(255,255,255,0.3)",
                              }}>/100</span>
                            </div>
                            <div style={S.trustBadge(item.trustTier)}>
                              {item.trustTier === "SOFT_REJECT" ? "REVIEW" : item.trustTier}
                            </div>
                            <div style={{
                              flex: 1,
                              height: "4px",
                              borderRadius: "2px",
                              background: "rgba(255,255,255,0.06)",
                              overflow: "hidden",
                              minWidth: "40px",
                            }}>
                              <div style={{
                                width: `${item.trustScore}%`,
                                height: "100%",
                                background: tierColor,
                                transition: "width 0.4s ease",
                              }}/>
                            </div>
                          </div>
                          {reasons.length > 0 && (
                            <div style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "5px",
                              padding: "10px 14px",
                              background: "rgba(255,255,255,0.02)",
                              border: "1px solid rgba(255,255,255,0.05)",
                              borderRadius: "7px",
                            }}>
                              {reasons.map((r, ri) => (
                                <div key={ri} style={{
                                  fontSize: "12px",
                                  color: "rgba(255,255,255,0.62)",
                                  display: "flex",
                                  gap: "9px",
                                  lineHeight: 1.5,
                                }}>
                                  <span style={{ color: tierColor, flexShrink: 0 }}>•</span>
                                  <span>{r}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {item.platformMetrics && (
                      <div style={S.detailSection}>
                        <div style={S.detailSectionLabel}>PLATFORM METRICS</div>
                        <div style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: "11px",
                          color: "rgba(255,255,255,0.62)",
                          lineHeight: 1.75,
                          padding: "10px 13px",
                          background: "rgba(255,255,255,0.025)",
                          border: "1px solid rgba(255,255,255,0.05)",
                          borderRadius: "7px",
                          whiteSpace: "pre-line",
                        }}>
                          {item.platformMetrics}
                        </div>
                      </div>
                    )}
                    {item.thesis && (
                      <div style={S.detailSection}>
                        <div style={S.detailSectionLabel}>WHY THIS MATTERS</div>
                        <div style={{
                          fontSize: "13px",
                          color: "rgba(255,255,255,0.68)",
                          lineHeight: 1.6,
                          padding: "11px 13px",
                          background: "rgba(255,255,255,0.025)",
                          border: "1px solid rgba(255,255,255,0.05)",
                          borderRadius: "7px",
                        }}>
                          {item.thesis}
                        </div>
                      </div>
                    )}
                    <div style={S.detailSection}>
                      <div style={S.detailSectionLabel}>RECOMMENDED ACTION</div>
                      <div style={S.detailAction(module.accent)}>
                        {item.nextAction || "No recommendation available yet"}
                      </div>
                    </div>
                    {item.acquisitionPlan && item.labelType !== "red" && (() => {
                      const plan = item.acquisitionPlan;
                      const styleColorMap = {
                        Aggressive: "#3DD68C",
                        Confident: "#3DD68C",
                        Balanced: module.accent,
                        Patient: "#C8873A",
                        "Walk-ready": "#FF5555",
                      };
                      const urgencyMap = {
                        "act-now":    { label: "ACT NOW",    color: "#3DD68C" },
                        "this-week":  { label: "THIS WEEK",  color: module.accent },
                        "this-month": { label: "THIS MONTH", color: "#C8873A" },
                        "passive":    { label: "PASSIVE",    color: "rgba(255,255,255,0.5)" },
                      };
                      const priorityMap = {
                        anchor:    { label: "ANCHOR",    color: "#3DD68C" },
                        core:      { label: "CORE",      color: module.accent },
                        satellite: { label: "SATELLITE", color: "#C8873A" },
                        skip:      { label: "SKIP",      color: "#FF5555" },
                      };
                      const styleColor = styleColorMap[plan.negotiationStyle] || module.accent;
                      const urg = urgencyMap[plan.urgency] || urgencyMap.passive;
                      const pri = priorityMap[plan.capitalPriority] || priorityMap.satellite;
                      const fmt = (n) => `$${(n ?? 0).toLocaleString("en-US")}`;
                      const microLabel = { fontSize: "9px", letterSpacing: "0.13em", color: "rgba(255,255,255,0.32)", fontWeight: 600, textTransform: "uppercase", marginBottom: "4px" };
                      const pill = (color) => ({
                        fontSize: "9px",
                        fontWeight: 700,
                        letterSpacing: "0.11em",
                        padding: "4px 9px",
                        borderRadius: "5px",
                        background: `${color}1A`,
                        color,
                        border: `1px solid ${color}55`,
                        whiteSpace: "nowrap",
                        textTransform: "uppercase",
                      });
                      return (
                        <div style={S.detailSection}>
                          <div style={S.detailSectionLabel}>ACQUISITION PLAN</div>

                          {/* Card 1 — price ladder + style + urgency */}
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "20px",
                            padding: "12px 14px",
                            background: "rgba(255,255,255,0.025)",
                            border: "1px solid rgba(255,255,255,0.05)",
                            borderRadius: "7px",
                            marginBottom: "8px",
                            flexWrap: "wrap",
                          }}>
                            <div>
                              <div style={microLabel}>Opening</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "16px", fontWeight: 600, color: module.accent, letterSpacing: "-0.005em" }}>{fmt(plan.openingOffer)}</div>
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "14px", lineHeight: 1 }}>→</div>
                            <div>
                              <div style={microLabel}>Target</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "16px", fontWeight: 600, color: "#F0F2F8", letterSpacing: "-0.005em" }}>{fmt(plan.targetBuy)}</div>
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "14px", lineHeight: 1 }}>→</div>
                            <div>
                              <div style={microLabel}>Ceiling</div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "16px", fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "-0.005em" }}>{fmt(plan.hardCeiling)}</div>
                            </div>
                            <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                              <div style={pill(styleColor)}>{plan.negotiationStyle}</div>
                              <div style={pill(urg.color)}>{urg.label}</div>
                            </div>
                          </div>

                          {/* Card 2 — strategy (reasoning + counter) */}
                          <div style={{
                            padding: "11px 14px",
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.05)",
                            borderRadius: "7px",
                            marginBottom: "8px",
                          }}>
                            <div style={{
                              fontSize: "12.5px",
                              color: "rgba(255,255,255,0.62)",
                              lineHeight: 1.6,
                              marginBottom: "8px",
                            }}>
                              {plan.negotiationReasoning}
                            </div>
                            <div style={{
                              fontSize: "12px",
                              color: "rgba(255,255,255,0.55)",
                              lineHeight: 1.55,
                              paddingTop: "8px",
                              borderTop: "1px solid rgba(255,255,255,0.05)",
                            }}>
                              <span style={{ color: module.accent, fontWeight: 600 }}>Counter: </span>
                              {plan.counterStrategy}
                            </div>
                          </div>

                          {/* Card 3 — likely objections (only when present) */}
                          {plan.likelyObjections && plan.likelyObjections.length > 0 && (
                            <div style={{
                              padding: "10px 14px",
                              background: "rgba(255,255,255,0.02)",
                              border: "1px solid rgba(255,255,255,0.05)",
                              borderRadius: "7px",
                              marginBottom: "8px",
                            }}>
                              <div style={{ fontSize: "9px", letterSpacing: "0.13em", color: "rgba(255,255,255,0.4)", fontWeight: 600, textTransform: "uppercase", marginBottom: "8px" }}>
                                Likely seller objections
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                                {plan.likelyObjections.map((obj, oi) => (
                                  <div key={oi} style={{
                                    fontSize: "12px",
                                    color: "rgba(255,255,255,0.62)",
                                    display: "flex",
                                    gap: "9px",
                                    lineHeight: 1.5,
                                  }}>
                                    <span style={{ color: module.accent, flexShrink: 0 }}>•</span>
                                    <span>{obj}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Card 4 — operator footer (hold + exit + priority + walk-away) */}
                          <div style={{
                            padding: "11px 14px",
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.05)",
                            borderRadius: "7px",
                          }}>
                            <div style={{
                              display: "flex",
                              gap: "20px",
                              alignItems: "center",
                              flexWrap: "wrap",
                              marginBottom: plan.exitReasoning ? "8px" : "0",
                            }}>
                              <div>
                                <div style={microLabel}>Hold</div>
                                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "14px", fontWeight: 600, color: "#E8EAF0" }}>~{plan.estimatedHoldDays}d</div>
                              </div>
                              <div style={{ flex: 1, minWidth: "200px" }}>
                                <div style={microLabel}>Exit</div>
                                <div style={{ fontSize: "12px", color: "#E8EAF0", fontWeight: 500, lineHeight: 1.4 }}>{plan.exitPlatform}</div>
                              </div>
                              <div style={{ marginLeft: "auto" }}>
                                <div style={pill(pri.color)}>{pri.label}</div>
                              </div>
                            </div>
                            {plan.exitReasoning && (
                              <div style={{
                                fontSize: "11.5px",
                                color: "rgba(255,255,255,0.5)",
                                lineHeight: 1.5,
                                marginBottom: "8px",
                              }}>
                                {plan.exitReasoning}
                              </div>
                            )}
                            {plan.walkAwayTrigger && (
                              <div style={{
                                fontSize: "12px",
                                color: "rgba(255,255,255,0.55)",
                                lineHeight: 1.55,
                                paddingTop: "8px",
                                borderTop: "1px solid rgba(255,255,255,0.05)",
                              }}>
                                <span style={{ color: "#FF5555", fontWeight: 600 }}>Walk away: </span>
                                {plan.walkAwayTrigger}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    {item.acquisitionPlan && item.labelType !== "red" && (
                      <NegotiationControls
                        itemId={String(item.id)}
                        openingOffer={item.acquisitionPlan.openingOffer}
                        currentState={item.negotiationState ?? null}
                        accent={module.accent}
                        accentRgb={module.accentRgb}
                      />
                    )}
                    <div style={S.detailSection}>
                      <div style={S.detailSectionLabel}>RISK FACTORS</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {(item.riskFactors && item.riskFactors.length > 0) ? (
                          item.riskFactors.map((r, ri) => (
                            <div key={ri} style={S.riskItem}>
                              <span style={{ color: "#FF5555", marginRight: "8px" }}>▲</span>{r}
                            </div>
                          ))
                        ) : (
                          <div style={{ ...S.riskItem, color: "rgba(255,255,255,0.35)", fontStyle: "italic" }}>
                            No risk factors recorded
                          </div>
                        )}
                      </div>
                    </div>
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
        </div>
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
                <div style={S.aiEmptyTitle}>Ready to analyze</div>
                <div style={S.aiEmptySub}>Ask anything about your {module.label.toLowerCase()} data, or click an item to get context-aware insights.</div>
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
                  background: "rgba(255,255,255,0.035)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "9px",
                }}>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {[0, 1, 2].map(d => (
                      <div key={d} style={{ width: "5px", height: "5px", borderRadius: "50%", background: module.accent, animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${d * 0.2}s` }}/>
                    ))}
                  </div>
                  <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.42)", letterSpacing: "0.02em" }}>Analyzing</span>
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
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 6px; transition: background 0.2s; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
        textarea:focus {
          outline: none;
          border-color: rgba(255,255,255,0.22) !important;
          background: rgba(255,255,255,0.05) !important;
        }
        textarea::placeholder { color: rgba(255,255,255,0.22); }
        button { cursor: pointer; border: none; background: none; }
      `}</style>
    </div>
  );
}

function styles(accent, accentRgb) {
  return {
    root: {
      display: "flex",
      height: "100vh",
      background: "#080910",
      color: "#E8EAF0",
      fontFamily: "'DM Sans', sans-serif",
      overflow: "hidden",
    },
    nav: {
      width: "224px",
      flexShrink: 0,
      background: "#0A0B10",
      borderRight: "1px solid rgba(255,255,255,0.05)",
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
      padding: "20px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
    },
    brandMark: { flexShrink: 0 },
    brandName: {
      fontFamily: "'Syne', sans-serif",
      fontWeight: "800",
      fontSize: "15px",
      letterSpacing: "0.08em",
      color: "#E8EAF0",
    },
    brandSub: { fontSize: "10px", color: "rgba(255,255,255,0.25)", letterSpacing: "0.05em" },
    moduleSection: { padding: "16px 12px 8px" },
    sectionLabel: {
      fontSize: "9px",
      letterSpacing: "0.12em",
      color: "rgba(255,255,255,0.2)",
      fontWeight: "600",
      padding: "0 4px",
      marginBottom: "6px",
    },
    moduleBtn: (active, ac) => ({
      display: "flex",
      alignItems: "center",
      gap: "10px",
      width: "100%",
      padding: "8px 8px",
      borderRadius: "8px",
      background: active ? `rgba(${accentRgb},0.08)` : "transparent",
      border: active ? `1px solid rgba(${accentRgb},0.15)` : "1px solid transparent",
      cursor: "pointer",
      position: "relative",
      marginBottom: "3px",
      transition: "all 0.15s ease",
    }),
    moduleAbbr: (active, ac) => ({
      width: "30px",
      height: "30px",
      borderRadius: "7px",
      background: active ? ac : "rgba(255,255,255,0.06)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "9px",
      fontWeight: "700",
      fontFamily: "'JetBrains Mono', monospace",
      color: active ? "#080910" : "rgba(255,255,255,0.35)",
      flexShrink: 0,
      transition: "all 0.15s ease",
    }),
    moduleBtnLabel: (active) => ({
      fontSize: "12px",
      fontWeight: active ? "500" : "400",
      color: active ? "#E8EAF0" : "rgba(255,255,255,0.45)",
      lineHeight: 1.2,
    }),
    moduleBtnSub: {
      fontSize: "10px",
      color: "rgba(255,255,255,0.2)",
      marginTop: "1px",
    },
    activeIndicator: (ac) => ({
      position: "absolute",
      right: "8px",
      width: "5px",
      height: "5px",
      borderRadius: "50%",
      background: ac,
    }),
    navBtn: (active) => ({
      display: "flex",
      alignItems: "center",
      gap: "8px",
      width: "100%",
      padding: "7px 8px",
      borderRadius: "6px",
      background: active ? "rgba(255,255,255,0.04)" : "transparent",
      marginBottom: "2px",
      transition: "background 0.1s",
    }),
    navFooter: {
      marginTop: "auto",
      padding: "16px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      borderTop: "1px solid rgba(255,255,255,0.04)",
    },
    onlineDot: {
      width: "6px",
      height: "6px",
      borderRadius: "50%",
      background: "#3DD68C",
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
      padding: "22px 28px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      background: "#080910",
      flexShrink: 0,
    },
    moduleTitle: {
      fontFamily: "'Syne', sans-serif",
      fontSize: "23px",
      fontWeight: "700",
      letterSpacing: "-0.018em",
      color: "#F0F2F8",
    },
    moduleTagline: { fontSize: "12px", color: "rgba(255,255,255,0.36)", marginTop: "4px", letterSpacing: "0.01em" },
    topBarRight: { display: "flex", alignItems: "center", gap: "10px" },
    refreshBadge: {
      fontSize: "9px",
      fontWeight: "700",
      letterSpacing: "0.1em",
      padding: "3px 7px",
      borderRadius: "4px",
      background: "rgba(61,214,140,0.12)",
      color: "#3DD68C",
      border: "1px solid rgba(61,214,140,0.2)",
    },
    aiToggleBtn: (open, ac) => ({
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "7px 12px",
      borderRadius: "7px",
      background: open ? `rgba(${accentRgb},0.12)` : "rgba(255,255,255,0.04)",
      border: `1px solid ${open ? `rgba(${accentRgb},0.25)` : "rgba(255,255,255,0.08)"}`,
      color: open ? ac : "rgba(255,255,255,0.4)",
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.15s",
    }),
    metricsRow: {
      display: "flex",
      gap: "12px",
      padding: "20px 28px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      flexShrink: 0,
    },
    metricCard: {
      flex: 1,
      padding: "16px 16px 16px 18px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)",
      borderLeft: `2px solid rgba(${accentRgb},0.55)`,
      borderRadius: "10px",
    },
    metricLabel: { fontSize: "10px", color: "rgba(255,255,255,0.32)", letterSpacing: "0.1em", marginBottom: "8px", textTransform: "uppercase" },
    metricValue: (ac) => ({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "26px",
      fontWeight: "600",
      color: ac,
      letterSpacing: "-0.01em",
    }),
    itemList: {
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
      padding: "20px 28px 28px",
    },
    listHeader: {
      display: "grid",
      gridTemplateColumns: "36px 1fr 100px 60px 110px",
      padding: "0 16px 12px",
      gap: "12px",
    },
    listHeaderLabel: {
      fontSize: "9px",
      letterSpacing: "0.12em",
      color: "rgba(255,255,255,0.22)",
      fontWeight: "600",
    },
    itemRow: (selected, ac, isTopPick) => ({
      display: "grid",
      gridTemplateColumns: "36px 1fr 100px 60px 110px",
      alignItems: "center",
      gap: "12px",
      width: "100%",
      padding: "16px 16px",
      background: selected
        ? `rgba(${accentRgb},0.07)`
        : isTopPick
        ? `rgba(${accentRgb},0.045)`
        : "rgba(255,255,255,0.02)",
      border: `1px solid ${
        selected
          ? `rgba(${accentRgb},0.22)`
          : isTopPick
          ? `rgba(${accentRgb},0.20)`
          : "rgba(255,255,255,0.04)"
      }`,
      borderRadius: selected ? "10px 10px 0 0" : "10px",
      cursor: "pointer",
      marginBottom: selected ? "0" : "8px",
      textAlign: "left",
      transition: "all 0.15s",
      ...(isTopPick && !selected
        ? { boxShadow: `0 0 0 1px rgba(${accentRgb},0.10), 0 8px 28px rgba(${accentRgb},0.10)` }
        : {}),
    }),
    rank: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "11px",
      color: "rgba(255,255,255,0.2)",
    },
    itemMeta: { display: "flex", flexDirection: "column", gap: "2px" },
    itemTitle: { fontSize: "14px", fontWeight: "600", color: "#F0F2F8", letterSpacing: "-0.005em" },
    itemSub: { fontSize: "12px", color: "rgba(255,255,255,0.3)" },
    itemTag: (ac) => ({
      fontSize: "10px",
      fontWeight: "600",
      padding: "3px 8px",
      borderRadius: "5px",
      background: `rgba(${accentRgb},0.1)`,
      color: ac,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap",
    }),
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
    trustBadge: (tier) => {
      const palette = {
        TRUSTED:     { bg: "rgba(61,214,140,0.10)", color: "#3DD68C", border: "rgba(61,214,140,0.22)" },
        CAUTION:     { bg: "rgba(200,135,58,0.10)", color: "#C8873A", border: "rgba(200,135,58,0.22)" },
        SOFT_REJECT: { bg: "rgba(255,85,85,0.10)",  color: "#FF5555", border: "rgba(255,85,85,0.22)" },
        REJECTED:    { bg: "rgba(255,85,85,0.14)",  color: "#FF5555", border: "rgba(255,85,85,0.34)" },
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
      background: `rgba(${accentRgb},0.03)`,
      border: `1px solid rgba(${accentRgb},0.15)`,
      borderTop: "none",
      borderRadius: "0 0 10px 10px",
      padding: "16px 14px",
      marginBottom: "6px",
    }),
    detailGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: "10px",
      marginBottom: "14px",
    },
    detailStat: {
      background: "rgba(255,255,255,0.03)",
      borderRadius: "6px",
      padding: "8px 10px",
    },
    detailStatLabel: { fontSize: "9px", color: "rgba(255,255,255,0.25)", letterSpacing: "0.08em", marginBottom: "4px" },
    detailStatValue: { fontSize: "14px", fontWeight: "500", fontFamily: "'JetBrains Mono', monospace", color: "#E8EAF0" },
    detailSection: { marginBottom: "12px" },
    detailSectionLabel: {
      fontSize: "9px",
      letterSpacing: "0.1em",
      color: "rgba(255,255,255,0.2)",
      marginBottom: "6px",
      fontWeight: "600",
    },
    detailAction: (ac) => ({
      fontSize: "14px",
      color: ac,
      fontWeight: "500",
      padding: "8px 10px",
      background: `rgba(${accentRgb},0.07)`,
      borderRadius: "6px",
      borderLeft: `2px solid ${ac}`,
    }),
    riskItem: {
      fontSize: "13px",
      color: "rgba(255,255,255,0.5)",
      display: "flex",
      alignItems: "center",
    },
    askAiBtn: (ac) => ({
      display: "flex",
      alignItems: "center",
      gap: "6px",
      marginTop: "12px",
      padding: "7px 12px",
      borderRadius: "6px",
      background: `rgba(${accentRgb},0.1)`,
      border: `1px solid rgba(${accentRgb},0.2)`,
      color: ac,
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
    }),
    aiPanel: (ac) => ({
      width: "380px",
      flexShrink: 0,
      background: "#0A0B10",
      borderLeft: "1px solid rgba(255,255,255,0.05)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }),
    aiHeader: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "16px 16px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      flexShrink: 0,
    },
    aiHeaderLeft: { display: "flex", alignItems: "center", gap: "8px" },
    aiPulse: (ac) => ({
      width: "7px",
      height: "7px",
      borderRadius: "50%",
      background: ac,
      animation: "blink 2s ease-in-out infinite",
    }),
    aiHeaderTitle: {
      fontFamily: "'Syne', sans-serif",
      fontSize: "13px",
      fontWeight: "700",
      letterSpacing: "0.05em",
      color: "#E8EAF0",
    },
    aiModuleTag: (ac) => ({
      fontSize: "9px",
      fontWeight: "700",
      letterSpacing: "0.1em",
      padding: "3px 7px",
      borderRadius: "4px",
      background: `rgba(${accentRgb},0.12)`,
      color: ac,
      border: `1px solid rgba(${accentRgb},0.2)`,
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
      background: `rgba(${accentRgb},0.1)`,
      border: `1px solid rgba(${accentRgb},0.2)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: ac,
      marginBottom: "12px",
    }),
    aiEmptyTitle: { fontSize: "14px", fontWeight: "500", color: "#E8EAF0", marginBottom: "6px" },
    aiEmptySub: { fontSize: "12px", color: "rgba(255,255,255,0.3)", lineHeight: "1.5" },
    aiSuggestion: (ac) => ({
      width: "100%",
      padding: "8px 10px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "7px",
      color: "rgba(255,255,255,0.5)",
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
      color: ac,
    }),
    aiMessageText: (role) => ({
      fontSize: "14px",
      lineHeight: "1.62",
      color: role === "user" ? "rgba(255,255,255,0.78)" : "#DCDFE7",
      background: role === "user" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.035)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "9px",
      padding: "11px 13px",
      whiteSpace: "pre-wrap",
    }),
    aiInputArea: (ac) => ({
      padding: "14px",
      borderTop: "1px solid rgba(255,255,255,0.05)",
      display: "flex",
      gap: "10px",
      alignItems: "flex-end",
      flexShrink: 0,
    }),
    aiTextarea: {
      flex: 1,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "9px",
      color: "#E8EAF0",
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
      background: disabled ? "rgba(255,255,255,0.04)" : `rgba(${accentRgb},0.18)`,
      border: `1px solid ${disabled ? "rgba(255,255,255,0.06)" : `rgba(${accentRgb},0.35)`}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: disabled ? "rgba(255,255,255,0.2)" : ac,
      cursor: disabled ? "not-allowed" : "pointer",
      flexShrink: 0,
      transition: "all 0.15s",
    }),
  };
}
