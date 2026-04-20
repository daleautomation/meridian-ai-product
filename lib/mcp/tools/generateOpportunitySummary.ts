// Meridian AI — generate_opportunity_summary tool.
//
// Purpose: compose the output of other inspection tools into a single
// structured opportunity summary: opportunity level, recommended action,
// top weakness, pitch angle, close probability, confidence.
//
// This tool calls other tools in the registry (inspect_website, inspect_reviews),
// then asks Claude to produce a STRUCTURED JSON summary. The prompt forces
// evidence grounding: Claude must cite the evidence already collected and
// MUST NOT invent new facts. If Claude returns non-JSON, the tool degrades
// gracefully (low confidence, error field populated) rather than fabricating.

import type { CompanyRef, ToolDefinition, ToolResult, Evidence } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { callClaude } from "@/lib/ai/claudeClient";
import { inspectWebsiteTool, type WebsiteSignals } from "./inspectWebsite";
import { inspectReviewsTool, type ReviewSignals } from "./inspectReviews";

export type GenerateOpportunitySummaryInput = {
  company: CompanyRef;
  // Optional pre-computed inspection results. When a caller (e.g.
  // save_company_snapshot) has already run the inspectors and wants to
  // persist them separately, it can pass them here to avoid re-running.
  website?: ToolResult<WebsiteSignals>;
  reviews?: ToolResult<ReviewSignals>;
};

export type OpportunityLevel = "HIGH" | "MEDIUM" | "LOW";
export type RecommendedAction = "CALL NOW" | "TODAY" | "MONITOR";
export type CloseProbability = "High" | "Medium" | "Low";

export type OpportunitySummary = {
  opportunityLevel: OpportunityLevel;
  recommendedAction: RecommendedAction;
  topWeakness: string;
  weaknesses: string[];
  pitchAngle: string;
  closeProbability: CloseProbability;
  rationale: string;          // 1–2 line plain-English "why"
  citedEvidence: string[];    // evidence lines the model leaned on
};

const SYSTEM_PROMPT = `
You are Meridian AI's decision engine.

You are given structured inspection evidence for a company. Your job is to
produce a decision-grade opportunity summary.

HARD RULES:
- Ground every claim in the provided evidence. Do NOT invent facts.
- If evidence is thin or stubbed, say so and lower the opportunity level.
- Keep the pitch angle specific, one sentence, and tied to a concrete weakness.
- Respond with STRICT JSON only. No prose, no markdown, no code fences.

Output JSON schema (exact keys):
{
  "opportunityLevel": "HIGH" | "MEDIUM" | "LOW",
  "recommendedAction": "CALL NOW" | "TODAY" | "MONITOR",
  "topWeakness": string,
  "weaknesses": string[],
  "pitchAngle": string,
  "closeProbability": "High" | "Medium" | "Low",
  "rationale": string,
  "citedEvidence": string[]
}
`.trim();

function tryParseJson<T>(raw: string): T | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return null;
  }
}

async function handler(
  input: GenerateOpportunitySummaryInput
): Promise<ToolResult<OpportunitySummary>> {
  const { company } = input;
  const timestamp = nowIso();

  // 1. Run underlying inspections in parallel — unless caller pre-supplied them.
  const [website, reviews] = await Promise.all([
    input.website ?? inspectWebsiteTool.handler({ company }),
    input.reviews ?? inspectReviewsTool.handler({ company }),
  ]);

  const evidence: Evidence[] = [
    ...website.evidence,
    ...reviews.evidence,
    {
      kind: "tool_chain",
      source: "meridian_mcp",
      observedAt: timestamp,
      detail: `composed from inspect_website (conf ${website.confidence}) + inspect_reviews (conf ${reviews.confidence}${reviews.stub ? ", stub" : ""})`,
    },
  ];

  const payload = {
    company,
    website: website.data,
    reviews: reviews.data,
    reviewsAreStub: reviews.stub,
    knownWeaknesses: [
      ...(website.data.weaknesses ?? []),
      ...(reviews.data.weaknesses ?? []),
    ],
    evidence: evidence.map((e) => `[${e.kind}] ${e.detail} (source: ${e.source})`),
  };

  const userMessage = `Company inspection payload:\n${JSON.stringify(payload, null, 2)}`;

  let raw: string;
  try {
    raw = await callClaude(
      [{ role: "user", content: userMessage }],
      SYSTEM_PROMPT
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "claude call failed";
    return {
      tool: "generate_opportunity_summary",
      company,
      timestamp,
      confidence: 15,
      confidenceLabel: "LOW",
      evidence,
      data: {
        opportunityLevel: "LOW",
        recommendedAction: "MONITOR",
        topWeakness: "decision engine unavailable",
        weaknesses: payload.knownWeaknesses,
        pitchAngle: "Unable to generate pitch — model call failed.",
        closeProbability: "Low",
        rationale: message,
        citedEvidence: [],
      },
      stub: false,
      error: message,
    };
  }

  const parsed = tryParseJson<OpportunitySummary>(raw);
  if (!parsed) {
    return {
      tool: "generate_opportunity_summary",
      company,
      timestamp,
      confidence: 20,
      confidenceLabel: "LOW",
      evidence,
      data: {
        opportunityLevel: "LOW",
        recommendedAction: "MONITOR",
        topWeakness: "model returned unparseable output",
        weaknesses: payload.knownWeaknesses,
        pitchAngle: "Summary unavailable — model output was not valid JSON.",
        closeProbability: "Low",
        rationale: raw.slice(0, 240),
        citedEvidence: [],
      },
      stub: false,
      error: "invalid_json_from_model",
    };
  }

  // Overall confidence: average of inputs, capped by reviews-stub penalty.
  const base = Math.round((website.confidence + reviews.confidence) / 2);
  const confidence = Math.max(
    0,
    Math.min(100, reviews.stub ? Math.min(base + 15, 65) : base + 10)
  );

  return {
    tool: "generate_opportunity_summary",
    company,
    timestamp,
    confidence,
    confidenceLabel: labelFromConfidence(confidence),
    evidence,
    data: parsed,
    stub: false,
    notes: reviews.stub
      ? ["Review signals were stubbed — close probability and opportunity level are capped."]
      : undefined,
  };
}

export const generateOpportunitySummaryTool: ToolDefinition<
  GenerateOpportunitySummaryInput,
  OpportunitySummary
> = {
  name: "generate_opportunity_summary",
  description:
    "Composes inspect_website + inspect_reviews into a structured opportunity summary with level, action, pitch angle, and cited evidence.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
