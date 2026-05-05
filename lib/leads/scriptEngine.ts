// Meridian AI — Bucket-aware Script Engine.
//
// Generates a 1- to 3-line opener for a specific (lead × bucket) combo.
// Pulls live signals off the lead so each script feels written for THIS
// company, not a generic template. Pure: no LLM, no I/O, no fabrication.
//
// Used by the CallNowBar's "Say this:" surface. The AI Coach panel
// still produces a refined pitch on demand; this engine guarantees a
// usable script even when the API is offline.

import type { TradeId } from "../modules/tradeConfigs";
import { TRADE_MODULES } from "../modules/tradeConfigs";

export interface ScriptInputLead {
  name?: string | null;
  companyName?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  reviews?: number | null;
  website?: string | null;
  websiteUrl?: string | null;
  domain?: string | null;
  location?: string | null;
  address?: string | null;
}

export interface CallScript {
  /** One-line opener — verbatim, ≤ 22 words. */
  opener: string;
  /** Value line — what fixing this is worth. ≤ 20 words. */
  value: string;
  /** Closing ask. ≤ 12 words. */
  ask: string;
  /** Joined "say this:" rendition for the CallNowBar single-line surface. */
  oneLine: string;
}

// ── Lead signal helpers ────────────────────────────────────────────────

function firstName(company: string | null | undefined): string {
  if (!company) return "your team";
  const tokens = String(company).split(/\s+/).filter(Boolean);
  return tokens[0] ?? "your team";
}

function reviewsOf(lead: ScriptInputLead): number | null {
  if (typeof lead.reviewCount === "number") return lead.reviewCount;
  if (typeof lead.reviews === "number") return lead.reviews;
  return null;
}

function hasWebsite(lead: ScriptInputLead): boolean {
  return !!(lead.website || lead.websiteUrl || lead.domain);
}

function neighborhood(lead: ScriptInputLead): string | null {
  const addr = lead.address ?? lead.location ?? "";
  if (!addr) return null;
  // Pull the suburb/neighborhood — the second comma chunk usually.
  const parts = String(addr).split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] ?? null;
}

// ── Bucket × signal templates ──────────────────────────────────────────
// Each bucket has multiple openers; we pick the one whose required
// signals are present on the lead. If none match, we fall back to the
// generic opener for the bucket.

interface OpenerTemplate {
  /** Returns the rendered opener if its signals are present, else null. */
  render: (lead: ScriptInputLead, name: string) => string | null;
}

