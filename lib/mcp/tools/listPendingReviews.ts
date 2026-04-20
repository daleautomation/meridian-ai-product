// Meridian AI — list_pending_reviews tool.
//
// Returns pending (or filtered) review items so operators and agents can
// see what's waiting on human approval.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listReviews, type ReviewItem, type ReviewStatus } from "@/lib/state/reviewQueueStore";

export type ListPendingReviewsInput = {
  status?: ReviewStatus;
  kind?: string;
  subjectKey?: string;
  limit?: number;
};

export type ListPendingReviewsData = {
  total: number;
  reviews: ReviewItem[];
};

async function handler(
  input: ListPendingReviewsInput
): Promise<ToolResult<ListPendingReviewsData>> {
  const timestamp = nowIso();
  const reviews = await listReviews({
    status: input.status ?? "PENDING",
    kind: input.kind,
    subjectKey: input.subjectKey,
    limit: input.limit ?? 100,
  });

  return {
    tool: "list_pending_reviews",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/reviews.json",
        observedAt: timestamp,
        detail: `read ${reviews.length} reviews (status=${input.status ?? "PENDING"}${input.kind ? `, kind=${input.kind}` : ""})`,
      },
    ],
    data: { total: reviews.length, reviews },
    stub: false,
  };
}

export const listPendingReviewsTool: ToolDefinition<
  ListPendingReviewsInput,
  ListPendingReviewsData
> = {
  name: "list_pending_reviews",
  description:
    'Lists review items from the queue. Defaults to status="PENDING"; supports filtering by kind and subjectKey.',
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "PENDING | APPROVED | REJECTED (default PENDING)",
        enum: ["PENDING", "APPROVED", "REJECTED"],
      },
      kind: { type: "string", description: "Optional kind filter" },
      subjectKey: { type: "string", description: "Optional subject filter (e.g. companyKey)" },
      limit: { type: "number", description: "Max records (default 100, max 500)" },
    },
    additionalProperties: false,
  },
  handler,
};
