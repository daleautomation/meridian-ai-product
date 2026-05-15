// Meridian — Hunter email enrichment integration.
//
// Single entry point for getting a verified email for a lead.
// Strategy:
//   1. Hunter Domain Search    — observed emails on the company's domain.
//   2. Hunter Email Finder     — first/last name + domain (fallback when
//                                Domain Search returned nothing usable
//                                AND we have a contact name to search).
//
// Pure / fail-silent. Never throws to callers — returns null on any
// failure so the UI cannot break from a Hunter outage. Per-domain
// in-memory cache keeps Hunter API usage low when the same lead is
// hit multiple times in one session.
//
// NO sending, NO automation, NO scheduling — this file is just the
// enrichment lookup. Callers decide if/when to mutate the lead.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import { getHunterApiKey } from "@/lib/integrations/hunterConfig";

const DOMAIN_SEARCH = "https://api.hunter.io/v2/domain-search";
const EMAIL_FINDER  = "https://api.hunter.io/v2/email-finder";

// ── Public types ─────────────────────────────────────────────────────

export type HunterEmailResult = {
  email: string;
  /** "high" | "medium" | "low" — bucketed from Hunter's 0–100 score. */
  confidence: "high" | "medium" | "low";
  /** Raw 0–100 score returned by Hunter, surfaced for callers that want detail. */
  rawScore?: number;
  /** Person/role metadata Hunter returned alongside the email. */
  contactName?: string;
  contactPosition?: string;
};

// ── Cache ────────────────────────────────────────────────────────────
//
// Keyed by normalized domain. `null` is also a valid cached result —
// it means "we already asked Hunter and got nothing, don't ask again
// this session."

type CacheEntry = HunterEmailResult | null;
const domainCache = new Map<string, CacheEntry>();

/** Test-only: clears the per-domain cache. Not exported in production paths. */
export function _clearHunterCache(): void {
  domainCache.clear();
}

// ── Internal helpers ─────────────────────────────────────────────────

