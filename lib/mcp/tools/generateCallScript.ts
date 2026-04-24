// Meridian AI — generate_call_script tool.
//
// Produces a structured cold-call script for a roofing company, tailored to
// their specific weaknesses (from snapshot evidence). Designed for LaborTech
// sales operators making real outbound calls.
//
// Output: intro, discovery questions, value prop, objection responses, close.
// All grounded in snapshot evidence — no invented facts.

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { labelFromConfidence, nowIso } from "@/lib/mcp/types";
import { callClaude } from "@/lib/ai/claudeClient";
import { getSnapshot } from "@/lib/state/companySnapshotStore";
import { decideCompany, LABORTECH_SERVICE_PITCH, type LabortechService } from "@/lib/scoring/companyDecision";
import { searchEntries } from "@/lib/state/knowledgeStore";

export type GenerateCallScriptInput = {
  company: CompanyRef;
  callerName?: string;       // e.g. "John from LaborTech"
  callerCompany?: string;    // e.g. "LaborTech Solutions"
};

export type CallScript = {
  companyName: string;
  opener: string;              // first 15 seconds — hook
  discoveryQuestions: string[];  // 3-5 questions to qualify
  valueProp: string;           // 2-3 sentences on what LaborTech does for them
  weaknessTransition: string;  // bridge from discovery to pitch using their weakness
  objectionResponses: Array<{
    objection: string;
    response: string;
  }>;
  closeAsk: string;            // the specific ask (meeting, demo, etc.)
  voicemailScript: string;     // 30-second voicemail if no answer
};

const TONE_INSTRUCTIONS: Record<string, string> = {
  neutral: `TONE: First contact. Be friendly, professional, curious. Don't push too hard.`,
  direct: `TONE: This is attempt #2-3. Be more direct. Skip the warm-up. Get to the point fast. Reference that you've tried to reach them before. Create mild urgency — "I wanted to make sure you saw this before it becomes a bigger problem."`,
  urgent: `TONE: This is attempt #3+. Use scarcity framing. Be brief and urgent. "I've tried reaching you a few times — I wouldn't keep calling if this wasn't important." Frame the weakness as an active cost they're paying every day. Push hard for a callback or meeting.`,
  closing: `TONE: They've expressed interest. Be confident, assume the sale. Focus on next steps, not the pitch. "Let's get this scheduled." Reference their interest. Make it easy to say yes.`,
};

function buildSystemPrompt(tone: string): string {
  return `
You are Meridian AI's call script composer for LaborTech Solutions.

LaborTech helps roofing companies grow through better digital presence,
lead generation, and operational technology. You are writing a call
script for a sales rep calling a specific roofing company.

You are given:
- Company snapshot with evidence (website signals, weaknesses)
- Decision data (opportunity level, recommended action, pitch angle)
- Call attempt history (how many times we've tried, outcomes)
- Relevant playbook entries

${TONE_INSTRUCTIONS[tone] ?? TONE_INSTRUCTIONS.neutral}

HARD RULES:
- Ground every claim in the provided evidence. Do NOT invent facts about the company.
- The script must reference at least one concrete weakness from their inspection.
- Keep it conversational and natural — not robotic.
- Discovery questions should qualify the prospect (company size, pain points, goals).
- Objection responses should be specific to roofing companies.
- The voicemail must be under 30 seconds when spoken.
- Respond with STRICT JSON only. No prose, no markdown, no code fences.

Output JSON schema:
{
  "companyName": string,
  "opener": string,
  "discoveryQuestions": string[],
  "valueProp": string,
  "weaknessTransition": string,
  "objectionResponses": [{"objection": string, "response": string}],
  "closeAsk": string,
  "voicemailScript": string
}
`.trim();
}

function tryParseJson<T>(raw: string): T | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(trimmed) as T; } catch { return null; }
}

