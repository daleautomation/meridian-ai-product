"use client";

// Meridian — single shared email action.
//
// One component, three modes — picked at render time from the lead's
// email state:
//
//   1. verifiedEmail present → "Email ✓"  (mailto:, tooltip = "Verified email via Hunter")
//   2. email present         → "Email"    (mailto:)
//   3. neither, but Hunter connected + lead supplied → "Find Email" (manual click)
//   4. otherwise → nothing (or a quiet disabled chip when explicitly requested)
//
// Replaces the per-surface email button duplicates that existed in
// FeedbackControls, SelectedLeadPanel, LeadDetail, the Call Mode
// composer, and DealDetailPanel. Same shape, same labels, same rules
// across Today / All Leads / History.
//
// No automation. Find Email fires only on user click via
// /api/integrations/hunter/find-email; HUNTER_API_KEY never leaves
// the server.

import { useState } from "react";
import { palette } from "../lib/theme";
import {
  evaluateHunterEligibility,
  normalizeLeadDomain,
  markHunterAttempt,
} from "../lib/contacts/contactStrategy";

// ── Size tokens ──────────────────────────────────────────────────────
//
// "sm" — calendar card pill height (matches Call/Text pills).
// "md" — detail-panel button height (matches Call Now / Email in panels).

const SIZE_TOKENS = {
  sm: {
    fontSize: "10px",
    padding: "3px 9px",
    borderRadius: "999px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    spinnerSize: "8px",
  },
  md: {
    fontSize: "11px",
    padding: "8px 12px",
    borderRadius: "10px",
    fontWeight: 700,
    letterSpacing: "0.02em",
    spinnerSize: "10px",
  },
};

function buildMailto(email, companyName, suggestedMessage) {
  if (!email) return null;
  const params = new URLSearchParams();
  if (typeof companyName === "string" && companyName.length > 0) {
    params.set("subject", `Quick note for ${companyName}`);
  }
  if (typeof suggestedMessage === "string" && suggestedMessage.length > 0) {
    params.set("body", suggestedMessage);
  }
  const qs = params.toString();
  return qs ? `mailto:${email}?${qs}` : `mailto:${email}`;
}

// ── Component ────────────────────────────────────────────────────────

/**
 * Props:
 *   email              — string | null  (regular email, e.g. lead.email)
 *   verifiedEmail      — string | null  (Hunter-verified email)
 *   emailSource        — "hunter" | other source
 *   companyName        — string         (for mailto subject)
 *   suggestedMessage   — string         (optional mailto body)
 *   hunterAvailable    — boolean        (HUNTER_API_KEY present server-side)
 *   lead               — full lead object (required for Find Email mutation)
 *   onUpdate           — () => void     (refresh hook fired after Hunter writes)
 *   size               — "sm" | "md"   (default "md")
 *   showDisabled       — boolean        (when true and no email available,
 *                                        renders a quiet "No email" chip
 *                                        instead of returning null)
 *   allowFindEmail     — boolean        (default true; History deals can
 *                                        pass false to suppress Find Email)
 *   labelOverride      — string         (e.g. "Send Email" inside Call Mode)
 */
