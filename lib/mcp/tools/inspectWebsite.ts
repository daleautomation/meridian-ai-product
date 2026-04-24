// Meridian AI — inspect_website tool.
//
// Purpose: perform a real, honest first-pass audit of a company's website.
// Fetches the URL server-side and extracts structural signals that
// correlate with revenue leaks (no mobile viewport, missing meta, slow
// response, no HTTPS, stale-looking markup). Returns evidence + confidence.
//
// This is real data, not a stub. Confidence reflects how much the site
// gave us to work with (HTTP status, HTML size, parseability).

import type { CompanyRef, ToolDefinition, ToolResult, Evidence } from "@/lib/mcp/types";
import { labelFromConfidence, normalizeDomain, nowIso } from "@/lib/mcp/types";

export type InspectWebsiteInput = {
  company: CompanyRef;
};

// One observed email from the site, with the method we used to find it.
// `page` is the URL we extracted it from (homepage or subpath). Consumed
// by the resolver to pick a primary + alternates with full provenance.
export type SiteEmailMethod =
  | "website_mailto"        // <a href="mailto:...">
  | "website_visible"       // plain text in rendered HTML
  | "website_schema"        // JSON-LD / schema.org contactPoint.email
  | "website_obfuscated";   // name [at] domain, &#64;, etc.

export type SiteEmailHit = {
  email: string;
  method: SiteEmailMethod;
  page: string;             // absolute URL where we found it
};

// Deterministic classification of the site's overall state.
export type SiteClassification =
  | "site_unreachable"
  | "site_blank"
  | "seo_missing"
  | "conversion_missing"
  | "partial_content"
  | "healthy_site";

// Machine-readable code for a specific, observable issue on this site.
// Unlike the legacy `weaknesses[]` strings, each issue carries a site-
// specific description (includes byte counts, response times, titles, etc.)
// plus a short impact statement.
export type SiteIssueCode =
  | "site_unreachable"
  | "http_5xx"
  | "http_4xx"
  | "slow_response"
  | "blank_body"
  | "thin_content"
  | "title_missing"
  | "title_weak"
  | "meta_missing"
  | "no_headings"
  | "no_mobile_viewport"
  | "no_https"
  | "no_opengraph"
  | "no_contact_path"
  | "no_contact_form"
  | "no_phone_on_site"
  | "no_email_on_site";

export type SiteIssue = {
  code: SiteIssueCode;
  description: string;                   // site-specific, includes observed values
  impact: string;                         // "why this matters" one-liner
  severity: "high" | "medium" | "low";
};

