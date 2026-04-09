// Meridian AI — server-side Claude proxy.
//
// All Anthropic calls happen here. The browser never sees the API key and
// never decides which prompt or which user the request belongs to. Tenant
// context (user, allowed modules, geo) is read from the session cookie
// server-side; the client only supplies the question and selected item.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getSystemPrompt, isModuleId } from "@/lib/modulePrompts";
import {
  evolveAcquisitionPlan,
  type NegotiationState,
} from "@/lib/scoring/acquisition";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;
const ANTHROPIC_VERSION = "2023-06-01";

type SelectedItem = {
  title?: string;
  sub?: string;
  score?: number;
  label?: string;
  tag?: string;
  arv?: string;
  mao?: string;
  ask?: string;
  risk?: string;
  nextAction?: string;
  riskFactors?: string[];
  thesis?: string;
  platformMetrics?: string;
  maxBuyPrice?: number;
  riskAdjustedReturn?: number;
  trustScore?: number;
  trustTier?: string;
  trustNote?: string;
  trustReasons?: string[];
  valuation?: {
    valuationTimestamp: string;
    sourceRecencyHours: number | null;
    sourceQuality: string;
    confidenceScore: number;
    confidenceLabel: string;
    compCount: number;
    valuationMethod: string;
    estimatedFairValue: number;
    valuationLow: number;
    valuationHigh: number;
    rationale: string;
  };
  acquisitionPlan?: {
    openingOffer: number;
    targetBuy: number;
    hardCeiling: number;
    walkAwayTrigger: string;
    negotiationStyle: string;
    negotiationReasoning: string;
    likelyObjections: string[];
    counterStrategy: string;
    followUpWindowHours: number;
    estimatedHoldDays: number;
    exitPlatform: string;
    exitReasoning: string;
    urgency: string;
    capitalPriority: string;
    primaryLeverage: string;
    leverageStrength: number;
    fallbackLeverage: string;
    negotiationPhase: string;
    capitalContext: string;
    decision: {
      decision: string;
      conviction: number;
      dominantAction: string;
      execution: {
        timing: string;
        maxBuyPrice: number;
        walkAwayPrice: number;
      };
      negotiation: {
        anchorPrice: number;
        strategy: string;
        reasoning: string;
        posture: string;
      };
    };
  };
  negotiationState?: {
    currentPhase?: string;
    lastActionTaken?: string;
    sellerResponse: string;
    timeSinceLastActionHours: number;
    sellerCounterPrice?: number;
    lastOfferSent?: number;
    lastUpdated?: string;
  };
};

type HistoryMessage = { role: "user" | "assistant"; content: string };

type ChatBody = {
  moduleId?: string;
  message?: string;
  selectedItem?: SelectedItem | null;
  pipelineItems?: SelectedItem[] | null;
  history?: HistoryMessage[] | null;
  negotiationState?: NegotiationState | null;
};

const MAX_PIPELINE_ITEMS = 50;
const MAX_HISTORY_MESSAGES = 30;

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message?.trim();
  const moduleId = body.moduleId;
  if (!moduleId || !message) {
    return NextResponse.json(
      { error: "Missing moduleId or message" },
      { status: 400 }
    );
  }
  if (!isModuleId(moduleId)) {
    return NextResponse.json({ error: "Unknown module" }, { status: 400 });
  }
  if (!user.modules.includes(moduleId)) {
    return NextResponse.json(
      { error: "Module not allowed for this account" },
      { status: 403 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "AI is not configured. Set ANTHROPIC_API_KEY in .env.local and restart the dev server.",
      },
      { status: 503 }
    );
  }

  const baseSystem = getSystemPrompt(moduleId);
  const tenantContextParts = [
    `Operator: ${user.name} (${user.id}).`,
    user.geo.length > 0 ? `Geography: ${user.geo.join(", ")}.` : null,
    `Active module: ${moduleId}.`,
  ].filter(Boolean);
  const system = `${baseSystem}\n\n${tenantContextParts.join(" ")}`;

  const pipelineItems = Array.isArray(body.pipelineItems)
    ? body.pipelineItems.slice(0, MAX_PIPELINE_ITEMS)
    : null;

  // ── Negotiation state resolution ──
  // The adapter has already loaded and applied any persisted state, so
  // selectedItem.acquisitionPlan is the EVOLVED plan and selectedItem.negotiationState
  // carries the persisted state. If body.negotiationState is supplied (what-if /
  // override path), it takes precedence — re-evolve from the existing plan with
  // the body state. The body path is idempotent for already-evolved plans only
  // when the state matches; ad-hoc body overrides are intentional one-off mutations.
  let activeItem: SelectedItem | null = body.selectedItem ?? null;
  const bodyState =
    body.negotiationState && typeof body.negotiationState === "object"
      ? body.negotiationState
      : null;
  if (activeItem && activeItem.acquisitionPlan && bodyState && !activeItem.negotiationState) {
    // Body override path: apply state to a non-evolved plan
    activeItem = {
      ...activeItem,
      acquisitionPlan: evolveAcquisitionPlan(
        activeItem.acquisitionPlan as Parameters<typeof evolveAcquisitionPlan>[0],
        bodyState
      ),
    };
  }
  // Effective state for AI context: body wins, otherwise use whatever the adapter
  // attached from persistence.
  const effectiveState =
    bodyState ??
    (activeItem?.negotiationState
      ? {
          currentPhase: activeItem.negotiationState.currentPhase as
            | "entry"
            | "counter"
            | "walk"
            | undefined,
          lastActionTaken: activeItem.negotiationState.lastActionTaken,
          sellerResponse: activeItem.negotiationState.sellerResponse as
            | "none"
            | "rejected"
            | "countered"
            | "accepted"
            | "stalled",
          timeSinceLastActionHours: activeItem.negotiationState.timeSinceLastActionHours,
          sellerCounterPrice: activeItem.negotiationState.sellerCounterPrice,
        }
      : null);

  const userContent = buildUserContent(message, activeItem, pipelineItems, effectiveState);
  const history = sanitizeHistory(body.history);
  const messages: HistoryMessage[] = [
    ...history,
    { role: "user", content: userContent },
  ];

  try {
    const aiRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text().catch(() => "");
      console.error("[ai/chat] anthropic error", aiRes.status, errBody);
      return NextResponse.json(
        { error: `AI provider error (${aiRes.status})` },
        { status: 502 }
      );
    }

    const data = (await aiRes.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const reply = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text!)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { error: "AI returned an empty response" },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply });
  } catch (e) {
    console.error("[ai/chat] request failed", e);
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }
}

