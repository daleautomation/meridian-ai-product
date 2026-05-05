// Meridian AI — Deal coach route.
//
// POST /api/ai/deal-coach
// Body: { lead, bucketId, bucketLabel, reasons, script, tradeId, tradeLabel,
//         johnServiceAngle, why, value, actionLabel }
//
// Server-side only. Pulls ANTHROPIC_API_KEY from env, never exposes it.
// Returns { ok, pitch, objections, angles, raw } so the client can render
// each section without parsing free-form text.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { callClaude } from "@/lib/ai/claudeClient";

interface DealCoachRequest {
  lead?: Record<string, unknown> | null;
  bucketId?: string;
  bucketLabel?: string;
  reasons?: string[];
  script?: string;
  tradeId?: string;
  tradeLabel?: string;
  johnServiceAngle?: string;
  why?: string;
  value?: string;
  actionLabel?: string;
  /** When present, run a follow-up chat turn instead of the initial
   *  JSON-contract pitch. The first item is the synthesized "system"
   *  context (what the operator already saw), then alternating user /
   *  assistant turns. Server returns { ok, reply } on this branch. */
  messages?: ChatMessage[];
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CoachOutput {
  summary: string;
  pitch: string[];
  objections: { objection: string; response: string }[];
  angles: string[];
}

const SYSTEM_PROMPT = `You are LaborTech's senior B2B sales coach. You speak like a polished operator coach: confident, direct, warm, helpful. No hedging, no buzzwords, no AI voice. Emojis and bullets are welcome when they help readability — never decorative.

Output STRICT JSON only. Do NOT wrap in markdown. Do NOT include explanations outside the JSON. Schema:
{
  "summary": string,                           // 1 sentence. The single best move. Lead with one emoji like 🔥 / 📍 / ⚡ / 📱 when natural.
  "pitch": [string, string, string],           // 3 lines max, total under 90 words. Conversational, what the operator should actually say. Address the lead's specific pain. End on a question.
  "objections": [                              // up to 3 items. Likely objections + a tight one-line response.
    { "objection": string, "response": string }
  ],
  "angles": [string, string, string]           // 3 alternative angles. Each line: short emoji + label + one-line guidance. Example: "📍 Local trust: Mention Grandview and nearby roofing searches."
}

Rules:
- Never invent specific dollar amounts unless they are in the input.
- Never invent the lead's tech stack, employees, or processes.
- Quote signals the input gave you (rating, review count, missing website, etc.).
- Speak like a sales operator, not a chatbot.
- Keep it tight. No overexplaining.`;

const CHAT_SYSTEM_PROMPT = `You are LaborTech's senior B2B sales coach answering an operator's follow-up about a specific deal. Style: clear, concise, helpful, warm. Short sections with bold headers when useful, bullets when listing options, emojis only when they sharpen meaning. NEVER output JSON or code fences — write plain readable Markdown only. Stay under 160 words. Never invent dollar amounts, tech stacks, or processes that are not in the input. Quote real signals back when useful.`;

function buildUserPrompt(body: DealCoachRequest): string {
  const lead = body.lead ?? {};
  const name = (lead as { name?: string }).name ?? (lead as { companyName?: string }).companyName ?? "the lead";
  const rating = (lead as { rating?: number }).rating;
  const reviewCount =
    (lead as { reviewCount?: number }).reviewCount ??
    (lead as { reviews?: number }).reviews;
  const website =
    (lead as { website?: string }).website ??
    (lead as { websiteUrl?: string }).websiteUrl ??
    (lead as { domain?: string }).domain ??
    null;
  const phone =
    (lead as { phone?: string }).phone ??
    ((lead as { contacts?: { primaryPhone?: string } }).contacts?.primaryPhone) ??
    null;
  const address =
    (lead as { address?: string }).address ??
    (lead as { location?: string }).location ??
    null;

  return [
    `Trade: ${body.tradeLabel ?? body.tradeId ?? "unknown"}`,
    `Service angle: ${body.bucketLabel ?? body.bucketId ?? "unknown"}`,
    body.johnServiceAngle ? `LaborTech sells: ${body.johnServiceAngle}` : null,
    "",
    `Company: ${name}`,
    address ? `Address: ${address}` : null,
    rating != null ? `Rating: ${rating}` : null,
    reviewCount != null ? `Reviews: ${reviewCount}` : null,
    `Website on file: ${website ? "yes" : "no"}`,
    `Phone on file: ${phone ? "yes" : "no"}`,
    "",
    `Why this works: ${body.why ?? "n/a"}`,
    `Expected outcome: ${body.value ?? "n/a"}`,
    `Recommended action: ${body.actionLabel ?? "Call this now"}`,
    "",
    "Classifier reasons:",
    ...((body.reasons ?? []).map((r) => `- ${r}`)),
    "",
    body.script ? `Current script:\n${body.script}` : null,
    "",
    `Return JSON only. No prose outside the JSON.`,
  ].filter(Boolean).join("\n");
}

// Strip markdown fences, JSON labels, and whitespace. Accepts variations
// like "```json\n...\n```", "json\n{...}", or plain JSON.
function cleanFences(raw: string): string {
  let s = raw.trim();
  // Drop ``` fences (with or without language tag).
  s = s.replace(/^```[a-zA-Z]*\s*/m, "").replace(/```\s*$/m, "");
  // Drop a stray leading "json" label some models emit.
  s = s.replace(/^\s*json\s*\n/i, "").trim();
  return s;
}

// Find the outermost JSON object in a string. Useful when the model
// pads JSON with prose ("Here's your output: { ... }").
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}

