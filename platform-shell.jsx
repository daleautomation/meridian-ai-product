import { useState, useRef, useEffect, useCallback } from "react";

const FONTS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@300;400;500&family=JetBrains+Mono:wght@400;500&display=swap');
`;

const MODULES = {
  "real-estate": {
    id: "real-estate",
    label: "Real Estate",
    abbr: "RE",
    tagline: "Acquisition Engine",
    accent: "#C8873A",
    accentRgb: "200,135,58",
    systemPrompt: `You are a sharp real estate acquisitions analyst embedded in a deal intelligence platform. The user is evaluating off-market residential deals in the Kansas City market. Speak with authority and precision — like an analyst who has underwritten 300+ deals. Use deal math (ARV, MAO, equity spread, rehab cost) naturally. Give direct, opinionated guidance. Be brief and actionable. Never be generic.`,
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
    accent: "#4A9EFF",
    accentRgb: "74,158,255",
    systemPrompt: `You are a client-facing revenue and solutions strategist embedded in a SaaS revenue intelligence platform. You analyze account health, expansion opportunity, churn risk, and engagement signals across a customer portfolio. Speak like a senior CSM or RevOps strategist who has managed $5M+ ARR books. Be direct, commercial, and strategic. Surface the moves that protect and grow revenue. Be brief and actionable.`,
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
    accent: "#3DD68C",
    accentRgb: "61,214,140",
    systemPrompt: `You are a disciplined momentum and risk analyst embedded in a trading intelligence platform. You analyze price momentum, volume patterns, technical signals, and risk metrics across a watchlist of equities and ETFs. Speak like a systematic trader with deep respect for risk management. Never make bold predictions — make probabilistic assessments. Cite signals, not opinions. Be brief and direct.`,
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

export default function App() {
  const [activeModuleId, setActiveModuleId] = useState("real-estate");
  const [activeNavId, setActiveNavId] = useState("list");
  const [aiOpen, setAiOpen] = useState(true);
  const [aiMessages, setAiMessages] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const module = MODULES[activeModuleId];

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
    setTransitioning(true);
    setSelectedItem(null);
    setTimeout(() => {
      setActiveModuleId(id);
      setAiMessages([]);
      setTransitioning(false);
    }, 200);
  }, [activeModuleId]);

  const sendAiMessage = useCallback(async () => {
    const text = aiInput.trim();
    if (!text || aiLoading) return;
    setAiInput("");
    const userMsg = { role: "user", content: text };
    const updatedMessages = [...aiMessages, userMsg];
    setAiMessages(updatedMessages);
    setAiLoading(true);
    try {
      const contextNote = selectedItem
        ? `\n\nCurrently selected item: ${selectedItem.title} — Score: ${selectedItem.score}, Status: ${selectedItem.label}, Next Action: "${selectedItem.nextAction}".`
        : "";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: module.systemPrompt + contextNote,
          messages: updatedMessages,
        }),
      });
      const data = await res.json();
      const reply = data.content?.map(b => b.text || "").join("") || "No response.";
      setAiMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Connection error. Check API access." }]);
    } finally {
      setAiLoading(false);
    }
  }, [aiInput, aiLoading, aiMessages, module, selectedItem]);

  const S = styles(module.accent, module.accentRgb);

  return (
    <div style={S.root}>
      {/* LEFT NAV */}
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
          {Object.values(MODULES).map(m => (
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

        <div style={S.navFooter}>
          <div style={S.onlineDot}/>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>System operational</span>
        </div>
      </nav>

      {/* MAIN */}
      <div style={S.main}>
        {/* TOP BAR */}
        <header style={S.topBar}>
          <div>
            <div style={S.moduleTitle}>{module.label}</div>
            <div style={S.moduleTagline}>{module.tagline} · {module.items.length} items ranked</div>
          </div>
          <div style={S.topBarRight}>
            <div style={S.refreshBadge}>LIVE</div>
            <button onClick={() => setAiOpen(o => !o)} style={S.aiToggleBtn(aiOpen, module.accent)}>
              <AIIcon size={16}/>
              <span>AI Panel</span>
            </button>
          </div>
        </header>

        {/* METRICS ROW */}
        <div style={S.metricsRow}>
          {module.metrics.map(m => (
            <div key={m.label} style={S.metricCard}>
              <div style={S.metricLabel}>{m.label}</div>
              <div style={S.metricValue(module.accent)}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* RANKED LIST */}
        <div style={{ ...S.itemList, opacity: transitioning ? 0 : 1, transform: transitioning ? "translateY(8px)" : "translateY(0)", transition: "opacity 0.2s, transform 0.2s" }}>
          <div style={S.listHeader}>
            <span style={S.listHeaderLabel}>RANK</span>
            <span style={S.listHeaderLabel}>OPPORTUNITY</span>
            <span style={S.listHeaderLabel}>SIGNAL</span>
            <span style={S.listHeaderLabel}>SCORE</span>
            <span style={S.listHeaderLabel}>STATUS</span>
          </div>

          {module.items.map((item, i) => {
            const selected = selectedItem?.id === item.id;
            return (
              <div key={item.id}>
                <button onClick={() => setSelectedItem(selected ? null : item)} style={S.itemRow(selected, module.accent)}>
                  <span style={S.rank}>#{i + 1}</span>
                  <div style={S.itemMeta}>
                    <div style={S.itemTitle}>{item.title}</div>
                    <div style={S.itemSub}>{item.sub}</div>
                  </div>
                  <div style={S.itemTag(module.accent)}>{item.tag}</div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <ScoreRing score={item.score} accent={module.accent}/>
                  </div>
                  <div style={S.labelBadge(item.labelType)}>{item.label}</div>
                </button>

                {selected && (
                  <div style={S.detailPanel(module.accent)}>
                    <div style={S.detailGrid}>
                      {Object.entries({ [module.id === "trading" ? "Price" : module.id === "saas" ? "ARR" : "ARV"]: item.arv, [module.id === "trading" ? "Rel.Str." : module.id === "saas" ? "Expansion" : "MAO"]: item.mao, [module.id === "trading" ? "Price" : module.id === "saas" ? "Status" : "Asking"]: item.ask, "Risk": item.risk }).map(([k, v]) => (
                        <div key={k} style={S.detailStat}>
                          <div style={S.detailStatLabel}>{k}</div>
                          <div style={S.detailStatValue}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={S.detailSection}>
                      <div style={S.detailSectionLabel}>RECOMMENDED ACTION</div>
                      <div style={S.detailAction(module.accent)}>{item.nextAction}</div>
                    </div>
                    <div style={S.detailSection}>
                      <div style={S.detailSectionLabel}>RISK FACTORS</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {item.riskFactors.map((r, ri) => (
                          <div key={ri} style={S.riskItem}><span style={{ color: "#FF5555", marginRight: "8px" }}>▲</span>{r}</div>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => { if (!aiOpen) setAiOpen(true); setAiInput(`Analyze this: ${item.title} — Score ${item.score}, ${item.nextAction}`); inputRef.current?.focus(); }}
                      style={S.askAiBtn(module.accent)}
                    >
                      <AIIcon size={13}/> Ask AI about this deal
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* AI SIDEBAR */}
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
                  {[ module.id === "real-estate" ? "Which deals have the best equity spread?" : module.id === "saas" ? "Which accounts are most at risk this quarter?" : "What's my highest conviction trade right now?",
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
                <div style={S.aiMessageText(m.role)}>{m.content}</div>
              </div>
            ))}

            {aiLoading && (
              <div style={S.aiMessage("assistant", module.accent)}>
                <div style={S.aiAssistantLabel(module.accent)}>ANALYST</div>
                <div style={{ display: "flex", gap: "4px", padding: "4px 0" }}>
                  {[0, 1, 2].map(d => <div key={d} style={{ width: "5px", height: "5px", borderRadius: "50%", background: module.accent, animation: "pulse 1.2s ease-in-out infinite", animationDelay: `${d * 0.2}s` }}/>)}
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
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        textarea:focus { outline: none; }
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
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    topBar: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "18px 24px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      background: "#080910",
      flexShrink: 0,
    },
    moduleTitle: {
      fontFamily: "'Syne', sans-serif",
      fontSize: "19px",
      fontWeight: "700",
      letterSpacing: "-0.01em",
      color: "#E8EAF0",
    },
    moduleTagline: { fontSize: "12px", color: "rgba(255,255,255,0.3)", marginTop: "2px" },
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
      color: open ? accent : "rgba(255,255,255,0.4)",
      fontSize: "12px",
      fontWeight: "500",
      cursor: "pointer",
      transition: "all 0.15s",
    }),
    metricsRow: {
      display: "flex",
      gap: "10px",
      padding: "14px 24px",
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      flexShrink: 0,
    },
    metricCard: {
      flex: 1,
      padding: "12px 14px",
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)",
      borderRadius: "8px",
    },
    metricLabel: { fontSize: "10px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.06em", marginBottom: "5px" },
    metricValue: (ac) => ({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "20px",
      fontWeight: "500",
      color: ac,
    }),
    itemList: {
      flex: 1,
      overflowY: "auto",
      padding: "16px 24px 24px",
    },
    listHeader: {
      display: "grid",
      gridTemplateColumns: "36px 1fr 100px 60px 110px",
      padding: "0 14px 8px",
      gap: "12px",
    },
    listHeaderLabel: {
      fontSize: "9px",
      letterSpacing: "0.1em",
      color: "rgba(255,255,255,0.2)",
      fontWeight: "600",
    },
    itemRow: (selected, ac) => ({
      display: "grid",
      gridTemplateColumns: "36px 1fr 100px 60px 110px",
      alignItems: "center",
      gap: "12px",
      width: "100%",
      padding: "12px 14px",
      background: selected ? `rgba(${accentRgb},0.06)` : "rgba(255,255,255,0.02)",
      border: `1px solid ${selected ? `rgba(${accentRgb},0.2)` : "rgba(255,255,255,0.04)"}`,
      borderRadius: selected ? "10px 10px 0 0" : "10px",
      cursor: "pointer",
      marginBottom: selected ? "0" : "6px",
      textAlign: "left",
      transition: "all 0.15s",
    }),
    rank: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "11px",
      color: "rgba(255,255,255,0.2)",
    },
    itemMeta: { display: "flex", flexDirection: "column", gap: "2px" },
    itemTitle: { fontSize: "13px", fontWeight: "500", color: "#E8EAF0" },
    itemSub: { fontSize: "11px", color: "rgba(255,255,255,0.3)" },
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
    labelBadge: (type) => ({
      fontSize: "9px",
      fontWeight: "700",
      letterSpacing: "0.08em",
      padding: "4px 8px",
      borderRadius: "5px",
      background: LABEL_STYLES[type].bg,
      color: LABEL_STYLES[type].color,
      border: `1px solid ${LABEL_STYLES[type].border}`,
      whiteSpace: "nowrap",
    }),
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
    detailStatValue: { fontSize: "13px", fontWeight: "500", fontFamily: "'JetBrains Mono', monospace", color: "#E8EAF0" },
    detailSection: { marginBottom: "12px" },
    detailSectionLabel: {
      fontSize: "9px",
      letterSpacing: "0.1em",
      color: "rgba(255,255,255,0.2)",
      marginBottom: "6px",
      fontWeight: "600",
    },
    detailAction: (ac) => ({
      fontSize: "13px",
      color: ac,
      fontWeight: "500",
      padding: "8px 10px",
      background: `rgba(${accentRgb},0.07)`,
      borderRadius: "6px",
      borderLeft: `2px solid ${ac}`,
    }),
    riskItem: {
      fontSize: "12px",
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
      width: "340px",
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
      fontSize: "8px",
      fontWeight: "700",
      letterSpacing: "0.12em",
      color: ac,
    }),
    aiMessageText: (role) => ({
      fontSize: "12px",
      lineHeight: "1.55",
      color: role === "user" ? "rgba(255,255,255,0.7)" : "#D0D3DC",
      background: role === "user" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "8px",
      padding: "10px 12px",
      whiteSpace: "pre-wrap",
    }),
    aiInputArea: (ac) => ({
      padding: "12px",
      borderTop: "1px solid rgba(255,255,255,0.05)",
      display: "flex",
      gap: "8px",
      alignItems: "flex-end",
      flexShrink: 0,
    }),
    aiTextarea: {
      flex: 1,
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      color: "#E8EAF0",
      fontSize: "12px",
      padding: "9px 10px",
      resize: "none",
      fontFamily: "'DM Sans', sans-serif",
      lineHeight: "1.5",
    },
    aiSendBtn: (ac, disabled) => ({
      width: "34px",
      height: "34px",
      borderRadius: "7px",
      background: disabled ? "rgba(255,255,255,0.04)" : `rgba(${accentRgb},0.15)`,
      border: `1px solid ${disabled ? "rgba(255,255,255,0.06)" : `rgba(${accentRgb},0.3)`}`,
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
