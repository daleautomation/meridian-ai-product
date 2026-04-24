"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { palette } from "../lib/theme";
import { getTradeModule, getServiceBucket, TRADE_DEFAULT } from "../lib/modules/trades";
import { buildCallQueue, summarizeQueue } from "../lib/scoring/callQueue";

// ── MCP ───────────────────────────────────────────────────────────────

async function callMcp(name, args) {
  const res = await fetch("/api/mcp", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "tools/call", params: { name, arguments: args } }),
  });
  if (!res.ok) throw new Error(`MCP ${name} HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "MCP error");
  if (json.result?.error) throw new Error(json.result.error);
  return json.result;
}

// ── Score interpretation ──────────────────────────────────────────────

function scoreLabel(score) {
  if (score >= 90) return "Elite Opportunity";
  if (score >= 75) return "Strong Opportunity";
  if (score >= 60) return "Good Opportunity";
  if (score >= 40) return "Moderate";
  return "Low Priority";
}

function scoreLabelColor(score) {
  if (score >= 75) return palette.blue;
  if (score >= 60) return palette.success;
  if (score >= 40) return palette.textSecondary;
  return palette.textTertiary;
}

// ── Opportunity classification (replaces numeric score) ───────────────

const OPP_META = {
  "CALL NOW": { dot: "🔴", headline: "CALL NOW — HIGH CONVERSION PROBABILITY", color: palette.danger, bg: "#FEF2F2", border: "#FECACA" },
  "TODAY":    { dot: "🟡", headline: "TODAY — STRONG FIT",                     color: palette.warning, bg: palette.warningBg, border: "#FDE68A" },
  "MONITOR":  { dot: "⚪", headline: "MONITOR — HOLD FOR NOW",                  color: palette.textSecondary, bg: palette.surfaceHover, border: palette.border },
  "PASS":     { dot: "⚫", headline: "PASS — NOT A FIT",                        color: palette.textTertiary, bg: palette.surfaceHover, border: palette.border },
};

function opportunityLabel(lead) {
  // Prefer canonical engine bucket when present (from decideCompany).
  if (lead.bucket && OPP_META[lead.bucket]) return lead.bucket;
  if (lead.opportunity_label && OPP_META[lead.opportunity_label]) return lead.opportunity_label;
  if (lead.forceAction) return "CALL NOW";
  if (lead.closeReadiness === "READY TO CLOSE") return "CALL NOW";
  if (lead.recommendedAction === "CALL NOW") return "CALL NOW";
  if (lead.recommendedAction === "TODAY") return "TODAY";
  const score = typeof lead.score === "number" ? lead.score : 0;
  if (score >= 75) return "CALL NOW";
  if (score >= 55) return "TODAY";
  if (score >= 35) return "MONITOR";
  return "PASS";
}

function opportunityMeta(label) {
  return OPP_META[label] ?? OPP_META.MONITOR;
}

// ── Opportunity estimate (evidence-gated) ─────────────────────────────
// Reads lead.opportunityEstimate from the decision engine. Never invents
// a numeric band — shows "Estimate unavailable" or "Broad estimate only"
// when the engine withheld a band due to data quality.

function opportunityView(lead) {
  const est = lead.opportunityEstimate;
  if (est) {
    const level = est.opportunityRiskLevel || "LOW";
    const confidence = est.opportunityEstimateConfidence || "LOW";
    const band = est.opportunityEstimateBand;
    const reason = est.opportunityEstimateReason || "";
    let display;
    if (band) display = band;
    else if (confidence === "MEDIUM") display = "Broad estimate only";
    else display = "Estimate unavailable";
    return {
      level,
      confidence,
      display,
      hasBand: !!band,
      reason,
      revenueImpact: Array.isArray(est.revenueImpactSummary) ? est.revenueImpactSummary : [],
      outcome: est.realWorldOutcome || "",
      angle: est.salesAngle || "",
    };
  }
  // Legacy fallback — only fires for stale snapshots that predate the
  // opportunityEstimate field. Keeps the UI slot populated until a
  // refresh runs.
  if (lead.estimated_lost_leads) {
    return {
      level: "MODERATE", confidence: "LOW",
      display: lead.estimated_lost_leads,
      hasBand: true,
      reason: "Legacy estimate — refresh for evidence-gated output.",
      revenueImpact: [], outcome: "", angle: "",
    };
  }
  return {
    level: "LOW",
    confidence: "LOW",
    display: "Estimate unavailable",
    hasBand: false,
    reason: "No live-check data on file yet — run a refresh for a real estimate.",
    revenueImpact: [], outcome: "", angle: "",
  };
}

function riskLevelColor(level) {
  if (level === "HIGH") return palette.danger;
  if (level === "MODERATE") return palette.warning;
  return palette.textSecondary;
}

// ── Trust layer (Source / Last Checked / Confidence) ──────────────────

function trustInfo(lead, siteStatus, nowLabel) {
  const c = lead.contacts || {};
  const proof = lead.websiteProof || null;
  const hasPhone = !!c.primaryPhone;
  const hasWebsite = !!(lead.resolvedBusinessUrl || lead.domain || proof?.homepage_fetch_ok);
  const scanOk = proof?.homepage_fetch_ok ?? (siteStatus === "verified_business_site");

  // Prefer the best-ranked contact path for the source string. Falls back to
  // snapshot-level signals only when the engine did not supply paths.
  const bestPath = (lead.contactPaths && lead.contactPaths[0]) || null;

  const parts = [];
  if (bestPath) {
    parts.push(bestPath.label ?? bestPath.source);
  } else {
    const src = String(c.source || "").toLowerCase();
    if (hasPhone && /gbp|google/.test(src)) parts.push("Google Business Profile");
    else if (hasPhone && /directory|yelp|bbb|angi/.test(src)) parts.push("Verified Directory");
    else if (hasPhone) parts.push("Business Profile");
  }
  if (proof?.homepage_fetch_ok || hasWebsite) parts.push("Live Website Scan");
  const source = lead.source || (parts.length ? parts.join(" + ") : "Directory Listings");

  // Prefer the canonical confidenceLabel from the engine.
  let confidence = lead.confidenceLabel || lead.confidence;
  if (!confidence) {
    const signals = [hasPhone, hasWebsite, scanOk].filter(Boolean).length;
    if (signals >= 3) confidence = "HIGH";
    else if (signals === 2) confidence = "MEDIUM";
    else confidence = "LOW";
  }
  confidence = String(confidence).toUpperCase();

  const rawLastChecked =
    lead.last_checked
    ?? lead.lastChecked
    ?? proof?.last_checked
    ?? c.lastVerifiedAt;
  const lastChecked = (rawLastChecked && formatClockTime(rawLastChecked)) || nowLabel;

  return { source, confidence, lastChecked };
}

function confidenceBadgeColor(conf) {
  if (conf === "HIGH") return palette.success;
  if (conf === "MEDIUM") return palette.warning;
  return palette.textTertiary;
}

function fitAxisColor(value) {
  const v = String(value || "").toLowerCase();
  if (v === "strong" || v === "active") return palette.success;
  if (v === "moderate") return palette.warning;
  if (v === "weak" || v === "low" || v === "none") return palette.danger;
  return palette.textTertiary; // Unknown
}

function fitOverallColor(overall) {
  if (overall === "STRONG FIT") return palette.success;
  if (overall === "GOOD FIT") return palette.blue;
  if (overall === "WEAK FIT") return palette.textTertiary;
  return palette.textTertiary;
}

function FitAxis({ name, value }) {
  // Compact card — equal width, centered, color-coded value only.
  // Name reads as a small label above the verdict.
  const color = fitAxisColor(value);
  return (
    <div style={S.fitAxisCard}>
      <div style={S.fitAxisCardName}>{name}</div>
      <div style={{ ...S.fitAxisCardValue, color }}>{value}</div>
    </div>
  );
}

function completenessColor(level) {
  if (level === "COMPLETE") return palette.success;
  if (level === "STRONG") return palette.success;
  if (level === "PARTIAL") return palette.warning;
  return palette.textTertiary;
}

function qualityColor(score) {
  if (score >= 9) return palette.success;
  if (score >= 7) return palette.blue;
  if (score >= 5) return palette.warning;
  return palette.textTertiary;
}

function bestPathColor(path) {
  if (path === "Verified phone") return palette.success;
  if (path === "Person email") return palette.blue;
  if (path === "Unverified phone" || path === "Generic inbox") return palette.warning;
  if (path === "Contact form") return palette.warning;
  return palette.textTertiary;
}

// Map the resolver's machine-readable no-email reason into a short,
// operator-friendly phrase. Stays aligned with lib/contacts/types.ts.
function formatNoEmailReason(code) {
  switch (code) {
    case "no_email_found_on_site": return "no email on site";
    case "no_provider_email_found": return "no provider email found";
    case "contact_form_only": return "contact form only";
    case "website_only_no_email": return "website only, no email";
    case "no_website_no_email": return "no website on file";
    case "contact_page_found_no_email": return "contact page found, no email listed";
    case "website_unreachable": return "website unreachable during live check";
    case "domain_mismatch_blocked_email": return "domain mismatch blocked email";
    case "low_trust_candidates_only": return "only low-trust email candidates found";
    default: return String(code || "");
  }
}

// Short human label for the primary email's provenance.
function formatEmailMethod(method) {
  switch (method) {
    case "website_mailto": return "mailto on site";
    case "website_visible": return "visible on site";
    case "website_schema": return "schema on site";
    case "website_obfuscated": return "obfuscated on site";
    case "provider_verified": return "provider-verified";
    case "provider_observed": return "provider-observed";
    case "fallback_listing": return "fallback listing";
    case "unresolved": return null;
    default: return method ? String(method).replace(/_/g, " ") : null;
  }
}

// Normalize a phone to a dialable tel: URI. "(816) 555-0184" → "tel:+18165550184".
function telHref(phone) {
  if (!phone) return "#";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  if (digits.length === 10) return `tel:+1${digits}`;
  return `tel:${digits}`;
}

// One-click email template. Same copy for every lead — deterministic, safe
// to pre-fill into the user's default mail client.
const QUICK_EMAIL_SUBJECT = "Quick question about your website";
const QUICK_EMAIL_BODY =
  "Hi, I ran a quick check on your site and found a couple issues that may be costing you inbound leads. Worth a quick 10-minute look this week?";
function buildQuickMailto(email) {
  if (!email) return null;
  const qs = new URLSearchParams({ subject: QUICK_EMAIL_SUBJECT, body: QUICK_EMAIL_BODY });
  return `mailto:${email}?${qs.toString()}`;
}

function formatClockTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

// ── Lead interpretation (plain English, no em dashes) ─────────────────

function dominantReason(lead) {
  if (lead.forceAction) return "Follow-up overdue — scheduled touch date passed.";
  if (lead.closeReadiness === "READY TO CLOSE") return "Flagged interested in prior call log.";

  // Prefer the top site-specific issue when inspection data is on file.
  const issues = lead.websiteProof?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const ranked = rankIssues(issues);
    return stripTrailingPeriod(ranked[0].description) + ".";
  }

  const weaknesses = lead.topWeaknesses ?? [];
  const siteDown = weaknesses.some((w) => /unreachable|down|offline/i.test(w));
  const noMobile = weaknesses.some((w) => /viewport|mobile/i.test(w));
  const noSeo = weaknesses.some((w) => /meta|SEO|title/i.test(w));
  const thin = weaknesses.some((w) => /thin|placeholder|parked|blank/i.test(w));

  if (siteDown) return "Live site check failed — page did not load content.";
  if (thin && noSeo) return "Website returned no content + zero search metadata.";
  if (noMobile && noSeo) return "No mobile viewport + no search metadata.";
  if (noSeo) return "Zero search metadata — not indexed for core queries.";
  if (noMobile) return "No mobile viewport — mobile visitors cannot render page.";
  if (weaknesses.length >= 3) return `${weaknesses.length} system checks failed on site.`;
  if (weaknesses.length >= 1) return stripDash(weaknesses[0]);
  return "Minor visibility gaps detected.";
}

function splitLocation(location) {
  if (!location) return ["", ""];
  const parts = String(location).split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return ["", ""];
  if (parts.length === 1) return [parts[0], ""];
  return [parts[0], parts[parts.length - 1]];
}

function stripDash(s) {
  if (!s) return "";
  return String(s).replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();
}

function primaryIssue(lead) {
  // Prefer engine-level site issues — each carries a site-specific
  // description with observed values (byte counts, HTTP codes, titles).
  // Headline is the single top issue so it doesn't duplicate the bullet
  // list rendered below it.
  const issues = lead.websiteProof?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const ranked = rankIssues(issues);
    return stripTrailingPeriod(ranked[0].description);
  }
  // Legacy fallback for snapshots that predate the issues layer.
  const weaknesses = lead.topWeaknesses ?? [];
  if (weaknesses.some((w) => /unreachable|down|offline/i.test(w))) return "Live site check failed — page did not load";
  if (weaknesses.some((w) => /parked/i.test(w))) return "Domain parked — no business content served";
  if (weaknesses.some((w) => /blank|thin|placeholder/i.test(w))) return "Website returned no content during live check";
  if (weaknesses.some((w) => /meta|SEO|title/i.test(w))) return "No search metadata — not ranking for core queries";
  if (weaknesses.some((w) => /viewport|mobile/i.test(w))) return "No mobile viewport — fails on phones";
  if (weaknesses.length >= 3) return `${weaknesses.length} system checks failed on the site`;
  if (weaknesses.length >= 1) return "System detected visibility gap";
  return "Minor visibility gaps detected";
}

// Order issues by severity first, then by the canonical failure order so
// reachability/content issues bubble above formatting/social gaps.
const ISSUE_CODE_PRIORITY = {
  site_unreachable: 0, http_5xx: 1, http_4xx: 2,
  blank_body: 3, thin_content: 4,
  no_contact_path: 5, no_contact_form: 6, no_phone_on_site: 7, no_email_on_site: 8,
  title_missing: 9, title_weak: 10, meta_missing: 11, no_headings: 12,
  slow_response: 13, no_mobile_viewport: 14, no_https: 15, no_opengraph: 16,
};

function rankIssues(issues) {
  const sevRank = { high: 0, medium: 1, low: 2 };
  return [...issues].sort((a, b) => {
    const s = (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3);
    if (s !== 0) return s;
    const pa = ISSUE_CODE_PRIORITY[a.code] ?? 99;
    const pb = ISSUE_CODE_PRIORITY[b.code] ?? 99;
    return pa - pb;
  });
}

function stripTrailingPeriod(s) {
  return String(s || "").replace(/\.$/, "").trim();
}

// Bullets for the Decision Core issue block. Skips the top issue (already
// used as the headline) and returns the next 2–4 ranked issues so the
// block structure is: headline → bullets (no duplicates) → impact.
function issueBullets(lead) {
  const issues = lead.websiteProof?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return [];
  const ranked = rankIssues(issues);
  return ranked.slice(1, 5).map((it) => stripTrailingPeriod(it.description));
}

// ── Reasons (deterministic bullets for the decision panel) ────────────

function buildReasons(lead, siteStatus) {
  const weaknesses = (lead.topWeaknesses ?? []).join(" ").toLowerCase();
  const out = [];
  if (siteStatus === "unreachable" || /unreachable|offline|did not load/.test(weaknesses)) {
    out.push("High visibility issue");
    out.push("Immediate trust loss on inbound search");
    out.push("Fast fix opportunity");
  } else if (siteStatus === "parked_domain" || /parked/.test(weaknesses)) {
    out.push("Domain serves no business content");
    out.push("Every search visitor bounces");
    out.push("Fast fix opportunity");
  } else if (/blank|thin|placeholder|no content/.test(weaknesses)) {
    out.push("Website returns no usable content");
    out.push("Trust breaks on first click");
    out.push("Fast fix opportunity");
  } else if (/meta|seo|title|schema/.test(weaknesses)) {
    out.push("Not indexed for core roofing queries");
    out.push("Local search traffic going to competitors");
    out.push("Fixable in one sprint");
  } else if (/viewport|mobile/.test(weaknesses)) {
    out.push("Mobile visitors cannot render page");
    out.push("60%+ of roofing search is mobile");
    out.push("Fixable in one sprint");
  } else if ((lead.topWeaknesses ?? []).length >= 2) {
    out.push(`${(lead.topWeaknesses ?? []).length} system checks failed`);
    out.push("Multiple visibility gaps stacked");
    out.push("Worth a qualification call");
  } else {
    out.push("Minor visibility gap detected");
    out.push("Worth a short qualification call");
  }
  return out.slice(0, 4);
}

// ── Execution state (unified status, operator language) ───────────────

function executionState(lead, siteStatus) {
  const hasPhone = !!lead.contacts?.primaryPhone;
  const hasEmail = !!lead.contacts?.primaryEmail;
  const weakSite = siteStatus && siteStatus !== "verified_business_site";

  if (lead.forceAction) {
    return { text: "Overdue", color: palette.danger, bg: palette.dangerBg };
  }
  if (lead.closeReadiness === "READY TO CLOSE") {
    return { text: "Call Now", color: palette.blue, bg: palette.bluePale };
  }
  if (lead.closeReadiness === "WAITING" || lead.closeReadiness === "AWAITING_REPLY") {
    return { text: "Waiting on Reply", color: palette.blue, bg: palette.bluePale };
  }
  if (!hasPhone && !hasEmail) {
    if (weakSite) return { text: "Researching Contact", color: palette.blue, bg: palette.bluePale };
    return { text: "No Contact Yet", color: palette.textSecondary, bg: palette.surfaceHover };
  }
  if (lead.recommendedAction === "CALL NOW") {
    return { text: "Call Now", color: palette.blue, bg: palette.bluePale };
  }
  if (lead.recommendedAction === "TODAY") {
    return { text: "Call Today", color: palette.warning, bg: palette.warningBg };
  }
  if (lead.callAttempts > 0) {
    return { text: "Follow Up", color: palette.textSecondary, bg: palette.surfaceHover };
  }
  if (lead.score < 40) {
    return { text: "Low Priority", color: palette.textTertiary, bg: palette.surfaceHover };
  }
  return { text: "Follow Up", color: palette.textSecondary, bg: palette.surfaceHover };
}

// ── Contact resolution engine ─────────────────────────────────────────
// Identity-first pipeline. The backend owns six explicit steps; the client
// consumes the final structured result and shows progress while it runs.
//
//   Step 1 — Normalize business
//            Input:  { name, domain?, city?, phone?, category? }
//            Output: { normalizedName, normalizedCity, categoryTag }
//
//   Step 2 — Resolve identity across sources (GBP, Yelp, BBB, Angi, Facebook)
//            Candidates scored by name similarity + location match + category.
//            Output: {
//              gbpCandidate:     { url, placeId, name, reviewCount, rating } | null,
//              directoryMatches: Array<{ source, url, name, reviewCount? }>,
//              facebookPage:     { url, name } | null,
//              linkedinPage:     { url, name } | null,
//            }
//
//   Step 3 — Match entity
//            Best candidate chosen via name similarity + city match + category.
//            Rejects off-market or wrong-category matches.
//
//   Step 4 — Extract contact (walks the source ladder in order)
//              1. Google Business Profile / Maps
//              2. BBB / Yelp / Angi / Chamber / local directories
//              3. Website contact page (only if site is valid)
//              4. Facebook business page
//              5. LinkedIn company page
//              6. Inferred email (only if domain is real and active)
//
//   Step 5 — Score confidence
//              High   — GBP match with phone
//              Medium — Directory match with phone
//              Low    — Inferred or single weak source
//
//   Step 6 — Return structured result (MCP tool: find_best_contact)
//            {
//              bestPhone:         string | null,
//              bestEmail:         string | null,
//              bestFallbackRoute: { kind, url, label } | null,
//              source:            "gbp" | "directory" | "website" | "social" | "unverified",
//              confidence:        "high" | "medium" | "low",
//              checkedSources:    string[],
//              lastCheckedAt:     ISO,
//            }
//
// RESEARCH_LADDER below is the UI's local projection of the source ladder.
// The UI streams step progress while the backend job runs. When the backend
// returns, lead.contacts is populated and the card transitions out of the
// Reachability "researching" state automatically.

// User-facing step phrases rendered during Find Contact. These are phases,
// not literal sources — the backend queries sources in parallel; the UI walks
// these for tactile progress.
const RESEARCH_LADDER = [
  "Searching Google Business",
  "Matching business",
  "Checking directories",
  "Checking social pages",
];

// ── Severity + Impact (hero block) ────────────────────────────────────

const SEV_CRITICAL = { level: "Critical", color: "#B91C1C", bg: "#FFF1F1", border: "#FECACA" };
const SEV_MODERATE = { level: "Moderate", color: "#B45309", bg: "#F9FAFB", border: "#E5E7EB" };
const SEV_MINOR    = { level: "Minor",    color: palette.textSecondary, bg: "#F9FAFB", border: "#E5E7EB" };

function severity(lead, siteStatus) {
  const weaknessCount = (lead.topWeaknesses ?? []).length;
  if (siteStatus === "unreachable" || siteStatus === "parked_domain") return SEV_CRITICAL;
  if (weaknessCount >= 4) return SEV_CRITICAL;
  if (
    siteStatus === "placeholder_site" ||
    siteStatus === "thin_site" ||
    siteStatus === "directory_page" ||
    siteStatus === "aggregator_page" ||
    weaknessCount >= 2
  ) return SEV_MODERATE;
  return SEV_MINOR;
}

function formatList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function emptySearchMessage(findTask) {
  const steps = findTask?.steps?.map((s) => s.label) ?? [];
  if (steps.length === 0) return "Contact not found yet. Expanding search.";
  return `Contact not found yet. Checked ${formatList(steps)}. Expanding search.`;
}

function nextStepLine(lead, searchingFor) {
  if (searchingFor) return `Next step: Searching ${searchingFor}`;
  const c = lead.contacts || {};
  const hasPhone = !!c.primaryPhone;
  const hasEmail = !!c.primaryEmail;
  if (!hasPhone && !hasEmail) return "Next step: Find contact and make first call";
  if (hasPhone && lead.callAttempts > 0 && lead.dealHeat < 40) return "Next step: Follow up and leave a voicemail";
  if (hasPhone && lead.callAttempts > 0) return "Next step: Follow up on prior outreach";
  if (hasPhone) return "Next step: Make the call and qualify";
  return "Next step: Send intro email and request a call";
}

function impactLine(lead) {
  // Prefer the impact statement attached to the top engine-level issue.
  const issues = lead.websiteProof?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const ranked = rankIssues(issues);
    return ranked[0].impact;
  }
  const weaknesses = (lead.topWeaknesses ?? []).join(" ").toLowerCase();
  const issue = primaryIssue(lead).toLowerCase();
  if (/unreachable|offline|did not load/.test(weaknesses + issue)) {
    return "Every inbound search visitor hits a dead page.";
  }
  if (/parked|domain for sale/.test(weaknesses + issue)) {
    return "Domain serves no business content — 100% bounce on search traffic.";
  }
  if (/blank|thin|placeholder|no content/.test(issue + weaknesses)) {
    return "Page serves no content — visitors bounce without converting.";
  }
  if (/seo|meta|title|search/.test(issue + weaknesses)) {
    return "Business is not indexed for core roofing queries.";
  }
  if (/mobile|viewport/.test(issue + weaknesses)) {
    return "Mobile visitors (60%+ of search traffic) cannot use the page.";
  }
  if (/gbp|google business|review/.test(weaknesses)) {
    return "Search trust signal missing — referred customers hesitate to call.";
  }
  return "Trust signal breaking when customers look up the business.";
}

// ── Proof (bullet list) ───────────────────────────────────────────────

// Translate raw inspection signals into operator-grade proof labels.
// Mapping is defensive: if nothing matches, return the stripped raw so the
// operator still sees the underlying finding.
function humanizeProof(raw) {
  const s = String(raw).toLowerCase();
  if (/unreachable|not reachable|http 5\d\d|offline/.test(s)) return "Live site check failed — page did not load content";
  if (/parked|domain for sale|buy this domain|coming soon|under construction/.test(s)) return "Domain parked — no business content served";
  if (/blank|empty|almost no content|one page|single page|thin content|placeholder/.test(s)) return "Website returned no content during live check";
  if (/meta description|missing description/.test(s)) return "No search description tag in page source";
  if (/title tag|meta title|missing title|no title/.test(s)) return "No search title tag in page source";
  if (/h1|heading/.test(s)) return "No H1 heading detected on homepage";
  if (/viewport|not mobile|mobile friendly/.test(s)) return "No mobile viewport declared — fails on phones";
  if (/schema|structured data|jsonld/.test(s)) return "No business schema detected";
  if (/gbp|google business|google profile/.test(s)) return "No Google Business Profile linked";
  if (/review/.test(s)) return "Fewer than 10 verified reviews on record";
  if (/https|ssl|insecure/.test(s)) return "No HTTPS — browser flags site insecure";
  if (/slow|load time|performance/.test(s)) return "Page load exceeded 5 seconds on live check";
  if (/contact page|contact link|no contact/.test(s)) return "No contact page detected on site";
  if (/phone/.test(s)) return "No phone number published on site";
  if (/email/.test(s)) return "No email address published on site";
  return stripDash(raw);
}

function proofFound(lead) {
  // Prefer engine-level issue descriptions (site-specific). Fall back to
  // humanized weakness strings only when no issues layer is present.
  const issues = lead.websiteProof?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const ranked = rankIssues(issues);
    const seen = new Set();
    const out = [];
    for (const it of ranked) {
      const key = it.description.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it.description);
    }
    return out.slice(0, 5);
  }
  const raw = (lead.topWeaknesses ?? []).filter(Boolean);
  if (raw.length === 0) return ["Site reviewed, minor opportunities found"];
  const seen = new Set();
  const humanized = [];
  for (const w of raw) {
    const human = humanizeProof(w);
    const key = human.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    humanized.push(human);
  }
  return humanized.slice(0, 5);
}

// ── Module-level caches (survive card collapse/expand) ────────────────

const scriptCache = new Map();   // leadKey → { data, source: "ai"|"default" }
const draftCache  = new Map();   // leadKey → { mode, subject, body, generatedAt }
const assistantMemory = new Map(); // leadKey → [{ at, action, detail }]   (max 6 per lead)

function recordAssistantAction(leadKey, action, detail) {
  if (!leadKey) return;
  const prior = assistantMemory.get(leadKey) ?? [];
  const next = [{ at: new Date().toISOString(), action, detail }, ...prior].slice(0, 6);
  assistantMemory.set(leadKey, next);
}

// ── Outreach / contact helpers ────────────────────────────────────────

const EMAIL_MODES = [
  { key: "first_touch",         label: "First touch" },
  { key: "follow_up",           label: "Follow up" },
  { key: "voicemail_follow_up", label: "Voicemail follow up" },
];

function firstName(fullName) {
  if (!fullName) return "";
  return String(fullName).trim().split(/\s+/)[0];
}

function whyItMattersLine(lead) {
  const issue = primaryIssue(lead).toLowerCase();
  const weaknesses = (lead.topWeaknesses ?? []).join(" ").toLowerCase();
  if (/unreachable|blank|thin|placeholder|parked|no content/.test(issue + weaknesses)) {
    return "Customers who check the site before calling see a dead page and leave.";
  }
  if (/gbp|google business|review|star/.test(weaknesses)) {
    return "Missing search trust signals turn warm inbound into cold leads.";
  }
  if (/seo|meta|title|search/.test(issue + weaknesses)) {
    return "Search traffic in your area is going to competitors that are indexed.";
  }
  if (/viewport|mobile/.test(issue + weaknesses)) {
    return "Most roofing searches are mobile, and the site does not render on phones.";
  }
  return "Referred customers check the site before calling, and this breaks that trust.";
}

function proofLineForEmail(lead) {
  const first = proofFound(lead)[0] ?? "a visibility issue on your site";
  return first.replace(/^(site|website)\s+/i, "the site ").toLowerCase();
}

function generateEmailDraft(lead, mode, user) {
  const signer = user?.name || "Dylan";
  const company = lead.name;
  const city = lead.location ? ` in ${lead.location}` : "";
  const greetName = firstName(lead.contacts?.contactName);
  const greeting = greetName ? `Hi ${greetName},` : `Hi there,`;
  const proof = proofLineForEmail(lead);
  const why = whyItMattersLine(lead);

  if (mode === "follow_up") {
    return {
      subject: `Following up, ${company}`,
      body: [
        greeting,
        ``,
        `Circling back on ${company}. Still seeing ${proof}, which is worth 10 minutes to walk through.`,
        ``,
        why,
        ``,
        `Does Thursday or Friday work for a short call?`,
        ``,
        `Thanks,`,
        `${signer}`,
        `LaborTech`,
      ].join("\n"),
    };
  }
  if (mode === "voicemail_follow_up") {
    return {
      subject: `Missed you, ${company}`,
      body: [
        greeting,
        ``,
        `Left you a voicemail. Short version: live check on your site flagged ${proof}, and it is costing you inbound leads.`,
        ``,
        why,
        ``,
        `Worth 10 minutes this week?`,
        ``,
        `Thanks,`,
        `${signer}`,
        `LaborTech`,
      ].join("\n"),
    };
  }
  // first_touch (default)
  return {
    subject: `${company}, quick note on your site`,
    body: [
      greeting,
      ``,
      `I run a roofing visibility team out of KC. Took a quick look at ${company}${city} and noticed ${proof}.`,
      ``,
      why,
      ``,
      `Open to a 10 minute call this week so I can show you what I found?`,
      ``,
      `Thanks,`,
      `${signer}`,
      `LaborTech`,
    ].join("\n"),
  };
}

function defaultEmailMode(lead) {
  if (lead.callAttempts > 0 && lead.dealHeat < 50) return "voicemail_follow_up";
  if (lead.callAttempts > 0) return "follow_up";
  return "first_touch";
}

async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to manual fallback
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function mailtoUrl(to, subject, body) {
  const qs = new URLSearchParams();
  if (subject) qs.set("subject", subject);
  if (body) qs.set("body", body);
  const q = qs.toString();
  return `mailto:${to ?? ""}${q ? `?${q}` : ""}`;
}

function siteHref(lead) {
  const url = lead.resolvedBusinessUrl || lead.contacts?.contactPageUrl || lead.domain || "";
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

// Deterministic check: is the URL we'd open on "View Site" actually a
// usable business website, or a parked / for-sale / registrar / aggregator
// page that would mislead the operator? Combines:
//   - engine site_classification (site_unreachable / site_blank)
//   - classifyWebsite() heuristics (parked_domain / placeholder_site / etc.)
//   - known registrar/park service hostnames in the final URL
// Returns { usable, label, reason }.
const REGISTRAR_HOSTS = /(sedoparking|parkingcrew|bodis|hugedomains|domaincontrol|godaddy|dan\.com\/sale|namecheap\.com\/domains|uniregistry)/i;

function siteUsability(lead) {
  const site = classifyWebsite(lead);
  const classification = lead.websiteProof?.site_classification;
  const proof = lead.websiteProof;
  const resolved = (lead.resolvedBusinessUrl || lead.domain || "").toLowerCase();

  // Explicit dead-domain states.
  if (classification === "site_unreachable" || site.status === "unreachable") {
    return { usable: false, label: "Site unreachable", reason: "Homepage did not respond during live check." };
  }
  if (site.status === "parked_domain") {
    return { usable: false, label: "Parked domain", reason: "Domain serves a parked page, not a business site." };
  }
  if (REGISTRAR_HOSTS.test(resolved)) {
    return { usable: false, label: "Registrar landing page", reason: "URL resolves to a registrar / domain-for-sale page." };
  }
  if (classification === "site_blank" || site.status === "thin_site" || site.status === "placeholder_site") {
    return { usable: false, label: "Site inactive", reason: "Homepage returned no usable business content." };
  }
  if (site.status === "directory_page" || site.status === "aggregator_page") {
    return { usable: false, label: "Directory listing only", reason: "URL is an aggregator/listing, not the business's own site." };
  }
  // Homepage fetched but we never got real text content — treat as inactive.
  if (proof && proof.homepage_fetch_ok === false) {
    return { usable: false, label: "Site inactive", reason: "Homepage fetch failed on the last scan." };
  }
  return { usable: true, label: "View Site", reason: null };
}

// ── Website classification ────────────────────────────────────────────

const SITE_STATUS = {
  verified_business_site: { label: "Verified site",   color: palette.success,       bg: palette.successBg, tone: "ok" },
  parked_domain:          { label: "Parked domain",   color: palette.danger,        bg: palette.dangerBg,  tone: "bad" },
  placeholder_site:       { label: "Placeholder site",color: palette.warning,       bg: palette.warningBg, tone: "warn" },
  directory_page:         { label: "Directory page",  color: palette.warning,       bg: palette.warningBg, tone: "warn" },
  aggregator_page:        { label: "Aggregator page", color: palette.warning,       bg: palette.warningBg, tone: "warn" },
  thin_site:              { label: "Thin site",       color: palette.warning,       bg: palette.warningBg, tone: "warn" },
  unreachable:            { label: "Unreachable",     color: palette.danger,        bg: palette.dangerBg,  tone: "bad" },
  unknown:                { label: "Unclassified",    color: palette.textSecondary, bg: palette.surfaceHover, tone: "warn" },
};

function classifyWebsite(lead) {
  if (lead.siteStatus && SITE_STATUS[lead.siteStatus]) {
    return { status: lead.siteStatus, confidence: lead.siteConfidence ?? "high" };
  }
  const weaknesses = (lead.topWeaknesses ?? []).join(" ").toLowerCase();
  const resolvedUrl = (lead.resolvedBusinessUrl || lead.domain || "").toLowerCase();

  if (/\bunreachable\b|\boffline\b|\bnot reachable\b|\bhttp 5\d\d\b/.test(weaknesses)) {
    return { status: "unreachable", confidence: "high" };
  }

  if (/[?&](domain|oref|traffictarget|utm_campaign=redirect|rkey|sub1)=/i.test(resolvedUrl)) {
    return { status: "aggregator_page", confidence: "high" };
  }

  if (/\/(parked|coming[-_.]?soon|under[-_.]?construction|domain[-_.]?for[-_.]?sale)(\.[a-z]+)?(\/|$)/i.test(resolvedUrl)
      || /sedoparking|parkingcrew|bodis|dan\.com\/sale|hugedomains\.com|godaddy.*park/i.test(resolvedUrl)) {
    return { status: "parked_domain", confidence: "high" };
  }

  if (/parked|coming soon|under construction|domain for sale|buy this domain/.test(weaknesses)) {
    return { status: "parked_domain", confidence: "high" };
  }

  if (/yellowpages|yelp\.com|bbb\.org|manta\.com|thumbtack|angi\.com|homeadvisor|nextdoor\.com|mapquest/i.test(resolvedUrl)
      || /\bdirectory\b|\baggregator\b|\blisting page\b/.test(weaknesses)) {
    return { status: "directory_page", confidence: "medium" };
  }

  if (/placeholder|lorem ipsum|default template|generic template|template article/.test(weaknesses)) {
    return { status: "placeholder_site", confidence: "medium" };
  }

  if (/blank|thin content|almost no content|effectively blank|one page site|single page site/.test(weaknesses)) {
    return { status: "thin_site", confidence: "medium" };
  }

  return { status: "verified_business_site", confidence: "medium" };
}

// ── Contact source and confidence ─────────────────────────────────────
// Canonical sources: Website | GBP | Directory | Social | Unverified

function normalizeContactSource(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (/gbp|google business|google maps|maps/.test(s)) return "GBP";
  if (/yelp|bbb|yellowpages|manta|thumbtack|angi|homeadvisor|nextdoor|directory/.test(s)) return "Directory";
  if (/facebook|instagram|linkedin|tiktok|twitter|social/.test(s)) return "Social";
  if (/website|site|homepage|domain/.test(s)) return "Website";
  if (/unverified|whois|inferred/.test(s)) return "Unverified";
  return null;
}

// Confidence tiers (aligned with the contact resolution engine contract):
//   High    — GBP source with a phone number
//   Medium  — Directory (BBB, Yelp, Angi, Chamber) match
//   Low     — Unverified or inferred (email guessed from domain pattern, WHOIS)
function contactSourceInfo(lead, siteStatus) {
  const c = lead.contacts || {};
  const normalized = normalizeContactSource(c.source);
  const verified = siteStatus === "verified_business_site";
  const hasPhone = !!c.primaryPhone;

  if (c.confidence) {
    return { source: normalized ?? "Unverified", confidence: c.confidence };
  }

  if (normalized === "GBP") {
    return { source: "GBP", confidence: hasPhone ? "high" : "medium" };
  }
  if (normalized === "Directory") {
    return { source: "Directory", confidence: "medium" };
  }
  if (normalized === "Website") {
    return { source: "Website", confidence: verified && hasPhone ? "high" : verified ? "medium" : "low" };
  }
  if (normalized === "Social") {
    return { source: "Social", confidence: "medium" };
  }
  if (normalized === "Unverified") {
    return { source: "Unverified", confidence: "low" };
  }

  // No explicit source. Derive from site status.
  if (verified && (hasPhone || c.primaryEmail)) {
    return { source: "Website", confidence: hasPhone ? "high" : "medium" };
  }
  return { source: "Unverified", confidence: "low" };
}

function confidenceColor(c) {
  if (c === "high") return palette.success;
  if (c === "medium") return palette.warning;
  if (c === "low") return palette.textTertiary;
  return palette.textSecondary;
}


// ── Default talk track (instant, no AI) ───────────────────────────────

function defaultTalkTrack(lead, user) {
  const weaknesses = (lead.topWeaknesses ?? []).map(stripDash);
  const loc = lead.location ?? "your area";
  const hasBlank = weaknesses.some((w) => /blank|thin|placeholder|parked|no content/i.test(w));
  const hasSeo = weaknesses.some((w) => /meta|SEO|title/i.test(w));

  const problem = proofFound(lead).slice(0, 3);

  const impact = hasBlank
    ? [
        `Customers searching for a roofer in ${loc} land on a dead page.`,
        `Trust breaks before they ever pick up the phone.`,
      ]
    : hasSeo
    ? [
        `Searches for roofers in ${loc} are not returning your business.`,
        `Referred customers also check search before they call.`,
      ]
    : [
        `This is costing credibility with customers who look you up.`,
        `Referred leads check the site before they call.`,
      ];

  return {
    open: `Hi, this is ${user.name} with LaborTech Solutions. I ran a live check on ${lead.name} and flagged a couple of items costing you inbound leads. Do you have 60 seconds?`,
    ask: [
      "How are most of your jobs coming in right now?",
      "Who handles your website and Google presence today?",
      "What does a strong month look like for new jobs?",
    ],
    problem,
    impact,
    close: "Worth 15 minutes this week so I can walk through what I found and how we fix it?",
    voicemail: `Hi, ${user.name} with LaborTech. Our live check on ${lead.name}'s site flagged items costing you inbound leads. Quick callback and I will walk you through them. Thanks.`,
  };
}

