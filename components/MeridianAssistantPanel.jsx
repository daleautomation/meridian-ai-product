"use client";

// Meridian — right-side AI Assistant rail.
//
// Lives next to the calendar grid. Receives the currently-selected
// lead (calendar task) and exposes a chat surface that POSTs to the
// existing /api/ai/chat endpoint. Quick-prompt chips seed common
// operator questions ("Better opener", "Objection help", etc.).
//
// No external API is called from this file directly — the network
// call goes through the existing route which already wraps Claude.
// If the route is unavailable, the panel surfaces the error and
// keeps the chat usable for the next try.

import { useEffect, useMemo, useRef, useState } from "react";
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
  { id: "opener",     label: "Better opener",        prompt: "Give me a stronger opener for this lead — direct and specific to the evidence." },
  { id: "objection",  label: "Objection help",       prompt: "What objection should I expect on this call, and how should I respond?" },
  { id: "research",   label: "Research checklist",   prompt: "Give me a 5-item research checklist for this company before I dial." },
  { id: "followup",   label: "Follow-up email",      prompt: "Draft a short, premium follow-up email for after the call." },
  { id: "close",      label: "Closing angle",        prompt: "What is the strongest closing angle for this lead given the evidence?" },
  { id: "patience",   label: "Patience tips",        prompt: "Give me 3 patience tips before I make this call so I stay calm and present." },
];

function buildLeadContext({ task, workspace, tradeLabel }) {
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
    workspaceSlug: workspace?.slug ?? "",
    moduleId: task?.tradeId ?? workspace?.defaultModule ?? "roofing",
    tradeLabel: trade,
    serviceBucket: service,
    address: task?.linkedLocation ?? null,
    bucket: task?.priority ?? "",
    score: closeScore,
    reason: scan?.qualificationReason ?? "",
    suggestedOpening: scan?.salesAngle?.opener ?? task?.suggestedOpeningLine ?? "",
    website: task?.website ?? task?.domain ?? null,
    phone: undefined, // never put the raw number in the prompt body
    phoneStatus,
    email: undefined, // never put the raw address in the prompt body
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
    salesStrategy: task?.salesStrategy ?? undefined,
    scanIssues: Array.isArray(scan?.evidence) ? scan.evidence.slice(0, 5) : [],
    weakSignals: [
      task?.phone ? null : "No verified phone",
      emailStatus === "verified" ? null : "No verified email",
    ].filter(Boolean),
  };
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

