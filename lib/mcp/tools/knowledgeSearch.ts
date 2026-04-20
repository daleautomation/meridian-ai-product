// Meridian AI — knowledge_search tool.
//
// Retrieves ranked knowledge entries given a free-text query, optional kind
// filter, and/or required tags. Backing implementation is a lightweight
// substring scorer today; the input/output shape is compatible with
// semantic retrieval so we can swap in a vector store later without
// touching callers.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { searchEntries, type KnowledgeHit } from "@/lib/state/knowledgeStore";

export type KnowledgeSearchInput = {
  query?: string;
  kind?: string;
  tags?: string[];
  limit?: number;
};

export type KnowledgeSearchData = {
  hits: KnowledgeHit[];
  total: number;
};

async function handler(
  input: KnowledgeSearchInput
): Promise<ToolResult<KnowledgeSearchData>> {
  const timestamp = nowIso();
  const hits = await searchEntries({
    query: input.query,
    kind: input.kind,
    tags: input.tags,
    limit: input.limit ?? 20,
  });

  return {
    tool: "knowledge_search",
    company: { name: "*" },
    timestamp,
    confidence: 85,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/knowledge.json",
        observedAt: timestamp,
        detail: `query="${input.query ?? ""}" kind=${input.kind ?? "*"} tags=[${(input.tags ?? []).join(",")}] → ${hits.length} hit(s)`,
      },
    ],
    data: { hits, total: hits.length },
    stub: false,
    notes: [
      "Backing retrieval is substring-based. Interface is vector-compatible — swap without caller change.",
    ],
  };
}

export const knowledgeSearchTool: ToolDefinition<
  KnowledgeSearchInput,
  KnowledgeSearchData
> = {
  name: "knowledge_search",
  description:
    "Retrieves ranked knowledge entries by free-text query, optional kind, and/or required tags. Lightweight now; vector-compatible interface.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free-text query (optional)" },
      kind: { type: "string", description: "Optional entry kind" },
      tags: { type: "array", description: "Required tags (all must match, case-insensitive)" },
      limit: { type: "number", description: "Max hits (default 20, max 100)" },
    },
    additionalProperties: false,
  },
  handler,
};
