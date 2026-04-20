// Meridian AI — generate_pitch tool.
//
// Composes a grounded outreach pitch for a company by combining:
//   1. The persisted company snapshot (evidence, weaknesses, summary)
//   2. Retrieved knowledge entries (pitch_playbook / objection_handling)
//   3. Claude, under a strict "cite or silence" system prompt.
//
// Returns structured JSON with the pitch itself plus the evidence anchors
// and knowledge references it leaned on. Designed to be reviewed by an
// operator before sending — outreach is gated by the human-review queue.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { callClaude } from "@/lib/ai/claudeClient";
import { getSnapshot } from "@/lib/state/companySnapshotStore";
import { searchEntries } from "@/lib/state/knowledgeStore";
import { decideCompany } from "@/lib/scoring/companyDecision";

export type GeneratePitchInput = {
  company: CompanyRef;
  channel?: "call" | "email" | "linkedin";
};

export type GeneratedPitch = {
  channel: "call" | "email" | "linkedin";
  opening: string;              // one sentence — the hook
  body: string;                 // 2–4 sentences grounded in weaknesses
  nextStep: string;             // concrete ask
  anchoredWeaknesses: string[]; // must be a subset of snapshot weaknesses
  knowledgeUsed: Array<{ id: string; title: string; kind: string }>;
};

const SYSTEM_PROMPT = `
You are Meridian AI's pitch composer for outbound sales outreach.

You are given:
- A company snapshot with evidence (website signals, weaknesses).
- A short decision (opportunity level, recommended action).
- A small library of relevant playbook / objection / positioning entries.

HARD RULES:
- Ground every claim in the provided evidence. Do NOT invent facts.
- The pitch must reference at least one concrete weakness from the snapshot.
- Keep it short and specific. This is sales, not marketing.
- Respond with STRICT JSON only. No prose, no markdown, no code fences.

Output JSON schema:
{
  "channel": "call" | "email" | "linkedin",
  "opening": string,
  "body": string,
  "nextStep": string,
  "anchoredWeaknesses": string[],
  "knowledgeUsed": [{ "id": string, "title": string, "kind": string }]
}
`.trim();

function tryParseJson<T>(raw: string): T | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(trimmed) as T; } catch { return null; }
}

async function handler(input: GeneratePitchInput): Promise<ToolResult<GeneratedPitch>> {
  const { company } = input;
  const channel = input.channel ?? "call";
  const timestamp = nowIso();

  const snap = await getSnapshot(company);
  if (!snap) {
    return {
      tool: "generate_pitch",
      company,
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { channel, opening: "", body: "", nextStep: "", anchoredWeaknesses: [], knowledgeUsed: [] },
      stub: false,
      error: "no_snapshot",
    };
  }

  const decision = decideCompany(snap);

  // Pull knowledge by tag + query heuristics. Tags come from weaknesses and
  // kind. Query is the decision rationale itself.
  const tagHints: string[] = [];
  if (decision.topWeaknesses.some((w) => /seo|meta|title/i.test(w))) tagHints.push("seo");
  if (decision.topWeaknesses.some((w) => /mobile|viewport/i.test(w))) tagHints.push("mobile");
  if (decision.topWeaknesses.some((w) => /thin|placeholder/i.test(w))) tagHints.push("thin");
  if (decision.topWeaknesses.some((w) => /review/i.test(w))) tagHints.push("reviews");

  const [playbooks, objections] = await Promise.all([
    searchEntries({
      query: decision.rationale,
      kind: "pitch_playbook",
      limit: 3,
    }),
    searchEntries({
      kind: "objection_handling",
      limit: 2,
    }),
  ]);

  // Fallback: if tag-less search returned too little, try a plain query.
  const knowledgeHits = [...playbooks, ...objections].slice(0, 5);

  const payload = {
    company: snap.company,
    decision: {
      score: decision.score,
      opportunityLevel: decision.opportunityLevel,
      recommendedAction: decision.recommendedAction,
      topWeaknesses: decision.topWeaknesses,
      rationale: decision.rationale,
      pitchAngle: decision.pitchAngle,
    },
    evidence: (snap.latest.inspect_website?.evidence ?? []).map(
      (e) => `[${e.kind}] ${e.detail}`
    ),
    knowledge: knowledgeHits.map((h) => ({
      id: h.entry.id,
      kind: h.entry.kind,
      title: h.entry.title,
      tags: h.entry.tags,
      body: h.entry.body,
    })),
    channel,
    tagHints,
  };

  const userMessage = `Pitch composition payload:\n${JSON.stringify(payload, null, 2)}`;

  let raw: string;
  try {
    raw = await callClaude([{ role: "user", content: userMessage }], SYSTEM_PROMPT);
  } catch (err) {
    const message = err instanceof Error ? err.message : "claude call failed";
    return {
      tool: "generate_pitch",
      company: snap.company,
      timestamp,
      confidence: 15,
      confidenceLabel: "LOW",
      evidence: [],
      data: { channel, opening: "", body: "", nextStep: "", anchoredWeaknesses: [], knowledgeUsed: [] },
      stub: false,
      error: message,
    };
  }

  const parsed = tryParseJson<GeneratedPitch>(raw);
  if (!parsed) {
    return {
      tool: "generate_pitch",
      company: snap.company,
      timestamp,
      confidence: 20,
      confidenceLabel: "LOW",
      evidence: [],
      data: { channel, opening: "", body: raw.slice(0, 400), nextStep: "", anchoredWeaknesses: [], knowledgeUsed: [] },
      stub: false,
      error: "invalid_json_from_model",
    };
  }

  // Anchor check: filter anchoredWeaknesses so only real snapshot weaknesses
  // survive — prevents hallucinated anchors from making it to the operator.
  const snapshotWeaknesses = new Set(decision.topWeaknesses.map((w) => w.toLowerCase()));
  parsed.anchoredWeaknesses = (parsed.anchoredWeaknesses ?? []).filter((w) =>
    snapshotWeaknesses.has(w.toLowerCase())
  );

  const confidence = Math.min(
    decision.confidenceFloor,
    parsed.anchoredWeaknesses.length > 0 ? 80 : 40
  );

  return {
    tool: "generate_pitch",
    company: snap.company,
    timestamp,
    confidence,
    confidenceLabel: labelFromConfidence(confidence),
    evidence: [
      {
        kind: "decision_context",
        source: "decideCompany",
        observedAt: timestamp,
        detail: `score=${decision.score} level=${decision.opportunityLevel} action=${decision.recommendedAction}`,
      },
      ...knowledgeHits.map((h) => ({
        kind: "knowledge_ref",
        source: `knowledge:${h.entry.kind}`,
        observedAt: h.entry.updatedAt,
        detail: `"${h.entry.title}" (score ${h.score.toFixed(1)})`,
      })),
    ],
    data: parsed,
    stub: false,
    notes:
      parsed.anchoredWeaknesses.length === 0
        ? ["No anchored weaknesses survived the grounding filter — pitch may be under-specific."]
        : undefined,
  };
}

export const generatePitchTool: ToolDefinition<GeneratePitchInput, GeneratedPitch> = {
  name: "generate_pitch",
  description:
    "Composes a grounded outreach pitch for a company using its snapshot evidence and retrieved knowledge entries. Anchored weaknesses are filtered against the snapshot so nothing is hallucinated.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      channel: {
        type: "string",
        description: "call | email | linkedin (default call)",
        enum: ["call", "email", "linkedin"],
      },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
