// Meridian AI — batch_resolve_contacts tool.
//
// Walks persisted snapshots and populates real contact data by calling the
// existing resolveContact() waterfall on each one. Persists the full
// ContactResolution into the snapshot via upsertContactResolution so
// first-render UI has durable, real contacts without a client round trip.
//
// REUSE: resolveContact is the single waterfall — this tool orchestrates,
// it does not duplicate resolution logic.
//
// Selection rules (run on candidates that need real work):
//   - snapshot has no contactResolution yet
//   - OR its contactResolutionCheckedAt is older than staleDays
//   - AND it is not in a final status (CLOSED_*, ARCHIVED)
//
// Honors env-driven providers. If no keys are configured, the waterfall
// returns the "empty" result for each and we still persist that outcome so
// the UI can render "Search complete — no contact found" instead of an
// ambiguous loading state.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listSnapshots, upsertContactResolution } from "@/lib/state/companySnapshotStore";
import { resolveContact } from "@/lib/contacts/resolver";
import type { ContactResolution } from "@/lib/contacts/types";

export type BatchResolveContactsInput = {
  limit?: number;               // max companies to resolve (default 25)
  concurrency?: number;          // parallel workers (default 3, max 6)
  staleDays?: number;            // re-resolve if older than this (default 14; 0 = always)
  onlyMissing?: boolean;         // if true, only hit companies with no resolution yet (default true)
  keys?: string[];               // optional explicit list of snapshot keys to target
};

export type BatchResolveContactsData = {
  considered: number;
  processed: number;
  withPhone: number;
  withEmail: number;
  withFallback: number;
  empty: number;
  failures: Array<{ key: string; name: string; error: string }>;
};

const FINAL_STATUSES = new Set(["CLOSED_WON", "CLOSED_LOST", "ARCHIVED"]);

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

function parseLocation(loc?: string): { city: string; state: string } {
  if (!loc) return { city: "", state: "" };
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "" };
  if (parts.length === 1) return { city: parts[0], state: "" };
  return { city: parts[0], state: parts[parts.length - 1] };
}

async function handler(input: BatchResolveContactsInput): Promise<ToolResult<BatchResolveContactsData>> {
  const timestamp = nowIso();
  const limit = Math.max(1, Math.min(500, input.limit ?? 25));
  const concurrency = Math.max(1, Math.min(6, input.concurrency ?? 3));
  const staleDays = input.staleDays ?? 14;
  const onlyMissing = input.onlyMissing ?? true;

  const snaps = await listSnapshots();
  const keySet = input.keys?.length ? new Set(input.keys) : null;

  // Which skip reasons were recorded previously but no longer apply? If a
  // stored resolution failed because "google_skipped_no_key" and the key is
  // now present, the staleness guard should not block re-hydration.
  const nowAvailable = new Set<string>();
  if (process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY) nowAvailable.add("google_skipped_no_key");
  if (process.env.YELP_API_KEY) nowAvailable.add("yelp_skipped_no_key");
  if (process.env.BBB_SEARCH_URL) nowAvailable.add("bbb_skipped_no_endpoint");
  if (process.env.FACEBOOK_SEARCH_URL) nowAvailable.add("facebook_skipped_no_endpoint");

  const candidates = snaps.filter((s) => {
    if (keySet && !keySet.has(s.key)) return false;
    const status = (s.status ?? "").toUpperCase();
    if (FINAL_STATUSES.has(status)) return false;
    if (!s.contactResolution) return true;                // never resolved
    if (onlyMissing && s.contactResolution.phone) return false; // already has a phone

    // If the previous run skipped providers that are now configured, ignore
    // the staleDays guard and re-resolve — the reason for failure is gone.
    const storedSkipped = s.contactResolution.skippedSources ?? [];
    const previouslySkippedNowAvailable = storedSkipped.some((r) => nowAvailable.has(r));
    if (previouslySkippedNowAvailable) return true;

    const age = daysSince(s.contactResolutionCheckedAt);
    if (age !== null && age < staleDays) return false;    // fresh enough
    return true;
  }).slice(0, limit);

  let withPhone = 0;
  let withEmail = 0;
  let withFallback = 0;
  let empty = 0;
  const failures: BatchResolveContactsData["failures"] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const idx = cursor++;
      const snap = candidates[idx];
      try {
        const { city, state } = parseLocation(snap.company.location ?? snap.profile?.location);
        // Fold in site-extracted signals from the most recent inspect_website
        // so the waterfall benefits without extra plumbing.
        const ws = snap.latest?.["inspect_website"]?.data as
          | {
              phone_from_site?: string | null;
              email_from_site?: string | null;
              emails_from_site?: Array<{ email: string; method: string; page: string }>;
              finalUrl?: string | null;
              has_contact_form?: boolean;
            }
          | undefined;
        const result: ContactResolution = await resolveContact({
          companyName: snap.company.name,
          city,
          state,
          category: "roofing",
          website: ws?.finalUrl ?? snap.company.url ?? snap.company.domain ?? snap.profile?.url,
          phone: ws?.phone_from_site ?? undefined,
          email: ws?.email_from_site ?? undefined,
          // SiteEmailMethod strings are a subset of the BusinessInput
          // siteEmails literal union — safe to pass through.
          siteEmails: ws?.emails_from_site as Parameters<typeof resolveContact>[0]["siteEmails"] ?? undefined,
          hasContactForm: ws?.has_contact_form ?? undefined,
        });
        await upsertContactResolution(snap.company, result);
        if (result.phone) withPhone++;
        if (result.email) withEmail++;
        if (result.fallbackUrl && !result.phone) withFallback++;
        if (!result.phone && !result.email && !result.fallbackUrl) empty++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "resolve failed";
        failures.push({ key: snap.key, name: snap.company.name, error: msg });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    tool: "batch_resolve_contacts",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "batch_run",
        source: "batchResolveContacts",
        observedAt: timestamp,
        detail: `considered=${candidates.length} withPhone=${withPhone} withFallback=${withFallback} empty=${empty} failures=${failures.length} concurrency=${concurrency}`,
      },
      ...failures.slice(0, 5).map((f) => ({
        kind: "batch_failure",
        source: "batchResolveContacts",
        observedAt: timestamp,
        detail: `${f.name}: ${f.error.slice(0, 160)}`,
      })),
    ],
    data: {
      considered: candidates.length,
      processed: candidates.length,
      withPhone,
      withEmail,
      withFallback,
      empty,
      failures,
    },
    stub: false,
    notes: [
      "Reuses resolveContact() — the single waterfall. Does not create a parallel resolver.",
      "Gracefully no-ops when no provider keys are configured (each call returns empty; result persists).",
      "onlyMissing=true avoids re-running on companies that already have a phone on file.",
    ],
  };
}

export const batchResolveContactsTool: ToolDefinition<BatchResolveContactsInput, BatchResolveContactsData> = {
  name: "batch_resolve_contacts",
  description:
    "Populates real contact data for roofing leads by calling the existing resolveContact() waterfall across persisted snapshots. Persists the full ContactResolution into each snapshot so first-render UI has durable contact paths.",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max companies to resolve (default 25, max 500)" },
      concurrency: { type: "number", description: "Parallel workers (default 3, max 6)" },
      staleDays: { type: "number", description: "Skip snapshots resolved more recently than this (default 14; 0 = always)" },
      onlyMissing: { type: "boolean", description: "Only target companies without a phone on file (default true)" },
      keys: {
        type: "array",
        description: "Optional list of snapshot keys to restrict the run to",
      },
    },
    additionalProperties: false,
  },
  handler,
};
