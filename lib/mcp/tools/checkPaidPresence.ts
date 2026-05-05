// Meridian AI — check_paid_presence MCP tool.
//
// Detects whether a company is currently running paid ads on Google or
// Meta using ONLY public, no-paid-API surfaces:
//
//   • Google Ads Transparency Center (https://adstransparency.google.com/)
//   • Meta Ad Library (https://www.facebook.com/ads/library/ +
//                       https://graph.facebook.com/.../ads_archive when an
//                       optional META_AD_LIBRARY_TOKEN is configured)
//
// DESIGN RULES (strict, per spec):
//   1. Never produce false positives. Prefer `null` (unknown) over
//      guessing. A `true` return is a promise the rep can cite.
//   2. Fail silent on network, schema, or rate-limit errors — return null
//      with an evidence URL pointing at the raw search so the operator
//      can verify manually in ~10 seconds.
//   3. Fuzzy name match via the existing nameSimilarity() helper. Domain
//      match, when available, is the only signal allowed to upgrade a
//      mid-confidence name match to HIGH.
//   4. Pure, additive. Writes snap.paidPresence. Does NOT feed scoring
//      until the signal is validated (per user directive).
//
// Output shape:
//   {
//     googleAds:   true | false | null
//     metaAds:     true | false | null
//     confidence:  "high" | "medium" | "low"
//     asOf:        ISO timestamp
//     evidenceUrls: string[]     // real links used for verification
//   }
//
// A null on an axis means "we did not confirm; do not claim." A false
// means "we checked and no active ads were observed." A true means
// "we observed an active advertiser that matches this company with
// sufficient confidence to cite on a call."

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import {
  upsertPaidPresence,
  type PaidPresence,
  type PaidPresenceConfidence,
  type PaidPresenceSourceStatus,
} from "@/lib/state/companySnapshotStore";
import { nameSimilarity } from "@/lib/contacts/identity";

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export type CheckPaidPresenceInput = {
  company: CompanyRef;
  // Optional overrides. When absent, parsed from company.
  domain?: string;
  city?: string;
  state?: string;
  // Short-circuit flags for tests or partial checks.
  skipGoogle?: boolean;
  skipMeta?: boolean;
};

export type CheckPaidPresenceData = PaidPresence;

// A per-source detector result. Internal to this tool.
//
// `status` makes the three "why did we not confirm?" cases explicit to
// downstream consumers:
//   "confirmed" — endpoint reached and a real boolean was determined.
//   "unknown"   — detector was skipped (no creds / flag) or matched
//                 below the confidence threshold — nothing to cite.
//   "error"     — detector hit a problem (network / HTTP non-2xx /
//                 unparsable response). Implies manual verify required.
//
// `result` stays the spec-facing boolean|null. It is `true` only when
// status === "confirmed" AND we found a strong match; `false` only
// when status === "confirmed" AND the endpoint's response contained
// zero matching advertisers; `null` in every other case.
type DetectorResult = {
  status: PaidPresenceSourceStatus;
  result: boolean | null;
  evidenceUrl: string;           // always populated — never empty
  detail: string;
  matchScore?: number;           // 0–1, best candidate considered
};

// ─────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────

const HTTP_TIMEOUT_MS = 8_000;
const UA = "MeridianAI-PaidPresence/1.0 (+decision-platform)";

// Name-match thresholds. Chosen conservatively to avoid false positives
// on lookalike names ("Kansas City Roofing" vs "Kansas City Roof Pros").
const NAME_MATCH_HIGH = 0.85;   // exact / near-exact
const NAME_MATCH_MEDIUM = 0.70; // partial, needs corroboration (domain / city)

// ─────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept: "text/html,application/json;q=0.9,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDomain(input?: string | null): string {
  if (!input) return "";
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
}

