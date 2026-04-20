// Meridian AI — create_review tool.
//
// Adds a pending review item to the human-review queue. Use for gating
// outreach, pitch approval, and status changes that shouldn't auto-fire.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { createReview, type ReviewItem } from "@/lib/state/reviewQueueStore";

export type CreateReviewInput = {
  kind: string;                 // recommended: "outreach" | "pitch" | "status_change"
  subjectKey: string;
  subjectLabel: string;
  payload?: Record<string, unknown>;
  requestedBy?: string;
};

export type CreateReviewData = { review: ReviewItem };

async function handler(input: CreateReviewInput): Promise<ToolResult<CreateReviewData>> {
  const timestamp = nowIso();

  if (!input.kind?.trim() || !input.subjectKey?.trim() || !input.subjectLabel?.trim()) {
    return {
      tool: "create_review",
      company: { name: input.subjectLabel ?? "?" },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { review: {} as ReviewItem },
      stub: false,
      error: "missing_fields",
    };
  }

  const review = await createReview({
    kind: input.kind.trim(),
    subjectKey: input.subjectKey.trim(),
    subjectLabel: input.subjectLabel.trim(),
    payload: input.payload ?? {},
    requestedBy: input.requestedBy ?? "system",
  });

  return {
    tool: "create_review",
    company: { name: review.subjectLabel },
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/reviews.json",
        observedAt: timestamp,
        detail: `created review id=${review.id} kind=${review.kind} subject=${review.subjectKey}`,
      },
    ],
    data: { review },
    stub: false,
    notes: [
      "Recommended kinds: outreach | pitch | status_change. Others are accepted for extensibility.",
    ],
  };
}

export const createReviewTool: ToolDefinition<CreateReviewInput, CreateReviewData> = {
  name: "create_review",
  description:
    "Adds a pending item to the human-review queue (outreach approval, pitch approval, status change, etc.). Blocks no downstream action — callers decide whether to wait.",
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "Review kind (recommended: outreach | pitch | status_change)" },
      subjectKey: { type: "string", description: "Stable subject id — typically a companyKey" },
      subjectLabel: { type: "string", description: "Human-readable subject label" },
      payload: { type: "object", description: "Arbitrary context for the reviewer (e.g. pitch text, target status)" },
      requestedBy: { type: "string", description: "Author id; defaults to \"system\"" },
    },
    required: ["kind", "subjectKey", "subjectLabel"],
    additionalProperties: false,
  },
  handler,
};