function normalizeAiScript(ai, lead, user) {
  const base = defaultTalkTrack(lead, user);
  if (!ai) return base;
  const open = stripDash(ai.opener || base.open);
  const ask = Array.isArray(ai.discoveryQuestions) && ai.discoveryQuestions.length > 0
    ? ai.discoveryQuestions.slice(0, 3).map(stripDash)
    : base.ask;
  let problem = base.problem;
  if (ai.weaknessTransition) {
    const txt = stripDash(ai.weaknessTransition);
    problem = txt.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (problem.length === 0) problem = base.problem;
  }
  let impact = base.impact;
  if (ai.valueProp) {
    const txt = stripDash(ai.valueProp);
    impact = txt.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (impact.length === 0) impact = base.impact;
  }
  return {
    open,
    ask,
    problem,
    impact,
    close: stripDash(ai.closeAsk || base.close),
    voicemail: stripDash(ai.voicemailScript || base.voicemail),
  };
}

// ── Objections ────────────────────────────────────────────────────────

function defaultObjections(lead) {
  const hasBlank = (lead.topWeaknesses ?? []).some((w) => /blank|thin|placeholder|parked|no content/i.test(w));
  const trustLine = hasBlank
    ? "Right now the homepage serves no real business content, so every inbound click is wasted."
    : "Right now the site is not holding up when a customer looks you up.";
  return [
    {
      objection: "We already have someone handling marketing",
      response: "Understood, this is not a marketing pitch. I ran a live check on your site and flagged what a real customer sees today. Takes 10 minutes to walk through, and if your marketing person already caught it, that's the easiest call I'll have this week.",
      followUp: "When did your team last review what shows up when customers search your company name on Google?",
    },
    {
      objection: "We are too busy",
      response: "That's usually the sign you should hear this. Busy means referrals are strong, but a weak site is leaking the inbound you'd get on top of that. 10 minutes tops. I'll screen-share what I found and you tell me if it's worth a follow-up.",
      followUp: "What's the best time tomorrow or Thursday? 10 minutes, not a full demo.",
    },
    {
      objection: "Send me something",
      response: "Happy to. The one-pager won't explain as much as 10 minutes on a call where I can screen-share the live scan and point to exactly what a customer sees. I'll send the PDF after either way.",
      followUp: "Does Thursday morning or Friday afternoon work for a quick call?",
    },
    {
      objection: "We don't need this",
      response: "Fair. I'm not pitching a rebuild blind, I'm sharing what the live scan actually found. If the current site is already capturing inbound leads well, I'll say so. If not, we'll see it together in 10 minutes.",
      followUp: "How many quote requests are coming in through your site each month right now?",
    },
    {
      objection: "How did you find us",
      response: "I run live scans on roofing companies in the KC market. Yours came up with specific issues on the inbound flow, which is why I'm reaching out personally instead of blasting a generic template.",
      followUp: "Want me to walk through what the scan actually flagged?",
    },
    {
      objection: "We get enough work from referrals",
      response: `Makes sense. Referred customers still check the site before they call. ${trustLine} That's missed inbound you could be capturing on top of your referrals, not instead of them.`,
      followUp: "When did you last open your own site on a phone, the same way a customer would?",
    },
    {
      objection: "Not interested",
      response: "Fair enough. Before I hang up, what would have made this worth 10 minutes? And if it's just timing, when's better?",
      followUp: "Want me to send the scan report as a PDF to keep on file?",
    },
  ];
}

// Gatekeeper opener — used when the rep reaches an office manager or
// receptionist instead of the decision-maker. Short, respectful, direct.
function gatekeeperOpener(lead, user) {
  const company = lead.name;
  return `Hi, this is ${user?.name ?? "John"} with LaborTech Solutions. I'm following up on a live site check we ran for ${company}. Who's the best person on your team who handles the website and inbound lead flow? I'd rather talk to them directly than leave a message.`;
}

// ── Lead Row severity (accent bar color per lead) ─────────────────────

const ROW_SEV = {
  critical: "#DC2626",
  high:     "#F97316",
  medium:   "#3B82F6",
  low:      "#9CA3AF",
};

function rowSeverity(lead) {
  const weaknesses = (lead.topWeaknesses ?? []).length;
  const text = (lead.topWeaknesses ?? []).join(" ").toLowerCase();
  if (lead.forceAction) return "critical";
  if (lead.closeReadiness === "AT RISK") return "critical";
  if (/unreachable|parked|domain for sale/.test(text)) return "critical";
  if (weaknesses >= 4) return "critical";
  if (lead.recommendedAction === "CALL NOW") return "high";
  if (weaknesses >= 2 || /blank|thin|placeholder/.test(text)) return "high";
  if (lead.recommendedAction === "TODAY") return "medium";
  return "low";
}

// ── Lead Row ──────────────────────────────────────────────────────────

// Tier-based row styling — accent-first, not full-row wash.
//   CALL NOW  → red left bar + red badge, row stays mostly neutral
//   TODAY     → no left border, neutral row, amber badge
//   MONITOR   → no left border, soft muted row, grey badge
//   PASS      → no left border, more muted + dimmed, grey badge
// Hover adds a subtle tier-tinted highlight. Selection keeps the tier but
// never overrides its identity.
// Selected rows intentionally share ONE surface with the detail card
// (`palette.surface`). Tier identity is carried by the left border +
// the opportunity pill — never by the base fill. This eliminates the
// prior cool/warm mismatch where TODAY/MONITOR selected rows picked up
// `palette.surfaceSelected` (pale blue) while the card stayed warm
// white. Hover on *unselected* rows still gets a subtle tier tint.
const ROW_TIER_STYLE = {
  "CALL NOW": {
    border: palette.danger,            // red left bar carries the accent
    baseBg: palette.surface,
    stripeBg: "#FAFBFF",
    hoverBg: "#FFF5F5",                // subtle red hover (unselected only)
    selectedBg: palette.surface,       // matches detail card
    opacity: 1,
  },
  "TODAY": {
    border: "transparent",
    baseBg: palette.surface,
    stripeBg: "#F9FBFF",
    hoverBg: "#FEF7E0",                // subtle amber hover (unselected only)
    selectedBg: palette.surface,       // matches detail card
    opacity: 1,
  },
  "MONITOR": {
    border: "transparent",
    baseBg: "#FAFBFC",
    stripeBg: "#F4F7FC",
    hoverBg: "#EEF2F7",                // neutral grey hover (unselected only)
    selectedBg: palette.surface,       // matches detail card
    opacity: 0.95,
  },
  "PASS": {
    border: "transparent",
    baseBg: "#F4F7FC",
    stripeBg: "#EEF2F7",
    hoverBg: "#E5E9F0",
    selectedBg: palette.surface,       // matches detail card
    opacity: 0.85,
  },
};

function LeadRow({ lead, index, isSelected, onSelect, sectionBucket }) {
  const reason = dominantReason(lead);
  // Single source of truth: section bucket (passed in from ListSection).
  // Rows never render a bucket that conflicts with the section header.
  const tier = (sectionBucket && ROW_TIER_STYLE[sectionBucket])
    ? sectionBucket
    : "MONITOR";
  const t = ROW_TIER_STYLE[tier];
  const baseBg = index % 2 === 1 ? t.stripeBg : t.baseBg;
  const opp = opportunityMeta(tier);

  return (
    <div
      onClick={() => onSelect(lead)}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = t.hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isSelected ? t.selectedBg : baseBg;
      }}
      style={{
        ...S.row,
        background: isSelected ? t.selectedBg : baseBg,
        borderLeft: `4px solid ${t.border}`,
        opacity: t.opacity,
        ...(isSelected ? S.rowSelected : null),
      }}
    >
      <span style={S.rowRank}>{lead.rank}</span>
      <div style={S.rowLeft}>
        <div style={S.rowNameLine}>
          <span style={S.rowName}>{lead.name}</span>
          {lead.location && <span style={S.rowLoc}>{lead.location}</span>}
        </div>
        <div style={S.rowReason}>{reason}</div>
      </div>

      <div style={S.rowRight}>
        <span style={{
          ...S.oppPill,
          color: opp.color,
          background: opp.bg,
          border: `1px solid ${opp.border}`,
        }}>
          <span style={S.oppDot}>{opp.dot}</span>
          {tier}
        </span>
      </div>
    </div>
  );
}

// ── CRM presentation helpers ──────────────────────────────────────────
// Pure formatting functions used by the embedded CRM surfaces (Timeline
// + Follow-Up cards). No data mutation — read-only derivation from the
// CrmActivity / FollowUpTask shapes already persisted server-side.

function followUpTypeLabel(type) {
  if (type === "follow_up_call") return "Follow-up call";
  if (type === "follow_up_email") return "Follow-up email";
  if (type === "send_case_study") return "Send case study";
  if (type === "send_pricing") return "Send pricing";
  return "Custom";
}

function formatDueAt(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return iso; }
}

function formatTimelineTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

function timelineIcon(a) {
  if (a.metadata && a.metadata.kind === "follow_up_created") return "📌";
  if (a.metadata && a.metadata.kind === "follow_up_completed") return "✅";
  switch (a.activityType) {
    case "call": return "📞";
    case "voicemail": return "📮";
    case "email": return "✉️";
    case "text": return "💬";
    case "meeting": return "🤝";
    case "proposal_sent": return "📄";
    case "close_attempt": return "🎯";
    case "closed_won": return "🏁";
    case "closed_lost": return "🏁";
    case "note": return "📝";
    default: return "•";
  }
}

function timelineLabel(a) {
  if (a.metadata && a.metadata.kind === "follow_up_created") return "Follow-up scheduled";
  if (a.metadata && a.metadata.kind === "follow_up_completed") return "Follow-up completed";
  const type = a.activityType
    ? a.activityType.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
    : "Activity";
  const outcome = a.outcome ? ` · ${a.outcome.replace(/_/g, " ")}` : "";
  return `${type}${outcome}`;
}

// ── Expanded Detail ───────────────────────────────────────────────────