export type WebsiteSignals = {
  reachable: boolean;
  httpStatus: number | null;
  https: boolean;
  finalUrl: string | null;
  responseMs: number | null;
  title: string | null;
  metaDescription: string | null;
  hasViewport: boolean;        // mobile viewport meta
  hasOpenGraph: boolean;
  scriptCount: number;
  imageCount: number;
  linkCount: number;
  contentBytes: number;
  weaknesses: string[];         // human-readable revenue-leak signals (legacy)

  // ── Proof layer (factual, from live check) ──────────────────────────
  homepage_fetch_ok: boolean;            // 2xx response + parsable body
  has_title: boolean;                    // <title> present
  has_meta_description: boolean;         // meta description present
  has_contact_form: boolean;             // <form> with contact/submit semantics
  phone_from_site: string | null;        // phone extracted from homepage (primary)
  email_from_site: string | null;        // email extracted from homepage (primary)
  // All emails observed across homepage + subpages, deduped. Each entry
  // carries the method it came from so the resolver can weight them.
  emails_from_site: SiteEmailHit[];
  page_speed_mobile: number | null;      // optional — reserved for PageSpeed provider
  last_checked: string;                  // ISO of this scan
  // ── Extended observable signals (site-specific) ──
  visible_text_length: number;           // characters of visible text after tag strip
  heading_count: number;                 // count of h1-h6 tags
  form_field_count: number;              // count of input/textarea/select tags
  // ── Structured issues + overall classification ──
  issues: SiteIssue[];
  site_classification: SiteClassification;
};

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string): Promise<{ res: Response; ms: number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "MeridianAI-Inspector/1.0 (+decision-platform)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    return { res, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

function extract(html: string): Pick<
  WebsiteSignals,
  "title" | "metaDescription" | "hasViewport" | "hasOpenGraph" | "scriptCount" | "imageCount" | "linkCount"
> {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
  );
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const og = /<meta[^>]+property=["']og:/i.test(html);
  const scriptCount = (html.match(/<script\b/gi) ?? []).length;
  const imageCount = (html.match(/<img\b/gi) ?? []).length;
  const linkCount = (html.match(/<a\b/gi) ?? []).length;
  return {
    title: titleMatch ? titleMatch[1].trim().slice(0, 240) : null,
    metaDescription: descMatch ? descMatch[1].trim().slice(0, 320) : null,
    hasViewport: viewport,
    hasOpenGraph: og,
    scriptCount,
    imageCount,
    linkCount,
  };
}

// ── Proof extraction ────────────────────────────────────────────────
// These parse the raw HTML response for contact artifacts. Never asserts
// intent beyond presence. Returns nulls when nothing verifiable is found.

const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?([2-9][0-8][0-9])\)?[\s.\-]?([2-9][0-9]{2})[\s.\-]?([0-9]{4})/g;
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const ASSET_EMAIL_RE = /\.(png|jpe?g|webp|gif|svg|ico|css|js)(?:\?|$)/i;

function extractPhone(html: string): string | null {
  PHONE_RE.lastIndex = 0;
  const seen = new Set<string>();
  let best: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = PHONE_RE.exec(html)) !== null) {
    const raw = `${match[1]}${match[2]}${match[3]}`;
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (/^(?:800|888|877|866|855|844|833|822)/.test(raw)) {
      if (!best) best = `(${match[1]}) ${match[2]}-${match[3]}`;
      continue;
    }
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }
  return best;
}

function extractEmail(html: string, domain: string | null): string | null {
  const matches = html.match(EMAIL_RE) ?? [];
  const normalized = matches
    .map((m) => m.toLowerCase())
    .filter((m) => !ASSET_EMAIL_RE.test(m))
    .filter((m) => !m.startsWith("wordpress@") && !m.endsWith("@sentry.io") && !m.endsWith("@example.com"));
  if (normalized.length === 0) return null;
  if (domain) {
    const onDomain = normalized.find((m) => m.endsWith(`@${domain}`));
    if (onDomain) return onDomain;
  }
  const nonGeneric = normalized.find((m) => !/^(noreply|no-reply|donotreply|mailer|bounce)@/.test(m));
  return nonGeneric ?? normalized[0];
}

// Junk-email guard shared across all extractors.
const JUNK_EMAIL_PATTERNS = [
  /@example\.(com|org|net)$/i,
  /@sentry\.io$/i,
  /^wordpress@/i,
  /@domain\.com$/i,
  /@yourdomain\.com$/i,
  /^your\.?name@/i,
  /^someone@/i,
  /^user@/i,
  /@placeholder\./i,
];

function isJunkEmail(email: string): boolean {
  const lc = email.toLowerCase();
  if (ASSET_EMAIL_RE.test(lc)) return true;
  return JUNK_EMAIL_PATTERNS.some((re) => re.test(lc));
}

function normalizeEmail(raw: string): string {
  return String(raw).trim().toLowerCase();
}