function buildUserContent(
  message: string,
  item: SelectedItem | null,
  pipeline: SelectedItem[] | null,
  negotiationState: NegotiationState | null
): string {
  const sections: string[] = [`User question: ${message}`];
  if (pipeline && pipeline.length > 0) {
    sections.push(buildPipelineSummary(pipeline));
  }
  if (item) {
    sections.push(buildSelectedItemContext(item));
  }
  if (negotiationState) {
    sections.push(buildNegotiationStateContext(negotiationState));
  }
  return sections.join("\n\n");
}

function buildNegotiationStateContext(state: NegotiationState): string {
  const parts: (string | null)[] = [
    "Current negotiation state (the acquisitionPlan above has already been evolved to reflect this — don't reapply the rules, just act on the evolved plan):",
    state.currentPhase ? `- Current phase: ${state.currentPhase}` : null,
    state.lastActionTaken ? `- Last action taken: ${state.lastActionTaken}` : null,
    `- Seller response: ${state.sellerResponse}`,
    `- Time since last action: ${state.timeSinceLastActionHours} hours`,
    state.sellerCounterPrice != null
      ? `- Seller counter price: $${state.sellerCounterPrice.toLocaleString("en-US")}`
      : null,
  ];
  return parts.filter((l): l is string => l !== null).join("\n");
}

function sanitizeHistory(raw: unknown): HistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryMessage[] = [];
  for (const m of raw) {
    if (
      m &&
      typeof m === "object" &&
      (m as HistoryMessage).role &&
      typeof (m as HistoryMessage).content === "string" &&
      ((m as HistoryMessage).role === "user" || (m as HistoryMessage).role === "assistant") &&
      (m as HistoryMessage).content.trim().length > 0
    ) {
      out.push({
        role: (m as HistoryMessage).role,
        content: (m as HistoryMessage).content,
      });
    }
  }
  // Keep only the most recent MAX_HISTORY_MESSAGES turns to bound token cost.
  return out.slice(-MAX_HISTORY_MESSAGES);
}

function buildPipelineSummary(items: SelectedItem[]): string {
  const lines = items.map((item, i) => {
    const parts = [
      `#${i + 1}`,
      item.title || "(untitled)",
      item.sub ? `(${item.sub})` : null,
      item.score != null ? `score ${item.score}` : null,
      item.label || null,
      item.arv ? `price ${item.arv}` : null,
      item.mao ? `market ${item.mao}` : null,
      item.ask ? `margin ${item.ask}` : null,
      item.risk ? `liq ${item.risk}` : null,
      item.tag ? `[${item.tag}]` : null,
      item.platformMetrics
        ? item.platformMetrics.replace(/\n/g, "  ·  ")
        : null,
      item.trustScore != null
        ? `trust ${item.trustScore}/${item.trustTier ?? "?"}`
        : null,
      item.acquisitionPlan
        ? `target $${item.acquisitionPlan.targetBuy.toLocaleString("en-US")} · ${item.acquisitionPlan.negotiationStyle} · ${item.acquisitionPlan.urgency}`
        : null,
    ].filter(Boolean);
    return parts.join(" · ");
  });
  return `Current pipeline (${items.length} items):\n${lines.join("\n")}`;
}

