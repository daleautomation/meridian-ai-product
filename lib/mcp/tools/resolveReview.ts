// Meridian AI — resolve_review tool.
//
// Approves or rejects a pending review item. Idempotent: resolving an
// already-resolved review returns the existing record without re-writing.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { resolveReview, type ReviewItem } from "@/lib/state/reviewQueueStore";

export type ResolveReviewInput = {
  id: string;
  decision: "APPROVED" | "REJECTED";
  resolvedBy?: string;
  note?: string;
};

export type ResolveReviewData = { review: ReviewItem | null };

async function handler(input: ResolveReviewInput): Promise<ToolResult<ResolveReviewData>> {
  const timestamp = nowIso();
  if (!input.id || (input.decision !== "APPROVED" && input.decision !== "REJECTED")) {
    return {
      tool: "resolve_review",
      company: { name: "*" },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { review: null },
      stub: false,
      error: "invalid_input",
    };
  }

  const review = await resolveReview(input.id, input.decision, {
    resolvedBy: input.resolvedBy ?? "operator",
    note: input.note,
  });

  if (!review) {
    return {
      tool: "resolve_review",
      company: { name: "*" },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [
        {
          kind: "store_read",
          source: "data/reviews.json",
          observedAt: timestamp,
          detail: `no review with id=${input.id}`,
        },
      ],
      data: { review: null },
      stub: false,
      error: "not_found",
    };
  }

  return {
    tool: "resolve_review",
    company: { name: review.subjectLabel },
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/reviews.json",
        observedAt: timestamp,
        detail: `review id=${review.id} → ${review.status} by ${review.resolvedBy ?? "?"}`,
      },
    ],
    data: { review },
    stub: false,
  };
}

export const resolveReviewTool: ToolDefinition<ResolveReviewInput, ResolveReviewData> = {
  name: "resolve_review",
  description: "Approve or reject a pending review. Idempotent — already-resolved reviews are returned unchanged.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Review id (from create_review)" },
      decision: { type: "string", description: "APPROVED | REJECTED", enum: ["APPROVED", "REJECTED"] },
      resolvedBy: { type: "string", description: 'Reviewer id; defaults to "operator"' },
      note: { type: "string", description: "Optional resolution note" },
    },
    required: ["id", "decision"],
    additionalProperties: false,
  },
  handler,
};