// Decodes common obfuscation patterns so the normal EMAIL_RE can match
// them. Covers:
//   - "name [at] domain [dot] com" / "name(at)domain(dot)com"
//   - " @ " style with spaces
//   - HTML numeric entities (&#64; = @, &#46; = .)
//   - HTML named entities (&commat; = @)
function decodeObfuscation(html: string): string {
  let out = html;
  // HTML numeric entities
  out = out.replace(/&#(\d+);/g, (_, code) => {
    const n = parseInt(code, 10);
    if (n === 64) return "@";
    if (n === 46) return ".";
    return "";
  });
  // HTML hex entities for @ and .
  out = out.replace(/&#x40;/gi, "@").replace(/&#x2e;/gi, ".");
  // HTML named entity
  out = out.replace(/&commat;/gi, "@").replace(/&period;/gi, ".");
  // Textual obfuscation — bracketed / parenthesized "at" and "dot"
  out = out.replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@");
  out = out.replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  // Spaced " @ " / " . " used around emails — only collapse when flanked
  // by word chars on both sides to avoid eating whitespace generally.
  out = out.replace(/(\w)\s+@\s+(\w)/g, "$1@$2");
  out = out.replace(/(\w)\s+\.\s+(\w{2,})/g, "$1.$2");
  return out;
}

// Extract mailto: emails — strongest evidence (they exist as real links).
function extractMailtoEmails(html: string): string[] {
  const re = /<a\b[^>]*href=["']mailto:([^"'?#]+)/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const email = normalizeEmail(m[1]);
    if (email && !isJunkEmail(email) && EMAIL_RE.test(email)) {
      EMAIL_RE.lastIndex = 0;
      out.push(email);
    }
  }
  return out;
}

// Extract schema.org / JSON-LD contactPoint.email — structured-data signal.
function extractSchemaEmails(html: string): string[] {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const out: string[] = [];
  for (const block of blocks) {
    const bodyMatch = block.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const body = bodyMatch?.[1] ?? "";
    // Brute-scan the JSON blob for emails; the schema parser would be
    // overkill here and brittle on malformed JSON.
    EMAIL_RE.lastIndex = 0;
    const found = body.match(EMAIL_RE) ?? [];
    for (const e of found) {
      const email = normalizeEmail(e);
      if (!isJunkEmail(email)) out.push(email);
    }
  }
  return out;
}

// Extract visible (text) emails — everything EMAIL_RE finds in the HTML
// that is NOT already a mailto:. This is the fallback bucket.
function extractVisibleEmails(html: string, mailtos: Set<string>): string[] {
  EMAIL_RE.lastIndex = 0;
  const matches = html.match(EMAIL_RE) ?? [];
  const out: string[] = [];
  for (const m of matches) {
    const email = normalizeEmail(m);
    if (isJunkEmail(email)) continue;
    if (mailtos.has(email)) continue;
    out.push(email);
  }
  return out;
}

// Aggregate all methods on a single page into a deduped hit list.
function collectEmailHitsForPage(html: string, pageUrl: string): SiteEmailHit[] {
  const decoded = decodeObfuscation(html);
  const mailtos = extractMailtoEmails(html);
  const mailtoSet = new Set(mailtos);
  const schemaList = extractSchemaEmails(html);
  const visibleList = extractVisibleEmails(decoded, mailtoSet);
  // The decoded pass may expose emails that weren't in raw html (e.g.
  // "foo [at] bar.com"). Tag those as obfuscated when they aren't already
  // present as mailtos/schema/visible-on-raw.
  EMAIL_RE.lastIndex = 0;
  const rawVisible = new Set(
    (html.match(EMAIL_RE) ?? []).map((e) => normalizeEmail(e))
  );
  const obfuscatedList = visibleList.filter((e) => !rawVisible.has(e));

  const seen = new Set<string>();
  const hits: SiteEmailHit[] = [];
  const push = (emails: string[], method: SiteEmailMethod) => {
    for (const e of emails) {
      if (seen.has(e)) continue;
      seen.add(e);
      hits.push({ email: e, method, page: pageUrl });
    }
  };
  push(mailtos, "website_mailto");
  push(schemaList, "website_schema");
  push(obfuscatedList, "website_obfuscated");
  push(visibleList.filter((e) => !obfuscatedList.includes(e)), "website_visible");
  return hits;
}