function shapeParsed(parsed: unknown): CoachOutput | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as {
    summary?: unknown;
    pitch?: unknown;
    objections?: unknown;
    angles?: unknown;
  };
  const hasAnyField =
    Array.isArray(p.pitch) ||
    Array.isArray(p.objections) ||
    Array.isArray(p.angles) ||
    typeof p.summary === "string";
  if (!hasAnyField) return null;
  const summary = typeof p.summary === "string" ? p.summary.trim() : "";
  const pitch = Array.isArray(p.pitch)
    ? p.pitch.filter((s): s is string => typeof s === "string")
    : [];
  const objections = Array.isArray(p.objections)
    ? p.objections
        .filter((o): o is { objection: unknown; response: unknown } => !!o && typeof o === "object")
        .map((o) => ({
          objection: typeof o.objection === "string" ? o.objection : "",
          response: typeof o.response === "string" ? o.response : "",
        }))
        .filter((o) => o.objection && o.response)
    : [];
  const angles = Array.isArray(p.angles)
    ? p.angles.filter((s): s is string => typeof s === "string")
    : [];
  return { summary, pitch, objections, angles };
}

/**
 * Robustly parse a Deal Coach response from Claude.
 * Handles:
 *  - ```json fences
 *  - "json" label prefix
 *  - prose padding around the JSON object
 *  - double-encoded JSON (a JSON string whose content is itself JSON)
 *  - JSON nested inside a `text` field
 *  - escaped newline/quote characters
 *  - malformed JSON → falls back to a summary-only payload
 */
export function safeParseDealCoachResponse(raw: string): CoachOutput {
  const empty: CoachOutput = { summary: "", pitch: [], objections: [], angles: [] };
  if (typeof raw !== "string") return empty;

  const tryParse = (input: string): unknown => {
    try { return JSON.parse(input); } catch { return null; }
  };

  const cleaned = cleanFences(raw);
  if (!cleaned) return empty;

  // 1. Direct parse.
  let parsed: unknown = tryParse(cleaned);

  // 2. Extract object out of surrounding prose, then parse.
  if (parsed === null) {
    const extracted = extractJsonObject(cleaned);
    if (extracted) parsed = tryParse(extracted);
  }

  // 3. Double-encoded — `parsed` is a string, parse again.
  if (typeof parsed === "string") {
    const reparsed = tryParse(parsed);
    if (reparsed !== null) parsed = reparsed;
  }

  // 4. JSON nested inside `text` field.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as { text?: unknown; content?: unknown };
    if (typeof obj.text === "string") {
      const inner = cleanFences(obj.text);
      const innerParsed = tryParse(inner) ?? tryParse(extractJsonObject(inner) ?? "");
      if (innerParsed) parsed = innerParsed;
    } else if (typeof obj.content === "string") {
      const inner = cleanFences(obj.content);
      const innerParsed = tryParse(inner) ?? tryParse(extractJsonObject(inner) ?? "");
      if (innerParsed) parsed = innerParsed;
    }
  }

  const shaped = shapeParsed(parsed);
  if (shaped) return shaped;

  // 5. Malformed JSON fallback. Expose the cleaned text as a summary so
  // the UI never has to render escaped JSON. Strip any stray braces.
  const fallbackSummary = cleaned
    .replace(/^[{\[]+/, "")
    .replace(/[}\]]+$/, "")
    .trim();
  return { summary: fallbackSummary, pitch: [], objections: [], angles: [] };
}

