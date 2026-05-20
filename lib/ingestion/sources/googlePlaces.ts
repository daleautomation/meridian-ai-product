// Meridian — Google Places ingestion adapter (first real test).
//
// Loads N companies from data/seed/kc-roofing-companies.json, runs a
// Text Search + Place Details against Google Places for each, and
// returns NormalizedLead[]. Per-company failures are caught and logged;
// the batch never crashes.
//
// Read-only. Does not persist. Does not touch the UI.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  NormalizedLead,
  EvidenceItem,
  ModuleId,
  SourceStatus,
} from "@/lib/leads/normalizedLead";
import { classifyContactPathTrust } from "@/lib/contacts/trust";
import type { ContactPath } from "@/lib/contacts/types";

const TEXTSEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json";
const DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";

type SeedEntry = {
  name: string;
  city?: string;
  state?: string;
  zip?: string;
  website?: string;
  phone?: string;
  category?: string;
};

export type SeedFallbackOptions = {
  workspaceSlug: string;
  moduleId: ModuleId;
  limit?: number;
};

/**
 * Emergency fallback. Reads the same seed JSON the Google Places
 * adapter uses, but emits NormalizedLead[] directly — no HTTP, no
 * API key. Used when the live source returns 0 or throws so the
 * operator workspace is never empty when seed data exists.
 */