// Strip scripts/styles/comments/tags to approximate the text a human
// visitor would see. Cheap and deterministic — no DOM, no headless browser.
function extractVisibleText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function countMatches(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}

// Build a site-specific issue list from observed values. Descriptions
// include the actual numbers / tags we saw so no two sites read identical.
function buildSiteIssues(d: {
  reachable: boolean;
  httpStatus: number | null;
  responseMs: number | null;
  https: boolean;
  title: string | null;
  metaDescription: string | null;
  hasViewport: boolean;
  hasOpenGraph: boolean;
  contentBytes: number;
  visibleTextLength: number;
  headingCount: number;
  hasContactForm: boolean;
  phoneFromSite: string | null;
  emailFromSite: string | null;
  hostname: string | null;
}): SiteIssue[] {
  const out: SiteIssue[] = [];

  // Reachability — always the top issue when present.
  if (!d.reachable) {
    if (d.httpStatus && d.httpStatus >= 500) {
      out.push({
        code: "http_5xx",
        description: `Homepage returned HTTP ${d.httpStatus}${d.responseMs != null ? ` after ${d.responseMs}ms` : ""}.`,
        impact: "Every search visitor hits a server error and bounces.",
        severity: "high",
      });
    } else if (d.httpStatus && d.httpStatus >= 400) {
      out.push({
        code: "http_4xx",
        description: `Homepage returned HTTP ${d.httpStatus}.`,
        impact: "Search traffic lands on a missing-page error.",
        severity: "high",
      });
    } else {
      out.push({
        code: "site_unreachable",
        description: d.hostname
          ? `Homepage at ${d.hostname} did not respond.`
          : "Homepage did not respond to fetch.",
        impact: "Business is invisible to anyone who searches and clicks.",
        severity: "high",
      });
    }
    return out; // no further analysis — nothing loaded
  }

  // Content-level issues.
  if (d.visibleTextLength < 200) {
    out.push({
      code: "blank_body",
      description: `Homepage returned ${d.contentBytes.toLocaleString()} bytes of HTML but only ${d.visibleTextLength} characters of visible text.`,
      impact: "Customers land on a blank page and leave immediately.",
      severity: "high",
    });
  } else if (d.visibleTextLength < 800 || d.contentBytes < 3000) {
    out.push({
      code: "thin_content",
      description: `Only ${d.visibleTextLength.toLocaleString()} characters of visible text in ${d.contentBytes.toLocaleString()} bytes of HTML.`,
      impact: "Search engines cannot understand what the business offers.",
      severity: "medium",
    });
  }

  // SEO / page structure.
  if (!d.title) {
    out.push({
      code: "title_missing",
      description: "No <title> tag found in the homepage HTML.",
      impact: "Search engines show the raw URL instead of the business name in results.",
      severity: "high",
    });
  } else if (d.title.length < 10) {
    out.push({
      code: "title_weak",
      description: `Homepage <title> is only "${d.title}" (${d.title.length} chars).`,
      impact: "Title too short to differentiate in search results.",
      severity: "medium",
    });
  }

  if (!d.metaDescription) {
    out.push({
      code: "meta_missing",
      description: "No <meta name=\"description\"> tag found in the homepage HTML.",
      impact: "Search engines fall back to random page snippets; click-through rates drop.",
      severity: "medium",
    });
  }

  if (d.headingCount === 0) {
    out.push({
      code: "no_headings",
      description: "No heading tags (h1–h6) detected on the homepage.",
      impact: "Search crawlers cannot identify what each section of the page is about.",
      severity: "medium",
    });
  }

  // Conversion path.
  const noDirectReach = !d.hasContactForm && !d.phoneFromSite && !d.emailFromSite;
  if (noDirectReach) {
    out.push({
      code: "no_contact_path",
      description: "No contact form, phone number, or email detected on the homepage.",
      impact: "Visitors have no clear way to contact the business.",
      severity: "high",
    });
  } else {
    if (!d.hasContactForm) {
      out.push({
        code: "no_contact_form",
        description: "No contact / quote / estimate form detected on the homepage.",
        impact: "Prospects cannot submit a lead without making a phone call.",
        severity: "medium",
      });
    }
    if (!d.phoneFromSite) {
      out.push({
        code: "no_phone_on_site",
        description: "No phone number found in the homepage HTML.",
        impact: "Callers must search elsewhere to reach the business.",
        severity: "medium",
      });
    }
    if (!d.emailFromSite) {
      out.push({
        code: "no_email_on_site",
        description: "No email address found in the homepage HTML.",
        impact: "No direct email outreach path from the site itself.",
        severity: "low",
      });
    }
  }

  // Mobile / security / performance / social.
  if (!d.hasViewport) {
    out.push({
      code: "no_mobile_viewport",
      description: "No <meta name=\"viewport\"> declaration — site does not declare mobile rendering.",
      impact: "Mobile visitors get a zoomed-out desktop layout.",
      severity: "medium",
    });
  }
  if (!d.https) {
    out.push({
      code: "no_https",
      description: "Homepage served over HTTP, not HTTPS.",
      impact: "Browsers flag the site as insecure; conversions drop.",
      severity: "medium",
    });
  }
  if (d.responseMs != null && d.responseMs > 4000) {
    out.push({
      code: "slow_response",
      description: `Homepage took ${d.responseMs}ms to respond.`,
      impact: "Slow sites lose a large share of mobile visitors before the page renders.",
      severity: "medium",
    });
  }
  if (!d.hasOpenGraph) {
    out.push({
      code: "no_opengraph",
      description: "No OpenGraph tags — link previews on Facebook/LinkedIn show no image or description.",
      impact: "Social shares look broken and don't drive clicks.",
      severity: "low",
    });
  }

  return out;
}