// Strip stray markdown fences from a chat reply. The chat branch is
// supposed to return plain Markdown, but defend against models that
// occasionally wrap responses in ```text``` or ```json fences.
function cleanChatReply(raw: string): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  // Drop only outer fences. Inline ```code``` blocks inside a reply are fine.
  s = s.replace(/^```[a-zA-Z]*\s*\n/, "").replace(/\n```\s*$/, "");
  // Drop lone "json" label some models emit.
  s = s.replace(/^\s*json\s*\n/i, "").trim();
  return s;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing ANTHROPIC_API_KEY" },
      { status: 400 },
    );
  }

  let body: DealCoachRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.lead || (typeof body.lead !== "object")) {
    return NextResponse.json({ ok: false, error: "Missing lead" }, { status: 400 });
  }

  // ── Chat follow-up branch ────────────────────────────────────────
  // When the client sends `messages`, run a free-form coach turn that
  // grounds the model in the lead context plus the prior turns. Returns
  // { ok, reply }. The structured pitch contract is left untouched on
  // this branch so the panel's three sections stay stable.
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const leadContext = buildUserPrompt(body);
    const turns = body.messages
      .filter((m): m is ChatMessage =>
        !!m && (m.role === "user" || m.role === "assistant" || m.role === "system") && typeof m.content === "string",
      )
      .map((m) => {
        // Map "system" turns (we use them to carry the prior pitch /
        // objections / angles) onto Claude's user/assistant slots, since
        // Anthropic only takes user|assistant in the messages array.
        if (m.role === "system") {
          return { role: "user" as const, content: `[Earlier brief shown to the operator]\n${m.content}` };
        }
        return { role: m.role, content: m.content };
      });

    // Always anchor with the lead context as the first user turn so
    // the model never loses ground truth across turns.
    const messagesForClaude = [
      { role: "user" as const, content: leadContext },
      ...turns,
    ];

    let chatRaw: string;
    try {
      const result = await callClaude(messagesForClaude, CHAT_SYSTEM_PROMPT);
      chatRaw = typeof (result as { content?: string }).content === "string"
        ? (result as { content: string }).content
        : JSON.stringify(result);
    } catch (err) {
      return NextResponse.json(
        { ok: false, error: `AI request failed: ${(err as Error).message}` },
        { status: 502 },
      );
    }

    // Chat replies are Markdown — never expose raw JSON or fences to UI.
    const reply = cleanChatReply(chatRaw);
    return NextResponse.json({ ok: true, reply });
  }

  const userPrompt = buildUserPrompt(body);
  let raw: string;
  try {
    const result = await callClaude(
      [{ role: "user", content: userPrompt }],
      SYSTEM_PROMPT,
    );
    raw = typeof (result as { content?: string }).content === "string"
      ? (result as { content: string }).content
      : JSON.stringify(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `AI request failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  // safeParseDealCoachResponse handles fences, double-encoding, nested
  // text fields, and malformed JSON. The UI only ever sees clean fields.
  const shaped = safeParseDealCoachResponse(raw);

  return NextResponse.json({
    ok: true,
    summary: shaped.summary,
    pitch: shaped.pitch,
    objections: shaped.objections,
    angles: shaped.angles,
  });
}