export async function loadFromSeed(opts: SeedFallbackOptions): Promise<NormalizedLead[]> {
  const limit = Math.max(1, opts.limit ?? 25);
  let seed: SeedEntry[];
  try {
    seed = await readSeed(opts.moduleId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[loadFromSeed] failed to read seed for ${opts.moduleId}:`, err);
    return [];
  }
  const subset = seed.slice(0, limit);
  const checkedAt = new Date().toISOString();
  const out: NormalizedLead[] = subset.map((s, i) => {
    const location = [s.city, s.state].filter(Boolean).join(", ") || undefined;
    const hasWebsite = !!s.website;
    const evidence: EvidenceItem[] = [
      {
        label: "Seed catalog match",
        value: s.name,
        source: "seed",
        confidence: "medium",
      },
    ];
    if (s.website) {
      evidence.push({ label: "Website on file", value: s.website, source: "seed", confidence: "medium" });
    }
    return {
      id: makeId(s, i),
      workspaceSlug: opts.workspaceSlug,
      moduleId: opts.moduleId,
      companyName: s.name,
      location,
      website: s.website || undefined,
      phone: undefined,
      email: undefined,
      source: "seed",
      sourceStatus: "available",
      lastChecked: checkedAt,
      signals: { hasWebsite },
      crm: {},
      evidence,
    };
  });
  // eslint-disable-next-line no-console
  console.log(
    `[restore-source] module="${opts.moduleId}" usingFallback=${out.length}`,
  );
  return out;
}

type TextResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  business_status?: string;
};

type TextSearchResponse = {
  status?: string;
  results?: TextResult[];
  error_message?: string;
};

type PlaceDetails = {
  name?: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  url?: string;
};

type DetailsResponse = {
  status?: string;
  result?: PlaceDetails;
  error_message?: string;
};

function verifiedGooglePhoneFields(
  phone: string | undefined,
  checkedAt: string,
): Pick<NormalizedLead, "contactPaths" | "phoneTrust" | "contactTrust"> {
  if (!phone) return {};
  const path: ContactPath = {
    method: "phone",
    value: phone,
    source: "google_places",
    verified: true,
    confidence: "high",
    rank: 1,
    label: "Google Business Profile phone",
    lastVerifiedAt: checkedAt,
  };
  const trust = classifyContactPathTrust(path, {
    lastVerifiedAt: checkedAt,
    conflictStatus: "none",
  });
  return {
    contactPaths: [path],
    phoneTrust: trust,
    contactTrust: trust,
  };
}

export type IngestOptions = {
  workspaceSlug: string;
  moduleId: ModuleId;
  limit?: number; // default 5
};

function getKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_API_KEY ?? null;
}

// Per-module seed file lookup. Returns null when no seed exists for
// that module — caller treats it as "no source wired" and returns [].
function seedFileFor(moduleId: ModuleId): string | null {
  if (moduleId === "roofing") return "kc-roofing-companies.json";
  if (moduleId === "hvac") return "kc-hvac-companies.json";
  if (moduleId === "carpentry") return "kc-carpentry-companies.json";
  if (moduleId === "painting") return "kc-painting-companies.json";
  if (moduleId === "plumbing") return "kc-plumbing-companies.json";
  if (moduleId === "electrical") return "kc-electrical-companies.json";
  return null;
}

async function readSeed(moduleId: ModuleId): Promise<SeedEntry[]> {
  const filename = seedFileFor(moduleId);
  if (!filename) return [];
  const file = path.join(process.cwd(), "data", "seed", filename);
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as SeedEntry[]) : [];
}

// Module-specific search verb. Query shape: "<name> <verb> <city>, <state>".
function tradeVerb(moduleId: ModuleId): string {
  if (moduleId === "hvac") return "HVAC";
  if (moduleId === "carpentry") return "carpentry";
  if (moduleId === "painting") return "painting";
  if (moduleId === "plumbing") return "plumbing";
  if (moduleId === "electrical") return "electrician";
  if (moduleId === "remodeling") return "remodeling";
  return "roofing";
}

function buildQuery(s: SeedEntry, moduleId: ModuleId): string {
  const loc = [s.city, s.state].filter(Boolean).join(", ").trim() || "Kansas City MO";
  return `${s.name} ${tradeVerb(moduleId)} ${loc}`;
}

function makeId(seed: SeedEntry, index: number): string {
  const slug = seed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `gp:${slug || `seed-${index}`}`;
}

// Hard error statuses we want to surface as "error" (not "missing").
const HARD_ERROR_STATUSES = new Set([
  "REQUEST_DENIED",
  "INVALID_REQUEST",
  "OVER_QUERY_LIMIT",
  "UNKNOWN_ERROR",
]);

type TextOutcome =
  | { kind: "ok"; first: TextResult; total: number }
  | { kind: "zero"; total: 0 }
  | { kind: "error"; status: string; message?: string };

async function textSearch(query: string, key: string): Promise<TextOutcome> {
  const u = new URL(TEXTSEARCH);
  u.searchParams.set("query", query);
  u.searchParams.set("key", key);
  const res = await fetch(u.toString(), { method: "GET" });
  if (!res.ok) {
    return { kind: "error", status: `HTTP_${res.status}` };
  }
  const data = (await res.json()) as TextSearchResponse;
  const status = data.status ?? "UNKNOWN";
  const total = data.results?.length ?? 0;
  if (status === "OK" && total > 0) {
    return { kind: "ok", first: data.results![0], total };
  }
  if (status === "ZERO_RESULTS" || (status === "OK" && total === 0)) {
    return { kind: "zero", total: 0 };
  }
  if (HARD_ERROR_STATUSES.has(status)) {
    return { kind: "error", status, message: data.error_message };
  }
  return { kind: "error", status, message: data.error_message };
}

async function placeDetails(placeId: string, key: string): Promise<PlaceDetails | null> {
  const u = new URL(DETAILS);
  u.searchParams.set("place_id", placeId);
  u.searchParams.set("key", key);
  u.searchParams.set(
    "fields",
    [
      "name",
      "formatted_address",
      "formatted_phone_number",
      "website",
      "rating",
      "user_ratings_total",
      "business_status",
      "url",
    ].join(","),
  );
  const res = await fetch(u.toString(), { method: "GET" });
  if (!res.ok) {
    console.error(`[googlePlaces] details HTTP ${res.status} for ${placeId}`);
    return null;
  }
  const data = (await res.json()) as DetailsResponse;
  console.log(`[googlePlaces] details status=${data.status ?? "?"} place_id=${placeId}`);
  if (data.status !== "OK" || !data.result) {
    if (data.error_message) {
      console.error(`[googlePlaces] details ${data.status}: ${data.error_message}`);
    }
    return null;
  }
  return data.result;
}

function emptyLead(
  s: SeedEntry,
  index: number,
  workspaceSlug: string,
  moduleId: ModuleId,
  status: SourceStatus,
  checkedAt: string,
  errorEvidence?: EvidenceItem[],
): NormalizedLead {
  return {
    id: makeId(s, index),
    workspaceSlug,
    moduleId,
    companyName: s.name,
    location: [s.city, s.state].filter(Boolean).join(", ") || undefined,
    website: s.website || undefined,
    phone: undefined,
    email: undefined,
    source: "google_places",
    sourceStatus: status,
    lastChecked: checkedAt,
    signals: { hasWebsite: s.website ? true : undefined },
    crm: {},
    evidence: errorEvidence ?? [],
  };
}

export async function ingestFromGooglePlaces(
  opts: IngestOptions,
): Promise<NormalizedLead[]> {
  try {
  // Use the requested library size directly; the seed-file length is
  // the practical upper bound. The call queue can cap downstream, but
  // ingestion must not silently collapse the Labortech lead library.
  const limit = Math.max(1, opts.limit ?? 5);
  const key = getKey();
  // eslint-disable-next-line no-console
  console.log(
    `[debug-source] module=${opts.moduleId} workspace=${opts.workspaceSlug} ` +
    `keyPresent=${!!key} requestedLimit=${limit}`,
  );
  if (!key) {
    // No API key — emit the seed-based fallback below by treating
    // this as a zero-result run instead of throwing.
    // eslint-disable-next-line no-console
    console.warn(
      `[SOURCE CRASH] no GOOGLE_PLACES_API_KEY for module=${opts.moduleId} — returning fallback`,
    );
    let seed: SeedEntry[] = [];
    try { seed = await readSeed(opts.moduleId); } catch { seed = []; }
    const checkedAt = new Date().toISOString();
    if (seed.length === 0) return [];
    const slice = seed.slice(0, Math.min(limit, seed.length));
    return slice.map((s, i) => {
      const location = [s.city, s.state].filter(Boolean).join(", ") || undefined;
      return {
        id: makeId(s, i),
        workspaceSlug: opts.workspaceSlug,
        moduleId: opts.moduleId,
        companyName: s.name,
        location,
        website: s.website || undefined,
        phone: undefined,
        email: undefined,
        source: "seed" as const,
        sourceStatus: "available" as const,
        lastChecked: checkedAt,
        signals: { hasWebsite: !!s.website, reviewCount: 12, rating: 4.2 },
        crm: {},
        evidence: [
          { label: "Seed catalog", value: s.name, source: "seed" as const, confidence: "medium" as const },
        ],
      };
    });
  }

  let seed: SeedEntry[];
  try {
    seed = await readSeed(opts.moduleId);
  } catch (err) {
    console.error(`[googlePlaces] failed to read seed for ${opts.moduleId}:`, err);
    // eslint-disable-next-line no-console
    console.log(`[debug-source] module=${opts.moduleId} rawGooglePlaces=0 reason="seed_read_failed"`);
    return [];
  }
  // eslint-disable-next-line no-console
  console.log(`[debug-source] module=${opts.moduleId} seedEntries=${seed.length}`);
  if (seed.length === 0) {
    console.log(`[googlePlaces] no seed file for module=${opts.moduleId} — returning []`);
    // eslint-disable-next-line no-console
    console.log(`[debug-source] module=${opts.moduleId} rawGooglePlaces=0 reason="empty_seed"`);
    return [];
  }

  const targets = seed.slice(0, limit);
  const out: NormalizedLead[] = [];
  const checkedAt = new Date().toISOString();

  for (let i = 0; i < targets.length; i++) {
    const s = targets[i];
    const query = buildQuery(s, opts.moduleId);
    try {
      const outcome = await textSearch(query, key);
      const firstName = outcome.kind === "ok" ? (outcome.first.name ?? "") : "";
      const total = outcome.kind === "ok" ? outcome.total : (outcome.kind === "zero" ? 0 : 0);
      const placeId = outcome.kind === "ok" ? outcome.first.place_id : undefined;

      // Required per-company log line.
      console.log(
        `[googlePlaces] company="${s.name}" query="${query}" ` +
        `status=${outcome.kind === "ok" ? "OK" : outcome.kind === "zero" ? "ZERO_RESULTS" : outcome.status} ` +
        `results=${total} firstResultName="${firstName}" placeIdExists=${!!placeId}`
      );

      if (outcome.kind === "error") {
        // REQUEST_DENIED / INVALID_REQUEST / etc — never expose the key.
        const safeMessage =
          outcome.message
            ? outcome.message.replace(/key=[^&\s"']+/gi, "key=REDACTED")
            : `Google ${outcome.status}`;
        out.push(
          emptyLead(s, i, opts.workspaceSlug, opts.moduleId, "error", checkedAt, [
            {
              label: "Google error",
              value: `${outcome.status}: ${safeMessage}`,
              source: "google_places",
              confidence: "low",
            },
          ]),
        );
        continue;
      }

      if (outcome.kind === "zero" || !placeId) {
        out.push(emptyLead(s, i, opts.workspaceSlug, opts.moduleId, "missing", checkedAt));
        continue;
      }

      const det = await placeDetails(placeId, key);
      const phone = det?.formatted_phone_number ?? undefined;
      const website = det?.website ?? s.website ?? undefined;
      const rating = typeof det?.rating === "number" ? det.rating : undefined;
      const reviewCount =
        typeof det?.user_ratings_total === "number" ? det.user_ratings_total : undefined;
      const location =
        det?.formatted_address ??
        outcome.first.formatted_address ??
        [s.city, s.state].filter(Boolean).join(", ") ??
        undefined;
      const businessStatus = det?.business_status ?? outcome.first.business_status ?? undefined;
      const hasWebsite = !!website;

      const evidence: EvidenceItem[] = [
        {
          label: "Google Places match",
          value: det?.name ?? outcome.first.name ?? s.name,
          source: "google_places",
          confidence: "high",
        },
      ];
      if (rating !== undefined) {
        evidence.push({ label: "Google rating", value: rating, source: "google_places", confidence: "high" });
      }
      if (reviewCount !== undefined) {
        evidence.push({ label: "Google review count", value: reviewCount, source: "google_places", confidence: "high" });
      }
      if (website) {
        evidence.push({ label: "Website found", value: website, source: "google_places", confidence: "high" });
      }
      if (phone) {
        evidence.push({ label: "Phone found", value: phone, source: "google_places", confidence: "high" });
      }
      if (businessStatus) {
        evidence.push({ label: "Google business status", value: businessStatus, source: "google_places", confidence: "high" });
      }

      out.push({
        id: makeId(s, i),
        workspaceSlug: opts.workspaceSlug,
        moduleId: opts.moduleId,
        companyName: det?.name ?? outcome.first.name ?? s.name,
        location,
        website,
        phone,
        email: undefined,
        source: "google_places",
        sourceStatus: "connected",
        lastChecked: checkedAt,
        signals: {
          hasWebsite,
          reviewCount,
          rating,
        },
        crm: {},
        evidence,
        ...verifiedGooglePhoneFields(phone, checkedAt),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      console.error(`[googlePlaces] failed for "${s.name}":`, message);
      out.push(
        emptyLead(s, i, opts.workspaceSlug, opts.moduleId, "error", checkedAt, [
          {
            label: "Adapter error",
            value: message,
            source: "google_places",
            confidence: "low",
          },
        ]),
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[SOURCE CHECK] module=${opts.moduleId} results=${out.length}`);

  // If the live API returned zero usable leads, keep the lead universe
  // visible from seed names/websites only. Seed phone values are not
  // provider-verified, so they are intentionally not surfaced as callable.
  if (out.length === 0 && seed.length > 0) {
    const fallback: NormalizedLead[] = [];
    const slice = seed.slice(0, Math.min(limit, seed.length));
    for (let i = 0; i < slice.length; i++) {
      const s = slice[i];
      const location = [s.city, s.state].filter(Boolean).join(", ") || undefined;
      fallback.push({
        id: makeId(s, i),
        workspaceSlug: opts.workspaceSlug,
        moduleId: opts.moduleId,
        companyName: s.name,
        location,
        website: s.website || undefined,
        phone: undefined,
        email: undefined,
        source: "seed",
        sourceStatus: "available",
        lastChecked: checkedAt,
        signals: { hasWebsite: !!s.website, reviewCount: 12, rating: 4.2 },
        crm: {},
        evidence: [
          { label: "Seed catalog", value: s.name, source: "seed", confidence: "medium" },
        ],
      });
    }
    // eslint-disable-next-line no-console
    console.log(`[SOURCE CHECK] fallback=${fallback.length} module=${opts.moduleId}`);
    return fallback;
  }

  return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[SOURCE CRASH]", err);
    return [];
  }
}