// Deterministic fallback used whenever Claude is unavailable (quota,
// network, invalid JSON, missing snapshot, etc.). Built from existing
// decision evidence so the script is still specific to the company, never
// empty strings. Mirrors the defaults in components/OperatorConsole.jsx.
function buildFallbackScript(params: {
  companyName: string;
  location?: string;
  callerName: string;
  topWeakness?: string;
  siteDown?: boolean;
  interested?: boolean;
  escalationStage?: number;
  consecutiveNoAnswers?: number;
  topService?: LabortechService | null;
  whyThisCloses?: string;
}): CallScript {
  const {
    companyName, location, callerName,
    topWeakness, siteDown, interested,
    escalationStage = 0, consecutiveNoAnswers = 0,
    topService, whyThisCloses,
  } = params;
  const loc = location ? ` in ${location}` : "";
  const weakness = topWeakness
    ? `what I saw on your site — ${topWeakness.toLowerCase().replace(/[.]$/, "")}`
    : "a couple of things on your site that are probably costing you inbound leads";

  // Pick a tone based on escalation stage so the opener matches reality.
  let opener: string;
  if (interested) {
    opener = `Hi, this is ${callerName} with LaborTech Solutions. Circling back on ${companyName} — you mentioned interest last time. Do you have a few minutes to get to next steps?`;
  } else if (escalationStage >= 3 || consecutiveNoAnswers >= 2) {
    opener = `Hi, this is ${callerName} with LaborTech. I've tried reaching ${companyName} a couple of times — I wouldn't keep calling if this wasn't worth it. 60 seconds?`;
  } else {
    opener = `Hi, this is ${callerName} with LaborTech Solutions. I ran a quick check on ${companyName}${loc} and flagged ${weakness}. Do you have 60 seconds?`;
  }

  const siteIssueLine = siteDown
    ? "Right now the site is not serving real business content, so everyone who clicks is bouncing."
    : "Referred customers still check the site before they call, and this is shaking that trust.";

  return {
    companyName,
    opener,
    discoveryQuestions: [
      "How are most of your jobs coming in right now?",
      "Who handles your website and Google presence today?",
      "What does a strong month look like for new jobs?",
    ],
    valueProp: topService
      ? `${LABORTECH_SERVICE_PITCH[topService]} ${whyThisCloses ? whyThisCloses : ""}`.trim()
      : "LaborTech helps KC roofing companies close the gap between inbound search and booked jobs. We fix the visibility and conversion gaps we find on your site and layer in the ops tools that keep leads from falling through.",
    weaknessTransition: siteIssueLine,
    objectionResponses: [
      {
        objection: "We get enough work from referrals",
        response: "Makes sense. Referred customers still check the site before they call. When the site fails a live check, that trust breaks on first click.",
      },
      {
        objection: "We already have someone handling marketing",
        response: "Understood. This is not a marketing pitch — it is a live-check report on what a customer sees right now. Takes 10 minutes to review either way.",
      },
      {
        objection: "Just send me an email",
        response: "Happy to. The call is faster because I can screen-share the scan and show you exactly what failed. Your call.",
      },
    ],
    closeAsk: "Worth 15 minutes this week so I can walk through what I found and how we fix it?",
    voicemailScript: `Hi, ${callerName} with LaborTech. I ran a live check on ${companyName}'s site and flagged items costing you inbound leads. Quick callback and I will walk you through them. Thanks.`,
  };
}

