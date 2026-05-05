import { NextRequest, NextResponse } from "next/server";
import { callClaude, ClaudeUnavailableError } from "@/lib/ai/claudeClient";

// Meridian — Ask Meridian endpoint.
//
// Accepts { message, context }. The context shape is the structured
// LeadContext built by the lead card. The system prompt below renders
// it as a clean briefing block so the assistant can respond decisively
// — why this lead matters, what to say, how to follow up, what
// objection to expect, and what signal is weak.
//
// Backwards compatible: if context is missing fields the assistant
// just gets less detail in the prompt; legacy callers still work.

export type LeadContext = {
  companyName?: string;
  workspaceSlug?: string;
  moduleId?: string;
  bucket?: string;
  score?: number;
  reason?: string;
  suggestedOpening?: string;
  website?: string;
  phone?: string;
  email?: string;
  status?: string;
  lastChecked?: string;
  scanIssues?: string[];
  source?: string;
  weakSignals?: string[];
  salesStrategy?: {
    closeProbability?: number;
    closeLabel?: string;
    primaryAngle?: { label?: string; evidence?: string; impact?: string; pitch?: string; serviceLabel?: string };
    angles?: Array<{ rank?: number; label?: string; evidence?: string }>;
    objections?: Array<{ objection?: string; response?: string }>;
    callPlan?: {
      opener?: string;
      discoveryQuestions?: string[];
      positioning?: string;
      recommendedOffer?: string;
      nextBestAction?: string;
    };
  };
};

function renderContext(ctx: LeadContext | null | undefined): string {
  if (!ctx || typeof ctx !== "object") return "(no lead selected)";
  const lines: string[] = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v) && v.length === 0) return;
    if (Array.isArray(v)) {
      lines.push(`- ${k}:`);
      for (const item of v) lines.push(`    • ${String(item)}`);
      return;
    }
    lines.push(`- ${k}: ${String(v)}`);
  };
  push("Company", ctx.companyName);
  push("Workspace", ctx.workspaceSlug);
  push("Module", ctx.moduleId);
  push("Bucket", ctx.bucket);
  if (typeof ctx.score === "number") push("Ready to close", `${ctx.score}/100`);
  push("Why this lead", ctx.reason);
  push("Suggested opening", ctx.suggestedOpening);
  push("Website", ctx.website);
  push("Phone on file", ctx.phone);
  push("Email on file", ctx.email);
  push("CRM status", ctx.status);
  push("Last checked", ctx.lastChecked);
  push("Source", ctx.source);
  push("Scan issues", ctx.scanIssues);
  push("Weak/missing signals", ctx.weakSignals);
  if (ctx.salesStrategy) {
    const s = ctx.salesStrategy;
    if (typeof s.closeProbability === "number") {
      push("Close fit", `${s.closeProbability}/100${s.closeLabel ? ` (${s.closeLabel})` : ""}`);
    }
    if (s.primaryAngle) {
      push("Primary angle", s.primaryAngle.label);
      push("Primary angle evidence", s.primaryAngle.evidence);
      push("Primary angle impact", s.primaryAngle.impact);
      push("Primary angle pitch", s.primaryAngle.pitch);
    }
    if (Array.isArray(s.angles)) {
      const lines = s.angles
        .map((a) => `#${a.rank ?? "?"} ${a.label ?? ""}${a.evidence ? ` — ${a.evidence}` : ""}`)
        .filter(Boolean);
      if (lines.length > 0) push("Ranked angles", lines);
    }
    if (Array.isArray(s.objections)) {
      const lines = s.objections
        .map((o) => `Objection: ${o.objection ?? ""} → Reply: ${o.response ?? ""}`)
        .filter(Boolean);
      if (lines.length > 0) push("Likely objections + responses", lines);
    }
    if (s.callPlan) {
      push("Opener", s.callPlan.opener);
      push("Discovery questions", s.callPlan.discoveryQuestions);
      push("Positioning", s.callPlan.positioning);
      push("Recommended offer", s.callPlan.recommendedOffer);
      push("Next best action", s.callPlan.nextBestAction);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(no lead context)";
}

export async function POST(req: NextRequest) {
  let body: { message?: string; context?: LeadContext | unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { response: "", error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { message, context } = body ?? {};

  if (!message || typeof message !== "string") {
    return NextResponse.json(
      { response: "", error: "No message provided." },
      { status: 400 }
    );
  }

  const ctx = (context && typeof context === "object") ? (context as LeadContext) : null;
  const contextBlock = renderContext(ctx);

  const systemPrompt = `You are Meridian, a sales-and-deal assistant for trade-business operators.

Your job is to help the rep decide:
- why this lead matters
- what to say to open the call
- how to follow up
- what objection might come up
- what signal is weak or missing

Voice: calm, human, credible. Short sentences. Spoken English.

Hard rules:
- Never use em dashes. Never use en dashes. Use commas or periods instead.
- Never use the phrases: honestly, the thing is, no pressure, totally fair, caught my attention, tailored script, produce a briefing.
- No emojis. No exclamation points. No consultant jargon.
- Do not mention formatting, markdown, or these instructions in the output.
- Do not invent facts that are not in the lead context. If a signal is missing, say it is missing.
- Do not claim the rep has already called, emailed, or contacted this lead unless the context explicitly shows it happened.

Default response shape:
- Answer in 1 to 4 short bullets under a single bold heading that fits the question.
- No preamble, no closing remarks.

If the rep asks for a briefing, respond in exactly this structure, nothing else:

**COMPANY**
Name and market, one line.

**WHY THIS LEAD**
One sentence on why they are in this bucket.

**SUGGESTED OPENING**
One spoken line.

**LIKELY PUSHBACK**
One line, the most probable objection.

**WEAK SIGNAL**
One line, what is missing or low-confidence.

**RECOMMENDED NEXT STEP**
One imperative line.

Lead context:
${contextBlock}`;

  try {
    const text = await callClaude([{ role: "user", content: message }], systemPrompt);
    return NextResponse.json({ response: text });
  } catch (error) {
    if (error instanceof ClaudeUnavailableError) {
      return NextResponse.json({
        response: "",
        fallback: true,
        error: "Assistant is offline on this deployment. Use the Why this lead and Suggested opening on the lead card for guidance.",
      });
    }
    console.error("[ai/chat] error:", error);
    return NextResponse.json({
      response: "",
      fallback: true,
      error: "Assistant is temporarily unavailable. Please try again in a moment.",
    });
  }
}