function normalizeDomain(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0];
  if (!d || d.includes(" ")) return null;
  if (/^(example|localhost|iana|w3)\.(org|com|net)$/.test(d)) return null;
  if (!/\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

function bucketConfidence(score: number | undefined): "high" | "medium" | "low" {
  // Threshold tuned to match the UI trust layer: scores >= 70 read as
  // "high" and earn the Email ✓ checkmark in LeadEmailAction. Below 70
  // is "medium" and renders as plain Email (no check). Below 40 is
  // "low" — usable but quieter.
  const s = typeof score === "number" ? score : 0;
  if (s >= 70) return "high";
  if (s >= 40) return "medium";
  return "low";
}

function leadDomain(lead: NormalizedLead | null | undefined): string | null {
  if (!lead) return null;
  const direct = (lead as unknown as { website?: string; domain?: string }).website
    ?? (lead as unknown as { website?: string; domain?: string }).domain
    ?? null;
  return normalizeDomain(direct);
}

function leadContactName(lead: NormalizedLead | null | undefined): { first?: string; last?: string } | null {
  if (!lead) return null;
  const cn = (lead as unknown as { contacts?: { contactName?: string } }).contacts?.contactName;
  if (typeof cn !== "string" || cn.trim().length === 0) return null;
  const parts = cn.trim().split(/\s+/);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

// ── Domain Search ───────────────────────────────────────────────────

type HunterDomainEmail = {
  value: string;
  type?: "generic" | "personal";
  confidence?: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
};

type HunterDomainResponse = {
  data?: { domain?: string; organization?: string; emails?: HunterDomainEmail[] };
};

async function domainSearch(domain: string, key: string): Promise<HunterEmailResult | null> {
  try {
    const url = `${DOMAIN_SEARCH}?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[hunter-enrich] domain_search http=${res.status} domain=${domain}`);
      return null;
    }
    const json = (await res.json()) as HunterDomainResponse;
    const emails = json.data?.emails ?? [];
    if (emails.length === 0) return null;
    const personal = emails
      .filter((e) => e.type === "personal" && !!e.value)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const generic = emails
      .filter((e) => e.type === "generic" && !!e.value)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const best = (personal[0] && (personal[0].confidence ?? 0) >= 70) ? personal[0]
      : (generic[0] ?? personal[0] ?? null);
    if (!best) return null;
    const personName = [best.first_name, best.last_name].filter(Boolean).join(" ").trim();
    return {
      email: best.value,
      confidence: bucketConfidence(best.confidence),
      rawScore: best.confidence,
      contactName: personName || undefined,
      contactPosition: best.position ?? undefined,
    };
  } catch (err) {
    console.warn(`[hunter-enrich] domain_search error domain=${domain} err_type=${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
}

// ── Email Finder ────────────────────────────────────────────────────

type HunterFinderResponse = {
  data?: { email?: string; score?: number; first_name?: string | null; last_name?: string | null; position?: string | null };
};

async function emailFinder(domain: string, name: { first?: string; last?: string }, key: string): Promise<HunterEmailResult | null> {
  if (!name.first && !name.last) return null;
  try {
    const params = new URLSearchParams();
    params.set("domain", domain);
    if (name.first) params.set("first_name", name.first);
    if (name.last)  params.set("last_name",  name.last);
    params.set("api_key", key);
    const res = await fetch(`${EMAIL_FINDER}?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[hunter-enrich] email_finder http=${res.status} domain=${domain}`);
      return null;
    }
    const json = (await res.json()) as HunterFinderResponse;
    const value = json.data?.email;
    if (!value) return null;
    const personName = [json.data?.first_name, json.data?.last_name].filter(Boolean).join(" ").trim();
    return {
      email: value,
      confidence: bucketConfidence(json.data?.score),
      rawScore: json.data?.score,
      contactName: personName || undefined,
      contactPosition: json.data?.position ?? undefined,
    };
  } catch (err) {
    console.warn(`[hunter-enrich] email_finder error domain=${domain} err_type=${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Look up a verified email for a lead via Hunter.io.
 *
 * Behaviour:
 *   • Returns null silently on any failure (missing API key, network
 *     error, HTTP error, no domain, no email observed).
 *   • Honours `lead.verifiedEmail` — if the lead already has a verified
 *     email we DO NOT call Hunter and DO NOT overwrite. Returns the
 *     existing record so callers always get a stable shape.
 *   • Caches per normalized domain for the life of the process so
 *     repeat lookups within a session don't re-bill Hunter.
 *   • Tries Domain Search first; falls back to Email Finder when the
 *     lead carries a contact name and Domain Search came back empty.
 *
 * Caller is responsible for any subsequent mutation:
 *   lead.verifiedEmail   = result.email
 *   lead.emailConfidence = result.confidence
 *   lead.emailSource     = "hunter"
 *
 * This module never mutates the lead — that's a deliberate design
 * choice so ingestion / scoring / scheduling never have a hidden
 * dependency on Hunter being reachable.
 */
export async function findEmailForLead(
  lead: NormalizedLead | null | undefined,
): Promise<HunterEmailResult | null> {
  try {
    if (!lead) return null;

    // Don't overwrite existing verified email — return the existing
    // record so callers always have a stable shape to render against.
    if (typeof lead.verifiedEmail === "string" && lead.verifiedEmail.length > 0) {
      const existingConf = (lead.emailConfidence === "high" || lead.emailConfidence === "medium" || lead.emailConfidence === "low")
        ? lead.emailConfidence
        : "medium";
      return { email: lead.verifiedEmail, confidence: existingConf };
    }

    const domain = leadDomain(lead);
    if (!domain) return null;

    // Cache hit (including cached "null" — already asked Hunter, got nothing).
    if (domainCache.has(domain)) {
      return domainCache.get(domain) ?? null;
    }

    const key = getHunterApiKey();
    if (!key) {
      // No key configured. Cache the null so we don't keep retrying.
      domainCache.set(domain, null);
      return null;
    }

    // 1. Domain Search.
    const ds = await domainSearch(domain, key);
    if (ds) {
      domainCache.set(domain, ds);
      return ds;
    }

    // 2. Email Finder fallback — needs a contact name on the lead.
    const name = leadContactName(lead);
    if (name) {
      const ef = await emailFinder(domain, name, key);
      if (ef) {
        domainCache.set(domain, ef);
        return ef;
      }
    }

    domainCache.set(domain, null);
    return null;
  } catch (err) {
    // Hard fail-silent. Anything thrown here becomes a clean null.
    console.warn(`[hunter-enrich] unexpected error type=${err instanceof Error ? err.name : "unknown"}`);
    return null;
  }
}

/**
 * Apply a Hunter result onto a lead-shaped object. Mutates the input
 * in place per the user spec:
 *   lead.verifiedEmail   = result.email
 *   lead.emailConfidence = result.confidence
 *   lead.emailSource     = "hunter"
 *   lead.emailVerifiedAt = <now ISO>
 *
 * No-ops when:
 *   • result is null
 *   • lead.verifiedEmail already exists (do-not-overwrite rule)
 *
 * Returns true when a write happened, false otherwise.
 */
export function applyHunterResultToLead(
  lead: NormalizedLead | null | undefined,
  result: HunterEmailResult | null,
): boolean {
  if (!lead || !result) return false;
  if (typeof lead.verifiedEmail === "string" && lead.verifiedEmail.length > 0) {
    return false;
  }
  // We assign through `unknown` to avoid TS narrowing complaints — the
  // fields are already part of NormalizedLead's optional shape.
  const target = lead as unknown as {
    verifiedEmail?: string;
    emailConfidence?: "high" | "medium" | "low";
    emailSource?: string;
    emailVerifiedAt?: string;
    emailStatus?: string;
  };
  target.verifiedEmail   = result.email;
  target.emailConfidence = result.confidence;
  target.emailSource     = "hunter";
  target.emailVerifiedAt = new Date().toISOString();
  target.emailStatus     = "verified";
  return true;
}
