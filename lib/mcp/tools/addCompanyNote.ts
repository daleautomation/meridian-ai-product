// Meridian AI — add_company_note tool.
//
// Append an operator/sales note to a company's entity record. Append-only;
// notes are never mutated or deleted through this tool. Author defaults to
// "operator" when not specified so agent-driven calls stay attributable.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { addNote, type CompanyNote } from "@/lib/state/companySnapshotStore";

export type AddCompanyNoteInput = {
  company: CompanyRef;
  body: string;
  author?: string;
  tags?: string[];
};

export type AddCompanyNoteData = {
  note: CompanyNote;
  totalNotes: number;
};

async function handler(
  input: AddCompanyNoteInput
): Promise<ToolResult<AddCompanyNoteData>> {
  const { company, body, author, tags } = input;
  const timestamp = nowIso();

  if (!body || !body.trim()) {
    return {
      tool: "add_company_note",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { note: { id: "", author: "", body: "", createdAt: timestamp }, totalNotes: 0 },
      stub: false,
      error: "empty_body",
    };
  }

  try {
    const { snapshot, note } = await addNote(company, {
      author: author ?? "operator",
      body: body.trim(),
      tags,
    });
    return {
      tool: "add_company_note",
      company: snapshot.company,
      timestamp,
      confidence: 95,
      confidenceLabel: "HIGH",
      evidence: [
        {
          kind: "persistence_write",
          source: "data/companySnapshots.json",
          observedAt: timestamp,
          detail: `appended note id=${note.id} by ${note.author} (${note.body.length} chars)`,
        },
      ],
      data: { note, totalNotes: snapshot.notes?.length ?? 0 },
      stub: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist failed";
    return {
      tool: "add_company_note",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { note: { id: "", author: "", body: "", createdAt: timestamp }, totalNotes: 0 },
      stub: false,
      error: message,
    };
  }
}

export const addCompanyNoteTool: ToolDefinition<AddCompanyNoteInput, AddCompanyNoteData> = {
  name: "add_company_note",
  description: "Append an operator/sales note to a company's entity record. Append-only.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      body: { type: "string", description: "Note body (plain text)" },
      author: { type: "string", description: 'Author id; defaults to "operator"' },
      tags: { type: "array", description: "Optional string tags" },
    },
    required: ["company", "body"],
    additionalProperties: false,
  },
  handler,
};
