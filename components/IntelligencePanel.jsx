"use client";

// Meridian — Intelligence Panel.
//
// ONE unified surface that replaces both the old "Deep Report" panel
// and the standalone Assistant rail. Reads as: top half = structured
// insight (what's wrong, why, evidence, action). Bottom half = AI
// assistant (chips + chat + composer). Single surface, single scroll
// owner: the .intel-scroll wrapper inside the panel cell.
//
// Open / close is owned by the parent drawer — this component renders
// content only. The parent supplies onBack / onClose.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getLaborTechServiceFit,
  buildServiceFitBreakdown,
} from "../lib/scan/serviceFit";
import { getLeadIntelligence } from "../lib/intelligence/leadIntelligence";
import { resolveLeadQualityDisplay } from "../lib/display/leadQuality";

const PALETTE = {
  pageBg:        "#F8FAFC",
  cardBg:        "#FFFFFF",
  border:        "#E2E8F0",
  borderSoft:    "#F1F5F9",
  textPrimary:   "#0F172A",
  textSecondary: "#475569",
  muted:         "#94A3B8",
  blue:          "#2563EB",
  bluePale:      "#EEF4FF",
  green:         "#16A34A",
};

const QUICK_PROMPTS = [
  // The "services" chip is rendered locally (no /api/ai/chat round-
  // trip) — its prompt field is unused. AssistantSection intercepts
  // the id and injects the deterministic breakdown directly into
  // the chat. Other chips behave as before.
  { id: "services",   label: "Services needed",      prompt: "" },
  { id: "opener",     label: "Better opener",        prompt: "Give me a stronger opener for this lead — direct and specific to the evidence." },
  { id: "objection",  label: "Objection help",       prompt: "What objection should I expect on this call, and how should I respond?" },
  { id: "close",      label: "Closing angle",        prompt: "What is the strongest closing angle for this lead given the evidence?" },
  { id: "followup",   label: "Follow-up email",      prompt: "Draft a short, premium follow-up email for after the call." },
];

// ── Data helpers ────────────────────────────────────────────────────

function buildLeadContext({ task, tradeLabel }) {
  if (!task) return null;
  const scan = task?.laborTechScan ?? null;
  const company = task?.linkedCompany ?? task?.title ?? "(unknown)";
  const trade = task?.tradeLabel ?? tradeLabel ?? null;
  const service = scan?.primaryService ?? task?.serviceShortLabel ?? task?.serviceBucketLabel ?? null;
  const phoneStatus = task?.phone ? "verified" : "missing";
  const emailStatus = task?.emailStatus ?? (task?.email ? "verified" : "not_searched");
  const quality = resolveLeadQualityDisplay(task);
  const closeScore = quality.isUnknown ? null : quality.value;
  return {
    companyName: company,
    moduleId: task?.tradeId ?? "roofing",
    tradeLabel: trade,
    serviceBucket: service,
    address: task?.linkedLocation ?? null,
    bucket: task?.priority ?? "",
    score: closeScore,
    reason: scan?.qualificationReason ?? "",
    suggestedOpening: scan?.salesAngle?.opener ?? task?.suggestedOpeningLine ?? "",
    website: task?.website ?? task?.domain ?? null,
    phoneStatus,
    emailStatus,
    primaryPain: scan?.primaryPain ?? null,
    painLevel: scan?.painLevel ?? null,
    evidence: Array.isArray(scan?.evidence) ? scan.evidence.slice(0, 5) : [],
    businessImpact: Array.isArray(scan?.businessImpact) ? scan.businessImpact.slice(0, 3) : [],
    salesAngle: scan?.salesAngle ?? null,
    closeabilityLabel: quality.isUnknown ? "Incomplete" : (scan?.closeability?.label ?? null),
    closeabilityScore: closeScore,
    urgency: scan?.urgency?.label ?? null,
    recommendedAction: scan?.recommendedAction ?? null,
    deepReportSummary: scan?.reportSummary ?? null,
  };
}