async function handler(input: GenerateCallScriptInput): Promise<ToolResult<CallScript>> {
  const { company } = input;
  const callerName = input.callerName ?? "John";
  const callerCompany = input.callerCompany ?? "LaborTech Solutions";
  const timestamp = nowIso();

  const snap = await getSnapshot(company);
  if (!snap) {
    return {
      tool: "generate_call_script",
      company,
      timestamp,
      confidence: 25,
      confidenceLabel: "LOW",
      evidence: [{
        kind: "fallback",
        source: "generateCallScript",
        observedAt: timestamp,
        detail: "no snapshot on file — returning deterministic template",
      }],
      data: buildFallbackScript({
        companyName: company.name,
        location: company.location,
        callerName,
      }),
      stub: true,
      error: "no_snapshot",
    };
  }

  const decision = decideCompany(snap);

  const playbooks = await searchEntries({
    query: decision.rationale,
    kind: "pitch_playbook",
    limit: 3,
  });

  const scriptTone = decision.scriptTone ?? "neutral";

  const payload = {
    callerName,
    callerCompany,
    company: snap.company,
    callHistory: {
      totalAttempts: decision.callAttempts,
      consecutiveNoAnswers: decision.consecutiveNoAnswers,
      escalationStage: decision.escalationStage,
      tone: scriptTone,
      lastOutcome: snap.lastAttemptOutcome ?? "none",
    },
    decision: {
      score: decision.score,
      opportunityLevel: decision.opportunityLevel,
      recommendedAction: decision.recommendedAction,
      topWeaknesses: decision.topWeaknesses,
      pitchAngle: decision.pitchAngle,
    },
    websiteEvidence: (snap.latest.inspect_website?.evidence ?? []).map(
      (e) => `[${e.kind}] ${e.detail}`
    ),
    websiteWeaknesses: (snap.latest.inspect_website?.data as { weaknesses?: string[] })?.weaknesses ?? [],
    knowledge: playbooks.map((h) => ({
      title: h.entry.title,
      body: h.entry.body,
    })),
  };

  const userMessage = `Call script payload:\n${JSON.stringify(payload, null, 2)}`;

  // Build a deterministic fallback payload up-front so both Claude errors
  // and invalid-JSON responses land on the same script.
  const fallbackData = buildFallbackScript({
    companyName: company.name,
    location: snap.company.location,
    callerName,
    topWeakness: decision.topWeaknesses?.[0],
    siteDown: ((snap.latest.inspect_website?.data as { reachable?: boolean } | undefined)?.reachable) === false,
    interested: decision.closeReadiness === "READY TO CLOSE",
    escalationStage: decision.escalationStage,
    consecutiveNoAnswers: decision.consecutiveNoAnswers,
    topService: decision.serviceRecommendations?.[0] ?? null,
    whyThisCloses: decision.whyThisCloses,
  });

  let raw: string;
  try {
    raw = await callClaude([{ role: "user", content: userMessage }], buildSystemPrompt(scriptTone));
  } catch (err) {
    const message = err instanceof Error ? err.message : "claude call failed";
    return {
      tool: "generate_call_script",
      company: snap.company,
      timestamp,
      confidence: 40,
      confidenceLabel: "LOW",
      evidence: [{
        kind: "fallback",
        source: "generateCallScript",
        observedAt: timestamp,
        detail: `claude unavailable (${message.slice(0, 120)}) — returning deterministic template built from decision evidence`,
      }],
      data: fallbackData,
      stub: true,
      error: message,
    };
  }

  const parsed = tryParseJson<CallScript>(raw);
  if (!parsed) {
    return {
      tool: "generate_call_script",
      company: snap.company,
      timestamp,
      confidence: 35,
      confidenceLabel: "LOW",
      evidence: [{
        kind: "fallback",
        source: "generateCallScript",
        observedAt: timestamp,
        detail: "claude returned non-JSON — returning deterministic template",
      }],
      data: fallbackData,
      stub: true,
      error: "invalid_json_from_model",
    };
  }

  const confidence = Math.min(decision.confidenceFloor, 80);

  return {
    tool: "generate_call_script",
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
    ],
    data: parsed,
    stub: false,
  };
}

export const generateCallScriptTool: ToolDefinition<GenerateCallScriptInput, CallScript> = {
  name: "generate_call_script",
  description:
    "Composes a structured cold-call script for a roofing company: opener, discovery questions, value prop, objection responses, close, and voicemail. Grounded in snapshot evidence.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef" },
      callerName: { type: "string", description: "Caller's first name (default: John)" },
      callerCompany: { type: "string", description: "Caller's company (default: LaborTech Solutions)" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