function classifySite(d: {
  reachable: boolean;
  visibleTextLength: number;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  hasContactForm: boolean;
  hasPhoneOrEmail: boolean;
  issueCount: number;
}): SiteClassification {
  if (!d.reachable) return "site_unreachable";
  if (d.visibleTextLength < 200) return "site_blank";
  const seoBad = !d.hasTitle && !d.hasMetaDescription;
  const convBad = !d.hasContactForm && !d.hasPhoneOrEmail;
  if (seoBad && convBad) return "partial_content";
  if (seoBad) return "seo_missing";
  if (convBad) return "conversion_missing";
  if (d.issueCount === 0) return "healthy_site";
  return "partial_content";
}

const METHOD_RANK: Record<SiteEmailMethod, number> = {
  website_mailto: 0,
  website_schema: 1,
  website_visible: 2,
  website_obfuscated: 3,
};

const GENERIC_LOCALPARTS = new Set([
  "info", "contact", "office", "sales", "hello", "support", "admin",
  "service", "team", "help", "inquiries", "inquiry", "customer",
]);

// Deterministic primary-email selection from all observed site hits.
// Rules:
//   1) Prefer a hit on the company's own domain.
//   2) Prefer the strongest method (mailto > schema > visible > obfuscated).
//   3) Prefer non-generic (jane@…) over generic (info@, sales@) when
//      methods tie — only if the non-generic is on the company domain.
//   4) Otherwise return the best ranked hit, leaving generic inboxes
//      selectable so operators still see SOMETHING usable.
function pickPrimaryEmail(hits: SiteEmailHit[], domain: string | null): string | null {
  if (hits.length === 0) return null;
  const scored = hits.map((h) => {
    const local = h.email.split("@")[0] ?? "";
    const emailDomain = (h.email.split("@")[1] ?? "").toLowerCase();
    const isCompanyDomain = !!domain && emailDomain === domain.toLowerCase();
    const isGeneric = GENERIC_LOCALPARTS.has(local);
    // Lower score = preferred. Weights: domain first (×100), then method
    // (×10), then generic-ness (+1 when generic, +0 when personal).
    const score = (isCompanyDomain ? 0 : 100)
      + (METHOD_RANK[h.method] ?? 9) * 10
      + (isGeneric && isCompanyDomain ? 1 : 0);
    return { hit: h, score };
  }).sort((a, b) => a.score - b.score);
  return scored[0].hit.email;
}