function baseDomain(host: string): string {
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

// True when two domains point at the same business (exact or same
// registrable pair). Tolerant of subdomain / www / case differences.
function domainsMatch(a: string, b: string): boolean {
  const na = normalizeDomain(a);
  const nb = normalizeDomain(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return baseDomain(na) === baseDomain(nb);
}

function parseLocation(location?: string): { city: string; state: string } {
  if (!location) return { city: "", state: "" };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "" };
  if (parts.length === 1) return { city: parts[0], state: "" };
  return { city: parts[0], state: parts[parts.length - 1] };
}

// ─────────────────────────────────────────────────────────────────────────
// Google Ads Transparency Center
//
// The center is a client-rendered SPA fed by an undocumented RPC endpoint
// (`/anji/_/rpc/SearchService/SearchCreatives`). We call that endpoint
// with a conservative body; if it responds with a parseable payload that
// contains advertiser candidates whose name passes the match threshold
// AND (when a domain is available) the domain matches, we return `true`.
//
// If the RPC is unreachable, returns a malformed response, or we can't
// confidently match any candidate, we return `null` — NOT false. "Null"
// means the operator should manually verify via the evidence URL. We
// only return `false` when the search succeeded with zero candidates.
// ─────────────────────────────────────────────────────────────────────────

async function checkGoogleAds(args: {
  name: string;
  domain?: string;
  city?: string;
  state?: string;
}): Promise<DetectorResult> {
  const query = args.name.trim();
  const searchUrl = `https://adstransparency.google.com/?region=US&query=${encodeURIComponent(query || "")}`;
  if (!query) {
    return {
      status: "unknown",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Skipped: no company name provided.",
    };
  }

  const rpcUrl = "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=0";
  // The RPC schema is undocumented and drifts. Field `2:2` asks for
  // advertisers (not creatives); `3.8.1:"US"` scopes to US region.
  const body = new URLSearchParams({
    "f.req": JSON.stringify({
      "1": query,
      "2": 2,
      "3": { "8": { "1": "US" } },
      "7": { "1": 40, "2": 1, "3": 1 },
    }),
  });

  const res = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      "x-same-domain": "1",
    },
    body: body.toString(),
  });

  if (!res) {
    return {
      status: "error",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Google Ads Transparency RPC unreachable (network / timeout). Manual verify at evidence URL.",
    };
  }
  if (!res.ok) {
    // 400/403/429/5xx — undocumented endpoint changed shape, we got rate-
    // limited, or the service is down. Do not claim false.
    const hint =
      res.status === 400
        ? "RPC request schema rejected (likely drift). "
        : res.status === 403
        ? "Access denied to GATC RPC. "
        : res.status === 429
        ? "Rate limited by GATC RPC. "
        : "";
    return {
      status: "error",
      result: null,
      evidenceUrl: searchUrl,
      detail: `Google Ads Transparency returned HTTP ${res.status}. ${hint}Manual verify at evidence URL.`,
    };
  }

  const raw = await res.text().catch(() => "");
  const json = safeJson(raw);
  const candidates = extractGoogleAdvertisers(json);

  if (candidates === null) {
    // Response parsed as JSON but the advertiser schema was unrecognisable.
    // Do not emit false — treat as manual-verify required.
    return {
      status: "error",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Google Ads Transparency response unparsable (schema drift). Manual verify.",
    };
  }
  if (candidates.length === 0) {
    // Endpoint succeeded AND returned zero advertisers. Only path that
    // yields `false` — the one case where we've actually confirmed absence.
    return {
      status: "confirmed",
      result: false,
      evidenceUrl: searchUrl,
      detail: "Google Ads Transparency: searched, no matching advertiser returned.",
    };
  }

  // Score candidates by name similarity + domain match.
  let best: { name: string; domain: string; advertiserUrl: string; score: number } | null = null;
  for (const c of candidates) {
    const score = nameSimilarity(c.name, args.name);
    if (!best || score > best.score) {
      best = { ...c, score };
    }
  }
  if (!best) {
    return {
      status: "confirmed",
      result: false,
      evidenceUrl: searchUrl,
      detail: "Google Ads Transparency: no advertisers above noise floor.",
    };
  }

  const domainOk = args.domain
    ? (best.domain ? domainsMatch(best.domain, args.domain) : false)
    : null;

  if (best.score >= NAME_MATCH_HIGH && (domainOk === null || domainOk === true)) {
    return {
      status: "confirmed",
      result: true,
      evidenceUrl: best.advertiserUrl || searchUrl,
      detail: `Google Ads: matched advertiser "${best.name}" (name=${best.score.toFixed(2)}${
        domainOk === true ? ", domain ✓" : ""
      }).`,
      matchScore: best.score,
    };
  }
  if (best.score >= NAME_MATCH_MEDIUM && domainOk === true) {
    return {
      status: "confirmed",
      result: true,
      evidenceUrl: best.advertiserUrl || searchUrl,
      detail: `Google Ads: matched advertiser "${best.name}" via domain corroboration (name=${best.score.toFixed(2)}).`,
      matchScore: best.score,
    };
  }

  // Saw candidates but none passed the strict match bar. Surface the
  // lookup and let the rep decide.
  return {
    status: "unknown",
    result: null,
    evidenceUrl: searchUrl,
    detail: `Google Ads: closest candidate "${best.name}" (name=${best.score.toFixed(2)}) did not clear the match threshold. Manual verify.`,
    matchScore: best.score,
  };
}