function LeadDetail({ lead, user, onUpdate, findTask, onStartFindContact }) {
  const leadKey = lead.key;

  const [script, setScript] = useState(() => {
    const hit = scriptCache.get(leadKey);
    return hit ? hit.data : defaultTalkTrack(lead, user);
  });
  const [scriptSource, setScriptSource] = useState(() => scriptCache.get(leadKey)?.source ?? "default");
  const [showScript, setShowScript] = useState(false);

  const [showObjections, setShowObjections] = useState(false);
  // Call Support tools — UI-only toggles that reveal existing decision
  // data in a call-friendly layout. No new backend logic. The whole
  // section collapses to a header row by default; the rep expands it
  // when they actually need a mid-call aid.
  const [callSupportTool, setCallSupportTool] = useState(null);
  const [callSupportExpanded, setCallSupportExpanded] = useState(false);

  // Embedded CRM state — timeline auto-loads for the current lead, and
  // follow-up tasks are fetched alongside so the Follow-Up card always
  // reflects what's actually persisted in data/followUps.json.
  const [followUps, setFollowUps] = useState([]);
  const [followUpsBusy, setFollowUpsBusy] = useState(false);
  const [newFollowUpTitle, setNewFollowUpTitle] = useState("");
  const [newFollowUpDue, setNewFollowUpDue] = useState("");
  const [newFollowUpType, setNewFollowUpType] = useState("follow_up_call");
  const [savedFlash, setSavedFlash] = useState(null);
  // Per-action state — each CRM write registers under a unique key and
  // transitions idle → saving → success → idle (or error → idle). Gives
  // every button precise per-click feedback instead of one global flag.
  // Shape: { [key]: { phase: "saving"|"success"|"error", message?: string } }
  const [actionState, setActionState] = useState({});
  // Most recent confirmation line rendered in the inline CRM rail under
  // the Ready-to-Act bar. Separate from `actionState` so it persists
  // beyond the 1.2s success tint without blocking the next click.
  const [crmRail, setCrmRail] = useState(null); // { tone, message, at }
  // Action chaining — after certain call outcomes we reveal the
  // follow-up composer with a smart pre-fill. Ref used for scroll-into-
  // view so the rep's eye lands on the next step automatically.
  const [followUpPrefillToken, setFollowUpPrefillToken] = useState(0);
  const followUpCardRef = useRef(null);
  // Confirmation for scoped activity-log clear. Stays false by default;
  // only flips to true after the rep clicks "Clear activity log" and
  // explicitly confirms in the inline prompt.
  const [confirmClearLog, setConfirmClearLog] = useState(false);

  const [showLog, setShowLog] = useState(false);
  const [logNote, setLogNote] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [logStatus, setLogStatus] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showScanModal, setShowScanModal] = useState(false);
  const [showCallMode, setShowCallMode] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const nowLabel = useMemo(() => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), []);

  const ref = useMemo(() => ({ name: lead.name, domain: lead.domain }), [lead.name, lead.domain]);

  const logOutreach = useCallback((activityType, outcome) => {
    // Remember recent assistant actions for the right rail.
    const HUMAN = {
      call_started:            "Call started",
      email_draft_opened:      "Email draft opened",
      email_copied:            "Email copied",
      email_opened_in_client:  "Opened in email client",
      domain_opened:           "Opened domain",
      listing_opened:          "Opened listing",
      contact_search_started:  "Started contact search",
      site_opened:             "Opened site",
    };
    recordAssistantAction(leadKey, HUMAN[activityType] ?? activityType, outcome || undefined);
    // Fire and forget. We do not block UI on this.
    (async () => {
      try {
        await callMcp("log_crm_activity", {
          company: ref,
          activityType,
          outcome: outcome ?? null,
          performedBy: user.id,
        });
        onUpdate?.();
      } catch {
        // swallow; logging should never interrupt the operator
      }
    })();
  }, [ref, user.id, onUpdate, leadKey]);

  // Background AI enhancement for talk track.
  useEffect(() => {
    const cached = scriptCache.get(leadKey);
    if (cached?.source === "ai") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await callMcp("generate_call_script", {
          company: ref, callerName: user.name, callerCompany: "LaborTech Solutions",
        });
        if (cancelled || !res?.data) return;
        const normalized = normalizeAiScript(res.data, lead, user);
        scriptCache.set(leadKey, { data: normalized, source: "ai" });
        setScript(normalized);
        setScriptSource("ai");
      } catch {
        // keep the default silently
      }
    })();
    return () => { cancelled = true; };
  }, [leadKey, ref, user, lead]);

  async function handleLog(type, outcome) {
    setLogLoading(true);
    await runAction(
      `log:${type}:${outcome ?? "none"}`,
      async () => {
        await callMcp("log_crm_activity", {
          company: ref,
          activityType: type,
          outcome,
          note: logNote || undefined,
          performedBy: user.id,
        });
        setLogNote("");
        setShowLog(false);
        await loadTimeline();
        onUpdate?.();
      },
      {
        successMessage: outcome ? `Activity logged: ${type.replace(/_/g, " ")} → ${outcome.replace(/_/g, " ")}` : `Activity logged: ${type.replace(/_/g, " ")}`,
        errorMessage: "Could not log activity — try again",
      }
    );
    setLogLoading(false);
  }

  async function handleAddNote() {
    const body = noteText.trim();
    if (!body) return;
    setNoteBusy(true);
    await runAction(
      "note:add",
      async () => {
        await callMcp("add_company_note", { company: ref, body, author: user.id });
        setNoteText("");
        setShowNote(false);
        await loadTimeline();
        onUpdate?.();
      },
      {
        successMessage: "Note saved to CRM",
        errorMessage: "Could not save note — try again",
      }
    );
    setNoteBusy(false);
  }

  // Equivalence map — a few legacy status strings in the snapshot
  // ("CALLED" written by old automations, "PITCHED" mid-pipeline) still
  // mean the same thing as the canonical set. Used so the current-state
  // highlight picks them up and the toggle-off test detects them.
  const STATUS_EQUIV = useMemo(() => ({
    CONTACTED: ["CONTACTED", "CALLED"],
    VOICEMAIL: ["VOICEMAIL"],
    EMAILED: ["EMAILED"],
    INTERESTED: ["INTERESTED", "PITCHED", "QUALIFIED"],
    FOLLOW_UP: ["FOLLOW_UP"],
    NOT_QUALIFIED: ["NOT_QUALIFIED", "SKIPPED"],
  }), []);

  // Two independent CRM groups — Call outcome and Next step. Each holds
  // one canonical value at a time. The visual selected state is driven
  // by these locals so the button always reflects what the rep just
  // saved (or cleared). On lead switch we hydrate from the single
  // stored status — whichever group it belongs to takes the value, the
  // other group starts null. The canonical CRM write still goes through
  // set_company_status; the locals are the UI-authoritative copy.
  const CALL_OUTCOME_GROUP = useMemo(() => ["CONTACTED", "VOICEMAIL", "EMAILED"], []);
  const NEXT_STEP_GROUP = useMemo(() => ["INTERESTED", "FOLLOW_UP", "NOT_QUALIFIED"], []);

  function groupOf(status) {
    if (CALL_OUTCOME_GROUP.includes(status)) return "callOutcome";
    if (NEXT_STEP_GROUP.includes(status)) return "nextStep";
    return null;
  }

  // Resolve a raw stored status (possibly legacy) to the canonical value
  // it represents, or null if it's not a ready-to-act status (e.g. NEW,
  // READY_TO_CALL, CLOSED_WON).
  function canonicalizeStatus(raw) {
    if (!raw) return null;
    const upper = raw.toUpperCase();
    for (const [canonical, aliases] of Object.entries(STATUS_EQUIV)) {
      if (aliases.includes(upper)) return canonical;
    }
    return null;
  }

  const [callOutcomeStatus, setCallOutcomeStatus] = useState(null);
  const [nextStepStatus, setNextStepStatus] = useState(null);

  // Hydrate the two group selections whenever the rep switches leads.
  // If the stored status maps to one of the groups, that button takes
  // the persisted value; the other group starts clean.
  useEffect(() => {
    const canonical = canonicalizeStatus(lead.accountSnapshot?.status || "");
    const group = canonical ? groupOf(canonical) : null;
    setCallOutcomeStatus(group === "callOutcome" ? canonical : null);
    setNextStepStatus(group === "nextStep" ? canonical : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadKey]);

  function isStatusActive(targetStatus) {
    if (CALL_OUTCOME_GROUP.includes(targetStatus)) return callOutcomeStatus === targetStatus;
    if (NEXT_STEP_GROUP.includes(targetStatus)) return nextStepStatus === targetStatus;
    // Fallback: defer to the stored lead status for any status not
    // bound to one of the two UI groups.
    const raw = (lead.accountSnapshot?.status || "").toUpperCase();
    return (STATUS_EQUIV[targetStatus] || [targetStatus]).includes(raw);
  }

  // Core writer — raw "set status to X" path. Callers decide whether X
  // is an update or a clear; the message carried by runAction adapts so
  // the rail can say "updated" vs "cleared" without duplicated logic.
  async function writeStatus(targetStatus, opts = {}) {
    if (!targetStatus) return;
    const { cleared = false, chainOnSuccess = true, clearedGroup = null, writeKey = null } = opts;
    const stateKey = writeKey || `status:${targetStatus}`;
    if (actionState[stateKey]?.phase === "saving") return;
    setStatusBusy(true);
    const label = targetStatus.replace(/_/g, " ").toLowerCase();
    await runAction(
      stateKey,
      async () => {
        await callMcp("set_company_status", {
          company: ref,
          status: targetStatus,
          changedBy: user.id,
        });
        // Only mutate the group-local state after the server confirms
        // the write. This is what guarantees the visual selected/
        // deselected state can never drift from what's actually saved.
        if (cleared) {
          if (clearedGroup === "callOutcome") setCallOutcomeStatus(null);
          else if (clearedGroup === "nextStep") setNextStepStatus(null);
          else { setCallOutcomeStatus(null); setNextStepStatus(null); }
        } else {
          const grp = groupOf(targetStatus);
          if (grp === "callOutcome") setCallOutcomeStatus(targetStatus);
          else if (grp === "nextStep") setNextStepStatus(targetStatus);
        }
        await loadTimeline();
        onUpdate?.();
      },
      {
        successMessage: cleared
          ? (clearedGroup === "callOutcome" ? "Call result cleared"
            : clearedGroup === "nextStep" ? "Next move cleared"
            : "Status cleared")
          : (groupOf(targetStatus) === "callOutcome" ? "Call result saved"
            : groupOf(targetStatus) === "nextStep" ? "Next move saved"
            : `Status updated to ${label}`),
        errorMessage: cleared
          ? "Could not clear — try again"
          : `Could not save — try again`,
        onSuccess: () => {
          if (chainOnSuccess && !cleared) chainAfterStatus(targetStatus);
        },
      }
    );
    setStatusBusy(false);
  }

  // Toggle entry point used by every Ready-to-Act button. If the status
  // is already selected (per-group local state), this is a clear — we
  // write READY_TO_CALL and null out that group locally on success.
  // Otherwise this is a save — we write the new status and update that
  // group. Single-selection within the group falls out because only one
  // slot can hold a value.
  async function handleStatusToggle(targetStatus) {
    if (!targetStatus) return;
    if (isStatusActive(targetStatus)) {
      const grp = groupOf(targetStatus);
      await writeStatus("READY_TO_CALL", {
        cleared: true,
        clearedGroup: grp,
        // Key the saving/success/error phase on the clicked button so
        // the rep sees feedback on the exact control they pressed even
        // though the wire status is READY_TO_CALL.
        writeKey: `status:${targetStatus}`,
      });
      return;
    }
    await writeStatus(targetStatus);
  }

  // Scoped reset — clears both groups for THIS lead card only. Writes
  // READY_TO_CALL to the CRM so statusHistory reflects the reset. Notes
  // and activity log stay intact.
  async function handleClearCardStatus() {
    if (actionState["status:card-clear"]?.phase === "saving") return;
    await writeStatus("READY_TO_CALL", {
      cleared: true,
      clearedGroup: null,
      writeKey: "status:card-clear",
    });
  }

  // Scoped reset — deletes every CRM activity entry for this one lead.
  // Confirmation-gated client-side (via confirmClearLog below) AND
  // server-side (the MCP tool requires confirm=true). Does not touch
  // notes, status, follow-ups, or any other lead.
  async function handleClearCardActivity() {
    if (actionState["activity:card-clear"]?.phase === "saving") return;
    await runAction(
      "activity:card-clear",
      async () => {
        await callMcp("clear_company_activity", {
          company: ref,
          confirm: true,
          performedBy: user.id,
        });
        await loadTimeline();
      },
      {
        successMessage: "Activity log cleared",
        errorMessage: "Could not clear activity log",
      }
    );
  }

  // Back-compat: legacy callers (CallMode, CallQueue) still pass a raw
  // status and expect a straight write. Keep handleStatusChange as the
  // unconditional writer so those paths don't accidentally toggle off.
  async function handleStatusChange(nextStatus) {
    await writeStatus(nextStatus);
  }

  // Action chaining — after certain call outcomes, pre-fill the
  // follow-up composer and scroll it into view. Kept intentionally
  // lightweight: no modal, no overlay, just a gentle nudge.
  function chainAfterStatus(status) {
    const chain = {
      INTERESTED: { type: "follow_up_call", title: "Follow-up call: confirm interest & next steps" },
      VOICEMAIL:  { type: "follow_up_call", title: "Retry call (after voicemail)" },
      EMAILED:    { type: "follow_up_email", title: "Check email reply" },
      FOLLOW_UP:  { type: "follow_up_call", title: "Scheduled follow-up" },
    };
    const prefill = chain[status];
    if (!prefill) return;
    // Only pre-fill when the rep hasn't already started typing.
    setNewFollowUpType(prefill.type);
    setNewFollowUpTitle((cur) => (cur.trim() ? cur : prefill.title));
    setFollowUpPrefillToken((n) => n + 1);
    // Scroll the follow-up card into view after React paints.
    requestAnimationFrame(() => {
      followUpCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  async function loadTimeline() {
    try {
      const res = await callMcp("get_company_timeline", { company: ref, limit: 20 });
      setTimeline(res.data?.timeline ?? []);
    } catch {
      setTimeline([]);
    }
  }

  async function loadFollowUps() {
    try {
      const res = await callMcp("list_follow_ups", { scope: "company", company: ref });
      setFollowUps(res.data?.tasks ?? []);
    } catch {
      setFollowUps([]);
    }
  }

  // Brief "Saved to CRM" confirmation. 1.8s is long enough to read, short
  // enough not to compete with the next action.
  function flashSaved(message) {
    setSavedFlash(message);
    setTimeout(() => setSavedFlash(null), 1800);
  }

  // runAction — single code path every CRM write goes through so the rep
  // sees the same idle → saving → success / error progression on every
  // button. Callers provide the async work, a stable `key` for button
  // state, and human-readable success/error messages for the inline rail.
  async function runAction(key, fn, opts = {}) {
    const { successMessage, errorMessage, railTone = "success", onSuccess } = opts;
    // Dedupe: if this exact key is already saving, the user clicked
    // twice before the round-trip finished — drop the second click.
    if (actionState[key]?.phase === "saving") return { ok: false };
    setActionState((prev) => ({ ...prev, [key]: { phase: "saving" } }));
    try {
      const result = await fn();
      setActionState((prev) => ({ ...prev, [key]: { phase: "success" } }));
      if (successMessage) {
        setCrmRail({ tone: railTone, message: successMessage, at: Date.now() });
        flashSaved(successMessage);
      }
      if (onSuccess) {
        try { onSuccess(result); } catch { /* onSuccess is UX sugar; never fail the action over it */ }
      }
      setTimeout(() => {
        setActionState((prev) => {
          const cur = prev[key];
          if (!cur || cur.phase !== "success") return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 1200);
      return { ok: true, result };
    } catch (err) {
      const message = errorMessage || "CRM update failed — try again";
      setActionState((prev) => ({ ...prev, [key]: { phase: "error", message } }));
      setCrmRail({ tone: "error", message, at: Date.now() });
      setTimeout(() => {
        setActionState((prev) => {
          const cur = prev[key];
          if (!cur || cur.phase !== "error") return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 3000);
      return { ok: false, error: err };
    }
  }

  async function handleCreateFollowUp() {
    const title = newFollowUpTitle.trim();
    if (!title) return;
    setFollowUpsBusy(true);
    const { ok } = await runAction(
      "followup:create",
      async () => {
        await callMcp("create_follow_up", {
          company: ref,
          taskType: newFollowUpType,
          title,
          dueAt: newFollowUpDue || undefined,
          createdBy: user.id,
        });
        setNewFollowUpTitle("");
        setNewFollowUpDue("");
        setNewFollowUpType("follow_up_call");
        await Promise.all([loadFollowUps(), loadTimeline()]);
      },
      {
        successMessage: "Follow-up scheduled in CRM",
        errorMessage: "Could not save follow-up — try again",
      }
    );
    setFollowUpsBusy(false);
    return ok;
  }

  async function handleCompleteFollowUp(taskId) {
    setFollowUpsBusy(true);
    await runAction(
      `followup:complete:${taskId}`,
      async () => {
        await callMcp("complete_follow_up", { taskId, completedBy: user.id });
        await Promise.all([loadFollowUps(), loadTimeline()]);
      },
      {
        successMessage: "Follow-up marked complete",
        errorMessage: "Could not complete follow-up",
      }
    );
    setFollowUpsBusy(false);
  }

  // Auto-load the CRM surfaces (timeline + follow-ups) whenever the rep
  // switches leads. Keeps the UI in sync with the persisted state without
  // the rep having to hit a "refresh" button. Also dismisses any
  // dangling confirmation prompts so switching doesn't carry them over.
  useEffect(() => {
    loadTimeline();
    loadFollowUps();
    setConfirmClearLog(false);
    setCallSupportExpanded(false);
    setCallSupportTool(null);
    setShowObjections(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadKey]);

  const objections = defaultObjections(lead);
  const site = classifyWebsite(lead);
  const sev = severity(lead, site.status);
  const srcInfo = contactSourceInfo(lead, site.status);
  const trust = trustInfo(lead, site.status, nowLabel);
  const oppKey = opportunityLabel(lead);
  const opp = opportunityMeta(oppKey);
  const oppView = opportunityView(lead);
  // Prefer site-specific issue bullets (from inspect_website.issues[]) so
  // the block reads: top issue (headline) → 2–4 issue bullets (non-duplicate
  // of the headline) → single impact line. Falls back to engine-level
  // strategic reasons only when no issues are on file (legacy snapshots).
  const bullets = issueBullets(lead);
  const reasons = bullets.length > 0
    ? bullets
    : Array.isArray(lead.reasons) && lead.reasons.length > 0
      ? lead.reasons.slice(0, 4)
      : buildReasons(lead, site.status);

  const searchingFor = findTask && findTask.leadKey === lead.key && findTask.status === "running"
    ? findTask.steps[findTask.cursor]?.label ?? null
    : null;

  const externalSite = siteHref(lead);
  const siteStatus = siteUsability(lead);

  return (
    <div style={S.detail}>
      {/* 0. NEXT ACTION — command-center card above the header. Tells the
          rep exactly what to do next + the reason + confidence, and
          launches Call Mode when the action is CALL NOW / FOLLOW UP. */}
      {lead.nextAction && (
        <NextActionBlock
          nextAction={lead.nextAction}
          canCall={!!lead.contacts?.primaryPhone}
          onEnterCallMode={() => setShowCallMode(true)}
          onCall={() => {
            copyText(lead.contacts?.primaryPhone || "").catch(() => {});
            logOutreach("call_started", "next_action");
          }}
          phoneHref={lead.contacts?.primaryPhone ? telHref(lead.contacts.primaryPhone) : null}
          mailtoHref={lead.contacts?.primaryEmail ? buildQuickMailto(lead.contacts.primaryEmail) : null}
          onOpenScan={() => { setShowScanModal(true); logOutreach("scan_viewed", "next_action"); }}
        />
      )}

      {/* 1. COMPANY HEADER CARD — single bordered card with company
          meta on the left, prominent phone + Call Now on the right, and
          an evenly-spaced action row at the bottom. */}
      {(() => {
        const tradeKey = lead.trade || TRADE_DEFAULT;
        const trade = getTradeModule(tradeKey);
        const bucket = getServiceBucket(tradeKey, lead.serviceBucket);
        const hasPhoneAtHeader = !!lead.contacts?.primaryPhone;
        return (
          <div style={S.companyHeaderCard}>
            <div style={S.companyHeaderTop}>
              <div style={S.companyHeaderLeft}>
                <div style={S.headerName}>{lead.name}</div>
                <div style={S.companyHeaderMetaRow}>
                  {lead.location && <span style={S.companyHeaderLocation}>{lead.location}</span>}
                  <span style={S.tradeChip}>{trade.label}</span>
                  {bucket && <span style={S.serviceBucketChip}>{bucket.label}</span>}
                </div>
                <div style={S.companyHeaderTrust}>
                  <span style={S.trustItemInline}>
                    <span style={S.trustKey}>Source</span>
                    <span style={S.trustValue}>{trust.source}</span>
                  </span>
                  <span style={S.trustSep}>·</span>
                  <span style={S.trustItemInline}>
                    <span style={S.trustKey}>Last Checked</span>
                    <span style={S.trustValue}>{trust.lastChecked}</span>
                  </span>
                  <span style={S.trustSep}>·</span>
                  <span style={S.trustItemInline}>
                    <span style={S.trustKey}>Confidence</span>
                    <span style={{ ...S.trustValue, color: confidenceBadgeColor(trust.confidence), fontWeight: 700 }}>
                      {trust.confidence}
                    </span>
                  </span>
                </div>
              </div>
              <div style={S.companyHeaderRight}>
                {hasPhoneAtHeader ? (
                  <>
                    <div style={S.companyHeaderPhoneLabel}>Primary Phone</div>
                    <div style={S.companyHeaderPhone}>{lead.contacts.primaryPhone}</div>
                    {/* Paired CTA group — primary Call Now + secondary Call
                        Script, aligned horizontally at the same height so
                        the rep reads them as one action cluster. */}
                    <div style={S.companyHeaderCtaRow}>
                      <a
                        href={telHref(lead.contacts.primaryPhone)}
                        onClick={() => {
                          copyText(lead.contacts.primaryPhone || "").catch(() => {});
                          logOutreach("call_started", "header");
                        }}
                        style={S.companyHeaderCallBtn}
                      >
                        📞 Call Now
                      </a>
                      <button
                        type="button"
                        onClick={() => setShowScript((v) => !v)}
                        style={showScript ? S.companyHeaderScriptBtnActive : S.companyHeaderScriptBtn}
                      >
                        {showScript ? "Hide Script" : "📝 Call Script"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={S.companyHeaderPhoneLabel}>Primary Phone</div>
                    <div style={{ ...S.companyHeaderPhone, color: palette.textTertiary }}>Not on file</div>
                    <div style={S.companyHeaderCtaRow}>
                      <button
                        type="button"
                        onClick={() => onStartFindContact?.(lead)}
                        style={S.companyHeaderCallBtnMuted}
                      >
                        Find Contact
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowScript((v) => !v)}
                        style={showScript ? S.companyHeaderScriptBtnActive : S.companyHeaderScriptBtn}
                      >
                        {showScript ? "Hide Script" : "📝 Call Script"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

          </div>
        );
      })()}

      {/* 2. DECISION CORE — problem + impact + reasons + lost leads + reach */}
      <DecisionCore
        lead={lead}
        sev={sev}
        site={site}
        reasons={reasons}
        oppView={oppView}
        searchingFor={searchingFor}
        findTask={findTask}
        srcInfo={srcInfo}
        externalSite={externalSite}
        siteStatus={siteStatus}
        onCall={() => logOutreach("call_started", "dialed")}
        onCopyPhone={async () => {
          // One-click Copy: prefer the phone; fall back to email when no
          // phone is on file. Status line reflects what was copied.
          const phone = lead.contacts?.primaryPhone;
          const email = lead.contacts?.primaryEmail;
          const target = phone || email;
          if (!target) return;
          await copyText(target);
          setLogStatus(phone ? "Phone copied" : "Email copied");
          setTimeout(() => setLogStatus(null), 1600);
          logOutreach(phone ? "phone_copied" : "email_copied", null);
        }}
        onLogCall={() => setShowLog(true)}
        onLogAttempt={() => { logOutreach("call", "no_answer"); setLogStatus("Attempt logged"); setTimeout(() => setLogStatus(null), 1600); }}
        onOpenDomain={() => logOutreach("domain_opened", null)}
        onOpenPage={() => logOutreach("listing_opened", lead.fallbackRoute ?? "fallback")}
        onOpenScan={() => { setShowScanModal(true); logOutreach("scan_viewed", "operator"); }}
        onFindContact={() => {
          logOutreach("contact_search_started", "assistant");
          onStartFindContact?.(lead);
        }}
        onExpandSources={() => {
          logOutreach("contact_search_expanded", "assistant");
          onStartFindContact?.(lead);
        }}
      />

      {/* 4. AUDIT SNAPSHOT — full-width card. Label + description on the
          LEFT, View Scan (primary) + site-status tag on the RIGHT. Detailed
          findings live in the Decision Core and the Scan Report; this card
          only surfaces the access point. */}
      {(() => {
        const siteMeta = SITE_STATUS[site.status] ?? SITE_STATUS.unknown;
        return (
          <div style={S.auditSnapshotCard}>
            <div style={S.auditSnapshotLeft}>
              <div style={S.auditSnapshotLabel}>Audit Snapshot</div>
              <div style={S.auditSnapshotDesc}>
                Live-check diagnostics — tap View Scan for the full report.
              </div>
            </div>
            <div style={S.auditSnapshotRight}>
              {externalSite && siteStatus.usable && (
                <a
                  href={externalSite}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => logOutreach("site_opened", "audit_snapshot")}
                  style={S.auditSnapshotSiteBtn}
                  title={externalSite}
                >
                  View Site
                </a>
              )}
              <button
                type="button"
                onClick={() => { setShowScanModal(true); logOutreach("scan_viewed", "audit_snapshot"); }}
                style={S.auditSnapshotScanBtn}
              >
                🔍 View Scan
              </button>
              <span
                style={{
                  ...S.auditSnapshotStatusTag,
                  color: siteMeta.color,
                  background: siteMeta.bg,
                }}
                title={siteStatus.reason || ""}
              >
                {siteMeta.label}
              </span>
            </div>
          </div>
        );
      })()}

      {/* 5. READY TO ACT — bottom action bar. Six status buttons split
          into two semantic groups so the rep reads outcome first, next
          step second. Each button is a TOGGLE: click to select, click
          again to clear back to READY_TO_CALL. Single-selection within
          a group falls out naturally (setting A overwrites whatever B
          was). Skip maps to NOT_QUALIFIED so it participates in the
          same pattern. */}
      {(() => {
        function renderStatusBtn(status, label, tone) {
          const phase = actionState[`status:${status}`]?.phase;
          const errorMessage = actionState[`status:${status}`]?.message;
          const active = isStatusActive(status);
          const base = S.readyToActBtn;
          const activeTone = tone === "success"
            ? { color: palette.success, borderColor: "rgba(22,163,74,0.55)", background: palette.successBg }
            : tone === "muted"
              ? { color: palette.textSecondary }
              : {};
          const baseStyle = { ...base, ...activeTone };
          let style = baseStyle;
          let content = label;
          let title;
          if (phase === "saving") {
            style = { ...baseStyle, color: palette.textSecondary, background: palette.surfaceHover, cursor: "wait" };
            content = <span><span style={S.actionSpinner}>⟳</span> Saving…</span>;
          } else if (phase === "success") {
            style = { ...baseStyle, color: palette.success, borderColor: "rgba(22,163,74,0.55)", background: palette.successBg };
            content = <span>✓ Saved</span>;
          } else if (phase === "error") {
            style = { ...baseStyle, color: palette.danger, borderColor: "rgba(220,38,38,0.45)", background: palette.dangerBg };
            content = <span>⚠ Try again</span>;
          } else if (active) {
            // Selected (CRM already parked here). Filled background,
            // checkmark, stronger border. Click again to clear.
            if (tone === "success") {
              style = {
                ...baseStyle, color: "#fff",
                background: palette.success, borderColor: palette.success,
                boxShadow: "0 1px 2px rgba(22,163,74,0.25)",
              };
            } else if (tone === "muted") {
              style = {
                ...baseStyle, color: palette.textPrimary,
                background: palette.surfaceHover, borderColor: palette.textSecondary,
              };
            } else {
              style = {
                ...baseStyle, color: palette.blue,
                background: palette.bluePale, borderColor: palette.blue,
                boxShadow: "0 1px 2px rgba(37,99,235,0.15)",
              };
            }
            content = <span>✓ {label}</span>;
            title = "Click to clear";
          }
          return (
            <button
              key={status}
              type="button"
              disabled={phase === "saving"}
              title={errorMessage || title || undefined}
              aria-pressed={active}
              onClick={() => handleStatusToggle(status)}
              style={style}
            >
              {content}
            </button>
          );
        }
        return (
          <div style={S.readyToActCard}>
            <div style={S.readyToActHeader}>Ready to Act</div>
            <div style={S.readyToActGroupedRow}>
              <div style={S.readyToActGroup}>
                <div style={S.readyToActGroupLabel}>Call result</div>
                <div style={S.readyToActGroupButtons}>
                  {renderStatusBtn("CONTACTED", "Mark Called")}
                  {renderStatusBtn("VOICEMAIL", "Left Voicemail")}
                  {renderStatusBtn("EMAILED", "Sent Email")}
                </div>
              </div>
              <div style={S.readyToActGroupDivider} aria-hidden="true" />
              <div style={S.readyToActGroup}>
                <div style={S.readyToActGroupLabel}>Next move</div>
                <div style={S.readyToActGroupButtons}>
                  {renderStatusBtn("INTERESTED", "Interested", "success")}
                  {renderStatusBtn("FOLLOW_UP", "Follow Up")}
                  {renderStatusBtn("NOT_QUALIFIED", "Skip", "muted")}
                </div>
              </div>
            </div>

            {/* Inline CRM status rail — lightweight confirmation line
                that persists below the bar after each save so the rep
                always has a visible trail of what landed. */}
            {crmRail && (
              <div
                style={{
                  ...S.crmRail,
                  color: crmRail.tone === "error" ? palette.danger : palette.success,
                  background: crmRail.tone === "error" ? palette.dangerBg : palette.successBg,
                  borderColor: crmRail.tone === "error" ? "rgba(220,38,38,0.35)" : "rgba(22,163,74,0.35)",
                }}
                role="status"
              >
                <span style={S.crmRailIcon}>{crmRail.tone === "error" ? "⚠" : "✓"}</span>
                <span style={S.crmRailMessage}>{crmRail.message}</span>
                <button
                  type="button"
                  onClick={() => setCrmRail(null)}
                  style={S.crmRailDismiss}
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}

            {/* Scoped reset controls — visually secondary. Only affect
                THIS lead card. Status clear is a one-click scoped
                reset; activity log clear requires inline confirmation
                because it destroys history. */}
            <div style={S.cardResetRow}>
              {(() => {
                const statusPhase = actionState["status:card-clear"]?.phase;
                const hasSelection = !!(callOutcomeStatus || nextStepStatus);
                const disabled = statusPhase === "saving" || !hasSelection;
                let label = "Clear card status";
                if (statusPhase === "saving") label = "Clearing…";
                else if (statusPhase === "success") label = "✓ Cleared";
                else if (statusPhase === "error") label = "⚠ Retry";
                return (
                  <button
                    type="button"
                    onClick={handleClearCardStatus}
                    disabled={disabled}
                    title={hasSelection ? "Clear both Call Outcome and Next Step for this lead" : "Nothing to clear"}
                    style={disabled ? S.cardResetBtnDisabled : S.cardResetBtn}
                  >
                    {label}
                  </button>
                );
              })()}
              {(() => {
                const activityPhase = actionState["activity:card-clear"]?.phase;
                const noActivity = !timeline || timeline.length === 0;
                if (!confirmClearLog) {
                  let label = "Clear activity log";
                  if (activityPhase === "saving") label = "Clearing…";
                  else if (activityPhase === "success") label = "✓ Cleared";
                  else if (activityPhase === "error") label = "⚠ Retry";
                  return (
                    <button
                      type="button"
                      onClick={() => setConfirmClearLog(true)}
                      disabled={activityPhase === "saving" || noActivity}
                      title={noActivity ? "Nothing to clear" : "Delete every activity entry for this lead"}
                      style={(activityPhase === "saving" || noActivity) ? S.cardResetBtnDisabled : S.cardResetBtn}
                    >
                      {label}
                    </button>
                  );
                }
                return (
                  <div style={S.cardResetConfirm}>
                    <span style={S.cardResetConfirmText}>
                      Delete {timeline?.length ?? 0} activity entr{(timeline?.length ?? 0) === 1 ? "y" : "ies"} for this lead? This can't be undone.
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmClearLog(false)}
                      style={S.cardResetConfirmCancel}
                      disabled={activityPhase === "saving"}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleClearCardActivity();
                        setConfirmClearLog(false);
                      }}
                      disabled={activityPhase === "saving"}
                      style={S.cardResetConfirmApply}
                    >
                      {activityPhase === "saving" ? "Clearing…" : "Yes, delete"}
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}

      {/* 6. FOLLOW-UP — sits directly under Ready to Act so the rep
          moves naturally from "what just happened" to "what happens
          next". Persists via create_follow_up / complete_follow_up.
          Card highlights whenever the Next move is Interested or
          Follow Up (or the composer was pre-filled by chaining). */}
      {(() => {
        const openTasks = followUps.filter((t) => t.status === "open");
        const completedTasks = followUps.filter((t) => t.status === "completed").slice(0, 3);
        const next = openTasks[0];
        const createPhase = actionState["followup:create"]?.phase;
        const createError = actionState["followup:create"]?.message;
        const nextStepAnchors = nextStepStatus === "INTERESTED" || nextStepStatus === "FOLLOW_UP";
        const composerHighlighted = (
          nextStepAnchors
          || (followUpPrefillToken > 0 && newFollowUpTitle.trim() && !createPhase)
        );
        let createLabel = "Schedule follow-up";
        if (createPhase === "saving") createLabel = "Saving…";
        else if (createPhase === "success") createLabel = "✓ Scheduled";
        else if (createPhase === "error") createLabel = "⚠ Try again";
        return (
          <div ref={followUpCardRef} style={composerHighlighted ? S.crmCardHighlighted : S.crmCard}>
            <div style={S.crmCardHead}>
              <div style={S.crmCardLabel}>Follow-Up</div>
              <div style={S.crmCardSub}>
                {openTasks.length > 0
                  ? `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`
                  : "No follow-ups scheduled yet"}
              </div>
            </div>

            {next && (() => {
              const completePhase = actionState[`followup:complete:${next.id}`]?.phase;
              const completeError = actionState[`followup:complete:${next.id}`]?.message;
              let completeStyle = S.followUpCompleteBtn;
              let completeLabel = "✓ Mark complete";
              if (completePhase === "saving") {
                completeStyle = { ...S.followUpCompleteBtn, background: palette.textSecondary, borderColor: palette.textSecondary, cursor: "wait" };
                completeLabel = <><span style={S.actionSpinner}>⟳</span> Saving…</>;
              } else if (completePhase === "success") {
                completeLabel = "✓ Marked complete";
              } else if (completePhase === "error") {
                completeStyle = { ...S.followUpCompleteBtn, background: palette.danger, borderColor: palette.danger };
                completeLabel = "⚠ Try again";
              }
              return (
                <div style={S.followUpNextRow}>
                  <div style={S.followUpNextBody}>
                    <div style={S.followUpNextTitle}>{next.title}</div>
                    <div style={S.followUpNextMeta}>
                      <span style={S.followUpNextType}>{followUpTypeLabel(next.taskType)}</span>
                      {next.dueAt && <span style={S.followUpNextDue}>Due {formatDueAt(next.dueAt)}</span>}
                      {next.assignedUserId && <span style={S.followUpNextOwner}>Owner: {next.assignedUserId}</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={completePhase === "saving"}
                    onClick={() => handleCompleteFollowUp(next.id)}
                    title={completeError || undefined}
                    style={completeStyle}
                  >
                    {completeLabel}
                  </button>
                </div>
              );
            })()}

            {openTasks.length > 1 && (
              <ul style={S.followUpListSecondary}>
                {openTasks.slice(1).map((t) => {
                  const phase = actionState[`followup:complete:${t.id}`]?.phase;
                  let label = "Done";
                  if (phase === "saving") label = "Saving…";
                  else if (phase === "success") label = "✓ Done";
                  else if (phase === "error") label = "⚠ Retry";
                  return (
                    <li key={t.id} style={S.followUpListItem}>
                      <span style={S.followUpListDot}>•</span>
                      <span style={S.followUpListText}>
                        {t.title}
                        {t.dueAt && <span style={S.followUpListDue}> — due {formatDueAt(t.dueAt)}</span>}
                      </span>
                      <button
                        type="button"
                        disabled={phase === "saving"}
                        onClick={() => handleCompleteFollowUp(t.id)}
                        style={S.followUpListDone}
                      >
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Quick-create composer — pre-fills after INTERESTED /
                VOICEMAIL / EMAILED / FOLLOW_UP via chainAfterStatus.
                Prompt text adapts to which condition triggered the
                highlight so it reads as the next-step cue, not noise. */}
            <div style={S.followUpComposer}>
              {composerHighlighted && (
                <div style={S.followUpPrefillHint}>
                  <span>
                    {nextStepAnchors
                      ? (nextStepStatus === "INTERESTED"
                          ? "Lock it in — schedule the follow-up while they're warm."
                          : "Next move is a follow-up. Set the date so it lands on your queue.")
                      : "Pre-filled from your last action — edit or schedule as-is."}
                  </span>
                </div>
              )}
              <div style={S.followUpComposerRow}>
                <select
                  value={newFollowUpType}
                  onChange={(e) => setNewFollowUpType(e.target.value)}
                  style={S.followUpTypeSelect}
                  disabled={createPhase === "saving"}
                >
                  <option value="follow_up_call">Call</option>
                  <option value="follow_up_email">Email</option>
                  <option value="send_case_study">Send case study</option>
                  <option value="send_pricing">Send pricing</option>
                  <option value="custom">Custom</option>
                </select>
                <input
                  type="text"
                  value={newFollowUpTitle}
                  onChange={(e) => setNewFollowUpTitle(e.target.value)}
                  placeholder="What needs to happen next?"
                  style={S.followUpTitleInput}
                  disabled={createPhase === "saving"}
                />
              </div>
              <div style={S.followUpComposerRow}>
                <input
                  type="datetime-local"
                  value={newFollowUpDue}
                  onChange={(e) => setNewFollowUpDue(e.target.value)}
                  style={S.followUpDueInput}
                  disabled={createPhase === "saving"}
                />
                <button
                  type="button"
                  onClick={handleCreateFollowUp}
                  disabled={createPhase === "saving" || !newFollowUpTitle.trim()}
                  title={createError || undefined}
                  style={
                    createPhase === "success"
                      ? { ...S.followUpCreateBtn, background: palette.success, borderColor: palette.success }
                      : createPhase === "error"
                        ? { ...S.followUpCreateBtn, background: palette.danger, borderColor: palette.danger }
                        : (createPhase === "saving" || !newFollowUpTitle.trim())
                          ? S.followUpCreateBtnDisabled
                          : S.followUpCreateBtn
                  }
                >
                  {createLabel}
                </button>
              </div>
              {createPhase === "error" && createError && (
                <div style={S.crmInlineError}>{createError}</div>
              )}
            </div>

            {completedTasks.length > 0 && (
              <div style={S.followUpCompletedRow}>
                <span style={S.followUpCompletedLabel}>Recently completed:</span>
                {completedTasks.map((t) => (
                  <span key={t.id} style={S.followUpCompletedChip} title={t.completedAt}>
                    {t.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* 7. CALL SUPPORT — sits below Follow-Up so it reads as an aid
          the rep pulls in only when needed, not a primary action.
          Collapsed to a header row by default; expanding reveals the
          tile grid and inline panels. All content is derived from
          existing decision data — no new backend. */}
      {(() => {
        const tools = [
          { key: "objections", icon: "🛡", label: "Handle Objections", descriptor: "Pre-built counters for pushback" },
          { key: "benefits",   icon: "✨", label: "Key Benefits",      descriptor: "The strongest reasons they close" },
          { key: "cases",      icon: "📚", label: "Case Studies",      descriptor: "Trade-specific proof points" },
          { key: "pricing",    icon: "💵", label: "Pricing Guide",     descriptor: "Value framing + deal range" },
          { key: "rebuild",    icon: "🛠", label: "Rebuild Process",   descriptor: "Step-by-step close plan" },
        ];
        function onToolClick(key) {
          if (key === "objections") {
            setShowObjections((v) => !v);
            setCallSupportTool(null);
            return;
          }
          setShowObjections(false);
          setCallSupportTool((prev) => (prev === key ? null : key));
        }
        const activeKey = showObjections ? "objections" : callSupportTool;
        const tradeKey = lead.trade || TRADE_DEFAULT;
        const tradeModule = getTradeModule(tradeKey);
        const activeToolCount = (showObjections ? 1 : 0) + (callSupportTool ? 1 : 0);
        return (
          <div style={S.callSupportCard}>
            <button
              type="button"
              onClick={() => setCallSupportExpanded((v) => !v)}
              aria-expanded={callSupportExpanded}
              style={S.callSupportToggle}
            >
              <div style={S.callSupportToggleLeft}>
                <div style={S.callSupportLabel}>Call Support</div>
                <div style={S.callSupportSub}>
                  {callSupportExpanded
                    ? "Use these tools to handle objections and move the deal forward."
                    : activeToolCount > 0
                      ? `${activeToolCount} tool open — click to review`
                      : "Objections · Benefits · Case studies · Pricing · Rebuild process"}
                </div>
              </div>
              <span style={S.callSupportChevron}>{callSupportExpanded ? "▾" : "▸"}</span>
            </button>

            {callSupportExpanded && (
              <>
                <div style={S.callSupportGrid}>
                  {tools.map((t) => {
                    const active = activeKey === t.key;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => onToolClick(t.key)}
                        style={active ? S.callSupportTileActive : S.callSupportTile}
                      >
                        <span style={S.callSupportTileIcon}>{t.icon}</span>
                        <span style={S.callSupportTileLabel}>{t.label}</span>
                        <span style={S.callSupportTileDesc}>{t.descriptor}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Inline panels — each reuses existing decision data.
                    Objection Handling renders here (inside Call Support)
                    so the full list stays anchored to its trigger tile,
                    above the Activity Timeline in the render tree. */}
                {showObjections && (
                  <div style={S.callSupportPanel}>
                    <div style={S.callSupportPanelTitle}>Objection Handling</div>
                    <div style={S.objList}>
                      {objections.map((o, i) => (
                        <ObjectionCard key={i} objection={o} />
                      ))}
                    </div>
                  </div>
                )}
                {callSupportTool === "benefits" && (
                  <div style={S.callSupportPanel}>
                    <div style={S.callSupportPanelTitle}>Key Benefits</div>
                    {lead.whyThisCloses && (
                      <p style={S.callSupportPanelBody}>{lead.whyThisCloses}</p>
                    )}
                    {Array.isArray(lead.serviceRecommendations) && lead.serviceRecommendations.length > 0 && (
                      <ul style={S.callSupportPanelList}>
                        {lead.serviceRecommendations.slice(0, 4).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    )}
                    {!lead.whyThisCloses && !(lead.serviceRecommendations || []).length && (
                      <div style={S.callSupportPanelEmpty}>No benefit summary available for this lead yet.</div>
                    )}
                  </div>
                )}
                {callSupportTool === "cases" && (
                  <div style={S.callSupportPanel}>
                    <div style={S.callSupportPanelTitle}>Case Studies — {tradeModule.label}</div>
                    <div style={S.callSupportPanelBody}>
                      Anchor proof to similar {tradeModule.label.toLowerCase()} operators who closed the same LaborTech rebuild. Use the closest one in your library when the rep asks for social proof.
                    </div>
                    <div style={S.callSupportPanelEmpty}>No case-study template is wired to this lead — cite from your collateral library.</div>
                  </div>
                )}
                {callSupportTool === "pricing" && (
                  <div style={S.callSupportPanel}>
                    <div style={S.callSupportPanelTitle}>Pricing Guide</div>
                    {lead.valueEstimate ? (
                      <ul style={S.callSupportPanelList}>
                        {lead.valueEstimate.monthlyLeadLoss && <li><strong>Monthly lead loss:</strong> {lead.valueEstimate.monthlyLeadLoss}</li>}
                        {lead.valueEstimate.annualUpside && <li><strong>Annual upside:</strong> {lead.valueEstimate.annualUpside}</li>}
                        {lead.valueEstimate.estimatedContractValue && <li><strong>Estimated contract value:</strong> {lead.valueEstimate.estimatedContractValue}</li>}
                        {lead.valueEstimate.reasoning && <li>{lead.valueEstimate.reasoning}</li>}
                      </ul>
                    ) : (
                      <div style={S.callSupportPanelEmpty}>No value estimate on this lead yet — run a refresh to generate one.</div>
                    )}
                  </div>
                )}
                {callSupportTool === "rebuild" && (
                  <div style={S.callSupportPanel}>
                    <div style={S.callSupportPanelTitle}>Rebuild Process</div>
                    {lead.closePlan ? (
                      <ol style={S.callSupportPanelList}>
                        {lead.closePlan.step1 && <li>{lead.closePlan.step1}</li>}
                        {lead.closePlan.step2 && <li>{lead.closePlan.step2}</li>}
                        {lead.closePlan.step3 && <li>{lead.closePlan.step3}</li>}
                      </ol>
                    ) : (
                      <div style={S.callSupportPanelEmpty}>No close plan on file yet.</div>
                    )}
                  </div>
                )}

                {/* Bottom utility — Detailed Log. Secondary by design. */}
                <div style={S.callSupportUtilityRow}>
                  <button
                    type="button"
                    onClick={() => setShowLog((v) => !v)}
                    style={showLog ? S.readyToActUtilityBtnActive : S.readyToActUtilityBtn}
                  >
                    {showLog ? "Cancel Log" : "Detailed Log"}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* 8. ACTIVITY TIMELINE — always-visible CRM timeline pulled from
          data/crmActivities.json via get_company_timeline. Replaces the
          prior on-demand "History" toggle so the rep can always see
          what's persisted. */}
      <div style={S.crmCard}>
        <div style={S.crmCardHead}>
          <div style={S.crmCardLabel}>Activity Timeline</div>
          <div style={S.crmCardSub}>
            {timeline && timeline.length > 0
              ? `${timeline.length} recorded event${timeline.length === 1 ? "" : "s"}`
              : "No activity recorded yet"}
          </div>
        </div>
        {timeline === null ? (
          <div style={S.crmEmpty}>Loading timeline…</div>
        ) : timeline.length === 0 ? (
          <div style={S.crmEmpty}>
            No calls, emails, notes, or status changes on file for this lead yet.
            Every action you take from this screen writes to the CRM.
          </div>
        ) : (
          <ul style={S.timelineList}>
            {timeline.slice(0, 10).map((a) => {
              const icon = timelineIcon(a);
              const label = timelineLabel(a);
              return (
                <li key={a.id} style={S.timelineItem}>
                  <span style={S.timelineIcon}>{icon}</span>
                  <div style={S.timelineBody}>
                    <div style={S.timelineHead}>
                      <span style={S.timelineHeadLabel}>{label}</span>
                      <span style={S.timelineHeadMeta}>
                        {formatTimelineTime(a.performedAt)}
                        {a.performedBy && <> · {a.performedBy}</>}
                      </span>
                    </div>
                    {a.note && <div style={S.timelineNote}>{a.note}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Toast — short, high-confidence confirmation that a write landed
          in the CRM. Sits at the LeadDetail level so it covers any
          persistence action (status, note, follow-up). */}
      {savedFlash && (
        <div style={S.crmSavedFlash}>{savedFlash}</div>
      )}

      {/* Expandable content */}

      {showScript && (
        <Section label="Talk Track">
          <TalkTrackView script={script} gatekeeper={gatekeeperOpener(lead, user)} />
          <div style={S.statusCalm}>
            {scriptSource === "ai" ? "Script ready" : "Structured script ready"}
          </div>
        </Section>
      )}

      {showLog && (
        <Section label="Detailed Log">
          {logStatus && <div style={S.statusCalm}>{logStatus}</div>}
          <Subsection label="Log This Call">
            <input
              type="text"
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              placeholder="Quick note about the call"
              style={S.logInput}
            />
            <div style={S.logBtns}>
              {[
                ["Spoke with them", "call", "connected"],
                ["No answer", "call", "no_answer"],
                ["Left voicemail", "voicemail", "left_vm"],
                ["Sent email", "email", "follow_up_needed"],
                ["They are interested", "call", "interested", palette.success],
                ["Not interested", "closed_lost", "not_interested", palette.danger],
              ].map(([btnLabel, type, outcome, color]) => (
                <button
                  key={btnLabel}
                  style={{ ...S.logBtn, ...(color ? { color } : {}) }}
                  disabled={logLoading}
                  onClick={() => handleLog(type, outcome)}
                >
                  {btnLabel}
                </button>
              ))}
            </div>
          </Subsection>
        </Section>
      )}

      {showCompose && (
        <EmailComposer
          lead={lead}
          user={user}
          onClose={() => setShowCompose(false)}
          onLog={(activityType) => logOutreach(activityType, null)}
        />
      )}

      {showScanModal && (
        <ScanModal
          lead={lead}
          trust={trust}
          site={site}
          siteStatus={siteStatus}
          proof={proofFound(lead)}
          onClose={() => setShowScanModal(false)}
        />
      )}

      {showCallMode && (
        <CallMode
          lead={lead}
          script={script}
          objections={objections}
          gatekeeper={gatekeeperOpener(lead, user)}
          noteText={noteText}
          noteBusy={noteBusy}
          statusBusy={statusBusy}
          logStatus={logStatus}
          onNoteChange={setNoteText}
          onSaveNote={handleAddNote}
          onStatusChange={handleStatusChange}
          onCall={() => {
            copyText(lead.contacts?.primaryPhone || "").catch(() => {});
            logOutreach("call_started", "call_mode");
            // The tel: link on the Call button handles navigation natively.
          }}
          onOpenScan={() => { setShowScanModal(true); logOutreach("scan_viewed", "call_mode"); }}
          onClose={() => setShowCallMode(false)}
        />
      )}
    </div>
  );
}

// Scan report — Meridian AI's deepest audit surface. Every field surfaced
// here comes from an observed inspection signal; nothing is invented or
// filled with placeholder copy. Sections render conditionally based on
// which fields the inspector actually captured.
// Call Mode — focused live-call interface. Full-screen overlay. Top strip
// carries the identity + phone + next-action reason. Main column is the
// structured script + objections. Side rail is notes + one-click status
// updates + quick links. Reuses every handler from the main lead view.
function CallMode({
  lead, script, objections, gatekeeper,
  noteText, noteBusy, statusBusy, logStatus,
  onNoteChange, onSaveNote, onStatusChange,
  onCall, onOpenScan, onClose,
  queueBar, // optional: rendered above the top strip when active
  hideBackdrop, // optional: skip the outer modal backdrop (queue owns it)
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = lead.contacts || {};
  const phone = c.primaryPhone;
  const email = c.primaryEmail;
  const tradeKey = lead.trade || TRADE_DEFAULT;
  const trade = getTradeModule(tradeKey);
  const bucket = getServiceBucket(tradeKey, lead.serviceBucket);
  const mailto = email ? buildQuickMailto(email) : null;
  const siteUrl = siteHref(lead);
  const reason = lead.nextAction?.reason;
  const supportDetail = lead.nextAction?.supportDetail;
  const why = lead.whyThisCloses;

  // "Say this first" — the opener the rep delivers verbatim. Uses the
  // script's opener when Claude generated one; otherwise a sharper
  // deterministic default that names the impact up front.
  const firstName = (lead.contacts?.contactName || "").split(/\s+/)[0];
  const sayThisFirst = script?.open
    || (firstName
        ? `Hey ${firstName}, quick heads up — I ran a check on your site and there are a couple things that could be costing you inbound jobs. Thought it made sense to call directly.`
        : `Quick heads up — I ran a check on your site and there are a couple things that could be costing you inbound jobs. Worth 60 seconds?`);

  // "Why this is worth your time" — 3-bullet confidence strip. Pulls from
  // existing signals; never fabricates.
  const worthPoints = (() => {
    const points = [];
    const fit = lead.labortechFit?.overall;
    if (fit === "STRONG FIT") points.push("Strong fit — real business, weak digital presence.");
    else if (fit === "GOOD FIT") points.push("Good fit — digital gaps worth a 10-minute call.");
    const topIssue = lead.websiteProof?.issues?.[0];
    if (topIssue?.description) {
      points.push(`Clear issue detected: ${topIssue.description.replace(/\.$/, "").slice(0, 90)}.`);
    }
    if (lead.serviceRecommendations?.length) {
      points.push(`Easy opener: lead with ${lead.serviceRecommendations[0]}.`);
    } else if (lead.whyThisCloses) {
      points.push("Clean angle — the opener writes itself.");
    }
    return points.slice(0, 3);
  })();

  const statusOptions = [
    { value: "CONTACTED",     label: "Called" },
    { value: "VOICEMAIL",     label: "Left VM" },
    { value: "EMAILED",       label: "Sent Email" },
    { value: "INTERESTED",    label: "Interested" },
    { value: "FOLLOW_UP",     label: "Follow Up" },
    { value: "NOT_QUALIFIED", label: "Not Qualified" },
    { value: "CLOSED_WON",    label: "Closed Won" },
    { value: "CLOSED_LOST",   label: "Closed Lost" },
  ];

  const frame = (
    <div style={S.callModeFrame} onClick={(e) => e.stopPropagation()}>
      {/* Optional queue progress bar (Call Queue Mode) */}
      {queueBar}

      {/* Top strip — identity + phone + why */}
      <div style={S.callModeTop}>
          <div style={S.callModeTopLeft}>
            <div style={S.callModeEyebrow}>🎧 Call Mode</div>
            <div style={S.callModeName}>{lead.name}</div>
            <div style={S.callModeMeta}>
              {lead.location && <span>{lead.location}</span>}
              <span style={S.callModeDot}>·</span>
              <span>{trade.label}</span>
              {bucket && (
                <>
                  <span style={S.callModeDot}>·</span>
                  <span>{bucket.label}</span>
                </>
              )}
            </div>
          </div>
          <div style={S.callModeTopRight}>
            {phone ? (
              <a
                href={telHref(phone)}
                onClick={onCall}
                style={S.callModePhone}
                title="Tap to dial"
              >
                <div style={S.callModePhoneLabel}>Call</div>
                <div style={S.callModePhoneNumber}>{phone}</div>
              </a>
            ) : (
              <div style={{ ...S.callModePhone, opacity: 0.5 }}>
                <div style={S.callModePhoneLabel}>No phone on file</div>
              </div>
            )}
            <button type="button" onClick={onClose} style={S.callModeExit}>Exit</button>
          </div>
        </div>

        {/* Reason strip — Closing angle promoted first so the rep
            internalizes it before the call starts. */}
        {(reason || why || supportDetail) && (
          <div style={S.callModeReasonStrip}>
            {why && (
              <div style={S.callModeReasonLine}>
                <span style={{ ...S.callModeReasonKey, color: palette.blue }}>Closing angle</span>
                <span style={{ ...S.callModeReasonValue, color: palette.blue, fontWeight: 600 }}>{why}</span>
              </div>
            )}
            {reason && (
              <div style={S.callModeReasonLine}>
                <span style={S.callModeReasonKey}>Why now</span>
                <span style={S.callModeReasonValue}>{reason}</span>
              </div>
            )}
            {supportDetail && (
              <div style={S.callModeReasonLine}>
                <span style={S.callModeReasonKey}>Pitch</span>
                <span style={S.callModeReasonValue}>{supportDetail}</span>
              </div>
            )}
          </div>
        )}

        {/* Body: script main + side rail */}
        <div style={S.callModeBody}>
          <div style={S.callModeScript}>
            {/* Why this is worth your time — 2–3 bullets that reduce
                hesitation before dialling. All pulled from existing
                decision signals; never fabricated. */}
            {worthPoints.length > 0 && (
              <div style={S.worthBlock}>
                <div style={S.worthLabel}>Why this is worth your time</div>
                <ul style={S.worthList}>
                  {worthPoints.map((p, i) => (
                    <li key={i} style={S.worthItem}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Say this first — highlighted opener */}
            <div style={S.saySayThisFirst}>
              <div style={S.saySayThisLabel}>Say this first</div>
              <div style={S.saySayThisQuote}>“{sayThisFirst}”</div>
            </div>

            <CallModeScriptSection label="Gatekeeper (if answered by front-desk / office)" body={gatekeeper} muted />
            <CallModeScriptSection label="What we noticed" list={script?.problem} />
            <CallModeScriptSection label="Why it matters" list={script?.impact} />
            <CallModeScriptSection label="Question to engage them" list={script?.ask} />
            <CallModeScriptSection label="Close" body={script?.close} accent />
            <CallModeScriptSection label="Voicemail" body={script?.voicemail} muted italic />

            {/* Objections */}
            {Array.isArray(objections) && objections.length > 0 && (
              <div style={S.callModeObjections}>
                <div style={S.callModeSectionLabel}>Objection handling</div>
                <div style={S.callModeObjectionList}>
                  {objections.map((o, i) => (
                    <details key={i} style={S.callModeObjectionItem}>
                      <summary style={S.callModeObjectionSummary}>{o.objection}</summary>
                      <div style={S.callModeObjectionBody}>
                        <div style={S.callModeObjectionLabel}>Response</div>
                        <div style={S.callModeObjectionResponse}>{o.response}</div>
                        {o.followUp && (
                          <>
                            <div style={S.callModeObjectionLabel}>Follow up</div>
                            <div style={S.callModeObjectionResponse}>{o.followUp}</div>
                          </>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Side rail — notes + status + quick links */}
          <div style={S.callModeSide}>
            <div style={S.callModeSideSection}>
              <div style={S.callModeSectionLabel}>Quick status</div>
              <div style={S.callModeStatusGrid}>
                {statusOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onStatusChange(opt.value)}
                    disabled={statusBusy}
                    style={S.callModeStatusBtn}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={S.callModeSideSection}>
              <div style={S.callModeSectionLabel}>Note</div>
              <textarea
                value={noteText}
                onChange={(e) => onNoteChange(e.target.value)}
                placeholder={`Quick note about ${lead.name}…`}
                rows={4}
                disabled={noteBusy}
                style={S.callModeNote}
              />
              <button
                type="button"
                onClick={onSaveNote}
                disabled={noteBusy || !noteText.trim()}
                style={noteText.trim() ? S.callModeNoteSave : S.callModeNoteSaveDisabled}
              >
                {noteBusy ? "Saving…" : "Save Note"}
              </button>
            </div>

            <div style={S.callModeSideSection}>
              <div style={S.callModeSectionLabel}>Quick links</div>
              <div style={S.callModeLinkRow}>
                {mailto && (
                  <a href={mailto} style={S.callModeLinkBtn}>Send Email</a>
                )}
                {siteUrl && (
                  <a href={siteUrl} target="_blank" rel="noopener noreferrer" style={S.callModeLinkBtn}>Open Website</a>
                )}
                <button type="button" onClick={onOpenScan} style={S.callModeLinkBtn}>View Scan</button>
              </div>
            </div>

            {logStatus && <div style={S.callModeFlash}>{logStatus}</div>}
          </div>
        </div>
      </div>
  );

  // Optional backdrop: normal single-lead Call Mode owns one; Call Queue
  // Mode manages its own outer backdrop and passes hideBackdrop=true so
  // two don't stack.
  if (hideBackdrop) return frame;
  return (
    <div style={S.callModeBackdrop} onClick={onClose}>
      {frame}
    </div>
  );
}

// ── Call Queue — guided one-lead-at-a-time execution mode ──
// Wraps CallMode, adds a top progress bar, owns per-session state
// (note composer, status updates, stats, skipped leads). After a status
// change or note save the queue auto-advances. Completion screen shows
// session totals and next-steps.
function CallQueue({ leads, user, filterLabel, onExit, onRestart, onStartFollowUps, hasFollowUps }) {
  const [index, setIndex] = useState(0);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [logStatus, setLogStatus] = useState(null);
  const [stats, setStats] = useState({
    callsAttempted: 0,
    called: 0,
    voicemails: 0,
    emails: 0,
    interested: 0,
    skipped: 0,
  });
  const total = leads.length;
  const current = leads[index];
  const advanceTimerRef = useRef(null);

  // Reset per-lead state whenever the current lead changes.
  useEffect(() => {
    setNoteText("");
    setLogStatus(null);
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, [current?.key]);

  // ESC exits the queue.
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onExit?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const script = useMemo(() => current ? defaultTalkTrack(current, user) : null, [current, user]);
  const objections = useMemo(() => current ? defaultObjections(current) : [], [current]);
  const gatekeeper = current ? gatekeeperOpener(current, user) : null;

  function scheduleAdvance(flash) {
    if (flash) setLogStatus(flash);
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      setIndex((i) => i + 1);
    }, 900);
  }

  async function handleSaveNote() {
    const body = noteText.trim();
    if (!body || !current) return;
    setNoteBusy(true); setLogStatus(null);
    try {
      await callMcp("add_company_note", {
        company: { name: current.name, domain: current.domain },
        body,
        author: user.id,
      });
      setNoteText("");
      scheduleAdvance("✓ Note saved — next lead ready");
    } catch {
      setLogStatus("Could not save note.");
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleStatusChange(nextStatus) {
    if (!nextStatus || !current || statusBusy) return;
    setStatusBusy(true); setLogStatus(null);
    try {
      await callMcp("set_company_status", {
        company: { name: current.name, domain: current.domain },
        status: nextStatus,
        changedBy: user.id,
      });
      // Session stats — CONTACTED / VOICEMAIL / INTERESTED each count as a
      // call attempt; EMAILED is a pure email outcome.
      setStats((s) => {
        const next = { ...s };
        const isCallAttempt = nextStatus === "CONTACTED"
          || nextStatus === "VOICEMAIL"
          || nextStatus === "INTERESTED";
        if (isCallAttempt) next.callsAttempted++;
        if (nextStatus === "CONTACTED") next.called++;
        else if (nextStatus === "VOICEMAIL") next.voicemails++;
        else if (nextStatus === "EMAILED") next.emails++;
        else if (nextStatus === "INTERESTED") next.interested++;
        return next;
      });
      scheduleAdvance("✓ Saved — next lead ready");
    } catch {
      setLogStatus("Could not update status.");
    } finally {
      setStatusBusy(false);
    }
  }

  function handleSkip() {
    if (!current) return;
    setStats((s) => ({ ...s, skipped: s.skipped + 1 }));
    setLogStatus("Skipped — next lead ready");
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => setIndex((i) => i + 1), 500);
  }

  // Completion screen — queue empty or walked through
  if (!current) {
    return (
      <div style={S.callModeBackdrop}>
        <div style={{ ...S.callModeFrame, maxWidth: "640px" }}>
          <div style={{ ...S.callModeTop, borderBottom: "none" }}>
            <div style={S.callModeTopLeft}>
              <div style={S.callModeEyebrow}>🎧 Queue Complete</div>
              <div style={S.callModeName}>
                {total === 0 ? "No leads in this queue" : `Walked ${total} lead${total === 1 ? "" : "s"}`}
              </div>
              <div style={S.callModeMeta}>
                {filterLabel && <span>Filter: {filterLabel}</span>}
              </div>
            </div>
            <button type="button" onClick={onExit} style={S.callModeExit}>Exit</button>
          </div>
          {total > 0 && (
            <div style={{ padding: "20px 24px" }}>
              <div style={S.queueStatsGrid}>
                <QueueStat label="Calls Attempted" value={stats.callsAttempted} accent={palette.blue} />
                <QueueStat label="Called"          value={stats.called} />
                <QueueStat label="Voicemails"      value={stats.voicemails} />
                <QueueStat label="Emails"          value={stats.emails} />
                <QueueStat label="Interested"      value={stats.interested} accent={palette.success} />
                <QueueStat label="Skipped"         value={stats.skipped} />
              </div>
              <div style={S.queueCompletionNextLabel}>Keep the momentum going</div>
              <div style={S.queueCompletionActions}>
                {onRestart && (
                  <button type="button" onClick={onRestart} style={S.nextActionPrimaryBtn}>
                    🎧 Run Queue Again
                  </button>
                )}
                {hasFollowUps && onStartFollowUps && (
                  <button type="button" onClick={onStartFollowUps} style={S.todayBtnMuted}>
                    Close Deals (Follow Ups)
                  </button>
                )}
                <button type="button" onClick={onExit} style={S.todayBtnMuted}>
                  Follow Up Later
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Dynamic queue label — always tells the rep the scope ("12 leads to
  // work") so momentum stays live.
  const remaining = Math.max(total - index, 0);
  const queueLabel = filterLabel
    ? `Call Queue — ${filterLabel}`
    : `Call Queue — ${remaining} lead${remaining === 1 ? "" : "s"} to work`;

  const queueBar = (
    <div style={S.queueBar}>
      <div style={S.queueBarLeft}>
        <span style={S.queueBarLabel}>{queueLabel}</span>
      </div>
      <div style={S.queueBarProgress}>
        <span style={S.queueBarPosition}>Lead {index + 1} of {total}</span>
        <div style={S.queueProgressTrack}>
          <div style={{ ...S.queueProgressFill, width: `${Math.round(((index) / Math.max(total, 1)) * 100)}%` }} />
        </div>
      </div>
      <div style={S.queueBarActions}>
        <button type="button" onClick={handleSkip} style={S.queueSkipBtn} disabled={statusBusy || noteBusy}>
          Skip →
        </button>
        <button type="button" onClick={onExit} style={S.callModeExit}>Exit</button>
      </div>
    </div>
  );

  return (
    <div style={S.callModeBackdrop} onClick={onExit}>
      <CallMode
        lead={current}
        script={script}
        objections={objections}
        gatekeeper={gatekeeper}
        noteText={noteText}
        noteBusy={noteBusy}
        statusBusy={statusBusy}
        logStatus={logStatus}
        onNoteChange={setNoteText}
        onSaveNote={handleSaveNote}
        onStatusChange={handleStatusChange}
        onCall={() => { /* tel: native navigation */ }}
        onOpenScan={() => { /* queue mode keeps scan out of flow */ }}
        onClose={onExit}
        queueBar={queueBar}
        hideBackdrop={true}
      />
    </div>
  );
}

function QueueStat({ label, value, accent }) {
  return (
    <div style={S.queueStatCell}>
      <div style={{ ...S.queueStatValue, color: accent ?? palette.textPrimary }}>{value}</div>
      <div style={S.queueStatLabel}>{label}</div>
    </div>
  );
}

// Reusable script section for Call Mode.
function CallModeScriptSection({ label, body, list, accent, muted, italic }) {
  if (!body && (!list || list.length === 0)) return null;
  return (
    <div style={S.callModeScriptSection}>
      <div style={S.callModeSectionLabel}>{label}</div>
      {body && (
        <div style={{
          ...S.callModeScriptBody,
          ...(accent ? { color: palette.blue, fontWeight: 500 } : {}),
          ...(muted ? { color: palette.textSecondary } : {}),
          ...(italic ? { fontStyle: "italic" } : {}),
        }}>
          {body}
        </div>
      )}
      {Array.isArray(list) && list.length > 0 && (
        <ul style={S.callModeScriptList}>
          {list.slice(0, 4).map((x, i) => (
            <li key={i} style={S.callModeScriptListItem}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Next Action block — the lead's command center. Dominant single action,
// reason, confidence, and (when the action supports it) the Enter Call
// Mode trigger. Uses existing design tokens — no new component system.
// Enriches the raw action label with a command-style suffix so the block
// reads as an order, not a suggestion. Confidence drives which suffix.
function decorateActionLabel(action, confidence) {
  const conf = String(confidence || "").toUpperCase();
  if (action === "CALL NOW") {
    return conf === "HIGH" ? "CALL NOW — DO THIS FIRST" : "CALL NOW — HIGH PRIORITY";
  }
  if (action === "FOLLOW UP") {
    return conf === "HIGH" ? "FOLLOW UP — CLOSE THIS" : "FOLLOW UP — WARM LEAD";
  }
  if (action === "EMAIL FIRST") return "EMAIL FIRST — NO PHONE YET";
  if (action === "REVIEW SITE FIRST") return "REVIEW SITE FIRST";
  if (action === "SKIP FOR NOW") return "SKIP FOR NOW";
  return action;
}

function NextActionBlock({ nextAction, canCall, onEnterCallMode, mailtoHref }) {
  const { action, confidence, reason, supportDetail } = nextAction;
  const meta = NEXT_ACTION_META[action] ?? NEXT_ACTION_META["REVIEW SITE FIRST"];
  const decorated = decorateActionLabel(action, confidence);

  // Primary right-side action button. The Next Action bar owns exactly
  // one CTA — Enter Call Mode — regardless of which action variant is
  // recommended. Call Now lives on the Company Header, Send Email in
  // Quick Actions, and View Scan in Audit Snapshot; this bar is not the
  // place to duplicate them.
  const hasReach = canCall || !!mailtoHref;
  const primaryAction = hasReach ? (
    <button type="button" onClick={onEnterCallMode} style={S.nextActionPrimaryBtn}>
      🎧 Enter Call Mode
    </button>
  ) : null;

  return (
    <div style={{
      ...S.nextActionBar,
      background: meta.bg,
      borderLeft: `4px solid ${meta.accent}`,
    }}>
      {/* LEFT — Next Action label + decorated pill */}
      <div style={S.nextActionBarLeft}>
        <span style={S.nextActionLabel}>Next Action</span>
        <div style={{
          ...S.nextActionChip,
          color: meta.accent,
          borderColor: meta.accent,
          background: palette.surface,
        }}>
          {decorated}
        </div>
      </div>

      {/* CENTER — one clean sentence explaining why */}
      <div style={S.nextActionBarCenter}>
        <div style={S.nextActionReason}>{reason}</div>
        {supportDetail && <div style={S.nextActionSupport}>{supportDetail}</div>}
      </div>

      {/* RIGHT — confidence badge + primary action */}
      <div style={S.nextActionBarRight}>
        <span style={{
          ...S.nextActionConfidenceBadge,
          color: confidenceBadgeColor(String(confidence || "").toUpperCase()),
          borderColor: confidenceBadgeColor(String(confidence || "").toUpperCase()),
        }}>
          {String(confidence || "").toUpperCase()}
        </span>
        {primaryAction}
      </div>
    </div>
  );
}

// Action-specific accent tokens for the Next Action block.
const NEXT_ACTION_META = {
  "CALL NOW":          { accent: palette.danger,   bg: "#FFF7F7" },
  "EMAIL FIRST":       { accent: palette.blue,     bg: palette.bluePale },
  "REVIEW SITE FIRST": { accent: palette.warning,  bg: palette.warningBg },
  "FOLLOW UP":         { accent: palette.blue,     bg: palette.bluePale },
  "SKIP FOR NOW":      { accent: palette.textTertiary, bg: palette.surfaceHover },
};

function ScanModal({ lead, trust, site, proof, siteStatus, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const siteMeta = SITE_STATUS[site.status] ?? SITE_STATUS.unknown;
  const wp = lead.websiteProof || null;
  const est = lead.opportunityEstimate || null;
  const c = lead.contacts || {};
  const classification = wp?.site_classification;
  const fmtBytes = (n) => (typeof n === "number" ? `${n.toLocaleString()} bytes` : "—");
  const fmtChars = (n) => (typeof n === "number" ? `${n.toLocaleString()} chars` : "—");
  const fmtMs = (n) => (typeof n === "number" ? `${n.toLocaleString()} ms` : "—");
  const yn = (v) => (v === true ? "Yes" : v === false ? "No" : "—");

  return (
    <div style={S.modalBackdrop} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div>
            <div style={S.modalTitle}>Scan Report</div>
            <div style={S.modalSub}>{lead.name}{lead.location ? ` · ${lead.location}` : ""}</div>
          </div>
          <button type="button" onClick={onClose} style={S.modalClose}>✕</button>
        </div>

        {/* Parked / inactive truthfulness banner — only when the site is
            not a real business page. */}
        {siteStatus && !siteStatus.usable && (
          <div style={S.scanBanner}>
            <div style={S.scanBannerTitle}>{siteStatus.label}</div>
            <div style={S.scanBannerBody}>
              {siteStatus.reason || "This URL does not resolve to the business's own site."}
              {" "}Visitors are landing on a non-business page; treat the external domain as inactive.
            </div>
          </div>
        )}

        {/* Top-level cards — Source, Last Checked, Confidence, Classification */}
        <div style={S.scanGrid}>
          <div style={S.scanCell}>
            <div style={S.scanCellLabel}>Source</div>
            <div style={S.scanCellValue}>{trust.source}</div>
          </div>
          <div style={S.scanCell}>
            <div style={S.scanCellLabel}>Last Checked</div>
            <div style={S.scanCellValue}>{trust.lastChecked}</div>
          </div>
          <div style={S.scanCell}>
            <div style={S.scanCellLabel}>Confidence</div>
            <div style={{ ...S.scanCellValue, color: confidenceBadgeColor(trust.confidence), fontWeight: 700 }}>
              {trust.confidence}
            </div>
          </div>
          <div style={S.scanCell}>
            <div style={S.scanCellLabel}>Classification</div>
            <div style={{ ...S.scanCellValue, color: siteMeta.color, fontWeight: 600 }}>
              {classification ? classification.replace(/_/g, " ") : siteMeta.label}
            </div>
          </div>
        </div>

        {/* Key Issues Identified — copy-paste-ready top 2–3 findings.
            Sits at the top so a rep can read the scan's headline without
            scrolling. */}
        {Array.isArray(wp?.issues) && wp.issues.length > 0 && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Key Issues Identified</div>
            <ol style={S.scanKeyIssues}>
              {rankIssues(wp.issues).slice(0, 3).map((it, i) => (
                <li key={`${it.code}-${i}`} style={S.scanKeyIssuesItem}>
                  <span style={{
                    ...S.scanKeyIssuesSeverity,
                    color: severityColor(it.severity),
                    borderColor: severityColor(it.severity),
                  }}>
                    {String(it.severity || "low").toUpperCase()}
                  </span>
                  <span style={S.scanKeyIssuesText}>{stripTrailingPeriod(it.description)}.</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* A. Site Status — server-level facts */}
        {wp && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Site Status</div>
            <div style={S.scanGrid}>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Homepage fetch</div>
                <div style={{ ...S.scanCellValue, color: wp.homepage_fetch_ok ? palette.success : palette.danger, fontWeight: 600 }}>
                  {wp.homepage_fetch_ok ? "OK" : "Failed"}
                </div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>HTTP status</div>
                <div style={S.scanCellValue}>{wp.http_status ?? "—"}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Response time</div>
                <div style={S.scanCellValue}>{fmtMs(wp.response_ms)}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Transport</div>
                <div style={S.scanCellValue}>{trust.source && trust.source.includes("Live Website Scan") ? "—" : "—"}</div>
              </div>
            </div>
          </div>
        )}

        {/* B. Content Signals — what loaded on the page */}
        {wp && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Content Signals</div>
            <div style={S.scanGrid}>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Content length</div>
                <div style={S.scanCellValue}>{fmtBytes(wp.content_length)}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Visible text</div>
                <div style={S.scanCellValue}>{fmtChars(wp.visible_text_length)}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Headings (h1–h6)</div>
                <div style={S.scanCellValue}>{wp.heading_count ?? "—"}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Form fields</div>
                <div style={S.scanCellValue}>{wp.form_field_count ?? "—"}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Title tag</div>
                <div style={S.scanCellValue}>
                  {wp.has_title
                    ? (wp.title ? `"${wp.title.length > 60 ? wp.title.slice(0, 60) + "…" : wp.title}"` : "Present")
                    : "Missing"}
                </div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Meta description</div>
                <div style={S.scanCellValue}>
                  {wp.has_meta_description
                    ? (wp.meta_description ? `"${wp.meta_description.length > 80 ? wp.meta_description.slice(0, 80) + "…" : wp.meta_description}"` : "Present")
                    : "Missing"}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* C. Conversion Signals — can visitors actually act? */}
        {wp && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Conversion Signals</div>
            <div style={S.scanGrid}>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Contact form</div>
                <div style={{ ...S.scanCellValue, color: wp.has_contact_form ? palette.success : palette.warning }}>
                  {wp.has_contact_form ? "Detected" : "Not detected"}
                </div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Phone on site</div>
                <div style={S.scanCellValue}>{wp.phone_from_site || "Not published"}</div>
              </div>
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Email on site</div>
                <div style={S.scanCellValue}>{wp.email_from_site || "Not published"}</div>
              </div>
              {wp.page_speed_mobile != null && (
                <div style={S.scanCell}>
                  <div style={S.scanCellLabel}>PageSpeed (mobile)</div>
                  <div style={S.scanCellValue}>{wp.page_speed_mobile}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* D. Contact + Business Presence */}
        <div style={S.scanSection}>
          <div style={S.scanSectionLabel}>Contact &amp; Presence</div>
          <div style={S.scanGrid}>
            <div style={S.scanCell}>
              <div style={S.scanCellLabel}>Best contact source</div>
              <div style={S.scanCellValue}>{c.source || "None"}</div>
            </div>
            <div style={S.scanCell}>
              <div style={S.scanCellLabel}>Contact name</div>
              <div style={S.scanCellValue}>{c.contactName || "Not available"}</div>
            </div>
            <div style={S.scanCell}>
              <div style={S.scanCellLabel}>Contact role</div>
              <div style={S.scanCellValue}>{c.contactRole || "—"}</div>
            </div>
            <div style={S.scanCell}>
              <div style={S.scanCellLabel}>Phone confidence</div>
              <div style={{ ...S.scanCellValue, color: confidenceBadgeColor(String(c.phoneConfidence || "").toUpperCase()) }}>
                {c.phoneConfidence ? String(c.phoneConfidence).toUpperCase() : "—"}
              </div>
            </div>
            <div style={S.scanCell}>
              <div style={S.scanCellLabel}>Email confidence</div>
              <div style={{ ...S.scanCellValue, color: confidenceBadgeColor(String(c.emailConfidence || "").toUpperCase()) }}>
                {c.emailConfidence ? String(c.emailConfidence).toUpperCase() : "—"}
              </div>
            </div>
            <div style={S.scanCell}>
              <div style={S.scanCellLabel}>Corroborated?</div>
              <div style={S.scanCellValue}>{yn(c.corroborated)}</div>
            </div>
            {Array.isArray(c.corroborationReasons) && c.corroborationReasons.length > 0 && (
              <div style={{ ...S.scanCell, gridColumn: "1 / -1" }}>
                <div style={S.scanCellLabel}>Corroboration reasons</div>
                <div style={S.scanCellValue}>{c.corroborationReasons.join(", ")}</div>
              </div>
            )}
            {typeof lead.contactsRating === "number" && (
              <div style={S.scanCell}>
                <div style={S.scanCellLabel}>Rating</div>
                <div style={S.scanCellValue}>{lead.contactsRating.toFixed(1)}★</div>
              </div>
            )}
          </div>
        </div>

        {/* E. Issue Breakdown — every observed failure with severity + impact */}
        {Array.isArray(wp?.issues) && wp.issues.length > 0 && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Issue Breakdown</div>
            <div style={S.issueList}>
              {rankIssues(wp.issues).map((it, i) => (
                <div key={`${it.code}-${i}`} style={S.issueRow}>
                  <div style={S.issueHeadRow}>
                    <span style={{
                      ...S.issueSeverityPill,
                      color: severityColor(it.severity),
                      borderColor: severityColor(it.severity),
                    }}>
                      {String(it.severity || "low").toUpperCase()}
                    </span>
                    <span style={S.issueCode}>{it.code}</span>
                  </div>
                  <div style={S.issueDescription}>{it.description}</div>
                  <div style={S.issueImpact}>→ {it.impact}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* F. Revenue Narrative — why this matters, how to sell against it */}
        {(est && (est.revenueImpactSummary?.length > 0 || est.realWorldOutcome || est.salesAngle)) && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Revenue Narrative</div>
            {Array.isArray(est.revenueImpactSummary) && est.revenueImpactSummary.length > 0 && (
              <ul style={S.scanList}>
                {est.revenueImpactSummary.map((line, i) => (
                  <li key={i} style={S.scanItem}>{line}</li>
                ))}
              </ul>
            )}
            {est.realWorldOutcome && (
              <div style={S.scanNarrativeLine}>
                <span style={S.scanNarrativeKey}>Outcome</span>
                <span style={S.scanNarrativeValue}>{est.realWorldOutcome}</span>
              </div>
            )}
            {est.salesAngle && (
              <div style={S.scanNarrativeLine}>
                <span style={S.scanNarrativeKey}>Sales angle</span>
                <span style={{ ...S.scanNarrativeValue, color: palette.blue, fontStyle: "italic" }}>
                  “{est.salesAngle}”
                </span>
              </div>
            )}
            {Array.isArray(lead.serviceRecommendations) && lead.serviceRecommendations.length > 0 && (
              <div style={S.scanNarrativeLine}>
                <span style={S.scanNarrativeKey}>LaborTech sells</span>
                <span style={S.scanNarrativeValue}>
                  {lead.serviceRecommendations.join(" · ")}
                </span>
              </div>
            )}
            {lead.whyThisCloses && (
              <div style={S.scanNarrativeLine}>
                <span style={S.scanNarrativeKey}>Why this closes</span>
                <span style={S.scanNarrativeValue}>{lead.whyThisCloses}</span>
              </div>
            )}
          </div>
        )}

        {/* Legacy system findings — only shown when no structured issues
            (older snapshots) so we never duplicate content. */}
        {!(Array.isArray(wp?.issues) && wp.issues.length > 0) && Array.isArray(proof) && proof.length > 0 && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>System Findings</div>
            <ul style={S.scanList}>
              {proof.map((p, i) => <li key={i} style={S.scanItem}>{p}</li>)}
            </ul>
          </div>
        )}

        {/* Ranked contact paths */}
        {Array.isArray(lead.contactPaths) && lead.contactPaths.length > 0 && (
          <div style={S.scanSection}>
            <div style={S.scanSectionLabel}>Contact Paths (ranked)</div>
            <ul style={S.scanList}>
              {lead.contactPaths.map((p, i) => (
                <li key={i} style={S.scanItem}>
                  <strong>{p.label || `${p.method} · ${p.source}`}</strong>
                  {" — "}
                  {p.value}
                  {p.verified ? " · verified" : " · unverified"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={S.modalFoot}>
          <div style={S.modalFootLeft}>
            <span style={S.statusCalm}>Scan results are live-check snapshots. Refresh to re-run.</span>
          </div>
          <div style={S.modalFootRight}>
            <button type="button" onClick={onClose} style={S.btnLight}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function severityColor(sev) {
  if (sev === "high") return palette.danger;
  if (sev === "medium") return palette.warning;
  return palette.textSecondary;
}

// ── Reusable UI ───────────────────────────────────────────────────────

function Section({ label, action, children }) {
  return (
    <div style={S.section2}>
      {(label || action) && (
        <div style={S.section2Head}>
          {label && <div style={S.section2Label}>{label}</div>}
          {action && <div>{action}</div>}
        </div>
      )}
      <div>{children}</div>
    </div>
  );
}

function Subsection({ label, children }) {
  return (
    <div style={S.subsection}>
      <div style={S.subsectionLabel}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function FindContactSteps({ findTask }) {
  if (!findTask) return null;
  const done = findTask.status === "done";
  return (
    <div style={S.findSteps}>
      <div style={S.findStepsTitle}>{done ? "Search complete" : "Finding contact..."}</div>
      {findTask.steps.map((step, i) => {
        const status = done || i < findTask.cursor ? "done"
                     : i === findTask.cursor ? "running"
                     : "pending";
        const color = status === "done" ? palette.success
                     : status === "running" ? palette.blue
                     : palette.textTertiary;
        const glyph = status === "done" ? "✓" : status === "running" ? "•" : "○";
        return (
          <div key={step.label} style={S.findStep}>
            <span style={{ ...S.findStepGlyph, color }}>{glyph}</span>
            <span style={{ color: status === "pending" ? palette.textTertiary : palette.textPrimary }}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DecisionCore({
  lead, sev, reasons, oppView, searchingFor, findTask, externalSite, siteStatus,
  onCall, onCopyPhone, onLogCall, onLogAttempt,
  onFindContact, onExpandSources, onOpenDomain, onOpenPage, onOpenScan,
}) {
  const c = lead.contacts || {};
  const hasPhone = !!c.primaryPhone;
  const hasWebsite = !!externalSite;
  const fallbackUrl = lead.resolvedListingUrl;
  const fallbackRoute = lead.fallbackRoute;
  const fallbackLabel = fallbackRoute === "facebook" ? "Facebook page" : fallbackRoute === "contact_page" ? "Contact page" : "Business listing";
  const hasFallback = !!fallbackUrl;
  const searching = !!searchingFor;
  const inlineTask = findTask && findTask.leadKey === lead.key ? findTask : null;
  const emptyResult = inlineTask && inlineTask.status === "done" && !hasPhone && !hasFallback;

  let state;
  if (searching && inlineTask) state = "searching";
  else if (hasPhone) state = "phone";
  else if (emptyResult) state = "empty";
  else if (hasFallback) state = "fallback";
  else state = "idle";

  const hasEmail = !!c.primaryEmail;
  // Prefer the resolver's deterministic bestNextAction when available, fall
  // back to local inference otherwise.
  const resolverAction = c.bestNextAction;
  const contactStatus = resolverAction
    ?? (hasPhone ? "READY TO CALL" : hasEmail ? "READY TO EMAIL" : "FIND CONTACT");
  const contactStatusColor =
    contactStatus === "READY TO CALL" ? palette.success
    : contactStatus === "READY TO EMAIL" ? palette.blue
    : contactStatus === "SUBMIT FORM" ? palette.warning
    : contactStatus === "MANUAL VERIFY" ? palette.textSecondary
    : palette.warning;

  return (
    <div style={S.core}>
      <div style={S.coreCols}>
        {/* LEFT card — CRITICAL ISSUE / WHY IT MATTERS / IMPACT BOX /
            LABORTECH FIT / TOP SERVICES / WHY THIS CLOSES. */}
        <div style={S.coreLeft}>
          <div>
            <div style={{ ...S.sectionLabel, color: sev.color }}>
              ⚠ Critical Issue · {sev.level.toUpperCase()}
            </div>
            <div style={S.coreProblem}>{primaryIssue(lead)}</div>
          </div>

          {reasons && reasons.length > 0 && (
            <div>
              <div style={S.sectionLabel}>Why it matters</div>
              <ul style={S.reasonsList}>
                {reasons.map((r, i) => <li key={i} style={S.reasonsItem}>{r}</li>)}
              </ul>
            </div>
          )}

          {/* IMPACT BOX — highlighted with a soft red background */}
          <div style={S.impactBox}>
            <div style={{ ...S.sectionLabel, color: palette.danger }}>Impact</div>
            <div style={S.impactBoxBody}>{impactLine(lead)}</div>
          </div>

          {(() => {
            // Evidence-gate the entire opportunity block. If none of the
            // evidence-driven fields have content, drop the whole card and
            // render a single plain line — do not show "Opportunity at
            // Risk" with an empty body. Header renders when *any* of:
            // numeric band, revenue impact bullets, outcome, or sales
            // angle is present.
            const hasEvidence = oppView.hasBand
              || oppView.revenueImpact.length > 0
              || !!oppView.outcome
              || !!oppView.angle;
            if (!hasEvidence) {
              return (
                <div style={{ ...S.lostLeadsBlock, background: palette.surfaceHover }}>
                  <div style={S.oppEmptyLine}>
                    {oppView.reason || "No live-check data on file yet — run a refresh."}
                  </div>
                </div>
              );
            }
            return (
              <div style={S.lostLeadsBlock}>
                <div style={S.oppHeaderRow}>
                  <span style={S.lostLeadsLabel}>Opportunity at Risk</span>
                  <span style={{ ...S.oppLevelPill, color: riskLevelColor(oppView.level), borderColor: riskLevelColor(oppView.level) }}>
                    {oppView.level}
                  </span>
                  <span style={{ ...S.oppConfidencePill, color: confidenceBadgeColor(oppView.confidence) }}>
                    {oppView.confidence} conf.
                  </span>
                </div>

                {/* Only show the numeric estimate when the engine actually
                    supplied a band (HIGH confidence). Generic filler
                    strings like "Broad estimate only" are never shown. */}
                {oppView.hasBand && (
                  <div style={S.oppEstimateRow}>
                    <span style={S.oppEstimateLabel}>Est. inbound loss</span>
                    <span style={{ ...S.oppEstimateValue, color: palette.danger }}>
                      {oppView.display}
                    </span>
                  </div>
                )}

                {oppView.revenueImpact.length > 0 && (
                  <div style={S.oppNarrativeBlock}>
                    <div style={S.oppNarrativeLabel}>Revenue Impact Detected</div>
                    <ul style={S.oppImpactList}>
                      {oppView.revenueImpact.slice(0, 3).map((line, i) => (
                        <li key={i} style={S.oppImpactItem}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {oppView.outcome && (
                  <div style={S.oppNarrativeLine}>
                    <span style={S.oppNarrativeKey}>Outcome</span>
                    <span style={S.oppNarrativeValue}>{oppView.outcome}</span>
                  </div>
                )}
                {oppView.angle && (
                  <div style={S.oppNarrativeLine}>
                    <span style={S.oppNarrativeKey}>Sales angle</span>
                    <span style={{ ...S.oppNarrativeValue, color: palette.blue, fontStyle: "italic" }}>
                      “{oppView.angle}”
                    </span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* LaborTech Fit — 5 observable axes mapped to the services
              LaborTech sells. Keeps the operator focused on the concrete
              pitch instead of generic "opportunity" language. */}
          {lead.labortechFit && lead.labortechFit.overall !== "UNKNOWN" && (
            <div style={S.fitBlock}>
              <div style={S.fitHeaderRow}>
                <span style={S.fitLabel}>LaborTech Fit</span>
                <span style={{ ...S.fitOverallPill, color: fitOverallColor(lead.labortechFit.overall) }}>
                  {lead.labortechFit.overall}
                </span>
              </div>
              <div style={S.fitGrid}>
                <FitAxis name="Website" value={lead.labortechFit.website} />
                <FitAxis name="SEO" value={lead.labortechFit.seo} />
                <FitAxis name="Reviews" value={lead.labortechFit.reviews} />
                <FitAxis name="Ads" value={lead.labortechFit.ads} />
                <FitAxis name="Social" value={lead.labortechFit.social} />
              </div>
              {lead.labortechFit.reason && (
                <div style={S.fitReason}>{lead.labortechFit.reason}</div>
              )}
            </div>
          )}

          {/* LaborTech can sell — concrete service list. Only rendered when
              we actually detected issues that map to services. */}
          {Array.isArray(lead.serviceRecommendations) && lead.serviceRecommendations.length > 0 && (
            <div style={S.serviceBlock}>
              <div style={S.fitLabel}>LaborTech can sell</div>
              <div style={S.serviceChipRow}>
                {lead.serviceRecommendations.map((s, i) => (
                  <span key={i} style={S.serviceChip}>{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Why This Closes — one sales-ready sentence. Only rendered
              when the engine produced one (non-empty). */}
          {lead.whyThisCloses && (
            <div style={S.whyClosesBlock}>
              <span style={S.whyClosesKey}>Why this closes</span>
              <span style={S.whyClosesValue}>{lead.whyThisCloses}</span>
            </div>
          )}
        </div>

        {/* RIGHT — primary contact path + action state */}
        <div style={S.coreRight}>
          <div style={S.coreReachHead}>
            <span style={S.coreReachLabel}>Primary Contact Path</span>
            <span style={{ ...S.contactStatusPill, color: contactStatusColor, borderColor: contactStatusColor }}>
              {contactStatus}
            </span>
          </div>

          {/* Business entity — surface separately so an LLC is never
              rendered as the contact person. Labels are driven by the
              resolver's deterministic matchType ("exact" | "closest" |
              "unresolved") so UI and engine always agree. */}
          {(() => {
            const matched = c.businessName;
            const leadNameLc = String(lead.name || "").toLowerCase().trim();
            const matchedLc = (matched || "").toLowerCase().trim();
            // Prefer engine-supplied matchType from the persisted resolution;
            // fall back to a UI-local heuristic only when unavailable.
            const engineMatchType = lead.contactResolution?.matchType
              || lead.matchType;
            let matchType = engineMatchType;
            if (!matchType) {
              if (!matched) matchType = "unresolved";
              else {
                const highConf = String(c.confidence || "").toLowerCase() === "high"
                  || String(c.phoneConfidence || "").toLowerCase() === "high";
                matchType = highConf ? "exact" : "closest";
              }
            }
            if (matchType === "unresolved" || !matched) {
              return (
                <div style={S.businessNameLine}>
                  <span style={S.pathIcon}>🏢</span>
                  <span style={S.businessNameValue}>No exact business match found</span>
                </div>
              );
            }
            if (matchedLc === leadNameLc) return null; // redundant with header
            const label = matchType === "closest"
              ? `Matched business profile (closest listing): ${matched}`
              : `Matched business profile: ${matched}`;
            return (
              <div style={S.businessNameLine}>
                <span style={S.pathIcon}>🏢</span>
                <span style={S.businessNameValue}>{label}</span>
              </div>
            );
          })()}

          {c.contactName ? (
            <div style={S.contactNameLine}>
              <span style={S.pathIcon}>👤</span>
              <span style={S.contactNameValue}>{c.contactName}</span>
              {c.contactRole && <span style={S.contactRole}>· {c.contactRole}</span>}
              {c.isManualOverride && <span style={S.overrideBadge}>Manual</span>}
            </div>
          ) : (
            c.isManualOverride && (
              <div style={S.contactNameLine}>
                <span style={S.pathIcon}>👤</span>
                <span style={{ ...S.contactNameValue, fontWeight: 500, color: palette.textSecondary }}>
                  Contact name not available
                </span>
                <span style={S.overrideBadge}>Manual</span>
              </div>
            )
          )}

          <div style={S.pathList}>
            <div style={{ ...S.pathItem, opacity: hasPhone ? 1 : 0.45 }}>
              <span style={S.pathIcon}>📞</span>
              <span style={S.pathLabel}>Phone</span>
              <span style={S.pathValue}>
                {c.primaryPhone || "Not on file"}
                {c.corroborated && hasPhone && <span style={S.corroborationMark} title={(c.corroborationReasons || []).join(", ")}>✓ corroborated</span>}
              </span>
              {hasPhone && (
                <button
                  type="button"
                  onClick={onCopyPhone}
                  title="Copy phone number"
                  aria-label="Copy phone number"
                  style={S.pathCopyIcon}
                >
                  📋
                </button>
              )}
              {hasPhone && c.phoneConfidence && (
                <span style={{ ...S.confBadge, color: confidenceBadgeColor(String(c.phoneConfidence).toUpperCase()) }}>
                  {String(c.phoneConfidence).toUpperCase()}
                </span>
              )}
            </div>
            <div style={{ ...S.pathItem, opacity: c.primaryEmail ? 1 : 0.45 }}>
              <span style={S.pathIcon}>✉️</span>
              <span style={S.pathLabel}>Email</span>
              <span style={S.pathValue}>
                {c.primaryEmail || "Not on file"}
                {c.primaryEmail && c.primaryEmailType === "person_email" && <span style={S.emailType}> · person</span>}
                {c.primaryEmail && c.primaryEmailType === "generic_inbox" && <span style={S.emailType}> · generic inbox</span>}
                {c.primaryEmail && formatEmailMethod(c.emailMethod) && (
                  <span style={S.emailType}> · {formatEmailMethod(c.emailMethod)}</span>
                )}
                {c.primaryEmail && c.emailDomainMismatch && <span style={{ ...S.emailType, color: palette.warning }}> · domain mismatch</span>}
                {!c.primaryEmail && c.noEmailReason && (
                  <span style={S.emailType}> — {formatNoEmailReason(c.noEmailReason)}</span>
                )}
              </span>
              {c.primaryEmail && c.emailConfidence && (
                <span style={{ ...S.confBadge, color: confidenceBadgeColor(String(c.emailConfidence).toUpperCase()) }}>
                  {String(c.emailConfidence).toUpperCase()}
                </span>
              )}
            </div>
            {/* Alternate emails — real, distinct values that the resolver
                kept aside. Shown compactly so operators can copy them. */}
            {Array.isArray(c.alternateEmails) && c.alternateEmails.length > 0 && (
              <div style={S.altEmailsRow}>
                <span style={S.pathIcon}>↳</span>
                <span style={S.pathLabel}>Also</span>
                <span style={S.pathValue}>
                  {c.alternateEmails.slice(0, 3).join("  ·  ")}
                </span>
              </div>
            )}
            {/* Contact form — first-class fallback. Shown when the site
                has a detected form (contact/quote/estimate page). */}
            {(() => {
              const formPath = (lead.contactPaths || []).find((p) => p && p.method === "form");
              if (!formPath) return null;
              return (
                <div style={S.pathItem}>
                  <span style={S.pathIcon}>📝</span>
                  <span style={S.pathLabel}>Form</span>
                  <span style={S.pathValue}>
                    <a href={formPath.value} target="_blank" rel="noopener noreferrer" style={S.inlineLink}>
                      Open contact form
                    </a>
                  </span>
                </div>
              );
            })()}

            <div style={{ ...S.pathItem, opacity: hasWebsite ? 1 : 0.45 }}>
              <span style={S.pathIcon}>🌐</span>
              <span style={S.pathLabel}>Website</span>
              <span style={S.pathValue}>
                {hasWebsite ? (lead.domain || externalSite.replace(/^https?:\/\//, "")) : "Not on file"}
              </span>
            </div>
            <div style={{ ...S.pathItem, opacity: hasFallback ? 1 : 0.45 }}>
              <span style={S.pathIcon}>📍</span>
              <span style={S.pathLabel}>Listing</span>
              <span style={S.pathValue}>{hasFallback ? fallbackLabel : "Not on file"}</span>
            </div>
          </div>

          {(c.contactCompleteness || c.primaryContactReason || typeof c.contactQualityScore === "number" || (c.askFor && c.askFor.length > 0) || c.bestReachablePath) && (
            <div style={S.contactMetaBlock}>
              {typeof c.contactQualityScore === "number" && (
                <div style={S.contactMetaRow}>
                  <span style={S.contactMetaLabel}>Quality</span>
                  <span style={{ ...S.qualityPill, color: qualityColor(c.contactQualityScore), borderColor: qualityColor(c.contactQualityScore) }}>
                    {c.contactQualityScore.toFixed(1)} / 10
                  </span>
                  {c.contactQualityLabel && (
                    <span style={{ ...S.contactMetaValue, color: qualityColor(c.contactQualityScore) }}>
                      {c.contactQualityLabel}
                    </span>
                  )}
                </div>
              )}
              {c.bestReachablePath && (
                <div style={S.contactMetaRow}>
                  <span style={S.contactMetaLabel}>Best Path</span>
                  <span style={{ ...S.contactMetaValue, color: bestPathColor(c.bestReachablePath) }}>
                    {c.bestReachablePath}
                  </span>
                  {c.bestReachablePathReason && (
                    <span style={S.contactMetaHint}>— {c.bestReachablePathReason}</span>
                  )}
                </div>
              )}
              {c.askFor && c.askFor.length > 0 && (
                <div style={S.contactMetaRow}>
                  <span style={S.contactMetaLabel}>Ask For</span>
                  <span style={S.askForList}>{c.askFor.join(" · ")}</span>
                </div>
              )}
              {c.contactCompleteness && (
                <div style={S.contactMetaRow}>
                  <span style={S.contactMetaLabel}>Completeness</span>
                  <span style={{ ...S.contactMetaValue, color: completenessColor(c.contactCompleteness) }}>
                    {c.contactCompleteness}
                  </span>
                  {c.contactCompletenessReason && (
                    <span style={S.contactMetaHint}>— {c.contactCompletenessReason}</span>
                  )}
                </div>
              )}
              {c.primaryContactReason && (
                <div style={S.contactMetaRow}>
                  <span style={S.contactMetaLabel}>Why</span>
                  <span style={S.contactMetaHint}>{c.primaryContactReason}</span>
                </div>
              )}
            </div>
          )}

          {/* QUICK INSIGHTS — compact trust badges pulled from signals
              already on the decision. Each badge only renders when its
              underlying condition is true. */}
          {(() => {
            const insights = [];
            if (c.phoneConfidence && String(c.phoneConfidence).toLowerCase() === "high") {
              insights.push({ label: "Verified Phone", tone: "success" });
            }
            if (c.corroborated) insights.push({ label: "Corroborated", tone: "success" });
            if (lead.labortechFit?.overall === "STRONG FIT") insights.push({ label: "Strong Fit", tone: "success" });
            if (lead.labortechFit?.overall === "GOOD FIT") insights.push({ label: "Good Fit", tone: "blue" });
            if (lead.bucket === "CALL NOW") insights.push({ label: "High Intent", tone: "danger" });
            if (lead.nextAction?.confidence === "HIGH") insights.push({ label: "Fast Win", tone: "blue" });
            if (c.primaryEmailType === "person_email") insights.push({ label: "Person Email", tone: "success" });
            if (insights.length === 0) return null;
            return (
              <div>
                <div style={S.sectionLabel}>Quick insights</div>
                <div style={S.insightRow}>
                  {insights.map((ins, i) => (
                    <span key={i} style={{
                      ...S.insightBadge,
                      color: ins.tone === "success" ? palette.success
                           : ins.tone === "danger" ? palette.danger
                           : palette.blue,
                      background: ins.tone === "success" ? palette.successBg
                           : ins.tone === "danger" ? palette.dangerBg
                           : palette.bluePale,
                      borderColor: ins.tone === "success" ? "rgba(22,163,74,0.25)"
                           : ins.tone === "danger" ? "rgba(220,38,38,0.25)"
                           : palette.blueBorder,
                    }}>
                      {ins.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* CALL CONTEXT — pure context signals only. No actions live
              here (Call Now lives in the Company Header, Call Script
              next to it, Send Email in Call Mode, Log Call in the
              bottom CRM bar). When every contact path is clean, this
              block is omitted entirely. */}
          {(() => {
            const badges = [];
            if (!c.primaryEmail) badges.push({ label: "No email on file", tone: "neutral" });
            if (externalSite && !siteStatus?.usable) {
              badges.push({ label: siteStatus?.label || "Site unavailable", tone: "warn", title: siteStatus?.reason || "" });
            } else if (!externalSite) {
              badges.push({ label: "No website on file", tone: "neutral" });
            }
            if (badges.length === 0) return null;
            return (
              <div>
                <div style={S.sectionLabel}>Call Context</div>
                <div style={S.utilityBadgeRow}>
                  {badges.map((b, i) => (
                    <span
                      key={i}
                      title={b.title || ""}
                      style={{
                        ...S.utilityBadge,
                        color: b.tone === "warn" ? palette.warning : palette.textSecondary,
                        background: b.tone === "warn" ? palette.warningBg : palette.surfaceHover,
                      }}
                    >
                      {b.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {state === "searching" && (
            <FindContactSteps findTask={inlineTask} />
          )}

          {/* Contact-discovery actions — only surfaced when no phone is on
              file. Find Contact / Retry / Expand Sources live here because
              they don't overlap with Quick Actions. */}
          {state === "fallback" && (
            <div style={S.coreActions}>
              <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" onClick={onOpenPage} style={S.btnPrimaryLg}>Open {fallbackLabel}</a>
              <button type="button" onClick={onLogAttempt} style={S.btnSecondaryLg}>Log Attempt</button>
              <button type="button" onClick={onExpandSources} style={S.btnSecondaryLg}>Expand Search</button>
            </div>
          )}

          {state === "empty" && (
            <>
              <div style={S.findSteps}>
                <div style={S.findStepsTitle}>Search complete</div>
                <div style={{ fontSize: 12, color: palette.textSecondary, lineHeight: 1.5 }}>
                  {emptySearchMessage(inlineTask)}
                </div>
              </div>
              <div style={S.coreActions}>
                <button type="button" onClick={onFindContact} style={S.btnPrimaryLg}>Retry Search</button>
                <button type="button" onClick={onExpandSources} style={S.btnSecondaryLg}>Expand Sources</button>
              </div>
            </>
          )}

          {state === "idle" && (
            <div style={S.coreActions}>
              <button type="button" onClick={onFindContact} style={S.btnPrimaryLg}>Find Contact</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TalkTrackView({ script, gatekeeper }) {
  return (
    <div>
      <Subsection label="Opening">
        <div style={S.subBody}>{script.open}</div>
      </Subsection>
      {gatekeeper && (
        <Subsection label="Gatekeeper (if answered by front-desk / office)">
          <div style={{ ...S.subBody, color: palette.textSecondary }}>{gatekeeper}</div>
        </Subsection>
      )}
      <Subsection label="What we noticed">
        <ul style={S.subList}>
          {(script.problem ?? []).slice(0, 4).map((p, i) => <li key={i} style={S.subBullet}>{p}</li>)}
        </ul>
      </Subsection>
      <Subsection label="Why it matters">
        <ul style={S.subList}>
          {(script.impact ?? []).slice(0, 3).map((p, i) => <li key={i} style={S.subBullet}>{p}</li>)}
        </ul>
      </Subsection>
      <Subsection label="Question to engage them">
        <ul style={S.subList}>
          {(script.ask ?? []).slice(0, 3).map((q, i) => <li key={i} style={S.subBullet}>{q}</li>)}
        </ul>
      </Subsection>
      <Subsection label="Close">
        <div style={{ ...S.subBody, color: palette.blue, fontWeight: 500 }}>{script.close}</div>
      </Subsection>
      <Subsection label="Voicemail">
        <div style={{ ...S.subBody, color: palette.textSecondary, fontStyle: "italic" }}>
          {script.voicemail}
        </div>
      </Subsection>
    </div>
  );
}

function ObjectionCard({ objection }) {
  return (
    <div style={S.objCard}>
      <div style={S.objTitle}>{objection.objection}</div>
      <div style={S.objSection}>
        <div style={S.objResponseLabel}>Response</div>
        <div style={S.objResponse}>{objection.response}</div>
      </div>
      {objection.followUp && (
        <div style={S.objFollowBlock}>
          <div style={S.objFollowLabel}>Follow up</div>
          <div style={S.objFollow}>{objection.followUp}</div>
        </div>
      )}
    </div>
  );
}

function EmailComposer({ lead, user, onClose, onLog }) {
  const initialMode = defaultEmailMode(lead);

  const [mode, setMode] = useState(() => draftCache.get(lead.key)?.mode ?? initialMode);
  const [subject, setSubject] = useState(() => {
    const cached = draftCache.get(lead.key);
    if (cached) return cached.subject;
    return generateEmailDraft(lead, initialMode, user).subject;
  });
  const [body, setBody] = useState(() => {
    const cached = draftCache.get(lead.key);
    if (cached) return cached.body;
    return generateEmailDraft(lead, initialMode, user).body;
  });
  const [copyStatus, setCopyStatus] = useState(null);

  useEffect(() => {
    draftCache.set(lead.key, { mode, subject, body, generatedAt: new Date().toISOString() });
  }, [lead.key, mode, subject, body]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function regenerate(nextMode = mode) {
    const next = generateEmailDraft(lead, nextMode, user);
    setSubject(next.subject);
    setBody(next.body);
  }

  function handleModeChange(next) {
    setMode(next);
    regenerate(next);
  }

  async function handleCopy() {
    const ok = await copyText(`${subject}\n\n${body}`);
    setCopyStatus(ok ? "Copied" : "Copy failed");
    onLog?.("email_copied");
    setTimeout(() => setCopyStatus(null), 1600);
  }

  function handleOpenClient() {
    const to = lead.contacts?.primaryEmail || "";
    const url = mailtoUrl(to, subject, body);
    window.location.href = url;
    onLog?.("email_opened_in_client");
  }

  return (
    <div style={S.modalBackdrop} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div>
            <div style={S.modalTitle}>Compose Email</div>
            <div style={S.modalSub}>{lead.name}{lead.contacts?.contactName ? `, ${lead.contacts.contactName}` : ""}</div>
          </div>
          <button type="button" onClick={onClose} style={S.modalClose}>✕</button>
        </div>

        <div style={S.modalRow}>
          <span style={S.modalLabel}>To</span>
          <span style={S.modalRecipient}>
            {lead.contacts?.primaryEmail || "No email on file"}
          </span>
        </div>

        <div style={S.modalRow}>
          <span style={S.modalLabel}>Mode</span>
          <div style={S.modeTabs}>
            {EMAIL_MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => handleModeChange(m.key)}
                style={{ ...S.modeTab, ...(mode === m.key ? S.modeTabActive : null) }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={S.modalInput}
          />
        </div>

        <div style={S.modalField}>
          <label style={S.modalLabel}>Body</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            style={S.modalTextarea}
          />
        </div>

        <div style={S.modalFoot}>
          <div style={S.modalFootLeft}>
            <button type="button" onClick={() => regenerate()} style={S.btnLight}>Regenerate</button>
            {copyStatus && <span style={S.statusCalm}>{copyStatus}</span>}
          </div>
          <div style={S.modalFootRight}>
            <button type="button" onClick={handleCopy} style={S.btnLight}>Copy</button>
            <button
              type="button"
              onClick={handleOpenClient}
              disabled={!lead.contacts?.primaryEmail}
              style={lead.contacts?.primaryEmail ? S.btnPrimary : S.btnDisabled}
            >
              Open in Client
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Command Center ────────────────────────────────────────────────────

function CommandCenter({ calendarEvents = [], allLeads = [], onStartCalls, onToggleFilter, filterHighPriority }) {
  const today = new Date().toISOString().split("T")[0];
  const overdueCount = calendarEvents.filter((e) => e.isOverdue && e.date < today).length;
  const todayCount = calendarEvents.filter((e) => e.date === today && !e.isClosed).length;
  const forceLeads = allLeads.filter((l) => l.forceAction);

  const totalUrgent = overdueCount + todayCount + forceLeads.length;
  if (totalUrgent === 0 && !filterHighPriority) return null;

  const headline = totalUrgent > 0
    ? `${totalUrgent} lead${totalUrgent !== 1 ? "s" : ""} need action today`
    : "All urgent work cleared";

  return (
    <div style={S.commandCenter}>
      <div style={S.commandLeft}>
        <div style={S.commandHeadline}>{headline}</div>
        <div style={S.commandSub}>
          {overdueCount > 0 && <span>{overdueCount} overdue</span>}
          {overdueCount > 0 && todayCount > 0 && <span style={S.commandDot}>·</span>}
          {todayCount > 0 && <span>{todayCount} due today</span>}
          {(overdueCount > 0 || todayCount > 0) && forceLeads.length > 0 && <span style={S.commandDot}>·</span>}
          {forceLeads.length > 0 && <span>{forceLeads.length} priority</span>}
        </div>
      </div>
      <div style={S.commandActions}>
        {totalUrgent > 0 && (
          <button type="button" onClick={onStartCalls} style={S.btnPrimaryLg}>Start Calls</button>
        )}
        <button
          type="button"
          onClick={onToggleFilter}
          style={filterHighPriority ? S.btnSecondaryActive : S.btnSecondaryLg}
        >
          {filterHighPriority ? "High Priority ✓" : "Filter: High Priority"}
        </button>
      </div>
    </div>
  );
}

// ── List Section ──────────────────────────────────────────────────────

function ListSection({ title, bucket, leads, selectedKey, onSelect, user, onUpdate, findTask, onStartFindContact }) {
  if (!leads || leads.length === 0) return null;
  return (
    <div style={S.section}>
      <div style={S.sectionHead}>
        <span style={S.sectionTitle}>{title}</span>
        <span style={S.sectionCount}>{leads.length}</span>
      </div>
      {leads.map((lead, i) => (
        <div key={lead.key}>
          {/* sectionBucket is the authoritative bucket for every row
              rendered in this section — the section header and the row
              badge/border/tint must never disagree. */}
          <LeadRow
            lead={lead}
            index={i}
            isSelected={selectedKey === lead.key}
            onSelect={onSelect}
            sectionBucket={bucket}
          />
          {selectedKey === lead.key && (
            <LeadDetail
              lead={lead}
              user={user}
              onUpdate={onUpdate}
              findTask={findTask}
              onStartFindContact={onStartFindContact}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── AI Panel (operational sections) ───────────────────────────────────

function ContactSearchSection({ lead, findTask, onRetry, onExpand }) {
  const c = lead.contacts || {};
  const hasPhone = !!c.primaryPhone;
  const hasContact = hasPhone || !!c.primaryEmail;
  const inlineTask = findTask && findTask.leadKey === lead.key ? findTask : null;
  const running = inlineTask && inlineTask.status === "running";
  const done = inlineTask && inlineTask.status === "done";
  const site = classifyWebsite(lead);
  const trust = trustInfo(lead, site.status, null);

  let status = hasPhone ? "READY TO CALL" : "FIND CONTACT";
  let statusColor = hasPhone ? palette.success : palette.warning;
  if (running) { status = "SEARCHING"; statusColor = palette.blue; }
  else if (done && !hasContact) { status = "FIND CONTACT"; statusColor = palette.warning; }

  return (
    <div style={S.opSection}>
      <div style={S.opHead}>
        <span style={S.opTitle}>Primary Contact Path</span>
        <span style={{ ...S.opStatus, color: statusColor }}>{status}</span>
      </div>
      <div style={S.opBody}>
        <div style={S.opRow}><span style={S.opLabel}>Source</span><span style={S.opValue}>{trust.source}</span></div>
        <div style={S.opRow}>
          <span style={S.opLabel}>Confidence</span>
          <span style={{ ...S.opValue, color: confidenceBadgeColor(trust.confidence), fontWeight: 700 }}>
            {trust.confidence}
          </span>
        </div>
        {running && (
          <div style={S.opSteps}>
            {inlineTask.steps.map((step, i) => {
              const st = i < inlineTask.cursor ? "done" : i === inlineTask.cursor ? "running" : "pending";
              const color = st === "done" ? palette.success : st === "running" ? palette.blue : palette.textTertiary;
              const glyph = st === "done" ? "✓" : st === "running" ? "•" : "○";
              return (
                <div key={step.label} style={S.opStep}>
                  <span style={{ ...S.findStepGlyph, color }}>{glyph}</span>
                  <span style={{ color: st === "pending" ? palette.textTertiary : palette.textPrimary }}>{step.label}</span>
                </div>
              );
            })}
          </div>
        )}
        {done && !hasContact && inlineTask && (
          <div style={S.opEmptyNote}>{emptySearchMessage(inlineTask)}</div>
        )}
      </div>
      <div style={S.opActions}>
        <button type="button" onClick={onRetry} disabled={running} style={running ? S.btnTierPrimaryDisabled : S.btnTierPrimary}>
          {running ? "Running" : hasContact ? "Re-search" : done ? "Retry Search" : "Run Search"}
        </button>
        {!hasContact && done && (
          <button type="button" onClick={onExpand} style={S.btnTierSecondary}>Expand Sources</button>
        )}
      </div>
    </div>
  );
}

function pickTopObjection(lead, objections) {
  if (lead.callAttempts > 0) {
    return objections.find((o) => /already have|already tried|marketing/i.test(o.objection)) ?? objections[0];
  }
  return objections[0];
}

function buildCallPlan(lead) {
  const objections = defaultObjections(lead);
  const top = pickTopObjection(lead, objections) ?? {
    objection: "Happy with referrals",
    response: "Referred customers check the site first. When it fails a live check, trust breaks.",
  };
  const proof = proofFound(lead);
  const problemText = proof[0]
    ? `${primaryIssue(lead)} — ${proof[0]}.`
    : `${primaryIssue(lead)}.`;

  return {
    open: "How are most of your jobs coming in right now?",
    problem: problemText,
    impact: impactLine(lead),
    objection: top.objection,
    response: top.response,
    close: "15 minutes this week — I'll screen-share the scan and the fix.",
  };
}

function PlanLine({ label, value, accent }) {
  return (
    <div style={S.planLine}>
      <div style={S.planLabel}>{label}</div>
      <div style={{ ...S.planValue, ...(accent ? S.planValueAccent : null) }}>{value}</div>
    </div>
  );
}

function CallPlanSection({ lead }) {
  const plan = buildCallPlan(lead);
  return (
    <div style={S.opSection}>
      <div style={S.opHead}><span style={S.opTitle}>Call Plan</span></div>
      <div style={S.planList}>
        <PlanLine label="Open" value={plan.open} />
        <PlanLine label="Problem" value={plan.problem} />
        <PlanLine label="Impact" value={plan.impact} />
        <PlanLine label="Objection" value={plan.objection} />
        <PlanLine label="Response" value={plan.response} />
        <PlanLine label="Close" value={plan.close} accent />
      </div>
    </div>
  );
}

// ── Assistant chat (lightweight, reuses existing /api/ai/chat) ──
// Operator types a question about the selected lead; we POST to the
// existing AI endpoint with the lead as context. Keeps one latest
// response visible so the panel stays compact — no full chat history,
// no parallel state system.
function AssistantChat({ lead }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);  // { text?: string, error?: string }
  const canSubmit = input.trim().length > 0 && !busy && !!lead;

  async function handleSend(e) {
    e?.preventDefault?.();
    if (!canSubmit) return;
    const message = input.trim();
    setBusy(true);
    setAnswer(null);
    // Tight context block — enough for the assistant to be specific
    // without flooding the prompt.
    const context = {
      name: lead.name,
      location: lead.location,
      bucket: lead.bucket,
      topIssues: (lead.websiteProof?.issues ?? []).slice(0, 3).map((i) => ({
        code: i.code, description: i.description, severity: i.severity,
      })),
      revenueImpact: lead.opportunityEstimate?.revenueImpactSummary ?? [],
      outcome: lead.opportunityEstimate?.realWorldOutcome,
      contactsOnFile: {
        phone: !!lead.contacts?.primaryPhone,
        email: !!lead.contacts?.primaryEmail,
        source: lead.contacts?.source,
      },
    };
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message, context }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.error || json.fallback) {
        setAnswer({ error: json.error || "Assistant unavailable right now." });
      } else {
        setAnswer({ text: json.response || "" });
      }
    } catch (err) {
      setAnswer({ error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  }

  // Reset the latest answer when the operator switches leads so the panel
  // doesn't carry a stale response from another company.
  useEffect(() => { setAnswer(null); setInput(""); }, [lead?.key]);

  function onKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend(e);
    }
  }

  const suggestions = [
    "Summarize the biggest issue",
    "Give me a stronger opener",
    "What should I say if they say referrals?",
    "Why is this CALL NOW?",
  ];

  return (
    <div style={S.opSection}>
      <div style={S.opHead}><span style={S.opTitle}>Assistant</span></div>
      <form onSubmit={handleSend} style={S.chatForm}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about this lead (Cmd+Enter to send)…"
          rows={3}
          style={S.chatInput}
          disabled={busy}
        />
        <div style={S.chatFoot}>
          <div style={S.chatSuggestions}>
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(s)}
                style={S.chatSuggestion}
                disabled={busy}
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            style={canSubmit ? S.chatSend : S.chatSendDisabled}
          >
            {busy ? "Thinking…" : "Send"}
          </button>
        </div>
      </form>
      {answer?.text && (
        <div style={S.chatAnswer}>{answer.text}</div>
      )}
      {answer?.error && (
        <div style={S.chatError}>Assistant error: {answer.error}</div>
      )}
    </div>
  );
}

function AiPanel({ selectedLead, findTask, onStartFindContact }) {
  const [logFlash, setLogFlash] = useState(null);
  const logTimerRef = useRef(null);

  async function logAttempt() {
    if (!selectedLead) return;
    const ref = { name: selectedLead.name, domain: selectedLead.domain };
    try {
      await callMcp("log_crm_activity", {
        company: ref,
        activityType: "call",
        outcome: "no_answer",
        performedBy: "assistant",
      });
      recordAssistantAction(selectedLead.key, "Logged attempt", "no_answer");
      setLogFlash("Attempt logged");
    } catch {
      setLogFlash("Could not log");
    }
    if (logTimerRef.current) clearTimeout(logTimerRef.current);
    logTimerRef.current = setTimeout(() => setLogFlash(null), 1600);
  }

  return (
    <div style={S.ai}>
      <div style={S.aiHead}>
        <span style={S.aiTitle}>Assistant</span>
        {selectedLead && <span style={S.aiCtx}>{selectedLead.name}</span>}
      </div>
      <div style={S.aiBody}>
        {!selectedLead && <div style={S.aiHint}>Select a lead to load the panel.</div>}
        {selectedLead && (
          <>
            <ContactSearchSection
              lead={selectedLead}
              findTask={findTask}
              onRetry={() => {
                recordAssistantAction(selectedLead.key, "Retry search", "assistant");
                onStartFindContact?.(selectedLead);
              }}
              onExpand={() => {
                recordAssistantAction(selectedLead.key, "Expanded sources", "assistant");
                onStartFindContact?.(selectedLead);
              }}
            />
            {logFlash && <div style={S.statusCalm}>{logFlash}</div>}
            <CallPlanSection lead={selectedLead} />
            <AssistantChat lead={selectedLead} />
          </>
        )}
      </div>
    </div>
  );
}

// Today dashboard strip — derived counts + one-click queue entry points.
// Each card carries a short subtext that frames the value of the action
// without adding clutter.
function TodayDashboard({ summary, onStartQueue, onStartFollowUps, onStartEmails }) {
  return (
    <div style={S.todayStrip}>
      <div style={{ ...S.todayCard, ...S.todayCardAccent }}>
        <span style={S.todayLabel}>Leads to Call Today</span>
        <span style={S.todayCount}>{summary.callNow}</span>
        <span style={S.todayHint}>Best new opportunities</span>
        <button
          type="button"
          onClick={onStartQueue}
          style={summary.callNow > 0 ? S.todayBtn : S.todayBtnDisabled}
          disabled={summary.callNow === 0}
        >
          🎧 Start Call Queue
        </button>
      </div>
      <div style={S.todayCard}>
        <span style={S.todayLabel}>Follow Ups — High Intent</span>
        <span style={S.todayCount}>{summary.followUp}</span>
        <span style={S.todayHint}>Warm leads ready to close</span>
        <button
          type="button"
          onClick={onStartFollowUps}
          style={summary.followUp > 0 ? S.todayBtnMuted : S.todayBtnDisabled}
          disabled={summary.followUp === 0}
        >
          Close Deals (Follow Ups)
        </button>
      </div>
      <div style={S.todayCard}>
        <span style={S.todayLabel}>Emails to Send</span>
        <span style={S.todayCount}>{summary.emailFirst}</span>
        <span style={S.todayHint}>Lower-friction outreach</span>
        <button
          type="button"
          onClick={onStartEmails}
          style={summary.emailFirst > 0 ? S.todayBtnMuted : S.todayBtnDisabled}
          disabled={summary.emailFirst === 0}
        >
          Send Emails
        </button>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function OperatorConsole({
  user, callTheseFirst = [], todayList = [], remaining = [], rest = [],
  totalPipeline = 0, pipelineMap = {}, roi, lastPipelineJob = null,
  pendingReviews, calendarEvents, recentActivities,
}) {
  const [selectedKey, setSelectedKey] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [seeding, setSeeding] = useState(false);
  const [findTask, setFindTask] = useState(null); // { leadKey, steps[], cursor, status: "running"|"done", result }
  const [filterHighPriority, setFilterHighPriority] = useState(false);
  // Overlay map: leadKey -> { contacts, resolvedListingUrl, source, confidence, lastCheckedAt, summary }
  // Populated when find_best_contact returns; merged into lead on render.
  const [contactOverlay, setContactOverlay] = useState({});
  // Call Queue state — when non-null, the queue overlay takes over the UI.
  const [queueState, setQueueState] = useState(null); // { leads: Decision[], filterLabel: string }

  const handleSelect = (lead) => setSelectedKey(selectedKey === lead.key ? null : lead.key);
  const handleUpdate = () => setRefreshKey((k) => k + 1);

  const startFindContact = useCallback((lead) => {
    if (!lead) return;
    // Four phase labels rendered to the operator while the backend runs.
    const steps = RESEARCH_LADDER.map((label) => ({ label, status: "pending" }));

    recordAssistantAction(lead.key, "Find Contact", `Starting search across ${steps.length} phases`);
    setFindTask({ leadKey: lead.key, steps, cursor: 0, status: "running" });

    // Fire the real resolver via MCP in parallel with the UI step animation.
    // On success, merge the result into contactOverlay so the card updates.
    // On failure, the UI animation completes to its empty state as before.
    const [city, state] = splitLocation(lead.location);
    (async () => {
      try {
        const res = await callMcp("find_best_contact", {
          company: { name: lead.name, domain: lead.domain, location: lead.location },
          city,
          state,
          category: "roofing",
          // Forward site-extracted signals (if any) so the resolver
          // waterfall can fold them into its ranked contact paths.
          websitePhone: lead.websiteProof?.phone_from_site ?? undefined,
          websiteEmail: lead.websiteProof?.email_from_site ?? undefined,
          website: lead.resolvedBusinessUrl ?? lead.domain ?? undefined,
        });
        const data = res?.data;
        if (!data) return;
        setContactOverlay((prev) => ({
          ...prev,
          [lead.key]: {
            contacts: {
              primaryPhone: data.phone ?? undefined,
              primaryEmail: data.email ?? undefined,
              source: data.source === "google_places" ? "gbp" : data.source,
              confidence: data.confidence === "none" ? "low" : data.confidence,
              contactName: data.matchedName,
              lastVerifiedAt: data.lastCheckedAt,
              checkedSources: data.checkedSources,
            },
            resolvedListingUrl: data.fallbackUrl ?? undefined,
            summary: data.summary,
            fallbackRoute: data.fallbackRoute,
            contactPaths: Array.isArray(data.paths) ? data.paths : undefined,
          },
        }));
        setFindTask((prev) => {
          if (!prev || prev.leadKey !== lead.key) return prev;
          return { ...prev, cursor: prev.steps.length, status: "done" };
        });
        recordAssistantAction(
          lead.key,
          data.summary === "found" ? "Contact found" : data.summary === "fallback" ? "Fallback route found" : "Search complete",
          data.source !== "none" ? data.source : "no sources",
        );
      } catch {
        // Silent: the ticking useEffect will complete the animation to empty.
      }
    })();
  }, []);

  // Advance the task's cursor on a timer so the AI panel shows live progress.
  useEffect(() => {
    if (!findTask || findTask.status !== "running") return;
    const delay = 900;
    const t = setTimeout(() => {
      setFindTask((prev) => {
        if (!prev || prev.status !== "running") return prev;
        const nextCursor = prev.cursor + 1;
        if (nextCursor >= prev.steps.length) {
          recordAssistantAction(prev.leadKey, "Find Contact", "Search complete, logged for next sweep");
          return { ...prev, cursor: prev.steps.length, status: "done" };
        }
        return { ...prev, cursor: nextCursor };
      });
    }, delay);
    return () => clearTimeout(t);
  }, [findTask]);

  // Merge overlay (fresh contact resolver output) into each lead so the UI
  // reflects live resolution without waiting for server-prop refresh.
  const applyOverlay = (lead) => {
    const o = contactOverlay[lead.key];
    if (!o) return lead;
    return {
      ...lead,
      contacts: { ...(lead.contacts ?? {}), ...o.contacts },
      resolvedListingUrl: o.resolvedListingUrl ?? lead.resolvedListingUrl,
      fallbackRoute: o.fallbackRoute ?? lead.fallbackRoute,
      contactPaths: o.contactPaths ?? lead.contactPaths,
    };
  };
  const withOverlays = (leads) => leads.map(applyOverlay);

  const allLeads = [...callTheseFirst, ...todayList, ...remaining, ...rest];
  const rawSelected = allLeads.find((l) => l.key === selectedKey) ?? null;
  const selectedLead = rawSelected ? applyOverlay(rawSelected) : null;
  const hasData = callTheseFirst.length > 0 || todayList.length > 0;
  const top25 = callTheseFirst.length + todayList.length + remaining.length;

  const handleStartCalls = () => {
    const target = allLeads.find((l) => l.forceAction)
      ?? allLeads.find((l) => l.recommendedAction === "CALL NOW")
      ?? allLeads[0];
    if (target) setSelectedKey(target.key);
  };

  // Today summary (per-action counts) + Call Queue entry points.
  // Decisions already carry nextAction / labortechFit / websiteProof;
  // buildCallQueue + summarizeQueue read those directly.
  const overlaidAllLeads = allLeads.map(applyOverlay);
  const todaySummary = useMemo(() => summarizeQueue(overlaidAllLeads), [overlaidAllLeads]);

  const startQueue = (filter, label) => {
    const leads = buildCallQueue(overlaidAllLeads, filter);
    if (leads.length === 0) return;
    setQueueState({ leads, filterLabel: label, filter });
  };
  const handleStartCallQueue  = () => startQueue("call_now",    "Leads to Call Today");
  const handleStartFollowUps  = () => startQueue("follow_up",   "Follow Ups");
  const handleStartEmails     = () => startQueue("email_first", "Emails to Send");
  const handleExitQueue       = () => setQueueState(null);
  const toggleFilter = () => setFilterHighPriority((v) => !v);
  const highPriFilter = (leads) => filterHighPriority ? leads.filter((l) => l.score >= 70 || l.forceAction) : leads;

  async function handleSeed() {
    setSeeding(true);
    try { await fetch("/api/pipeline/seed?skipInspect", { method: "POST", credentials: "include" }); } catch {}
    finally { setSeeding(false); }
  }

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.logo}>M</div>
          <div>
            <div style={S.hTitle}>Meridian AI</div>
            <div style={S.hSub}>LaborTech, KC Roofing</div>
          </div>
        </div>
        <div style={S.headerRight}>
          <span style={S.stat}>{top25} ranked</span>
          <span style={S.stat}>{roi?.contacted ?? 0} contacted</span>
          <span style={S.stat}>{roi?.closedWon ?? 0} closed</span>
          <span style={S.userName}>{user.name}</span>
        </div>
      </header>

      {/* NOTE: no `key={refreshKey}` — using a changing key here remounted
          the entire body on every CRM log, which wiped local UI state
          including the View Scan modal. refreshKey stays in scope only so
          future effects can depend on it; React reconciliation re-renders
          children on prop change without the remount sledgehammer. */}
      <div style={S.body}>
        <main style={S.main}>
          {!hasData ? (
            <div style={S.empty}>
              <div style={{ fontSize: "15px", color: palette.textSecondary, marginBottom: "12px" }}>
                No leads in pipeline yet.
              </div>
              <button onClick={handleSeed} disabled={seeding} style={S.btnPrimary}>
                {seeding ? "Importing" : "Import KC Roofing Companies"}
              </button>
            </div>
          ) : (
            <>
              <TodayDashboard
                summary={todaySummary}
                onStartQueue={handleStartCallQueue}
                onStartFollowUps={handleStartFollowUps}
                onStartEmails={handleStartEmails}
              />
              <CommandCenter
                calendarEvents={calendarEvents}
                allLeads={allLeads}
                onStartCalls={handleStartCalls}
                onToggleFilter={toggleFilter}
                filterHighPriority={filterHighPriority}
              />

              {(() => {
                const todayPlan = allLeads.filter((l) => l.forceAction);
                if (todayPlan.length === 0) return null;
                return <ListSection bucket="CALL NOW" title="🔥 OVERDUE — IMMEDIATE ACTION REQUIRED" leads={withOverlays(todayPlan)} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />;
              })()}

              <ListSection bucket="CALL NOW" title="🔥 CALL NOW — HIGH CONVERSION PROBABILITY" leads={withOverlays(highPriFilter(callTheseFirst.filter((l) => !l.forceAction)))} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />
              <ListSection bucket="TODAY" title="🟡 TODAY — STRONG FIT" leads={withOverlays(highPriFilter(todayList))} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />
              {!filterHighPriority && <ListSection bucket="MONITOR" title="⚪ MONITOR — THIS WEEK" leads={withOverlays(remaining)} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />}
              {!filterHighPriority && rest.length > 0 && <ListSection bucket="PASS" title="⚫ PIPELINE — BACKLOG" leads={withOverlays(rest)} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />}
            </>
          )}
        </main>
        <AiPanel selectedLead={selectedLead} findTask={findTask} onStartFindContact={startFindContact} />
      </div>

      {queueState && (
        <CallQueue
          leads={queueState.leads}
          user={user}
          filterLabel={queueState.filterLabel}
          onExit={handleExitQueue}
          onRestart={() => startQueue(queueState.filter, queueState.filterLabel)}
          onStartFollowUps={handleStartFollowUps}
          hasFollowUps={todaySummary.followUp > 0}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const S = {
  root: { minHeight: "100vh", background: palette.bg, color: palette.textPrimary, fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 24px", borderBottom: `1px solid ${palette.border}`, background: palette.surface },
  headerLeft: { display: "flex", alignItems: "center", gap: "10px" },
  logo: { width: "28px", height: "28px", borderRadius: "7px", background: palette.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700 },
  hTitle: { fontSize: "14px", fontWeight: 600 },
  hSub: { fontSize: "11px", color: palette.textTertiary },
  headerRight: { display: "flex", alignItems: "center", gap: "16px" },
  stat: { fontSize: "11px", color: palette.textTertiary },
  userName: { fontSize: "12px", color: palette.textSecondary, fontWeight: 500 },

  body: { display: "flex", height: "calc(100vh - 51px)" },
  main: { flex: 1, overflowY: "auto", padding: "24px 28px" },

  commandCenter: { padding: "14px 18px", background: palette.surface, borderRadius: "10px", border: `1px solid ${palette.border}`, marginBottom: "20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px", boxShadow: palette.shadow },
  commandLeft: { display: "flex", flexDirection: "column", minWidth: 0 },
  commandHeadline: { fontSize: "14px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.3 },
  commandSub: { fontSize: "12px", color: palette.textSecondary, marginTop: "3px", display: "flex", gap: "8px", flexWrap: "wrap" },
  commandDot: { color: palette.textTertiary },
  commandActions: { display: "flex", gap: "8px", flexShrink: 0 },
  btnSecondaryActive: { background: palette.bluePale, color: palette.blue, border: `1px solid ${palette.blueBorder}`, padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },

  calContext: { display: "flex", gap: "14px", marginTop: "8px", flexWrap: "wrap", fontSize: "12px" },
  calItem: { color: palette.textSecondary },

  section: { marginBottom: "26px" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", padding: "0 12px" },
  sectionTitle: { fontSize: "12px", fontWeight: 700, color: palette.textPrimary, letterSpacing: "0.05em" },
  sectionCount: { fontSize: "11px", color: palette.textTertiary, fontWeight: 600 },

  // Row — compact default radius for list rhythm. When isSelected the
  // row morphs into the card's header strip (see rowSelected below).
  row: { display: "flex", alignItems: "center", gap: "10px", padding: "11px 14px", borderRadius: "8px", cursor: "pointer", transition: "background 0.12s", borderLeft: "3px solid transparent" },
  rowRank: { fontSize: "12px", color: palette.textTertiary, width: "20px", textAlign: "right", flexShrink: 0 },
  rowLeft: { flex: 1, minWidth: 0 },
  rowNameLine: { display: "flex", alignItems: "baseline", gap: "6px" },
  rowName: { fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowLoc: { fontSize: "12px", color: palette.textTertiary, whiteSpace: "nowrap", flexShrink: 0 },
  rowReason: { fontSize: "12px", color: palette.textSecondary, marginTop: "2px", lineHeight: 1.3 },
  rowRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0, minWidth: "80px" },
  rowScore: { fontSize: "13px", fontWeight: 600 },
  // Selected row reads as the "header strip" of the card below. Shares
  // `palette.surface` with the detail card (also enforced per-tier by
  // ROW_TIER_STYLE.selectedBg) so the two read as one continuous surface.
  // No translateY lift — it broke the row↔card attachment.
  rowSelected: {
    borderRadius: "12px 12px 0 0",
    boxShadow: "0 -1px 0 rgba(15,23,42,0.03), inset 0 -1px 0 rgba(15,23,42,0.04)",
    background: palette.surface,
  },
  badgeGreen: { fontSize: "9px", fontWeight: 600, color: palette.success, background: palette.successBg, padding: "2px 8px", borderRadius: "4px" },
  badgeRed: { fontSize: "9px", fontWeight: 600, color: palette.danger, background: palette.dangerBg, padding: "2px 8px", borderRadius: "4px" },

  // Detail frame — attaches flush to the selected row above. Zero top
  // margin, sharp top corners, and no top border so the row and the card
  // read as one continuous surface. Radius + shadow carry the bottom.
  detail: {
    margin: "0 0 14px 0",
    padding: "18px 20px 20px",
    background: palette.surface,
    borderRadius: "0 0 12px 12px",
    border: `1px solid ${palette.border}`,
    borderTop: "none",
    boxShadow: "0 4px 12px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.03)",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },

  // Hero header (flat, not wrapped in Section)
  heroHeader: { display: "flex", gap: "16px", alignItems: "flex-start", paddingBottom: "6px", borderBottom: `1px solid ${palette.borderLight}` },
  headerLocation: { fontSize: "12px", color: palette.textTertiary, marginTop: "1px", marginBottom: "6px" },

  // Company Header Card — single bordered card, top row split into
  // company meta (left) + prominent phone + Call Now (right), with an
  // evenly-spaced action row at the bottom.
  companyHeaderCard: {
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
    padding: "18px 20px 14px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
  },
  companyHeaderTop: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: "20px",
    alignItems: "flex-start",
  },
  companyHeaderLeft: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  companyHeaderMetaRow: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  companyHeaderLocation: { fontSize: "13px", color: palette.textSecondary, fontWeight: 500 },
  companyHeaderTrust: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap", fontSize: "11px" },
  trustItemInline: { display: "inline-flex", gap: "5px", alignItems: "baseline" },
  oppMiniPill: {
    display: "inline-flex", alignItems: "center", gap: "5px",
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
    padding: "2px 9px", borderRadius: "999px", border: "1px solid",
  },
  companyHeaderRight: {
    display: "flex", flexDirection: "column", alignItems: "flex-end",
    gap: "4px", flexShrink: 0, minWidth: "180px",
  },
  companyHeaderPhoneLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  companyHeaderPhone: {
    fontSize: "17px", fontWeight: 700, color: palette.textPrimary,
    letterSpacing: "0.01em", marginBottom: "4px",
  },
  companyHeaderCallBtn: {
    background: palette.success, color: "#fff", border: "none",
    height: "44px", padding: "0 20px", borderRadius: "8px",
    fontSize: "14px", fontWeight: 700, letterSpacing: "0.02em",
    cursor: "pointer", textDecoration: "none",
    display: "inline-flex", alignItems: "center",
    boxShadow: "0 2px 4px rgba(22,163,74,0.25)",
  },
  companyHeaderCallBtnMuted: {
    background: palette.textPrimary, color: "#fff", border: "none",
    height: "44px", padding: "0 20px", borderRadius: "8px",
    fontSize: "14px", fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center",
  },
  // Paired CTA group — Call Now + Call Script sit on the same row at
  // the same height so they read as one action cluster.
  companyHeaderCtaRow: {
    display: "flex", alignItems: "center", gap: "8px",
  },
  // Call Script — secondary-primary. Matches Call Now's height and
  // typographic weight; muted dark outline keeps it clearly secondary
  // to the green primary, but still reads as a real button, not a hint.
  companyHeaderScriptBtn: {
    display: "inline-flex", alignItems: "center",
    height: "44px", padding: "0 18px", borderRadius: "8px",
    fontSize: "14px", fontWeight: 700, letterSpacing: "0.01em",
    color: palette.textPrimary, background: palette.surface,
    borderWidth: "1.5px", borderStyle: "solid", borderColor: palette.textPrimary,
    cursor: "pointer", boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  },
  companyHeaderScriptBtnActive: {
    display: "inline-flex", alignItems: "center",
    height: "44px", padding: "0 18px", borderRadius: "8px",
    fontSize: "14px", fontWeight: 700, letterSpacing: "0.01em",
    color: "#fff", background: palette.textPrimary,
    borderWidth: "1.5px", borderStyle: "solid", borderColor: palette.textPrimary,
    cursor: "pointer", boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
  },
  companyHeaderActions: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: "8px",
    paddingTop: "4px",
    borderTop: `1px solid ${palette.borderLight}`,
  },
  headerActionBtn: {
    background: palette.surface, color: palette.textPrimary,
    border: `1px solid ${palette.border}`,
    padding: "9px 10px", borderRadius: "8px",
    fontSize: "12px", fontWeight: 600, cursor: "pointer",
    textDecoration: "none", textAlign: "center",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  headerActionBtnActive: {
    background: palette.bluePale, color: palette.blue,
    border: `1px solid ${palette.blueBorder}`,
    padding: "9px 10px", borderRadius: "8px",
    fontSize: "12px", fontWeight: 600, cursor: "pointer",
    textAlign: "center",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  // Next Action — full-width command bar. Three zones: LEFT label + pill,
  // CENTER reason, RIGHT confidence + primary action. Strong coloured
  // left accent, soft tinted background.
  nextActionBar: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    gap: "18px",
    padding: "14px 18px",
    borderRadius: "10px",
    border: `1px solid ${palette.borderLight}`,
  },
  nextActionBarLeft: { display: "flex", flexDirection: "column", gap: "5px", minWidth: 0 },
  nextActionBarCenter: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  nextActionBarRight: { display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 },
  nextActionLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  nextActionChip: {
    fontSize: "14px", fontWeight: 800, letterSpacing: "0.04em",
    padding: "8px 14px", borderRadius: "999px", border: "2px solid",
    whiteSpace: "nowrap", textTransform: "uppercase",
    boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
    alignSelf: "flex-start",
  },
  nextActionReason: { fontSize: "14px", lineHeight: 1.45, color: palette.textPrimary, fontWeight: 500 },
  nextActionSupport: { fontSize: "12px", lineHeight: 1.4, color: palette.textSecondary },
  nextActionConfidenceBadge: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
    padding: "3px 10px", borderRadius: "999px",
    border: "1px solid", background: palette.surface,
  },
  nextActionPrimaryBtn: {
    background: palette.textPrimary, color: "#fff", border: "none",
    padding: "10px 20px", borderRadius: "8px",
    fontSize: "13px", fontWeight: 600, cursor: "pointer",
    textDecoration: "none", display: "inline-flex", alignItems: "center",
    boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
  },

  // ── Call Mode (focused live-call overlay) ──
  callModeBackdrop: {
    position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.48)",
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    zIndex: 1100, padding: "32px 20px", overflowY: "auto",
  },
  callModeFrame: {
    width: "min(1080px, 100%)", maxHeight: "calc(100vh - 64px)",
    background: palette.surface, borderRadius: "14px",
    border: `1px solid ${palette.border}`,
    boxShadow: "0 20px 50px rgba(15,23,42,0.18), 0 4px 10px rgba(15,23,42,0.08)",
    display: "flex", flexDirection: "column",
    overflow: "hidden",
  },
  callModeTop: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    gap: "20px", padding: "18px 24px",
    background: palette.surface, borderBottom: `1px solid ${palette.borderLight}`,
  },
  callModeTopLeft: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
  callModeEyebrow: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: palette.textTertiary },
  callModeName: { fontSize: "20px", fontWeight: 700, color: palette.textPrimary, letterSpacing: "0.01em" },
  callModeMeta: { display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap", fontSize: "12px", color: palette.textSecondary },
  callModeDot: { color: palette.textDim },
  callModeTopRight: { display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 },
  callModePhone: {
    background: palette.success, color: "#fff", padding: "10px 18px",
    borderRadius: "10px", textDecoration: "none",
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "1px",
    boxShadow: "0 2px 4px rgba(22,163,74,0.25)",
  },
  callModePhoneLabel: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.92 },
  callModePhoneNumber: { fontSize: "15px", fontWeight: 700, letterSpacing: "0.01em" },
  callModeExit: {
    background: "transparent", border: `1px solid ${palette.border}`,
    color: palette.textSecondary, padding: "8px 14px",
    borderRadius: "8px", fontSize: "12px", fontWeight: 500, cursor: "pointer",
  },

  // Reason strip — why this call, why this closes, pitch
  callModeReasonStrip: {
    padding: "10px 24px 12px", background: palette.surfaceHover,
    borderBottom: `1px solid ${palette.borderLight}`,
    display: "flex", flexDirection: "column", gap: "3px",
  },
  callModeReasonLine: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12px", lineHeight: 1.45, flexWrap: "wrap" },
  callModeReasonKey: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, minWidth: "110px" },
  callModeReasonValue: { fontSize: "12px", color: palette.textPrimary, flex: 1 },

  // Body layout — script main + side rail
  callModeBody: {
    display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(280px, 1fr)",
    gap: "0", overflow: "hidden", flex: 1,
  },
  callModeScript: {
    padding: "20px 24px", overflowY: "auto",
    display: "flex", flexDirection: "column", gap: "14px",
    borderRight: `1px solid ${palette.borderLight}`,
  },
  callModeSide: {
    padding: "20px 22px", overflowY: "auto",
    display: "flex", flexDirection: "column", gap: "18px",
    background: "#FAFBFC",
  },

  // "Say this first" hero callout
  saySayThisFirst: {
    padding: "12px 14px", background: palette.bluePale,
    border: `1px solid ${palette.blueBorder}`,
    borderLeft: `3px solid ${palette.blue}`, borderRadius: "8px",
    display: "flex", flexDirection: "column", gap: "4px",
  },
  saySayThisLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: palette.blue },
  saySayThisQuote: { fontSize: "14px", lineHeight: 1.5, color: palette.textPrimary, fontWeight: 500 },

  // Why this is worth your time — confidence strip above the opener
  worthBlock: {
    padding: "10px 12px",
    background: palette.successBg,
    border: `1px solid rgba(22,163,74,0.2)`,
    borderLeft: `3px solid ${palette.success}`,
    borderRadius: "8px",
    display: "flex", flexDirection: "column", gap: "4px",
  },
  worthLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: palette.success },
  worthList: { margin: 0, paddingLeft: "18px", fontSize: "12.5px", lineHeight: 1.5, color: palette.textPrimary },
  worthItem: { marginBottom: "2px" },

  callModeScriptSection: { display: "flex", flexDirection: "column", gap: "4px" },
  callModeSectionLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  callModeScriptBody: { fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary },
  callModeScriptList: { margin: 0, paddingLeft: "18px", fontSize: "13px", lineHeight: 1.55, color: palette.textPrimary },
  callModeScriptListItem: { marginBottom: "3px" },

  // Objections (collapsible details)
  callModeObjections: { paddingTop: "8px", borderTop: `1px solid ${palette.borderLight}`, display: "flex", flexDirection: "column", gap: "4px" },
  callModeObjectionList: { display: "flex", flexDirection: "column", gap: "4px" },
  callModeObjectionItem: { border: `1px solid ${palette.borderLight}`, borderRadius: "8px", padding: "8px 12px", background: palette.surface },
  callModeObjectionSummary: { fontSize: "12px", fontWeight: 600, color: palette.textPrimary, cursor: "pointer", listStyle: "none" },
  callModeObjectionBody: { marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" },
  callModeObjectionLabel: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary },
  callModeObjectionResponse: { fontSize: "12px", lineHeight: 1.5, color: palette.textPrimary },

  // Side rail sections
  callModeSideSection: { display: "flex", flexDirection: "column", gap: "8px" },
  callModeStatusGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" },
  callModeStatusBtn: {
    background: palette.surface, color: palette.textPrimary,
    border: `1px solid ${palette.border}`, padding: "7px 10px",
    borderRadius: "7px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
    textAlign: "center",
  },
  callModeNote: {
    width: "100%", border: `1px solid ${palette.border}`,
    borderRadius: "8px", padding: "8px 10px",
    fontSize: "12px", lineHeight: 1.5, outline: "none",
    background: palette.surface, fontFamily: "inherit",
    color: palette.textPrimary, resize: "vertical", minHeight: "80px",
    boxSizing: "border-box",
  },
  callModeNoteSave: {
    background: palette.blue, color: "#fff", border: "none",
    padding: "8px 14px", borderRadius: "7px",
    fontSize: "12px", fontWeight: 600, cursor: "pointer",
    alignSelf: "flex-end",
  },
  callModeNoteSaveDisabled: {
    background: palette.surfaceHover, color: palette.textTertiary,
    border: `1px solid ${palette.borderLight}`, padding: "8px 14px",
    borderRadius: "7px", fontSize: "12px", fontWeight: 500, cursor: "not-allowed",
    alignSelf: "flex-end",
  },
  callModeLinkRow: { display: "flex", gap: "6px", flexWrap: "wrap" },
  callModeLinkBtn: {
    background: palette.surface, color: palette.textPrimary,
    border: `1px solid ${palette.border}`, padding: "7px 12px",
    borderRadius: "7px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
    textDecoration: "none",
  },
  callModeFlash: {
    fontSize: "11px", color: palette.success, padding: "6px 10px",
    background: palette.successBg, borderRadius: "6px",
    border: `1px solid ${palette.success}`,
  },

  // ── Call Queue Mode top bar ──
  queueBar: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "10px 20px", background: palette.textPrimary, color: "#fff",
    borderBottom: `1px solid ${palette.textPrimary}`,
  },
  queueBarLeft: { display: "flex", alignItems: "baseline", gap: "6px", flexShrink: 0 },
  queueBarLabel: { fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase" },
  queueBarFilter: { fontSize: "11px", opacity: 0.7 },
  queueBarProgress: { display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 },
  queueBarPosition: { fontSize: "11px", opacity: 0.85, fontWeight: 500 },
  queueProgressTrack: { height: "3px", background: "rgba(255,255,255,0.15)", borderRadius: "999px", overflow: "hidden" },
  queueProgressFill: { height: "100%", background: palette.success, transition: "width 0.3s ease" },
  queueBarActions: { display: "flex", gap: "8px", flexShrink: 0 },
  queueSkipBtn: {
    background: "rgba(255,255,255,0.08)", color: "#fff",
    border: "1px solid rgba(255,255,255,0.2)",
    padding: "6px 12px", borderRadius: "7px",
    fontSize: "11px", fontWeight: 600, cursor: "pointer",
  },

  // Completion stats grid
  queueStatsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "12px", marginBottom: "20px" },
  queueStatCell: {
    padding: "14px 12px", background: palette.surfaceHover,
    border: `1px solid ${palette.borderLight}`, borderRadius: "10px",
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px",
  },
  queueStatValue: { fontSize: "22px", fontWeight: 700, letterSpacing: "0.01em" },
  queueStatLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  queueCompletionNextLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "10px" },
  queueCompletionActions: { display: "flex", gap: "10px", justifyContent: "flex-start", flexWrap: "wrap" },

  // ── Today dashboard strip ──
  todayStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: "12px",
    padding: "16px",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
    marginBottom: "16px",
    boxShadow: palette.shadow,
  },
  todayCard: {
    display: "flex", flexDirection: "column", gap: "8px",
    padding: "12px 14px",
    background: palette.surfaceHover,
    border: `1px solid ${palette.borderLight}`,
    borderRadius: "10px",
  },
  todayCardAccent: { borderLeft: `3px solid ${palette.danger}` },
  todayLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  todayCount: { fontSize: "22px", fontWeight: 700, color: palette.textPrimary, letterSpacing: "0.01em" },
  todayHint: { fontSize: "11px", color: palette.textSecondary, lineHeight: 1.35, marginTop: "-2px", marginBottom: "4px" },
  todayBtn: {
    background: palette.textPrimary, color: "#fff", border: "none",
    padding: "7px 12px", borderRadius: "7px",
    fontSize: "12px", fontWeight: 600, cursor: "pointer",
    alignSelf: "flex-start",
  },
  todayBtnMuted: {
    background: palette.surface, color: palette.textPrimary,
    border: `1px solid ${palette.border}`,
    padding: "7px 12px", borderRadius: "7px",
    fontSize: "12px", fontWeight: 600, cursor: "pointer",
    alignSelf: "flex-start",
  },
  todayBtnDisabled: {
    background: palette.surfaceHover, color: palette.textTertiary,
    border: `1px solid ${palette.borderLight}`,
    padding: "7px 12px", borderRadius: "7px",
    fontSize: "12px", fontWeight: 500, cursor: "not-allowed",
    alignSelf: "flex-start",
  },
  tradeChipRow: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px", marginBottom: "4px" },
  tradeChip: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
    padding: "2px 8px", borderRadius: "999px",
    background: palette.surfaceHover, color: palette.textSecondary,
    border: `1px solid ${palette.borderLight}`,
  },
  serviceBucketChip: {
    fontSize: "10px", fontWeight: 600, letterSpacing: "0.02em",
    padding: "2px 8px", borderRadius: "999px",
    background: palette.bluePale, color: palette.blue,
    border: `1px solid ${palette.blueBorder}`,
  },

  // Trust layer (under company name)
  trustRow: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap", marginTop: "4px" },
  trustItem: { display: "inline-flex", gap: "6px", alignItems: "baseline" },
  trustKey: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary },
  trustValue: { fontSize: "12px", color: palette.textPrimary, fontWeight: 500 },
  trustSep: { color: palette.textDim, fontSize: "11px" },

  // Opportunity label block (replaces numeric score on detail card)
  oppBlock: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px", padding: "8px 16px", borderRadius: "10px", minWidth: "132px", flexShrink: 0 },
  oppBlockDot: { fontSize: "14px", lineHeight: 1 },
  oppBlockLabel: { fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", whiteSpace: "nowrap" },

  // Opportunity pill in collapsed lead rows
  oppPill: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", whiteSpace: "nowrap" },
  oppDot: { fontSize: "8px", lineHeight: 1 },

  // Reasons block
  reasonsBlock: { marginTop: "12px" },
  reasonsLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "4px" },
  // Canonical micro-label used across every section inside the main grid.
  // Consistent type hierarchy = scannable layout.
  sectionLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: palette.textTertiary,
    marginBottom: "6px",
  },
  // Impact Box — soft red background so the consequence stands out from
  // the descriptive sections above it.
  impactBox: {
    background: "#FFF4F4",
    border: `1px solid #FECACA`,
    borderRadius: "8px",
    padding: "10px 12px",
  },
  impactBoxBody: {
    fontSize: "13px", lineHeight: 1.5,
    color: palette.textPrimary, fontWeight: 500,
  },
  // Quick insights — horizontal row of trust badges.
  insightRow: {
    display: "flex", flexWrap: "wrap", gap: "6px",
  },
  insightBadge: {
    display: "inline-flex", alignItems: "center",
    padding: "4px 10px", borderRadius: "999px",
    fontSize: "11px", fontWeight: 600, letterSpacing: "0.01em",
    borderWidth: "1px", borderStyle: "solid", borderColor: "transparent",
    whiteSpace: "nowrap",
  },
  // Quick actions — 2-column grid of equal-size buttons.
  quickActionsGrid: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px",
  },
  quickActionPrimary: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: "6px", height: "40px", padding: "0 14px",
    borderRadius: "8px", fontSize: "13px", fontWeight: 700,
    color: "#fff", background: palette.blue,
    border: `1px solid ${palette.blue}`,
    textDecoration: "none", cursor: "pointer",
    boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
    gridColumn: "1 / -1",
  },
  quickActionSecondary: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: "6px", height: "40px", padding: "0 12px",
    borderRadius: "8px", fontSize: "13px", fontWeight: 600,
    color: palette.textPrimary, background: palette.surface,
    border: `1px solid ${palette.border}`,
    textDecoration: "none", cursor: "pointer",
  },
  // Utility row — non-clickable status badges (No email, Parked domain).
  // Reads as "state info", not actions.
  utilityBadgeRow: {
    display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "8px",
  },
  utilityBadge: {
    display: "inline-flex", alignItems: "center",
    padding: "4px 10px", borderRadius: "999px",
    fontSize: "11px", fontWeight: 600, letterSpacing: "0.01em",
    whiteSpace: "nowrap",
  },
  // Audit Snapshot — full-width bottom card. Label+desc on the left,
  // View Scan + site-status tag anchored right.
  auditSnapshotCard: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "14px",
    padding: "14px 20px",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
  },
  // Call Support — grid of real-time mid-call support tools.
  callSupportCard: {
    display: "flex", flexDirection: "column", gap: "12px",
    padding: "16px 20px",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
  },
  callSupportHead: { display: "flex", flexDirection: "column", gap: "2px" },
  // Collapsible header — full-width button that toggles the tool grid.
  // Stays visually secondary to the CRM decision sections above it.
  callSupportToggle: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", gap: "12px",
    padding: 0, background: "transparent", border: "none",
    cursor: "pointer", textAlign: "left",
  },
  callSupportToggleLeft: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  callSupportChevron: {
    fontSize: "12px", color: palette.textTertiary,
    flexShrink: 0, transform: "translateY(1px)",
  },
  callSupportLabel: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  callSupportSub: {
    fontSize: "12px", color: palette.textSecondary, lineHeight: 1.4,
  },
  callSupportGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
    gap: "8px",
  },
  callSupportTile: {
    display: "flex", flexDirection: "column", alignItems: "flex-start",
    gap: "4px", padding: "10px 12px",
    borderRadius: "8px", cursor: "pointer",
    background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    textAlign: "left", minWidth: 0,
  },
  callSupportTileActive: {
    display: "flex", flexDirection: "column", alignItems: "flex-start",
    gap: "4px", padding: "10px 12px",
    borderRadius: "8px", cursor: "pointer",
    background: palette.bluePale,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.blueBorder,
    textAlign: "left", minWidth: 0,
  },
  callSupportTileIcon: { fontSize: "16px", lineHeight: 1 },
  callSupportTileLabel: {
    fontSize: "12px", fontWeight: 700, color: palette.textPrimary,
    letterSpacing: "0.01em",
  },
  callSupportTileDesc: {
    fontSize: "11px", color: palette.textSecondary, lineHeight: 1.35,
  },
  callSupportPanel: {
    padding: "12px 14px",
    background: palette.surfaceHover,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    borderRadius: "8px",
    display: "flex", flexDirection: "column", gap: "6px",
  },
  callSupportPanelTitle: {
    fontSize: "12px", fontWeight: 700, color: palette.textPrimary,
    letterSpacing: "0.02em",
  },
  callSupportPanelBody: {
    fontSize: "13px", color: palette.textPrimary, lineHeight: 1.5, margin: 0,
  },
  callSupportPanelList: {
    margin: 0, paddingLeft: "18px", fontSize: "13px",
    lineHeight: 1.5, color: palette.textPrimary,
  },
  callSupportPanelEmpty: {
    fontSize: "12px", color: palette.textTertiary, fontStyle: "italic", lineHeight: 1.45,
  },
  callSupportUtilityRow: {
    display: "flex", flexWrap: "wrap", gap: "6px",
    paddingTop: "10px",
    borderTop: `1px solid ${palette.borderLight}`,
  },
  // Embedded-CRM cards — Follow-Up + Activity Timeline. Visually
  // aligned with the other bordered cards so the CRM surfaces feel
  // native, not bolted on.
  crmCard: {
    display: "flex", flexDirection: "column", gap: "10px",
    padding: "14px 18px",
    background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    borderRadius: "12px",
  },
  crmCardHead: { display: "flex", flexDirection: "column", gap: "2px" },
  crmCardLabel: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  crmCardSub: {
    fontSize: "12px", color: palette.textSecondary, lineHeight: 1.4,
  },
  crmEmpty: {
    fontSize: "12px", color: palette.textTertiary, fontStyle: "italic",
    lineHeight: 1.5, padding: "8px 0",
  },
  // Follow-Up — next task block
  followUpNextRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: "10px",
    padding: "10px 12px",
    background: palette.bluePale,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.blueBorder,
    borderRadius: "8px",
  },
  followUpNextBody: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  followUpNextTitle: {
    fontSize: "13px", fontWeight: 700, color: palette.textPrimary,
    letterSpacing: "0.01em",
  },
  followUpNextMeta: {
    display: "flex", flexWrap: "wrap", gap: "8px",
    fontSize: "11px", color: palette.textSecondary,
  },
  followUpNextType: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
    color: palette.blue, textTransform: "uppercase",
  },
  followUpNextDue: { fontSize: "11px", color: palette.textSecondary },
  followUpNextOwner: { fontSize: "11px", color: palette.textSecondary },
  followUpCompleteBtn: {
    display: "inline-flex", alignItems: "center",
    height: "32px", padding: "0 12px",
    borderRadius: "6px",
    fontSize: "12px", fontWeight: 700,
    color: "#fff", background: palette.success,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.success,
    cursor: "pointer", flexShrink: 0,
  },
  followUpListSecondary: {
    margin: 0, padding: 0, listStyle: "none",
    display: "flex", flexDirection: "column", gap: "4px",
  },
  followUpListItem: {
    display: "flex", alignItems: "center", gap: "8px",
    fontSize: "12px", color: palette.textPrimary,
  },
  followUpListDot: { color: palette.textTertiary, fontSize: "12px" },
  followUpListText: { flex: 1, minWidth: 0 },
  followUpListDue: { color: palette.textSecondary, fontSize: "11px" },
  followUpListDone: {
    display: "inline-flex", alignItems: "center",
    height: "24px", padding: "0 8px",
    borderRadius: "5px",
    fontSize: "11px", fontWeight: 600,
    color: palette.textSecondary, background: "transparent",
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    cursor: "pointer",
  },
  followUpComposer: {
    display: "flex", flexDirection: "column", gap: "6px",
    paddingTop: "8px",
    borderTop: `1px solid ${palette.borderLight}`,
  },
  followUpComposerRow: {
    display: "flex", gap: "6px", alignItems: "stretch", flexWrap: "wrap",
  },
  followUpTypeSelect: {
    height: "34px", padding: "0 8px",
    fontSize: "12px", color: palette.textPrimary, background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    borderRadius: "6px", cursor: "pointer",
  },
  followUpTitleInput: {
    flex: 1, minWidth: "160px", height: "34px", padding: "0 10px",
    fontSize: "12px", color: palette.textPrimary, background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    borderRadius: "6px",
  },
  followUpDueInput: {
    height: "34px", padding: "0 8px",
    fontSize: "12px", color: palette.textPrimary, background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    borderRadius: "6px",
  },
  followUpCreateBtn: {
    display: "inline-flex", alignItems: "center",
    height: "34px", padding: "0 14px",
    borderRadius: "6px",
    fontSize: "12px", fontWeight: 700,
    color: "#fff", background: palette.blue,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.blue,
    cursor: "pointer",
  },
  followUpCreateBtnDisabled: {
    display: "inline-flex", alignItems: "center",
    height: "34px", padding: "0 14px",
    borderRadius: "6px",
    fontSize: "12px", fontWeight: 600,
    color: palette.textTertiary, background: palette.surfaceHover,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    cursor: "not-allowed",
  },
  followUpCompletedRow: {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px",
    fontSize: "11px", color: palette.textSecondary,
    paddingTop: "6px", borderTop: `1px dashed ${palette.borderLight}`,
  },
  followUpCompletedLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  followUpCompletedChip: {
    fontSize: "11px", color: palette.textSecondary,
    padding: "2px 8px", borderRadius: "999px",
    background: palette.surfaceHover,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
  },
  // Timeline — one row per activity
  timelineList: {
    margin: 0, padding: 0, listStyle: "none",
    display: "flex", flexDirection: "column", gap: "8px",
  },
  timelineItem: {
    display: "flex", gap: "10px", alignItems: "flex-start",
  },
  timelineIcon: {
    fontSize: "14px", lineHeight: 1.2, flexShrink: 0,
    width: "20px", textAlign: "center",
  },
  timelineBody: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: 1 },
  timelineHead: {
    display: "flex", justifyContent: "space-between", alignItems: "baseline",
    gap: "8px", flexWrap: "wrap",
  },
  timelineHeadLabel: {
    fontSize: "12px", fontWeight: 700, color: palette.textPrimary,
    letterSpacing: "0.01em",
  },
  timelineHeadMeta: {
    fontSize: "10px", color: palette.textTertiary,
    letterSpacing: "0.02em", whiteSpace: "nowrap",
  },
  timelineNote: {
    fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45,
  },
  // Saved-to-CRM toast — bottom-right, non-modal.
  crmSavedFlash: {
    position: "fixed", bottom: "20px", right: "20px", zIndex: 1000,
    padding: "10px 16px",
    background: palette.textPrimary, color: "#fff",
    borderRadius: "8px", fontSize: "12px", fontWeight: 600,
    letterSpacing: "0.02em",
    boxShadow: "0 4px 12px rgba(15,23,42,0.25)",
  },
  // Spinner glyph for saving states — a single character rotating via
  // inline CSS animation (keyframes injected below via a <style> tag
  // when the module mounts is not worth it, so we reuse the existing
  // palette-driven static glyph and let it read as "in motion" via the
  // wait cursor + muted color).
  actionSpinner: {
    display: "inline-block", marginRight: "6px",
    fontSize: "12px", fontWeight: 700,
    color: palette.textSecondary,
    animation: "meridian-spin 1s linear infinite",
  },
  // Inline CRM rail — persistent save confirmation inside the Ready to
  // Act card. Lightweight, colored by tone (success / error) and
  // dismissable so it never blocks the next action.
  crmRail: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "8px 12px",
    borderRadius: "8px",
    fontSize: "12px", fontWeight: 600, letterSpacing: "0.01em",
    borderWidth: "1px", borderStyle: "solid", borderColor: "transparent",
    marginTop: "4px",
  },
  crmRailIcon: { fontSize: "13px", lineHeight: 1 },
  crmRailMessage: { flex: 1, minWidth: 0 },
  crmRailDismiss: {
    background: "transparent", border: "none",
    fontSize: "14px", lineHeight: 1,
    color: "inherit", cursor: "pointer",
    padding: "0 4px",
    opacity: 0.7,
  },
  // Follow-Up card — highlighted outline when the composer just got
  // pre-filled by action chaining.
  crmCardHighlighted: {
    display: "flex", flexDirection: "column", gap: "10px",
    padding: "14px 18px",
    background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.blue,
    borderRadius: "12px",
    boxShadow: "0 0 0 3px rgba(37,99,235,0.08)",
  },
  followUpPrefillHint: {
    fontSize: "11px", fontWeight: 600, color: palette.blue,
    padding: "6px 10px",
    background: palette.bluePale,
    borderRadius: "6px",
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.blueBorder,
  },
  // Inline error caption — used below the follow-up composer when a save
  // fails so the rep sees the reason without hunting for it.
  crmInlineError: {
    fontSize: "11px", fontWeight: 600, color: palette.danger,
    paddingTop: "2px",
  },
  // Scoped reset row — sits at the bottom of the Ready to Act card.
  // Visually secondary (small text, muted), only for edge-case cleanup.
  cardResetRow: {
    display: "flex", flexWrap: "wrap", gap: "8px",
    alignItems: "center", justifyContent: "flex-end",
    paddingTop: "10px",
    borderTop: `1px solid ${palette.borderLight}`,
  },
  cardResetBtn: {
    display: "inline-flex", alignItems: "center",
    height: "26px", padding: "0 10px",
    borderRadius: "5px",
    fontSize: "11px", fontWeight: 600,
    color: palette.textSecondary, background: "transparent",
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    cursor: "pointer",
  },
  cardResetBtnDisabled: {
    display: "inline-flex", alignItems: "center",
    height: "26px", padding: "0 10px",
    borderRadius: "5px",
    fontSize: "11px", fontWeight: 600,
    color: palette.textTertiary, background: "transparent",
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    cursor: "not-allowed", opacity: 0.6,
  },
  cardResetConfirm: {
    display: "flex", alignItems: "center", flexWrap: "wrap",
    gap: "8px", padding: "8px 10px",
    background: palette.dangerBg,
    borderWidth: "1px", borderStyle: "solid", borderColor: "rgba(220,38,38,0.35)",
    borderRadius: "6px",
    flex: "1 1 100%",
  },
  cardResetConfirmText: {
    flex: 1, minWidth: 0,
    fontSize: "11px", fontWeight: 600, color: palette.danger,
    lineHeight: 1.4,
  },
  cardResetConfirmCancel: {
    display: "inline-flex", alignItems: "center",
    height: "26px", padding: "0 10px",
    borderRadius: "5px",
    fontSize: "11px", fontWeight: 600,
    color: palette.textPrimary, background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    cursor: "pointer",
  },
  cardResetConfirmApply: {
    display: "inline-flex", alignItems: "center",
    height: "26px", padding: "0 10px",
    borderRadius: "5px",
    fontSize: "11px", fontWeight: 700,
    color: "#fff", background: palette.danger,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.danger,
    cursor: "pointer",
  },
  auditSnapshotLeft: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  auditSnapshotLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  auditSnapshotDesc: {
    fontSize: "12px", color: palette.textSecondary, lineHeight: 1.4,
  },
  auditSnapshotRight: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
  auditSnapshotSiteBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: "36px", padding: "0 14px",
    borderRadius: "8px", fontSize: "12px", fontWeight: 600,
    color: palette.textPrimary, background: palette.surface,
    border: `1px solid ${palette.border}`,
    textDecoration: "none", cursor: "pointer",
  },
  auditSnapshotScanBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: "6px", height: "36px", padding: "0 14px",
    borderRadius: "8px", fontSize: "12px", fontWeight: 700,
    color: "#fff", background: palette.blue,
    border: `1px solid ${palette.blue}`,
    cursor: "pointer", boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
  },
  auditSnapshotStatusTag: {
    display: "inline-flex", alignItems: "center",
    height: "28px", padding: "0 10px",
    borderRadius: "999px", fontSize: "11px", fontWeight: 700,
    letterSpacing: "0.04em",
  },
  // Ready to Act — bottom bar. 6 evenly-spaced status buttons in one row.
  readyToActCard: {
    display: "flex", flexDirection: "column", gap: "12px",
    padding: "16px 20px",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
    boxShadow: "0 1px 2px rgba(15,23,42,0.02)",
  },
  readyToActHeader: {
    fontSize: "11px", fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  readyToActRow: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: "8px",
  },
  // Two-group layout — outcome on the left, next-step on the right,
  // thin divider in between. Each group still lays out its 3 buttons
  // evenly across the available width.
  readyToActGroupedRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1px 1fr",
    gap: "14px",
    alignItems: "stretch",
  },
  readyToActGroup: {
    display: "flex", flexDirection: "column", gap: "6px", minWidth: 0,
  },
  readyToActGroupLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
    textTransform: "uppercase", color: palette.textTertiary,
  },
  readyToActGroupButtons: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "8px",
  },
  readyToActGroupDivider: {
    background: palette.borderLight, alignSelf: "stretch",
  },
  readyToActBtn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    height: "40px", padding: "0 10px",
    borderRadius: "8px",
    fontSize: "13px", fontWeight: 600,
    color: palette.textPrimary, background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.border,
    cursor: "pointer",
    whiteSpace: "nowrap",
    textAlign: "center",
  },
  readyToActUtility: {
    display: "flex", flexWrap: "wrap", gap: "6px",
    paddingTop: "10px",
    borderTop: `1px solid ${palette.borderLight}`,
  },
  readyToActUtilityBtn: {
    display: "inline-flex", alignItems: "center",
    height: "28px", padding: "0 10px",
    borderRadius: "6px",
    fontSize: "11px", fontWeight: 600,
    color: palette.textSecondary, background: "transparent",
    border: `1px solid ${palette.borderLight}`,
    cursor: "pointer",
  },
  readyToActUtilityBtnActive: {
    display: "inline-flex", alignItems: "center",
    height: "28px", padding: "0 10px",
    borderRadius: "6px",
    fontSize: "11px", fontWeight: 600,
    color: palette.blue, background: palette.bluePale,
    border: `1px solid ${palette.blueBorder}`,
    cursor: "pointer",
  },
  reasonsList: { margin: 0, paddingLeft: "16px", fontSize: "13px", lineHeight: 1.55, color: palette.textPrimary },
  reasonsItem: { marginBottom: "2px" },

  // Estimated Lost Leads
  // Opportunity block — sits inside `core` which is already tinted, so we
  // drop the full border/background and use a single top divider instead.
  // Keeps the information but removes another nested-card layer.
  lostLeadsBlock: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "12px", paddingTop: "12px", borderTop: `1px solid ${palette.borderLight}` },
  lostLeadsLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  lostLeadsValue: { fontSize: "15px", fontWeight: 700, color: palette.danger, letterSpacing: "0.01em" },
  oppHeaderRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  oppLevelPill: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: "999px", border: "1px solid" },
  oppConfidencePill: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", marginLeft: "auto" },
  oppEstimateRow: { display: "flex", alignItems: "baseline", gap: "8px", marginTop: "2px" },
  oppEstimateLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  oppEstimateValue: { fontSize: "13px", fontWeight: 700, letterSpacing: "0.01em" },
  oppReason: { fontSize: "11px", color: palette.textSecondary, lineHeight: 1.4, marginTop: "2px" },
  oppEmptyLine: { fontSize: "11px", color: palette.textSecondary, lineHeight: 1.5, fontStyle: "italic" },
  // LaborTech Fit block — 5-axis readout, compact, sits under opportunity.
  fitBlock: { marginTop: "8px", paddingTop: "10px", borderTop: `1px solid ${palette.borderLight}`, display: "flex", flexDirection: "column", gap: "6px" },
  fitHeaderRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  // Compact 5-across card grid for LaborTech Fit. Each axis is its own
  // small tile so the rep scans strength/weakness at a glance.
  fitAxisCard: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: "2px",
    padding: "6px 4px",
    background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    borderRadius: "6px",
    minWidth: 0,
  },
  fitAxisCardName: {
    fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em",
    textTransform: "uppercase", color: palette.textTertiary,
    textAlign: "center",
  },
  fitAxisCardValue: {
    fontSize: "12px", fontWeight: 700, letterSpacing: "0.01em",
    textAlign: "center",
  },
  fitLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  fitOverallPill: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em" },
  fitGrid: { display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "6px" },
  fitAxisRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "11px", gap: "6px" },
  fitAxisName: { color: palette.textSecondary, fontWeight: 500 },
  fitAxisValue: { fontWeight: 700, letterSpacing: "0.01em" },
  fitReason: { fontSize: "11px", color: palette.textSecondary, lineHeight: 1.4, marginTop: "2px" },
  serviceBlock: { marginTop: "10px", display: "flex", flexDirection: "column", gap: "4px" },
  serviceChipRow: { display: "flex", gap: "5px", flexWrap: "wrap" },
  serviceChip: {
    fontSize: "11px", fontWeight: 600, color: palette.blue,
    background: palette.bluePale, border: `1px solid ${palette.blueBorder}`,
    padding: "2px 10px", borderRadius: "999px", whiteSpace: "nowrap",
  },
  whyClosesBlock: {
    marginTop: "12px", padding: "12px 14px",
    background: palette.bluePale,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.blueBorder,
    borderLeftWidth: "4px", borderLeftStyle: "solid", borderLeftColor: palette.blue,
    borderRadius: "8px",
    display: "flex", flexDirection: "column", gap: "4px",
  },
  whyClosesKey: { fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: palette.blue },
  whyClosesValue: { fontSize: "13px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.5 },
  oppNarrativeBlock: { marginTop: "6px", paddingTop: "6px", borderTop: `1px dashed ${palette.borderLight}` },
  oppNarrativeLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "4px" },
  oppImpactList: { margin: 0, paddingLeft: "16px", fontSize: "12px", lineHeight: 1.5, color: palette.textPrimary },
  oppImpactItem: { marginBottom: "2px" },
  oppNarrativeLine: { display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap", marginTop: "4px", fontSize: "12px", lineHeight: 1.45 },
  oppNarrativeKey: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary, minWidth: "86px" },
  oppNarrativeValue: { fontSize: "12px", color: palette.textPrimary, flex: 1, lineHeight: 1.45 },

  // Contact path list (right side of DecisionCore)
  coreReachHead: { display: "flex", justifyContent: "flex-start", alignItems: "center", gap: "10px", marginBottom: "10px", flexWrap: "wrap" },
  contactStatusPill: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: "999px", borderWidth: "1px", borderStyle: "solid", background: palette.surface, whiteSpace: "nowrap" },
  businessNameLine: { display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "6px", fontSize: "11px", color: palette.textSecondary, flexWrap: "wrap" },
  businessNameValue: { fontSize: "11px", color: palette.textSecondary, fontWeight: 500, letterSpacing: "0.01em" },
  contactNameLine: { display: "flex", gap: "8px", alignItems: "baseline", marginBottom: "8px", paddingBottom: "6px", borderBottom: `1px solid ${palette.borderLight}`, flexWrap: "wrap" },
  contactNameValue: { fontSize: "13px", fontWeight: 600, color: palette.textPrimary, letterSpacing: "0.01em" },
  inlineLink: { color: palette.blue, textDecoration: "none", fontWeight: 500 },
  altEmailsRow: { display: "grid", gridTemplateColumns: "20px 70px 1fr", gap: "8px", alignItems: "baseline", fontSize: "11px", color: palette.textSecondary, marginTop: "-3px", paddingLeft: "0" },
  contactRole: { fontSize: "11px", color: palette.textSecondary, fontWeight: 500 },
  overrideBadge: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "1px 6px", borderRadius: "4px", color: palette.blue, background: palette.bluePale, border: `1px solid ${palette.blueBorder}`, marginLeft: "auto" },
  pathList: { display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" },
  confBadge: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", marginLeft: "6px" },
  corroborationMark: { fontSize: "10px", color: palette.success, fontWeight: 600, marginLeft: "6px" },
  emailType: { fontSize: "10px", color: palette.textSecondary, fontStyle: "italic" },
  contactMetaBlock: { paddingTop: "8px", borderTop: `1px dashed ${palette.borderLight}`, display: "flex", flexDirection: "column", gap: "3px", marginBottom: "10px" },
  contactMetaRow: { display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap", fontSize: "11px", lineHeight: 1.4 },
  contactMetaLabel: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, minWidth: "80px" },
  contactMetaValue: { fontSize: "11px", fontWeight: 700, letterSpacing: "0.02em" },
  contactMetaHint: { fontSize: "11px", color: palette.textSecondary, flex: 1 },
  qualityPill: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.04em", padding: "2px 8px", borderRadius: "999px", border: "1px solid", background: palette.surface, whiteSpace: "nowrap" },
  askForList: { fontSize: "11px", color: palette.textPrimary, fontWeight: 500, flex: 1, lineHeight: 1.4 },
  pathItem: { display: "grid", gridTemplateColumns: "20px 70px 1fr", gap: "8px", alignItems: "baseline", fontSize: "12px" },
  pathIcon: { fontSize: "13px", lineHeight: 1, textAlign: "center" },
  pathLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary },
  pathValue: { fontSize: "12px", color: palette.textPrimary, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  // Small inline icon-only copy control. Sits next to the phone value
  // so reps can grab the number without a large duplicate button.
  pathCopyIcon: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "22px", height: "22px",
    padding: 0, borderRadius: "4px",
    fontSize: "11px", lineHeight: 1,
    color: palette.textSecondary, background: "transparent",
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    cursor: "pointer",
  },

  // Proof action buttons (View Site / View Scan)
  proofActions: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" },
  proofBtn: { background: palette.surface, color: palette.textPrimary, border: `1px solid ${palette.border}`, padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" },
  // View Scan is Meridian's primary audit action — give it visible
  // weight so it reads as a first-class action, not another secondary.
  proofBtnPrimary: {
    background: palette.blue, color: "#fff", border: "none",
    padding: "5px 12px", borderRadius: "6px", fontSize: "11px",
    fontWeight: 700, letterSpacing: "0.02em", cursor: "pointer",
    textDecoration: "none", display: "inline-flex", alignItems: "center",
    gap: "5px", boxShadow: "0 1px 2px rgba(37,99,235,0.22)",
  },

  // Scan modal
  scanGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", padding: "6px 0" },
  scanCell: { borderLeft: `2px solid ${palette.borderLight}`, paddingLeft: "10px" },
  scanCellLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "3px" },
  scanCellValue: { fontSize: "13px", color: palette.textPrimary, fontWeight: 500, wordBreak: "break-word" },
  scanSection: { padding: "8px 0" },
  scanSectionLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textSecondary, marginBottom: "6px" },
  scanList: { margin: 0, paddingLeft: "18px", fontSize: "13px", lineHeight: 1.55, color: palette.textPrimary },
  scanItem: { marginBottom: "3px" },
  // Parked/inactive truthfulness banner
  scanBanner: {
    padding: "10px 12px", borderRadius: "8px",
    background: palette.dangerBg, border: `1px solid ${palette.danger}`,
    display: "flex", flexDirection: "column", gap: "4px", marginBottom: "4px",
  },
  scanBannerTitle: { fontSize: "12px", fontWeight: 700, color: palette.danger, letterSpacing: "0.02em" },
  scanBannerBody: { fontSize: "12px", color: palette.textPrimary, lineHeight: 1.45 },
  // Issue breakdown rows — each issue = severity pill + code + description + impact
  issueList: { display: "flex", flexDirection: "column", gap: "6px" },
  issueRow: {
    border: `1px solid ${palette.borderLight}`, borderRadius: "8px",
    padding: "8px 10px", background: palette.surface,
    display: "flex", flexDirection: "column", gap: "3px",
  },
  issueHeadRow: { display: "flex", gap: "8px", alignItems: "center" },
  issueSeverityPill: {
    fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
    padding: "2px 8px", borderRadius: "999px", border: "1px solid",
    background: palette.surface,
  },
  issueCode: { fontSize: "10px", color: palette.textTertiary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  issueDescription: { fontSize: "13px", color: palette.textPrimary, lineHeight: 1.45 },
  issueImpact: { fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45, fontStyle: "italic" },
  // Narrative lines inside the scan
  scanNarrativeLine: { display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap", marginTop: "4px", fontSize: "12px", lineHeight: 1.45 },
  scanNarrativeKey: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary, minWidth: "86px" },
  scanNarrativeValue: { fontSize: "12px", color: palette.textPrimary, flex: 1, lineHeight: 1.45 },
  // Key Issues Identified — top 2–3 summary at the top of the scan
  scanKeyIssues: { margin: 0, paddingLeft: "0", listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" },
  scanKeyIssuesItem: { display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "13px", lineHeight: 1.45 },
  scanKeyIssuesSeverity: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", padding: "2px 7px", borderRadius: "999px", border: "1px solid", background: palette.surface, flexShrink: 0, marginTop: "1px" },
  scanKeyIssuesText: { fontSize: "13px", color: palette.textPrimary, lineHeight: 1.45 },

  // Decision Core — tinted panel with severity left accent.
  // Inside, Reachability lives in a nested white box so it does not visually
  // compete with the dominant problem on the left.
  // Decision Core — two-column layout, each column reads as its own
  // bordered card inside the grid. No outer tint — each column carries
  // its own background + border.
  core: {
    padding: "0",
    background: "transparent",
    border: "none",
  },
  coreCols: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
    gap: "14px",
    alignItems: "stretch",
  },
  // Each column is its own bordered card, equal visual weight, consistent
  // padding.
  coreLeft: {
    display: "flex", flexDirection: "column", gap: "14px",
    minWidth: 0, padding: "18px 20px",
    background: palette.surface, border: `1px solid ${palette.border}`,
    borderRadius: "12px",
  },
  coreRight: {
    display: "flex", flexDirection: "column", gap: "14px",
    minWidth: 0, padding: "18px 20px",
    background: palette.surface, border: `1px solid ${palette.border}`,
    borderRadius: "12px",
  },
  coreReachLabel: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "6px" },
  reachPhone: { fontSize: "16px", fontWeight: 600, color: palette.textPrimary, letterSpacing: "0.01em" },
  reachNoPhone: { fontSize: "13px", fontWeight: 500, color: palette.textSecondary },
  reachMeta: { display: "flex", gap: "6px", alignItems: "baseline", fontSize: "11px", color: palette.textSecondary, flexWrap: "wrap" },
  reachDot: { color: palette.textTertiary },
  coreSeverity: { fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em", marginBottom: "10px" },
  coreProblem: { fontSize: "24px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.18, marginBottom: "8px" },
  coreImpact: { fontSize: "14px", color: palette.textSecondary, lineHeight: 1.5 },
  coreActions: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  coreNext: { fontSize: "12px", color: palette.textPrimary, fontWeight: 500, lineHeight: 1.4 },
  coreSource: { fontSize: "11px", color: palette.textSecondary, lineHeight: 1.5 },

  // Inline Find Contact progress
  findSteps: { background: palette.surfaceHover, border: `1px solid ${palette.borderLight}`, borderRadius: "8px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "4px" },
  findStepsTitle: { fontSize: "12px", fontWeight: 600, color: palette.textPrimary, marginBottom: "4px" },
  findStep: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12px", lineHeight: 1.5 },
  findStepGlyph: { width: "12px", textAlign: "center", fontWeight: 700 },

  // Button tier system
  btnPrimaryLg: { background: palette.blue, color: "#fff", border: "none", padding: "12px 22px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", boxShadow: "0 1px 2px rgba(37,99,235,0.25)" },
  btnPrimaryLgDisabled: { background: palette.surfaceHover, color: palette.textTertiary, border: `1px solid ${palette.borderLight}`, padding: "12px 22px", borderRadius: "8px", fontSize: "14px", fontWeight: 500, cursor: "not-allowed" },
  btnSecondaryLg: { background: palette.surface, color: palette.textPrimary, border: `1px solid ${palette.border}`, padding: "11px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },

  btnTierPrimary: { background: palette.blue, color: "#fff", border: "none", padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", boxShadow: "0 1px 2px rgba(37,99,235,0.20)" },
  btnTierPrimaryActive: { background: palette.textPrimary, color: "#fff", border: "none", padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" },
  btnTierPrimaryDisabled: { background: palette.surfaceHover, color: palette.textTertiary, border: `1px solid ${palette.borderLight}`, padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 500, cursor: "not-allowed" },
  btnTierSecondary: { background: "transparent", color: palette.textPrimary, border: `1px solid ${palette.border}`, padding: "8px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: 500, cursor: "pointer" },
  btnTierSecondaryActive: { background: palette.bluePale, color: palette.blue, border: `1px solid ${palette.blueBorder}`, padding: "8px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" },
  btnTierTertiary: { background: "transparent", color: palette.textSecondary, border: "none", padding: "6px 10px", fontSize: "12px", fontWeight: 500, cursor: "pointer", textDecoration: "none" },
  btnTierTertiaryActive: { background: "transparent", color: palette.blue, border: "none", padding: "6px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer" },

  tierRow: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  tierRowGroup: { display: "flex", flexDirection: "column", gap: "6px", paddingTop: "4px" },

  // Sales Console — high-contrast value module (replaces Sales Tools)
  // "Ready to act?" — small label that bridges into the Sales Console.
  // Removed the awkward border-top that separated it from the console.
  consoleReady: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: palette.textTertiary, textTransform: "uppercase", paddingTop: "6px", paddingBottom: "2px", marginTop: "2px" },
  // Sales Console — palette aligned with the detail card (warm white
  // surface + palette.border) so it reads as a subsection of the same
  // system, not a separate slate-coloured box.
  consolePanel: { background: "#FAFBFC", border: `1px solid ${palette.border}`, borderRadius: "10px", padding: "18px", display: "flex", flexDirection: "column", gap: "14px" },
  consoleHead: { display: "flex", flexDirection: "column", gap: "2px" },
  consoleTitle: { fontSize: "15px", fontWeight: 600, color: palette.textPrimary, letterSpacing: "0.01em" },
  consoleSubtitle: { fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45 },

  consoleGroupPrimary: { display: "flex", gap: "10px", flexWrap: "wrap" },
  consoleGroupSecondary: { display: "flex", gap: "10px", flexWrap: "wrap" },
  consoleGroupUtility: { display: "flex", gap: "8px", alignItems: "baseline", paddingTop: "4px" },
  // Status updater
  consoleStatusRow: { display: "flex", alignItems: "center", gap: "10px", paddingTop: "6px", borderTop: `1px dashed ${palette.borderLight}`, marginTop: "2px" },
  consoleStatusLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  consoleStatusSelect: {
    fontSize: "12px", fontWeight: 500, color: palette.textPrimary,
    background: palette.surface, border: `1px solid ${palette.border}`,
    borderRadius: "6px", padding: "5px 10px", cursor: "pointer",
    fontFamily: "inherit", outline: "none",
  },
  // Inline note composer
  consoleNoteBlock: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px", background: palette.surface, border: `1px solid ${palette.borderLight}`, borderRadius: "8px" },
  consoleNoteInput: {
    width: "100%", border: `1px solid ${palette.border}`,
    borderRadius: "6px", padding: "8px 10px",
    fontSize: "12px", lineHeight: 1.5, outline: "none",
    background: palette.surface, fontFamily: "inherit",
    color: palette.textPrimary, resize: "vertical", minHeight: "60px",
    boxSizing: "border-box",
  },
  consoleNoteActions: { display: "flex", gap: "8px", justifyContent: "flex-end", alignItems: "center" },
  consoleUtilDot: { color: palette.textTertiary, fontSize: "12px" },

  // Primary console buttons — large, shadowed
  btnConsolePrimary: { background: palette.blue, color: "#fff", border: "none", padding: "11px 22px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", boxShadow: "0 2px 4px rgba(37,99,235,0.22), 0 1px 2px rgba(37,99,235,0.14)", minWidth: "100px", justifyContent: "center" },
  btnConsolePrimaryActive: { background: palette.textPrimary, color: "#fff", border: "none", padding: "11px 22px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", boxShadow: "0 2px 4px rgba(15,23,42,0.18)", minWidth: "100px" },
  btnConsoleCallGreen: { background: palette.success, color: "#fff", border: "none", padding: "11px 22px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", boxShadow: "0 2px 4px rgba(22,163,74,0.25), 0 1px 2px rgba(22,163,74,0.16)", minWidth: "100px", justifyContent: "center" },
  btnConsoleDisabled: { background: "#E2E8F0", color: palette.textTertiary, border: "none", padding: "11px 22px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, cursor: "not-allowed", minWidth: "100px" },

  // Secondary console buttons — outlined, consistent width
  btnConsoleSecondary: { background: palette.surface, color: palette.textPrimary, border: `1px solid #CBD5E1`, padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 500, cursor: "pointer", minWidth: "160px", textAlign: "center" },
  btnConsoleSecondaryActive: { background: palette.bluePale, color: palette.blue, border: `1px solid ${palette.blueBorder}`, padding: "10px 18px", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", minWidth: "160px", textAlign: "center" },

  // Utility — text only
  btnConsoleUtility: { background: "transparent", border: "none", color: palette.textSecondary, padding: "2px 4px", fontSize: "12px", fontWeight: 500, cursor: "pointer", textDecoration: "none" },

  // Audit strip — compact horizontal bar. Label + helper text on the
  // left, View Scan (primary) + site-status indicator (secondary, muted)
  // on the right. One subtle surface so Audit + its actions read as a
  // single section of the card.
  proofBlock: {
    padding: "10px 14px",
    background: "#FAFBFC",
    border: `1px solid ${palette.borderLight}`,
    borderRadius: "8px",
  },
  proofHead: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  proofLabel: {
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: palette.textSecondary,
  },
  proofLabelGroup: { display: "flex", flexDirection: "column", gap: "1px" },
  proofLabelHint: { fontSize: "11px", color: palette.textTertiary, lineHeight: 1.3 },

  // Toggle strip

  // Section
  section2: { border: `1px solid ${palette.borderLight}`, borderRadius: "8px", padding: "12px 14px", background: palette.surface },
  section2Head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" },
  section2Label: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", color: palette.textSecondary },
  sectionBtn: { background: "transparent", color: palette.textSecondary, border: `1px solid ${palette.border}`, padding: "3px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer" },

  // Subsection
  subsection: { border: `1px solid ${palette.borderLight}`, borderRadius: "6px", padding: "9px 12px", marginBottom: "6px", background: palette.surface },
  subsectionLabel: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.03em", color: palette.textSecondary, marginBottom: "4px" },
  subBody: { fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary },
  subList: { margin: 0, paddingLeft: "16px", fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary },
  subBullet: { marginBottom: "2px" },

  // Lead header inside first Section
  headerTop: { display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "8px" },
  headerName: { fontSize: "16px", fontWeight: 600, color: palette.textPrimary, marginBottom: "3px" },
  headerMeta: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", fontSize: "12px", color: palette.textSecondary },
  headerChip: { fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", letterSpacing: "0.02em", background: "transparent", border: "1px solid currentColor", opacity: 0.85 },
  headerScore: { textAlign: "right", flexShrink: 0 },
  headerScoreLabel: { fontSize: "10px", color: palette.textTertiary, fontWeight: 500 },
  headerSub: { display: "flex", gap: "10px", alignItems: "baseline", padding: "8px 0 0", borderTop: `1px solid ${palette.borderLight}`, marginTop: "2px" },
  subLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, flexShrink: 0 },
  subValue: { fontSize: "13px", color: palette.textPrimary, fontWeight: 500 },

  // Snapshot grid
  snapGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px 14px", alignItems: "stretch", marginBottom: "10px" },
  snapCell: { borderLeft: `2px solid ${palette.borderLight}`, paddingLeft: "10px" },
  snapLabel: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "4px" },
  snapValueQual: { fontSize: "12px", fontWeight: 500, color: palette.textPrimary, lineHeight: 1.35 },

  // Plan row
  planRow: { display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: palette.textPrimary, flexWrap: "wrap", marginBottom: "4px" },
  planNum: { width: "16px", height: "16px", borderRadius: "50%", background: palette.borderLight, color: palette.textSecondary, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, flexShrink: 0 },

  // Proof
  proofList: { margin: 0, paddingLeft: "16px", fontSize: "12px", lineHeight: 1.55, color: palette.textSecondary },
  proofItem: { marginBottom: "2px" },

  // Objection
  // Container for a stack of ObjectionCards. Uses flex so the
  // margin-bottom on each card is redundant but harmless; keeps the
  // list from collapsing if we ever drop the inner margin.
  objList: { display: "flex", flexDirection: "column" },
  // Objection card — one bordered panel per objection. Consistent outer
  // spacing so two stacked cards never collide, inner spacing between
  // the three blocks (title → response → follow-up) is generous enough
  // to scan during a live call.
  objCard: {
    display: "flex", flexDirection: "column",
    padding: "14px 16px",
    marginBottom: "12px",
    background: palette.surface,
    borderWidth: "1px", borderStyle: "solid", borderColor: palette.borderLight,
    borderRadius: "8px",
  },
  objTitle: {
    fontSize: "13px", fontWeight: 700, lineHeight: 1.4,
    letterSpacing: "0.01em", color: palette.textPrimary,
    marginBottom: "12px",
    paddingBottom: "10px",
    borderBottomWidth: "1px", borderBottomStyle: "solid", borderBottomColor: palette.borderLight,
  },
  // Response section — plain body block with label on top. No border,
  // just vertical rhythm. Margin-bottom separates it from the follow-up.
  objSection: {
    display: "flex", flexDirection: "column",
    marginBottom: "14px",
  },
  objResponseLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: palette.textTertiary,
    marginBottom: "6px",
  },
  objResponse: {
    fontSize: "13px", lineHeight: 1.55, color: palette.textPrimary,
  },
  // Follow-up block — visually distinct via blue left border + soft
  // tinted background + blue label + blue body text. Reads as the
  // "what to say next" cue rather than another paragraph.
  objFollowBlock: {
    display: "flex", flexDirection: "column",
    padding: "10px 12px",
    background: palette.bluePale,
    borderLeftWidth: "3px", borderLeftStyle: "solid", borderLeftColor: palette.blue,
    borderRadius: "0 6px 6px 0",
  },
  objFollowLabel: {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: palette.blue,
    marginBottom: "6px",
  },
  objFollow: {
    fontSize: "13px", lineHeight: 1.55, fontWeight: 500,
    color: palette.textPrimary,
  },

  // Actions
  actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
  btnAi: { background: palette.textPrimary, color: palette.surface, border: "none", padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" },
  btnPrimary: { background: palette.blue, color: "#fff", border: "none", padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" },
  btnLight: { background: "transparent", color: palette.textSecondary, border: `1px solid ${palette.border}`, padding: "8px 14px", borderRadius: "7px", fontSize: "12px", cursor: "pointer" },
  btnSkip: { background: "transparent", color: palette.textTertiary, border: "none", padding: "8px 12px", borderRadius: "7px", fontSize: "11px", cursor: "pointer" },

  statusCalm: { fontSize: "11px", color: palette.textTertiary, marginTop: "8px", letterSpacing: "0.01em" },

  logInput: { width: "100%", border: `1px solid ${palette.border}`, borderRadius: "6px", padding: "8px 10px", fontSize: "13px", outline: "none", background: palette.surface, marginBottom: "8px", boxSizing: "border-box" },
  logBtns: { display: "flex", gap: "6px", flexWrap: "wrap" },
  logBtn: { background: palette.surface, color: palette.textSecondary, border: `1px solid ${palette.border}`, padding: "6px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer" },

  tlRow: { display: "flex", gap: "8px", fontSize: "12px", padding: "4px 0", alignItems: "baseline" },
  tlDate: { color: palette.textTertiary, fontSize: "11px", flexShrink: 0 },
  tlType: { fontWeight: 500 },
  tlNote: { color: palette.textTertiary, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { fontSize: "12px", color: palette.textTertiary },

  // Briefing render (shared by right rail)
  briefCard: { padding: "4px 0 0" },
  briefingSection: { marginBottom: "10px" },
  briefingTitle: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textSecondary, marginBottom: "3px" },
  briefingLine: { fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary },
  briefingList: { margin: 0, paddingLeft: "16px", fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary },
  briefingBullet: { marginBottom: "2px" },
  briefingFallback: { fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary },

  // AI panel
  ai: { width: "340px", flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: `1px solid ${palette.border}`, background: palette.surface },
  aiHead: { padding: "14px 16px", borderBottom: `1px solid ${palette.borderLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" },
  aiTitle: { fontSize: "13px", fontWeight: 600 },
  aiCtx: { fontSize: "11px", color: palette.blue },
  aiBody: { flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "12px" },
  aiHint: { fontSize: "13px", color: palette.textTertiary, lineHeight: 1.55 },

  // Operational sections (right rail)
  opSection: { background: palette.surface, border: `1px solid ${palette.borderLight}`, borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "8px" },
  opHead: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  opTitle: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", color: palette.textSecondary, textTransform: "uppercase" },
  opStatus: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" },
  opBody: { display: "flex", flexDirection: "column", gap: "4px" },
  opRow: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12px", lineHeight: 1.5 },
  opLabel: { color: palette.textTertiary, minWidth: "74px", fontWeight: 500 },
  opValue: { color: palette.textPrimary, flex: 1 },
  opSteps: { display: "flex", flexDirection: "column", gap: "3px", marginTop: "4px", paddingTop: "6px", borderTop: `1px dashed ${palette.borderLight}` },
  opStep: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12px", lineHeight: 1.5 },
  opEmptyNote: { fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5, marginTop: "4px", paddingTop: "6px", borderTop: `1px dashed ${palette.borderLight}` },

  // Call Plan — six-line live-call structure
  planList: { display: "flex", flexDirection: "column", gap: "6px" },
  planLine: { display: "flex", flexDirection: "column", gap: "2px" },
  planLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary },
  planValue: { fontSize: "13px", color: palette.textPrimary, lineHeight: 1.45 },
  planValueAccent: { color: palette.blue, fontWeight: 500 },
  opActions: { display: "flex", gap: "6px", flexWrap: "wrap" },

  // Assistant chat
  chatForm: { display: "flex", flexDirection: "column", gap: "8px" },
  chatInput: {
    width: "100%", border: `1px solid ${palette.border}`, borderRadius: "8px",
    padding: "8px 10px", fontSize: "12px", lineHeight: 1.45, outline: "none",
    background: palette.surface, fontFamily: "inherit", color: palette.textPrimary,
    resize: "vertical", minHeight: "56px", boxSizing: "border-box",
  },
  chatFoot: { display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "flex-start", justifyContent: "space-between" },
  chatSuggestions: { display: "flex", gap: "4px", flexWrap: "wrap", flex: 1, minWidth: "0" },
  chatSuggestion: {
    background: palette.surfaceHover, color: palette.textSecondary,
    border: `1px solid ${palette.borderLight}`, padding: "3px 7px",
    borderRadius: "999px", fontSize: "10px", cursor: "pointer", whiteSpace: "nowrap",
  },
  chatSend: {
    background: palette.blue, color: "#fff", border: "none",
    padding: "6px 14px", borderRadius: "7px", fontSize: "12px",
    fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
  },
  chatSendDisabled: {
    background: palette.surfaceHover, color: palette.textTertiary,
    border: `1px solid ${palette.borderLight}`, padding: "6px 14px",
    borderRadius: "7px", fontSize: "12px", fontWeight: 500, cursor: "not-allowed",
    whiteSpace: "nowrap",
  },
  chatAnswer: {
    marginTop: "6px", padding: "8px 10px", background: palette.bluePale,
    border: `1px solid ${palette.blueBorder}`, borderRadius: "8px",
    fontSize: "12px", lineHeight: 1.5, color: palette.textPrimary, whiteSpace: "pre-wrap",
  },
  chatError: {
    marginTop: "6px", padding: "6px 10px", background: palette.dangerBg,
    border: `1px solid ${palette.danger}`, borderRadius: "6px",
    fontSize: "11px", color: palette.danger,
  },

  empty: { textAlign: "center", padding: "80px 20px" },

  // Contacts
  contactTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "6px" },
  contactName: { fontSize: "14px", fontWeight: 600, color: palette.textPrimary },
  contactRole: { fontSize: "12px", color: palette.textSecondary, marginTop: "1px" },
  contactMeta: { display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "60%" },
  contactChip: { fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "10px", background: palette.surfaceHover, letterSpacing: "0.02em", textTransform: "capitalize" },
  contactChipDim: { fontSize: "10px", color: palette.textTertiary, padding: "2px 6px" },
  contactDetails: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "6px 16px", marginBottom: "10px" },
  contactRow: { display: "flex", gap: "10px", alignItems: "baseline", fontSize: "13px" },
  contactLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, width: "46px", flexShrink: 0 },
  contactValue: { color: palette.textPrimary, fontWeight: 500, wordBreak: "break-all" },
  contactActions: { display: "flex", gap: "8px", flexWrap: "wrap" },

  btnCall: { background: palette.blue, color: "#fff", border: "none", padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" },
  btnEmail: { background: palette.textPrimary, color: palette.surface, border: "none", padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer" },
  btnListing: { background: palette.bluePale, color: palette.blue, border: `1px solid ${palette.blueBorder}`, padding: "8px 14px", borderRadius: "7px", fontSize: "12px", fontWeight: 600, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" },
  btnDisabled: { background: palette.surfaceHover, color: palette.textTertiary, border: `1px solid ${palette.borderLight}`, padding: "8px 16px", borderRadius: "7px", fontSize: "12px", fontWeight: 500, cursor: "not-allowed", textDecoration: "none", display: "inline-flex", alignItems: "center", pointerEvents: "none" },
  contactStatusLine: { fontSize: "13px", color: palette.textPrimary, lineHeight: 1.5, marginBottom: "6px" },
  contactSourceLine: { display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: palette.textSecondary, padding: "0 0 8px", minHeight: "16px" },
  contactResearchDot: { width: "8px", height: "8px", borderRadius: "50%", background: palette.blue, flexShrink: 0, boxShadow: `0 0 0 3px ${palette.bluePale}` },
  contactDivider: { height: "1px", background: palette.borderLight, margin: "10px 0" },

  // Assistant task cards (right rail)
  taskCard: { background: palette.surfaceHover, border: `1px solid ${palette.borderLight}`, borderRadius: "8px", padding: "10px 12px" },
  taskHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
  taskTitle: { fontSize: "12px", fontWeight: 600, color: palette.textPrimary },
  taskState: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" },
  taskBody: { display: "flex", flexDirection: "column", gap: "4px" },
  taskStep: { display: "flex", gap: "8px", alignItems: "baseline", fontSize: "12px", lineHeight: 1.5 },
  taskStepGlyph: { width: "12px", textAlign: "center", fontWeight: 700 },
  taskDone: { fontSize: "11px", color: palette.textSecondary, marginTop: "6px" },

  memoryCard: { background: palette.surfaceHover, border: `1px solid ${palette.borderLight}`, borderRadius: "8px", padding: "10px 12px" },
  memoryTitle: { fontSize: "11px", fontWeight: 600, color: palette.textSecondary, marginBottom: "4px" },
  memoryList: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "2px" },
  memoryItem: { fontSize: "12px", lineHeight: 1.45, color: palette.textPrimary },
  memoryAction: { fontWeight: 500 },
  memoryDetail: { color: palette.textSecondary },

  // Compose modal
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.38)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "40px 20px" },
  modal: { width: "min(620px, 100%)", maxHeight: "88vh", overflowY: "auto", background: palette.surface, borderRadius: "12px", boxShadow: palette.shadowLg, border: `1px solid ${palette.border}`, padding: "18px 20px", display: "flex", flexDirection: "column", gap: "12px" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" },
  modalTitle: { fontSize: "15px", fontWeight: 600, color: palette.textPrimary },
  modalSub: { fontSize: "12px", color: palette.textSecondary, marginTop: "2px" },
  modalClose: { background: "transparent", border: "none", fontSize: "16px", color: palette.textTertiary, cursor: "pointer", padding: "4px 8px", borderRadius: "6px" },
  modalRow: { display: "flex", alignItems: "center", gap: "10px" },
  modalLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textTertiary, minWidth: "60px" },
  modalRecipient: { fontSize: "13px", color: palette.textPrimary, fontWeight: 500 },
  modeTabs: { display: "flex", gap: "6px", flexWrap: "wrap" },
  modeTab: { background: palette.surfaceHover, color: palette.textSecondary, border: `1px solid ${palette.borderLight}`, padding: "5px 10px", borderRadius: "6px", fontSize: "11px", cursor: "pointer" },
  modeTabActive: { background: palette.bluePale, color: palette.blue, border: `1px solid ${palette.blueBorder}`, fontWeight: 600 },
  modalField: { display: "flex", flexDirection: "column", gap: "4px" },
  modalInput: { border: `1px solid ${palette.border}`, borderRadius: "6px", padding: "8px 10px", fontSize: "13px", outline: "none", background: palette.surface, fontFamily: "inherit", color: palette.textPrimary },
  modalTextarea: { border: `1px solid ${palette.border}`, borderRadius: "6px", padding: "10px 12px", fontSize: "13px", lineHeight: 1.55, outline: "none", background: palette.surface, fontFamily: "inherit", color: palette.textPrimary, resize: "vertical", minHeight: "180px" },
  modalFoot: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", paddingTop: "6px", borderTop: `1px solid ${palette.borderLight}` },
  modalFootLeft: { display: "flex", alignItems: "center", gap: "10px" },
  modalFootRight: { display: "flex", gap: "8px" },
};