function deriveKeyInsight(scan) {
  if (!scan) return null;
  if (typeof scan.headline === "string" && scan.headline.trim()) return scan.headline.trim();
  if (typeof scan.primaryPain === "string" && scan.primaryPain.trim()) return scan.primaryPain.trim();
  if (typeof scan.qualificationReason === "string" && scan.qualificationReason.trim()) return scan.qualificationReason.trim();
  if (Array.isArray(scan.evidence) && scan.evidence.length > 0) {
    const e0 = scan.evidence[0];
    if (typeof e0 === "string") return e0;
    if (e0 && typeof e0 === "object") return e0.statement ?? e0.text ?? e0.title ?? null;
  }
  return null;
}

function asBulletText(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return null;
  return item.statement ?? item.text ?? item.title ?? item.label ?? null;
}

// ── Subcomponents ───────────────────────────────────────────────────

function SectionHeader({ children }) {
  return (
    <div style={{
      fontSize: "10px",
      fontWeight: 800,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: PALETTE.blue,
      marginBottom: "8px",
    }}>
      {children}
    </div>
  );
}

function InsightBlock({ insight, company }) {
  if (!insight) return null;
  return (
    <section>
      <SectionHeader>What&apos;s costing them deals</SectionHeader>
      <p style={{
        margin: 0,
        fontSize: "16px",
        fontWeight: 700,
        lineHeight: 1.4,
        color: PALETTE.textPrimary,
        letterSpacing: "-0.005em",
      }}>
        {insight}
      </p>
      {company ? (
        <div style={{
          marginTop: "6px",
          fontSize: "11px",
          color: PALETTE.muted,
          fontStyle: "italic",
        }}>
          {company}
        </div>
      ) : null}
    </section>
  );
}

