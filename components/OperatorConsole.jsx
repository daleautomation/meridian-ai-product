"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { palette } from "../lib/theme";
import SourceReadiness from "./SourceReadiness";
import LaborTechServicesPanel from "./LaborTechServicesPanel";
import SnapshotFreshnessPill from "./SnapshotFreshnessPill";
import SchedulingMenu from "./SchedulingMenu";
import AllLeadsBucketOverview from "./AllLeadsBucketOverview";
import {
  filterCalendarTasks,
  summarizeVisibility,
  DEFAULT_CALENDAR_VISIBILITY,
  VISIBILITY_LABEL_MAP,
} from "../lib/calendar/calendarVisibility";
import { getService as getServiceCatalogEntry } from "../lib/services/serviceCatalog";
import { getTradeColor, TRADE_COLOR_ORDER } from "../lib/modules/tradeColors";
import { getTradeModule, getServiceBucket, TRADE_DEFAULT } from "../lib/modules/trades";
import { buildCallQueue, summarizeQueue } from "../lib/scoring/callQueue";
import { resolveLeadQualityDisplay } from "../lib/display/leadQuality";
import CalendarCommandCenter, { SelectedLeadPanel } from "./CalendarCommandCenter";
import LeadContextStrip from "./LeadContextStrip";
import LeadEmailAction from "./LeadEmailAction";
import ContactStrategyPanel from "./ContactStrategyPanel";
import { WORKFLOW, SHELL_GRID } from "./workflowLayout";
import LeadWorkflowDrawer from "./LeadWorkflowDrawer";
import { buildTasksFromLeads } from "../lib/calendar/tasks";
import {
  deriveOutcomeEventsFromPipelineMap,
  combineLearningAdjustments,
} from "../lib/calendar/outcomeLearning";
import { rememberOutcomeEvents, loadOutcomeEvents, mergeOutcomeEvents } from "../lib/calendar/outcomeMemory";
import { scopeKey as makeScopeKey } from "../lib/calendar/intelligenceScope";
import { buildTeamLearningInput } from "../lib/calendar/teamIntelligence";
import { buildOperatorInsights } from "../lib/calendar/insightEngine";
import { optimizeWorkflow } from "../lib/calendar/workflowEngine";
import {
  createWorkflowFeedbackEvent,
  workflowFeedbackToOutcomeEvent,
  applyFeedbackToTasks,
} from "../lib/calendar/workflowFeedback";
import {
  loadWorkflowFeedback,
  rememberWorkflowFeedback,
} from "../lib/calendar/workflowFeedbackMemory";
import { buildWorkflowRuleLearning } from "../lib/calendar/workflowRuleLearning";
import { buildMarketAwareLearning } from "../lib/calendar/marketIntelligence";
import { buildGlobalIntelligence } from "../lib/calendar/globalIntelligence";
import { scoreLeadTask as scoreLeadTaskCanonical } from "../lib/calendar/leadScore";
import { TRADE_MODULES, TRADE_MODULE_ORDER, isTradeId } from "../lib/modules/tradeConfigs";
import { buildPortfolioStack } from "../lib/modules/portfolioStack";
import { filterLeadsForTrade } from "../lib/modules/tradeFilter";
import { getTradeSourceReadiness } from "../lib/modules/tradeSources";
import { buildBucketPortfolio } from "../lib/modules/bucketPortfolio";
import { buildTopOpportunity } from "../lib/modules/topOpportunity";
import { prioritizeServiceAngles } from "../lib/modules/anglePrioritization";
import { primaryBucketForLead } from "../lib/modules/bucketClassifier";
import { buildOpportunitySystem } from "../lib/modules/opportunitySystem";
import {
  getActionableContact,
  formatTelHref,
  formatSmsHref,
  formatMailtoHref,
  formatMoney,
  leadOpportunityValue,
} from "../lib/leads/leadActions";
import { useOutcomes, useDecisionFlow, leadKeyOf } from "../lib/leads/outcomes";
import { generateCallScript } from "../lib/leads/scriptEngine";
import { bucketPerformanceMap } from "../lib/leads/decisionEngine";
import {
  useDeals,
  buildLeadIndex,
  DEAL_STAGE_LABELS,
  sortDealsForStage,
} from "../lib/leads/deals";
import { trackEvent } from "../lib/tracking/clientTracker";

// Debug-log gate. Per-render logs flood the main thread on the live
// demo; enable via NEXT_PUBLIC_DEBUG_MERIDIAN=1 only when needed.
const DEBUG_UI =
  typeof process !== "undefined"
  && typeof process.env !== "undefined"
  && process.env.NEXT_PUBLIC_DEBUG_MERIDIAN === "1";

// No-op logger used in heavy memo paths. Errors + warnings still go
// through the real console; only verbose dev info is silenced.
const dlog = DEBUG_UI ? console.log.bind(console) : () => {};
const ddebug = DEBUG_UI ? (console.debug ? console.debug.bind(console) : console.log.bind(console)) : () => {};

// Internal-only diagnostics flag. Off in production by default; never
// renders UI. When on, the dev console log gains classification
// counters for cross-market pattern + rule discovery.
const ENABLE_INTERNAL_GLOBAL_INTELLIGENCE = process.env.NODE_ENV !== "production";

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

function marketFitQuality(lead) {
  return resolveLeadQualityDisplay({
    ...lead,
    phone: lead?.phone ?? lead?.contacts?.primaryPhone ?? null,
  });
}

function marketFitScore(lead) {
  const quality = marketFitQuality(lead);
  return typeof quality.value === "number" && !quality.isUnknown ? quality.value : null;
}

// ── Opportunity classification (replaces numeric score) ───────────────

