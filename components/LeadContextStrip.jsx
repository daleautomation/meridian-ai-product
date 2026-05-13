// Meridian — Lead Context Strip.
//
// One shared component rendered at the top of every lead detail surface
// (Today's SelectedLeadPanel, All Leads' LeadDetail, History's
// DealDetailPanel). Identical visual identity across all three tabs so
// the user reads the page as "this is the same lead in every view."
//
// Pure / presentational. No state, no fetches, no enum changes — just
// a display strip + a small status mapper for plain-business labels.

import { palette } from "../lib/theme";

// ── Display-status mapper ────────────────────────────────────────────
//
// Translates whatever internal status / signals the lead carries into
// one of the seven plain-business labels. Read-only — never mutates
// the underlying enum. Order matters: most specific → most generic.

const STATUS_TONES = {
  "New Lead":       { fg: "#1E3A8A", bg: "rgba(37,99,235,0.10)",  border: "rgba(37,99,235,0.30)" },
  "Call Today":     { fg: "#9A3412", bg: "rgba(234,88,12,0.10)",  border: "rgba(234,88,12,0.30)" },
  "Contacted":      { fg: "#1F2937", bg: "rgba(75,85,99,0.10)",   border: "rgba(75,85,99,0.30)" },
  "Follow Up":      { fg: "#6D28D9", bg: "rgba(124,58,237,0.10)", border: "rgba(124,58,237,0.30)" },
  "Proposal Needed":{ fg: "#0E7490", bg: "rgba(8,145,178,0.10)",  border: "rgba(8,145,178,0.30)" },
  "Won":            { fg: "#047857", bg: "rgba(5,150,105,0.10)",  border: "rgba(5,150,105,0.30)" },
  "Lost":           { fg: "#B91C1C", bg: "rgba(220,38,38,0.10)",  border: "rgba(220,38,38,0.30)" },
  "Not Ready":      { fg: "#475569", bg: "rgba(100,116,139,0.10)",border: "rgba(100,116,139,0.30)" },
};

export function displayLeadStatus(input) {
  if (!input || typeof input !== "object") return "New Lead";

  // Deal-stage path (History tab).
  if (typeof input.stage === "string") {
    const s = input.stage.toLowerCase();
    if (s === "closed_won" || s === "won") return "Won";
    if (s === "lost") return "Lost";
    if (s === "closing_soon") return "Proposal Needed";
    if (s === "in_progress") return "Follow Up";
    if (s === "new") return "New Lead";
  }

  // Lead / task signals (Today + All Leads).
  const lead = input.lead ?? input;
  const task = input.task ?? input;

  // Explicit "not ready" — the LaborTech scan rejected the lead.
  if (lead?.laborTechScan?.qualified === false) return "Not Ready";
  if (task?.laborTechScan?.qualified === false) return "Not Ready";

  // Internal status enum (CRM writes).
  const raw = (lead?.crm?.status ?? task?.crm?.status ?? lead?.status ?? "")
    .toString()
    .toUpperCase();
  if (raw === "NOT_QUALIFIED" || raw === "SKIPPED" || raw === "LOST") return "Lost";
  if (raw === "WON" || raw === "CLOSED_WON") return "Won";
  if (raw === "FOLLOW_UP" || raw === "INTERESTED" || raw === "QUALIFIED" || raw === "PITCHED") return "Follow Up";
  if (raw === "CONTACTED" || raw === "CALLED" || raw === "VOICEMAIL" || raw === "EMAILED") return "Contacted";

  // Call-now signals (highest urgency before contact).
  if (lead?.forceAction || task?.forceAction) return "Call Today";
  if (lead?.recommendedAction === "CALL NOW") return "Call Today";
  if (lead?.bucket === "CALL NOW" || task?.bucket === "CALL NOW") return "Call Today";
  if (typeof lead?.score === "number" && lead.score >= 70) return "Call Today";
  if (task?.priority === "critical" || task?.priority === "high") return "Call Today";

  return "New Lead";
}

// ── Sub-label / cross-tab hint copy ──────────────────────────────────

const TAB_LABEL = {
  today:      "Calendar",
  "all-leads":"Scheduling",
  history:    "History",
};

