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
  weaknesses: string[];         // human-readable revenue-leak signals
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

    const data: WebsiteSignals = {
      reachable: res.ok,
      httpStatus: res.status,
      https,
      finalUrl: res.url || target,
      responseMs: ms,
      ...extracted,
      contentBytes: text.length,
      weaknesses,
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
