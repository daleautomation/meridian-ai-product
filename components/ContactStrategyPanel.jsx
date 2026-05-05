"use client";

// Meridian — Contact Strategy display strip.
//
// Renders a small "Best contact method: …" line in lead detail panels
// (Today's SelectedLeadPanel, All Leads' LeadDetail). Pure display —
// reads getContactStrategy(lead) and surfaces the recommended channel
// + a one-line rationale. Never triggers a Hunter call.

import { palette } from "../lib/theme";
import { getContactStrategy } from "../lib/contacts/contactStrategy";

const METHOD_TONES = {
  "Phone First":     { fg: palette.success, bg: palette.successBg, border: "#BBF7D0" },
  "Phone + Email":   { fg: palette.success, bg: palette.successBg, border: "#BBF7D0" },
  "Email Follow-Up": { fg: palette.blue, bg: palette.bluePale, border: palette.blueBorder },
  "Research Needed": { fg: palette.textSecondary, bg: palette.surfaceHover, border: palette.borderLight },
};

export default function ContactStrategyPanel({ lead, compact = false }) {
  const strategy = getContactStrategy(lead);
  const tone = METHOD_TONES[strategy.primaryMethod] ?? METHOD_TONES["Research Needed"];

  return (
    <div
      role="region"
      aria-label="Contact strategy"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? "3px" : "5px",
        padding: compact ? "8px 10px" : "10px 12px",
        borderRadius: "10px",
        background: palette.surface,
        border: `1px solid ${palette.borderLight}`,
      }}
    >
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
      }}>
        <span style={{
          fontSize: "9px",
          fontWeight: 800,
          letterSpacing: "0.10em",
          color: palette.textTertiary,
          textTransform: "uppercase",
        }}>
          Best contact method
        </span>
        <span
          aria-label={`Strategy: ${strategy.primaryMethod}`}
          style={{
            fontSize: "10px",
            fontWeight: 800,
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
          {strategy.primaryMethod}
        </span>
      </div>
      <div style={{
        fontSize: "11.5px",
        color: palette.textSecondary,
        lineHeight: 1.45,
      }}>
        {strategy.reason}
      </div>
    </div>
  );
}