function detectContactForm(html: string): boolean {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  for (const f of forms) {
    const hay = f.toLowerCase();
    if (/(action|id|name|class)=["'][^"']*(contact|quote|estimate|inquir|message|lead|reach)[^"']*["']/i.test(f)) return true;
    if (/type=["']email["']/i.test(f) && /type=["'](?:tel|text)["']/i.test(f)) return true;
    if (/<textarea\b/i.test(hay) && /type=["']email["']/i.test(f)) return true;
  }
  return false;
}

async function handler(input: InspectWebsiteInput): Promise<ToolResult<WebsiteSignals>> {
  const { company } = input;
  const timestamp = nowIso();
  const evidence: Evidence[] = [];
  const weaknesses: string[] = [];

  const candidate = company.url ?? company.domain ?? company.name;
  const domain = normalizeDomain(candidate);
  const target =
    company.url && /^https?:\/\//i.test(company.url)
      ? company.url
      : domain
      ? `https://${domain}`
      : null;

  if (!target) {
    return {
      tool: "inspect_website",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: {
        reachable: false,
        httpStatus: null,
        https: false,
        finalUrl: null,
        responseMs: null,
        title: null,
        metaDescription: null,
        hasViewport: false,
        hasOpenGraph: false,
        scriptCount: 0,
        imageCount: 0,
        linkCount: 0,
        contentBytes: 0,
        weaknesses: ["no resolvable domain or URL provided"],
        homepage_fetch_ok: false,
        has_title: false,
        has_meta_description: false,
        has_contact_form: false,
        phone_from_site: null,
        email_from_site: null,
        emails_from_site: [],
        page_speed_mobile: null,
        last_checked: timestamp,
        visible_text_length: 0,
        heading_count: 0,
        form_field_count: 0,
        issues: [{
          code: "site_unreachable",
          description: "No resolvable domain or URL provided — site could not be inspected.",
          impact: "Business has no verifiable web presence to check.",
          severity: "high",
        }],
        site_classification: "site_unreachable",
      },
      stub: false,
      error: "missing_url",
    };
  }

  try {
    const { res, ms } = await fetchWithTimeout(target);
    const text = await res.text();
    const extracted = extract(text);
    const https = (res.url || target).startsWith("https://");

    evidence.push({
      kind: "http_status",
      source: target,
      observedAt: timestamp,
      detail: `HTTP ${res.status} in ${ms}ms (${text.length} bytes)`,
    });

    if (!https) weaknesses.push("no HTTPS");
    if (!extracted.hasViewport) weaknesses.push("no mobile viewport meta — likely not mobile-optimized");
    if (!extracted.metaDescription) weaknesses.push("missing meta description — weak SEO");
    if (!extracted.hasOpenGraph) weaknesses.push("no OpenGraph tags — weak link previews");
    if (!extracted.title) weaknesses.push("missing <title> — weak SEO");
    if (ms > 4000) weaknesses.push(`slow first byte (${ms}ms)`);
    if (extracted.imageCount === 0 && text.length < 8000) {
      weaknesses.push("very thin content — possible parked or placeholder page");
    }

    if (extracted.metaDescription) {
      evidence.push({
        kind: "html_meta",
        source: target,
        observedAt: timestamp,
        detail: `meta description: "${extracted.metaDescription.slice(0, 120)}"`,
      });
    }
    if (extracted.title) {
      evidence.push({
        kind: "html_meta",
        source: target,
        observedAt: timestamp,
        detail: `title: "${extracted.title.slice(0, 120)}"`,
      });
    }

    // Confidence: high when we got 200 + parseable HTML; drops if redirected
    // far, small body, or non-2xx.
    let confidence = 50;
    if (res.ok) confidence += 30;
    if (text.length > 5000) confidence += 10;
    if (extracted.title || extracted.metaDescription) confidence += 10;
    if (res.status >= 400) confidence = Math.min(confidence, 30);
    confidence = Math.max(0, Math.min(100, confidence));

    let phoneFromSite = extractPhone(text);
    let hasContactForm = detectContactForm(text);

    // Collect email hits with full method attribution across all pages.
    const hitsByEmail = new Map<string, SiteEmailHit>();
    const pushHits = (hits: SiteEmailHit[]) => {
      for (const h of hits) if (!hitsByEmail.has(h.email)) hitsByEmail.set(h.email, h);
    };
    const homepageUrl = res.url || target;
    pushHits(collectEmailHitsForPage(text, homepageUrl));

    // Subpage fallback — probe roofing conversion + team/staff pages when
    // the homepage missed phone/email/form. Bounded (stops early once we
    // have a phone, at least one email hit, and a form). Never runs on
    // unreachable sites.
    if (res.ok && (!phoneFromSite || hitsByEmail.size === 0 || !hasContactForm)) {
      const base = new URL(res.url || target);
      const subpaths = [
        // Conversion-intent pages first (most likely to expose a phone/email)
        "/contact",
        "/contact-us",
        "/quote",
        "/estimate",
        "/request-quote",
        // About / people — often carries team emails
        "/about",
        "/team",
        "/staff",
        "/locations",
        // Service pages — roofing-specific, common in KC market
        "/services",
        "/roofing",
        "/residential-roofing",
        "/commercial-roofing",
      ];
      for (const sub of subpaths) {
        if (phoneFromSite && hasContactForm && hitsByEmail.size >= 4) break;
        const subUrl = new URL(sub, base).toString();
        try {
          const { res: subRes } = await fetchWithTimeout(subUrl);
          if (!subRes.ok) continue;
          const subText = await subRes.text();
          const preHadPhone = !!phoneFromSite;
          const preEmailCount = hitsByEmail.size;
          const preHadForm = hasContactForm;
          if (!phoneFromSite) phoneFromSite = extractPhone(subText);
          pushHits(collectEmailHitsForPage(subText, subUrl));
          if (!hasContactForm) hasContactForm = detectContactForm(subText);
          const gainedEmails = hitsByEmail.size - preEmailCount;
          const gained = [
            !preHadPhone && phoneFromSite ? "phone" : null,
            gainedEmails > 0 ? `email(${gainedEmails})` : null,
            !preHadForm && hasContactForm ? "form" : null,
          ].filter(Boolean).join(",");
          if (gained) {
            evidence.push({
              kind: "html_contact",
              source: subUrl,
              observedAt: timestamp,
              detail: `subpage ${sub} found: ${gained}`,
            });
          }
        } catch {
          // Ignore subpage failures — homepage signals remain authoritative.
        }
      }
    }

    // Pick the primary email for the legacy single-value field. Priority:
    //   1) company-domain mailto > schema > visible > obfuscated
    //   2) non-generic (e.g. jane@…) over generic (info@, sales@)
    //   3) any remaining valid email
    const emailsFromSite: SiteEmailHit[] = Array.from(hitsByEmail.values());
    const emailFromSite: string | null = pickPrimaryEmail(emailsFromSite, domain ?? null);

    if (phoneFromSite) {
      evidence.push({
        kind: "html_contact",
        source: target,
        observedAt: timestamp,
        detail: `phone on site: ${phoneFromSite}`,
      });
    }
    if (emailFromSite) {
      evidence.push({
        kind: "html_contact",
        source: target,
        observedAt: timestamp,
        detail: `email on site: ${emailFromSite} (${emailsFromSite.length} total, methods: ${
          Array.from(new Set(emailsFromSite.map((h) => h.method))).join(", ")
        })`,
      });
    }
    if (hasContactForm) {
      evidence.push({
        kind: "html_contact",
        source: target,
        observedAt: timestamp,
        detail: "contact form detected on site",
      });
    }

    // Site-specific observations for the issue list.
    const visibleText = extractVisibleText(text);
    const visibleTextLength = visibleText.length;
    const headingCount = countMatches(text, /<h[1-6]\b/gi);
    const formFieldCount = countMatches(text, /<(input|textarea|select)\b/gi);
    const hostname = (() => {
      try { return new URL(res.url || target).hostname; } catch { return null; }
    })();

    const issues = buildSiteIssues({
      reachable: res.ok,
      httpStatus: res.status,
      responseMs: ms,
      https,
      title: extracted.title,
      metaDescription: extracted.metaDescription,
      hasViewport: extracted.hasViewport,
      hasOpenGraph: extracted.hasOpenGraph,
      contentBytes: text.length,
      visibleTextLength,
      headingCount,
      hasContactForm,
      phoneFromSite,
      emailFromSite,
      hostname,
    });

    const site_classification = classifySite({
      reachable: res.ok,
      visibleTextLength,
      hasTitle: !!extracted.title,
      hasMetaDescription: !!extracted.metaDescription,
      hasContactForm,
      hasPhoneOrEmail: !!phoneFromSite || !!emailFromSite,
      issueCount: issues.length,
    });

    const data: WebsiteSignals = {
      reachable: res.ok,
      httpStatus: res.status,
      https,
      finalUrl: res.url || target,
      responseMs: ms,
      ...extracted,
      contentBytes: text.length,
      weaknesses,
      homepage_fetch_ok: res.ok,
      has_title: !!extracted.title,
      has_meta_description: !!extracted.metaDescription,
      has_contact_form: hasContactForm,
      phone_from_site: phoneFromSite,
      email_from_site: emailFromSite,
      emails_from_site: emailsFromSite,
      page_speed_mobile: null,
      last_checked: timestamp,
      visible_text_length: visibleTextLength,
      heading_count: headingCount,
      form_field_count: formFieldCount,
      issues,
      site_classification,
    };

    return {
      tool: "inspect_website",
      company: { ...company, domain: domain ?? company.domain, url: target },
      timestamp,
      confidence,
      confidenceLabel: labelFromConfidence(confidence),
      evidence,
      data,
      stub: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch failed";
    return {
      tool: "inspect_website",
      company: { ...company, domain: domain ?? company.domain, url: target },
      timestamp,
      confidence: 10,
      confidenceLabel: "LOW",
      evidence: [
        {
          kind: "fetch_error",
          source: target,
          observedAt: timestamp,
          detail: message,
        },
      ],
      data: {
        reachable: false,
        httpStatus: null,
        https: target.startsWith("https://"),
        finalUrl: null,
        responseMs: null,
        title: null,
        metaDescription: null,
        hasViewport: false,
        hasOpenGraph: false,
        scriptCount: 0,
        imageCount: 0,
        linkCount: 0,
        contentBytes: 0,
        weaknesses: ["site unreachable or blocked"],
        homepage_fetch_ok: false,
        has_title: false,
        has_meta_description: false,
        has_contact_form: false,
        phone_from_site: null,
        email_from_site: null,
        emails_from_site: [],
        page_speed_mobile: null,
        last_checked: timestamp,
        visible_text_length: 0,
        heading_count: 0,
        form_field_count: 0,
        issues: [{
          code: "site_unreachable",
          description: `Fetch failed for ${(() => { try { return new URL(target).hostname; } catch { return target; } })()}: ${message}.`,
          impact: "Business is invisible to anyone who searches and clicks.",
          severity: "high",
        }],
        site_classification: "site_unreachable",
      },
      stub: false,
      error: message,
    };
  }
}

export const inspectWebsiteTool: ToolDefinition<InspectWebsiteInput, WebsiteSignals> = {
  name: "inspect_website",
  description:
    "Fetches the company website and extracts structural revenue-leak signals (HTTPS, mobile viewport, meta, response time, content depth).",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef with at least name and url or domain" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