function WhyItMatters({ items }) {
  const bullets = (items ?? []).map(asBulletText).filter(Boolean).slice(0, 3);
  if (bullets.length === 0) return null;
  return (
    <section>
      <SectionHeader>How this hurts revenue</SectionHeader>
      <ul style={{
        margin: 0,
        padding: "0 0 0 18px",
        listStyle: "disc",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontSize: "13px",
        color: PALETTE.textSecondary,
        lineHeight: 1.5,
      }}>
        {bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </section>
  );
}

function EvidenceBlock({ items }) {
  const bullets = (items ?? []).map(asBulletText).filter(Boolean).slice(0, 5);
  if (bullets.length === 0) return null;
  return (
    <section>
      <SectionHeader>Proof</SectionHeader>
      <ul style={{
        margin: 0,
        padding: "0 0 0 18px",
        listStyle: "disc",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        fontSize: "12.5px",
        color: PALETTE.textPrimary,
        lineHeight: 1.5,
      }}>
        {bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </section>
  );
}

function ActionBlock({ scan }) {
  const action =
    (typeof scan?.recommendedAction === "string" && scan.recommendedAction.trim())
      ? scan.recommendedAction.trim()
      : (typeof scan?.salesAngle?.opener === "string" && scan.salesAngle.opener.trim())
        ? scan.salesAngle.opener.trim()
        : null;
  if (!action) return null;
  return (
    <section>
      <SectionHeader>What to do</SectionHeader>
      <div style={{
        padding: "12px 14px",
        background: PALETTE.bluePale,
        border: `1px solid rgba(37,99,235,0.30)`,
        borderRadius: "12px",
        fontSize: "13px",
        fontWeight: 600,
        color: PALETTE.textPrimary,
        lineHeight: 1.5,
      }}>
        {action}
      </div>
    </section>
  );
}

function ServicesNeededBreakdown({ task }) {
  const breakdown = useMemo(() => buildServiceFitBreakdown(task), [task]);
  if (breakdown.length === 0) return null;
  const tierTone = (tier) =>
    tier === "Strong" ? { fg: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" }
    : tier === "Medium" ? { fg: PALETTE.blue, bg: PALETTE.bluePale, border: "rgba(37,99,235,0.30)" }
    : { fg: PALETTE.textSecondary, bg: PALETTE.borderSoft, border: PALETTE.border };

  const labelRow = (label) => (
    <div style={{
      fontSize: "10px",
      fontWeight: 800,
      letterSpacing: "0.10em",
      textTransform: "uppercase",
      color: PALETTE.textSecondary,
      marginBottom: "4px",
    }}>{label}</div>
  );

  return (
    <section data-section="services-needed">
      <SectionHeader>Services needed breakdown</SectionHeader>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {breakdown.map((entry) => {
          const tone = tierTone(entry.tier);
          return (
            <article
              key={entry.serviceId}
              style={{
                padding: "14px 16px",
                background: PALETTE.cardBg,
                border: `1px solid ${PALETTE.border}`,
                borderLeft: `3px solid ${tone.fg}`,
                borderRadius: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {/* Header: NAME — SCORE (TIER FIT) */}
              <div style={{
                display: "flex",
                alignItems: "baseline",
                gap: "8px",
                flexWrap: "wrap",
              }}>
                <span style={{
                  fontSize: "14px",
                  fontWeight: 900,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: PALETTE.textPrimary,
                }}>
                  {entry.label} — {Math.round(entry.score)}
                </span>
                <span style={{
                  fontSize: "10px",
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  padding: "2px 9px",
                  borderRadius: "999px",
                  color: tone.fg,
                  background: tone.bg,
                  border: `1px solid ${tone.border}`,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}>
                  {entry.tierLabel}
                </span>
              </div>

              {/* Why — bullets, evidence-led + buyer psychology. */}
              <div>
                {labelRow("Why")}
                <ul style={{
                  margin: 0,
                  padding: "0 0 0 18px",
                  listStyle: "disc",
                  display: "flex",
                  flexDirection: "column",
                  gap: "3px",
                  fontSize: "12.5px",
                  color: PALETTE.textPrimary,
                  lineHeight: 1.5,
                }}>
                  {entry.whyBullets.map((b, i) => <li key={`why-${i}`}>{b}</li>)}
                </ul>
              </div>

              {/* Evidence — concrete signals. */}
              {entry.evidence.length > 0 ? (
                <div>
                  {labelRow("Evidence")}
                  <ul style={{
                    margin: 0,
                    padding: "0 0 0 18px",
                    listStyle: "'•  '",
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                    fontSize: "12.5px",
                    color: PALETTE.textSecondary,
                    lineHeight: 1.5,
                  }}>
                    {entry.evidence.map((e, i) => <li key={`ev-${i}`}>{e}</li>)}
                  </ul>
                </div>
              ) : null}

              {/* Pitch — quoted, blue card. */}
              <div>
                {labelRow("Pitch")}
                <div style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: PALETTE.textPrimary,
                  lineHeight: 1.5,
                  padding: "10px 12px",
                  background: PALETTE.bluePale,
                  border: `1px solid rgba(37,99,235,0.25)`,
                  borderRadius: "10px",
                }}>
                  “{entry.pitch}”
                </div>
              </div>

              {/* Objection Risk — buyer-thought line. */}
              <div>
                {labelRow("Objection Risk")}
                <div style={{
                  fontSize: "12.5px",
                  fontStyle: "italic",
                  color: PALETTE.textSecondary,
                  lineHeight: 1.5,
                  padding: "8px 10px",
                  background: PALETTE.borderSoft,
                  border: `1px solid ${PALETTE.border}`,
                  borderRadius: "8px",
                }}>
                  “{entry.objectionRisk}”
                </div>
              </div>

              {/* Counter — rebuttal line. */}
              <div>
                {labelRow("Counter")}
                <div style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "#15803D",
                  lineHeight: 1.5,
                  padding: "8px 10px",
                  background: "#F0FDF4",
                  border: `1px solid #BBF7D0`,
                  borderRadius: "8px",
                }}>
                  “{entry.counter}”
                </div>
              </div>

              {/* Priority — emoji + label. */}
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                alignSelf: "flex-start",
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "0.08em",
                color: tone.fg,
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                borderRadius: "999px",
                padding: "4px 11px",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              }}>
                <span aria-hidden="true">{entry.priorityIcon}</span>
                <span>{entry.priority}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ServiceFitBlock({ task }) {
  const fit = useMemo(() => getLaborTechServiceFit(task), [task]);
  if (!fit) return null;

  const primaryEvidence = fit.evidenceByService?.[fit.primaryService] ?? [];
  const confidenceTone =
    fit.confidence === "High"
      ? { fg: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" }
      : fit.confidence === "Medium"
        ? { fg: PALETTE.blue, bg: PALETTE.bluePale, border: "rgba(37,99,235,0.30)" }
        : { fg: PALETTE.textSecondary, bg: PALETTE.borderSoft, border: PALETTE.border };
  const primaryScore = fit.scores?.[fit.primaryService] ?? null;

  return (
    <section>
      <SectionHeader>Service fit</SectionHeader>

      {/* Primary offer */}
      <div style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "8px",
        marginBottom: "8px",
      }}>
        <span style={{
          fontSize: "14px",
          fontWeight: 800,
          color: PALETTE.textPrimary,
        }}>
          {fit.primaryServiceLabel}
        </span>
        <span style={{
          fontSize: "10px",
          fontWeight: 800,
          letterSpacing: "0.06em",
          padding: "3px 9px",
          borderRadius: "999px",
          color: confidenceTone.fg,
          background: confidenceTone.bg,
          border: `1px solid ${confidenceTone.border}`,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}>
          {fit.confidence}{typeof primaryScore === "number" ? ` · ${Math.round(primaryScore)}%` : ""} fit
        </span>
      </div>

      {/* Evidence for the primary service */}
      {primaryEvidence.length > 0 ? (
        <ul style={{
          margin: "0 0 10px 0",
          padding: "0 0 0 18px",
          listStyle: "disc",
          display: "flex",
          flexDirection: "column",
          gap: "5px",
          fontSize: "12.5px",
          color: PALETTE.textPrimary,
          lineHeight: 1.5,
        }}>
          {primaryEvidence.slice(0, 4).map((e, i) => <li key={`pe-${i}`}>{e}</li>)}
        </ul>
      ) : null}

      {/* Secondary offers — small chips */}
      {fit.secondaryServices.length > 0 ? (
        <div style={{ marginBottom: "10px" }}>
          <div style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.10em",
            color: PALETTE.textSecondary,
            textTransform: "uppercase",
            marginBottom: "5px",
          }}>
            Secondary offers
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
            {fit.secondaryServices.map((s, i) => (
              <span key={`sec-${i}`} style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                padding: "3px 9px",
                borderRadius: "999px",
                color: PALETTE.textSecondary,
                background: PALETTE.borderSoft,
                border: `1px solid ${PALETTE.border}`,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}>
                {s.label} · {Math.round(s.score)}%
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Best pitch path — tactical sequence */}
      {fit.pitchPath.length > 0 ? (
        <div>
          <div style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.10em",
            color: PALETTE.textSecondary,
            textTransform: "uppercase",
            marginBottom: "5px",
          }}>
            Best pitch path
          </div>
          <ol style={{
            margin: 0,
            padding: "0 0 0 18px",
            listStyle: "decimal",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            fontSize: "12.5px",
            color: PALETTE.textPrimary,
            lineHeight: 1.5,
          }}>
            {fit.pitchPath.map((step, i) => <li key={`pp-${i}`}>{step}</li>)}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function MessageBubble({ role, text }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: "8px",
    }}>
      <div style={{
        maxWidth: "85%",
        fontSize: "12.5px",
        lineHeight: 1.5,
        padding: "9px 12px",
        borderRadius: "12px",
        color: isUser ? "#FFFFFF" : PALETTE.textPrimary,
        background: isUser ? PALETTE.blue : PALETTE.cardBg,
        border: isUser ? `1px solid ${PALETTE.blue}` : `1px solid ${PALETTE.border}`,
        whiteSpace: "pre-wrap",
        boxShadow: isUser ? "0 4px 12px rgba(37,99,235,0.18)" : "0 1px 2px rgba(15,23,42,0.04)",
      }}>
        {text}
      </div>
    </div>
  );
}

function QuickActionChips({ disabled, onPick }) {
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
    }}>
      {QUICK_PROMPTS.map((q) => (
        <button
          key={q.id}
          type="button"
          onClick={() => onPick(q.id, q.prompt)}
          disabled={disabled}
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: disabled ? PALETTE.muted : PALETTE.blue,
            background: disabled ? PALETTE.borderSoft : PALETTE.bluePale,
            border: disabled
              ? `1px solid ${PALETTE.border}`
              : `1px solid rgba(37,99,235,0.30)`,
            borderRadius: "999px",
            padding: "5px 10px",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {q.label}
        </button>
      ))}
    </div>
  );
}

// Shared services-needed populator. Pure synthesis from existing
// scan + fit data — no /api/ai/chat round-trip, no AI cost. Used by:
//   • the Live Assist "Services needed" chip
//   • the Operator's "Break Down Services Needed →" button (via the
//     window event below)
// Always replaces any prior services-needed exchange so repeated
// clicks don't pile up duplicate spam in the chat history.
//
// MIGRATION: now reads through the canonical Lead Intelligence Layer
// (lib/intelligence/leadIntelligence.ts) — `assistantContext.servicesNeededPrompt`
// is precomputed via the same deterministic chat renderer, so the
// boundary is consistent with every other consumer that adopts the
// layer next.
function populateServicesNeeded(task, setMessages) {
  if (!task) return;
  const intelligence = getLeadIntelligence(task);
  const text = intelligence.assistantContext.servicesNeededPrompt;
  setMessages((prev) => {
    const filtered = prev.filter((m) => m?.kind !== "services-needed");
    return [
      ...filtered,
      { role: "user", text: "Services needed", kind: "services-needed" },
      { role: "assistant", text, kind: "services-needed" },
    ];
  });
}

function AssistantSection({ task, tradeLabel }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const taskKey = task?.id ?? null;
  useEffect(() => {
    setMessages([]);
    setError(null);
    setInput("");
  }, [taskKey]);

  // External trigger: the Operator's "Break Down Services Needed →"
  // button dispatches a window event when clicked. We listen here
  // and run the same populator the chip uses, so the assistant chat
  // is filled the instant Assist Mode opens — no second click, no
  // typing required. Re-fires safely thanks to populateServicesNeeded
  // de-duplicating on `kind === "services-needed"`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e) => {
      const targetId = e?.detail?.taskId;
      if (!task) return;
      // If a target id is supplied, ignore mismatched events so a
      // stale click on one lead never populates another lead's chat.
      if (targetId && task.id && targetId !== task.id) return;
      populateServicesNeeded(task, setMessages);
    };
    window.addEventListener("meridian:populate-services-needed", handler);
    return () => window.removeEventListener("meridian:populate-services-needed", handler);
  }, [task]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const context = useMemo(
    () => buildLeadContext({ task, tradeLabel }),
    [task, tradeLabel],
  );

  async function send(text) {
    const message = (text ?? "").trim();
    if (!message || busy || !task) return;
    setMessages((prev) => [...prev, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message, context }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.error || json?.fallback) {
        const errText = json?.error ?? "Assistant unavailable right now.";
        setError(errText);
        setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ ${errText}` }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", text: json?.response ?? "(no response)" }]);
      }
    } catch (err) {
      const errText = err instanceof Error ? err.message : "Network error";
      setError(errText);
      setMessages((prev) => [...prev, { role: "assistant", text: `⚠️ ${errText}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}>
      <SectionHeader>Live assist</SectionHeader>
      <QuickActionChips
        disabled={!task || busy}
        onPick={(id, prompt) => {
          // "Services needed" is a LOCAL synthesis — pulls the
          // breakdown from buildServiceFitBreakdown and renders it
          // straight into the chat. No network call, no cost. All
          // other chips behave as before (POST to /api/ai/chat).
          if (id === "services") {
            populateServicesNeeded(task, setMessages);
            return;
          }
          send(prompt);
        }}
      />

      {/* Chat window — fixed-height surface so the composer below it
          always stays anchored within the IntelligencePanel scroll. */}
      <div
        ref={scrollRef}
        style={{
          height: "260px",
          minHeight: "200px",
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "12px 14px",
          background: PALETTE.pageBg,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: "12px",
        }}
      >
        {!task ? (
          <div style={{ fontSize: "12px", color: PALETTE.textSecondary }}>
            Select a lead to brief Meridian on a specific call.
          </div>
        ) : messages.length === 0 && !busy ? (
          <div style={{ fontSize: "12px", color: PALETTE.textSecondary, lineHeight: 1.5 }}>
            Ask anything about this lead — the assistant has the company,
            trade, scan, and evidence in context.
          </div>
        ) : null}
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} text={m.text} />
        ))}
        {busy ? (
          <div style={{ fontSize: "11px", color: PALETTE.muted, fontStyle: "italic", padding: "4px 0" }}>
            Meridian is thinking…
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={task ? "Ask Meridian about this call…" : "Select a lead first"}
          disabled={!task || busy}
          style={{
            flex: 1,
            fontSize: "13px",
            padding: "10px 12px",
            borderRadius: "10px",
            border: `1px solid ${PALETTE.border}`,
            background: PALETTE.cardBg,
            color: PALETTE.textPrimary,
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!task || busy || !input.trim()}
          style={{
            fontSize: "12px",
            fontWeight: 800,
            color: "#fff",
            background: !task || busy || !input.trim() ? PALETTE.muted : PALETTE.blue,
            border: "none",
            borderRadius: "10px",
            padding: "10px 14px",
            cursor: !task || busy || !input.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          Send
        </button>
      </form>
      {error ? (
        <div style={{ fontSize: "11px", color: PALETTE.muted, fontStyle: "italic" }}>
          {error}
        </div>
      ) : null}
    </section>
  );
}

// ── Main panel ──────────────────────────────────────────────────────

export default function IntelligencePanel({ task, company, tradeLabel, onBack, onClose }) {
  // ESC closes.
  useEffect(() => {
    if (typeof window === "undefined" || typeof onClose !== "function") return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scan = task?.laborTechScan ?? null;
  const insight = useMemo(() => deriveKeyInsight(scan), [scan]);
  const displayName = company ?? task?.linkedCompany ?? task?.title ?? "Selected lead";

  return (
    <section
      role="region"
      aria-label="Intelligence Panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header — Assist Mode brand block. Reads: ASSIST MODE eyebrow,
          "Live deal intelligence" subtitle, lead name. Back and × are
          inline siblings, never absolute, never covering the title. */}
      <header style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "12px",
        padding: "14px 18px",
        borderBottom: `1px solid ${PALETTE.border}`,
        background: PALETTE.cardBg,
        flexShrink: 0,
      }}>
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
              background: PALETTE.bluePale,
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
        ) : <span />}
        <div style={{
          flex: 1,
          minWidth: 0,
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}>
          <div style={{
            fontSize: "10px",
            fontWeight: 900,
            letterSpacing: "0.18em",
            color: PALETTE.blue,
            textTransform: "uppercase",
          }}>
            Assist Mode
          </div>
          <div style={{
            fontSize: "11px",
            fontWeight: 700,
            color: PALETTE.textSecondary,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
          }}>
            How you close this deal
          </div>
          <div style={{
            fontSize: "13px",
            fontWeight: 700,
            color: PALETTE.textPrimary,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginTop: "2px",
          }}>
            {displayName}
          </div>
        </div>
        {typeof onClose === "function" ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Assist Mode"
            title="Close"
            style={{
              flexShrink: 0,
              marginTop: "2px",
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
        ) : <span />}
      </header>

      {/* Single scroll owner — body. Top half = structured insight,
          bottom half = AI assistant. No nested scrolls except the
          chat window's bounded message list. */}
      <div
        className="intel-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "18px 18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: "18px",
        }}
      >
        <InsightBlock insight={insight} company={tradeLabel ?? null} />
        <WhyItMatters items={scan?.businessImpact} />
        <EvidenceBlock items={scan?.evidence} />
        <ActionBlock scan={scan} />
        <ServiceFitBlock task={task} />
        <ServicesNeededBreakdown task={task} />

        {/* Divider */}
        <div style={{
          height: "1px",
          background: `linear-gradient(90deg, transparent 0%, ${PALETTE.border} 50%, transparent 100%)`,
          margin: "4px 0",
        }} />

        <AssistantSection task={task} tradeLabel={tradeLabel} />
      </div>
    </section>
  );
}