function safeJson(raw: string): unknown {
  if (!raw) return null;
  // Google sometimes prefixes JSON responses with `)]}'\n` to prevent
  // XSSI. Strip it.
  const cleaned = raw.replace(/^\)\]\}'\s*/u, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// Best-effort extraction of advertiser rows from the GATC RPC response.
// Walks the structured JSON looking for objects with a plausible advertiser
// shape. Returns `null` when schema is unrecognizable (vs. empty array
// which means "searched, zero results").
function extractGoogleAdvertisers(
  json: unknown,
): Array<{ name: string; domain: string; advertiserUrl: string }> | null {
  if (!json || typeof json !== "object") return null;
  const out: Array<{ name: string; domain: string; advertiserUrl: string }> = [];
  const stack: unknown[] = [json];
  let visited = 0;
  while (stack.length > 0 && visited < 5000) {
    visited++;
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const obj = node as Record<string, unknown>;
    // Advertiser-shaped heuristics — GATC uses both named and numeric
    // keys across versions. We accept either.
    const maybeName =
      pickString(obj, "advertiserName") ??
      pickString(obj, "advertiserLegalName") ??
      pickString(obj, "2") ??
      pickString(obj, "3") ??
      pickString(obj, "name");
    const maybeId =
      pickString(obj, "advertiserId") ??
      pickString(obj, "1") ??
      pickString(obj, "id");
    const maybeDomain =
      pickString(obj, "advertiserUrl") ??
      pickString(obj, "domain") ??
      pickString(obj, "website") ??
      "";
    if (maybeName && maybeId && /^[A-Z0-9_-]{6,}$/i.test(maybeId)) {
      out.push({
        name: maybeName,
        domain: maybeDomain,
        advertiserUrl: `https://adstransparency.google.com/advertiser/${encodeURIComponent(maybeId)}?region=US`,
      });
    }
    for (const v of Object.values(obj)) stack.push(v);
  }
  // Dedupe by advertiser URL.
  const seen = new Set<string>();
  const deduped = out.filter((c) => {
    if (seen.has(c.advertiserUrl)) return false;
    seen.add(c.advertiserUrl);
    return true;
  });
  return deduped;
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Meta Ad Library
//
// Two paths:
//   A) If META_AD_LIBRARY_TOKEN is set, query the official Graph API
//      `/ads_archive` (free — this is Meta's public archive endpoint,
//      not a paid product). High-confidence when ads exist.
//   B) Otherwise, hit the public HTML search page and return a null
//      with an evidence URL. We do NOT parse the rendered results —
//      they're client-rendered and scraping them would produce the
//      exact false-positive class the spec forbids.
// ─────────────────────────────────────────────────────────────────────────

async function checkMetaAds(args: {
  name: string;
  domain?: string;
}): Promise<DetectorResult> {
  const query = args.name.trim();
  const searchUrl =
    `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(
      query || "",
    )}&search_type=keyword_unordered`;

  if (!query) {
    return {
      status: "unknown",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Skipped: no company name provided.",
    };
  }

  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) {
    // No token → genuinely unknown (not an error). The search URL
    // still lets a rep verify in ~10 seconds.
    return {
      status: "unknown",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Meta Ad Library: no token configured. Set META_AD_LIBRARY_TOKEN or verify manually at evidence URL.",
    };
  }

  const apiUrl =
    `https://graph.facebook.com/v19.0/ads_archive` +
    `?access_token=${encodeURIComponent(token)}` +
    `&ad_reached_countries=["US"]` +
    `&ad_active_status=ACTIVE` +
    `&search_terms=${encodeURIComponent(query)}` +
    `&fields=page_name,page_id,ad_delivery_start_time&limit=25`;

  const res = await fetchWithTimeout(apiUrl);
  if (!res) {
    return {
      status: "error",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Meta Ad Library API unreachable (network / timeout). Manual verify.",
    };
  }
  if (!res.ok) {
    const hint =
      res.status === 400
        ? "Check query format / token scope. "
        : res.status === 401 || res.status === 403
        ? "Token invalid or insufficient scope. "
        : res.status === 429
        ? "Rate limited by Meta. "
        : "";
    return {
      status: "error",
      result: null,
      evidenceUrl: searchUrl,
      detail: `Meta Ad Library returned HTTP ${res.status}. ${hint}Manual verify.`,
    };
  }

  const json = (await res.json().catch(() => null)) as
    | { data?: Array<{ page_name?: string; page_id?: string }> }
    | null;
  if (!json || !Array.isArray(json.data)) {
    return {
      status: "error",
      result: null,
      evidenceUrl: searchUrl,
      detail: "Meta Ad Library: unparsable response. Manual verify.",
    };
  }
  if (json.data.length === 0) {
    return {
      status: "confirmed",
      result: false,
      evidenceUrl: searchUrl,
      detail: "Meta Ad Library: searched, no active ads for this query.",
    };
  }

  let best: { pageName: string; pageId: string; score: number } | null = null;
  for (const row of json.data) {
    const pname = (row.page_name ?? "").trim();
    if (!pname) continue;
    const s = nameSimilarity(pname, args.name);
    if (!best || s > best.score) {
      best = { pageName: pname, pageId: (row.page_id ?? "").trim(), score: s };
    }
  }
  if (!best) {
    return {
      status: "confirmed",
      result: false,
      evidenceUrl: searchUrl,
      detail: "Meta Ad Library: no page-name matches above noise floor.",
    };
  }
  const evidence = best.pageId
    ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${encodeURIComponent(best.pageId)}`
    : searchUrl;

  if (best.score >= NAME_MATCH_HIGH) {
    return {
      status: "confirmed",
      result: true,
      evidenceUrl: evidence,
      detail: `Meta: matched page "${best.pageName}" (name=${best.score.toFixed(2)}).`,
      matchScore: best.score,
    };
  }
  return {
    status: "unknown",
    result: null,
    evidenceUrl: evidence,
    detail: `Meta: closest page "${best.pageName}" (name=${best.score.toFixed(2)}) did not clear the match threshold. Manual verify.`,
    matchScore: best.score,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Confidence roll-up
// ─────────────────────────────────────────────────────────────────────────

function rollUpConfidence(g: DetectorResult, m: DetectorResult): PaidPresenceConfidence {
  const confirmedTrueCount = Number(g.result === true) + Number(m.result === true);
  const anyMatchHigh =
    (g.matchScore ?? 0) >= NAME_MATCH_HIGH ||
    (m.matchScore ?? 0) >= NAME_MATCH_HIGH;

  // Two sources agree ads are running → high.
  if (confirmedTrueCount >= 2) return "high";
  // One source confirmed with a high-quality name match → high.
  if (confirmedTrueCount === 1 && anyMatchHigh) return "high";
  // One source confirmed at medium match quality → medium.
  if (confirmedTrueCount === 1) return "medium";
  // No "true"s. If we at least have one `confirmed` status (i.e. a real
  // negative), that's medium-confidence absence. Otherwise we didn't
  // actually learn anything — low.
  const anyConfirmed = g.status === "confirmed" || m.status === "confirmed";
  return anyConfirmed ? "medium" : "low";
}

function deriveManualVerification(g: DetectorResult, m: DetectorResult): boolean {
  // Manual verification is recommended whenever either axis is not a
  // "confirmed" status — the rep has a real reason to open the evidence
  // URL (missing token, endpoint error, or a below-threshold match).
  return g.status !== "confirmed" || m.status !== "confirmed";
}

// ─────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────

async function handler(input: CheckPaidPresenceInput): Promise<ToolResult<CheckPaidPresenceData>> {
  const timestamp = nowIso();
  const company = input.company;
  const name = company.name?.trim();
  if (!name) {
    return {
      tool: "check_paid_presence",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [{ kind: "skip", source: "check_paid_presence", observedAt: timestamp, detail: "Missing company name — nothing to check." }],
      data: {
        googleAds: null,
        metaAds: null,
        confidence: "low",
        asOf: timestamp,
        evidenceUrls: [],
        googleStatus: "unknown",
        metaStatus: "unknown",
        manualVerificationRequired: true,
      },
      stub: false,
      error: "missing_company_name",
    };
  }

  const domain = normalizeDomain(input.domain ?? company.domain ?? company.url);
  const parsed = parseLocation(company.location);
  const city = input.city ?? parsed.city;
  const state = input.state ?? parsed.state;

  // Skips still emit a valid search URL so the rep has something to open.
  const googleSearchUrl = `https://adstransparency.google.com/?region=US&query=${encodeURIComponent(name)}`;
  const metaSearchUrl =
    `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(name)}&search_type=keyword_unordered`;

  const [google, meta] = await Promise.all([
    input.skipGoogle
      ? Promise.resolve<DetectorResult>({
          status: "unknown",
          result: null,
          evidenceUrl: googleSearchUrl,
          detail: "Skipped by input.",
        })
      : checkGoogleAds({ name, domain: domain || undefined, city, state }),
    input.skipMeta
      ? Promise.resolve<DetectorResult>({
          status: "unknown",
          result: null,
          evidenceUrl: metaSearchUrl,
          detail: "Skipped by input.",
        })
      : checkMetaAds({ name, domain: domain || undefined }),
  ]);

  const evidenceUrls = Array.from(
    new Set([google.evidenceUrl, meta.evidenceUrl].filter((u): u is string => !!u)),
  );
  const confidence = rollUpConfidence(google, meta);
  const manualVerificationRequired = deriveManualVerification(google, meta);

  const presence: PaidPresence = {
    googleAds: google.result,
    metaAds: meta.result,
    confidence,
    asOf: timestamp,
    evidenceUrls,
    googleDetail: google.detail,
    metaDetail: meta.detail,
    googleStatus: google.status,
    metaStatus: meta.status,
    manualVerificationRequired,
  };

  // Persist. Best-effort — never fail the tool for a write error.
  try {
    await upsertPaidPresence(company, presence);
  } catch {
    // intentional: don't bubble persistence errors back to caller
  }

  // Numeric confidence for the envelope.
  const numeric =
    presence.confidence === "high" ? 85
    : presence.confidence === "medium" ? 60
    : 30;

  return {
    tool: "check_paid_presence",
    company,
    timestamp,
    confidence: numeric,
    confidenceLabel: labelFromConfidence(numeric),
    evidence: [
      { kind: "google_ads", source: "adstransparency.google.com", observedAt: timestamp, detail: `[${google.status}] ${google.detail}` },
      { kind: "meta_ads", source: "facebook.com/ads/library", observedAt: timestamp, detail: `[${meta.status}] ${meta.detail}` },
    ],
    data: presence,
    stub: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────

export const checkPaidPresenceTool: ToolDefinition<CheckPaidPresenceInput, CheckPaidPresenceData> = {
  name: "check_paid_presence",
  description:
    "Detects whether a company is actively running paid ads on Google or Meta using public surfaces only (Google Ads Transparency Center + Meta Ad Library). Returns `true` only on confident name+domain matches; otherwise null with an evidence URL for manual verification. Persists the result onto snap.paidPresence. Does not feed scoring until validated.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef with name, optional domain and location" },
      domain: { type: "string", description: "Domain override (defaults to company.domain)" },
      city: { type: "string", description: "City override (defaults to parsed from company.location)" },
      state: { type: "string", description: "State override" },
      skipGoogle: { type: "boolean", description: "Skip Google Ads Transparency check (tests)" },
      skipMeta: { type: "boolean", description: "Skip Meta Ad Library check (tests)" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
