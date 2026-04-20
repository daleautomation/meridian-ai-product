"use client";

// Meridian AI — Operator Console.
//
// Minimal execution surface over MCP. Renders three panels: CALL NOW,
// TODAY, pending reviews. Mutations go through /api/mcp with the session
// cookie — no direct imports of engine internals on the client.
//
// Design language matches the rest of Meridian (inline styles, palette
// tokens from lib/theme). Kept intentionally compact; this is an operator
// console, not a dashboard.

import { useState } from "react";
import { palette, brand } from "../lib/theme";
import MeridianMark from "./MeridianMark";

// ── MCP bridge (session-authed) ────────────────────────────────────────

async function callMcp(name, args) {
  const res = await fetch("/api/mcp", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "tools/call", params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP ${name} → HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "MCP error");
  if (json.result?.error) throw new Error(json.result.error);
  return json.result;
}

// ── Sub-components ─────────────────────────────────────────────────────

function CompanyCard({ decision, user, onReviewCreated }) {
  const [pitch, setPitch] = useState(null);
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState(null);
  const [reviewState, setReviewState] = useState("idle"); // idle | creating | created

  async function handleGeneratePitch() {
    setPitchLoading(true);
    setPitchError(null);
    try {
      const res = await callMcp("generate_pitch", {
        company: { name: decision.name, domain: decision.domain },
        channel: "call",
      });
      setPitch(res.data);
    } catch (e) {
      setPitchError(e.message);
    } finally {
      setPitchLoading(false);
    }
  }

  async function handleRequestReview() {
    setReviewState("creating");
    try {
      await callMcp("create_review", {
        kind: "outreach",
        subjectKey: decision.key,
        subjectLabel: decision.name,
        payload: {
          pitch: pitch ?? null,
          score: decision.score,
          recommendedAction: decision.recommendedAction,
          topWeaknesses: decision.topWeaknesses,
        },
        requestedBy: user.id,
      });
      setReviewState("created");
      onReviewCreated?.();
    } catch (e) {
      setPitchError(e.message);
      setReviewState("idle");
    }
  }

  const levelColor =
    decision.opportunityLevel === "HIGH"
      ? palette.cyan
      : decision.opportunityLevel === "MEDIUM"
      ? palette.cream
      : palette.slateBlue;

  const stale = decision.staleDays;

  return (
    <div style={S.card}>
      <div style={S.cardHeader}>
        <div>
          <div style={S.cardTitle}>{decision.name}</div>
          {decision.domain && <div style={S.cardSub}>{decision.domain}</div>}
        </div>
        <div style={S.cardScoreBox}>
          <div style={{ ...S.levelPill, color: levelColor, borderColor: levelColor }}>
            {decision.opportunityLevel}
          </div>
          <div style={S.score}>{decision.score}</div>
        </div>
      </div>

      <div style={S.metaRow}>
        <span style={S.metaKey}>Action</span>
        <span style={S.metaVal}>{decision.recommendedAction}</span>
      </div>
      <div style={S.metaRow}>
        <span style={S.metaKey}>Close</span>
        <span style={S.metaVal}>{decision.closeProbability}</span>
      </div>
      <div style={S.metaRow}>
        <span style={S.metaKey}>Confidence</span>
        <span style={S.metaVal}>{decision.confidenceFloor}/100</span>
      </div>
      <div style={S.metaRow}>
        <span style={S.metaKey}>Last checked</span>
        <span style={S.metaVal}>{stale === null ? "never" : `${stale}d ago`}</span>
      </div>

      {decision.topWeaknesses?.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionLabel}>Evidence</div>
          <ul style={S.list}>
            {decision.topWeaknesses.slice(0, 4).map((w) => (
              <li key={w} style={S.listItem}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={S.rationale}>{decision.rationale}</div>

      <div style={S.actionRow}>
        <button onClick={handleGeneratePitch} disabled={pitchLoading} style={S.btnPrimary}>
          {pitchLoading ? "Composing…" : pitch ? "Regenerate pitch" : "Generate pitch"}
        </button>
        <button
          onClick={handleRequestReview}
          disabled={reviewState !== "idle"}
          style={{ ...S.btnSecondary, opacity: reviewState === "created" ? 0.6 : 1 }}
        >
          {reviewState === "created" ? "Review requested ✓" : "Request outreach review"}
        </button>
      </div>

      {pitchError && <div style={S.error}>{pitchError}</div>}

      {pitch && (
        <div style={S.pitchBox}>
          <div style={S.sectionLabel}>Pitch — {pitch.channel}</div>
          <div style={S.pitchLine}><b>Opening:</b> {pitch.opening}</div>
          <div style={S.pitchLine}><b>Body:</b> {pitch.body}</div>
          <div style={S.pitchLine}><b>Next step:</b> {pitch.nextStep}</div>
          {pitch.anchoredWeaknesses?.length > 0 && (
            <div style={S.pitchMeta}>
              Anchored: {pitch.anchoredWeaknesses.join(" · ")}
            </div>
          )}
          {pitch.knowledgeUsed?.length > 0 && (
            <div style={S.pitchMeta}>
              Knowledge: {pitch.knowledgeUsed.map((k) => k.title).join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewRow({ review, user, onResolved }) {
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);

  async function resolve(decision) {
    setWorking(true);
    setErr(null);
    try {
      await callMcp("resolve_review", { id: review.id, decision, resolvedBy: user.id });
      onResolved?.();
    } catch (e) {
      setErr(e.message);
      setWorking(false);
    }
  }

  return (
    <div style={S.reviewRow}>
      <div style={{ flex: 1 }}>
        <div style={S.reviewKind}>{review.kind.toUpperCase()}</div>
        <div style={S.reviewSubject}>{review.subjectLabel}</div>
        <div style={S.reviewMeta}>
          by {review.requestedBy} · {new Date(review.createdAt).toLocaleString()}
        </div>
      </div>
      <div style={S.reviewActions}>
        <button onClick={() => resolve("APPROVED")} disabled={working} style={S.btnApprove}>
          Approve
        </button>
        <button onClick={() => resolve("REJECTED")} disabled={working} style={S.btnReject}>
          Reject
        </button>
      </div>
      {err && <div style={S.error}>{err}</div>}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────

export default function OperatorConsole({ user, callNow, today, pendingReviews, totalPipeline }) {
  const [reviews, setReviews] = useState(pendingReviews);

  async function refreshReviews() {
    try {
      const res = await callMcp("list_pending_reviews", { status: "PENDING", limit: 20 });
      setReviews(res.data?.reviews ?? []);
    } catch {
      /* ignore — leave list as-is */
    }
  }

  return (
    <div style={S.root}>
      <nav style={S.nav}>
        <a href="/" style={S.navBrand}>
          <MeridianMark size={24} color={palette.cobalt} bg={palette.lightBg} />
          <span style={S.navName}>{brand.name}</span>
        </a>
        <div style={S.navRight}>
          <a href="/dashboard" style={S.navLink}>Dashboard</a>
          <span style={S.navUser}>{user.name}</span>
        </div>
      </nav>

      <header style={S.header}>
        <div style={S.sectionLabel}>Operator Console</div>
        <h1 style={S.title}>What to do right now</h1>
        <div style={S.headerMeta}>
          {callNow.length} CALL NOW · {today.length} TODAY · {reviews.length} pending reviews · {totalPipeline} pipeline
        </div>
      </header>

      <section style={S.panel}>
        <div style={S.panelTitle}>
          <span style={{ color: palette.cyan }}>●</span> CALL NOW
        </div>
        {callNow.length === 0 ? (
          <div style={S.empty}>No CALL NOW opportunities. Run refresh_company or save_company_snapshot to populate.</div>
        ) : (
          <div style={S.grid}>
            {callNow.map((d) => (
              <CompanyCard key={d.key} decision={d} user={user} onReviewCreated={refreshReviews} />
            ))}
          </div>
        )}
      </section>

      <section style={S.panel}>
        <div style={S.panelTitle}>TODAY</div>
        {today.length === 0 ? (
          <div style={S.empty}>Nothing ranked TODAY.</div>
        ) : (
          <div style={S.grid}>
            {today.map((d) => (
              <CompanyCard key={d.key} decision={d} user={user} onReviewCreated={refreshReviews} />
            ))}
          </div>
        )}
      </section>

      <section style={S.panel}>
        <div style={S.panelTitle}>Pending reviews</div>
        {reviews.length === 0 ? (
          <div style={S.empty}>No pending reviews.</div>
        ) : (
          <div style={S.reviewList}>
            {reviews.map((r) => (
              <ReviewRow key={r.id} review={r} user={user} onResolved={refreshReviews} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Styles (inline, palette-consistent) ────────────────────────────────

const S = {
  root: {
    minHeight: "100vh",
    background: palette.midnight,
    color: palette.textPrimary,
    fontFamily: "'DM Sans', sans-serif",
  },
  nav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 32px",
    borderBottom: `1px solid ${palette.textDim}`,
  },
  navBrand: { display: "flex", alignItems: "center", gap: "10px", textDecoration: "none", color: palette.textPrimary },
  navName: { fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: "16px", letterSpacing: "0.02em" },
  navRight: { display: "flex", alignItems: "center", gap: "20px" },
  navLink: { color: palette.textSecondary, fontSize: "13px", textDecoration: "none" },
  navUser: { color: palette.textTertiary, fontSize: "13px", fontFamily: "JetBrains Mono, monospace" },

  header: { padding: "40px 32px 20px" },
  sectionLabel: {
    fontSize: "11px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: palette.textTertiary,
    marginBottom: "8px",
  },
  title: { fontFamily: "Syne, sans-serif", fontSize: "32px", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" },
  headerMeta: { marginTop: "10px", fontSize: "13px", color: palette.textSecondary, fontFamily: "JetBrains Mono, monospace" },

  panel: { padding: "24px 32px 16px" },
  panelTitle: {
    fontFamily: "Syne, sans-serif",
    fontSize: "15px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  empty: { color: palette.textTertiary, fontSize: "13px", fontStyle: "italic" },

  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "16px" },

  card: {
    background: palette.surface,
    border: `1px solid ${palette.textDim}`,
    borderRadius: "8px",
    padding: "18px",
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" },
  cardTitle: { fontFamily: "Syne, sans-serif", fontWeight: 600, fontSize: "17px" },
  cardSub: { color: palette.textTertiary, fontSize: "12px", fontFamily: "JetBrains Mono, monospace", marginTop: "2px" },
  cardScoreBox: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" },
  levelPill: {
    fontSize: "10px",
    letterSpacing: "0.1em",
    padding: "3px 8px",
    border: "1px solid",
    borderRadius: "3px",
    fontWeight: 600,
  },
  score: { fontFamily: "JetBrains Mono, monospace", fontSize: "20px", fontWeight: 500 },

  metaRow: { display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "3px 0" },
  metaKey: { color: palette.textTertiary },
  metaVal: { color: palette.textPrimary, fontFamily: "JetBrains Mono, monospace" },

  section: { marginTop: "12px" },
  list: { margin: "4px 0 0", paddingLeft: "16px", fontSize: "12px", color: palette.textSecondary },
  listItem: { padding: "2px 0" },

  rationale: {
    marginTop: "12px",
    padding: "10px",
    background: palette.deepSurface,
    borderRadius: "4px",
    fontSize: "12px",
    color: palette.textSecondary,
    fontStyle: "italic",
  },

  actionRow: { display: "flex", gap: "8px", marginTop: "14px" },
  btnPrimary: {
    flex: 1,
    background: palette.cyan,
    color: palette.midnight,
    border: "none",
    padding: "10px 12px",
    borderRadius: "4px",
    fontFamily: "DM Sans, sans-serif",
    fontWeight: 600,
    fontSize: "12px",
    cursor: "pointer",
  },
  btnSecondary: {
    flex: 1,
    background: "transparent",
    color: palette.textPrimary,
    border: `1px solid ${palette.textDim}`,
    padding: "10px 12px",
    borderRadius: "4px",
    fontFamily: "DM Sans, sans-serif",
    fontWeight: 500,
    fontSize: "12px",
    cursor: "pointer",
  },
  error: { marginTop: "8px", color: "#ff9a9a", fontSize: "12px" },

  pitchBox: {
    marginTop: "14px",
    padding: "12px",
    background: palette.nightIndigo,
    borderRadius: "4px",
    border: `1px solid ${palette.textDim}`,
  },
  pitchLine: { fontSize: "13px", color: palette.textPrimary, margin: "6px 0", lineHeight: 1.5 },
  pitchMeta: { fontSize: "11px", color: palette.textTertiary, marginTop: "6px", fontFamily: "JetBrains Mono, monospace" },

  reviewList: { display: "flex", flexDirection: "column", gap: "8px" },
  reviewRow: {
    display: "flex",
    alignItems: "center",
    background: palette.surface,
    border: `1px solid ${palette.textDim}`,
    borderRadius: "6px",
    padding: "12px 14px",
    gap: "12px",
    flexWrap: "wrap",
  },
  reviewKind: { fontSize: "10px", letterSpacing: "0.1em", color: palette.cyan, fontWeight: 600 },
  reviewSubject: { fontSize: "14px", fontWeight: 500, marginTop: "2px" },
  reviewMeta: { fontSize: "11px", color: palette.textTertiary, marginTop: "2px", fontFamily: "JetBrains Mono, monospace" },
  reviewActions: { display: "flex", gap: "8px" },
  btnApprove: {
    background: palette.cyan,
    color: palette.midnight,
    border: "none",
    padding: "8px 14px",
    borderRadius: "4px",
    fontFamily: "DM Sans, sans-serif",
    fontWeight: 600,
    fontSize: "12px",
    cursor: "pointer",
  },
  btnReject: {
    background: "transparent",
    color: palette.textPrimary,
    border: `1px solid ${palette.textDim}`,
    padding: "8px 14px",
    borderRadius: "4px",
    fontFamily: "DM Sans, sans-serif",
    fontWeight: 500,
    fontSize: "12px",
    cursor: "pointer",
  },
};
