// Meridian AI — find_best_contact MCP tool.
//
// Wraps the contact resolution engine so the operator UI can trigger a
// live identity-first lookup. Returns the canonical ContactResolution
// payload documented in lib/contacts/types.ts.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { resolveContact } from "@/lib/contacts/resolver";
import type { ContactResolution } from "@/lib/contacts/types";

export type FindBestContactInput = {
  company: CompanyRef;
  city?: string;
  state?: string;
  category?: string;
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
  const result = await resolveContact({
    companyName: input.company.name,
    city: input.city ?? parsedLocation.city,
    state: input.state ?? parsedLocation.state,
    category: input.category ?? "roofing",
  });

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