const OPP_META = {
  "CALL NOW": { dot: "", headline: "Call now",        color: palette.danger,        bg: "#FEF2F2",            border: "#FECACA" },
  "TODAY":    { dot: "", headline: "Call this week",  color: palette.warning,       bg: palette.warningBg,    border: "#FDE68A" },
  "MONITOR":  { dot: "", headline: "Watch",           color: palette.textSecondary, bg: palette.surfaceHover, border: palette.border },
  "PASS":     { dot: "", headline: "Skip",            color: palette.textTertiary,  bg: palette.surfaceHover, border: palette.border },
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
    // Any numeric band the engine emits today is a hardcoded heuristic
    // ($30K–$80K/mo × weakness-driven leak %), not a per-company
    // forecast. Surfacing those numbers erodes rep credibility on a
    // skeptical buyer. Replace with "Sized on the call" and let the
    // rep discover actual monthly lead volume in discovery.
    const display = band
      ? "Sized on the call"
      : confidence === "MEDIUM"
      ? "Revenue impact requires current lead volume"
      : "Estimate unavailable";
    return {
      level,
      confidence,
      display,
      hasBand: !!band,
      bandIsNeutralized: !!band,
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
  const decision = lead.decision || null;
  const phone = lead.contacts?.primaryPhone || null;
  const fitScore = marketFitScore(lead);
  const fitLabel = fitScore === null ? null : `Fit ${fitScore}%`;

  // Click guard: prevent the row's onSelect when interacting with the
  // primary Call button.
  const stop = (e) => { e.stopPropagation(); };

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
        {decision ? (
          <>
            <div style={S.rowReason}>{decision.reason}</div>
            <div style={{
              fontSize: "12px",
              color: "#475569",
              fontStyle: "italic",
              lineHeight: 1.45,
              marginTop: "4px",
            }}>
              “{decision.suggestedOpening}”
            </div>
          </>
        ) : (
          <div style={S.rowReason}>{reason}</div>
        )}
      </div>

      <div style={S.rowRight}>
        {decision ? (
          <span style={{
            ...S.oppPill,
            color: opp.color,
            background: opp.bg,
            border: `1px solid ${opp.border}`,
          }}>
            {decision.bucket} · {fitLabel ?? decision.score}
          </span>
        ) : (
          <span style={{
            ...S.oppPill,
            color: opp.color,
            background: opp.bg,
            border: `1px solid ${opp.border}`,
          }}>
            <span style={S.oppDot}>{opp.dot}</span>
            {opp.headline ?? tier}
          </span>
        )}
        {phone ? (
          <a
            href={telHref(phone)}
            onClick={stop}
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: palette.blue,
              background: palette.bluePale,
              border: `1px solid ${palette.blueBorder}`,
              padding: "5px 10px",
              borderRadius: "999px",
              textDecoration: "none",
              marginTop: "6px",
              alignSelf: "flex-end",
            }}
          >
            Call
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ── Decision-first summary (replaces CloseabilitySummary on the detail card).
// Reads only lead.decision (lib/scoring/decision.ts) plus lightly-derived
// "Last checked" and "Source" — no operator-speak axes.
function DecisionSummary({ lead }) {
  const dec = lead?.decision;
  if (!dec) return null;
  const fitScore = marketFitScore(lead);
  const accent =
    dec.bucket === "Call now" ? "#B91C1C"
    : dec.bucket === "Call this week" ? "#B45309"
    : dec.bucket === "Watch" ? "#64748B"
    : "#94A3B8";
  const lastChecked = lead.lastChecked || lead.websiteProof?.last_checked || null;
  const source = lead.contacts?.source || lead.source || null;
  return (
    <div
      style={{
        border: `1px solid ${accent}33`,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: accent,
        background: "#FAFBFC",
        borderRadius: "8px",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase", color: accent,
        }}>
          {dec.bucket} · {fitScore === null ? `Decision ${dec.score}` : `Market fit ${fitScore}%`} · Decision {dec.score}
        </span>
      </div>
      <div style={{ fontSize: "13px", color: "#1A1A2E", lineHeight: 1.5 }}>
        <strong style={{ color: "#1A1A2E" }}>Why this lead.</strong> {dec.reason}
      </div>
      {dec.suggestedOpening ? (
        <div style={{ fontSize: "13px", color: "#1A1A2E", lineHeight: 1.5, fontStyle: "italic" }}>
          <strong style={{ color: "#1A1A2E", fontStyle: "normal" }}>Suggested opening.</strong> “{dec.suggestedOpening}”
        </div>
      ) : null}
      {(lastChecked || source) && (
        <div style={{ fontSize: "11px", color: "#64748B", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {source ? <span><strong style={{ color: "#1A1A2E" }}>Source.</strong> {source}</span> : null}
          {lastChecked ? <span><strong style={{ color: "#1A1A2E" }}>Last checked.</strong> {String(lastChecked).split("T")[0]}</span> : null}
        </div>
      )}
    </div>
  );
}

// LEGACY — kept temporarily; no longer rendered on the lead card.
// Detail uses DecisionSummary above.
// Small inline chip strip for the three closeability axes. Reuses
// existing oppPill styling footprint so the row stays compact.
function CloseabilityChips({ closeability }) {
  const { intent, leak, reach } = closeability;
  const chip = (label, level, tone) => (
    <span
      title={`${label}: ${level}`}
      style={{
        fontSize: "9.5px",
        fontWeight: 700,
        letterSpacing: "0.04em",
        padding: "2px 7px",
        borderRadius: "999px",
        color: tone.color,
        background: tone.bg,
        border: `1px solid ${tone.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label} · {level}
    </span>
  );
  const intentTone = CLOSEABILITY_TONE.intent[intent.level] ?? CLOSEABILITY_TONE.neutral;
  const leakTone = CLOSEABILITY_TONE.leak[leak.level] ?? CLOSEABILITY_TONE.neutral;
  const reachTone = CLOSEABILITY_TONE.reach[reach.level] ?? CLOSEABILITY_TONE.neutral;
  return (
    <div
      style={{
        display: "flex",
        gap: "5px",
        marginTop: "5px",
        flexWrap: "wrap",
      }}
    >
      {chip("Intent", intent.level, intentTone)}
      {chip("Leak", leak.level, leakTone)}
      {chip("Reach", reach.level, reachTone)}
    </div>
  );
}

// Detail-level closeability strip — one-line bucketReason + three
// axis reasons. Renders at the very top of the lead detail card.
function CloseabilitySummary({ closeability }) {
  const { bucket, score, bucketReason, intent, leak, reach, timing, disqualificationReason } = closeability;
  const accent =
    bucket === "CALL NOW" ? "#B91C1C"
    : bucket === "TODAY" ? "#B45309"
    : bucket === "MONITOR" ? "#64748B"
    : "#94A3B8";
  return (
    <div
      style={{
        border: `1px solid ${accent}33`,
        borderLeftWidth: "3px",
        borderLeftStyle: "solid",
        borderLeftColor: accent,
        background: "#FAFBFC",
        borderRadius: "8px",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
      }}
    >
      <div style={{ display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: accent }}>
          {(OPP_META[bucket]?.headline ?? bucket)} · Ready to close {score}
        </span>
        <span style={{ fontSize: "12px", color: "#1A1A2E", lineHeight: 1.4 }}>
          {bucketReason}
        </span>
      </div>
      <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.45 }}>
        <strong style={{ color: "#1A1A2E" }}>Intent</strong> · {intent.level} — {intent.reason}
      </div>
      <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.45 }}>
        <strong style={{ color: "#1A1A2E" }}>Leak</strong> · {leak.level} — {leak.reason}
      </div>
      <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.45 }}>
        <strong style={{ color: "#1A1A2E" }}>Reach</strong> · {reach.level} — {reach.reason}
      </div>
      {timing.level !== "None" && (
        <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.45 }}>
          <strong style={{ color: "#1A1A2E" }}>Timing</strong> · {timing.level} — {timing.reason}
        </div>
      )}
      {disqualificationReason && (
        <div style={{ fontSize: "11px", color: "#B91C1C", lineHeight: 1.45 }}>
          <strong>Disqualified</strong> · {disqualificationReason}
        </div>
      )}
    </div>
  );
}

const CLOSEABILITY_TONE = {
  neutral: { color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" },
  intent: {
    Strong:  { color: "#047857", bg: "#ECFDF5", border: "#A7F3D0" },
    Weak:    { color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
    Unknown: { color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" },
  },
  leak: {
    High:    { color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA" },
    Medium:  { color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
    Low:     { color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0" },
    None:    { color: "#94A3B8", bg: "#F8FAFC", border: "#E2E8F0" },
  },
  reach: {
    Verified: { color: "#047857", bg: "#ECFDF5", border: "#A7F3D0" },
    Weak:     { color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
    Missing:  { color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA" },
  },
};

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

function LeadDetail({ lead, user, onUpdate, findTask, onStartFindContact, onSwitchTab, hunterAvailable = false }) {
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
      {/* Cross-tab context strip — identical visual identity in
          Today, All Leads, and History so the user reads them as
          one system. Renders at the very top of the detail view. */}
      <LeadContextStrip
        companyName={lead.name}
        trade={lead.trade ? (getTradeModule(lead.trade)?.label ?? lead.trade) : null}
        location={lead.location}
        sourceTab="all-leads"
        statusInput={lead}
        onSwitchTab={onSwitchTab}
      />
      <ContactStrategyPanel lead={lead} />
      {lead.decision && <DecisionSummary lead={lead} />}
      {/* 0. NEXT ACTION — command-center card above the header. Tells the
          rep exactly what to do next + the reason + confidence, and
          launches Call Mode when the action is CALL NOW / FOLLOW UP. */}
      {lead.nextAction && (() => {
        // Prefer the Hunter-verified email when present so the email
        // button always uses the strongest available address. The
        // tooltip surfaces "Verified email (Hunter)" when sourced.
        const bestEmail = lead.verifiedEmail || lead.contacts?.primaryEmail || null;
        const emailIsHunter = lead.emailSource === "hunter";
        return (
          <NextActionBlock
            nextAction={lead.nextAction}
            canCall={!!lead.contacts?.primaryPhone}
            onEnterCallMode={() => setShowCallMode(true)}
            onCall={() => {
              copyText(lead.contacts?.primaryPhone || "").catch(() => {});
              logOutreach("call_started", "next_action");
            }}
            phoneHref={lead.contacts?.primaryPhone ? telHref(lead.contacts.primaryPhone) : null}
            mailtoHref={bestEmail ? buildQuickMailto(bestEmail) : null}
            mailtoTooltip={emailIsHunter ? "Verified email (Hunter)" : (bestEmail ? `Email ${bestEmail}` : undefined)}
            onOpenScan={() => { setShowScanModal(true); logOutreach("scan_viewed", "next_action"); }}
          />
        );
      })()}

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
                    <div style={S.companyHeaderPhoneLabel} title="Verified phone">Primary Phone</div>
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
                      <LeadEmailAction
                        email={lead.contacts?.primaryEmail ?? lead.email ?? null}
                        verifiedEmail={lead.verifiedEmail ?? null}
                        emailSource={lead.emailSource ?? null}
                        emailConfidence={lead.emailConfidence ?? null}
                        companyName={lead.name}
                        hunterAvailable={hunterAvailable}
                        lead={lead}
                        onUpdate={onUpdate}
                        size="md"
                      />
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
                      <LeadEmailAction
                        email={lead.contacts?.primaryEmail ?? lead.email ?? null}
                        verifiedEmail={lead.verifiedEmail ?? null}
                        emailSource={lead.emailSource ?? null}
                        emailConfidence={lead.emailConfidence ?? null}
                        companyName={lead.name}
                        hunterAvailable={hunterAvailable}
                        lead={lead}
                        onUpdate={onUpdate}
                        size="md"
                      />
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
                    <div style={S.callSupportPanelTitle}>Pricing Guide — size on the call</div>
                    <ul style={S.callSupportPanelList}>
                      <li>Ask: <em>“What are you spending per month on lead generation today, and where’s it going?”</em></li>
                      <li>Ask: <em>“Roughly how many jobs do you close per month from online leads?”</em></li>
                      <li>Use their number, not ours. A quoted dollar band without their input will erode credibility on a skeptical buyer.</li>
                      {lead.valueEstimate?.reasoning && <li style={{ color: palette.textSecondary }}>Engine note: {lead.valueEstimate.reasoning}</li>}
                    </ul>
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
  // Prefer the Hunter-verified email when present; emailSource drives
  // the tooltip on the email button below.
  const email = lead.verifiedEmail || c.primaryEmail;
  const emailIsHunter = lead.emailSource === "hunter";
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
                <LeadEmailAction
                  email={lead.contacts?.primaryEmail ?? null}
                  verifiedEmail={lead.verifiedEmail ?? null}
                  emailSource={lead.emailSource ?? null}
                  emailConfidence={lead.emailConfidence ?? null}
                  companyName={lead.name}
                  hunterAvailable={false}
                  size="md"
                  labelOverride="Send Email"
                />
                {/* Call Mode opts out of Find Email — the moment is for
                    dialing, not enrichment side-quests. The detail panel
                    surfaces Find Email when needed. */}
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
      {/* LEFT — Next Action label + decorated pill.
          The "CALL NOW — …" pill is intentionally suppressed: the blue
          Call Now buttons on the calendar cards and detail header are
          the canonical action surface. Other action variants (FOLLOW
          UP / EMAIL FIRST / REVIEW SITE FIRST / SKIP FOR NOW) keep
          their decorated chip — they communicate distinct guidance. */}
      <div style={S.nextActionBarLeft}>
        <span style={S.nextActionLabel}>Next Action</span>
        {action !== "CALL NOW" ? (
          <div style={{
            ...S.nextActionChip,
            color: meta.accent,
            borderColor: meta.accent,
            background: palette.surface,
          }}>
            {decorated}
          </div>
        ) : null}
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
                    <span style={S.oppEstimateLabel}>
                      {oppView.bandIsNeutralized ? "Revenue impact" : "Est. inbound loss"}
                    </span>
                    <span style={{
                      ...S.oppEstimateValue,
                      color: oppView.bandIsNeutralized ? palette.textSecondary : palette.danger,
                      fontWeight: oppView.bandIsNeutralized ? 500 : S.oppEstimateValue.fontWeight,
                    }}>
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
function AssistantChat({ lead, workspace }) {
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
    // Structured LeadContext — the assistant decides from this shape.
    const decision = lead.decision || null;
    const issuesArr = Array.isArray(lead.websiteProof?.issues) ? lead.websiteProof.issues : [];
    const scanIssues = issuesArr
      .slice(0, 5)
      .map((i) => (typeof i === "string" ? i : (i.headline || i.label || i.description || i.reason || "")))
      .filter(Boolean);
    const weakSignals = [];
    if (!lead.contacts?.primaryPhone) weakSignals.push("No verified phone");
    if (!lead.contacts?.primaryEmail) weakSignals.push("No verified email");
    if (!(lead.resolvedBusinessUrl || lead.domain)) weakSignals.push("No website on file");
    if (!lead.lastChecked && !lead.websiteProof?.last_checked) weakSignals.push("Never scanned");
    const context = {
      companyName: lead.name,
      workspaceSlug: workspace?.slug || "",
      moduleId: workspace?.defaultModule || lead.trade || "roofing",
      bucket: decision?.bucket || "",
      score: typeof decision?.score === "number" ? decision.score : 0,
      reason: decision?.reason || "",
      suggestedOpening: decision?.suggestedOpening || "",
      website: lead.resolvedBusinessUrl || lead.domain || lead.websiteProof?.homepage_url || undefined,
      phone: lead.contacts?.primaryPhone || undefined,
      email: lead.contacts?.primaryEmail || undefined,
      status: lead.accountSnapshot?.status || undefined,
      lastChecked: lead.lastChecked || lead.websiteProof?.last_checked || undefined,
      scanIssues,
      source: lead.contacts?.source || undefined,
      weakSignals,
      salesStrategy: lead.salesStrategy || undefined,
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
    "Why does this lead matter?",
    "Give me a stronger opening",
    "What objections should I expect?",
    "What signal is weakest here?",
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

function AiPanel({ selectedLead, findTask, onStartFindContact, workspace }) {
  const [logFlash, setLogFlash] = useState(null);
  const logTimerRef = useRef(null);
  // (id attached in render below for responsive CSS hook)

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
    <div id="meridian-ai" style={S.ai}>
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
            <AssistantChat lead={selectedLead} workspace={workspace} />
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
        <span style={S.todayLabel}>Suggested Calls Today</span>
        <span style={S.todayCount}>{summary.callNow}</span>
        <span style={S.todayHint}>Top-ranked leads, not yet started</span>
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
        <span style={S.todayLabel}>Recommended Follow Ups</span>
        <span style={S.todayCount}>{summary.followUp}</span>
        <span style={S.todayHint}>Leads the system flags for a second pass</span>
        <button
          type="button"
          onClick={onStartFollowUps}
          style={summary.followUp > 0 ? S.todayBtnMuted : S.todayBtnDisabled}
          disabled={summary.followUp === 0}
        >
          Review Follow Ups
        </button>
      </div>
      <div style={S.todayCard}>
        <span style={S.todayLabel}>Suggested Emails</span>
        <span style={S.todayCount}>{summary.emailFirst}</span>
        <span style={S.todayHint}>Lower-friction first touch</span>
        <button
          type="button"
          onClick={onStartEmails}
          style={summary.emailFirst > 0 ? S.todayBtnMuted : S.todayBtnDisabled}
          disabled={summary.emailFirst === 0}
        >
          Review Emails
        </button>
      </div>
    </div>
  );
}

// ── Trade module selector ─────────────────────────────────────────────
// Compact strip above the Calendar Command Center. Premium and minimal:
// six text buttons in one row, no icons, no dropdowns, no redesign.

function TradeModuleSelector({ selectedTradeId, onSelect }) {
  // "all" is a synthetic option for the All Trades calendar view —
  // not a real TRADE_MODULES entry, so we render it inline.
  const items = [
    { id: "all", label: "All Trades" },
    ...TRADE_MODULE_ORDER.map((tid) => ({ id: tid, label: TRADE_MODULES[tid]?.label ?? tid })),
  ];
  return (
    <div
      role="group"
      aria-label="Trade context"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        flexWrap: "wrap",
      }}
    >
      {items.map(({ id: tid, label }) => {
        const cfg = TRADE_MODULES[tid];
        const active = tid === selectedTradeId;
        return (
          <button
            key={tid}
            type="button"
            onClick={() => onSelect(tid)}
            aria-pressed={active}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = palette.textPrimary;
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = palette.textSecondary;
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = "2px solid rgba(37,99,235,0.30)";
              e.currentTarget.style.outlineOffset = "2px";
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = "none";
              e.currentTarget.style.outlineOffset = "0";
            }}
            style={{
              fontSize: "12px",
              fontWeight: active ? 600 : 500,
              padding: "4px 8px",
              borderRadius: "8px",
              cursor: "pointer",
              color: active ? palette.blue : palette.textSecondary,
              background: active ? palette.bluePale : "transparent",
              border: "none",
              whiteSpace: "nowrap",
              transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ── Trade Leads Portfolio ─────────────────────────────────────────────
// Trade-aware Leads view. Renders the same prioritization the Operator
// rail uses, but as a portfolio: Focus Now / Build Next / Monitor with
// the actual lead rows under each ready angle. Empty trades surface a
// calm import path instead of recycling roofing leads.

// Per-angle copy for the redesigned cards. When an angle is missing
// here we fall back to the trade module's own johnServiceAngle.
const ANGLE_COPY = {
  website_conversion: {
    why: "Their site makes it hard to request a quote.",
    sell: "Fix the quote path + mobile conversion.",
  },
  no_website_presence: {
    why: "No website at all — they're invisible to half their buyers.",
    sell: "Sell a one-pager you can ship this week.",
  },
  local_seo_visibility: {
    why: "Buyers search nearby and they don't show up.",
    sell: "Own the local pack with city + neighborhood pages.",
  },
  review_reputation: {
    why: "Reviews are killing them before the call ever happens.",
    sell: "Review automation that lifts the rating fast.",
  },
  emergency_service_visibility: {
    why: "Emergency searches go to whoever shows up first — not them.",
    sell: "Emergency landing page + paid presence to grab the call.",
  },
  storm_response: {
    why: "Storm money closes in 48 hours and they're missing the window.",
    sell: "Storm page + paid search ready before the next event.",
  },
  estimate_followup: {
    why: "Quotes go out, no one follows up — deals walk.",
    sell: "Day-3 / day-7 follow-up cadence on autopilot.",
  },
  seasonal_demand: {
    why: "Demand cycle is coming and they're not ready for it.",
    sell: "Seasonal landing page + dispatch ready before the spike.",
  },
  maintenance_memberships: {
    why: "Recurring revenue is sitting on the table.",
    sell: "Stand up a membership program with a clean signup path.",
  },
  financing_visibility: {
    why: "Buyers want a $/month, they only see a sticker price.",
    sell: "$/mo CTA + financing copy on every install page.",
  },
  portfolio_visibility: {
    why: "The work is good — the portfolio doesn't prove it.",
    sell: "Rebuild the portfolio with shots that match the work.",
  },
  quote_request_funnel: {
    why: "Visitors land, then bail before the quote.",
    sell: "Cleaner landing page + 30-second quote form.",
  },
  project_photography: {
    why: "Real projects, amateur photos.",
    sell: "Monthly project shoot + before/after curation.",
  },
  niche_specialty_positioning: {
    why: "Their specialty work reads like everyone else's.",
    sell: "Premium positioning on a dedicated niche page.",
  },
  service_page_gaps: {
    why: "High-intent searches hit pages that don't exist.",
    sell: "One landing page per service, intent-matched CTA.",
  },
  commercial_maintenance: {
    why: "Property managers send RFPs to whoever they remember — they don't.",
    sell: "Commercial maintenance page + RFP intake.",
  },
  project_pipeline_visibility: {
    why: "Active projects, but owners can't see them anywhere.",
    sell: "Pipeline page + project ledger that builds trust.",
  },
  investor_owner_outreach: {
    why: "Owner outreach is ad hoc — no page closing the loop.",
    sell: "Investor capability page + clean follow-up flow.",
  },
  bid_opportunity_tracking: {
    why: "RFPs land in an inbox, never in a pipeline.",
    sell: "Bid intake form + opportunity tracker.",
  },
  case_study_presence: {
    why: "Wins exist; nothing online proves them.",
    sell: "Case-study pipeline with results up top.",
  },
  reputation_authority: {
    why: "Authority signals are too thin for the deal size.",
    sell: "Authority page + press / partner logo bar.",
  },
};

function angleCopy(a) {
  const c = ANGLE_COPY[a.bucketId];
  return {
    why: c?.why ?? "Real gap on this lead — you can sell into it.",
    sell: c?.sell ?? a.johnServiceAngle ?? "Tight offer aimed at this gap.",
  };
}

// ── Lead state classifier ─────────────────────────────────────────────
//
// Single source of truth for "what state is this lead in?" — drives
// every count surfaced on the trade panel header. Pure / deterministic;
// reads only fields already on the lead + the pipeline overlay.
//
// States (mutually exclusive, one per lead):
//   ready_to_call — actionable today; high closeability + contact info,
//                   no follow-up scheduled, not yet contacted
//   in_progress   — already contacted (CALLED / VOICEMAIL / EMAILED / etc.)
//   follow_up     — has a scheduled follow-up date or FOLLOW_UP status
//   closed        — terminal state (won / lost / disqualified / not_qualified)
function classifyLeadState(lead, pipelineMap) {
  if (!lead) return "ready_to_call";
  const id = lead.key ?? lead.id ?? null;
  const pipe = (id && pipelineMap) ? pipelineMap[id] : null;
  const rawStatus = (pipe?.status ?? lead?.crm?.status ?? lead?.status ?? "")
    .toString()
    .toUpperCase();

  // Terminal — closed.
  if (
    rawStatus === "CLOSED_WON" || rawStatus === "WON" ||
    rawStatus === "CLOSED_LOST" || rawStatus === "LOST" ||
    rawStatus === "DISQUALIFIED" || rawStatus === "NOT_QUALIFIED" ||
    rawStatus === "SKIPPED"
  ) {
    return "closed";
  }

  // Follow-up — explicit status OR a scheduled future action.
  if (rawStatus === "FOLLOW_UP" || rawStatus === "INTERESTED" || rawStatus === "QUALIFIED") {
    return "follow_up";
  }
  if (typeof pipe?.nextActionDate === "string" && pipe.nextActionDate.length > 0) {
    return "follow_up";
  }
  if (typeof pipe?.followUpAt === "string" && pipe.followUpAt.length > 0) {
    return "follow_up";
  }

  // In progress — already contacted in some form.
  if (
    rawStatus === "CONTACTED" || rawStatus === "CALLED" ||
    rawStatus === "VOICEMAIL" || rawStatus === "EMAILED" ||
    rawStatus === "PITCHED"
  ) {
    return "in_progress";
  }

  // Default: ready to call. The system always encourages action;
  // fresh / uncontacted leads get the most actionable bucket.
  return "ready_to_call";
}

// Aggregate counts across a lead pool. Returns { total, readyToCall,
// inProgress, followUp, closed } — all derived from real lead data,
// no placeholders, no static numbers.
function aggregateLeadStates(leads, pipelineMap) {
  const counts = { total: 0, readyToCall: 0, inProgress: 0, followUp: 0, closed: 0 };
  if (!Array.isArray(leads)) return counts;
  for (const lead of leads) {
    counts.total += 1;
    const state = classifyLeadState(lead, pipelineMap);
    if (state === "ready_to_call") counts.readyToCall += 1;
    else if (state === "in_progress") counts.inProgress += 1;
    else if (state === "follow_up") counts.followUp += 1;
    else if (state === "closed") counts.closed += 1;
  }
  return counts;
}

function TradeLeadsPortfolio({
  user,
  selectedTradeId,
  tradeLabel,
  onSelectTrade,
  tradeScopedLeads,
  prioritizedAngles,
  leadsByAngle,
  tradeReadiness,
  onImport,
  importState,
  selectedServiceAngleId,
  onSelectServiceAngle,
  onClearServiceAngle,
  onOpenOperator,
  // Cross-tab selection — when supplied, lead rows in the workspace
  // become clickable and the parent's selectedKey state drives the
  // active row's highlight + the right-side LeadDetail panel.
  selectedLeadKey,
  onSelectLead,
  // Pipeline overlay — drives the lead-state classifier so the trade
  // panel header counts (Ready to call / In progress / Follow-up)
  // reflect actual lead state, not bucket coverage.
  pipelineMap,
}) {
  // Outcome capture (Booked / Follow Up / Dead / No Answer) lives here
  // — local-state-first, persisted to localStorage, ready to swap for
  // a server endpoint later.
  const outcomes = useOutcomes();
  // More Opportunities is collapsed by default — pure execution-first
  // surface. Open via disclosure.
  const [showMoreOpportunities, setShowMoreOpportunities] = useState(false);
  // Lead-state counts — derived from real lead data via the
  // canonical classifier. Replaces the prior "plays ready / need
  // leads" labels (which counted bucket coverage, not leads).
  const leadStateCounts = useMemo(
    () => aggregateLeadStates(tradeScopedLeads, pipelineMap),
    [tradeScopedLeads, pipelineMap],
  );
  const total = leadStateCounts.total;
  const readyToCallCount = leadStateCounts.readyToCall;
  const inProgressCount = leadStateCounts.inProgress;
  const followUpCount = leadStateCounts.followUp;
  // Bucket-coverage stat used elsewhere in the UI (not the header).
  const readyCount = prioritizedAngles.filter((a) => a.count > 0).length;
  const missingCount = prioritizedAngles.length - readyCount;
  const topAngle = prioritizedAngles.find((a) => a.count > 0) ?? null;
  const activeAngle = selectedServiceAngleId
    ? prioritizedAngles.find((a) => a.bucketId === selectedServiceAngleId) ?? null
    : null;
  // Featured angle in the workspace: real selection wins; otherwise
  // the top Focus Now angle previews. Selecting in state requires a
  // user click — never mutated implicitly.
  const featuredAngle =
    activeAngle ??
    prioritizedAngles.find((a) => a.priorityLabel === "Focus Now" && a.count > 0) ??
    topAngle ??
    prioritizedAngles[0] ??
    null;

  const focusAngles = prioritizedAngles.filter((a) => a.priorityLabel === "Focus Now");
  const buildAngles = prioritizedAngles.filter((a) => a.priorityLabel === "Build Next");
  const monitorAngles = prioritizedAngles.filter((a) => a.priorityLabel === "Monitor");

  const tierStats = (list) => ({
    angles: list.length,
    leads: list.reduce((s, x) => s + x.count, 0),
  });
  const focusStats = tierStats(focusAngles);
  const buildStats = tierStats(buildAngles);
  const monitorStats = tierStats(monitorAngles);

  // The decision engine is the single producer of "what's next." No
  // separate global-deal heuristic. callBucket routes the operator to
  // the Calls tab with the requested bucket pinned.
  const callBucket = (bucketId) => {
    if (typeof onSelectServiceAngle === "function" && selectedServiceAngleId !== bucketId) {
      onSelectServiceAngle(bucketId);
    }
    if (typeof onOpenOperator === "function") onOpenOperator();
  };

  // Opportunity system — config-driven, tiered bucket layout. Pure
  // derivation from the existing prioritization + leadsByAngle. The
  // engine still owns ranking; this layer owns presentation grouping.
  // `meaningfulOnly` hides leadless / low-revenue buckets so the
  // operator only sees opportunities they can actually work today.
  const opportunitySystem = useMemo(
    () => buildOpportunitySystem(prioritizedAngles, leadsByAngle, selectedTradeId, { meaningfulOnly: true }),
    [prioritizedAngles, leadsByAngle, selectedTradeId],
  );

  // The decision engine lives at the root and feeds the Calls tab.
  // Opportunities only needs bucket performance to power the perf chips.

  // Per-bucket performance for the bucket cards' performance chips.
  const bucketPerformance = useMemo(() => {
    const potentialMap = new Map();
    for (const t of opportunitySystem.tiers) {
      for (const b of t.buckets) potentialMap.set(b.bucketId, b.revenuePotential);
    }
    return bucketPerformanceMap(outcomes.events, potentialMap, outcomes.now);
  }, [opportunitySystem, outcomes.events, outcomes.now]);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: "16px",
      maxWidth: "1280px",
      margin: "0 auto",
      width: "100%",
    }}>
      {/* Opportunities tab is the discovery surface only. No money
          meter, no Call Now bar — execution lives in Calls. The user
          picks a bucket here and the centralized callBucket(id)
          handler routes them to Calls with that bucket pinned. */}

      {/* Trade pills — visually secondary, kept for trade switching */}
      <div>
        <TradeModuleSelector selectedTradeId={selectedTradeId} onSelect={onSelectTrade} />
      </div>

      {/* ─────────── TIER 2 · NEXT BEST PLAY ─────────── */}
      {featuredAngle && (
        <NextBestPlay
          angle={featuredAngle}
          leadsByAngle={leadsByAngle}
          isActive={!!activeAngle && activeAngle.bucketId === featuredAngle.bucketId}
          onStartCalling={() => callBucket(featuredAngle.bucketId)}
        />
      )}

      {/* Portfolio Command Header — drives import + Calls entry. */}
      <div style={{
        padding: "24px 28px",
        borderRadius: "16px",
        background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)",
        border: `1px solid ${palette.borderLight}`,
        boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.06)",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}>
        <div style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "16px",
          flexWrap: "wrap",
        }}>
          <div>
            <div style={{
              fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
              color: palette.blue, textTransform: "uppercase",
            }}>
              Lead pipeline
            </div>
            <div style={{ fontSize: "26px", fontWeight: 700, color: palette.textPrimary, marginTop: "4px", lineHeight: 1.15 }}>
              {tradeLabel} Leads
            </div>
            {/* Four real counts derived from the lead-state classifier.
                No placeholders; every number reflects actual leads in
                the trade-scoped pool. */}
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "10px 18px",
              alignItems: "baseline",
              fontSize: "13px",
              color: palette.textSecondary,
              marginTop: "8px",
            }}>
              {activeAngle ? (
                <span>
                  <strong style={{ color: palette.textPrimary }}>{activeAngle.bucketLabel}</strong>
                  {" · "}
                  {activeAngle.count} lead{activeAngle.count === 1 ? "" : "s"} ready to call
                </span>
              ) : (
                <>
                  <span>
                    <strong style={{ color: palette.textPrimary, fontSize: "14px" }}>{total}</strong>
                    {" "}lead{total === 1 ? "" : "s"}
                  </span>
                  <span>
                    <strong style={{ color: palette.success, fontSize: "14px" }}>{readyToCallCount}</strong>
                    {" "}ready to call
                  </span>
                  <span>
                    <strong style={{ color: palette.blue, fontSize: "14px" }}>{inProgressCount}</strong>
                    {" "}in progress
                  </span>
                  <span>
                    <strong style={{ color: palette.textPrimary, fontSize: "14px" }}>{followUpCount}</strong>
                    {" "}follow-up scheduled
                  </span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {total === 0 && (
              <button
                type="button"
                onClick={onImport}
                disabled={importState?.loading}
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: palette.blue,
                  background: palette.bluePale,
                  border: `1px solid ${palette.blueBorder}`,
                  borderRadius: "10px",
                  padding: "10px 16px",
                  cursor: importState?.loading ? "default" : "pointer",
                  opacity: importState?.loading ? 0.7 : 1,
                  transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              >
                {importState?.loading ? `Adding ${tradeLabel} leads…` : `Add ${tradeLabel} leads`}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenOperator}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                background: palette.blue,
                border: "none",
                borderRadius: "10px",
                padding: "10px 18px",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(37,99,235,0.25), 0 6px 18px -6px rgba(37,99,235,0.4)",
                transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              Start calling →
            </button>
          </div>
        </div>

        {/* Selection chips */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onClearServiceAngle}
            aria-pressed={!selectedServiceAngleId}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: "999px",
              cursor: "pointer",
              color: !selectedServiceAngleId ? palette.blue : palette.textSecondary,
              background: !selectedServiceAngleId ? palette.bluePale : "transparent",
              border: `1px solid ${!selectedServiceAngleId ? palette.blueBorder : palette.borderLight}`,
              whiteSpace: "nowrap",
              transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            All Angles
          </button>
          {activeAngle && (
            <button
              type="button"
              onClick={onClearServiceAngle}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                padding: "6px 14px",
                borderRadius: "999px",
                cursor: "pointer",
                color: palette.blue,
                background: palette.bluePale,
                border: `1px solid ${palette.blueBorder}`,
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                whiteSpace: "nowrap",
              }}
            >
              {activeAngle.bucketLabel}
              <span aria-hidden="true" style={{ fontSize: "14px", lineHeight: 1 }}>×</span>
            </button>
          )}
        </div>

        {/* Sticky banner: Operator linkage when an angle is active */}
        {activeAngle && (
          <div style={{
            padding: "10px 14px",
            borderRadius: "10px",
            background: palette.bluePale,
            border: `1px solid ${palette.blueBorder}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}>
            <div style={{ fontSize: "12px", color: palette.textPrimary, fontWeight: 500 }}>
              You&apos;re working on <span style={{ fontWeight: 700, color: palette.blue }}>{activeAngle.bucketLabel}</span>.
            </div>
            <button
              type="button"
              onClick={onOpenOperator}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: palette.blue,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Start calling →
            </button>
          </div>
        )}
      </div>

      {importState?.message && (
        <div style={{
          padding: "10px 14px",
          fontSize: "12px",
          borderRadius: "10px",
          color: importState.kind === "error" ? palette.danger : palette.success,
          background: importState.kind === "error" ? palette.dangerBg : palette.successBg,
          border: `1px solid ${importState.kind === "error" ? "#FECACA" : "#BBF7D0"}`,
        }}>
          {importState.message}
        </div>
      )}

      {total === 0 && (
        <div style={{
          padding: "28px 28px",
          borderRadius: "14px",
          background: palette.surface,
          border: `1px solid ${palette.borderLight}`,
          boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
        }}>
          <div style={{ fontSize: "16px", fontWeight: 700, color: palette.textPrimary, marginBottom: "6px" }}>
            No {tradeLabel} leads yet.
          </div>
          <div style={{ fontSize: "13px", color: palette.textSecondary, lineHeight: 1.55, maxWidth: "560px" }}>
            Each play below is a way to make money once you have leads. Add some {tradeLabel} companies and you can start calling today.
          </div>
          {tradeReadiness?.missingEnvVars?.length ? (
            <div style={{ fontSize: "12px", color: palette.textTertiary, marginTop: "10px" }}>
              Connect <code style={{
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: "11px",
                background: palette.surfaceHover,
                padding: "2px 6px",
                borderRadius: "4px",
              }}>{tradeReadiness.missingEnvVars[0]}</code> to activate automated sourcing.
            </div>
          ) : null}
        </div>
      )}

      {/* ─────────── TIER 3 · MORE OPPORTUNITIES (collapsed) ─────────── */}
      {prioritizedAngles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <button
            type="button"
            onClick={() => setShowMoreOpportunities((v) => !v)}
            aria-expanded={showMoreOpportunities}
            style={{
              alignSelf: "flex-start",
              fontSize: "12px",
              fontWeight: 600,
              color: palette.textSecondary,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              letterSpacing: "0.02em",
            }}
          >
            More ways to make money {showMoreOpportunities ? "↑" : "↓"}
            <span style={{ color: palette.textTertiary, fontWeight: 500 }}>
              {(() => {
                const n = opportunitySystem.tiers.reduce(
                  (s, t) => s + t.buckets.filter((b) => b.ready).length, 0,
                );
                return n > 0 ? ` · ${n} ready` : "";
              })()}
            </span>
          </button>

          {showMoreOpportunities && (
            <>
              <OpportunitySystem
                system={opportunitySystem}
                selectedServiceAngleId={selectedServiceAngleId}
                onCallBucket={callBucket}
                bucketPerformance={bucketPerformance}
              />

              {/* Working surface — full lead browser for the active angle. */}
              {featuredAngle && (
                <FeaturedAngleWorkspace
                  angle={featuredAngle}
                  isActive={!!activeAngle && activeAngle.bucketId === featuredAngle.bucketId}
                  leads={leadsByAngle?.[featuredAngle.bucketId] ?? []}
                  onSelect={() => onSelectServiceAngle?.(featuredAngle.bucketId)}
                  onOpenOperator={onOpenOperator}
                  selectedTradeId={selectedTradeId}
                  selectedLeadKey={selectedLeadKey}
                  onSelectLead={onSelectLead}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Single lead-key helper lives in lib/leads/decisionEngine.ts
// (`leadKeyOf`). Re-exported via lib/leads/outcomes.ts. Use that.

// ── MoneyExecutionBar ─────────────────────────────────────────────────
// Tier 1A surface. Premium white/off-white card. Big money number.
// Daily target + calls left to hit pace. Quick Mode toggle on the right.
// Secondary stats (ranked / contacted / closed) sit small + muted so the
// dollars dominate.
// ── DealsPipeline ─────────────────────────────────────────────────────
// Premium pipeline tab. Reads from useDeals (outcomes + manual
// mutations) and renders: pipeline summary strip + 4-column board +
// detail drawer. No fabricated data — every deal exists because the
// user logged a real outcome.
function DealsPipeline({ dealsHook, onCallDeal, onLeadSelected, onSwitchTab }) {
  const onGoToCalls = () => onCallDeal?.(null);
  const { deals, summary, moveDealStage, addDealNote, markDealWon, markDealLost, setDealNextAction } = dealsHook;
  const [openDealId, setOpenDealId] = useState(null);
  const [filter, setFilter] = useState("all"); // all | due | high | needs_followup | no_phone | won | lost
  const [search, setSearch] = useState("");

  // Cross-tab bridge — when a deal is opened, also notify the parent so
  // selectedKey (used by the All Leads tab) tracks the same lead. Pure
  // pass-through; the parent decides how to react.
  const handleOpenDealId = useCallback((id) => {
    setOpenDealId(id);
    if (typeof onLeadSelected === "function") {
      const d = id ? deals.find((x) => x.id === id) : null;
      if (d) onLeadSelected(d);
    }
  }, [deals, onLeadSelected]);

  const now = new Date();
  const todayStr = (() => {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  })();

  const visibleDeals = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deals.filter((d) => {
      if (q) {
        const hay = `${d.companyName} ${d.trade ?? ""} ${d.bucketLabel ?? ""} ${d.notes.map((n) => n.text).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      switch (filter) {
        case "due":
          return d.followUpOn && d.followUpOn <= todayStr && d.stage !== "lost" && d.stage !== "closed_won";
        case "high":
          return d.estimatedValue >= 5000 && d.stage !== "lost";
        case "needs_followup":
          return !!d.followUpOn && d.stage !== "lost" && d.stage !== "closed_won";
        case "no_phone":
          return !d.contact?.phone && d.stage !== "lost";
        case "won":
          return d.stage === "closed_won";
        case "lost":
          return d.stage === "lost";
        default:
          return true;
      }
    });
  }, [deals, filter, search, todayStr]);

  const stageGroups = useMemo(() => {
    const groups = {
      closing_soon: [],
      in_progress: [],
      new: [],
      lost: [],
    };
    for (const d of visibleDeals) {
      if (d.stage === "closed_won") continue; // surfaced via Won Today metric
      groups[d.stage].push(d);
    }
    for (const k of Object.keys(groups)) {
      groups[k] = sortDealsForStage(groups[k], now);
    }
    return groups;
  }, [visibleDeals, now]);

  const openDeal = openDealId ? deals.find((d) => d.id === openDealId) ?? null : null;

  const isEmpty = deals.length === 0;

  const filterTabs = [
    { id: "all", label: "All" },
    { id: "due", label: "Due today" },
    { id: "high", label: "High value" },
    { id: "needs_followup", label: "Needs follow-up" },
    { id: "no_phone", label: "No phone" },
    { id: "won", label: "Won" },
    { id: "lost", label: "Lost" },
  ];

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "16px",
      maxWidth: "1280px", margin: "0 auto", width: "100%",
    }}>
      <DealsPipelineSummary
        summary={summary}
        onCallDeal={onCallDeal}
        onOpenDeal={handleOpenDealId}
      />

      {/* Filters + search */}
      {!isEmpty && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {filterTabs.map((t) => {
              const active = filter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFilter(t.id)}
                  style={{
                    fontSize: "12px",
                    fontWeight: active ? 700 : 500,
                    color: active ? palette.blue : palette.textSecondary,
                    background: active ? palette.bluePale : "transparent",
                    border: `1px solid ${active ? palette.blueBorder : palette.borderLight}`,
                    borderRadius: "999px",
                    padding: "6px 12px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies"
              style={{
                width: "100%",
                fontSize: "13px",
                color: palette.textPrimary,
                background: palette.surface,
                border: `1px solid ${palette.borderLight}`,
                borderRadius: "10px",
                padding: "9px 12px",
                outline: "none",
              }}
            />
          </div>
        </div>
      )}

      {isEmpty ? (
        <DealsEmpty onGoToCalls={onGoToCalls} />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: "14px",
          alignItems: "start",
        }}>
          <DealsStageColumn
            stage="closing_soon"
            tone={palette.success}
            deals={stageGroups.closing_soon}
            emptyText="Nothing close yet. Keep calling."
            now={now}
            onOpenDeal={handleOpenDealId}
          />
          <DealsStageColumn
            stage="in_progress"
            tone={palette.blue}
            deals={stageGroups.in_progress}
            emptyText="No conversations going yet."
            now={now}
            onOpenDeal={handleOpenDealId}
          />
          <DealsStageColumn
            stage="new"
            tone={palette.textSecondary}
            deals={stageGroups.new}
            emptyText="Nothing new yet."
            now={now}
            onOpenDeal={handleOpenDealId}
          />
          <DealsStageColumn
            stage="lost"
            tone={palette.textTertiary}
            deals={stageGroups.lost}
            emptyText="No lost deals yet."
            now={now}
            onOpenDeal={handleOpenDealId}
            muted
          />
        </div>
      )}

      {openDeal && (
        <DealDetailPanel
          deal={openDeal}
          onClose={() => setOpenDealId(null)}
          onCallDeal={onCallDeal}
          onMoveStage={(stage) => moveDealStage(openDeal.id, stage)}
          onAddNote={(note) => addDealNote(openDeal.id, note)}
          onMarkWon={() => markDealWon(openDeal.id)}
          onMarkLost={() => markDealLost(openDeal.id)}
          onSetNextAction={(text) => setDealNextAction(openDeal.id, text)}
          onSwitchTab={onSwitchTab}
        />
      )}
    </div>
  );
}

function DealsPipelineSummary({ summary, onCallDeal, onOpenDeal }) {
  const totalLabel = formatMoney(summary.totalActiveValue) ?? "$0";
  const wonLabel = formatMoney(summary.wonToday) ?? "$0";
  const next = summary.nextFollowUp;
  return (
    <div style={{
      padding: "18px 22px",
      borderRadius: "16px",
      background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)",
      border: `1px solid ${palette.borderLight}`,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.06)",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
        <div>
          <div style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em",
            color: palette.textTertiary, textTransform: "uppercase",
          }}>
            Pipeline
          </div>
          <div style={{
            fontSize: "32px", fontWeight: 800, color: palette.textPrimary,
            marginTop: "2px", lineHeight: 1.1, letterSpacing: "-0.01em",
            fontVariantNumeric: "tabular-nums",
          }}>
            {totalLabel} <span style={{ fontSize: "16px", fontWeight: 600, color: palette.textSecondary }}>active value</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontVariantNumeric: "tabular-nums" }}>
          <PipelineMetric label="Closing soon" value={summary.byStage.closing_soon.value} count={summary.byStage.closing_soon.count} tone={palette.success} />
          <PipelineMetric label="In progress" value={summary.byStage.in_progress.value} count={summary.byStage.in_progress.count} tone={palette.blue} />
          <PipelineMetric label="New" value={summary.byStage.new.value} count={summary.byStage.new.count} tone={palette.textSecondary} />
          <PipelineMetric label="Won today" value={summary.wonToday} count={summary.byStage.closed_won.count} tone={palette.success} highlight />
        </div>
      </div>
      {next ? (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap",
          padding: "10px 14px",
          borderRadius: "12px",
          background: next.due === "late" ? "rgba(220,38,38,0.06)" : palette.bluePale,
          border: `1px solid ${next.due === "late" ? "#FECACA" : palette.blueBorder}`,
        }}>
          <div style={{ fontSize: "13px", color: palette.textPrimary, lineHeight: 1.4 }}>
            <span style={{
              fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
              color: next.due === "late" ? palette.danger : palette.blue,
              textTransform: "uppercase", marginRight: "8px",
            }}>
              {next.due === "late" ? "Late · Next follow-up" : "Next follow-up"}
            </span>
            <span style={{ fontWeight: 700 }}>{next.deal.companyName}</span>
            <span style={{ color: palette.textSecondary }}> · {next.deal.nextAction}</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => onOpenDeal?.(next.deal.id)}
              style={{
                fontSize: "12px", fontWeight: 600, color: palette.blue,
                background: "transparent", border: `1px solid ${palette.blueBorder}`,
                borderRadius: "8px", padding: "6px 12px", cursor: "pointer",
              }}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => onCallDeal?.(next.deal)}
              style={{
                fontSize: "12px", fontWeight: 700, color: "#fff",
                background: palette.blue, border: "none",
                borderRadius: "8px", padding: "6px 14px", cursor: "pointer",
                boxShadow: "0 1px 2px rgba(37,99,235,0.25)",
              }}
            >
              Call again →
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "12px", color: palette.textTertiary }}>
          You&apos;re caught up.
        </div>
      )}
    </div>
  );
}

function PipelineMetric({ label, value, count, tone, highlight = false }) {
  const v = formatMoney(value) ?? "$0";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: "80px" }}>
      <span style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase" }}>
        {label}
      </span>
      <span style={{
        fontSize: "16px", fontWeight: 800, color: highlight ? tone : palette.textPrimary,
        letterSpacing: "-0.01em",
      }}>
        {v}
      </span>
      <span style={{ fontSize: "11px", color: palette.textTertiary }}>
        {count} deal{count === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function DealsStageColumn({ stage, tone, deals, emptyText, now, onOpenDeal, muted = false }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "10px",
      opacity: muted ? 0.85 : 1,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" }}>
        <div style={{
          fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
          color: tone, textTransform: "uppercase",
        }}>
          {DEAL_STAGE_LABELS[stage]}
        </div>
        <div style={{ fontSize: "11px", color: palette.textTertiary, fontVariantNumeric: "tabular-nums" }}>
          {deals.length} · {formatMoney(deals.reduce((s, d) => s + d.estimatedValue, 0)) ?? "$0"}
        </div>
      </div>
      {deals.length === 0 ? (
        <div style={{
          fontSize: "12px", color: palette.textTertiary, fontStyle: "italic",
          padding: "14px 12px",
          borderRadius: "10px",
          background: palette.surface,
          border: `1px dashed ${palette.borderLight}`,
        }}>
          {emptyText}
        </div>
      ) : (
        deals.map((d) => (
          <DealCard key={d.id} deal={d} now={now} onOpen={() => onOpenDeal?.(d.id)} muted={muted} />
        ))
      )}
    </div>
  );
}

function DealCard({ deal, now, onOpen, muted = false }) {
  const ev = formatMoney(deal.estimatedValue);
  const due = (() => {
    if (!deal.followUpOn) return null;
    const today = (() => {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    })();
    const tomorrow = (() => {
      const d = new Date(now); d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    if (deal.followUpOn === today) return { label: "Due today", color: palette.danger, bg: "rgba(220,38,38,0.08)" };
    if (deal.followUpOn === tomorrow) return { label: "Due tomorrow", color: palette.blue, bg: palette.bluePale };
    if (deal.followUpOn < today) return { label: "Late", color: palette.danger, bg: "rgba(220,38,38,0.10)" };
    return null;
  })();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(); } }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04), 0 12px 28px -10px rgba(15,23,42,0.16)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.03)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      style={{
        padding: "14px 16px",
        borderRadius: "12px",
        background: palette.surface,
        border: `1px solid ${palette.borderLight}`,
        boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
        display: "flex", flexDirection: "column", gap: "8px",
        cursor: "pointer",
        transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: muted ? 0.75 : 1,
        outline: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
        <div style={{
          fontSize: "14px", fontWeight: 700, color: palette.textPrimary,
          lineHeight: 1.2,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1, minWidth: 0,
        }}>
          {deal.companyName}
        </div>
        {ev && (
          <span style={{
            fontSize: "12px", fontWeight: 700,
            color: palette.success,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}>
            ~{ev}
          </span>
        )}
      </div>
      {deal.bucketLabel && (
        <div style={{
          fontSize: "11px", color: palette.textTertiary, fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {deal.bucketLabel}
        </div>
      )}
      {deal.lastAction && (
        <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600, color: palette.textPrimary }}>Last:</span> {deal.lastAction}
        </div>
      )}
      <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.4 }}>
        <span style={{ fontWeight: 600, color: palette.textPrimary }}>Next:</span> {deal.nextAction}
      </div>
      {due && (
        <span style={{
          alignSelf: "flex-start",
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
          color: due.color, textTransform: "uppercase",
          padding: "2px 8px",
          borderRadius: "999px",
          background: due.bg,
          border: `1px solid ${due.color === palette.danger ? "#FECACA" : palette.blueBorder}`,
        }}>
          {due.label}
        </span>
      )}
    </div>
  );
}

function DealDetailPanel({ deal, onClose, onCallDeal, onMoveStage, onAddNote, onMarkWon, onMarkLost, onSetNextAction, onSwitchTab }) {
  const [noteText, setNoteText] = useState("");
  const [nextActionDraft, setNextActionDraft] = useState(deal.nextAction);
  const tel = deal.contact?.phone ? `tel:${deal.contact.phone.replace(/[^\d+]/g, "")}` : null;
  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.32)",
        zIndex: 1100, display: "flex", justifyContent: "flex-end",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={`Deal: ${deal.companyName}`}
        style={{
          width: "min(440px, 100%)", height: "100%",
          background: palette.surface,
          boxShadow: "-12px 0 30px rgba(15,23,42,0.10)",
          borderLeft: `1px solid ${palette.border}`,
          display: "flex", flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <header style={{
          padding: "18px 22px",
          borderBottom: `1px solid ${palette.borderLight}`,
          display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px",
        }}>
          <div>
            <div style={{
              fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
              color: palette.blue, textTransform: "uppercase",
            }}>
              {DEAL_STAGE_LABELS[deal.stage]}
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: palette.textPrimary, marginTop: "2px", lineHeight: 1.2 }}>
              {deal.companyName}
            </div>
            <div style={{ fontSize: "12px", color: palette.textSecondary, marginTop: "4px" }}>
              {formatMoney(deal.estimatedValue) ?? "$0"} · {Math.round((deal.closeProbability ?? 0) * 100)}% chance
              {deal.bucketLabel ? ` · ${deal.bucketLabel}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: "20px", color: palette.textTertiary,
              background: "transparent", border: "none", cursor: "pointer",
              padding: "0 4px", lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: "18px", flex: 1 }}>
          {/* Cross-tab context strip — identical visual identity in
              Today, All Leads, and History so the user reads them as
              one system. Sits at the top of the deal detail body. */}
          <LeadContextStrip
            companyName={deal.companyName}
            trade={deal.trade ?? null}
            location={deal.location ?? null}
            sourceTab="history"
            statusInput={deal}
            onSwitchTab={onSwitchTab}
          />
          {/* Next action */}
          <section>
            <div style={DETAIL_EYEBROW}>Next action</div>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={nextActionDraft}
                onChange={(e) => setNextActionDraft(e.target.value)}
                style={{
                  flex: 1, fontSize: "13px",
                  color: palette.textPrimary,
                  background: palette.surfaceHover,
                  border: `1px solid ${palette.borderLight}`,
                  borderRadius: "10px", padding: "10px 12px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => onSetNextAction?.(nextActionDraft)}
                disabled={!nextActionDraft.trim() || nextActionDraft === deal.nextAction}
                style={{
                  fontSize: "12px", fontWeight: 700,
                  color: !nextActionDraft.trim() || nextActionDraft === deal.nextAction ? palette.textTertiary : palette.blue,
                  background: palette.bluePale,
                  border: `1px solid ${palette.blueBorder}`,
                  borderRadius: "10px", padding: "8px 12px",
                  cursor: !nextActionDraft.trim() || nextActionDraft === deal.nextAction ? "default" : "pointer",
                }}
              >
                Save
              </button>
            </div>
          </section>

          {/* Primary action — route to the Calls tab. The Calls tab is
              the only place outcomes are recorded so the user lands
              there ready to dial with the script primed. */}
          <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={DETAIL_EYEBROW}>Next call</div>
            <button
              type="button"
              onClick={() => onCallDeal?.(deal)}
              disabled={!tel}
              style={{
                ...DETAIL_PRIMARY_BTN,
                opacity: tel ? 1 : 0.5,
                cursor: tel ? "pointer" : "not-allowed",
              }}
            >
              {tel ? "Call again →" : "No phone on file"}
            </button>
            {/* History deals: show Email when present; never offer
                Find Email here (the deal already happened — enrichment
                belongs to active leads in Today / All Leads). */}
            <LeadEmailAction
              email={deal.contact?.email ?? null}
              verifiedEmail={deal.contact?.verifiedEmail ?? null}
              emailSource={deal.contact?.emailSource ?? null}
              emailConfidence={deal.contact?.emailConfidence ?? null}
              companyName={deal.companyName}
              hunterAvailable={false}
              allowFindEmail={false}
              size="md"
            />
          </section>

          {/* Stage actions */}
          <section style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={DETAIL_EYEBROW}>Move stage</div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {["closing_soon", "in_progress", "new"].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onMoveStage?.(s)}
                  style={{
                    fontSize: "11px", fontWeight: deal.stage === s ? 700 : 500,
                    color: deal.stage === s ? palette.blue : palette.textSecondary,
                    background: deal.stage === s ? palette.bluePale : "transparent",
                    border: `1px solid ${deal.stage === s ? palette.blueBorder : palette.borderLight}`,
                    borderRadius: "999px", padding: "6px 12px", cursor: "pointer",
                  }}
                >
                  {DEAL_STAGE_LABELS[s]}
                </button>
              ))}
              <button
                type="button"
                onClick={onMarkWon}
                style={{
                  fontSize: "11px", fontWeight: 700,
                  color: palette.success, background: palette.successBg,
                  border: "1px solid #BBF7D0", borderRadius: "999px",
                  padding: "6px 12px", cursor: "pointer",
                }}
              >
                Mark won
              </button>
              <button
                type="button"
                onClick={() => { if (typeof window === "undefined" || window.confirm("Mark this deal as not a fit?")) onMarkLost?.(); }}
                style={{
                  fontSize: "11px", fontWeight: 700,
                  color: palette.danger, background: palette.dangerBg,
                  border: "1px solid #FECACA", borderRadius: "999px",
                  padding: "6px 12px", cursor: "pointer",
                }}
              >
                Not a fit
              </button>
            </div>
          </section>

          {/* Add note */}
          <section style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={DETAIL_EYEBROW}>Add note</div>
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={2}
              placeholder="Anything worth remembering for next call…"
              style={{
                fontSize: "13px", color: palette.textPrimary,
                background: palette.surfaceHover,
                border: `1px solid ${palette.borderLight}`,
                borderRadius: "10px", padding: "10px 12px",
                outline: "none", resize: "none", lineHeight: 1.4,
                fontFamily: "inherit",
              }}
            />
            <button
              type="button"
              onClick={() => { onAddNote?.(noteText); setNoteText(""); }}
              disabled={!noteText.trim()}
              style={{
                alignSelf: "flex-start",
                fontSize: "11px", fontWeight: 700,
                color: !noteText.trim() ? palette.textTertiary : "#fff",
                background: !noteText.trim() ? palette.surfaceHover : palette.blue,
                border: "none", borderRadius: "10px", padding: "8px 14px",
                cursor: !noteText.trim() ? "default" : "pointer",
              }}
            >
              Add note
            </button>
          </section>

          {deal.notes.length > 0 && (
            <section>
              <div style={DETAIL_EYEBROW}>Notes</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {deal.notes.slice().reverse().map((n, i) => (
                  <div key={`note-${i}`} style={{
                    fontSize: "12px", color: palette.textPrimary, lineHeight: 1.5,
                    padding: "8px 10px",
                    borderRadius: "8px",
                    background: palette.surfaceHover,
                    border: `1px solid ${palette.borderLight}`,
                  }}>
                    {n.text}
                    <div style={{ fontSize: "10px", color: palette.textTertiary, marginTop: "2px" }}>
                      {new Date(n.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Timeline */}
          <section>
            <div style={DETAIL_EYEBROW}>Timeline</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {deal.history.slice().reverse().map((h, i) => (
                <div key={`h-${i}`} style={{
                  fontSize: "12px", color: palette.textSecondary, lineHeight: 1.4,
                  padding: "6px 0",
                  borderTop: i === 0 ? "none" : `1px solid ${palette.borderLight}`,
                }}>
                  <div style={{ fontSize: "10px", color: palette.textTertiary, marginBottom: "2px" }}>
                    {new Date(h.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </div>
                  {h.summary}
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function DealsEmpty({ onGoToCalls }) {
  return (
    <div style={{
      padding: "32px 28px",
      borderRadius: "16px",
      background: palette.surface,
      border: `1px dashed ${palette.borderLight}`,
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "10px",
    }}>
      <div style={{ fontSize: "16px", fontWeight: 700, color: palette.textPrimary }}>
        No deals yet.
      </div>
      <div style={{ fontSize: "13px", color: palette.textSecondary, lineHeight: 1.55, maxWidth: "480px" }}>
        Start calling and your pipeline will build itself. Every outcome you log becomes a deal here.
      </div>
      <button
        type="button"
        onClick={onGoToCalls}
        style={{
          marginTop: "6px",
          fontSize: "13px", fontWeight: 700,
          color: "#fff", background: palette.blue,
          border: "none", borderRadius: "10px",
          padding: "10px 16px", cursor: "pointer",
          boxShadow: "0 1px 2px rgba(37,99,235,0.25), 0 6px 14px -6px rgba(37,99,235,0.45)",
        }}
      >
        Go to Calls →
      </button>
    </div>
  );
}

const DETAIL_EYEBROW = {
  fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
  color: palette.textTertiary, textTransform: "uppercase",
  marginBottom: "6px",
};
const DETAIL_PRIMARY_BTN = {
  fontSize: "13px", fontWeight: 700,
  color: "#fff", background: palette.blue,
  border: "none", borderRadius: "10px",
  padding: "10px 16px", cursor: "pointer",
  textDecoration: "none",
  letterSpacing: "0.02em",
  boxShadow: "0 1px 2px rgba(37,99,235,0.25), 0 6px 14px -6px rgba(37,99,235,0.45)",
};

// MoneyExecutionBar — currently unused. Money signals live on Deals
// (pipeline summary) and Calls (queueRemaining + outcome confirmation).
// Kept for future Calls-tab top strip; not mounted today.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MoneyExecutionBar({ userName, bookedToday, target, callsLeft, callsMadeToday, contactedCount, closedCount, quickMode, onToggleQuickMode }) {
  const bookedLabel = formatMoney(bookedToday) ?? "$0";
  const targetLabel = formatMoney(target) ?? "—";
  const progress = target > 0 ? Math.min(1, bookedToday / target) : 0;
  return (
    <div style={{
      padding: "18px 22px",
      borderRadius: "16px",
      background: "linear-gradient(180deg, #FFFFFF, #F8FAFC)",
      border: `1px solid ${palette.borderLight}`,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.06)",
      display: "flex",
      alignItems: "center",
      gap: "20px",
      flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em",
          color: palette.textTertiary, textTransform: "uppercase",
        }}>
          Today{userName ? ` · ${userName}` : ""}
        </div>
        <div style={{
          fontSize: "32px", fontWeight: 800, color: palette.textPrimary,
          marginTop: "2px", lineHeight: 1.1, letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
        }}>
          {bookedLabel} booked today
          <span style={{
            fontSize: "16px", fontWeight: 600, color: palette.textSecondary,
            marginLeft: "8px",
          }}>
            / {targetLabel} goal
          </span>
        </div>
        <div style={{
          height: "4px",
          background: palette.surfaceHover,
          borderRadius: "999px",
          overflow: "hidden",
          marginTop: "10px",
          maxWidth: "320px",
        }}>
          <div style={{
            width: `${Math.round(progress * 100)}%`,
            height: "100%",
            background: progress >= 1 ? palette.success : palette.blue,
            transition: "width 320ms cubic-bezier(0.4, 0, 0.2, 1)",
          }} />
        </div>
        <div style={{
          fontSize: "12px", color: palette.textSecondary,
          marginTop: "6px", fontWeight: 500,
        }}>
          {callsLeft > 0
            ? <>{callsLeft} more call{callsLeft === 1 ? "" : "s"} to hit your goal</>
            : target > 0 && bookedToday >= target
              ? <span style={{ color: palette.success, fontWeight: 600 }}>Goal hit. Keep going. ✓</span>
              : <>Make your first call to start the day.</>}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
        <div style={{
          display: "flex", flexDirection: "column", gap: "2px",
          fontSize: "11px", color: palette.textTertiary, lineHeight: 1.45,
          fontVariantNumeric: "tabular-nums",
        }}>
          <span>Calls made: <span style={{ color: palette.textSecondary, fontWeight: 600 }}>{callsMadeToday}</span></span>
          <span>Reached: <span style={{ color: palette.textSecondary, fontWeight: 600 }}>{contactedCount}</span></span>
          <span>Booked: <span style={{ color: palette.textSecondary, fontWeight: 600 }}>{closedCount}</span></span>
        </div>
        <button
          type="button"
          onClick={() => onToggleQuickMode?.(!quickMode)}
          aria-pressed={quickMode}
          title="Hides everything except the call and the log."
          style={{
            fontSize: "12px",
            fontWeight: 700,
            color: quickMode ? "#fff" : palette.textPrimary,
            background: quickMode ? palette.blue : palette.surface,
            border: `1px solid ${quickMode ? palette.blue : palette.borderLight}`,
            borderRadius: "999px",
            padding: "8px 14px",
            cursor: "pointer",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            boxShadow: quickMode ? "0 1px 2px rgba(37,99,235,0.25), 0 6px 14px -6px rgba(37,99,235,0.45)" : "none",
            transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {quickMode ? "Just calling · ON" : "Just calling"}
        </button>
      </div>
    </div>
  );
}


// ── NextBestPlay ──────────────────────────────────────────────────────
// Tier 2. Single decisive recommendation that replaces "pick a lane."
// Surfaces the angle name + revenue potential + ready company count +
// one-line why + a single primary CTA. Hidden in Quick Mode.
function NextBestPlay({ angle, leadsByAngle, isActive, onStartCalling }) {
  const leads = leadsByAngle?.[angle.bucketId] ?? [];
  const ready = angle.count > 0;
  const copy = angleCopy(angle);
  // Sum probability-adjusted opportunity for this angle's ready leads.
  const angleValue = useMemo(() => {
    let s = 0;
    for (const l of leads) {
      const v = leadOpportunityValue(l);
      if (v) s += v;
    }
    return s;
  }, [leads]);
  const valueLabel = formatMoney(angleValue);

  return (
    <div style={{
      padding: "18px 22px",
      borderRadius: "16px",
      background: palette.surface,
      border: `1px solid ${palette.borderLight}`,
      borderLeft: `4px solid ${palette.blue}`,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 22px -8px rgba(15,23,42,0.10)",
      display: "flex",
      alignItems: "center",
      gap: "20px",
      flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 360px", minWidth: 0 }}>
        <div style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em",
          color: palette.textTertiary, textTransform: "uppercase",
        }}>
          Where to start
        </div>
        <div style={{
          fontSize: "20px", fontWeight: 700, color: palette.textPrimary,
          marginTop: "4px", lineHeight: 1.2,
        }}>
          {angle.bucketLabel}
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: "10px", marginTop: "6px", flexWrap: "wrap",
          fontSize: "12px", color: palette.textSecondary, fontWeight: 500,
        }}>
          {valueLabel && (
            <span style={{ color: palette.success, fontWeight: 700 }}>
              ~{valueLabel} up for grabs
            </span>
          )}
          <span>· {angle.count} compan{angle.count === 1 ? "y" : "ies"} waiting for a call</span>
          {isActive && <span style={{ color: palette.blue, fontWeight: 600 }}>· You&apos;re working on this</span>}
        </div>
        <div style={{
          fontSize: "13px", color: palette.textSecondary, marginTop: "8px",
          lineHeight: 1.5,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {copy.why}
        </div>
      </div>

      <button
        type="button"
        onClick={onStartCalling}
        disabled={!ready}
        style={{
          fontSize: "14px",
          fontWeight: 700,
          color: "#fff",
          background: ready ? palette.blue : "rgba(37,99,235,0.45)",
          border: "none",
          borderRadius: "12px",
          padding: "13px 22px",
          cursor: ready ? "pointer" : "not-allowed",
          boxShadow: ready ? "0 1px 2px rgba(37,99,235,0.25), 0 8px 22px -6px rgba(37,99,235,0.55)" : "none",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        Start with these calls →
      </button>
    </div>
  );
}

function PriorityTierCard({ label, tone, stats, meaning }) {
  const toneColor =
    tone === "focus" ? palette.blue
    : tone === "build" ? "#6D28D9"
    : palette.textTertiary;
  return (
    <div style={{
      padding: "16px 18px",
      borderRadius: "14px",
      background: palette.surface,
      border: `1px solid ${palette.borderLight}`,
      borderLeft: `3px solid ${toneColor}`,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
    }}>
      <div style={{
        fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
        color: toneColor, textTransform: "uppercase",
      }}>
        {label}
      </div>
      <div style={{ fontSize: "22px", fontWeight: 700, color: palette.textPrimary }}>
        {stats.angles} play{stats.angles === 1 ? "" : "s"}
      </div>
      <div style={{ fontSize: "12px", color: palette.textSecondary }}>
        {stats.leads} lead{stats.leads === 1 ? "" : "s"} ready to call
      </div>
      <div style={{ fontSize: "11px", color: palette.textTertiary, fontStyle: "italic", marginTop: "2px" }}>
        {meaning}
      </div>
    </div>
  );
}

// ── AskAIPanel ──────────────────────────────────────────────────────
// Right-side slide-over. Pulls a deal coach response from /api/ai/deal-coach
// (server-side, ANTHROPIC_API_KEY-gated). Renders three sections:
// improved pitch, objection handling, angle expansion. Additive only —
// never displaces the existing FeaturedAngleWorkspace UI.

// Compact secondary button used for pitch interactions (Copy, Shorten,
// More aggressive). Stays consistent with the panel's quiet UI ladder.
function pitchActionButtonStyle({ active = false, busy = false } = {}) {
  return {
    fontSize: "11px",
    fontWeight: 600,
    color: active ? palette.success : busy ? palette.textTertiary : palette.blue,
    background: active ? palette.successBg : palette.bluePale,
    border: `1px solid ${active ? "#BBF7D0" : palette.blueBorder}`,
    borderRadius: "8px",
    padding: "6px 10px",
    cursor: busy ? "default" : "pointer",
    whiteSpace: "nowrap",
    transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
    opacity: busy ? 0.7 : 1,
  };
}

function AskAIPanel({ open, onClose, topOpportunity, angle, tradeId }) {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [pitchActionBusy, setPitchActionBusy] = useState(null); // "shorten" | "aggressive" | null
  const [pitchCopyState, setPitchCopyState] = useState(null);   // "copied" | null
  const scrollRef = useRef(null);

  // Reset on close so reopening triggers a fresh load against the
  // current (possibly newly selected) lead.
  useEffect(() => {
    if (!open) {
      setState({ loading: false, error: null, data: null });
      setMessages([]);
      setChatInput("");
      setChatLoading(false);
      setChatError(null);
      setPitchActionBusy(null);
      setPitchCopyState(null);
    }
  }, [open]);

  // Whenever the structured pitch arrives, seed the chat thread with
  // a synthesized "system" turn so the operator sees the brief and the
  // model gets the prior context on every follow-up.
  useEffect(() => {
    if (!state.data) return;
    const summary = [
      state.data.summary ? `Best move: ${state.data.summary}` : null,
      state.data.pitch.length ? `Pitch:\n${state.data.pitch.join("\n")}` : null,
      state.data.objections.length
        ? `Objection handling:\n${state.data.objections.map((o) => `- “${o.objection}” → ${o.response}`).join("\n")}`
        : null,
      state.data.angles.length
        ? `Alternative angles:\n${state.data.angles.map((a) => `- ${a}`).join("\n")}`
        : null,
    ].filter(Boolean).join("\n\n");
    setMessages(summary ? [{ role: "system", content: summary }] : []);
  }, [state.data]);

  // Auto-scroll the chat container to the bottom on every new turn /
  // loading state so the operator always sees the latest message.
  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
  }, [open, messages, chatLoading, state.data]);

  // Esc to close.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
    return undefined;
  }, [open, onClose]);

  // Fire the request when the panel opens with a real top opportunity.
  useEffect(() => {
    if (!open || !topOpportunity || !tradeId) return;
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    (async () => {
      try {
        const res = await fetch("/api/ai/deal-coach", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead: topOpportunity.lead,
            bucketId: topOpportunity.bucketId,
            bucketLabel: angle?.bucketLabel,
            reasons: topOpportunity.lead?.classifierReasons ?? [],
            script: topOpportunity.script,
            tradeId,
            tradeLabel: TRADE_MODULES[tradeId]?.label ?? tradeId,
            johnServiceAngle: angle?.johnServiceAngle,
            why: topOpportunity.why,
            value: topOpportunity.value,
            actionLabel: topOpportunity.actionLabel,
          }),
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          const error = json?.error || `Request failed (${res.status})`;
          const friendly = typeof error === "string" && error.toLowerCase().includes("anthropic_api_key")
            ? "ANTHROPIC_API_KEY is missing. Add it to .env.local and restart the dev server."
            : error;
          setState({ loading: false, error: friendly, data: null });
          return;
        }
        setState({
          loading: false,
          error: null,
          data: {
            summary: typeof json.summary === "string" ? json.summary : "",
            pitch: Array.isArray(json.pitch) ? json.pitch : [],
            objections: Array.isArray(json.objections) ? json.objections : [],
            angles: Array.isArray(json.angles) ? json.angles : [],
          },
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          error: `Request failed: ${err instanceof Error ? err.message : "unknown error"}`,
          data: null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [open, topOpportunity, angle, tradeId]);

  const handleChatSubmit = async (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading || !topOpportunity || !tradeId) return;
    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);
    try {
      const res = await fetch("/api/ai/deal-coach", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: topOpportunity.lead,
          bucketId: topOpportunity.bucketId,
          bucketLabel: angle?.bucketLabel,
          reasons: topOpportunity.lead?.classifierReasons ?? [],
          script: topOpportunity.script,
          tradeId,
          tradeLabel: TRADE_MODULES[tradeId]?.label ?? tradeId,
          johnServiceAngle: angle?.johnServiceAngle,
          why: topOpportunity.why,
          value: topOpportunity.value,
          actionLabel: topOpportunity.actionLabel,
          messages: nextMessages,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const error = json?.error || `Request failed (${res.status})`;
        const friendly = typeof error === "string" && error.toLowerCase().includes("anthropic_api_key")
          ? "ANTHROPIC_API_KEY is missing. Add it to .env.local and restart the dev server."
          : error;
        setChatError(friendly);
        return;
      }
      const reply = typeof json.reply === "string" && json.reply.trim().length > 0
        ? json.reply.trim()
        : "(no reply)";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setChatLoading(false);
    }
  };

  // Copy the current pitch to the clipboard. No fabrication — just the
  // lines already shown in the panel. Shows transient "Copied" feedback.
  const handleCopyPitch = async () => {
    if (!state.data?.pitch?.length) return;
    const text = state.data.pitch.join("\n");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setPitchCopyState("copied");
      setTimeout(() => setPitchCopyState(null), 1400);
    } catch {
      setPitchCopyState(null);
    }
  };

  // Re-call the chat branch with a tight instruction to rewrite the
  // current pitch. We surface the result as a chat assistant turn so
  // the original brief stays intact and the operator can compare.
  const handlePitchAction = async (action) => {
    if (!topOpportunity || !tradeId) return;
    if (pitchActionBusy || chatLoading) return;
    if (!state.data?.pitch?.length) return;
    const instruction = action === "shorten"
      ? "Rewrite the pitch as ONE sentence. Plain operator voice. No filler. Return just the sentence."
      : "Rewrite the pitch to be more direct and urgent. 2 short lines max. End on a question. Return just the rewritten pitch.";
    const userTurn = action === "shorten" ? "Shorten the pitch to one sentence." : "Make the pitch more direct and urgent.";
    const nextMessages = [...messages, { role: "user", content: userTurn }];
    setMessages(nextMessages);
    setPitchActionBusy(action);
    setChatError(null);
    try {
      const res = await fetch("/api/ai/deal-coach", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: topOpportunity.lead,
          bucketId: topOpportunity.bucketId,
          bucketLabel: angle?.bucketLabel,
          reasons: topOpportunity.lead?.classifierReasons ?? [],
          script: topOpportunity.script,
          tradeId,
          tradeLabel: TRADE_MODULES[tradeId]?.label ?? tradeId,
          johnServiceAngle: angle?.johnServiceAngle,
          why: topOpportunity.why,
          value: topOpportunity.value,
          actionLabel: topOpportunity.actionLabel,
          messages: [...nextMessages, { role: "user", content: instruction }],
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const error = json?.error || `Request failed (${res.status})`;
        setChatError(error);
        return;
      }
      const reply = typeof json.reply === "string" && json.reply.trim().length > 0
        ? json.reply.trim()
        : "(no reply)";
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setPitchActionBusy(null);
    }
  };

  if (!open) return null;
  const lead = topOpportunity?.lead ?? null;
  const company = lead?.name ?? lead?.companyName ?? "this deal";

  return (
    <div
      onClick={onClose}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.32)",
        zIndex: 1100,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="AI deal coach"
        style={{
          width: "min(440px, 100%)",
          height: "100%",
          background: palette.surface,
          boxShadow: "-12px 0 30px rgba(15,23,42,0.10)",
          borderLeft: `1px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <header style={{
          padding: "18px 22px",
          borderBottom: `1px solid ${palette.borderLight}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
        }}>
          <div>
            <div style={{
              fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
              color: palette.blue, textTransform: "uppercase",
            }}>
              AI Deal Coach
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: palette.textPrimary, marginTop: "2px", lineHeight: 1.25 }}>
              {company}
            </div>
            {angle?.bucketLabel && (
              <div style={{ fontSize: "11px", color: palette.textTertiary, marginTop: "2px" }}>
                Angle: {angle.bucketLabel}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI panel"
            style={{
              fontSize: "18px",
              fontWeight: 600,
              color: palette.textTertiary,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <div
          ref={scrollRef}
          style={{
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
          }}
        >
          {state.loading && (
            <div style={{ fontSize: "13px", color: palette.textSecondary }}>
              Thinking through this deal…
            </div>
          )}
          {state.error && (
            <div style={{
              padding: "10px 12px",
              borderRadius: "10px",
              background: palette.dangerBg,
              border: "1px solid #FECACA",
              color: palette.danger,
              fontSize: "12px",
            }}>
              {state.error}
            </div>
          )}

          {state.data && (
            <>
              {state.data.summary && (
                <section>
                  <div style={{
                    padding: "12px 14px",
                    borderRadius: "10px",
                    background: "linear-gradient(180deg, rgba(37,99,235,0.10), rgba(37,99,235,0.02))",
                    border: `1px solid ${palette.blueBorder}`,
                    fontSize: "14px",
                    fontWeight: 600,
                    color: palette.textPrimary,
                    lineHeight: 1.5,
                  }}>
                    {state.data.summary}
                  </div>
                </section>
              )}
              {state.data.pitch.length > 0 && (
                <section>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "8px" }}>
                    Improved pitch
                  </div>
                  <ul style={{
                    margin: 0,
                    paddingLeft: "18px",
                    fontSize: "13px",
                    color: palette.textPrimary,
                    lineHeight: 1.55,
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}>
                    {state.data.pitch.map((line, i) => (
                      <li key={`pitch-${i}`}>{line}</li>
                    ))}
                  </ul>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }}>
                    <button
                      type="button"
                      onClick={handleCopyPitch}
                      disabled={!state.data.pitch.length}
                      style={pitchActionButtonStyle({ active: pitchCopyState === "copied" })}
                    >
                      {pitchCopyState === "copied" ? "Copied ✓" : "Copy pitch"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePitchAction("shorten")}
                      disabled={!!pitchActionBusy || chatLoading}
                      style={pitchActionButtonStyle({ busy: pitchActionBusy === "shorten" })}
                    >
                      {pitchActionBusy === "shorten" ? "Shortening…" : "Shorten"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePitchAction("aggressive")}
                      disabled={!!pitchActionBusy || chatLoading}
                      style={pitchActionButtonStyle({ busy: pitchActionBusy === "aggressive" })}
                    >
                      {pitchActionBusy === "aggressive" ? "Sharpening…" : "More aggressive"}
                    </button>
                  </div>
                </section>
              )}

              {state.data.objections.length > 0 && (
                <section>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "8px" }}>
                    Objection handling
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {state.data.objections.map((o, i) => (
                      <div key={`obj-${i}`} style={{
                        padding: "10px 12px",
                        borderRadius: "10px",
                        background: palette.surface,
                        border: `1px solid ${palette.borderLight}`,
                      }}>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: palette.textPrimary, marginBottom: "4px" }}>
                          “{o.objection}”
                        </div>
                        <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5 }}>
                          {o.response}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {state.data.angles.length > 0 && (
                <section>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "8px" }}>
                    Angle expansion
                  </div>
                  <ul style={{
                    margin: 0,
                    paddingLeft: "18px",
                    fontSize: "13px",
                    color: palette.textPrimary,
                    lineHeight: 1.55,
                  }}>
                    {state.data.angles.map((a, i) => (
                      <li key={`angle-${i}`} style={{ marginBottom: "6px" }}>{a}</li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* Chat thread — appears below the static brief once it loads. */}
          {state.data && (
            <section>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "8px" }}>
                Ask follow-up
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {messages
                  .filter((m) => m.role !== "system")
                  .map((m, i) => (
                    <div
                      key={`chat-${i}`}
                      style={{
                        alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "92%",
                        padding: "9px 12px",
                        borderRadius: "10px",
                        fontSize: "13px",
                        lineHeight: 1.5,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        background: m.role === "user" ? palette.bluePale : palette.surfaceHover,
                        border: `1px solid ${m.role === "user" ? palette.blueBorder : palette.borderLight}`,
                        color: palette.textPrimary,
                      }}
                    >
                      {m.content}
                    </div>
                  ))}
                {chatLoading && (
                  <div style={{
                    alignSelf: "flex-start",
                    maxWidth: "92%",
                    padding: "9px 12px",
                    borderRadius: "10px",
                    fontSize: "13px",
                    color: palette.textSecondary,
                    background: palette.surfaceHover,
                    border: `1px solid ${palette.borderLight}`,
                    fontStyle: "italic",
                  }}>
                    Thinking…
                  </div>
                )}
                {chatError && (
                  <div style={{
                    padding: "9px 12px",
                    borderRadius: "10px",
                    background: palette.dangerBg,
                    border: "1px solid #FECACA",
                    color: palette.danger,
                    fontSize: "12px",
                  }}>
                    {chatError}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Chat input — sits between content and footer, never covers it. */}
        {state.data && (
          <form
            onSubmit={handleChatSubmit}
            style={{
              padding: "10px 14px",
              borderTop: `1px solid ${palette.borderLight}`,
              display: "flex",
              gap: "8px",
              alignItems: "flex-end",
              background: palette.surface,
            }}
          >
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSubmit();
                }
              }}
              placeholder="Ask a follow-up about this deal…"
              rows={1}
              style={{
                flex: 1,
                resize: "none",
                fontSize: "13px",
                fontFamily: "inherit",
                color: palette.textPrimary,
                background: palette.surfaceHover,
                border: `1px solid ${palette.borderLight}`,
                borderRadius: "10px",
                padding: "10px 12px",
                outline: "none",
                lineHeight: 1.4,
                maxHeight: "120px",
                minHeight: "38px",
              }}
            />
            <button
              type="submit"
              disabled={chatLoading || chatInput.trim().length === 0}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "#fff",
                background: chatLoading || chatInput.trim().length === 0 ? "rgba(37,99,235,0.45)" : palette.blue,
                border: "none",
                borderRadius: "10px",
                padding: "10px 16px",
                cursor: chatLoading || chatInput.trim().length === 0 ? "default" : "pointer",
                whiteSpace: "nowrap",
                transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              Send
            </button>
          </form>
        )}

        <footer style={{
          padding: "12px 22px",
          borderTop: `1px solid ${palette.borderLight}`,
          fontSize: "11px",
          color: palette.textTertiary,
          fontStyle: "italic",
        }}>
          Generated by the AI deal coach using only the lead signals already on file.
        </footer>
      </aside>
    </div>
  );
}

function FeaturedAngleWorkspace({ angle, isActive, leads, onSelect, onOpenOperator, selectedTradeId, selectedLeadKey, onSelectLead }) {
  const ready = angle.count > 0;
  const topOpportunity = useMemo(
    () => (ready && selectedTradeId ? buildTopOpportunity(angle.bucketId, leads, selectedTradeId) : null),
    [ready, angle.bucketId, leads, selectedTradeId],
  );
  const [aiOpen, setAiOpen] = useState(false);
  const copy = angleCopy(angle);
  const toneColor =
    angle.priorityLabel === "Focus Now" ? palette.blue
    : angle.priorityLabel === "Build Next" ? "#6D28D9"
    : palette.textTertiary;

  // Search + filter state (component-local).
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [visibleCount, setVisibleCount] = useState(10);

  // Reset when the featured angle id changes.
  useEffect(() => {
    setQuery("");
    setFilter("all");
    setVisibleCount(10);
  }, [angle?.bucketId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((lead) => {
      if (q.length > 0) {
        const haystack = `${lead.name ?? ""} ${lead.location ?? ""} ${lead.address ?? ""} ${lead.website ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      const hasWebsite = !!(lead.website || lead.websiteUrl || lead.domain);
      const hasPhone = !!(lead.phone || lead.contacts?.primaryPhone);
      if (filter === "website") return hasWebsite;
      if (filter === "phone") return hasPhone;
      if (filter === "needs_contact") return !hasWebsite && !hasPhone;
      return true;
    });
  }, [leads, query, filter]);

  const visible = filtered.slice(0, visibleCount);
  const more = Math.max(0, filtered.length - visible.length);

  const filterTabs = [
    { id: "all", label: "All" },
    { id: "website", label: "Website found" },
    { id: "phone", label: "Phone found" },
    { id: "needs_contact", label: "Needs contact" },
  ];

  return (
    <div style={{
      padding: "24px 28px",
      borderRadius: "16px",
      background: isActive
        ? "linear-gradient(180deg, rgba(37,99,235,0.04), #FFFFFF)"
        : palette.surface,
      border: `1px solid ${isActive ? palette.blueBorder : palette.borderLight}`,
      borderLeft: `4px solid ${toneColor}`,
      boxShadow: isActive
        ? "0 1px 2px rgba(15,23,42,0.04), 0 14px 40px -10px rgba(37,99,235,0.18)"
        : "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.06)",
      display: "flex",
      flexDirection: "column",
      gap: "16px",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
        alignItems: "flex-start",
      }}>
        <div style={{ flex: "1 1 380px", minWidth: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: "8px",
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
            color: toneColor, textTransform: "uppercase",
          }}>
            {priorityLabelText(angle.priorityLabel)}
            {isActive && <span style={{ color: palette.blue }}>· You&apos;re working this</span>}
          </div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: palette.textPrimary, marginTop: "4px", lineHeight: 1.2 }}>
            {angle.bucketLabel}
          </div>
          <div style={{ fontSize: "13px", color: palette.textSecondary, marginTop: "4px" }}>
            {ready ? `${angle.count} lead${angle.count === 1 ? "" : "s"} ready to call` : "No leads yet"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <button
            type="button"
            onClick={onSelect}
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: isActive ? palette.blue : "#fff",
              background: isActive ? palette.bluePale : palette.blue,
              border: `1px solid ${isActive ? palette.blueBorder : palette.blue}`,
              borderRadius: "10px",
              padding: "10px 18px",
              cursor: "pointer",
              boxShadow: isActive ? "none" : "0 1px 2px rgba(37,99,235,0.25), 0 6px 18px -6px rgba(37,99,235,0.4)",
              transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              whiteSpace: "nowrap",
            }}
          >
            {isActive ? "You're working these ✓" : "Start with these leads →"}
          </button>
          {isActive && (
            <button
              type="button"
              onClick={onOpenOperator}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: palette.blue,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "2px 0",
              }}
            >
              Start calling →
            </button>
          )}
        </div>
      </div>

      {/* Next Deal — decisive execution block. Order: company →
          why this works → expected outcome → say this → action. */}
      {topOpportunity && (
        <div style={{
          padding: "20px 22px",
          borderRadius: "14px",
          background: "linear-gradient(180deg, rgba(37,99,235,0.08), rgba(37,99,235,0.02))",
          border: `1px solid ${palette.blueBorder}`,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 14px 40px -10px rgba(37,99,235,0.22)",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}>
          {/* 1. Eyebrow + Company */}
          <div>
            <div style={{
              fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
              color: palette.blue, textTransform: "uppercase",
            }}>
              Best call right now
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: palette.textPrimary, marginTop: "4px", lineHeight: 1.15 }}>
              {topOpportunity.lead.name ?? topOpportunity.lead.companyName ?? "Unnamed"}
            </div>
            {(topOpportunity.lead.address || topOpportunity.lead.location) && (
              <div style={{ fontSize: "12px", color: palette.textTertiary, marginTop: "2px" }}>
                {topOpportunity.lead.address ?? topOpportunity.lead.location}
              </div>
            )}
          </div>

          {/* 2. Why call them */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "4px" }}>
              Why call them
            </div>
            <div style={{ fontSize: "14px", color: palette.textPrimary, lineHeight: 1.5 }}>
              {topOpportunity.why}
            </div>
          </div>

          {/* 3. What it's worth */}
          <div>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "4px" }}>
              What it&apos;s worth
            </div>
            <div style={{ fontSize: "14px", color: palette.textPrimary, fontWeight: 600, lineHeight: 1.5 }}>
              {topOpportunity.value}
            </div>
          </div>

          {/* 4. Say this */}
          <div style={{
            padding: "12px 14px",
            borderRadius: "10px",
            background: palette.surface,
            border: `1px solid ${palette.borderLight}`,
            fontSize: "13px",
            color: palette.textPrimary,
            lineHeight: 1.55,
          }}>
            <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "4px" }}>
              Say this
            </div>
            “{topOpportunity.script}.”
          </div>

          {/* 5. Primary action + AI assist */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="button"
              onClick={onSelect}
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "#fff",
                background: palette.blue,
                border: "none",
                borderRadius: "10px",
                padding: "12px 22px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 2px rgba(37,99,235,0.25), 0 8px 22px -6px rgba(37,99,235,0.55)",
                transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
                letterSpacing: "0.02em",
              }}
            >
              {topOpportunity.actionLabel} →
            </button>
            <button
              type="button"
              onClick={() => setAiOpen(true)}
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: palette.blue,
                background: palette.bluePale,
                border: `1px solid ${palette.blueBorder}`,
                borderRadius: "10px",
                padding: "11px 18px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              Get help with this call
            </button>
          </div>
        </div>
      )}

      {/* AI Deal Coach slide-over — additive layer, never replaces UI. */}
      <AskAIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        topOpportunity={topOpportunity}
        angle={angle}
        tradeId={selectedTradeId}
      />

      {/* Why + Sell */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "12px",
      }}>
        <div style={{
          padding: "12px 14px",
          borderRadius: "10px",
          background: palette.surfaceHover,
          border: `1px solid ${palette.borderLight}`,
        }}>
          <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "4px" }}>
            Why this matters
          </div>
          <div style={{ fontSize: "13px", color: palette.textPrimary, lineHeight: 1.5 }}>
            {copy.why}
          </div>
        </div>
        <div style={{
          padding: "12px 14px",
          borderRadius: "10px",
          background: palette.surfaceHover,
          border: `1px solid ${palette.borderLight}`,
        }}>
          <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: palette.textTertiary, textTransform: "uppercase", marginBottom: "4px" }}>
            What LaborTech sells
          </div>
          <div style={{ fontSize: "13px", color: palette.textPrimary, lineHeight: 1.5 }}>
            {copy.sell}
          </div>
        </div>
      </div>

      {/* Lead browser */}
      {ready ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}>
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setVisibleCount(10); }}
              placeholder={`Search ${angle.bucketLabel.toLowerCase()} leads`}
              style={{
                flex: "1 1 240px",
                fontSize: "13px",
                padding: "8px 12px",
                borderRadius: "8px",
                border: `1px solid ${palette.borderLight}`,
                background: palette.surface,
                color: palette.textPrimary,
                outline: "none",
                minWidth: 0,
              }}
            />
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {filterTabs.map((tab) => {
                const active = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => { setFilter(tab.id); setVisibleCount(10); }}
                    aria-pressed={active}
                    style={{
                      fontSize: "11px",
                      fontWeight: active ? 600 : 500,
                      padding: "6px 10px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      color: active ? palette.blue : palette.textSecondary,
                      background: active ? palette.bluePale : "transparent",
                      border: `1px solid ${active ? palette.blueBorder : palette.borderLight}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{
            border: `1px solid ${palette.borderLight}`,
            borderRadius: "12px",
            overflow: "hidden",
            background: palette.surface,
          }}>
            {visible.length === 0 ? (
              <div style={{ padding: "20px", fontSize: "13px", color: palette.textSecondary, textAlign: "center" }}>
                No leads match this filter.
              </div>
            ) : (
              visible.map((lead, i) => {
                const meta = [];
                if (typeof lead.rating === "number" && lead.rating > 0) meta.push(`${lead.rating.toFixed(1)} ★`);
                const reviews = typeof lead.reviewCount === "number" ? lead.reviewCount : (typeof lead.reviews === "number" ? lead.reviews : null);
                if (typeof reviews === "number" && reviews >= 0) meta.push(`${reviews} review${reviews === 1 ? "" : "s"}`);
                if (lead.website || lead.websiteUrl || lead.domain) meta.push("website");
                if (lead.phone || lead.contacts?.primaryPhone) meta.push("phone");
                if (lead.source === "google_places") meta.push("Google Places");
                const rowKey = lead.key ?? lead.id ?? lead.name ?? i;
                const isSelected = selectedLeadKey != null && lead.key === selectedLeadKey;
                const clickable = typeof onSelectLead === "function" && !!lead.key;
                return (
                  <div
                    key={rowKey}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onSelectLead(lead.key) : undefined}
                    onKeyDown={clickable ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectLead(lead.key);
                      }
                    } : undefined}
                    onMouseEnter={(e) => {
                      if (isSelected) return;
                      e.currentTarget.style.background = "rgba(37,99,235,0.04)";
                    }}
                    onMouseLeave={(e) => {
                      if (isSelected) return;
                      e.currentTarget.style.background = "transparent";
                    }}
                    style={{
                      // Premium row spacing — single source of rhythm.
                      // Active row gets the same blue rail the workflow
                      // panels use, plus a soft glow so the eye lands
                      // on it mid-scroll.
                      padding: "14px 18px",
                      borderTop: i === 0 ? "none" : `1px solid ${palette.borderLight}`,
                      borderLeft: isSelected ? `2px solid #2563EB` : "2px solid transparent",
                      background: isSelected ? "rgba(37,99,235,0.06)" : "transparent",
                      boxShadow: isSelected
                        ? "inset 0 0 0 1px rgba(37,99,235,0.15)"
                        : "none",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "14px",
                      alignItems: "baseline",
                      cursor: clickable ? "pointer" : "default",
                      transition: "background 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: "13px",
                        fontWeight: isSelected ? 700 : 600,
                        color: palette.textPrimary,
                        letterSpacing: "-0.005em",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {lead.name ?? lead.companyName ?? "Unnamed"}
                        {isSelected ? (
                          <span style={{
                            marginLeft: "10px",
                            fontSize: "9px",
                            fontWeight: 800,
                            letterSpacing: "0.12em",
                            color: palette.blue,
                            textTransform: "uppercase",
                            verticalAlign: "1px",
                          }}>
                            Active
                          </span>
                        ) : null}
                      </div>
                      {(lead.address || lead.location) && (
                        <div style={{ fontSize: "11px", color: palette.textTertiary, marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {lead.address ?? lead.location}
                        </div>
                      )}
                    </div>
                    {meta.length > 0 && (
                      <div style={{
                        fontSize: "11px",
                        color: palette.textTertiary,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}>
                        {meta.join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {(more > 0 || visibleCount > 10) && (
            <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
              {more > 0 && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((v) => v + 20)}
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: palette.blue,
                    background: "transparent",
                    border: `1px solid ${palette.blueBorder}`,
                    borderRadius: "8px",
                    padding: "8px 16px",
                    cursor: "pointer",
                  }}
                >
                  Show 20 more ({more} remaining)
                </button>
              )}
              {visibleCount > 10 && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(10)}
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: palette.textSecondary,
                    background: "transparent",
                    border: `1px solid ${palette.borderLight}`,
                    borderRadius: "8px",
                    padding: "8px 16px",
                    cursor: "pointer",
                  }}
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: "12px", color: palette.textTertiary, fontStyle: "italic" }}>
          {angle.reason}
        </div>
      )}
    </div>
  );
}

// Translate the internal priority label into operator-facing copy.
// Internal: "Focus Now" / "Build Next" / "Monitor".
// User-facing: "Call first" / "Set up next" / "Wait".
function priorityLabelText(priorityLabel) {
  if (priorityLabel === "Focus Now") return "Call first";
  if (priorityLabel === "Build Next") return "Set up next";
  if (priorityLabel === "Monitor") return "Wait";
  return priorityLabel ?? "";
}

// ── OpportunitySystem ─────────────────────────────────────────────────
// Config-driven, tiered bucket layout. Renders three sections (Call
// First / Set Up Next / Wait), each with action-named bucket cards.
// All grouping + sorting is pre-computed by buildOpportunitySystem;
// this component is purely presentational.
function OpportunitySystem({ system, selectedServiceAngleId, onCallBucket, bucketPerformance }) {
  if (!system || !Array.isArray(system.tiers) || system.tiers.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {system.tiers.map((tier) => (
        <OpportunityTierSection
          key={tier.id}
          tier={tier}
          isTopTier={tier.id === "call_first"}
          topBucketId={system.topBucketId}
          selectedServiceAngleId={selectedServiceAngleId}
          onCallBucket={onCallBucket}
          bucketPerformance={bucketPerformance}
        />
      ))}
    </div>
  );
}

function OpportunityTierSection({ tier, isTopTier, topBucketId, selectedServiceAngleId, onCallBucket, bucketPerformance }) {
  if (!tier || !Array.isArray(tier.buckets) || tier.buckets.length === 0) return null;
  const toneColor = tier.id === "call_first"
    ? palette.blue
    : tier.id === "set_up_next"
      ? "#6D28D9"
      : palette.textTertiary;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <div>
          <div style={{
            fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
            color: toneColor, textTransform: "uppercase",
          }}>
            {tier.title}
          </div>
          <div style={{ fontSize: "12px", color: palette.textSecondary, marginTop: "2px" }}>
            {tier.subtitle}
          </div>
        </div>
        {tier.totalLeads > 0 && (
          <div style={{
            fontSize: "11px", color: palette.textTertiary, fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}>
            {tier.totalLeads} lead{tier.totalLeads === 1 ? "" : "s"}
            {tier.totalRevenue > 0 ? ` · ${formatMoney(tier.totalRevenue) ?? ""} potential` : ""}
          </div>
        )}
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: "12px",
        alignItems: "stretch",
      }}>
        {tier.buckets.map((b) => (
          <OpportunityBucketCard
            key={b.bucketId}
            bucket={b}
            isTop={isTopTier && b.bucketId === topBucketId}
            isActive={selectedServiceAngleId === b.bucketId}
            toneColor={toneColor}
            performance={bucketPerformance?.get(b.bucketId)}
            onSelect={() => { if (b.ready) onCallBucket?.(b.bucketId); }}
          />
        ))}
      </div>
    </div>
  );
}

function OpportunityBucketCard({ bucket, isTop, isActive, toneColor, onSelect, performance }) {
  const ready = !!bucket.ready;
  const moneyLabel = bucket.revenuePotential > 0 ? formatMoney(bucket.revenuePotential) : null;
  const cta = !ready
    ? "No leads yet — add leads to unlock this"
    : isActive
      ? "You're working this ✓"
      : "Start with these leads →";
  const ctaColor = !ready
    ? palette.textTertiary
    : palette.blue;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={() => { if (ready) onSelect?.(); }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && ready) {
          e.preventDefault();
          onSelect?.();
        }
      }}
      onMouseEnter={(e) => {
        if (isActive || !ready) return;
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.10)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        if (isActive) return;
        e.currentTarget.style.boxShadow = isTop
          ? "0 1px 2px rgba(37,99,235,0.18), 0 10px 26px -8px rgba(37,99,235,0.40)"
          : "0 1px 2px rgba(15,23,42,0.03)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
      style={{
        padding: "14px 16px",
        borderRadius: "12px",
        background: isActive ? palette.bluePale : palette.surface,
        border: `1px solid ${isActive ? palette.blueBorder : isTop ? palette.blueBorder : palette.borderLight}`,
        borderLeft: `3px solid ${isTop ? palette.blue : toneColor}`,
        boxShadow: isActive
          ? "0 1px 2px rgba(15,23,42,0.04), 0 14px 40px -10px rgba(15,23,42,0.10)"
          : isTop
            ? "0 1px 2px rgba(37,99,235,0.18), 0 10px 26px -8px rgba(37,99,235,0.40)"
            : "0 1px 2px rgba(15,23,42,0.03)",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        cursor: ready ? "pointer" : "default",
        transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
        outline: "none",
        opacity: ready ? 1 : 0.78,
        minHeight: "172px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
        {isTop && (
          <span style={{
            fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em",
            color: "#fff", textTransform: "uppercase",
            background: palette.blue,
            padding: "2px 8px",
            borderRadius: "999px",
          }}>
            Best play
          </span>
        )}
        <span style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em",
          color: ready ? palette.success : palette.textTertiary,
          whiteSpace: "nowrap",
          padding: "2px 8px",
          borderRadius: "999px",
          background: ready ? palette.successBg : palette.surfaceHover,
          border: `1px solid ${ready ? "#BBF7D0" : palette.borderLight}`,
          marginLeft: "auto",
          fontVariantNumeric: "tabular-nums",
        }}>
          {ready ? `${bucket.count} ready` : "No leads yet"}
        </span>
      </div>

      <div style={{
        fontSize: "16px", fontWeight: 700, color: palette.textPrimary,
        lineHeight: 1.2,
      }}>
        {bucket.actionLabel}
      </div>

      <div style={{
        fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5,
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {bucket.description}
      </div>

      {moneyLabel && (
        <div style={{
          fontSize: "12px", fontWeight: 700, color: palette.success,
          fontVariantNumeric: "tabular-nums",
        }}>
          ~{moneyLabel} up for grabs
        </div>
      )}

      {performance && (performance.attemptsAllTime > 0 || performance.closedAllTime > 0) && (
        <div style={{
          fontSize: "11px", color: palette.textTertiary, fontWeight: 500,
          fontVariantNumeric: "tabular-nums",
        }}>
          {performance.closedToday > 0
            ? `${formatMoney(performance.closedToday) ?? "$0"} booked today`
            : performance.closedAllTime > 0
              ? `${formatMoney(performance.closedAllTime) ?? "$0"} booked · ${performance.attemptsAllTime} call${performance.attemptsAllTime === 1 ? "" : "s"}`
              : `${performance.attemptsAllTime} call${performance.attemptsAllTime === 1 ? "" : "s"} made`}
          {performance.attemptsAllTime >= 5 && performance.conversionRate > 0
            ? ` · ${Math.round(performance.conversionRate * 100)}% close rate`
            : ""}
        </div>
      )}

      <div style={{
        fontSize: "11px", fontWeight: 600,
        color: ctaColor,
        marginTop: "auto",
        paddingTop: "6px",
      }}>
        {cta}
      </div>
    </div>
  );
}

function angleToneColor(priorityLabel) {
  if (priorityLabel === "Focus Now") return palette.blue;
  if (priorityLabel === "Build Next") return "#6D28D9";
  return palette.textTertiary;
}

function AngleAttackLanesGrid({ angles, leadsByAngle, selectedServiceAngleId, onSelectServiceAngle, featuredId }) {
  // prioritizedAngles is already sorted Focus Now → Build Next → Monitor.
  // Every card uses identical sizing — no card expands inline. The full
  // lead browser only renders inside the FeaturedAngleWorkspace above.
  const visible = angles.filter((a) => a.bucketId !== featuredId);
  if (visible.length === 0) return null;
  // Top-2 lead preview is enough for context. Anything more dominates
  // when one bucket has 68 leads and another has 2.
  const PREVIEW_LIMIT = 2;
  const CARD_MIN_HEIGHT = 280;
  const CARD_MAX_HEIGHT = 280;
  return (
    <div style={{
      display: "grid",
      // Equal columns regardless of trade or lead distribution.
      gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
      gridAutoRows: "1fr",
      gap: "12px",
      alignItems: "stretch",
    }}>
      {visible.map((a) => {
        const leads = leadsByAngle?.[a.bucketId] ?? [];
        const ready = a.count > 0;
        const isActive = selectedServiceAngleId === a.bucketId;
        const copy = angleCopy(a);
        const toneColor = angleToneColor(a.priorityLabel);
        const previewLeads = leads.slice(0, PREVIEW_LIMIT);
        const more = Math.max(0, leads.length - previewLeads.length);
        const handleClick = () => {
          if (typeof onSelectServiceAngle === "function") onSelectServiceAngle(a.bucketId);
        };
        return (
          <div
            key={a.bucketId}
            role="button"
            tabIndex={0}
            aria-pressed={isActive}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            }}
            onMouseEnter={(e) => {
              if (isActive) return;
              e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.08)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              if (isActive) return;
              e.currentTarget.style.boxShadow = "0 1px 2px rgba(15,23,42,0.03)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
            style={{
              padding: "14px 16px",
              borderRadius: "12px",
              background: isActive ? palette.bluePale : palette.surface,
              border: `1px solid ${isActive ? palette.blueBorder : palette.borderLight}`,
              borderLeft: `3px solid ${toneColor}`,
              boxShadow: isActive
                ? "0 1px 2px rgba(15,23,42,0.04), 0 14px 40px -10px rgba(15,23,42,0.10)"
                : "0 1px 2px rgba(15,23,42,0.03)",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              cursor: "pointer",
              transition: "all 180ms cubic-bezier(0.4, 0, 0.2, 1)",
              outline: "none",
              minHeight: `${CARD_MIN_HEIGHT}px`,
              maxHeight: `${CARD_MAX_HEIGHT}px`,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{
                fontSize: "9px", fontWeight: 700, letterSpacing: "0.10em",
                color: toneColor, textTransform: "uppercase",
                padding: "2px 7px",
                borderRadius: "999px",
                background: isActive ? "rgba(255,255,255,0.6)" : palette.surfaceHover,
                border: `1px solid ${palette.borderLight}`,
              }}>
                {priorityLabelText(a.priorityLabel)}
              </span>
              <span style={{
                fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em",
                color: ready ? palette.success : palette.textTertiary,
                whiteSpace: "nowrap",
                padding: "2px 8px",
                borderRadius: "999px",
                background: ready ? palette.successBg : palette.surfaceHover,
                border: `1px solid ${ready ? "#BBF7D0" : palette.borderLight}`,
                marginLeft: "auto",
              }}>
                {ready ? `${a.count} ready` : "No leads yet"}
              </span>
            </div>

            <div style={{
              fontSize: "15px", fontWeight: 700, color: palette.textPrimary, marginTop: "2px",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {a.bucketLabel}
            </div>

            <div style={{
              fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>
              <span style={{ fontWeight: 600, color: palette.textPrimary }}>Why call: </span>
              {copy.why}
            </div>
            <div style={{
              fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45,
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>
              <span style={{ fontWeight: 600, color: palette.textPrimary }}>Pitch: </span>
              {copy.sell}
            </div>

            {previewLeads.length > 0 ? (
              <div style={{
                display: "flex", flexDirection: "column", gap: "4px",
                marginTop: "4px", paddingTop: "8px",
                borderTop: `1px solid ${palette.borderLight}`,
                flex: 1, minHeight: 0, overflow: "hidden",
              }}>
                <div style={{
                  fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
                  color: palette.textTertiary, textTransform: "uppercase",
                }}>
                  Top lead
                </div>
                <div style={{
                  fontSize: "13px", fontWeight: 600, color: palette.textPrimary,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {previewLeads[0].name ?? previewLeads[0].companyName ?? "Unnamed"}
                </div>
                {previewLeads[1] && (
                  <div style={{
                    fontSize: "12px", color: palette.textSecondary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    Then call {previewLeads[1].name ?? previewLeads[1].companyName ?? "Unnamed"}
                  </div>
                )}
                {more > 0 && (
                  <div style={{ fontSize: "11px", color: palette.textTertiary }}>
                    +{more} more leads
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, minHeight: 0 }} />
            )}

            <div style={{
              fontSize: "11px", fontWeight: 600,
              color: isActive ? palette.blue : (ready ? palette.blue : palette.textTertiary),
              marginTop: "auto",
              paddingTop: "6px",
            }}>
              {isActive
                ? "You're working this ✓"
                : ready
                  ? "See these leads →"
                  : "Add leads to use this →"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────

export default function OperatorConsole({
  user, workspace, sourceReadiness = [], connectedEnvVars = [], hunterAvailable = false,
  overflowQueueCount = 0,
  overflowEntries = [],
  teamWorkload = null,
  serviceBucketsByTrade = {},
  callTheseFirst = [], todayList = [], remaining = [], rest = [],
  totalPipeline = 0, pipelineMap = {}, roi, lastPipelineJob = null,
  pendingReviews, calendarEvents, recentActivities,
  // Snapshot freshness — passed by the operator page so the pill in
  // the header can render a relative time and offer a manual refresh.
  snapshotGeneratedAt = null,
  snapshotIsFresh = false,
}) {
  // Rep filter for the calendar (All / Rep 1 / Rep 2). Display-only —
  // does not change scheduling.
  const [selectedRepId, setSelectedRepId] = useState("all");
  // Selected LaborTech service drives the per-trade filtered list.
  // Cleared when the user switches trades.
  const [selectedLaborTechServiceId, setSelectedLaborTechServiceId] = useState(null);
  const workspaceAccent = workspace?.branding?.accentLabel ?? null;
  // Server-supplied set of connected env-var names. Used by
  // getTradeSourceReadiness so the UI does not need to read process.env.
  const connectedEnvSet = useMemo(
    () => new Set(Array.isArray(connectedEnvVars) ? connectedEnvVars : []),
    [connectedEnvVars],
  );
  const [selectedKey, setSelectedKey] = useState(null);
  // Lifted from CalendarCommandCenter so the selected calendar task
  // survives a tab switch (Today → All Leads → History → Today). Also
  // bridges to selectedKey via handleSelectTaskFromCalendar so the
  // same lead stays selected across tabs. Single source of truth.
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  // Workflow UI state — shared across Today AND All Leads so the
  // exact same interaction model runs from either entry point.
  // Clicking a lead anywhere triggers the same panels with the same
  // open/closed state continuity.
  const [assistantCollapsed, setAssistantCollapsed] = useState(true);
  const [userClosedAssistant, setUserClosedAssistant] = useState(false);
  const [deepReportOpen, setDeepReportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [seeding, setSeeding] = useState(false);
  // Primary view tab: existing card list ("cards") or weekly Calendar
  // Command Center ("calendar"). Defaults to cards so the existing surface
  // is what the user lands on.
  // Default lands on the operator surface — that's the product.
  const [activeTab, setActiveTab] = useState("calendar");
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

  // tradeScopedLeads / tradeReadiness are the single lead pipeline
  // shared by Operator and Leads. Declared below, after selectedTradeId.

  // Calendar tasks derived from real lead/decision objects. Pass undefined
  // when there are no real leads so CalendarCommandCenter falls back to
  // its mock seed (kept only as a demo fallback, never as a primary source).
  // Selected trade module for the calendar surface. Resolution order:
  // user.tradeId → user.selectedTrade → persisted localStorage value →
  // "roofing". User-side overrides always win on the first render so a
  // server-driven scope wipes a stale local selection. Declared BEFORE
  // intelligenceScope because the scope memo depends on it.
  const TRADE_PERSIST_KEY = "meridian.operator.selectedTrade.v1";
  const initialTrade = (() => {
    // Today is the master execution surface — it defaults to "all"
    // (the All Trades master daily plan). Explicit user-provided
    // tradeId / selectedTrade still wins so a server-driven scope
    // (e.g. a single-trade tenant) is honoured. Persisted local
    // selections are intentionally ignored on mount: every time the
    // operator reopens Today they get the master plan first.
    if (user?.tradeId === "all") return "all";
    if (typeof user?.tradeId === "string" && isTradeId(user.tradeId)) return user.tradeId;
    if (user?.selectedTrade === "all") return "all";
    if (typeof user?.selectedTrade === "string" && isTradeId(user.selectedTrade)) return user.selectedTrade;
    return "all";
  })();
  const [selectedTradeId, setSelectedTradeId] = useState(initialTrade);
  // Today re-entry reset. When the operator navigates away from Today
  // (activeTab !== "calendar") and comes back, reset the trade tab to
  // All Trades so they always re-enter the master plan. Manual trade
  // switching while INSIDE Today is preserved — this only fires on
  // the transition from another tab into "calendar".
  const prevActiveTabRef = useRef(activeTab);
  useEffect(() => {
    const prev = prevActiveTabRef.current;
    prevActiveTabRef.current = activeTab;
    if (activeTab === "calendar" && prev !== "calendar") {
      setSelectedTradeId("all");
    }
  }, [activeTab]);
  // Clear the LaborTech service filter whenever the user switches trade.
  // Service filter is meaningless in "all" mode — it auto-clears.
  useEffect(() => { setSelectedLaborTechServiceId(null); }, [selectedTradeId]);

  // Auto-select the strongest bucket on the All Leads tab — the
  // bucket with the most actionable companies. Runs only when the
  // user lands on All Leads with nothing selected, and only when the
  // selected trade has at least one bucket with leads. Respects user
  // intent: once they pick or clear a bucket manually, this effect
  // doesn't override it (gated on `selectedLaborTechServiceId == null`).
  useEffect(() => {
    if (activeTab !== "cards") return;
    if (selectedLaborTechServiceId) return;
    const bundle = serviceBucketsByTrade?.[selectedTradeId];
    const cards = Array.isArray(bundle?.cards) ? bundle.cards : [];
    if (cards.length === 0) return;
    // Strongest = highest count. Ties broken by tier order (primary
    // > secondary > advanced) which the cards array already honors.
    const strongest = cards
      .filter((c) => (c?.count ?? 0) > 0)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0];
    if (strongest?.serviceId) {
      setSelectedLaborTechServiceId(strongest.serviceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedTradeId, serviceBucketsByTrade]);
  // Persist whenever it changes. SSR-safe via window guard + try/catch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(TRADE_PERSIST_KEY, selectedTradeId); } catch { /* ignore */ }
  }, [selectedTradeId]);

  // Active service angle. Default null = "all angles". Operator + Leads
  // both honor this — clicking an angle in either tab focuses both
  // surfaces; clicking it again clears. Switching trade resets it.
  const [selectedServiceAngleId, setSelectedServiceAngleId] = useState(null);
  useEffect(() => {
    setSelectedServiceAngleId(null);
  }, [selectedTradeId]);
  const handleSelectServiceAngle = useCallback((bucketId) => {
    setSelectedServiceAngleId((prev) => (prev === bucketId ? null : bucketId));
    trackEvent({
      eventType: "service_bucket_select",
      serviceBucketId: bucketId ?? null,
      tradeId: selectedTradeId ?? null,
    });
  }, [selectedTradeId]);
  const handleClearServiceAngle = useCallback(() => {
    setSelectedServiceAngleId(null);
  }, []);

  // ── Centralized cross-tab routing ────────────────────────────────────
  // Two functions are the only way to navigate between tabs. Every
  // surface uses these — no ad-hoc setActiveTab calls in children.
  //   callBucket(bucketId): Opportunities → Calls (pin bucket)
  //   callDeal(deal):       Deals → Calls (pin lead's bucket)
  const callBucket = useCallback((bucketId) => {
    if (bucketId && selectedServiceAngleId !== bucketId) {
      setSelectedServiceAngleId(bucketId);
    }
    setActiveTab("calendar");
  }, [selectedServiceAngleId]);
  const callDeal = useCallback((deal) => {
    if (!deal) { setActiveTab("calendar"); return; }
    if (deal.bucketId && selectedServiceAngleId !== deal.bucketId) {
      setSelectedServiceAngleId(deal.bucketId);
    }
    setActiveTab("calendar");
  }, [selectedServiceAngleId]);

  // ── Cross-tab selection bridges ──────────────────────────────────────
  // selectedTaskId (Today) ↔ selectedKey (All Leads) ↔ openDealId (History)
  // all reference the same underlying lead. These bridges keep them in
  // sync so a click in one tab is reflected when the user moves to
  // another. Lookup is by linkedLeadId / leadKey — both resolve to the
  // canonical `lead.key` used by All Leads' selection state.
  const handleSelectTaskFromCalendar = useCallback((task) => {
    if (!task) {
      setSelectedTaskId(null);
      return;
    }
    setSelectedTaskId(task.id ?? null);
    const linkedKey = task.linkedLeadId ?? null;
    if (typeof linkedKey === "string" && linkedKey.length > 0) {
      // Don't toggle off — a task click should pin the lead, not clear
      // a previously selected one if they happen to match.
      setSelectedKey(linkedKey);
    }
  }, []);

  // Workflow UI state effects — shared across Today and All Leads.
  // Reset Deep Report on lead change. Auto-expand assistant on lead
  // selection (unless user closed it). Auto-expand assistant when
  // Deep Report opens (the rep needs the coach most while reviewing
  // the report). Toggle handler tracks user dismissal intent.
  // ASSIST-MODE ROUTING INTENT (parent-level).
  //
  // Today's "Open Assist Mode →" is an EXECUTION INTENT, not a normal
  // lead selection. The user wants the Operator AND the Intelligence
  // Panel open in one click. A normal calendar click is a SELECTION
  // — Assist Mode should reset to give a fresh slate.
  //
  // We can't tell those two cases apart from selectedTaskId alone,
  // so the routing handler stamps a ref BEFORE flipping selectedTaskId
  // and the effect below honours that stamp. Without this, the parent
  // effect would race with — and overwrite — CCC's intent-aware
  // effect (parent effects run after child effects in React, so a
  // child setDeepReportOpen(true) gets clobbered by an unconditional
  // parent setDeepReportOpen(false)).
  const assistIntentRef = useRef(null);
  useEffect(() => {
    if (assistIntentRef.current && assistIntentRef.current === selectedTaskId) {
      assistIntentRef.current = null;
      setDeepReportOpen(true);
    } else {
      setDeepReportOpen(false);
    }
  }, [selectedTaskId]);
  // Single entry point used by Today's Command Queue. Selects the
  // lead AND opens Assist Mode in the same commit. CCC's
  // handleOpenAssist forwards to this so the intent ref lives on the
  // parent — which is the side that owns the unconditional-reset
  // effect that was clobbering the panel.
  const handleEnterAssistMode = useCallback((task) => {
    if (!task) return;
    const id = task.id ?? null;
    if (!id) return;
    assistIntentRef.current = id;
    if (selectedTaskId === id) {
      // Already selected — selectedTaskId effect won't fire, so open
      // Assist Mode directly.
      assistIntentRef.current = null;
      setDeepReportOpen(true);
    } else {
      setSelectedTaskId(id);
      // selectedTaskId effect will see the matching ref and open
      // Assist Mode in the same render commit.
    }
  }, [selectedTaskId]);
  useEffect(() => {
    if (!selectedTaskId) {
      setAssistantCollapsed(true);
      setUserClosedAssistant(false);
      return;
    }
    if (!userClosedAssistant) setAssistantCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);
  useEffect(() => {
    if (!deepReportOpen) return;
    // Narrow-viewport guard — when Deep Report opens on a tight
    // screen, collapse the assistant to its 52px rail so it stays
    // visible without pushing off-viewport. Wider screens get the
    // full expanded assistant alongside the report.
    if (typeof window !== "undefined" && window.innerWidth < 1400) {
      setAssistantCollapsed(true);
      return;
    }
    if (!userClosedAssistant) setAssistantCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepReportOpen]);
  const handleToggleAssistant = useCallback(() => {
    setAssistantCollapsed((wasCollapsed) => {
      const willBeCollapsed = !wasCollapsed;
      if (willBeCollapsed) setUserClosedAssistant(true);
      else setUserClosedAssistant(false);
      return willBeCollapsed;
    });
  }, []);

  const handleOpenDealLead = useCallback((deal) => {
    if (!deal) return;
    const linkedKey =
      typeof deal.leadKey === "string" && deal.leadKey.length > 0
        ? deal.leadKey
        : (typeof deal.leadId === "string" && deal.leadId.length > 0 ? deal.leadId : null);
    if (linkedKey) setSelectedKey(linkedKey);
    // Synthesized call-task id matches lib/calendar/tasks.ts push() shape:
    //   `lead-${leadId}-call`
    // Pre-stamping it means switching to the Today tab afterwards lands
    // with the same task highlighted (when the call task exists).
    if (linkedKey) setSelectedTaskId(`lead-${linkedKey}-call`);
  }, []);

  // Cross-tab nav callback — wired into LeadContextStrip "View in X"
  // links across all three side panels. Plain pass-through to the
  // existing tab state setter; selection is preserved by the bridges
  // above so switching never drops the active lead.
  const handleSwitchTabFromStrip = useCallback((tabKey) => {
    if (tabKey === "today") setActiveTab("calendar");
    else if (tabKey === "all-leads") setActiveTab("cards");
    else if (tabKey === "history") setActiveTab("deals");
  }, []);

  // Imported leads, keyed by tradeId. Populated by /api/ingestion/trade-leads.
  // Held in component state only — no persistence yet. When a real
  // store lands, swap this for a server-backed cache.
  const [importedLeadsByTrade, setImportedLeadsByTrade] = useState({});
  const [importState, setImportState] = useState({ loading: false, message: null, kind: null });

  // Combined pool: legacy roofing snapshot + any leads pulled in by
  // ingestion. filterLeadsForTrade gates by tradeId so HVAC pulls
  // never bleed into Roofing and vice-versa.
  const combinedLeadPool = useMemo(() => {
    const imported = Object.values(importedLeadsByTrade ?? {}).flat();
    return [...overlaidAllLeads, ...imported];
  }, [overlaidAllLeads, importedLeadsByTrade]);

  // Single source of truth for whichever trade is selected. Used by
  // both the Operator (calendar) surface AND the Leads tab.
  const tradeScopedLeads = useMemo(
    () => selectedTradeId === "all"
      ? (combinedLeadPool ?? [])
      : filterLeadsForTrade(combinedLeadPool, selectedTradeId),
    [combinedLeadPool, selectedTradeId],
  );
  const tradeReadiness = useMemo(
    () => getTradeSourceReadiness(selectedTradeId, connectedEnvSet),
    [selectedTradeId, connectedEnvSet],
  );
  const bucketPortfolio = useMemo(
    () => buildBucketPortfolio(tradeScopedLeads, selectedTradeId),
    [tradeScopedLeads, selectedTradeId],
  );
  const prioritizedAngles = useMemo(
    () => prioritizeServiceAngles(bucketPortfolio, selectedTradeId),
    [bucketPortfolio, selectedTradeId],
  );

  // Outcomes + deals live at the root so the Deals tab keeps the same
  // pipeline visible even while the user is switching trades or
  // working the Calls tab. Single shared store across tabs.
  const rootOutcomes = useOutcomes();
  const rootLeadIndex = useMemo(
    () => buildLeadIndex(combinedLeadPool, {
      defaultTrade: TRADE_MODULES[selectedTradeId]?.label ?? null,
    }),
    [combinedLeadPool, selectedTradeId],
  );
  const rootDeals = useDeals({
    events: rootOutcomes.events,
    leadIndex: rootLeadIndex,
    now: rootOutcomes.now,
  });

  // Group leads by primary service angle for the Leads tab portfolio view.
  const leadsByAngle = useMemo(() => {
    const map = {};
    for (const lead of tradeScopedLeads) {
      const primary = primaryBucketForLead(lead, selectedTradeId);
      const k = primary?.bucketId ?? "_unclassified";
      (map[k] ??= []).push(lead);
    }
    return map;
  }, [tradeScopedLeads, selectedTradeId]);

  // Operator-side execution pool. When an angle is selected, the
  // calendar (Right Now / Next Moves / Today's Edge / Later / grid)
  // operates only on that bucket. Portfolio rollups still use the
  // full tradeScopedLeads so counts reflect the whole trade.
  const angleScopedLeads = useMemo(() => {
    if (!selectedServiceAngleId) return tradeScopedLeads;
    const matching = leadsByAngle[selectedServiceAngleId] ?? [];
    return matching;
  }, [selectedServiceAngleId, leadsByAngle, tradeScopedLeads]);
  const selectedServiceAngle = useMemo(
    () => prioritizedAngles.find((a) => a.bucketId === selectedServiceAngleId) ?? null,
    [prioritizedAngles, selectedServiceAngleId],
  );

  // Single decision engine — root-level so all tabs share one queue.
  const rootOpportunitySystem = useMemo(
    () => buildOpportunitySystem(prioritizedAngles, leadsByAngle, selectedTradeId, { meaningfulOnly: true }),
    [prioritizedAngles, leadsByAngle, selectedTradeId],
  );
  const rootDecisionFlow = useDecisionFlow({
    outcomes: rootOutcomes,
    tradeScopedLeads,
    opportunitySystem: rootOpportunitySystem,
    tradeId: selectedTradeId,
    pinnedBucketId: selectedServiceAngleId ?? null,
  });

  const handleImportTradeLeads = useCallback(async () => {
    setImportState({ loading: true, message: null, kind: null });
    try {
      const res = await fetch("/api/ingestion/trade-leads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId: selectedTradeId, market: "kansas_city" }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const error = json?.error || `Import failed (${res.status})`;
        const friendly = typeof error === "string" && error.toLowerCase().includes("google_places_api_key")
          ? "Google Places isn't connected on this workspace yet. Ask an admin to wire the source."
          : error;
        setImportState({ loading: false, message: friendly, kind: "error" });
        return;
      }
      const incoming = Array.isArray(json.leads) ? json.leads : [];
      setImportedLeadsByTrade((prev) => ({ ...prev, [selectedTradeId]: incoming }));
      setImportState({
        loading: false,
        kind: "success",
        message: `Imported ${incoming.length} ${selectedTradeId} lead${incoming.length === 1 ? "" : "s"}.`,
      });
      if (process.env.NODE_ENV !== "production") {
        const bucketCounts = {};
        for (const lead of incoming) {
          const primary = primaryBucketForLead(lead, selectedTradeId);
          const k = primary?.bucketId ?? "_unclassified";
          bucketCounts[k] = (bucketCounts[k] ?? 0) + 1;
        }
        const queries = new Set();
        for (const lead of incoming) {
          if (typeof lead?.sourceQuery === "string") queries.add(lead.sourceQuery);
        }
        console.info("[ingestion] import complete", {
          tradeId: selectedTradeId,
          count: incoming.length,
          queryCount: queries.size,
          topNames: incoming.slice(0, 5).map((l) => l?.name).filter(Boolean),
          bucketCounts,
        });
      }
    } catch (err) {
      setImportState({
        loading: false,
        kind: "error",
        message: `Import failed: ${(err instanceof Error ? err.message : "unknown error")}`,
      });
    }
  }, [selectedTradeId]);

  // ── Intelligence scope ──
  // Derived best-effort from props the operator console already has.
  // Missing fields fall back to stable strings (see normalizeScope) so
  // single-user / no-session mode still works exactly as before.
  const intelligenceScope = useMemo(() => ({
    userId:   user?.id,
    tenantId: user?.tenantId ?? user?.orgId,
    clientId: user?.clientId,
    moduleId: selectedTradeId,
    marketId: user?.marketId ?? "kc",
    tradeId:  selectedTradeId,
    nicheId:  user?.nicheId  ?? "contractor-leads",
  }), [user, selectedTradeId]);
  const teamMode = "hybrid";

  // Local feedback state. Hydrated from localStorage on mount and
  // whenever the scope changes; never required for correctness.
  const [feedbackEvents, setFeedbackEvents] = useState([]);
  // Holds the previous bundle's optimized tasks so rule learning can
  // link feedback events back to the rule that produced each task's
  // adjustment. Ref (not state) — purely a learning-loop signal, never
  // affects render directly.
  const priorOptimizedTasksRef = useRef([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setFeedbackEvents(loadWorkflowFeedback(intelligenceScope));
    } catch {
      setFeedbackEvents([]);
    }
  }, [intelligenceScope]);

  const handleTaskFeedback = useCallback((task, feedbackType, reason) => {
    if (!task || !task.id) return;
    const event = createWorkflowFeedbackEvent(task, feedbackType, reason);
    if (!event) return;
    let updated = [event];
    if (typeof window !== "undefined") {
      try {
        updated = rememberWorkflowFeedback(event, intelligenceScope);
      } catch {
        updated = [event, ...feedbackEvents];
      }
    } else {
      updated = [event, ...feedbackEvents];
    }
    setFeedbackEvents(updated);
    // Cross-feed into outcome learning when a lead is linked.
    const outcome = workflowFeedbackToOutcomeEvent(event, intelligenceScope);
    if (outcome) {
      try {
        rememberOutcomeEvents([outcome], intelligenceScope);
      } catch {
        // best-effort; UI stays consistent even if persistence fails
      }
    }
  }, [intelligenceScope, feedbackEvents]);

  const calendarBundle = useMemo(() => {
    // MASTER DAILY EXECUTION PLAN.
    //
    // The schedule is built from the FULL combined lead pool — every
    // trade's leads compete for slots in one ranked list. Trade tabs
    // are filtered views of this same master schedule (filtering
    // happens downstream in the calendarTasks memo). Switching tabs
    // never reschedules a lead; it only changes which subset is
    // displayed. This is what gives All Trades up to 20 calls/day
    // distributed across Roofing, HVAC, Carpentry, Painting,
    // Plumbing, and Electrical, with each per-trade tab showing
    // only its own slice of the same plan.
    const masterPool = combinedLeadPool ?? [];
    if (masterPool.length === 0) {
      return { tasks: undefined, insights: [] };
    }

    // Current-session outcome view (cheap, derived from pipelineMap).
    // Tagged with scope at derivation time so persisted events stay
    // portable across user/client/tenant aggregation later.
    const currentEvents = deriveOutcomeEventsFromPipelineMap(pipelineMap, {
      scope: intelligenceScope,
    });

    // Persistent memory: load on the client only. SSR / build returns [].
    let storedUserEvents = [];
    if (typeof window !== "undefined") {
      try {
        storedUserEvents = loadOutcomeEvents(intelligenceScope);
        rememberOutcomeEvents(currentEvents, intelligenceScope);
      } catch {
        storedUserEvents = [];
      }
    }
    const mergedUserEvents = mergeOutcomeEvents(storedUserEvents, currentEvents);

    // Team intelligence aggregation. Today client/tenant streams are not
    // wired to a backend; the abstraction is in place so the existing
    // single-user pipeline keeps working unchanged while server-backed
    // streams can flow in later without further UI changes.
    const teamResult = buildTeamLearningInput({
      userEvents: mergedUserEvents,
      clientEvents: [],
      tenantEvents: [],
      mode: teamMode,
    });

    const learningAdjustments = combineLearningAdjustments(teamResult.events, {
      useRecencyWeighting: true,
    });

    // Market-aware learning splits the merged event pool into a local
    // (module + market + trade + niche) profile and a broader (module +
    // trade) profile. Local always dominates; broader gently fills gaps
    // when local evidence is light. Pattern + rule weights below are
    // sourced from the market-aware blend, not the raw global pool.
    const marketAwareLearning = buildMarketAwareLearning({
      events: teamResult.events,
      leads: masterPool,
      feedbackEvents,
      tasks: priorOptimizedTasksRef.current,
      scope: intelligenceScope,
      broaderEvents: teamResult.events,
      broaderFeedbackEvents: feedbackEvents,
    });
    const patternAdjustments = marketAwareLearning.patternAdjustments;

    // Master plan: NEVER pin tradeId here. Every task keeps its own
    // per-lead trade so the calendarTasks memo can filter by trade
    // at display time without re-running the schedule.
    const tradeIdForTasks = undefined;
    if (typeof console !== "undefined" && selectedTradeId === "all") {
      const tradesPresent = new Set();
      for (const l of angleScopedLeads ?? []) {
        const t = (l && (l.trade || l.tradeId || l.category || l.moduleId)) ?? "unknown";
        tradesPresent.add(String(t).toLowerCase());
      }
      dlog(
        `[all-trades-debug] rawLeads=${(angleScopedLeads ?? []).length} ` +
        `trades=${Array.from(tradesPresent).join(",") || "none"}`,
      );
    }
    // eslint-disable-next-line no-console
    dlog(
      `[debug-tasks] OperatorConsole selectedTrade="${selectedTradeId}" ` +
      `combinedLeadPool=${combinedLeadPool.length} ` +
      `tradeScopedLeads=${tradeScopedLeads.length} ` +
      `angleScopedLeads=${angleScopedLeads.length} ` +
      `selectedServiceAngleId="${selectedServiceAngleId ?? ""}" ` +
      `tradeIdForTasks="${tradeIdForTasks ?? ""}"`,
    );
    const baseTasks = buildTasksFromLeads(masterPool, {
      pipelineMap,
      learningAdjustments,
      patternAdjustments,
      tradeId: tradeIdForTasks,
      // Field-test pipeline: master plan needs at least 120 callable
      // tasks (20/day × 6 days) plus overflow into subsequent weeks
      // for recurring ingestion. The legacy default cap of 60 was the
      // exact reason Tue May 12 → Fri May 15 rendered empty. Lifting
      // here in the consumer rather than changing the default keeps
      // back-compat for any other callers.
      maxLeads: 600,
    });
    // ── Stage 2 diagnostic: post-buildTasksFromLeads ────────────
    if (typeof console !== "undefined") {
      try {
        const callTasks = baseTasks.filter((t) => {
          const id = t?.id ?? "";
          const title = t?.title ?? "";
          return id.endsWith("-call") || title.startsWith("Call ");
        });
        const byDay = new Map();
        for (const t of callTasks) {
          if (!t?.dueDate) continue;
          const d = new Date(t.dueDate);
          if (Number.isNaN(d.getTime())) continue;
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          byDay.set(k, (byDay.get(k) ?? 0) + 1);
        }
        // eslint-disable-next-line no-console
        dlog(
          `[stage2-buildTasksFromLeads] masterPool=${masterPool.length} ` +
          `baseTasks=${baseTasks.length} callTasks=${callTasks.length} ` +
          `byDay=${JSON.stringify(Object.fromEntries(Array.from(byDay.entries()).sort()))}`,
        );
      } catch { /* ignore */ }
    }
    // eslint-disable-next-line no-console
    dlog(
      `[debug-tasks] OperatorConsole baseTasks=${baseTasks.length} ` +
      `selectedTrade="${selectedTradeId}"`,
    );

    // Insights describe the underlying state — generate them from the
    // base tasks before the workflow engine reshuffles priority. Market
    // differences ride alongside so up to one market insight can show.
    const insights = buildOperatorInsights({
      events: teamResult.events,
      patternAdjustments,
      tasks: baseTasks,
      marketDifferences: marketAwareLearning.marketDifferences,
    });

    // Rule-trust learner — uses the prior bundle's optimized task list
    // (which carries workflowPrimaryRuleId / workflowRuleIds) to link
    // feedback events back to the rule that produced their adjustment.
    // Kept for the dev log; the rule weights actually fed to the engine
    // are the market-aware blend so KC roofing can trust rules differently
    // than Dallas HVAC.
    const ruleLearning = buildWorkflowRuleLearning(
      feedbackEvents,
      priorOptimizedTasksRef.current,
    );
    const effectiveRuleWeights = marketAwareLearning.ruleWeights;

    // Workflow engine consumes base tasks, insights, and adapted rule
    // weights to produce the optimized, re-ranked task list used by the
    // calendar + Execute Now + Capital Allocation surfaces.
    const workflowResult = optimizeWorkflow({
      tasks: baseTasks,
      insights,
      ruleWeights: effectiveRuleWeights,
    });
    // Apply any persisted operator feedback on top of the engine's
    // optimized list. Feedback never deletes tasks — only restores
    // priority, promotes, defers, or annotates.
    const tasks = applyFeedbackToTasks(workflowResult.tasks, feedbackEvents);
    // Persist this bundle's optimized tasks so the next render's rule
    // learner can link feedback to the correct rule.
    priorOptimizedTasksRef.current = workflowResult.tasks;

    if (process.env.NODE_ENV !== "production") {
      const ids = tasks.map((t) => t.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      const adjustedLeadIds = Object.keys(learningAdjustments);
      const topAdjusted = [...adjustedLeadIds]
        .sort((a, b) =>
          Math.abs(learningAdjustments[b].probabilityDelta) -
          Math.abs(learningAdjustments[a].probabilityDelta),
        )
        .slice(0, 5);
      const patternKeys = Object.keys(patternAdjustments);
      const topPatterns = [...patternKeys]
        .sort((a, b) =>
          Math.abs(patternAdjustments[b].probabilityDelta) -
          Math.abs(patternAdjustments[a].probabilityDelta),
        )
        .slice(0, 5);
      ddebug("[CalendarCommandCenter]", {
        leads: tradeScopedLeads.length,
        tasksGenerated: tasks.length,
        duplicateIds: dupes,
        scopeKey: makeScopeKey(intelligenceScope),
        teamIntelligenceMode: teamResult.mode,
        userEvents: teamResult.sourceCounts.user,
        clientEvents: teamResult.sourceCounts.client,
        tenantEvents: teamResult.sourceCounts.tenant,
        finalTeamEvents: teamResult.events.length,
        currentOutcomeEvents: currentEvents.length,
        storedOutcomeEvents: storedUserEvents.length,
        mergedOutcomeEvents: mergedUserEvents.length,
        directLearningAdjustments: adjustedLeadIds.length,
        patternAdjustments: patternKeys.length,
        topAdjustedLeadIds: topAdjusted,
        topPatternKeys: topPatterns,
        insightsGenerated: insights.length,
        insightIds: insights.map((i) => i.id),
        insightCategories: insights.map((i) => i.category),
        insightConfidence: insights.map((i) => i.confidence),
        workflowAdjustments: workflowResult.adjustments.length,
        workflowAdjustedTaskIds: tasks
          .filter((t) => t.workflowAdjusted)
          .map((t) => t.id),
        workflowAdjustmentReasons: workflowResult.adjustments.map((a) => a.reason),
        workflowFeedbackEvents: feedbackEvents.length,
        feedbackAdjustedTaskIds: tasks
          .filter((t) => t.feedbackApplied)
          .map((t) => t.id),
        feedbackOutcomeEventsCreated: feedbackEvents.filter((f) => !!f.leadId).length,
        ruleLearningStats: Object.keys(ruleLearning.stats).filter(
          (k) => ruleLearning.stats[k].totalSignals > 0,
        ).length,
        ruleWeights: ruleLearning.ruleWeights,
        topRuleTrustReasons: Object.entries(ruleLearning.stats)
          .filter(([, s]) => s.totalSignals > 0)
          .sort((a, b) => Math.abs(b[1].weightMultiplier - 1) - Math.abs(a[1].weightMultiplier - 1))
          .slice(0, 5)
          .map(([k, s]) => ({ ruleId: k, weight: s.weightMultiplier, reason: s.reason })),
        marketContextKey: marketAwareLearning.contextKey,
        localMarketEventCount: marketAwareLearning.localEventCount,
        broaderMarketEventCount: marketAwareLearning.broaderEventCount,
        marketConfidence: marketAwareLearning.marketConfidence,
        marketDifferences: marketAwareLearning.marketDifferences.length,
        marketBlendMode: marketAwareLearning.blendMode,
      });

      // Trade-module diagnostics — confirms trade selection, bucket
      // attachment, and a tiny portfolio summary across leads.
      {
        const tradeLabel = TRADE_MODULES[selectedTradeId]?.label ?? selectedTradeId;
        const totalTasksWithBucket = tasks.filter((t) => !!t.serviceBucketId).length;
        const bucketCounts = {};
        for (const t of tasks) {
          if (!t.serviceBucketId) continue;
          bucketCounts[t.serviceBucketId] = (bucketCounts[t.serviceBucketId] ?? 0) + 1;
        }
        const rightNowBucket = (() => {
          // tasks are already workflow-adjusted + canonical-sorted, so the
          // first non-done task is the same one Right Now will pick.
          const decisionTask = tasks.find((t) => t && t.status !== "done");
          if (!decisionTask) return null;
          return decisionTask.serviceBucketId
            ? `${decisionTask.tradeLabel ?? ""} · ${decisionTask.serviceBucketLabel ?? decisionTask.serviceBucketId}`
            : null;
        })();
        const portfolioStackSummary = buildPortfolioStack(tradeScopedLeads).map((s) => ({
          tradeId: s.tradeId,
          totalLeads: s.totalLeads,
          buckets: s.buckets.map((b) => ({ id: b.bucketId, count: b.count })),
        }));
        ddebug("[TradeModule]", {
          selectedTradeId,
          tradeLabel,
          totalTasksWithBucket,
          bucketCounts,
          rightNowBucket,
          portfolioStackSummary,
        });
      }

      // Canonical scoring agreement check — confirms Execute Now,
      // Capital Allocation, and Top 3 are voting for the same tasks.
      {
        let topExecute = null, topAlloc = null, topTask = null;
        let topExecuteScore = -1, topAllocScore = -1, topTaskScoreVal = -1;
        let topExecuteBreakdown = null;
        for (const t of tasks) {
          if (!t || t.status === "done") continue;
          const s = scoreLeadTaskCanonical(t);
          if (s.executeScore > topExecuteScore) {
            topExecuteScore = s.executeScore;
            topExecute = t.id;
            topExecuteBreakdown = s.breakdown;
          }
          if (s.allocationScore > topAllocScore) {
            topAllocScore = s.allocationScore;
            topAlloc = t.id;
          }
          if (s.taskScore > topTaskScoreVal) {
            topTaskScoreVal = s.taskScore;
            topTask = t.id;
          }
        }
        ddebug("[CanonicalScoring]", {
          topExecuteTaskId: topExecute,
          topAllocationTaskId: topAlloc,
          topTaskScoreTaskId: topTask,
          allAgree: topExecute === topAlloc && topAlloc === topTask,
          executeBreakdown: topExecuteBreakdown,
        });
      }

      if (ENABLE_INTERNAL_GLOBAL_INTELLIGENCE) {
        const globalDiscovery = buildGlobalIntelligence({
          events: teamResult.events,
          leads: angleScopedLeads,
          feedbackEvents,
          tasks: priorOptimizedTasksRef.current,
        });
        ddebug("[GlobalIntelligence]", {
          globalMarketsAnalyzed: globalDiscovery.diagnostics.marketsAnalyzed,
          universalPatternKeys: globalDiscovery.universalPatternKeys,
          marketSpecificPatternKeys: globalDiscovery.marketSpecificPatternKeys,
          noisyPatternKeys: globalDiscovery.noisyPatternKeys,
          emergingPatternKeys: globalDiscovery.emergingPatternKeys,
          universalRuleIds: globalDiscovery.universalRuleIds,
          marketSpecificRuleIds: globalDiscovery.marketSpecificRuleIds,
          noisyRuleIds: globalDiscovery.noisyRuleIds,
          emergingRuleIds: globalDiscovery.emergingRuleIds,
        });
      }
    }
    return {
      tasks: tasks.length > 0 ? tasks : undefined,
      insights,
    };
    // Master plan deps: combinedLeadPool drives the schedule. Trade
    // and angle filters are applied downstream (calendarTasks memo)
    // so changing a tab doesn't rebuild the schedule.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedLeadPool, pipelineMap, intelligenceScope, feedbackEvents]);
  const rawCalendarTasks = calendarBundle.tasks;
  const operatorInsights = calendarBundle.insights;

  // ── Calendar visibility (Outlook-style toggles) ──────────────────────
  // Display-only filter. Does not touch buildGlobalLeadSchedule, the
  // overflow queue, or any task-generation path. Each toggle scopes
  // which task category the calendar renders.
  const [calendarVisibility, setCalendarVisibility] = useState(DEFAULT_CALENDAR_VISIBILITY);
  const toggleVisibility = useCallback((key) => {
    setCalendarVisibility((v) => ({ ...v, [key]: !v[key] }));
  }, []);
  // Lead → primary LaborTech service map. Driven by each lead's
  // decision.primaryOpportunity (server-attached). Used to color-code
  // calendar tasks by service-need.
  const primaryServiceByLeadKey = useMemo(() => {
    const map = new Map();
    const collect = (l) => {
      if (!l) return;
      const sid = l.decision?.primaryOpportunity?.services?.[0]?.id;
      if (l.key && sid) map.set(l.key, sid);
    };
    [...callTheseFirst, ...todayList, ...remaining, ...rest].forEach(collect);
    return map;
  }, [callTheseFirst, todayList, remaining, rest]);

  // Service-filter aware calendar tasks. When a LaborTech service is
  // selected, only tasks whose linked lead is in that service's lead
  // list pass through. Visibility filter applies on top. Each task is
  // also stamped with primaryServiceId + service color metadata so the
  // calendar grid can color-code cards.
  const calendarTasks = useMemo(() => {
    let pool = rawCalendarTasks ?? [];
    // ── Stage 3 diagnostic: rawCalendarTasks BEFORE trade filter ──
    if (typeof console !== "undefined") {
      try {
        const callTasks = (pool ?? []).filter((t) => {
          const id = t?.id ?? ""; const title = t?.title ?? "";
          return id.endsWith("-call") || title.startsWith("Call ");
        });
        const byDay = new Map();
        for (const t of callTasks) {
          if (!t?.dueDate) continue;
          const d = new Date(t.dueDate);
          if (Number.isNaN(d.getTime())) continue;
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          byDay.set(k, (byDay.get(k) ?? 0) + 1);
        }
        // eslint-disable-next-line no-console
        dlog(
          `[stage3-rawCalendarTasks] total=${pool.length} callTasks=${callTasks.length} ` +
          `selectedTradeId=${selectedTradeId} ` +
          `selectedRepId=${selectedRepId ?? "—"} ` +
          `selectedLaborTechServiceId=${selectedLaborTechServiceId ?? "—"} ` +
          `byDay=${JSON.stringify(Object.fromEntries(Array.from(byDay.entries()).sort()))}`,
        );
      } catch { /* ignore */ }
    }
    // MASTER → trade filter. The calendar bundle now schedules across
    // every trade (master plan, ≤ MAX_TOTAL_CALLS_PER_DAY per business
    // day). Per-trade tabs are filtered views: switching trades does
    // NOT rebuild the schedule, only reduces which scheduled tasks
    // render. selectedTradeId === "all" passes the whole master plan
    // through.
    if (selectedTradeId && selectedTradeId !== "all") {
      const wanted = String(selectedTradeId).toLowerCase();
      pool = pool.filter((t) => {
        const tid = (t?.tradeId ?? t?.trade ?? t?.category ?? "").toString().toLowerCase();
        return tid === wanted;
      });
    }
    if (selectedRepId && selectedRepId !== "all") {
      pool = pool.filter((t) => !t?.assignedRepId || t.assignedRepId === selectedRepId);
    }
    if (selectedLaborTechServiceId) {
      const tradeBundle = serviceBucketsByTrade?.[selectedTradeId];
      const list = tradeBundle?.leadsByService?.[selectedLaborTechServiceId] ?? [];
      const allowed = new Set(list.map((e) => e.leadKey));
      pool = pool.filter((t) => {
        const k = t?.linkedLeadId;
        return typeof k === "string" && allowed.has(k);
      });
      if (typeof console !== "undefined") {
        dlog(
          `[calendar-service-filter] trade=${selectedTradeId} ` +
          `service=${selectedLaborTechServiceId} scheduledVisible=${pool.length}`,
        );
      }
    }
    // Enrich each task with color metadata.
    // Service fields (serviceShortLabel / serviceColor / serviceAccent /
    // primaryServiceId) ALWAYS hold the LaborTech service bucket — they
    // are never overwritten with the trade short label, in either view.
    // In All Trades mode we additionally stamp dedicated trade fields
    // (tradeShortLabel / tradeColor / tradeAccent / tradePill / tradeText)
    // so the calendar card can render a separate trade chip alongside
    // the service chip without one ever masking the other.
    const allTradesMode = selectedTradeId === "all";
    pool = pool.map((t) => {
      const sid = t?.linkedLeadId ? primaryServiceByLeadKey.get(t.linkedLeadId) ?? "lead_generation" : null;
      const serviceCfg = sid ? getServiceCatalogEntry(sid) : null;
      const tradeCfg = allTradesMode ? getTradeColor(t?.tradeId) : null;
      const next = { ...t };
      // Service bucket — preserved exactly across views so Reviews
      // stays yellow, SEO stays green, Website Conversion stays blue.
      if (serviceCfg) {
        next.primaryServiceId = sid;
        next.serviceShortLabel = serviceCfg.shortLabel;
        next.serviceColor = serviceCfg.calendarColor;
        next.serviceAccent = serviceCfg.calendarAccent;
      } else if (
        typeof t?.serviceShortLabel === "string" &&
        t.serviceShortLabel.startsWith("trade:") === false
      ) {
        // Keep whatever service stamping was already on the task; do
        // nothing. Fall through to trade-stamping below.
      }
      // Trade stamping — separate field family. Never touches service.
      if (tradeCfg) {
        next.tradeShortLabel = tradeCfg.shortLabel;
        next.tradeColor = tradeCfg.border;
        next.tradeAccent = tradeCfg.background;
        next.tradePill = tradeCfg.pill;
        next.tradeText = tradeCfg.text;
      }
      // Audit — catches any upstream regression where a trade slug
      // ever ends up living inside the service field.
      if (
        typeof console !== "undefined" &&
        typeof next.serviceShortLabel === "string" &&
        next.serviceShortLabel.startsWith("trade:")
      ) {
        // eslint-disable-next-line no-console
        dlog(
          `[label-audit-warning] lead="${next?.linkedCompany ?? next?.id ?? "?"}" ` +
          `issue="service overwritten by trade label"`,
        );
      }
      if (
        allTradesMode &&
        typeof console !== "undefined" &&
        !next.serviceShortLabel
      ) {
        // eslint-disable-next-line no-console
        dlog(
          `[label-audit-warning] lead="${next?.linkedCompany ?? next?.id ?? "?"}" ` +
          `issue="missing service bucket in all trades"`,
        );
      }
      return next;
    });
    if (allTradesMode && typeof console !== "undefined") {
      const tradeCounts = {};
      for (const t of pool) {
        const tid = t?.tradeId || "unknown";
        tradeCounts[tid] = (tradeCounts[tid] ?? 0) + 1;
      }
      dlog(
        `[all-trades-debug] selectedTrade=all visible=${pool.length} ` +
        `trades=${Object.keys(tradeCounts).length}`,
      );
      dlog(
        `[calendar-trade-view] mode=all visible=${pool.length} ` +
        `trades=${Object.keys(tradeCounts).length}`,
      );
      Object.entries(tradeCounts).forEach(([tid, count]) => {
        dlog(`[calendar-trade-color] trade=${tid} count=${count}`);
      });
    }
    const finalPool = filterCalendarTasks(pool, calendarVisibility);
    // ── Stage 4 diagnostic: calendarTasks AFTER all filters ─────
    if (typeof console !== "undefined") {
      try {
        const callTasks = finalPool.filter((t) => {
          const id = t?.id ?? ""; const title = t?.title ?? "";
          return id.endsWith("-call") || title.startsWith("Call ");
        });
        const byDay = new Map();
        for (const t of callTasks) {
          if (!t?.dueDate) continue;
          const d = new Date(t.dueDate);
          if (Number.isNaN(d.getTime())) continue;
          const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          byDay.set(k, (byDay.get(k) ?? 0) + 1);
        }
        const expected = ["2026-05-07","2026-05-08","2026-05-11","2026-05-12","2026-05-13","2026-05-14"];
        const expectedVsActual = expected.map((d) => `${d}:exp20/act${byDay.get(d) ?? 0}`).join(" ");
        // eslint-disable-next-line no-console
        dlog(
          `[stage4-calendarTasks] total=${finalPool.length} callTasks=${callTasks.length} ` +
          `byDay=${JSON.stringify(Object.fromEntries(Array.from(byDay.entries()).sort()))} ` +
          `field-test=${expectedVsActual}`,
        );
      } catch { /* ignore */ }
    }
    return finalPool;
  }, [rawCalendarTasks, calendarVisibility, selectedLaborTechServiceId, selectedTradeId, serviceBucketsByTrade, primaryServiceByLeadKey, selectedRepId]);

  // Workflow-task lookup for the All Leads inline panels — finds the
  // matching call task in calendarTasks by linkedLeadId so the same
  // SelectedLeadPanel + Assistant + Deep Report mount with real task
  // context. Falls back to the synthesized id `lead-<key>-call` if no
  // match (rare; means buildTasksFromLeads didn't admit this lead).
  const selectedTaskFromLead = useMemo(() => {
    if (!selectedKey) return null;
    const list = Array.isArray(rawCalendarTasks) ? rawCalendarTasks : [];
    const direct = list.find((t) => t?.linkedLeadId === selectedKey);
    if (direct) return direct;
    // Synthesize a minimal task so the inline panels still render
    // when the calendar didn't produce one.
    const lead = selectedLead;
    if (!lead) return null;
    return {
      id: `lead-${selectedKey}-call`,
      title: `Call ${lead.name ?? "lead"}`,
      category: "priority",
      priority: "medium",
      status: "todo",
      linkedLeadId: selectedKey,
      linkedCompany: lead.name ?? null,
      linkedLocation: lead.location ?? null,
      phone: lead.contacts?.primaryPhone ?? null,
      email: lead.contacts?.primaryEmail ?? null,
      verifiedEmail: lead.verifiedEmail ?? null,
      emailSource: lead.emailSource ?? null,
      emailConfidence: lead.emailConfidence ?? null,
      // Carry both the slug (tradeId) and the label. Service-fit and
      // trade-filter logic prefer the slug; the human label is used
      // for display in the panel header. Without this, the synthesised
      // path could fall back inconsistently when the label differs
      // from the canonical lowercase trade key.
      tradeId: typeof lead.trade === "string" ? lead.trade : null,
      tradeLabel: lead.trade ? (TRADE_MODULES[lead.trade]?.label ?? lead.trade) : null,
      laborTechScan: lead.laborTechScan ?? null,
      serviceNeed: lead.serviceNeed ?? null,
      salesStrategy: lead.salesStrategy ?? null,
      closeProbability100: typeof lead.salesStrategy?.closeProbability === "number"
        ? lead.salesStrategy.closeProbability
        : null,
    };
  }, [selectedKey, rawCalendarTasks, selectedLead]);

  // Legend entries — only services that appear in the visible tasks.
  const calendarServiceLegend = useMemo(() => {
    const seen = new Map();
    for (const t of calendarTasks) {
      const sid = t?.primaryServiceId;
      if (!sid || seen.has(sid)) continue;
      const cfg = getServiceCatalogEntry(sid);
      if (!cfg) continue;
      seen.set(sid, {
        id: sid,
        shortLabel: cfg.shortLabel,
        color: cfg.calendarColor,
        accent: cfg.calendarAccent,
      });
    }
    const list = Array.from(seen.values());
    if (typeof console !== "undefined" && list.length > 0) {
      dlog(
        `[calendar-service-colors] services=${list.map((s) => s.id).join(",")} count=${list.length}`,
      );
    }
    return list;
  }, [calendarTasks]);

  const serviceFilterLabel = useMemo(() => {
    if (!selectedLaborTechServiceId) return null;
    const tradeBundle = serviceBucketsByTrade?.[selectedTradeId];
    const card = tradeBundle?.cards?.find((c) => c.serviceId === selectedLaborTechServiceId);
    return card?.label ?? selectedLaborTechServiceId;
  }, [selectedLaborTechServiceId, selectedTradeId, serviceBucketsByTrade]);
  const visibilitySummary = useMemo(
    () => summarizeVisibility(calendarVisibility),
    [calendarVisibility],
  );

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
  const highPriFilter = (leads) => filterHighPriority
    ? leads.filter((l) => (marketFitScore(l) ?? l.score ?? 0) >= 70 || l.forceAction)
    : leads;

  async function handleSeed() {
    setSeeding(true);
    try { await fetch("/api/pipeline/seed?skipInspect", { method: "POST", credentials: "include" }); } catch {}
    finally { setSeeding(false); }
  }

  return (
    <div style={S.root}>
      <header id="meridian-header" style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.logo}>M</div>
          <div>
            <div style={S.hTitle}>Meridian</div>
            <div style={S.hSub}>
              {workspaceAccent ? workspaceAccent : "Who to call first"}
            </div>
            {Array.isArray(sourceReadiness) && sourceReadiness.length > 0 && (
              <div style={{ marginTop: "8px" }}>
                <SourceReadiness items={sourceReadiness} compact />
              </div>
            )}
            {teamWorkload ? (
              <div
                role="group"
                aria-label="Team workload"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "10px",
                  alignItems: "center",
                  marginTop: "6px",
                  padding: "4px 10px",
                  fontSize: "11px",
                  color: palette.textSecondary,
                  background: palette.surface,
                  border: `1px solid ${palette.borderLight}`,
                  borderRadius: "999px",
                  width: "fit-content",
                }}
              >
                <span style={{ fontWeight: 700, color: palette.textPrimary }}>
                  {selectedTradeId === "all" ? "All Trades · " : ""}Scheduled {teamWorkload.scheduled} · {teamWorkload.horizonWeeks}w
                </span>
                {typeof teamWorkload.thisWeek === "number" ? (
                  <span>
                    This week: <strong style={{ color: palette.textPrimary }}>{teamWorkload.thisWeek}</strong>
                  </span>
                ) : null}
                {typeof teamWorkload.today === "number" ? (
                  <span>
                    Today: <strong style={{ color: palette.textPrimary }}>{teamWorkload.today}</strong>
                  </span>
                ) : null}
                {teamWorkload.perRep.map((r) => (
                  <span key={r.id}>
                    {r.name} today: <strong style={{ color: palette.textPrimary }}>{r.today ?? 0}</strong>
                    <span style={{ color: palette.textTertiary }}> / {r.total} total</span>
                  </span>
                ))}
                <span style={{ color: palette.textTertiary }}>
                  Overflow {teamWorkload.overflow} · weekends skipped {teamWorkload.weekendSkips}
                </span>
                <span style={{ display: "inline-flex", gap: "4px", alignItems: "center" }}>
                  {[{ id: "all", name: "All" }, ...teamWorkload.perRep].map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRepId(r.id)}
                      aria-pressed={selectedRepId === r.id}
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        border: `1px solid ${selectedRepId === r.id ? palette.blueBorder : palette.border}`,
                        background: selectedRepId === r.id ? palette.bluePale : palette.surfaceHover,
                        color: selectedRepId === r.id ? palette.blue : palette.textSecondary,
                        cursor: "pointer",
                      }}
                    >
                      {r.name}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}
            {overflowQueueCount > 0 && (
              <div
                title="Leads waiting in the overflow queue. They roll into the schedule as calls get marked done."
                style={{
                  marginTop: "6px",
                  display: "inline-block",
                  fontSize: "11px",
                  fontWeight: 600,
                  color: palette.textSecondary,
                  background: palette.surfaceHover,
                  border: `1px solid ${palette.border}`,
                  borderRadius: "999px",
                  padding: "3px 10px",
                }}
              >
                Overflow: {overflowQueueCount} lead{overflowQueueCount === 1 ? "" : "s"} waiting
              </div>
            )}
          </div>
        </div>
        <nav style={S.tabBar} aria-label="Primary view">
          <button
            type="button"
            onClick={() => setActiveTab("calendar")}
            style={activeTab === "calendar" ? S.tabBtnActive : S.tabBtn}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("cards")}
            style={activeTab === "cards" ? S.tabBtnActive : S.tabBtn}
          >
            All Leads
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("deals")}
            style={activeTab === "deals" ? S.tabBtnActive : S.tabBtn}
          >
            History
          </button>
        </nav>
        <div className="meridian-stats" style={S.headerRight}>
          {activeTab !== "calendar" && (
            <>
              <span className="meridian-stats-optional" style={S.stat}>{top25} ranked</span>
              <span className="meridian-stats-optional" style={S.stat}>{roi?.contacted ?? 0} contacted</span>
              <span className="meridian-stats-optional" style={S.stat}>{roi?.closedWon ?? 0} closed</span>
            </>
          )}
          {workspace?.slug ? (
            <SnapshotFreshnessPill
              workspaceSlug={workspace.slug}
              generatedAt={snapshotGeneratedAt ?? null}
            />
          ) : null}
          <span style={S.userName}>{user.name}</span>
        </div>
      </header>

      {/* NOTE: no `key={refreshKey}` — using a changing key here remounted
          the entire body on every CRM log, which wiped local UI state
          including the View Scan modal. refreshKey stays in scope only so
          future effects can depend on it; React reconciliation re-renders
          children on prop change without the remount sledgehammer. */}
      <div id="meridian-body" style={S.body}>
        {activeTab === "deals" ? (
          <main id="meridian-main" style={{ ...S.main, padding: "20px 24px 40px" }}>
            <DealsPipeline
              dealsHook={rootDeals}
              onCallDeal={callDeal}
              onLeadSelected={handleOpenDealLead}
              onSwitchTab={handleSwitchTabFromStrip}
            />
          </main>
        ) : activeTab === "calendar" ? (
          <main id="meridian-main" style={{ ...S.main, padding: 0 }}>
            {/* Carousel removed — the left Today Focus rail (Right Now +
                Up Next + Momentum) is now the single execution surface.
                Decision flow state is still computed in case other surfaces
                need it; the floating priority card no longer renders. */}
            <div
              role="group"
              aria-label="Calendar visibility"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px",
                marginBottom: "6px",
                background: palette.surface,
                border: `1px solid ${palette.borderLight}`,
                borderRadius: "8px",
                fontSize: "11px",
                color: palette.textSecondary,
              }}
            >
              <span style={{ fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginRight: "4px", color: palette.textTertiary }}>Show</span>
              {Object.entries(VISIBILITY_LABEL_MAP).map(([k, label]) => {
                const on = !!calendarVisibility[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleVisibility(k)}
                    aria-pressed={on}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "3px 9px",
                      borderRadius: "999px",
                      border: `1px solid ${on ? palette.blueBorder : palette.border}`,
                      background: on ? palette.bluePale : palette.surfaceHover,
                      color: on ? palette.blue : palette.textSecondary,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
              <span style={{ marginLeft: "auto", color: palette.textTertiary }}>{visibilitySummary}</span>
            </div>
            {selectedTradeId === "all" ? (
              <div
                role="group"
                aria-label="LaborTech trade legend"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  marginBottom: "6px",
                  background: palette.surface,
                  border: `1px solid ${palette.borderLight}`,
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: palette.textSecondary,
                }}
              >
                <span style={{
                  fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: palette.textTertiary,
                  marginRight: "4px",
                }}>
                  LaborTech Trades
                </span>
                {TRADE_COLOR_ORDER.map((tid) => {
                  const c = getTradeColor(tid);
                  if (!c) return null;
                  return (
                    <span
                      key={tid}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: c.background,
                        border: `1px solid ${c.pill}`,
                        color: c.text,
                        fontWeight: 600,
                      }}
                    >
                      <span style={{
                        width: "7px", height: "7px", borderRadius: "50%",
                        background: c.border, display: "inline-block",
                      }} />
                      {c.shortLabel}
                    </span>
                  );
                })}
              </div>
            ) : calendarServiceLegend.length > 0 ? (
              <div
                role="group"
                aria-label="LaborTech service legend"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  marginBottom: "6px",
                  background: palette.surface,
                  border: `1px solid ${palette.borderLight}`,
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: palette.textSecondary,
                }}
              >
                <span style={{
                  fontWeight: 700, letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: palette.textTertiary,
                  marginRight: "4px",
                }}>
                  LaborTech Services
                </span>
                {calendarServiceLegend.map((s) => (
                  <span
                    key={s.id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      background: s.accent,
                      border: `1px solid ${s.color}33`,
                      color: s.color,
                      fontWeight: 600,
                    }}
                  >
                    <span style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: s.color,
                      display: "inline-block",
                    }} />
                    {s.shortLabel}
                  </span>
                ))}
              </div>
            ) : null}
            {serviceFilterLabel ? (
              <div
                role="status"
                aria-live="polite"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                  padding: "6px 12px",
                  marginBottom: "6px",
                  background: palette.bluePale,
                  border: `1px solid ${palette.blueBorder}`,
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: palette.textPrimary,
                }}
              >
                <span style={{ fontWeight: 600, color: palette.blue }}>
                  Showing scheduled {TRADE_MODULES[selectedTradeId]?.label ?? selectedTradeId} leads needing {serviceFilterLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedLaborTechServiceId(null)}
                  style={{
                    marginLeft: "auto",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: palette.blue,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "2px 0",
                  }}
                >
                  Clear service filter
                </button>
              </div>
            ) : null}
            <CalendarCommandCenter
              tasks={calendarTasks}
              insights={operatorInsights}
              overflowEntries={overflowEntries}
              workspaceSlug={workspace?.slug ?? ""}
              onTaskFeedback={handleTaskFeedback}
              tradeId={selectedTradeId}
              tradeLabel={TRADE_MODULES[selectedTradeId]?.label ?? "Roofing"}
              tradeReadiness={tradeReadiness}
              hasTradeLeads={tradeScopedLeads.length > 0}
              selectedServiceAngleId={selectedServiceAngleId}
              selectedServiceAngleLabel={selectedServiceAngle?.bucketLabel ?? null}
              onClearServiceAngle={handleClearServiceAngle}
              onSelectServiceAngle={handleSelectServiceAngle}
              hasAngleLeads={angleScopedLeads.length > 0}
              bucketPortfolio={bucketPortfolio}
              prioritizedAngles={prioritizedAngles}
              onImportTradeLeads={handleImportTradeLeads}
              importState={importState}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTaskFromCalendar}
              onSwitchTab={handleSwitchTabFromStrip}
              selectedLead={selectedLead}
              onLeadUpdate={handleUpdate}
              hunterAvailable={hunterAvailable}
              assistantCollapsed={assistantCollapsed}
              onToggleAssistant={handleToggleAssistant}
              deepReportOpen={deepReportOpen}
              onDeepReportOpen={() => setDeepReportOpen(true)}
              onDeepReportClose={() => setDeepReportOpen(false)}
              onEnterAssistMode={handleEnterAssistMode}
              tradeSlot={(
                <TradeModuleSelector
                  selectedTradeId={selectedTradeId}
                  onSelect={(tid) => {
                    setSelectedTradeId(tid);
                    trackEvent({ eventType: "trade_tab_select", tradeId: tid ?? null });
                  }}
                />
              )}
            />
          </main>
        ) : (
          // Unified Leads tab: every trade (roofing included) renders the
          // same TradeLeadsPortfolio. Service Angles are the primary
          // grouping; the legacy roofing CRM list has been retired in
          // favor of the trade-aware portfolio. Operator + Leads now read
          // from the exact same `tradeScopedLeads` source.
          //
          // Layout: left = lead lists (existing portfolio + services
          // panels), right = LeadDetail when a lead is selected. Mirrors
          // the Today layout (calendar grid + selected-lead rail) so the
          // user reads All Leads as the same surface, not a separate one.
          <main id="meridian-main" style={{
            ...S.main,
            padding: "20px 24px 40px",
            display: "grid",
            // Background workspace (lead list) takes full width when
            // no lead is selected. When the workflow opens, the right
            // slot expands to host Operator + (Deep Report) + Assistant
            // inline. Auto column lets the right side size to its
            // shared WORKFLOW constants without overflowing the page.
            gridTemplateColumns: !selectedTaskFromLead
              ? SHELL_GRID.noLead
              : (deepReportOpen ? SHELL_GRID.deep : SHELL_GRID.closed),
            transition: WORKFLOW.shellTransition,
            gap: WORKFLOW.shellGap,
            alignItems: "start",
          }}>
            <div style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}>
            {(() => {
              // Build the trade strip's option list from the workspace's
              // bucket map. Trades with zero cards are still shown so
              // the operator can see the vertical exists but is empty —
              // never silently disappear a trade.
              const availableTrades = Object.keys(serviceBucketsByTrade ?? {}).map((id) => ({
                id,
                label: TRADE_MODULES[id]?.label ?? id,
              }));
              if (availableTrades.length === 0) return null;
              // Operator pool — prefer the workspace's existing
              // teamWorkload.perRep when populated, fall back to a
              // small LaborTech-specific roster so John+Sam can
              // assign leads on day one without a config change.
              const teamReps = Array.isArray(teamWorkload?.perRep) ? teamWorkload.perRep : [];
              const reps = teamReps.length > 0
                ? teamReps.map((r) => ({ id: r.id, name: r.name }))
                : [
                    { id: "john", name: "John" },
                    { id: "sam", name: "Sam" },
                    { id: "rep-1", name: "Rep 1" },
                    { id: "rep-2", name: "Rep 2" },
                    { id: "unassigned", name: "Unassigned" },
                  ];
              return (
                <AllLeadsBucketOverview
                  workspaceSlug={workspace?.slug ?? ""}
                  trade={selectedTradeId}
                  serviceBucketsByTrade={serviceBucketsByTrade}
                  availableTrades={availableTrades}
                  reps={reps}
                  onTradeChange={(newTradeId) => {
                    // Only fires for real trade picks — the "All Trades"
                    // virtual selection is internal to the component
                    // and never propagates here.
                    if (typeof setSelectedTradeId === "function") {
                      setSelectedTradeId(newTradeId);
                    }
                  }}
                  onSelectLead={(leadKey) => {
                    setSelectedKey(leadKey);
                    if (typeof leadKey === "string" && leadKey.length > 0) {
                      const taskId = `lead-${leadKey}-call`;
                      const list = Array.isArray(rawCalendarTasks) ? rawCalendarTasks : [];
                      const direct = list.find((t) => t?.linkedLeadId === leadKey);
                      handleEnterAssistMode(direct ?? { id: taskId });
                    }
                  }}
                  onViewAllInTrade={() => setSelectedLaborTechServiceId(null)}
                  onStartPrioritizedCalling={() => {
                    // Route to Today's queue — the deterministic
                    // ranked schedule already produced the priority
                    // order. Operator clicks the first card from there.
                    setActiveTab("calendar");
                  }}
                />
              );
            })()}
            {/* Removed duplicate LaborTechServicesPanel render. Bucket
                overview + drill-down now lives entirely in
                AllLeadsBucketOverview above. The TradeLeadsPortfolio
                below provides the deep raw-list view. */}
            {selectedLaborTechServiceId ? null : (
            <TradeLeadsPortfolio
              user={user}
              selectedTradeId={selectedTradeId}
              tradeLabel={TRADE_MODULES[selectedTradeId]?.label ?? selectedTradeId}
              onSelectTrade={setSelectedTradeId}
              tradeScopedLeads={tradeScopedLeads}
              prioritizedAngles={prioritizedAngles}
              leadsByAngle={leadsByAngle}
              tradeReadiness={tradeReadiness}
              onImport={handleImportTradeLeads}
              importState={importState}
              selectedServiceAngleId={selectedServiceAngleId}
              onSelectServiceAngle={handleSelectServiceAngle}
              onClearServiceAngle={handleClearServiceAngle}
              onOpenOperator={() => setActiveTab("calendar")}
              selectedLeadKey={selectedKey}
              onSelectLead={(leadKey) => {
                setSelectedKey(leadKey);
                if (typeof leadKey === "string" && leadKey.length > 0) {
                  const taskId = `lead-${leadKey}-call`;
                  const list = Array.isArray(rawCalendarTasks) ? rawCalendarTasks : [];
                  const direct = list.find((t) => t?.linkedLeadId === leadKey);
                  trackEvent({
                    eventType: "all_leads_row_select",
                    taskId,
                    leadId: leadKey,
                    companyName: direct?.linkedCompany ?? null,
                    tradeId: direct?.tradeId ?? selectedTradeId ?? null,
                    serviceBucketId: direct?.laborTechScan?.primaryService ?? null,
                  });
                  handleEnterAssistMode(direct ?? { id: taskId });
                }
              }}
              pipelineMap={pipelineMap}
            />
            )}
            </div>

            {/* Right: inline workflow — SAME panels as Today.
                Operator Panel + (optional) Deep Report + Assistant
                mount inline alongside the lead list whenever a lead
                is selected, using the lifted parent state so the
                experience is identical across both surfaces. The
                static "No lead selected" placeholder is gone — when
                nothing is selected the right column simply doesn't
                render and the list takes the full row. */}
            <LeadWorkflowDrawer
              selectedTask={selectedTaskFromLead}
              deepReportOpen={deepReportOpen}
              onDeepReportOpen={() => setDeepReportOpen(true)}
              onDeepReportClose={() => setDeepReportOpen(false)}
              assistantCollapsed={assistantCollapsed}
              onToggleAssistant={handleToggleAssistant}
              onEnterAssistMode={handleEnterAssistMode}
              tradeLabel={selectedTaskFromLead?.tradeLabel ?? null}
              operatorPanel={selectedTaskFromLead ? (
                <SelectedLeadPanel
                  task={selectedTaskFromLead}
                  now={new Date()}
                  tradeLabel={selectedTaskFromLead?.tradeLabel ?? null}
                  onClose={() => { setSelectedKey(null); setSelectedTaskId(null); }}
                  onMutate={() => {}}
                  onOpen={() => {}}
                  callMode="idle"
                  onEnterCallMode={() => {}}
                  onExitCallMode={() => {}}
                  onRecordOutcome={() => {}}
                  callsCompletedToday={0}
                  queueRemaining={0}
                  currentNote=""
                  onChangeNote={() => {}}
                  onSwitchTab={handleSwitchTabFromStrip}
                  selectedLead={selectedLead}
                  onLeadUpdate={handleUpdate}
                  hunterAvailable={hunterAvailable}
                  onOpenDeepReport={() => setDeepReportOpen(true)}
                />
              ) : null}
            />
          </main>
        )}
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

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 24px", borderBottom: `1px solid ${palette.border}`, background: palette.surface, gap: "16px" },
  headerLeft: { display: "flex", alignItems: "center", gap: "10px" },

  tabBar: { display: "flex", alignItems: "center", gap: "4px", padding: "3px", background: palette.surfaceHover, borderRadius: "9px", border: `1px solid ${palette.border}` },
  tabBtn: { padding: "6px 14px", fontSize: "12px", fontWeight: 500, color: palette.textSecondary, background: "transparent", border: "1px solid transparent", borderRadius: "7px", cursor: "pointer", letterSpacing: "0.01em", whiteSpace: "nowrap" },
  tabBtnActive: { padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: palette.blue, background: palette.surface, border: `1px solid ${palette.blueBorder}`, borderRadius: "7px", cursor: "pointer", letterSpacing: "0.01em", whiteSpace: "nowrap", boxShadow: "0 1px 2px rgba(15,23,42,0.05)" },
  logo: { width: "28px", height: "28px", borderRadius: "7px", background: palette.blue, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700 },
  hTitle: { fontSize: "14px", fontWeight: 600 },
  hSub: { fontSize: "11px", color: palette.textTertiary },
  headerRight: { display: "flex", alignItems: "center", gap: "16px" },
  stat: { fontSize: "11px", color: palette.textTertiary },
  userName: { fontSize: "12px", color: palette.textSecondary, fontWeight: 500 },

  // SCROLL PHILOSOPHY — single page-level vertical scroll. Body uses
  // min-height (NOT height) so content extends beyond viewport and
  // the document scrolls naturally. overflowY: visible is explicit
  // so no parent ever traps vertical movement. Horizontal is hidden
  // at the body level. Operator / Deep Report / Assistant own their
  // own internal scroll for long content via max-height + overflowY:
  // auto inside the sticky drawer.
  body: { display: "flex", minHeight: "calc(100vh - 51px)", overflowX: "hidden", overflowY: "visible" },
  main: { flex: 1, minWidth: 0, overflowX: "hidden", overflowY: "visible", padding: "24px 28px" },

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
    background: palette.bluePale, color: palette.blue,
    border: `1px solid ${palette.blueBorder}`,
    height: "44px", padding: "0 20px", borderRadius: "8px",
    fontSize: "14px", fontWeight: 700, letterSpacing: "0.02em",
    cursor: "pointer", textDecoration: "none",
    display: "inline-flex", alignItems: "center",
    boxShadow: "0 2px 4px rgba(37,99,235,0.10)",
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
  btnConsoleCallGreen: { background: palette.bluePale, color: palette.blue, border: `1px solid ${palette.blueBorder}`, padding: "11px 22px", borderRadius: "8px", fontSize: "13px", fontWeight: 700, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center", boxShadow: "0 2px 4px rgba(37,99,235,0.10)", minWidth: "100px", justifyContent: "center" },
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
