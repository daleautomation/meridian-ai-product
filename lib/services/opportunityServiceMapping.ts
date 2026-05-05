// Meridian — opportunity (bucket) → LaborTech service mapping.
//
// The bridge between the legacy opportunity-bucket vocabulary and the
// new LaborTech service catalog. UI surfaces should read the new
// service ids; the legacy bucket ids stay as internal reasons.

import type { ServiceRelevance } from "./serviceCatalog";

export type OpportunityMappingEntry = {
  id: string;            // bucket id (matches lib/modules/tradeConfigs serviceBuckets)
  label: string;         // operator-facing label
  services: string[];    // LaborTech service ids — resolve via lib/services/serviceCatalog
  revenueImpact: ServiceRelevance;
  why: string;           // one-line, plain English, sales-ready
};

export const OPPORTUNITY_MAP: Record<string, OpportunityMappingEntry> = {
  // ── Roofing ────────────────────────────────────────────────────────
  no_website_presence: {
    id: "no_website_presence",
    label: "No website presence",
    services: ["website_funnel", "seo"],
    revenueImpact: "high",
    why: "Stand up a credible site so the funnel has somewhere to land traffic.",
  },
  website_conversion: {
    id: "website_conversion",
    label: "Website conversion gap",
    services: ["website_funnel"],
    revenueImpact: "medium",
    why: "Tighten the existing site so the same traffic books more quotes.",
  },
  storm_response: {
    id: "storm_response",
    label: "Storm response capture",
    services: ["google_ads", "seo"],
    revenueImpact: "high",
    why: "Storm work is urgent — Google ads + SEO capture the call right when it's hot.",
  },
  estimate_followup: {
    id: "estimate_followup",
    label: "Estimate follow-up",
    services: ["crm", "email_sms"],
    revenueImpact: "medium",
    why: "Cold quotes recover with a 3-day / 7-day automated cadence.",
  },

  // ── Shared (roofing / hvac / plumbing) ─────────────────────────────
  local_seo_visibility: {
    id: "local_seo_visibility",
    label: "Local SEO visibility",
    services: ["seo"],
    revenueImpact: "high",
    why: "Win the local pack and the map listing for the neighborhoods that drive demand.",
  },
  review_reputation: {
    id: "review_reputation",
    label: "Reviews & reputation",
    services: ["reputation_management"],
    revenueImpact: "high",
    why: "Reputation gap is the biggest converter — buyers compare star count and recency before calling.",
  },

  // ── HVAC ───────────────────────────────────────────────────────────
  seasonal_demand: {
    id: "seasonal_demand",
    label: "Seasonal demand capture",
    services: ["google_ads", "seo", "email_sms"],
    revenueImpact: "medium",
    why: "Heat-wave or cold-snap demand needs paid + SEO + retention before the wave.",
  },
  emergency_service_visibility: {
    id: "emergency_service_visibility",
    label: "Emergency service visibility",
    services: ["google_ads", "seo", "appointment_scheduler"],
    revenueImpact: "high",
    why: "Urgent searches are the highest-converting traffic — capture and book them in one flow.",
  },
  maintenance_memberships: {
    id: "maintenance_memberships",
    label: "Membership program",
    services: ["email_sms", "crm"],
    revenueImpact: "medium",
    why: "Memberships need a renewal cadence and a CRM that tracks them.",
  },
  financing_visibility: {
    id: "financing_visibility",
    label: "Financing visibility",
    services: ["website_funnel", "google_ads"],
    revenueImpact: "medium",
    why: "Financing CTA on the funnel + paid search lifts ticket size on bigger jobs.",
  },

  // ── Carpentry ──────────────────────────────────────────────────────
  portfolio_visibility: {
    id: "portfolio_visibility",
    label: "Portfolio visibility",
    services: ["media_production", "social_media_management"],
    revenueImpact: "medium",
    why: "Buyers vet specialty carpentry on photos before they pick up the phone.",
  },
  quote_request_funnel: {
    id: "quote_request_funnel",
    label: "Quote request funnel",
    services: ["website_funnel", "crm"],
    revenueImpact: "medium",
    why: "Tighten the quote path and route every request into a real CRM.",
  },
  project_photography: {
    id: "project_photography",
    label: "Project photography",
    services: ["media_production"],
    revenueImpact: "low",
    why: "Real project photos beat stock or phone photos every time.",
  },
  niche_specialty_positioning: {
    id: "niche_specialty_positioning",
    label: "Niche / specialty positioning",
    services: ["website_funnel", "seo"],
    revenueImpact: "medium",
    why: "Specialty positioning + ranking pages stop the price race against generic carpentry shops.",
  },

  // ── Painting ───────────────────────────────────────────────────────
  exterior_repaint_visibility: {
    id: "exterior_repaint_visibility",
    label: "Exterior repaint visibility",
    services: ["website_funnel", "google_ads", "seo"],
    revenueImpact: "high",
    why: "Seasonal exterior repaint is the highest-volume painting lane — capture it across landing + paid + organic.",
  },
  cabinet_painting_demand: {
    id: "cabinet_painting_demand",
    label: "Cabinet painting demand",
    services: ["website_funnel", "google_ads", "meta_ads", "media_production"],
    revenueImpact: "high",
    why: "Cabinet repaint is the highest-margin lane — needs landing + ads + real photos.",
  },
  commercial_painting_visibility: {
    id: "commercial_painting_visibility",
    label: "Commercial painting visibility",
    services: ["website_funnel", "lead_generation"],
    revenueImpact: "high",
    why: "Facility-manager RFPs win multi-year revenue with positioning + outbound pipeline.",
  },
  reputation_proof: {
    id: "reputation_proof",
    label: "Reputation & proof",
    services: ["reputation_management", "social_media_management"],
    revenueImpact: "medium",
    why: "Buyers compare three painters on reviews and gallery photos before they call.",
  },

  // ── Plumbing ───────────────────────────────────────────────────────
  service_page_gaps: {
    id: "service_page_gaps",
    label: "Service page gaps",
    services: ["website_funnel", "seo"],
    revenueImpact: "medium",
    why: "Per-service pages rank for the high-intent searches the business can win today.",
  },

  // ── Electrical ─────────────────────────────────────────────────────
  emergency_electrical_visibility: {
    id: "emergency_electrical_visibility",
    label: "Emergency electrical visibility",
    services: ["google_ads", "seo", "appointment_scheduler"],
    revenueImpact: "high",
    why: "Outage and after-hours searches are the top conversion lane — capture and book them in one flow.",
  },
  panel_upgrade_demand: {
    id: "panel_upgrade_demand",
    label: "Panel upgrade demand",
    services: ["website_funnel", "google_ads"],
    revenueImpact: "high",
    why: "Panel upgrade is a $5–15K ticket — landing page + paid search captures the research traffic.",
  },
  ev_charger_installation: {
    id: "ev_charger_installation",
    label: "EV charger installation",
    services: ["website_funnel", "google_ads", "seo"],
    revenueImpact: "medium",
    why: "EV charger search volume rises every quarter — landing + paid + organic owns the rebate-research phase.",
  },
  commercial_electrical_visibility: {
    id: "commercial_electrical_visibility",
    label: "Commercial electrical visibility",
    services: ["website_funnel", "lead_generation"],
    revenueImpact: "high",
    why: "Facility managers vet electrical vendors online before issuing maintenance RFPs.",
  },
};

export function getOpportunityMapping(bucketId: string | null | undefined): OpportunityMappingEntry | null {
  if (!bucketId) return null;
  return OPPORTUNITY_MAP[bucketId] ?? null;
}
