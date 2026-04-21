"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { palette } from "../lib/theme";

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

// ── Lead interpretation (plain English, no em dashes) ─────────────────

function dominantReason(lead) {
  const weaknesses = lead.topWeaknesses ?? [];
  const siteDown = weaknesses.some((w) => /unreachable|down|offline/i.test(w));
  const noMobile = weaknesses.some((w) => /viewport|mobile/i.test(w));
  const noSeo = weaknesses.some((w) => /meta|SEO|title/i.test(w));
  const thin = weaknesses.some((w) => /thin|placeholder|parked|blank/i.test(w));

  if (lead.forceAction) return "Follow up is overdue. Act now before they cool.";
  if (lead.closeReadiness === "READY TO CLOSE") return "Already interested. Push to close.";
  if (siteDown) return "Website is unreachable. Every inbound lead is bouncing.";
  if (thin && noSeo) return "Site looks blank and is invisible on search.";
  if (noMobile && noSeo) return "No mobile site and no SEO foundation.";
  if (noSeo) return "No search presence. Customers cannot find them on Google.";
  if (noMobile) return "Site is not mobile friendly. Half of traffic drops off.";
  if (weaknesses.length >= 3) return "Multiple gaps in online presence.";
  if (weaknesses.length >= 1) return stripDash(weaknesses[0]);
  return "Room to strengthen online presence.";
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
  const weaknesses = lead.topWeaknesses ?? [];
  if (weaknesses.some((w) => /unreachable|down|offline/i.test(w))) return "Website is unreachable";
  if (weaknesses.some((w) => /blank|thin|placeholder|parked/i.test(w))) return "Site looks inactive online";
  if (weaknesses.some((w) => /meta|SEO|title/i.test(w))) return "Weak search presence";
  if (weaknesses.some((w) => /viewport|mobile/i.test(w))) return "Not mobile friendly";
  if (weaknesses.length >= 3) return "Multiple gaps in online presence";
  if (weaknesses.length >= 1) return "Visibility gap worth a short call";
  return "Minor improvements available";
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
  const weaknesses = (lead.topWeaknesses ?? []).join(" ").toLowerCase();
  const issue = primaryIssue(lead).toLowerCase();
  if (/unreachable|offline/.test(weaknesses + issue)) {
    return "Losing every inbound call from search";
  }
  if (/parked|domain for sale/.test(weaknesses + issue)) {
    return "Every search visitor bounces before calling";
  }
  if (/blank|thin|placeholder|inactive/.test(issue + weaknesses)) {
    return "Customers see a dead page and bounce";
  }
  if (/seo|meta|title|search/.test(issue + weaknesses)) {
    return "Customers cannot find them on Google";
  }
  if (/mobile|viewport/.test(issue + weaknesses)) {
    return "Mobile traffic drops off before calling";
  }
  if (/gbp|google business|review/.test(weaknesses)) {
    return "Low search trust for referred customers";
  }
  return "Weak trust when customers look them up";
}

// ── Proof (bullet list) ───────────────────────────────────────────────

// Translate raw inspection signals into operator-grade proof labels.
// Mapping is defensive: if nothing matches, return the stripped raw so the
// operator still sees the underlying finding.
function humanizeProof(raw) {
  const s = String(raw).toLowerCase();
  if (/unreachable|not reachable|http 5\d\d|offline/.test(s)) return "Website unreachable";
  if (/parked|domain for sale|buy this domain|coming soon|under construction/.test(s)) return "Likely parked domain";
  if (/blank|empty|almost no content|one page|single page|thin content|placeholder/.test(s)) return "No usable website content";
  if (/meta description|missing description/.test(s)) return "Missing search description";
  if (/title tag|meta title|missing title|no title/.test(s)) return "Missing search title";
  if (/h1|heading/.test(s)) return "No primary heading";
  if (/viewport|not mobile|mobile friendly/.test(s)) return "Not mobile friendly";
  if (/schema|structured data|jsonld/.test(s)) return "No business schema";
  if (/gbp|google business|google profile/.test(s)) return "No Google Business Profile signal";
  if (/review/.test(s)) return "Weak review footprint";
  if (/https|ssl|insecure/.test(s)) return "Site not secure";
  if (/slow|load time|performance/.test(s)) return "Slow site performance";
  if (/contact page|contact link|no contact/.test(s)) return "No contact page";
  if (/phone/.test(s)) return "No phone on site";
  if (/email/.test(s)) return "No email on site";
  return stripDash(raw);
}