const OPENERS: Record<string, OpenerTemplate[]> = {
  // Roofing
  fix_website: [
    {
      render: (lead, name) => hasWebsite(lead)
        ? `Hey ${name} — pulled your site on mobile and the path to a quote takes too many taps. That's the gap.`
        : null,
    },
    {
      render: (_lead, name) => `Hey ${name} — quick question on your site: is the quote button getting any traction lately?`,
    },
  ],
  website_conversion: [
    {
      render: (lead, name) => hasWebsite(lead)
        ? `Hey ${name} — ran your site and the quote path leaks before submit. Two-minute walk-through?`
        : null,
    },
  ],
  no_website: [
    {
      render: (_lead, name) => `Hey ${name} — saw your Google listing but couldn't find a website. Mind if I show you what you're missing?`,
    },
  ],
  no_website_presence: [
    {
      render: (_lead, name) => `Hey ${name} — your Google listing's solid but there's no website behind it. That's the easiest sale we make.`,
    },
  ],
  google_local_pack: [
    {
      render: (lead, name) => {
        const hood = neighborhood(lead);
        return hood
          ? `Hey ${name} — searched 'roofer near me' from ${hood} and you weren't in the top three. Can fix that.`
          : `Hey ${name} — searched 'roofer near me' from your service area and you weren't in the top three.`;
      },
    },
  ],
  local_seo_visibility: [
    {
      render: (lead, name) => {
        const hood = neighborhood(lead);
        return hood
          ? `Hey ${name} — checked the local pack from ${hood}; your name didn't surface. That's where the inbound is.`
          : `Hey ${name} — checked the local pack from three of your zip codes; your name didn't surface.`;
      },
    },
  ],
  fix_reviews: [
    {
      render: (lead, name) => {
        const r = lead.rating; const n = reviewsOf(lead);
        if (typeof r === "number" && r > 0 && r < 4.6 && typeof n === "number" && n > 0) {
          return `Hey ${name} — you're at ${r.toFixed(1)} with ${n} reviews. Top three around you are 4.8+ with 200+. That gap costs deals.`;
        }
        return null;
      },
    },
    {
      render: (lead, name) => {
        const n = reviewsOf(lead);
        if (typeof n === "number" && n < 30) return `Hey ${name} — ${n} reviews on your profile. Buyers stall there. Quick fix in 60 days.`;
        return null;
      },
    },
    {
      render: (_lead, name) => `Hey ${name} — your review profile is the trust gate before the call. Worth two minutes?`,
    },
  ],
  review_reputation: [
    {
      render: (lead, name) => {
        const r = lead.rating;
        if (typeof r === "number" && r > 0 && r < 4.6) {
          return `Hey ${name} — your rating's at ${r.toFixed(1)}. Buyers default to 4.8+ on tied bids. Two-minute walk-through?`;
        }
        return null;
      },
    },
  ],
  storm_response: [
    {
      render: (lead, name) => {
        const hood = neighborhood(lead);
        return hood
          ? `Hey ${name} — last hail cell hit ${hood} hard. Want to see how the top three around you captured it?`
          : `Hey ${name} — last storm cell hit your zip codes. Want to see how the top three around you captured the search traffic?`;
      },
    },
  ],
  follow_up_quotes: [
    {
      render: (_lead, name) => `Hey ${name} — quick question: when a $12K estimate goes out, who calls them on day three if they go quiet?`,
    },
  ],
  estimate_followup: [
    {
      render: (_lead, name) => `Hey ${name} — when a quote goes out, what's the day-3 follow-up? Most shops don't have one. Big leak there.`,
    },
  ],

  // HVAC
  emergency_visibility: [
    {
      render: (_lead, name) => `Hey ${name} — pulled '24/7 AC' searches in your area; you weren't in the top six. Highest-margin call of the week.`,
    },
  ],
  emergency_service_visibility: [
    {
      render: (_lead, name) => `Hey ${name} — emergency searches at 9pm in your area aren't surfacing your name. That's the call you can't afford to miss.`,
    },
  ],
  seasonal_tune_up_campaign: [
    {
      render: (_lead, name) => `Hey ${name} — first 90-degree day is two weeks out. Are tune-up ads running yet? Your competitor's are.`,
    },
  ],
  seasonal_demand: [
    {
      render: (_lead, name) => `Hey ${name} — next demand cycle is ramping. Want the campaign your top competitor is already running?`,
    },
  ],
  maintenance_membership: [
    {
      render: (_lead, name) => `Hey ${name} — how many maintenance plan members do you have? That's the most leveraged revenue in this trade.`,
    },
  ],
  maintenance_memberships: [
    {
      render: (_lead, name) => `Hey ${name} — quick one: do you offer a maintenance plan? Recurring revenue at 200 members is real money.`,
    },
  ],
  financing_monthly_pricing: [
    {
      render: (_lead, name) => `Hey ${name} — do your install pages show $/month yet? When buyers see "$129/mo" instead of "$8,400" they sign that day.`,
    },
  ],
  financing_visibility: [
    {
      render: (_lead, name) => `Hey ${name} — buyers see a sticker price and choke. $/month copy lifts close rate 15-20%. Cheapest fix you can make.`,
    },
  ],

  // Plumbing
  water_heater_replacement_funnel: [
    {
      render: (_lead, name) => `Hey ${name} — water heater replacement is your highest-ticket emergency. You don't have a landing page for it. That's the leak.`,
    },
  ],
  drain_cleaning_landing: [
    {
      render: (_lead, name) => `Hey ${name} — drain cleaning gets searched 8x more than any other plumbing service. You're invisible for it.`,
    },
  ],

  // Construction
  case_study_pages: [
    {
      render: (_lead, name) => `Hey ${name} — when an owner Googles you before sending an RFP, the case-study page is what gets you shortlisted. You have three project photos.`,
    },
  ],
  rfp_intake_system: [
    {
      render: (_lead, name) => `Hey ${name} — RFPs land in an inbox, get lost. A real intake form doubles closure on what's already coming in.`,
    },
  ],
  active_pipeline_page: [
    {
      render: (_lead, name) => `Hey ${name} — owners shortlist based on momentum. Your site shows nothing about active projects. Quick fix.`,
    },
  ],

  // Landscaping
  spring_cleanup_campaign: [
    {
      render: (_lead, name) => `Hey ${name} — first warm weekend is three weeks out. Cleanup ads should be running already. Want the playbook?`,
    },
  ],
  weekly_maintenance_contract: [
    {
      render: (_lead, name) => `Hey ${name} — how many weekly maintenance contracts do you have? Foundation revenue. Easy to double.`,
    },
  ],
};

const DEFAULT_OPENER = (name: string) =>
  `Hey ${name} — got 60 seconds? Found a gap on your Google profile worth a quick call.`;

// ── Value + Ask templates by tier (light, generic, never invents) ─────

function defaultValue(bucketId: string, tradeId: TradeId): string {
  const cfg = TRADE_MODULES[tradeId]?.serviceBuckets.find((b) => b.id === bucketId);
  if (cfg?.johnServiceAngle) {
    return `Most ${tradeId} shops we work with fix it by ${cfg.johnServiceAngle.toLowerCase().replace(/\.$/, "")}.`;
  }
  return `Most shops fix it in 30 days and start seeing inbound lift the same week.`;
}

const DEFAULT_ASK = "Worth a 10-minute walk-through later this week?";

// ── Public API ─────────────────────────────────────────────────────────

export function generateCallScript(
  lead: ScriptInputLead | null | undefined,
  bucketId: string | null | undefined,
  tradeId: TradeId,
): CallScript {
  const company = lead?.name ?? lead?.companyName ?? "";
  const name = firstName(company);
  let opener: string | null = null;
  if (bucketId && OPENERS[bucketId]) {
    for (const tpl of OPENERS[bucketId]) {
      const rendered = tpl.render(lead ?? {}, name);
      if (rendered && rendered.trim().length > 0) {
        opener = rendered.trim();
        break;
      }
    }
  }
  if (!opener) opener = DEFAULT_OPENER(name);

  const value = defaultValue(bucketId ?? "", tradeId);
  const ask = DEFAULT_ASK;
  const oneLine = opener.replace(/\s+/g, " ").trim();

  return { opener, value, ask, oneLine };
}
