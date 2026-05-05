// Meridian — LaborTech service catalog.
//
// Single source of truth for the services LaborTech actually sells.
// Trade modules read from this catalog; opportunity mappings reference
// these ids; the AI assistant pulls the labels and outcomes verbatim.
//
// Adding a new service is an explicit edit here. Never invent ids in
// downstream files.

export type ServicePriorityRole =
  | "core"          // foundational — hard to sell anything else without it
  | "conversion"    // turns existing traffic into booked work
  | "retention"     // keeps customers engaged after first job
  | "automation"    // removes operator effort
  | "awareness";    // top-of-funnel reach

export type ServiceRelevance = "high" | "medium" | "low";

// Backwards-compat alias — older opportunity mappings used `RevenueRole`.
export type RevenueRole = ServiceRelevance;

export type ServiceConfig = {
  id: string;
  label: string;
  description: string;
  outcome: string;
  priorityRole: ServicePriorityRole;
  defaultRelevance: ServiceRelevance;
  // Calendar visualization metadata. Used to color-code calendar
  // cards by service-need without redesigning the calendar grid.
  shortLabel: string;        // 1–2 word abbreviation for pills
  calendarColor: string;     // accent (left border / dot)
  calendarAccent: string;    // soft background for pills
};

export const SERVICES: ServiceConfig[] = [
  {
    id: "website_funnel",
    label: "Website & Funnel Development",
    description: "Build or rebuild the website and the quote-funnel path.",
    outcome: "First credible web presence with a quote path that actually books.",
    priorityRole: "core",
    defaultRelevance: "high",
    shortLabel: "Website",
    calendarColor: "#2563EB",
    calendarAccent: "#DBEAFE",
  },
  {
    id: "seo",
    label: "SEO",
    description: "Local + on-page SEO so the business ranks for high-intent searches.",
    outcome: "Wins the local pack and organic search for the neighborhoods that matter.",
    priorityRole: "awareness",
    defaultRelevance: "high",
    shortLabel: "SEO",
    calendarColor: "#16A34A",
    calendarAccent: "#DCFCE7",
  },
  {
    id: "google_ads",
    label: "Google Advertising",
    description: "Paid Google search and Local Services Ads.",
    outcome: "Captures urgent and high-intent searches today, not in six months.",
    priorityRole: "awareness",
    defaultRelevance: "high",
    shortLabel: "Google Ads",
    calendarColor: "#DC2626",
    calendarAccent: "#FEE2E2",
  },
  {
    id: "meta_ads",
    label: "Meta Advertising",
    description: "Facebook + Instagram paid social with portfolio + offer creative.",
    outcome: "Top-of-funnel reach for visual trades and seasonal demand pushes.",
    priorityRole: "awareness",
    defaultRelevance: "medium",
    shortLabel: "Meta Ads",
    calendarColor: "#7C3AED",
    calendarAccent: "#EDE9FE",
  },
  {
    id: "social_media_management",
    label: "Social Media Management",
    description: "Organic posting cadence, content calendar, community response.",
    outcome: "Keeps proof and project work visible so referrals close faster.",
    priorityRole: "awareness",
    defaultRelevance: "medium",
    shortLabel: "Social",
    calendarColor: "#DB2777",
    calendarAccent: "#FCE7F3",
  },
  {
    id: "email_sms",
    label: "Email & SMS Marketing",
    description: "Follow-up cadences, seasonal pushes, win-back, membership renewals.",
    outcome: "Recovers cold quotes and lifts repeat revenue without rep effort.",
    priorityRole: "retention",
    defaultRelevance: "medium",
    shortLabel: "Email/SMS",
    calendarColor: "#0D9488",
    calendarAccent: "#CCFBF1",
  },
  {
    id: "crm",
    label: "CRM",
    description: "Pipeline + lead-handling system with status, follow-ups, and notes.",
    outcome: "No lead falls through the cracks; every estimate has an owner.",
    priorityRole: "core",
    defaultRelevance: "high",
    shortLabel: "CRM",
    calendarColor: "#4F46E5",
    calendarAccent: "#E0E7FF",
  },
  {
    id: "appointment_scheduler",
    label: "Appointment Scheduler",
    description: "Online booking with availability, confirmations, and reminders.",
    outcome: "Books service calls and consults without a back-and-forth phone tag.",
    priorityRole: "conversion",
    defaultRelevance: "high",
    shortLabel: "Booking",
    calendarColor: "#D97706",
    calendarAccent: "#FEF3C7",
  },
  {
    id: "reputation_management",
    label: "Reputation Management",
    description: "Review automation, response cadence, trust-signal cleanup.",
    outcome: "Higher star rating + review velocity that buyers vet before calling.",
    priorityRole: "conversion",
    defaultRelevance: "high",
    shortLabel: "Reviews",
    calendarColor: "#CA8A04",
    calendarAccent: "#FEF9C3",
  },
  {
    id: "lead_generation",
    label: "Lead Generation",
    description: "Targeted lead acquisition outside the company's organic footprint.",
    outcome: "Net-new pipeline that doesn't depend on existing search rank.",
    priorityRole: "awareness",
    defaultRelevance: "medium",
    shortLabel: "Lead Gen",
    calendarColor: "#475569",
    calendarAccent: "#F1F5F9",
  },
  {
    id: "blog_posting",
    label: "Blog Posting",
    description: "SEO-aligned blog content: service explainers, seasonal posts, city pages.",
    outcome: "Compounding organic traffic for long-tail and education searches.",
    priorityRole: "awareness",
    defaultRelevance: "low",
    shortLabel: "Blog",
    calendarColor: "#0891B2",
    calendarAccent: "#CFFAFE",
  },
  {
    id: "chat_ai_agent",
    label: "Chat AI Agent",
    description: "Website chat agent that qualifies, books, and handles common questions.",
    outcome: "Captures after-hours leads and shortens the path to a booked call.",
    priorityRole: "automation",
    defaultRelevance: "medium",
    shortLabel: "Chat AI",
    calendarColor: "#059669",
    calendarAccent: "#D1FAE5",
  },
  {
    id: "voice_ai_agent",
    label: "Voice AI Agent System",
    description: "AI voice answering for after-hours, overflow, and triage calls.",
    outcome: "Catches every emergency call without paying a 24/7 dispatcher.",
    priorityRole: "automation",
    defaultRelevance: "medium",
    shortLabel: "Voice AI",
    calendarColor: "#6D28D9",
    calendarAccent: "#DDD6FE",
  },
  {
    id: "media_production",
    label: "Media Production",
    description: "Project photography, video walkthroughs, before/after assets.",
    outcome: "Real proof assets that make portfolio and ad creative actually convert.",
    priorityRole: "conversion",
    defaultRelevance: "medium",
    shortLabel: "Media",
    calendarColor: "#E11D48",
    calendarAccent: "#FFE4E6",
  },
  {
    id: "influencer_marketing",
    label: "Influencer Marketing",
    description: "Local creator partnerships for visual or lifestyle trades.",
    outcome: "Targeted reach in markets where social proof drives decisions.",
    priorityRole: "awareness",
    defaultRelevance: "low",
    shortLabel: "Influencer",
    calendarColor: "#C026D3",
    calendarAccent: "#FAE8FF",
  },
  {
    id: "mobile_app",
    label: "Mobile App",
    description: "Branded mobile app for repeat-customer engagement.",
    outcome: "High-touch retention surface for businesses with recurring service.",
    priorityRole: "retention",
    defaultRelevance: "low",
    shortLabel: "Mobile App",
    calendarColor: "#6B7280",
    calendarAccent: "#F3F4F6",
  },
];

const BY_ID = new Map<string, ServiceConfig>(SERVICES.map((s) => [s.id, s]));

export function getService(id: string): ServiceConfig | null {
  return BY_ID.get(id) ?? null;
}

export function listServices(ids: readonly string[]): ServiceConfig[] {
  const out: ServiceConfig[] = [];
  for (const id of ids) {
    const s = BY_ID.get(id);
    if (s) out.push(s);
  }
  return out;
}
