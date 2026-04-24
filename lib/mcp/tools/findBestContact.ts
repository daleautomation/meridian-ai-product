// Meridian AI — find_best_contact MCP tool.
//
// Wraps the contact resolution engine so the operator UI can trigger a
// live identity-first lookup. Returns the canonical ContactResolution
// payload documented in lib/contacts/types.ts.
//
// Side effects (additive, safe):
//   - Folds in phone/email previously extracted by inspect_website if those
//     signals exist on the persisted snapshot (so the waterfall benefits
//     without the caller having to pass them).
//   - Persists the resolution via upsertContactResolution so first-render
//     UI has real contacts without a second round trip.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { resolveContact } from "@/lib/contacts/resolver";
import { getSnapshot, upsertContactResolution } from "@/lib/state/companySnapshotStore";
import type { ContactResolution } from "@/lib/contacts/types";

export type FindBestContactInput = {
  company: CompanyRef;
  city?: string;
  state?: string;
  category?: string;
  // Pre-known signals (typically from inspect_website). Fed into the
  // waterfall so site-scraped phone/email/website/form become explicit paths.
  websitePhone?: string;
  websiteEmail?: string;
  website?: string;
  hasContactForm?: boolean;
};

function scoreToNumber(confidence: ContactResolution["confidence"]): number {
  switch (confidence) {
    case "high": return 85;
    case "medium": return 60;
    case "low": return 30;
    default: return 0;
  }
}

async function handler(input: FindBestContactInput): Promise<ToolResult<ContactResolution>> {
  const parsedLocation = parseLocation(input.company.location);

  // If the caller didn't pass site-extracted signals, pull them from the
  // persisted inspect_website result. This lets the waterfall fold in
  // phone / email / contact-form / website from the live scan without any
  // extra wiring.
  let websitePhone = input.websitePhone;
  let websiteEmail = input.websiteEmail;
  let website = input.website ?? input.company.url ?? input.company.domain;
  let hasContactForm = input.hasContactForm;
  let siteEmails: Array<{ email: string; method: "website_mailto" | "website_visible" | "website_schema" | "website_obfuscated"; page: string }> | undefined;
  if (!websitePhone || !websiteEmail || !website || hasContactForm === undefined || !siteEmails) {
    const snap = await getSnapshot(input.company);
    const ws = snap?.latest?.["inspect_website"]?.data as
      | {
          phone_from_site?: string | null;
          email_from_site?: string | null;
          emails_from_site?: Array<{ email: string; method: string; page: string }>;
          finalUrl?: string | null;
          has_contact_form?: boolean;
        }
      | undefined;
    if (ws) {
      websitePhone = websitePhone ?? ws.phone_from_site ?? undefined;
      websiteEmail = websiteEmail ?? ws.email_from_site ?? undefined;
      website = website ?? ws.finalUrl ?? undefined;
      hasContactForm = hasContactForm ?? ws.has_contact_form ?? undefined;
      // Cast: WebsiteSignals' SiteEmailMethod strings are a subset of the
      // BusinessInput type's literal union.
      siteEmails = ws.emails_from_site as typeof siteEmails ?? undefined;
    }
  }

  const result = await resolveContact({
    companyName: input.company.name,
    city: input.city ?? parsedLocation.city,
    state: input.state ?? parsedLocation.state,
    category: input.category ?? "roofing",
    website,
    phone: websitePhone,
    email: websiteEmail,
    siteEmails,
    hasContactForm,
  });

  // Persist so decideCompany / first-render UI read a durable copy next
  // time. Never blocks the response.
  try {
    await upsertContactResolution(input.company, result);
  } catch {
    // best-effort persistence; do not fail the tool
  }

  const numeric = scoreToNumber(result.confidence);

  return {
    tool: "find_best_contact",
    company: input.company,
    timestamp: nowIso(),
    confidence: numeric,
    confidenceLabel: labelFromConfidence(numeric),
    evidence: [
      {
        kind: "sources_checked",
        source: "resolveContact",
        observedAt: result.lastCheckedAt,
        detail: result.checkedSources.join(", ") || "none",
      },
      {
        kind: "summary",
        source: "resolveContact",
        observedAt: result.lastCheckedAt,
        detail: result.summary,
      },
    ],
    data: result,
    stub: false,
  };
}

function parseLocation(location?: string): { city: string; state: string } {
  if (!location) return { city: "", state: "" };
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: "", state: "" };
  if (parts.length === 1) return { city: parts[0], state: "" };
  return { city: parts[0], state: parts[parts.length - 1] };
}

export const findBestContactTool: ToolDefinition<FindBestContactInput, ContactResolution> = {
  name: "find_best_contact",
  description:
    "Identity-first contact resolution. Queries Google Places, Yelp, BBB, and Facebook in parallel, scores candidates with fuzzy name + location + category match, and returns the best phone or fallback route with explicit confidence.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef with name, optional domain and location" },
      city: { type: "string", description: "City override (defaults to parsed from company.location)" },
      state: { type: "string", description: "State override (defaults to parsed from company.location)" },
      category: { type: "string", description: "Business category, defaults to roofing" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
