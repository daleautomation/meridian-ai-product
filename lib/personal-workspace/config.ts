// Meridian Personal Workspace — labels, navigation, and calm visual tokens.
// Intentionally separate from LaborTech operator terminology.

export type PersonalNavId =
  | "priority"
  | "all"
  | "follow-ups"
  | "insights"
  | "dormant"
  | "missing";

export const PERSONAL_NAV: Array<{
  id: PersonalNavId;
  label: string;
  description: string;
}> = [
  {
    id: "priority",
    label: "Priority Contacts",
    description: "Relationships that deserve attention first, ranked by strength and timing.",
  },
  {
    id: "all",
    label: "All Contacts",
    description: "Your full network from CRM import — browse, filter, and open context.",
  },
  {
    id: "follow-ups",
    label: "Follow-Ups",
    description: "Promised or implied follow-ups before momentum fades.",
  },
  {
    id: "insights",
    label: "Relationship Insights",
    description: "Score explanations from import and enrichment — not fabricated intelligence.",
  },
  {
    id: "dormant",
    label: "Dormant Opportunities",
    description: "High-value relationships that went quiet — worth a thoughtful reopen.",
  },
  {
    id: "missing",
    label: "Missing Information",
    description: "Contacts that need enrichment before outreach is safe.",
  },
];

export const PERSONAL_COPY_DEFAULTS = {
  eyebrow: "Brookside Real Estate relationship workspace",
  title: "Nicole Lonergan Workspace",
  subtitle: "Stay close to the people who matter — relationship intelligence without trade or operator noise.",
  heroFocus: "Today's focus",
  importCta: "Import contacts",
  emptyContacts: "Import your CRM to see contacts here.",
  emptyPriority:
    "After import, your strongest relationships surface here — ranked by score, recency, and follow-up timing.",
  emptyFollowUps:
    "Follow-ups appear when a touch is overdue or a promise is still open. Email and last-activity dates count even without phone numbers.",
  emptyDormant:
    "Dormant opportunities are high-value relationships that went quiet. They resurface from history and scores, not call volume.",
  emptyMissing:
    "Contacts land here when reachability or trust gaps block safe outreach. Email-only relationships stay workable — we never invent phone numbers.",
  emptyInsights:
    "Relationship insights explain why each contact matters and what signal drove their score.",
  strengthLabel: "Relationship strength",
  templateNote: "Template suggestion from import data — not a verified insight.",
  scoringBasisTitle: "Scoring basis",
  reachOut: "Reach out",
  sendNote: "Send a note",
  followUp: "Follow up",
  reviewContext: "Review context",
  enrichFirst: "Enrich first",
  noPhoneExplanation:
    "No phone on file from your CRM export. Phone trust shows MISSING because nothing was mapped or guessed — email and interaction history are your resurfacing paths.",
  emailPrimaryBadge: "Email-first",
  activityMemoryTitle: "Activity memory",
  resurfacingTitle: "Worth resurfacing",
} as const;

export function personalCopyForWorkspace(branding?: {
  displayName?: string;
  accentLabel?: string;
  companyName?: string;
}) {
  const name = branding?.displayName ?? "Nicole Lonergan Workspace";
  const accent = branding?.accentLabel ?? "Brookside Real Estate relationship workspace";
  const company = branding?.companyName ?? "Brookside Real Estate";
  return {
    ...PERSONAL_COPY_DEFAULTS,
    eyebrow: accent,
    title: name.includes("Workspace") ? name : `${name} · ${company}`,
    subtitle: `Relationship intelligence for ${company} — no trade or operator workflows.`,
  };
}

/** Calmer palette for personal surfaces — softer contrast, no trade-orange urgency. */
export const personalPalette = {
  bg: "#F7F8FA",
  surface: "#FFFFFF",
  surfaceMuted: "#F3F4F6",
  border: "#E5E7EB",
  text: "#1F2937",
  textMuted: "#6B7280",
  accent: "#4F6B8C",
  accentSoft: "#E8EEF4",
  accentBorder: "rgba(79,107,140,0.22)",
  success: "#3D7A5C",
  successBg: "#EDF5F0",
  warning: "#9A7B4F",
  warningBg: "#F8F4ED",
} as const;