export default function LeadEmailAction({
  email,
  verifiedEmail,
  emailSource,
  emailConfidence,
  companyName,
  suggestedMessage,
  hunterAvailable = false,
  lead,
  onUpdate,
  size = "md",
  showDisabled = false,
  allowFindEmail = true,
  labelOverride,
}) {
  const tokens = SIZE_TOKENS[size] ?? SIZE_TOKENS.md;
  const stop = (e) => e.stopPropagation();

  // Trust layer for the ✓ glyph:
  //   • emailSource === "hunter" AND
  //   • emailConfidence === "high"  (Hunter integration buckets
  //     scores >= 70 as "high" — see lib/integrations/hunter.ts)
  // Anything weaker (medium/low confidence, or any non-hunter source)
  // still renders as plain "Email" — usable, just no checkmark.
  const isTrustedVerified =
    typeof verifiedEmail === "string"
    && verifiedEmail.length > 0
    && emailSource === "hunter"
    && emailConfidence === "high";

  // Mode 1: verified high-confidence email — "Email ✓"
  if (isTrustedVerified) {
    const mailto = buildMailto(verifiedEmail, companyName, suggestedMessage);
    const tooltip = "Verified email (Hunter)";
    const label = labelOverride ?? "Email";
    return (
      <a
        href={mailto}
        onClick={stop}
        title={tooltip}
        aria-label={tooltip}
        style={{
          fontSize: tokens.fontSize,
          fontWeight: tokens.fontWeight,
          letterSpacing: tokens.letterSpacing,
          padding: tokens.padding,
          borderRadius: tokens.borderRadius,
          color: palette.blue,
          background: palette.bluePale,
          border: `1px solid ${palette.blue}`,
          textDecoration: "none",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        {label} <span aria-hidden="true">✓</span>
      </a>
    );
  }

  // Mode 1b: a verifiedEmail exists but doesn't clear the trust bar
  // (non-hunter source OR low/medium confidence). Surface the email
  // as the active address but render WITHOUT the checkmark and with
  // a quieter tooltip so the rep knows it's lower confidence.
  if (typeof verifiedEmail === "string" && verifiedEmail.length > 0) {
    const mailto = buildMailto(verifiedEmail, companyName, suggestedMessage);
    const tooltip = emailSource === "hunter"
      ? "Lower confidence email"
      : `Email ${verifiedEmail}`;
    const label = labelOverride ?? "Email";
    return (
      <a
        href={mailto}
        onClick={stop}
        title={tooltip}
        aria-label={tooltip}
        style={{
          fontSize: tokens.fontSize,
          fontWeight: tokens.fontWeight,
          letterSpacing: tokens.letterSpacing,
          padding: tokens.padding,
          borderRadius: tokens.borderRadius,
          color: palette.blue,
          background: palette.bluePale,
          border: `1px solid ${palette.blueBorder}`,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </a>
    );
  }

  // Mode 2: regular email — "Email"
  if (typeof email === "string" && email.length > 0) {
    const mailto = buildMailto(email, companyName, suggestedMessage);
    const tooltip = `Email ${email}`;
    const label = labelOverride ?? "Email";
    return (
      <a
        href={mailto}
        onClick={stop}
        title={tooltip}
        aria-label={tooltip}
        style={{
          fontSize: tokens.fontSize,
          fontWeight: tokens.fontWeight,
          letterSpacing: tokens.letterSpacing,
          padding: tokens.padding,
          borderRadius: tokens.borderRadius,
          color: palette.blue,
          background: palette.bluePale,
          border: `1px solid ${palette.blueBorder}`,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </a>
    );
  }

  // Mode 3: no email, but we can offer Find Email. Requires:
  //   • the parent passed a `lead` (so we have a key/website to query),
  //   • HUNTER_API_KEY is configured (parent told us so),
  //   • the surface allows Find Email (History deals opt out),
  //   • the eligibility guard says this lead is worth Hunter spend.
  if (allowFindEmail && hunterAvailable && lead) {
    const eligibility = evaluateHunterEligibility(lead);
    if (eligibility.status === "eligible") {
      // Eligible — render the button + a quiet expectation-setting
      // line directly under it. "Works best for businesses with
      // websites" frames the feature for the user before they click,
      // so a no-result outcome reads as "this lead doesn't fit the
      // pattern" rather than "the feature is broken."
      return (
        <span style={{ display: "inline-flex", flexDirection: "column", gap: "3px", alignItems: "stretch" }}>
          <FindEmailInline lead={lead} onUpdate={onUpdate} size={size} />
          <span style={{
            fontSize: "10px",
            color: palette.textTertiary,
            fontStyle: "italic",
            lineHeight: 1.3,
            whiteSpace: "nowrap",
          }}>
            Works best for businesses with websites
          </span>
        </span>
      );
    }
    // Eligibility denied — render an inline rationale instead of the
    // Find Email button. No Hunter call is made; this is purely a
    // display state. Hidden when showDisabled is false AND the
    // status is "already_verified" (the verified Email button above
    // already covers that case).
    if (eligibility.status === "already_verified") return null;
    // Trade-aware ineligible copy — read as guidance ("phone is best
    // for this business type") rather than feature failure ("not
    // recommended"). The eligibility.reason carries the specifics in
    // the tooltip; the visible copy stays concise + positive.
    const tradeStr = (lead?.moduleId || lead?.trade || "").toString().toLowerCase();
    const isOwnerOp = tradeStr === "hvac" || tradeStr === "plumbing" || tradeStr === "electrical";
    const visibleCopy = isOwnerOp
      ? "Phone is best for this business type"
      : eligibility.status === "no_domain"
        ? "Phone is best for this business type"
        : eligibility.status === "recently_attempted"
          ? "Already searched"
          : "Phone is best for this business type";
    return (
      <span
        title={eligibility.reason}
        style={{
          fontSize: tokens.fontSize,
          fontWeight: 600,
          letterSpacing: tokens.letterSpacing,
          padding: tokens.padding,
          borderRadius: tokens.borderRadius,
          color: palette.textTertiary,
          background: palette.surfaceHover,
          border: `1px dashed ${palette.borderLight}`,
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
      >
        {visibleCopy}
      </span>
    );
  }

  // Mode 4: nothing to show. Optional quiet "No email" chip when
  // the surface really wants the slot to read as deliberate absence.
  if (showDisabled) {
    return (
      <span
        style={{
          fontSize: tokens.fontSize,
          fontWeight: tokens.fontWeight,
          letterSpacing: tokens.letterSpacing,
          padding: tokens.padding,
          borderRadius: tokens.borderRadius,
          color: palette.textTertiary,
          background: palette.surfaceHover,
          border: `1px solid ${palette.borderLight}`,
          whiteSpace: "nowrap",
        }}
      >
        No email
      </span>
    );
  }

  return null;
}

// ── Find Email inline (Mode 3) ────────────────────────────────────────
//
// Internal subcomponent — kept in this file so all email-button states
// live in one place. Same backend contract as the previous standalone
// FindEmailButton: POST /api/integrations/hunter/find-email, mutate the
// lead via applyHunterResultToLead on success, call onUpdate to force
// a parent re-render, fail-silent on errors.

function FindEmailInline({ lead, onUpdate, size }) {
  const tokens = SIZE_TOKENS[size] ?? SIZE_TOKENS.md;
  const [phase, setPhase] = useState("idle"); // idle | loading | not_found
  const stop = (e) => e.stopPropagation();

  const handleClick = async (e) => {
    stop(e);
    if (phase === "loading") return;
    // Belt-and-suspenders: re-check eligibility at click time. Lead
    // state may have changed since render (e.g. another tab wrote a
    // verifiedEmail). Cheap safety net before we hit the network.
    const guard = evaluateHunterEligibility(lead);
    if (guard.status !== "eligible") {
      // Don't fire Hunter — surface the reason inline.
      setPhase("not_found");
      return;
    }
    const domain = normalizeLeadDomain(lead);
    markHunterAttempt(domain, "in_flight");
    setPhase("loading");
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[hunter-guard] Hunter lookup attempted");
    }
    try {
      const res = await fetch("/api/integrations/hunter/find-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lead: {
            id: lead?.id,
            key: lead?.key,
            website: lead?.website ?? lead?.resolvedBusinessUrl ?? lead?.domain,
            domain: lead?.domain,
            verifiedEmail: lead?.verifiedEmail,
            emailConfidence: lead?.emailConfidence,
            contacts: lead?.contacts ? { contactName: lead.contacts.contactName } : undefined,
          },
        }),
      });
      const data = res.ok ? await res.json().catch(() => null) : null;
      const result = data?.result ?? null;
      if (!result || typeof result.email !== "string") {
        markHunterAttempt(domain, "failed");
        setPhase("not_found");
        return;
      }
      const mod = await import("@/lib/integrations/hunter");
      mod.applyHunterResultToLead(lead, result);
      markHunterAttempt(domain, "success");
      if (typeof onUpdate === "function") onUpdate();
      setPhase("idle");
    } catch {
      markHunterAttempt(domain, "failed");
      setPhase("not_found");
    }
  };

  const isLoading = phase === "loading";
  const notFound  = phase === "not_found";

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "3px", alignItems: "stretch" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        title={isLoading ? "Searching Hunter…" : "Find a verified email via Hunter"}
        aria-label="Find verified email"
        style={{
          fontSize: tokens.fontSize,
          fontWeight: tokens.fontWeight,
          letterSpacing: tokens.letterSpacing,
          padding: tokens.padding,
          borderRadius: tokens.borderRadius,
          color: isLoading ? palette.textTertiary : palette.blue,
          background: isLoading ? palette.surfaceHover : palette.bluePale,
          border: `1px solid ${palette.blueBorder}`,
          cursor: isLoading ? "wait" : "pointer",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: "5px",
        }}
      >
        {isLoading ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: tokens.spinnerSize,
                height: tokens.spinnerSize,
                borderRadius: "999px",
                border: `2px solid ${palette.blueBorder}`,
                borderTopColor: palette.blue,
                display: "inline-block",
                animation: "meridian-spin 0.7s linear infinite",
              }}
            />
            Searching…
          </>
        ) : "Find Email"}
      </button>
      {notFound ? (
        <span style={{ fontSize: "10px", color: palette.textTertiary, fontStyle: "italic" }}>
          No verified email found.
        </span>
      ) : null}
    </span>
  );
}
