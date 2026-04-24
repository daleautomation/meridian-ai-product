// Meridian AI — Hunter.io adapter.
//
// Supplements the contact waterfall with real email addresses associated
// with a business's domain. Hunter Domain Search returns emails it has
// observed in public sources (never invented) along with optional person
// metadata (first_name, last_name, position). Never guesses or generates
// pattern-based emails.
//
// Env var: HUNTER_API_KEY. When missing the adapter returns [] and the
// resolver records "hunter_skipped_no_key" as a skip reason.
//
// Identity requirement: Hunter queries by domain. If the input has no
// usable domain the adapter returns [] (logged with "hunter_skipped_no_domain").

import type { ContactCandidate, Identity } from "../types";

const ENDPOINT = "https://api.hunter.io/v2/domain-search";

type HunterEmail = {
  value: string;
  type?: "generic" | "personal";
  confidence?: number;       // 0–100
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
  sources?: Array<{ domain?: string; uri?: string; extracted_on?: string }>;
};

type HunterResponse = {
  data?: {
    domain?: string;
    organization?: string;
    country?: string;
    emails?: HunterEmail[];
    pattern?: string | null;
  };
  errors?: Array<{ details?: string }>;
};

export function hunterKey(): string | null {
  return process.env.HUNTER_API_KEY ?? null;
}

export function isHunterConfigured(): boolean {
  return !!hunterKey();
}

// Normalizes a raw domain string (http://, www., trailing slash, path).
function normalizeDomainForHunter(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let d = String(raw).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0];
  // Drop obvious placeholder/test domains that Hunter should not be queried against.
  if (!d || d.includes(" ")) return null;
  if (/^(example|localhost|iana|w3)\.(org|com|net)$/.test(d)) return null;
  if (!/\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

// Pick the single best email from Hunter's list. Strategy:
//   - Prefer the highest-confidence personal email (person-level contact).
//   - Fall back to the highest-confidence generic email (info@, contact@).
// Returns both the chosen email and its metadata.
function pickBestEmail(emails: HunterEmail[]): HunterEmail | null {
  if (!emails || emails.length === 0) return null;
  const personal = emails
    .filter((e) => e.type === "personal" && !!e.value)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  if (personal[0] && (personal[0].confidence ?? 0) >= 70) return personal[0];
  const generic = emails
    .filter((e) => e.type === "generic" && !!e.value)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  if (generic[0]) return generic[0];
  // Fallback: best of any type
  return [...emails]
    .filter((e) => !!e.value)
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0] ?? null;
}

export async function searchHunter(identity: Identity): Promise<ContactCandidate[]> {
  const key = hunterKey();
  if (!key) return [];
  const domain = normalizeDomainForHunter(identity.domain);
  if (!domain) {
    console.info(`[hunter] skip domain_missing name=${JSON.stringify(identity.rawName)}`);
    return [];
  }

  const url = `${ENDPOINT}?domain=${encodeURIComponent(domain)}&api_key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[hunter] http_error status=${res.status} domain=${domain}`);
      return [];
    }
    const json = (await res.json()) as HunterResponse;
    const picked = pickBestEmail(json.data?.emails ?? []);
    if (!picked) {
      console.info(`[hunter] domain=${domain} emails=0 org=${JSON.stringify(json.data?.organization ?? null)}`);
      return [];
    }
    const personName = [picked.first_name, picked.last_name].filter(Boolean).join(" ").trim() || undefined;
    const orgName = json.data?.organization || identity.rawName;
    console.info(
      `[hunter] domain=${domain} emails=${json.data?.emails?.length ?? 0} picked_type=${picked.type ?? "unknown"} confidence=${picked.confidence ?? 0}`,
    );
    return [{
      name: orgName,
      email: picked.value,
      contactName: personName,
      contactPosition: picked.position ?? undefined,
      website: domain ? `https://${domain}` : undefined,
      source: "hunter",
      sourceId: picked.value,
      // Hunter confidence 0–100 → we surface the numeric score for the
      // resolver's path builder, which folds it into its own confidence tier.
      providerConfidence: picked.confidence ?? undefined,
    }];
  } catch (e) {
    console.warn(`[hunter] error domain=${domain} err=${e instanceof Error ? e.message : "unknown"}`);
    return [];
  }
}
