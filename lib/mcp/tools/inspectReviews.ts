// Meridian AI — inspect_reviews tool.
//
// Purpose: surface review-volume and sentiment signals for a company.
//
// HONEST STATUS: this tool is an MVP stub. It does NOT fake review data.
// Without GOOGLE_PLACES_API_KEY (or another reviews provider), it returns
// stub:true and low confidence. The interface is real and stable — the
// moment a provider key is added, we swap the implementation without
// touching callers.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";

export type InspectReviewsInput = {
  company: CompanyRef;
};

export type ReviewSignals = {
  provider: "google_places" | "stub";
  reviewCount: number | null;
  averageRating: number | null;  // 0–5
  lastReviewAt: string | null;   // ISO
  weaknesses: string[];
};

async function handler(input: InspectReviewsInput): Promise<ToolResult<ReviewSignals>> {
  const { company } = input;
  const timestamp = nowIso();
  const hasKey = !!process.env.GOOGLE_PLACES_API_KEY;

  // Stub path — the only path implemented in Phase 1.
  // Real Google Places integration is intentionally deferred until a key
  // exists; faking review counts would poison the decision engine.
  if (!hasKey) {
    return {
      tool: "inspect_reviews",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [
        {
          kind: "provider_unavailable",
          source: "stub",
          observedAt: timestamp,
          detail: "GOOGLE_PLACES_API_KEY is not set; no live review data collected",
        },
      ],
      data: {
        provider: "stub",
        reviewCount: null,
        averageRating: null,
        lastReviewAt: null,
        weaknesses: ["review signals unavailable — no live provider configured"],
      },
      stub: true,
      notes: [
        "Add GOOGLE_PLACES_API_KEY to .env.local to enable live review data.",
        "Interface is stable; callers do not need to change when live mode is enabled.",
      ],
    };
  }

  // NOTE: Live implementation is intentionally left as a narrow TODO.
  // We implement it the moment the key exists and the Phase 1 plan approves it.
  return {
    tool: "inspect_reviews",
    company,
    timestamp,
    confidence: 10,
    confidenceLabel: labelFromConfidence(10),
    evidence: [],
    data: {
      provider: "google_places",
      reviewCount: null,
      averageRating: null,
      lastReviewAt: null,
      weaknesses: [],
    },
    stub: true,
    notes: ["live Google Places path not yet implemented — pending explicit Phase 1.5 approval"],
  };
}

export const inspectReviewsTool: ToolDefinition<InspectReviewsInput, ReviewSignals> = {
  name: "inspect_reviews",
  description:
    "Surfaces review volume, average rating, and recency for a company. Returns stub:true until a reviews provider key is configured.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef with name and (ideally) location or placeId" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