function buildSelectedItemContext(item: SelectedItem): string {
  const d = item.acquisitionPlan?.decision;
  const v = item.valuation;
  // Strip the action prefix from reasoning if present so we can lead with
  // the discrete dominantAction field rather than relying on string format.
  const qualifier = d
    ? d.negotiation.reasoning.replace(/^[A-Z_]+ — /, "")
    : "";
  const lines: (string | null)[] = [
    "Currently selected item context:",
    // Lead with the compressed dominant action and its relationship posture.
    d ? `- ACTION → ${d.dominantAction} — ${qualifier}` : null,
    d ? `- POSTURE → ${d.negotiation.posture}` : null,
    d
      ? `- Tier: ${d.decision} · conviction ${d.conviction.toFixed(1)}/10 · timing ${d.execution.timing} · max $${d.execution.maxBuyPrice.toLocaleString("en-US")} (walk $${d.execution.walkAwayPrice.toLocaleString("en-US")}) · anchor $${d.negotiation.anchorPrice.toLocaleString("en-US")} (${d.negotiation.strategy})`
      : null,
    v
      ? `- VALUATION: ${v.confidenceLabel} (${v.sourceQuality}, ${v.confidenceScore}/100) · fair $${v.estimatedFairValue.toLocaleString("en-US")} (band $${v.valuationLow.toLocaleString("en-US")}–$${v.valuationHigh.toLocaleString("en-US")}) · ${v.compCount} comp${v.compCount === 1 ? "" : "s"} · ${v.sourceRecencyHours === null ? "recency unknown" : `${Math.round(v.sourceRecencyHours)}h old`} · method: ${v.valuationMethod}`
      : null,
    v ? `- Valuation rationale: ${v.rationale}` : null,
    item.title ? `- Title: ${item.title}` : null,
    item.sub ? `- Sub: ${item.sub}` : null,
    item.score != null ? `- Score: ${item.score}` : null,
    item.label ? `- Buy signal: ${item.label}` : null,
    item.tag ? `- Category: ${item.tag}` : null,
    item.arv ? `- Price: ${item.arv}` : null,
    item.mao ? `- Market: ${item.mao}` : null,
    item.ask ? `- Margin (net): ${item.ask}` : null,
    item.risk ? `- Liquidity: ${item.risk}` : null,
    item.platformMetrics
      ? `- Engine metrics: ${item.platformMetrics.replace(/\n/g, " · ")}`
      : null,
    item.trustScore != null
      ? `- Trust score: ${item.trustScore}/100${item.trustTier ? ` (${item.trustTier})` : ""}`
      : null,
    item.trustReasons && item.trustReasons.length > 0
      ? `- Trust issues: ${item.trustReasons.join("; ")}`
      : null,
    item.thesis ? `- Why it matters: ${item.thesis}` : null,
    item.acquisitionPlan
      ? `- Acquisition ladder: opening $${item.acquisitionPlan.openingOffer.toLocaleString("en-US")} → target $${item.acquisitionPlan.targetBuy.toLocaleString("en-US")} → hard ceiling $${item.acquisitionPlan.hardCeiling.toLocaleString("en-US")} (SACRED — never above)`
      : null,
    item.acquisitionPlan
      ? `- Negotiation style: ${item.acquisitionPlan.negotiationStyle} (phase: ${item.acquisitionPlan.negotiationPhase}) — ${item.acquisitionPlan.negotiationReasoning}`
      : null,
    item.acquisitionPlan
      ? `- Primary leverage (strength ${item.acquisitionPlan.leverageStrength}/10): ${item.acquisitionPlan.primaryLeverage}`
      : null,
    item.acquisitionPlan
      ? `- Fallback leverage: ${item.acquisitionPlan.fallbackLeverage}`
      : null,
    item.acquisitionPlan && item.acquisitionPlan.likelyObjections.length > 0
      ? `- Likely seller objections: ${item.acquisitionPlan.likelyObjections.join("; ")}`
      : null,
    item.acquisitionPlan
      ? `- Counter strategy: ${item.acquisitionPlan.counterStrategy}`
      : null,
    item.acquisitionPlan
      ? `- Walk-away trigger: ${item.acquisitionPlan.walkAwayTrigger}`
      : null,
    item.acquisitionPlan
      ? `- Follow-up window: ${item.acquisitionPlan.followUpWindowHours} hours`
      : null,
    item.acquisitionPlan
      ? `- Estimated hold: ~${item.acquisitionPlan.estimatedHoldDays} days`
      : null,
    item.acquisitionPlan
      ? `- Exit: ${item.acquisitionPlan.exitPlatform} (${item.acquisitionPlan.exitReasoning})`
      : null,
    item.acquisitionPlan
      ? `- Urgency: ${item.acquisitionPlan.urgency} · Capital context: ${item.acquisitionPlan.capitalContext} · Capital priority: ${item.acquisitionPlan.capitalPriority}`
      : null,
    item.nextAction ? `- Recommended action: ${item.nextAction}` : null,
    item.riskFactors && item.riskFactors.length > 0
      ? `- Risk factors: ${item.riskFactors.join("; ")}`
      : null,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}