function proofFound(lead) {
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
  if (/unreachable|blank|thin|placeholder|parked|inactive/.test(issue + weaknesses)) {
    return "Customers who check your site before calling are bouncing because of it.";
  }
  if (/gbp|google business|review|star/.test(weaknesses)) {
    return "Search trust is low, which turns warm leads into cold ones.";
  }
  if (/seo|meta|title|search/.test(issue + weaknesses)) {
    return "Search traffic in your area is going to competitors instead of you.";
  }
  if (/viewport|mobile/.test(issue + weaknesses)) {
    return "Most of your traffic is mobile, and the site is not built for it.";
  }
  return "Referred customers still check your site before calling, and this is shaking that trust.";
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
        `Left you a voicemail. Short version: ${proof}, and it is probably costing you inbound leads.`,
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
  const hasBlank = weaknesses.some((w) => /blank|thin|placeholder|parked/i.test(w));
  const hasSeo = weaknesses.some((w) => /meta|SEO|title/i.test(w));

  const problem = proofFound(lead).slice(0, 3);

  const impact = hasBlank
    ? [
        `Customers searching for a roofer in ${loc} land on a page that looks inactive.`,
        `That shakes trust before they ever call.`,
      ]
    : hasSeo
    ? [
        `If someone searches in ${loc}, you are not coming up.`,
        `Referred customers also check search before they call.`,
      ]
    : [
        `This is costing you credibility with customers who look you up.`,
        `Referred leads still check the site before they call.`,
      ];

  return {
    open: `Hi, this is ${user.name} with LaborTech Solutions. I took a look at ${lead.name} and found a couple of things that are probably costing you inbound leads. Do you have 60 seconds?`,
    ask: [
      "How are most of your jobs coming in right now?",
      "Who handles your website and Google presence today?",
      "What does a strong month look like for new jobs?",
    ],
    problem,
    impact,
    close: "Worth a 15 minute walkthrough this week so I can show you what I found and how we fix it?",
    voicemail: `Hi, ${user.name} with LaborTech. Found something on ${lead.name}'s site that is likely costing you inbound leads. Quick callback and I will walk you through it. Thanks.`,
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
  const hasBlank = (lead.topWeaknesses ?? []).some((w) => /blank|thin|placeholder|parked/i.test(w));
  const trustLine = hasBlank
    ? "If the site looks inactive, some of that trust disappears."
    : "If the site looks weak, some of that trust disappears.";
  return [
    {
      objection: "We get enough work from referrals",
      response: `That makes sense. The issue is that referred customers still look you up before they call. ${trustLine}`,
      followUp: "Have you looked at your own website recently from a customer's point of view?",
    },
    {
      objection: "We already have someone handling marketing",
      response: "Understood. This is less about marketing and more about whether the site still helps you close referred work. Quick visibility check either way.",
      followUp: "When did your team last review what shows up when customers search your company name?",
    },
    {
      objection: "Just send me an email",
      response: "Happy to. A 10 minute call is usually more useful than an email because I can show you what I found and what to fix. Your call.",
      followUp: "Does Thursday morning or Friday afternoon work better for a short call?",
    },
    {
      objection: "Not interested",
      response: "Fair enough. Before I hang up, can I ask what would have made this worth a conversation?",
      followUp: "Would a short written summary of what I found be useful to keep on file?",
    },
  ];
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

function LeadRow({ lead, index, isSelected, onSelect }) {
  const reason = dominantReason(lead);
  const sev = rowSeverity(lead);
  const accent = ROW_SEV[sev];
  const stripe = index % 2 === 1 ? "#F9FBFF" : palette.surface;
  const showLosing = sev === "critical" && lead.closeReadiness === "AT RISK";
  const ready = lead.closeReadiness === "READY TO CLOSE";

  return (
    <div
      onClick={() => onSelect(lead)}
      style={{
        ...S.row,
        background: isSelected ? palette.surfaceSelected : stripe,
        borderLeft: `4px solid ${accent}`,
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
        {showLosing && <span style={S.badgeRed}>Losing Leads</span>}
        {ready && <span style={S.badgeGreen}>Ready</span>}
        <span style={{ ...S.rowScore, color: scoreLabelColor(lead.score) }}>{lead.score}</span>
      </div>
    </div>
  );
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
  const [showFullProof, setShowFullProof] = useState(false);

  const [showLog, setShowLog] = useState(false);
  const [logNote, setLogNote] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [logStatus, setLogStatus] = useState(null);
  const [showCompose, setShowCompose] = useState(false);

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
    setLogLoading(true); setLogStatus(null);
    try {
      await callMcp("log_crm_activity", { company: ref, activityType: type, outcome, note: logNote || undefined, performedBy: user.id });
      setLogNote(""); setShowLog(false); setTimeline(null); onUpdate?.();
    } catch {
      setLogStatus("Could not log activity. Try again.");
    } finally {
      setLogLoading(false);
    }
  }

  async function loadTimeline() {
    if (timeline) { setShowTimeline(!showTimeline); return; }
    try {
      setTimeline((await callMcp("get_company_timeline", { company: ref, limit: 6 })).data?.timeline ?? []);
      setShowTimeline(true);
    } catch {
      setLogStatus("History unavailable.");
    }
  }

  const objections = defaultObjections(lead);
  const site = classifyWebsite(lead);
  const siteMeta = SITE_STATUS[site.status] ?? SITE_STATUS.unknown;
  const execState = executionState(lead, site.status);
  const sev = severity(lead, site.status);
  const srcInfo = contactSourceInfo(lead, site.status);

  const searchingFor = findTask && findTask.leadKey === lead.key && findTask.status === "running"
    ? findTask.steps[findTask.cursor]?.label ?? null
    : null;

  return (
    <div style={S.detail}>
      {/* 1. HEADER — company + location + chips + score */}
      <div style={S.heroHeader}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.headerName}>{lead.name}</div>
          <div style={S.headerMeta}>
            {lead.location && <span>{lead.location}</span>}
            <span style={{ ...S.headerChip, color: execState.color }}>{execState.text}</span>
            <span style={{ ...S.headerChip, color: siteMeta.color }}>
              {siteMeta.label}
            </span>
          </div>
        </div>
        <div style={S.headerScore}>
          <div style={{ fontSize: 13, fontWeight: 600, color: scoreLabelColor(lead.score) }}>
            {lead.score}
          </div>
          <div style={S.headerScoreLabel}>{scoreLabel(lead.score)}</div>
        </div>
      </div>

      {/* 2. DECISION CORE — severity + problem + impact + reachability */}
      <DecisionCore
        lead={lead}
        sev={sev}
        site={site}
        searchingFor={searchingFor}
        findTask={findTask}
        srcInfo={srcInfo}
        onCall={() => logOutreach("call_started", "dialed")}
        onCopyPhone={async () => {
          if (!lead.contacts?.primaryPhone) return;
          await copyText(lead.contacts.primaryPhone);
          setLogStatus("Phone copied");
          setTimeout(() => setLogStatus(null), 1600);
          logOutreach("phone_copied", null);
        }}
        onLogCall={() => setShowLog(true)}
        onLogAttempt={() => { logOutreach("call", "no_answer"); setLogStatus("Attempt logged"); setTimeout(() => setLogStatus(null), 1600); }}
        onOpenDomain={() => logOutreach("domain_opened", null)}
        onOpenPage={() => logOutreach("listing_opened", lead.fallbackRoute ?? "fallback")}
        onFindContact={() => {
          logOutreach("contact_search_started", "assistant");
          onStartFindContact?.(lead);
        }}
        onExpandSources={() => {
          logOutreach("contact_search_expanded", "assistant");
          onStartFindContact?.(lead);
        }}
      />

      {/* PROOF — minimal block above Sales Tools */}
      <div style={S.proofBlock}>
        <div style={S.proofHead}>
          <span style={S.proofLabel}>Proof</span>
          {proofFound(lead).length > 3 && (
            <button onClick={() => setShowFullProof((v) => !v)} style={S.sectionBtn}>
              {showFullProof ? "Show Less" : "View Details"}
            </button>
          )}
        </div>
        <ul style={S.proofList}>
          {(showFullProof ? proofFound(lead) : proofFound(lead).slice(0, 3)).map((p, i) => (
            <li key={i} style={S.proofItem}>{p}</li>
          ))}
        </ul>
      </div>

      {/* SALES CONSOLE — high-contrast value module */}
      <div style={S.consoleReady}>Ready to act?</div>
      <div style={S.consolePanel}>
        <div style={S.consoleHead}>
          <div style={S.consoleTitle}>Sales Console</div>
          <div style={S.consoleSubtitle}>Run the deal from here</div>
        </div>

        {/* Group 1 — Primary */}
        <div style={S.consoleGroupPrimary}>
          {lead.contacts?.primaryPhone ? (
            <a
              href={`tel:${lead.contacts.primaryPhone}`}
              onClick={() => logOutreach("call_started", "dialed")}
              style={S.btnConsoleCallGreen}
            >
              Call
            </a>
          ) : (
            <button type="button" disabled style={S.btnConsoleDisabled}>Call</button>
          )}
          {lead.contacts?.primaryEmail ? (
            <button
              type="button"
              onClick={() => { setShowCompose(true); logOutreach("email_draft_opened", null); }}
              style={S.btnConsolePrimary}
            >
              Email
            </button>
          ) : (
            <button type="button" disabled style={S.btnConsoleDisabled}>Email</button>
          )}
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            style={showLog ? S.btnConsolePrimaryActive : S.btnConsolePrimary}
          >
            {showLog ? "Cancel Log" : "Log Call"}
          </button>
        </div>

        {/* Group 2 — Deal Support */}
        <div style={S.consoleGroupSecondary}>
          <button
            type="button"
            onClick={() => setShowScript((v) => !v)}
            style={showScript ? S.btnConsoleSecondaryActive : S.btnConsoleSecondary}
          >
            {showScript ? "Hide Script" : "Open Script"}
          </button>
          <button
            type="button"
            onClick={() => setShowObjections((v) => !v)}
            style={showObjections ? S.btnConsoleSecondaryActive : S.btnConsoleSecondary}
          >
            {showObjections ? "Hide Objections" : "Handle Objections"}
          </button>
        </div>

        {/* Group 3 — Utility */}
        <div style={S.consoleGroupUtility}>
          <button
            type="button"
            onClick={loadTimeline}
            style={S.btnConsoleUtility}
          >
            {showTimeline ? "Hide History" : "History"}
          </button>
          <span style={S.consoleUtilDot}>·</span>
          <button
            type="button"
            onClick={() => { handleLog("note", null); }}
            style={S.btnConsoleUtility}
          >
            Skip
          </button>
        </div>
      </div>

      {/* Expandable content */}

      {showScript && (
        <Section label="Talk Track">
          <TalkTrackView script={script} />
          <div style={S.statusCalm}>
            {scriptSource === "ai" ? "Script ready" : "Structured script ready"}
          </div>
        </Section>
      )}

      {showObjections && (
        <Section label="Objection Handling">
          <div>
            {objections.map((o, i) => (
              <ObjectionCard key={i} objection={o} />
            ))}
          </div>
        </Section>
      )}

      {(showLog || showTimeline) && (
        <Section label="Follow Up">
          {logStatus && <div style={S.statusCalm}>{logStatus}</div>}

        {showLog && (
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
        )}

        {showTimeline && timeline && (
          <Subsection label="Contact History">
            {timeline.length === 0 ? (
              <div style={S.muted}>No outreach yet, this is a fresh lead.</div>
            ) : timeline.map((a) => (
              <div key={a.id} style={S.tlRow}>
                <span style={S.tlDate}>{new Date(a.performedAt).toLocaleDateString()}</span>
                <span style={S.tlType}>{a.activityType}{a.outcome ? ` → ${a.outcome}` : ""}</span>
                {a.note && <span style={S.tlNote}>{a.note.slice(0, 60)}</span>}
              </div>
            ))}
          </Subsection>
        )}
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
    </div>
  );
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
  lead, sev, site, searchingFor, findTask, srcInfo,
  onCall, onCopyPhone, onLogCall, onLogAttempt,
  onFindContact, onExpandSources, onOpenDomain, onOpenPage,
}) {
  const c = lead.contacts || {};
  const hasPhone = !!c.primaryPhone;
  const fallbackUrl = lead.resolvedListingUrl;
  const fallbackRoute = lead.fallbackRoute;
  const fallbackLabel = fallbackRoute === "facebook" ? "Facebook page" : fallbackRoute === "contact_page" ? "Contact page" : "Listing";
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

  return (
    <div style={{ ...S.core, borderLeft: `4px solid ${sev.color}` }}>
      <div style={S.coreCols}>
        {/* LEFT — analysis */}
        <div style={S.coreLeft}>
          <div style={{ ...S.coreSeverity, color: sev.color }}>{sev.level.toUpperCase()}</div>
          <div style={S.coreProblem}>{primaryIssue(lead)}</div>
          <div style={S.coreImpact}>{impactLine(lead)}</div>
        </div>

        {/* RIGHT — reachability */}
        <div style={S.coreRight}>
          <div style={S.coreReachLabel}>Reachability</div>

          {state === "searching" && (
            <FindContactSteps findTask={inlineTask} />
          )}

          {state === "phone" && (
            <>
              <div style={S.reachPhone}>{c.primaryPhone}</div>
              <div style={S.reachMeta}>
                <span>Source: {srcInfo.source}</span>
                <span style={S.reachDot}>·</span>
                <span style={{ color: confidenceColor(srcInfo.confidence), textTransform: "capitalize" }}>
                  {srcInfo.confidence} confidence
                </span>
              </div>
              <div style={S.coreActions}>
                <a href={`tel:${c.primaryPhone}`} onClick={onCall} style={S.btnPrimaryLg}>Call</a>
                <button type="button" onClick={onCopyPhone} style={S.btnSecondaryLg}>Copy</button>
                <button type="button" onClick={onLogCall} style={S.btnSecondaryLg}>Log Call</button>
              </div>
            </>
          )}

          {state === "fallback" && (
            <>
              <div style={S.reachNoPhone}>No direct phone found</div>
              <div style={S.reachMeta}>
                <span>Best route: {fallbackLabel}</span>
              </div>
              <div style={S.coreActions}>
                <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" onClick={onOpenPage} style={S.btnPrimaryLg}>Open Page</a>
                <button type="button" onClick={onLogAttempt} style={S.btnSecondaryLg}>Log Attempt</button>
                <button type="button" onClick={onExpandSources} style={S.btnSecondaryLg}>Expand Search</button>
              </div>
            </>
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
              {siteHref(lead) && (
                <a
                  href={siteHref(lead)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onOpenDomain}
                  style={S.btnSecondaryLg}
                >
                  Open Domain
                </a>
              )}
            </div>
          )}

          <div style={S.coreNext}>{nextStepLine(lead, searchingFor)}</div>
          {state === "idle" && site.status !== "verified_business_site" && (
            <div style={S.coreSource}>Website is weak. Pulling contact from listings.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function TalkTrackView({ script }) {
  return (
    <div>
      <Subsection label="Open">
        <div style={S.subBody}>{script.open}</div>
      </Subsection>
      <Subsection label="Ask">
        <ul style={S.subList}>
          {(script.ask ?? []).slice(0, 3).map((q, i) => <li key={i} style={S.subBullet}>{q}</li>)}
        </ul>
      </Subsection>
      <Subsection label="Problem">
        <ul style={S.subList}>
          {(script.problem ?? []).slice(0, 4).map((p, i) => <li key={i} style={S.subBullet}>{p}</li>)}
        </ul>
      </Subsection>
      <Subsection label="Impact">
        <ul style={S.subList}>
          {(script.impact ?? []).slice(0, 3).map((p, i) => <li key={i} style={S.subBullet}>{p}</li>)}
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
      <div style={S.objResponseLabel}>Response</div>
      <div style={S.objResponse}>{objection.response}</div>
      <div style={S.objFollowLabel}>Follow up</div>
      <div style={S.objFollow}>{objection.followUp}</div>
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

function ListSection({ title, leads, selectedKey, onSelect, user, onUpdate, findTask, onStartFindContact }) {
  if (!leads || leads.length === 0) return null;
  return (
    <div style={S.section}>
      <div style={S.sectionHead}>
        <span style={S.sectionTitle}>{title}</span>
        <span style={S.sectionCount}>{leads.length}</span>
      </div>
      {leads.map((lead, i) => (
        <div key={lead.key}>
          <LeadRow lead={lead} index={i} isSelected={selectedKey === lead.key} onSelect={onSelect} />
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
  const hasContact = !!(c.primaryPhone || c.primaryEmail);
  const inlineTask = findTask && findTask.leadKey === lead.key ? findTask : null;
  const running = inlineTask && inlineTask.status === "running";
  const done = inlineTask && inlineTask.status === "done";
  const site = classifyWebsite(lead);
  const src = contactSourceInfo(lead, site.status);

  let status = "Not started";
  let statusColor = palette.textSecondary;
  if (running) { status = "Running"; statusColor = palette.blue; }
  else if (hasContact) { status = "Contact found"; statusColor = palette.success; }
  else if (done) { status = "Empty"; statusColor = palette.textTertiary; }

  return (
    <div style={S.opSection}>
      <div style={S.opHead}>
        <span style={S.opTitle}>Contact Search</span>
        <span style={{ ...S.opStatus, color: statusColor }}>{status}</span>
      </div>
      <div style={S.opBody}>
        <div style={S.opRow}><span style={S.opLabel}>Source</span><span style={S.opValue}>{src.source}</span></div>
        <div style={S.opRow}>
          <span style={S.opLabel}>Confidence</span>
          <span style={{ ...S.opValue, color: confidenceColor(src.confidence), textTransform: "capitalize" }}>
            {src.confidence}
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

function QuickActionsSection({ lead, onCall, onEmail, onLog }) {
  const c = lead.contacts || {};
  const hasPhone = !!c.primaryPhone;
  const hasEmail = !!c.primaryEmail;
  return (
    <div style={S.opSection}>
      <div style={S.opHead}>
        <span style={S.opTitle}>Quick Actions</span>
      </div>
      <div style={S.opActions}>
        {hasPhone ? (
          <a href={`tel:${c.primaryPhone}`} onClick={onCall} style={S.btnTierPrimary}>Call</a>
        ) : (
          <button type="button" disabled style={S.btnTierPrimaryDisabled}>Call</button>
        )}
        {hasEmail ? (
          <a href={mailtoUrl(c.primaryEmail, `${lead.name}, quick note`, "")} onClick={onEmail} style={S.btnTierPrimary}>Email</a>
        ) : (
          <button type="button" disabled style={S.btnTierPrimaryDisabled}>Email</button>
        )}
        <button type="button" onClick={onLog} style={S.btnTierSecondary}>Log Attempt</button>
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
    response: "Referred customers still check your site before calling. That trust takes a hit when the site looks weak.",
  };
  const proof = proofFound(lead);
  const problemText = proof[0]
    ? `${primaryIssue(lead)}. ${proof[0]}.`
    : `${primaryIssue(lead)}.`;

  return {
    open: "How are most of your jobs coming in right now?",
    problem: problemText,
    impact: impactLine(lead),
    objection: top.objection,
    response: top.response,
    close: "Worth 15 minutes this week so I can show you what I found and how we fix it?",
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
            <QuickActionsSection
              lead={selectedLead}
              onCall={() => recordAssistantAction(selectedLead.key, "Call started", "assistant")}
              onEmail={() => recordAssistantAction(selectedLead.key, "Email opened in client", "assistant")}
              onLog={logAttempt}
            />
            {logFlash && <div style={S.statusCalm}>{logFlash}</div>}
            <CallPlanSection lead={selectedLead} />
          </>
        )}
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

      <div style={S.body} key={refreshKey}>
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
                return <ListSection title="Today's Plan, Action Required" leads={withOverlays(todayPlan)} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />;
              })()}

              <ListSection title="Top Priority" leads={withOverlays(highPriFilter(callTheseFirst.filter((l) => !l.forceAction)))} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />
              <ListSection title="Strong Opportunities" leads={withOverlays(highPriFilter(todayList))} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />
              {!filterHighPriority && <ListSection title="This Week" leads={withOverlays(remaining)} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />}
              {!filterHighPriority && rest.length > 0 && <ListSection title="Pipeline" leads={withOverlays(rest)} selectedKey={selectedKey} onSelect={handleSelect} user={user} onUpdate={handleUpdate} findTask={findTask} onStartFindContact={startFindContact} />}
            </>
          )}
        </main>
        <AiPanel selectedLead={selectedLead} findTask={findTask} onStartFindContact={startFindContact} />
      </div>
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

  section: { marginBottom: "24px" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", padding: "0 12px" },
  sectionTitle: { fontSize: "13px", fontWeight: 600, color: palette.textSecondary },
  sectionCount: { fontSize: "12px", color: palette.textTertiary },

  // Row
  row: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "8px", cursor: "pointer", transition: "background 0.12s", borderLeft: "3px solid transparent" },
  rowRank: { fontSize: "12px", color: palette.textTertiary, width: "20px", textAlign: "right", flexShrink: 0 },
  rowLeft: { flex: 1, minWidth: 0 },
  rowNameLine: { display: "flex", alignItems: "baseline", gap: "6px" },
  rowName: { fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowLoc: { fontSize: "12px", color: palette.textTertiary, whiteSpace: "nowrap", flexShrink: 0 },
  rowReason: { fontSize: "12px", color: palette.textSecondary, marginTop: "2px", lineHeight: 1.3 },
  rowRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0, minWidth: "80px" },
  rowScore: { fontSize: "13px", fontWeight: 600 },
  rowSelected: { boxShadow: "0 2px 6px rgba(15,23,42,0.08)", transform: "translateY(-0.5px)" },
  badgeGreen: { fontSize: "9px", fontWeight: 600, color: palette.success, background: palette.successBg, padding: "2px 8px", borderRadius: "4px" },
  badgeRed: { fontSize: "9px", fontWeight: 600, color: palette.danger, background: palette.dangerBg, padding: "2px 8px", borderRadius: "4px" },

  // Detail frame
  detail: { margin: "2px 0 12px 33px", padding: "16px 18px", background: palette.surface, borderRadius: "12px", border: `1px solid ${palette.border}`, boxShadow: palette.shadow, display: "flex", flexDirection: "column", gap: "12px" },

  // Hero header (flat, not wrapped in Section)
  heroHeader: { display: "flex", gap: "12px", alignItems: "flex-start", paddingBottom: "2px" },

  // Decision Core — tinted panel with severity left accent.
  // Inside, Reachability lives in a nested white box so it does not visually
  // compete with the dominant problem on the left.
  core: { borderRadius: "10px", padding: "18px 20px", background: "#F9FAFB", border: `1px solid ${palette.borderLight}` },
  coreCols: { display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: "20px", alignItems: "stretch" },
  coreLeft: { display: "flex", flexDirection: "column", minWidth: 0, paddingRight: "4px" },
  coreRight: { display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, background: palette.surface, borderRadius: "8px", border: `1px solid ${palette.borderLight}`, padding: "12px 14px" },
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
  consoleReady: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.04em", color: palette.textSecondary, textTransform: "uppercase", paddingTop: "4px", paddingBottom: "2px", borderTop: `1px solid ${palette.borderLight}`, marginTop: "2px" },
  consolePanel: { background: "#F1F5F9", border: `1px solid #CBD5E1`, borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" },
  consoleHead: { display: "flex", flexDirection: "column", gap: "2px" },
  consoleTitle: { fontSize: "15px", fontWeight: 600, color: palette.textPrimary, letterSpacing: "0.01em" },
  consoleSubtitle: { fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45 },

  consoleGroupPrimary: { display: "flex", gap: "10px", flexWrap: "wrap" },
  consoleGroupSecondary: { display: "flex", gap: "10px", flexWrap: "wrap" },
  consoleGroupUtility: { display: "flex", gap: "8px", alignItems: "baseline", paddingTop: "4px" },
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

  // Proof preview block (low visual weight)
  proofBlock: { padding: "0" },
  proofHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" },
  proofLabel: { fontSize: "10px", fontWeight: 500, letterSpacing: "0.04em", color: palette.textTertiary },

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
  objCard: { border: `1px solid ${palette.borderLight}`, borderRadius: "6px", padding: "10px 12px", marginBottom: "8px", background: palette.surface },
  objTitle: { fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textPrimary, marginBottom: "6px" },
  objResponseLabel: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "2px" },
  objResponse: { fontSize: "13px", lineHeight: 1.5, color: palette.textPrimary, marginBottom: "8px" },
  objFollowLabel: { fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: palette.textTertiary, marginBottom: "2px" },
  objFollow: { fontSize: "13px", lineHeight: 1.5, color: palette.blue, fontWeight: 500 },

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
