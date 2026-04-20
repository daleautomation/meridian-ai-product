// Meridian AI — knowledge_add tool.
//
// Upsert a knowledge entry (pitch playbook, positioning doc, objection
// handler, case study, outreach template). Pass an existing id to update
// in place; omit it for a new entry.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { upsertEntry, type KnowledgeEntry } from "@/lib/state/knowledgeStore";

export type KnowledgeAddInput = {
  id?: string;
  kind: string;
  title: string;
  tags?: string[];
  body: string;
  createdBy?: string;
};

export type KnowledgeAddData = { entry: KnowledgeEntry };

async function handler(input: KnowledgeAddInput): Promise<ToolResult<KnowledgeAddData>> {
  const timestamp = nowIso();
  if (!input.kind?.trim() || !input.title?.trim() || !input.body?.trim()) {
    return {
      tool: "knowledge_add",
      company: { name: input.title ?? "?" },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { entry: {} as KnowledgeEntry },
      stub: false,
      error: "missing_fields",
    };
  }

  const entry = await upsertEntry({
    id: input.id,
    kind: input.kind.trim(),
    title: input.title.trim(),
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
    body: input.body,
    createdBy: input.createdBy ?? "operator",
  });

  return {
    tool: "knowledge_add",
    company: { name: entry.title },
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/knowledge.json",
        observedAt: timestamp,
        detail: `upserted knowledge id=${entry.id} kind=${entry.kind} tags=[${entry.tags.join(",")}]`,
      },
    ],
    data: { entry },
    stub: false,
    notes: [
      "Recommended kinds: pitch_playbook | service_positioning | objection_handling | case_study | outreach_template",
    ],
  };
}

export const knowledgeAddTool: ToolDefinition<KnowledgeAddInput, KnowledgeAddData> = {
  name: "knowledge_add",
  description: "Upsert a knowledge entry (playbook, positioning, objection, case study, template).",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Optional — pass to update an existing entry" },
      kind: { type: "string", description: "Entry kind (free string; recommended set in notes)" },
      title: { type: "string", description: "Short human-readable title" },
      tags: { type: "array", description: "String tags for retrieval" },
      body: { type: "string", description: "Full content of the entry" },
      createdBy: { type: "string", description: 'Author id; defaults to "operator"' },
    },
    required: ["kind", "title", "body"],
    additionalProperties: false,
  },
  handler,
};