const SOURCE_SUBLABEL = {
  today:      "Viewing lead from Calendar",
  "all-leads":"Viewing lead from Scheduling",
  history:    "Viewing lead from History",
};

const CROSS_TAB_HINT = {
  today:      "This lead also appears in Scheduling.",
  "all-leads":"Scheduled in your call plan.",
  history:    "Previously worked lead.",
};

// ── Strip ────────────────────────────────────────────────────────────

/**
 * Props:
 *   companyName: string
 *   trade?:      string
 *   location?:   string
 *   sourceTab:   "today" | "all-leads" | "history"
 *   statusInput: lead | task | deal — fed straight into displayLeadStatus
 *   onSwitchTab?: (tabKey) => void   — when supplied, "View in X" links render
 */
export default function LeadContextStrip({
  companyName,
  trade,
  location,
  sourceTab,
  statusInput,
  onSwitchTab,
}) {
  const status = displayLeadStatus(statusInput ?? null);
  const tone = STATUS_TONES[status] ?? STATUS_TONES["New Lead"];
  const subLabel = SOURCE_SUBLABEL[sourceTab] ?? "Viewing lead";
  const hint = CROSS_TAB_HINT[sourceTab] ?? null;

  const switchOptions = [
    { key: "today",     visible: sourceTab !== "today" },
    { key: "all-leads", visible: sourceTab !== "all-leads" },
    { key: "history",   visible: sourceTab !== "history" },
  ].filter((o) => o.visible);

  return (
    <div
      role="region"
      aria-label="Active lead context"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: "10px 12px",
        marginBottom: "10px",
        borderRadius: "10px",
        background: "linear-gradient(180deg, rgba(37,99,235,0.06) 0%, rgba(37,99,235,0.02) 100%)",
        border: "1px solid rgba(37,99,235,0.22)",
        boxShadow: "0 1px 2px rgba(37,99,235,0.06)",
      }}
    >
      {/* Top row: ACTIVE LEAD eyebrow + status pill */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <span style={{
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.12em",
          color: palette.blue,
          textTransform: "uppercase",
        }}>
          Active Lead · {TAB_LABEL[sourceTab] ?? ""}
        </span>
        <span
          aria-label={`Status: ${status}`}
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "2px 8px",
            borderRadius: "999px",
            color: tone.fg,
            background: tone.bg,
            border: `1px solid ${tone.border}`,
            whiteSpace: "nowrap",
            textTransform: "uppercase",
          }}
        >
          {status}
        </span>
      </div>

      {/* Company / trade / location header */}
      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{
          fontSize: "14px",
          fontWeight: 700,
          color: palette.textPrimary,
          lineHeight: 1.25,
        }}>
          {companyName || "Unknown lead"}
        </div>
        {(trade || location) ? (
          <div style={{
            fontSize: "11px",
            color: palette.textSecondary,
            lineHeight: 1.4,
          }}>
            {trade ? <span>{trade}</span> : null}
            {trade && location ? <span style={{ color: palette.textTertiary }}> · </span> : null}
            {location ? <span>{location}</span> : null}
          </div>
        ) : null}
      </div>

      {/* Sub-label + cross-tab hint */}
      <div style={{
        fontSize: "10.5px",
        color: palette.textSecondary,
        lineHeight: 1.45,
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}>
        <span style={{ fontStyle: "italic" }}>{subLabel}</span>
        {hint ? (
          <span style={{ color: palette.textTertiary }}>{hint}</span>
        ) : null}
      </div>

      {/* "View in X" cross-tab links — only when callback supplied */}
      {typeof onSwitchTab === "function" && switchOptions.length > 0 ? (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          paddingTop: "2px",
          borderTop: "1px dashed rgba(37,99,235,0.22)",
          marginTop: "2px",
        }}>
          {switchOptions.map(({ key }) => (
            <button
              key={key}
              type="button"
              onClick={() => onSwitchTab(key)}
              style={{
                fontSize: "10.5px",
                fontWeight: 600,
                color: palette.blue,
                background: "transparent",
                border: "1px solid rgba(37,99,235,0.30)",
                borderRadius: "999px",
                padding: "3px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                letterSpacing: "0.01em",
              }}
            >
              View in {TAB_LABEL[key]} →
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