export default function MeridianAssistantPanel({
  task,
  workspace,
  tradeLabel,
  collapsed = false,
  // Optional. When supplied, the header chevron renders an explicit
  // "Expand" / "Collapse" affordance instead of the closed-state
  // collapse-to-rail glyph. The drawer passes this in deep state so
  // the user can grow the Assistant into a larger working surface
  // without changing rail mode.
  expanded,
  onToggleCollapsed,
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Local conversation history — operator-only state, not persisted.
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  // Reset thread when the operator selects a different lead. Keeps
  // context tight and avoids cross-lead contamination.
  const taskKey = task?.id ?? null;
  useEffect(() => {
    setMessages([]);
    setError(null);
    setInput("");
  }, [taskKey]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const context = useMemo(
    () => buildLeadContext({ task, workspace, tradeLabel }),
    [task, workspace, tradeLabel],
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

  if (collapsed) {
    // Collapsed rail — one rotated content row.
    //
    // The trick: the OUTER aside is a vertical pill (~52px wide, tall).
    // The INNER content row is laid out HORIZONTALLY ([M] [text]) and
    // then rotated -90° as a single unit. This way:
    //   • the icon never deforms (rotation is on the parent),
    //   • the text reads cleanly bottom-to-top without letter stacking,
    //   • icon + text stay perfectly aligned because they're flex
    //     siblings in a single un-rotated coordinate system.
    return (
      <aside
        onClick={onToggleCollapsed}
        role="button"
        tabIndex={0}
        aria-label="Expand Meridian Assistant"
        title="Expand Meridian Assistant"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapsed();
          }
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = PALETTE.bluePale;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        style={{
          // Layout-neutral. The drawer cell owns the surface
          // (background, border, radius, shadow). This rail just
          // fills the cell and centers the rotated label.
          width: "100%",
          flexShrink: 0,
          alignSelf: "stretch",
          minHeight: 0,
          height: "100%",
          background: "transparent",
          border: "none",
          borderRadius: 0,
          boxShadow: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          cursor: "pointer",
          transition: "background 160ms ease",
          overflow: "visible",
        }}
      >
        <div
          style={{
            // Whole content row rotates as a unit. Origin = center so
            // the rotation is balanced inside the rail.
            display: "flex",
            alignItems: "center",
            gap: "10px",
            transform: "rotate(-90deg)",
            transformOrigin: "center",
            whiteSpace: "nowrap",
            padding: "10px 12px",
          }}
        >
          {/* Brand "M" emblem — matches the global header logo
              exactly. Sits as a flex sibling of the text so they
              share the same baseline before rotation. */}
          <div
            aria-hidden="true"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "7px",
              background: PALETTE.blue,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              fontWeight: 700,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            M
          </div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: PALETTE.textSecondary,
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            Meridian Assistant
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside style={{
      // Layout-neutral. The drawer cell owns surface (background,
      // border, radius, shadow). This panel fills the cell and lays
      // out its own header / messages / input internally.
      width: "100%",
      flexShrink: 0,
      alignSelf: "stretch",
      height: "100%",
      minHeight: 0,
      background: "transparent",
      border: "none",
      borderRadius: 0,
      boxShadow: "none",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <header style={{
        padding: "14px 16px 12px",
        borderBottom: `1px solid ${PALETTE.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "10px",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          {/* Brand "M" emblem — matches the global header logo
              exactly so the assistant reads as a first-class surface,
              not a plugin. */}
          <div
            aria-hidden="true"
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "7px",
              background: PALETTE.blue,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            M
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: "10px", fontWeight: 900, letterSpacing: "0.16em",
              color: PALETTE.blue, textTransform: "uppercase",
            }}>
              Meridian Assistant
            </div>
            <div style={{
              fontSize: "13px", fontWeight: 700, color: PALETTE.textPrimary,
              marginTop: "2px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {task ? (task.linkedCompany ?? task.title ?? "Selected lead") : "No lead selected"}
            </div>
          </div>
        </div>
        {typeof expanded === "boolean" ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={expanded ? "Collapse Meridian Assistant" : "Expand Meridian Assistant"}
            title={expanded ? "Collapse" : "Expand"}
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: PALETTE.blue,
              background: PALETTE.bluePale,
              border: `1px solid rgba(37,99,235,0.30)`,
              borderRadius: "999px",
              padding: "5px 10px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">{expanded ? "▾" : "▴"}</span>
            <span>{expanded ? "Collapse" : "Expand"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse Meridian Assistant"
            title="Collapse"
            style={{
              fontSize: "16px",
              color: PALETTE.muted,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ›
          </button>
        )}
      </header>

      {/* Quick prompts */}
      <div style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${PALETTE.borderSoft}`,
        display: "flex",
        flexWrap: "wrap",
        gap: "6px",
        flexShrink: 0,
      }}>
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => send(q.prompt)}
            disabled={!task || busy}
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: !task || busy ? PALETTE.muted : PALETTE.blue,
              background: !task || busy ? PALETTE.borderSoft : PALETTE.bluePale,
              border: !task || busy
                ? `1px solid ${PALETTE.border}`
                : `1px solid rgba(37,99,235,0.30)`,
              borderRadius: "999px",
              padding: "5px 10px",
              cursor: !task || busy ? "not-allowed" : "pointer",
            }}
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: "12px 14px",
          background: PALETTE.pageBg,
        }}
      >
        {!task ? (
          // Default execution-guidance card — never sits empty. Reads
          // as the day's playbook so the assistant always adds value
          // even before a lead is selected.
          <div
            role="region"
            aria-label="Today's execution guidance"
            style={{
              padding: "12px 14px",
              borderRadius: "10px",
              background: "linear-gradient(180deg, rgba(37,99,235,0.07) 0%, rgba(37,99,235,0.02) 100%)",
              border: `1px solid rgba(37,99,235,0.22)`,
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div style={{
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.12em",
              color: PALETTE.blue,
              textTransform: "uppercase",
            }}>
              Meridian · Default guidance
            </div>
            <div style={{
              fontSize: "14px",
              fontWeight: 700,
              color: PALETTE.textPrimary,
              lineHeight: 1.3,
            }}>
              Today&apos;s execution guidance
            </div>
            <ul style={{
              margin: 0,
              padding: "0 0 0 18px",
              listStyle: "disc",
              display: "flex",
              flexDirection: "column",
              gap: "5px",
              fontSize: "12px",
              color: PALETTE.textSecondary,
              lineHeight: 1.45,
            }}>
              <li>Start with Day 1 leads.</li>
              <li>Focus on high-priority opportunities.</li>
              <li>Adjust messaging based on responses.</li>
            </ul>
            <div style={{
              fontSize: "11px",
              color: PALETTE.muted,
              lineHeight: 1.4,
              fontStyle: "italic",
              borderTop: `1px dashed rgba(37,99,235,0.22)`,
              paddingTop: "8px",
            }}>
              Select a lead on the calendar to brief Meridian on a specific call.
            </div>
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
          padding: "10px 12px",
          borderTop: `1px solid ${PALETTE.border}`,
          background: PALETTE.cardBg,
          display: "flex",
          gap: "8px",
          alignItems: "center",
          flexShrink: 0,
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
            padding: "9px 11px",
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
            padding: "9px 14px",
            cursor: !task || busy || !input.trim() ? "not-allowed" : "pointer",
            letterSpacing: "0.02em",
          }}
        >
          Send
        </button>
      </form>
      {error ? (
        <div style={{
          padding: "6px 14px 10px", fontSize: "11px",
          color: PALETTE.muted, fontStyle: "italic",
          flexShrink: 0,
        }}>
          {error}
        </div>
      ) : null}
    </aside>
  );
}
