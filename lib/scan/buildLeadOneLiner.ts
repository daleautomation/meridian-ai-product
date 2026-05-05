// Meridian — per-lead one-liner generator for the calendar card / nextAction.
//
// Replaces the previous templated "Call now and lead with the X angle" copy
// with short, varied, company-specific sentences keyed off:
//   • trade           (lead.moduleId)
//   • service bucket  (scan.primaryService)
//   • primary pain    (scan.primaryPain)
//   • review count, rating, website presence, location
//
// Pure / deterministic. The variant is picked from a stable FNV-1a hash of
// the lead id + companyName, so the same lead renders the same sentence on
// every reload.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import type { LeadDiagnostics } from "@/lib/diagnostics/leadDiagnostics";

type BucketKey =
  | "websiteConversion"
  | "reviews"
  | "seo"
  | "media"
  | "seasonalDemand"
  | "fallback";

type OneLinerScan = {
  primaryService?: string | null;
  primaryPain?: string | null;
};

const FALLBACK_LINE = "This lead has a clear digital gap worth opening with.";

function hashSeed(lead: NormalizedLead): number {
  const seed = `${lead?.id ?? ""}|${lead?.companyName ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function pickFrom<T>(pool: T[], seed: number): T | undefined {
  if (!Array.isArray(pool) || pool.length === 0) return undefined;
  const idx = ((Math.trunc(seed) % pool.length) + pool.length) % pool.length;
  return pool[idx];
}

function bucketFor(scan: OneLinerScan | null | undefined, lead: NormalizedLead): BucketKey {
  const svc = (scan?.primaryService ?? "").toString().toLowerCase();
  if (svc.includes("website") || svc.includes("conversion") || svc.includes("follow-up")) {
    return "websiteConversion";
  }
  if (svc.includes("review")) return "reviews";
  if (svc.includes("seo")) return "seo";
  if (svc.includes("paid") || svc.includes("ad") || svc.includes("media")) return "media";
  if (svc.includes("season")) return "seasonalDemand";
  // Trade-driven hint when service is missing/diagnostic-only.
  if (lead?.moduleId === "hvac" || lead?.moduleId === "roofing") {
    if (lead?.signals?.stormArea === true || lead?.signals?.emergencyServiceGap === true) {
      return "seasonalDemand";
    }
  }
  return "fallback";
}

function tradeNoun(lead: NormalizedLead): string {
  switch (lead?.moduleId) {
    case "hvac":      return "HVAC";
    case "roofing":   return "roofing";
    case "plumbing":  return "plumbing";
    case "remodeling":return "remodeling";
    default:          return "trade";
  }
}

type Ctx = {
  trade: string;
  pain: string | null;
  reviewCount: number | null;
  rating: number | null;
  hasWebsite: boolean;
  location: string | null;
};

function buildCtx(lead: NormalizedLead, scan: OneLinerScan | null | undefined): Ctx {
  const s = lead?.signals ?? {};
  const reviewCount = typeof s.reviewCount === "number" ? s.reviewCount : null;
  const rating = typeof s.rating === "number" ? s.rating : null;
  const hasWebsite = s.hasWebsite === true || (!!lead?.website && lead.website.length > 0);
  return {
    trade: tradeNoun(lead),
    pain: scan?.primaryPain ?? null,
    reviewCount,
    rating,
    hasWebsite,
    location: lead?.location ?? null,
  };
}

type LineBuilder = (ctx: Ctx) => string;

const POOLS: Record<BucketKey, LineBuilder[]> = {
  websiteConversion: [
    ({ trade, location }) =>
      location
        ? `Lead with lost demand: ${trade} buyers in ${location} can find them, but there's no clear path to request work.`
        : `Lead with lost demand: customers can find them, but there's no clear path to request work.`,
    ({ trade }) =>
      `Open with the funnel leak — the ${trade} listing pulls clicks, then the visit ends with nothing to do next.`,
    ({ hasWebsite }) =>
      hasWebsite
        ? `Lead with conversion friction: the site loads, but quote requests aren't surviving the path between landing and submit.`
        : `Lead with the missing destination: every search visit pays out, then disappears because there's nowhere to leave a number.`,
    ({ trade, location }) =>
      location
        ? `Open with: ${trade} demand in ${location} is already there — the bottleneck is what happens in the 10 seconds after a click.`
        : `Open with: demand is already there — the bottleneck is what happens in the 10 seconds after a click.`,
    () => `Lead with: the calendar fills from inbound, but the inbound path is the leak — fix it once, the rest compounds.`,
  ],
  reviews: [
    ({ reviewCount }) =>
      reviewCount !== null
        ? `Lead with credibility: ${reviewCount} reviews makes stronger competitors look safer online before anyone even reads price.`
        : `Lead with credibility: their review count makes stronger competitors look safer online before anyone even reads price.`,
    ({ rating, reviewCount }) =>
      rating !== null && reviewCount !== null
        ? `Open with the math: ${rating}★ on ${reviewCount} reviews puts them in the second cut while the top crews capture the click.`
        : `Open with the math: comparison shoppers filter on count + recency before they ever read a single review.`,
    ({ trade }) =>
      `Lead with the Saturday-morning test: when a homeowner needs ${trade} now, they call whoever has the most recent reviews.`,
    () =>
      `Open with: same craftsmanship at thin review volume reads as "new" — that perception gap is faster to close than a quality gap.`,
    ({ reviewCount }) =>
      reviewCount !== null && reviewCount < 30
        ? `Lead with the filter problem: under ${reviewCount} reviews and most comparison shoppers cut them before the first click.`
        : `Lead with the filter problem: most comparison shoppers cut on review count before the first click.`,
  ],
  seo: [
    ({ trade, location }) =>
      location
        ? `Lead with invisibility: people Googling ${trade} in ${location} aren't seeing them — they're seeing the next guy.`
        : `Lead with invisibility: people Googling ${trade} aren't seeing them — they're seeing the next guy.`,
    () =>
      `Open with the map-pack math: three competitors own the top slots; that's three calls a day going somewhere else.`,
    ({ trade }) =>
      `Lead with: the high-intent ${trade} queries that actually book work aren't surfacing them. The work's there — the door isn't.`,
    ({ location }) =>
      location
        ? `Open with: the urgency searches in ${location} default to whoever ranks. Right now that's a competitor.`
        : `Open with: the urgency searches default to whoever ranks. Right now that's a competitor.`,
    () =>
      `Lead with the local-pack lever: the top three results capture roughly 70% of clicks; outside that, inbound is a thin slice.`,
  ],
  media: [
    ({ trade }) =>
      `Lead with placement: paid spots above the ${trade} map pack convert higher than organic at the urgency end of the funnel.`,
    () =>
      `Open with the lever: a small paid budget on the right queries shifts month-over-month job count without touching ops.`,
    ({ trade, location }) =>
      location
        ? `Lead with: ${trade} demand in ${location} is being captured by whoever pays to surface above the pack.`
        : `Lead with: demand is being captured by whoever pays to surface above the pack.`,
    () =>
      `Open with: the queries that turn into booked jobs are auctioned hourly — sitting them out hands the share to a competitor.`,
    ({ pain }) =>
      pain
        ? `Lead with: paid placement targets the exact moment of intent — direct lever on the gap "${pain.toLowerCase()}".`
        : `Lead with: paid placement targets the exact moment of intent — direct lever on monthly job count.`,
  ],
  seasonalDemand: [
    ({ trade }) =>
      `Lead with the window: ${trade} demand spikes in the next 6–10 weeks; the question is who captures it.`,
    ({ location, trade }) =>
      location
        ? `Open with: storm season is already moving through ${location} — the ${trade} crew with the cleanest path wins the wave.`
        : `Open with: storm season is already moving — the ${trade} crew with the cleanest path wins the wave.`,
    () =>
      `Lead with: pre-peak fixes compound for the entire season. Mid-peak fixes only recover what's left — the economics differ by 3–5x.`,
    ({ trade }) =>
      `Open with the timing: every week without a clean booking path is ${trade} jobs going to whoever's faster online.`,
    () =>
      `Lead with: the season's already turning — calls bunch in 48-hour windows, and the funnel either absorbs them or it doesn't.`,
  ],
  fallback: [
    () => FALLBACK_LINE,
    ({ trade }) => `Open with the ${trade} angle: there's a clear digital gap worth opening on this lead.`,
    ({ pain }) =>
      pain
        ? `Lead with: ${pain.toLowerCase().replace(/\.$/, "")} — that's the cleanest opening on this lead.`
        : FALLBACK_LINE,
    ({ location }) =>
      location
        ? `Open with the ${location} angle: there's a usable gap to lead with on this one.`
        : FALLBACK_LINE,
  ],
};

/**
 * Build the per-lead one-liner shown on the calendar card / nextAction.
 *
 * Deterministic: same `lead.id` (or company name) always picks the same
 * variation. Defensive: any missing input or thrown exception falls
 * through to the safe fallback line — never throws.
 */
export function buildLeadOneLiner(
  lead: NormalizedLead | null | undefined,
  scan: OneLinerScan | null | undefined,
  _diagnostics?: LeadDiagnostics | null,
): string {
  try {
    if (!lead || !lead.companyName) return FALLBACK_LINE;
    const ctx = buildCtx(lead, scan);
    const bucket = bucketFor(scan, lead);
    const pool = POOLS[bucket] ?? POOLS.fallback;
    const seed = hashSeed(lead);
    const builder = pickFrom(pool, seed);
    if (typeof builder !== "function") return FALLBACK_LINE;
    const line = builder(ctx);
    if (typeof line !== "string" || line.trim().length === 0) return FALLBACK_LINE;
    return line.trim();
  } catch {
    return FALLBACK_LINE;
  }
}
