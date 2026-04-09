// Meridian AI — unified acquisition engine.
//
// One coherent operator brain that produces a complete acquisition plan for
// any actionable deal across verticals. Replaces the prior split between
// "execution" and "negotiation" — now also adaptive: leverage and capital
// context feed back into negotiation style and urgency.
//
// Pure functions, no I/O, fully deterministic.
//
// Adaptive logic chain (per call):
//   1. Compute base style from trust + liquidity + ceiling headroom
//   2. LOCK style if it came from a non-negotiable rule (trust gate, ceiling gate)
//   3. Compute capitalContext from score
//   4. Adjust style by capitalContext (only if not locked)
//   5. Compute base urgency from signal + liquidity
//   6. Adjust urgency by capitalContext
//   7. Compute leverage (primary, strength, fallback) from final style + context
//   8. Compute negotiationPhase from final style
//   9. Build dynamic reasoning that prioritizes the leverage
//
// Constraints preserved:
//   - hardCeiling is sacred (Walk-ready triggered by ask > ceiling × 1.05 is locked)
//   - trust always overrides aggression (trust < 70 forces Patient, locked)
//   - PASS / AVOID / REJECTED items return null

import {
  type Liquidity,
  type BuySignal,
  type CapitalTier,
  HOLD_DAYS_BY_LIQUIDITY,
} from "@/lib/scoring/watches";
import {
  confidenceToExecution,
  type ConfidenceAdjustment,
} from "@/lib/scoring/valuation";

export type NegotiationStyle =
  | "Aggressive"
  | "Confident"
  | "Balanced"
  | "Patient"
  | "Walk-ready";

export type Urgency = "act-now" | "this-week" | "this-month" | "passive";

export type CapitalPriority = "anchor" | "core" | "satellite" | "skip";

export type NegotiationPhase = "entry" | "counter" | "walk";

export type CapitalContext = "anchor" | "optional" | "last-slot";

// ── Unified decision shape (executive summary view) ─────────────────────
//
// Single deterministic output that fuses decision + execution + negotiation
// into one structure. Computed in the same pass as the broader AcquisitionPlan
// — no logic duplication, just a tighter view of the same data.

export type DecisionLabel = "STRONG BUY" | "BUY" | "MONITOR" | "PASS" | "AVOID";
export type DecisionTiming = "IMMEDIATE" | "THIS_WEEK" | "WAIT";
export type DecisionStrategy = "AGGRESSIVE" | "CONTROLLED" | "PASSIVE" | "WALK";

export type UnifiedDecision = {
  decision: DecisionLabel;
  conviction: number;        // 0–10
  /** Compressed single-action verdict — see compressToDominantAction. */
  dominantAction: DominantAction;
  execution: {
    timing: DecisionTiming;
    maxBuyPrice: number;     // hard ceiling — sacred
    walkAwayPrice: number;   // 2% above ceiling — operator walks above this
  };
  negotiation: {
    anchorPrice: number;     // opening counter
    strategy: DecisionStrategy;
    reasoning: string;       // compressed: "ACTION — qualifier"
    /** Relationship-coherent posture string from the action policy. */
    posture: string;
  };
};

export type SellerResponse =
  | "none"
  | "rejected"
  | "countered"
  | "accepted"
  | "stalled";

export type NegotiationState = {
  currentPhase?: NegotiationPhase;
  lastActionTaken?: string;
  sellerResponse: SellerResponse;
  timeSinceLastActionHours: number;
  sellerCounterPrice?: number;     // when sellerResponse === "countered"
};

export type AcquisitionPlan = {
  // ── Price ladder ──
  openingOffer: number;
  targetBuy: number;
  hardCeiling: number;
  walkAwayTrigger: string;
  // ── Negotiation ──
  negotiationStyle: NegotiationStyle;
  negotiationReasoning: string;
  likelyObjections: string[];
  counterStrategy: string;
  followUpWindowHours: number;
  // ── Hold + exit ──
  estimatedHoldDays: number;
  exitPlatform: string;
  exitReasoning: string;
  // ── Operator priority ──
  urgency: Urgency;
  capitalPriority: CapitalPriority;
  // ── Adaptive negotiation behavior ──
  primaryLeverage: string;
  leverageStrength: number;     // 1-10
  fallbackLeverage: string;
  negotiationPhase: NegotiationPhase;
  capitalContext: CapitalContext;
  // ── Unified decision (executive summary; same data, tighter shape) ──
  decision: UnifiedDecision;
};

// ── Deterministic mappers (style/urgency → unified enums) ───────────────

function mapTiming(urgency: Urgency): DecisionTiming {
  if (urgency === "act-now") return "IMMEDIATE";
  if (urgency === "this-week") return "THIS_WEEK";
  return "WAIT"; // this-month, passive
}

function mapStrategy(
  style: NegotiationStyle,
  trustScore: number,
  buyOverCeiling: boolean
): DecisionStrategy {
  if (buyOverCeiling || trustScore < 50) return "WALK";
  if (style === "Walk-ready") return "WALK";
  if (trustScore < 70 || style === "Patient") return "PASSIVE";
  if (style === "Aggressive" || style === "Confident") return "AGGRESSIVE";
  return "CONTROLLED"; // Balanced
}

function buildUnifiedReasoning(args: {
  liquidity: string;
  netMarginPct: number;
  annualized: number;
  trustScore: number;
  conviction: number;
  capitalContext: CapitalContext;
  dealQuality?: number;
  valuationConfidence?: number;
}): string {
  const parts = [
    `${args.liquidity}-liq`,
    `${args.netMarginPct.toFixed(1)}% net`,
    `${Math.round(args.annualized)}% ann`,
    `trust ${args.trustScore}/100`,
    `conviction ${args.conviction.toFixed(1)}/10`,
    `capital ${args.capitalContext}`,
  ];
  if (typeof args.dealQuality === "number") parts.push(`deal ${args.dealQuality}/100`);
  if (typeof args.valuationConfidence === "number") parts.push(`val-conf ${args.valuationConfidence}/100`);
  return parts.join(" · ");
}

// ── Internal: deal quality score ─────────────────────────────────────────
//
// Distinct from valuation confidence. Confidence answers "how sure are we
// in this fair value?". Deal quality answers "how good is the math IF the
// fair value is correct?". Both feed conviction differently:
//
//   high deal quality + low confidence  → cautious opportunity (don't fully
//                                          squash conviction; the upside is real)
//   moderate deal quality + high confidence → safe but average (let
//                                              conviction reflect the math)
//
// Derived deterministically from annualized return, net margin, and
// liquidity. Cap at 100, floor at 0.
function dealQualityScore(args: {
  annualized: number;
  netMarginPct: number;
  liquidity: string;
}): number {
  let s = 0;
  // Annualized return — dominant factor.
  if (args.annualized >= 200) s += 50;
  else if (args.annualized >= 100) s += 38;
  else if (args.annualized >= 50) s += 26;
  else if (args.annualized >= 25) s += 16;
  else if (args.annualized > 0) s += 6;
  // Net margin %.
  if (args.netMarginPct >= 20) s += 35;
  else if (args.netMarginPct >= 12) s += 26;
  else if (args.netMarginPct >= 6) s += 16;
  else if (args.netMarginPct >= 3) s += 8;
  // Liquidity bonus.
  if (args.liquidity === "High") s += 15;
  else if (args.liquidity === "Med") s += 10;
  else if (args.liquidity === "Low") s += 5;
  return Math.max(0, Math.min(100, s));
}

// Deal-quality conviction floor. High-quality deals refuse to be squashed
// below a certain conviction multiplier even when valuation confidence is
// thin. Low-quality deals get the strict confidence multiplier.
function dealQualityConvictionFloor(deal: number): number {
  if (deal >= 80) return 0.85;
  if (deal >= 60) return 0.75;
  if (deal >= 40) return 0.65;
  return 0.50;
}

// ── Edge taxonomy ────────────────────────────────────────────────────────
//
// "Signal" answers WHAT to do (BUY/MONITOR/PASS). "Edge class" answers
// WHY this deal exists and HOW exploitable it actually is. Top operators
// always know which class they're playing — a "premium" trade gets
// aggressive sizing and aggressive opening; a "fair" trade gets a control
// posture even if the signal label is identical.
//
// Five classes, deterministic, no overlap:
//   premium     — strong math, strong data, low fragility, real edge
//   exploitable — strong math, decent data, manageable fragility
//   interesting — moderate math, worth monitoring or a probing offer
//   fair        — priced reasonably, no clear edge
//   crowded     — apparent spread but the market is too efficient or
//                 the configuration too fragile to capture it
type EdgeClass = "premium" | "exploitable" | "interesting" | "fair" | "crowded";

function computeEdgeClass(args: {
  signal: BuySignal;
  dealQuality: number;
  confidenceScore: number;
  fragilityScore: number;
}): EdgeClass {
  const { signal, dealQuality, confidenceScore, fragilityScore } = args;
  // Hard floor: high fragility downgrades anything to "crowded" — looks
  // good on paper but configuration is too brittle.
  if (fragilityScore >= 60) return "crowded";

  if (signal === "STRONG BUY") {
    if (dealQuality >= 80 && confidenceScore >= 70 && fragilityScore < 35) return "premium";
    if (dealQuality >= 60 && confidenceScore >= 55) return "exploitable";
    return "interesting";
  }
  if (signal === "BUY") {
    if (dealQuality >= 75 && confidenceScore >= 70 && fragilityScore < 35) return "premium";
    if (dealQuality >= 55 && confidenceScore >= 55) return "exploitable";
    return "interesting";
  }
  if (signal === "MONITOR") {
    if (dealQuality >= 70 && confidenceScore >= 60) return "interesting";
    return "fair";
  }
  return "fair";
}

// Opening-offer multiplier scaled by edge class. Premium edge anchors
// harder; fair deals anchor close to seller. The multiplier is applied
// to BOTH the buyPrice and the ceiling — so it's bounded by the lower of
// the two ladders.
function openingMultForEdge(edge: EdgeClass): number {
  if (edge === "premium") return 0.80;
  if (edge === "exploitable") return 0.83;
  if (edge === "interesting") return 0.86;
  if (edge === "fair") return 0.90;
  return 0.92; // crowded — anchor close to seller, but only for symbolic offers
}

// ── DECISION COMPRESSION ─────────────────────────────────────────────────
//
// Single deterministic mapping that collapses every upstream signal into
// one dominant action with one short qualifier. This is the operator step:
// no metric tape, no caveats, no parallel signals — just the play.
//
// Strict priority stack (resolved in order; later steps cannot override
// earlier ones):
//
//   1. Trust hard stop          — ceiling breached or seller unverifiable
//   2. Fragility hard constraint — too many critical assumptions
//   3. Edge class                — primary driver of action tier
//   4. Confidence                — modulates action within the edge tier
//   5. Deal quality              — secondary modulator
//
// Five possible actions:
//   EXECUTE_NOW         — premium edge, clean data, trusted seller, move
//   EXECUTE_CONTROLLED  — real edge, manageable risk, controlled ladder
//   PROBE               — edge exists but inputs are soft, send a low offer
//   WAIT                — no actionable edge or evidence is too thin
//   WALK                — hard stop: math doesn't work or trust is broken

export type DominantAction =
  | "EXECUTE_NOW"
  | "EXECUTE_CONTROLLED"
  | "PROBE"
  | "WAIT"
  | "WALK";

function compressToDominantAction(args: {
  trustScore: number;
  fragilityScore: number;
  edgeClass: EdgeClass;
  confidenceScore: number;
  dealQuality: number;
  buyOverCeiling: boolean;
  signal: BuySignal;
}): { action: DominantAction; qualifier: string } {
  const { trustScore, fragilityScore, edgeClass, confidenceScore, dealQuality, buyOverCeiling, signal } = args;

  // ── 1. TRUST / CEILING HARD STOPS ──
  if (buyOverCeiling) {
    return { action: "WALK", qualifier: "ask above hard ceiling, math doesn't work, do not engage" };
  }
  if (trustScore < 50) {
    return { action: "WALK", qualifier: "trust below floor, seller cannot be verified, walk" };
  }
  if (signal === "PASS" || signal === "AVOID") {
    return { action: "WALK", qualifier: "engine rejected on economics, save the capital" };
  }

  // ── 2. FRAGILITY HARD CONSTRAINT ──
  if (fragilityScore >= 60) {
    return { action: "WALK", qualifier: "fragile configuration, too many critical assumptions, walk" };
  }
  if (fragilityScore >= 40 && confidenceScore < 60) {
    return { action: "WAIT", qualifier: "fragile and unverified, wait for new evidence before action" };
  }

  // ── 3. EDGE CLASS — PRIMARY DRIVER ──
  if (edgeClass === "crowded") {
    return { action: "WAIT", qualifier: "crowded market, visible upside arbitraged, wait for misprice" };
  }
  if (edgeClass === "fair") {
    return { action: "WAIT", qualifier: "no edge present, no asymmetry, wait for price drop" };
  }

  if (edgeClass === "interesting") {
    if (confidenceScore >= 70 && fragilityScore < 25 && trustScore >= 70) {
      return { action: "PROBE", qualifier: "modest edge, clean inputs, probe with low offer" };
    }
    return { action: "WAIT", qualifier: "modest edge, evidence still soft, wait or re-engage on price drop" };
  }

  // ── 4-5. PREMIUM / EXPLOITABLE — confidence + deal quality modulate ──
  if (edgeClass === "premium") {
    if (confidenceScore >= 80 && fragilityScore < 25 && trustScore >= 80 && dealQuality >= 80) {
      return { action: "EXECUTE_NOW", qualifier: "premium edge, clean data, trusted seller, move immediately" };
    }
    if (confidenceScore >= 65 && trustScore >= 70) {
      return { action: "EXECUTE_CONTROLLED", qualifier: "premium edge, manageable risk, execute at controlled ladder" };
    }
    return { action: "PROBE", qualifier: "premium math, data still uncertain, open with verification offer" };
  }

  // exploitable
  if (confidenceScore >= 75 && trustScore >= 75 && fragilityScore < 30 && dealQuality >= 70) {
    return { action: "EXECUTE_CONTROLLED", qualifier: "exploitable edge, clean inputs, controlled execution" };
  }
  if (confidenceScore >= 60 && trustScore >= 70) {
    return { action: "EXECUTE_CONTROLLED", qualifier: "exploitable edge, verify condition before final offer" };
  }
  return { action: "PROBE", qualifier: "exploitable math, evidence soft, send a probing offer only" };
}

// ── DOMINANT ACTION POLICY (the control plane) ───────────────────────────
//
// Single mapping table that defines the contract: dominantAction →
// every behavioral output field. After compression, ALL downstream
// fields are derived from this policy. The upstream urgency / style /
// follow-up logic still runs as analytical intermediates (it informs
// leverage descriptions and edge classification), but its OUTPUT is
// discarded — the engine speaks in one voice from compression onward.
//
// This is the orchestration layer: dominantAction is the primary truth,
// the decision tier is secondary classification, and downstream fields
// can never disagree with the action.

export type ActionPolicy = {
  timing: DecisionTiming;
  strategy: DecisionStrategy;
  urgency: Urgency;
  negotiationPhase: NegotiationPhase;
  followUpWindowHours: number;
  /** Hard cap on conviction (0-10). Conviction can never exceed this for the action. */
  convictionCap: number;
  counterStrategy: string;
  /**
   * Relationship-coherent posture for this action. One short label per action
   * so every operator-facing surface can lead with the same tone. The engine
   * is decisive without being needy, firm without being hostile, and walks
   * without burning future optionality.
   */
  posture: string;
};

export function applyDominantActionPolicy(action: DominantAction): ActionPolicy {
  switch (action) {
    case "EXECUTE_NOW":
      return {
        timing: "IMMEDIATE",
        strategy: "AGGRESSIVE",
        urgency: "act-now",
        negotiationPhase: "counter",
        followUpWindowHours: 24,
        convictionCap: 10,
        posture: "Decisive, respectful, low-friction — make the offer cleanly and close fast.",
        counterStrategy: "Open at anchor, hold firm at target, prioritize close certainty over squeezing the last basis point. Premium edge with clean inputs — move now, courteously, with confidence.",
      };
    case "EXECUTE_CONTROLLED":
      return {
        timing: "THIS_WEEK",
        strategy: "CONTROLLED",
        urgency: "this-week",
        negotiationPhase: "counter",
        followUpWindowHours: 48,
        convictionCap: 8,
        posture: "Firm, credible, terms-aware — disciplined ladder, no theatre.",
        counterStrategy: "Open at anchor. Move halfway between opening and target on the second round, then hold. Trade marginal price for terms (escrow, fast close, clean contingencies) when EV improves.",
      };
    case "PROBE":
      return {
        timing: "THIS_WEEK",
        strategy: "PASSIVE",
        urgency: "this-month",
        negotiationPhase: "entry",
        followUpWindowHours: 168,
        convictionCap: 6,
        posture: "Curious, light, optional — no pressure, no chase, low operator attention.",
        counterStrategy: "Send the opening offer once, no follow-up. If seller engages with movement, escalate to controlled execution. If not, queue for re-engagement on price or evidence change — leave the door open.",
      };
    case "WAIT":
      return {
        timing: "WAIT",
        strategy: "PASSIVE",
        urgency: "passive",
        negotiationPhase: "entry",
        followUpWindowHours: 504,
        convictionCap: 4,
        posture: "Passive, warm, monitor-only — no engagement, optionality preserved.",
        counterStrategy: "Do not engage. Monitor only. Re-evaluate in 21-30 days, or when price drops materially, condition data improves, or comp evidence strengthens.",
      };
    case "WALK":
      return {
        timing: "WAIT",
        strategy: "WALK",
        urgency: "passive",
        negotiationPhase: "walk",
        followUpWindowHours: 0,
        convictionCap: 0,
        posture: "Respectful disengagement — walk cleanly, preserve dignity, leave a clear re-entry door.",
        counterStrategy: "Disengage cleanly, no critique of the seller. Math or evidence doesn't support action at this price. Re-entry is open if price drops below ceiling, condition evidence improves, or new comps emerge — preserve the relationship for later.",
      };
  }
}

// Per-vertical NegotiationStyle for the dominant action — RE prefers
// "Confident" where watches prefers "Aggressive" as its strongest stance.
function watchesStyleForAction(action: DominantAction): NegotiationStyle {
  if (action === "EXECUTE_NOW") return "Aggressive";
  if (action === "EXECUTE_CONTROLLED") return "Balanced";
  if (action === "PROBE") return "Patient";
  if (action === "WAIT") return "Patient";
  return "Walk-ready";
}

function realEstateStyleForAction(action: DominantAction): NegotiationStyle {
  if (action === "EXECUTE_NOW") return "Confident";
  if (action === "EXECUTE_CONTROLLED") return "Balanced";
  if (action === "PROBE") return "Patient";
  if (action === "WAIT") return "Patient";
  return "Walk-ready";
}

// Real-estate pseudo-trust derived from risk band + risk-factor flags.
// RE has no per-record seller trust score, but the compression layer
// expects one. Mapping risk → pseudo-trust gives RE the same hard-stop
// behavior watches has via the trust score: a "High" risk property
// triggers the same WALK gate that a low-trust seller would.
//
// This is the missing input the brief calls out: do NOT leave RE
// compression effectively "always trusted".
function realEstatePseudoTrust(
  risk: string | undefined,
  riskFactors: string[] | undefined
): number {
  const r = (risk ?? "").toLowerCase();
  let t =
    r === "low" ? 90 :
    r === "low-med" ? 80 :
    r === "medium" ? 65 :
    r === "high" ? 45 :
    70;
  const flags = riskFactors ?? [];
  if (flags.some((f) => /flipper|not motivated|no motivation/i.test(f))) t -= 12;
  if (flags.some((f) => /undisclosed|hidden|misrepresented|fraud|scam/i.test(f))) t -= 18;
  if (flags.some((f) => /foundation|structural|sewer|mold/i.test(f))) t -= 6;
  return Math.max(0, Math.min(100, t));
}

// ── Dominant risk axis ───────────────────────────────────────────────────
//
// Picks the worst-scoring axis to surface in the rationale. Operators want
// the single biggest reason this deal could fail — not a list of every
// minor concern.
function dominantRiskAxis(args: {
  trustScore: number;
  confidenceScore: number;
  fragilityScore: number;
  dealQuality: number;
  buyOverCeiling: boolean;
  fragilityFlags: string[];
}): string {
  if (args.buyOverCeiling) return "Ask above hard ceiling — math doesn't work";
  if (args.trustScore < 50) return "Trust below floor — seller cannot be verified";
  if (args.trustScore < 70) return "Seller credibility caution — verify before action";
  if (args.fragilityScore >= 60) {
    return `Fragile configuration — ${args.fragilityFlags[0] ?? "multiple weak assumptions"}`;
  }
  if (args.confidenceScore < 55) return "Valuation confidence weak — comp/condition evidence thin";
  if (args.fragilityScore >= 35) {
    return `Single critical assumption — ${args.fragilityFlags[0] ?? "fragile dependency"}`;
  }
  if (args.dealQuality < 50) return "Thin economic edge — spread won't survive friction shocks";
  if (args.confidenceScore < 70) return "Moderate valuation uncertainty";
  return "Low residual risk";
}

const round50 = (n: number) => Math.round(n / 50) * 50;
const round500 = (n: number) => Math.round(n / 500) * 500;

type LeverageResult = { primary: string; strength: number; fallback: string };

function capitalContextNote(ctx: CapitalContext): string {
  if (ctx === "anchor") return "Anchor deal — commit and move.";
  if (ctx === "last-slot") return "Last-slot deployment — don't burn relationships pushing hard.";
  return "Optional position — commit if it fits cleanly.";
}

function phaseFromStyle(style: NegotiationStyle): NegotiationPhase {
  if (style === "Walk-ready") return "walk";
  if (style === "Patient") return "entry";
  return "counter";
}

// ─────────────────────────────────────────────────────────────────────────
// WATCHES
// ─────────────────────────────────────────────────────────────────────────

export type WatchesAcquisitionInput = {
  signal: BuySignal;
  buyPrice: number;
  maxBuy: number;
  liquidity: Liquidity;
  trustScore: number;
  capital: CapitalTier;
  score: number;
  netMarginPct: number;
  annualized: number;
  /** 0-100 valuation confidence; defaults to 100 (full trust) when omitted. */
  confidenceScore?: number;
  /** 0-100 valuation fragility; defaults to 0. */
  fragilityScore?: number;
  /** Dominant-assumption flags from the valuation engine. */
  fragilityFlags?: string[];
  tag?: string;
  boxPapers?: string;
  serviceHistory?: string | null;
  sellerFeedbackCount?: number;
};

function computeWatchesLeverage(args: {
  buyPrice: number;
  maxBuy: number;
  liquidity: Liquidity;
  trustScore: number;
  capitalContext: CapitalContext;
  styleLocked: boolean;
  style: NegotiationStyle;
}): LeverageResult {
  const { buyPrice, maxBuy, liquidity, trustScore, capitalContext, style } = args;

  if (style === "Walk-ready") {
    return {
      primary:
        "Walking is the only leverage — math doesn't work above ceiling, sellers come back to firm offers",
      strength: 6,
      fallback:
        "Re-issue the same offer at 21-30 days; the seller's position softens with time on market",
    };
  }

  if (trustScore < 70) {
    return {
      primary:
        "Verification leverage — demand serial check, OEM service docs, and in-hand photos before committing",
      strength: 5,
      fallback:
        "Walk if seller refuses transparency; another listing surfaces with cleaner provenance",
    };
  }

  if (liquidity === "High" && trustScore >= 85) {
    if (buyPrice <= maxBuy) {
      const baseStrength = capitalContext === "last-slot" ? 7 : 9;
      return {
        primary:
          "Deep alternative inventory — same reference resurfaces within days, you can always walk",
        strength: baseStrength,
        fallback:
          "Time-limit the offer (24h expiry) to force seller decision; if they hold, queue the next listing",
      };
    }
    // Verified seller, high-velocity reference, but ask is above ceiling — ceiling discipline is the play
    return {
      primary:
        "Verified seller with deep alternative inventory — ceiling discipline is your leverage, not patience",
      strength: 7,
      fallback:
        "Hold firm at target; if seller won't come to ceiling, queue the next listing within days",
    };
  }

  if (liquidity === "High") {
    // Moderate trust (70-84) with high-velocity reference
    return {
      primary:
        "High-velocity reference gives you alternatives; seller trust is moderate — verify in-hand before pressing",
      strength: 6,
      fallback:
        "Walk and queue the next listing — don't escalate against a mid-trust seller",
    };
  }

  if (liquidity === "Med") {
    return {
      primary:
        "Reference patience — moderate-velocity piece, you can take time to think",
      strength: 5,
      fallback:
        "Re-engage seller in 7-10 days at the same offer; sellers often soften over time",
    };
  }

  // Low liquidity
  return {
    primary:
      "Time leverage — slow-moving reference means seller has no buyer pressure to play against you",
    strength: 4,
    fallback: "Walk and revisit in 30-60 days; the piece will likely still be available",
  };
}

export function computeWatchesAcquisition(
  input: WatchesAcquisitionInput
): AcquisitionPlan | null {
  const {
    signal: rawSignal,
    buyPrice,
    maxBuy,
    liquidity,
    trustScore,
    score,
    netMarginPct,
    annualized,
    confidenceScore,
    fragilityScore,
    fragilityFlags,
    tag,
    boxPapers,
    serviceHistory,
    sellerFeedbackCount,
  } = input;

  if (rawSignal === "PASS" || rawSignal === "AVOID") return null;
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) return null;
  if (!Number.isFinite(maxBuy) || maxBuy <= 0) return null;

  // ── CONFIDENCE GATE ──
  // Low valuation confidence shrinks the ceiling, tightens walk-away buffer,
  // dampens conviction, and (if very low) caps the signal at MONITOR.
  const confAdj: ConfidenceAdjustment = confidenceToExecution(
    typeof confidenceScore === "number" ? confidenceScore : 100
  );
  const signal: BuySignal = confAdj.forceMonitor
    ? rawSignal === "STRONG BUY" || rawSignal === "BUY"
      ? "MONITOR"
      : rawSignal
    : rawSignal;

  // ── EDGE CLASS ──
  // Computed up front so it can drive the price ladder, opening offer,
  // and aggressive-style gate in one consistent pass.
  const dealQEarly = dealQualityScore({ annualized, netMarginPct, liquidity });
  const fragility = typeof fragilityScore === "number" ? fragilityScore : 0;
  const edgeClass = computeEdgeClass({
    signal,
    dealQuality: dealQEarly,
    confidenceScore: typeof confidenceScore === "number" ? confidenceScore : 100,
    fragilityScore: fragility,
  });

  // ── 1. PRICE LADDER ──
  // Ceiling: confidence multiplier × smoothed-trust haircut × fragility haircut.
  // Trust 50-69 (CAUTION) gets a small additional ceiling shrink even when
  // it didn't fall below the WALK floor — caution must show up in the math,
  // not just the negotiation style. Fragility ≥ 35 also nudges ceiling down.
  const trustCeilMult =
    trustScore < 70 ? 0.97 :
    trustScore < 85 ? 0.99 :
    1.00;
  const fragilityCeilMult =
    fragility >= 60 ? 0.94 :
    fragility >= 35 ? 0.97 :
    1.00;
  const ceiling = Math.round(maxBuy * confAdj.ceilingMultiplier * trustCeilMult * fragilityCeilMult);

  // Opening offer scales with edge class — premium edge anchors hard,
  // fair deals anchor close to seller.
  const openingMult = openingMultForEdge(edgeClass);
  const opening = round50(Math.min(buyPrice * openingMult, ceiling * openingMult));
  const target = round50(Math.min(buyPrice * 0.93, ceiling * 0.95));

  // ── 2. CAPITAL CONTEXT (still needed for leverage and capital priority) ──
  let capitalContext: CapitalContext;
  if (score >= 8) capitalContext = "anchor";
  else if (score >= 5) capitalContext = "optional";
  else capitalContext = "last-slot";

  // ── 3. COMPRESSION (the control plane) ──
  // Single-call collapse of all upstream signals into one dominant action.
  // From this point forward, downstream output fields are derived from the
  // ActionPolicy mapping — no upstream urgency / style logic survives as
  // an output. The engine speaks in one voice.
  const compressed = compressToDominantAction({
    trustScore,
    fragilityScore: fragility,
    edgeClass,
    confidenceScore: typeof confidenceScore === "number" ? confidenceScore : 100,
    dealQuality: dealQEarly,
    buyOverCeiling: buyPrice > ceiling,
    signal,
  });
  const policy = applyDominantActionPolicy(compressed.action);
  const style: NegotiationStyle = watchesStyleForAction(compressed.action);

  // ── 4. LEVERAGE (uses the compressed-action style — coherent with action) ──
  const leverage = computeWatchesLeverage({
    buyPrice,
    maxBuy,
    liquidity,
    trustScore,
    capitalContext,
    styleLocked: compressed.action === "WALK" || trustScore < 70,
    style,
  });

  // ── 5. WALK-AWAY TRIGGER ──
  // Buffer above ceiling shrinks as confidence falls — operator walks earlier
  // when valuation is uncertain. Fragility ≥ 60 zeros it out entirely. WALK
  // action zeros it out unconditionally.
  const baseBuffer = confAdj.walkAwayBufferPct;
  const fragilityWalkBufferMult = fragility >= 60 ? 0 : fragility >= 35 ? 0.5 : 1;
  const walkBufferPct = compressed.action === "WALK" ? 0 : baseBuffer * fragilityWalkBufferMult;
  const ceilingPlusBuffer = Math.round(ceiling * (1 + walkBufferPct));
  const walkAwayTrigger =
    compressed.action === "WALK"
      ? "Engine has already walked. Ceiling is non-negotiable — re-engagement requires new evidence (price drop, condition update, or seller verification)."
      : `If seller refuses to move below $${ceilingPlusBuffer.toLocaleString("en-US")} (${(walkBufferPct * 100).toFixed(1)}% above max-buy ceiling — buffer narrowed by valuation confidence and fragility), or if serial fails registry verification, walk immediately. The ceiling is non-negotiable.`;

  // ── 6. NEGOTIATION REASONING (leverage-prioritized) ──
  const negotiationReasoning = `${style} style (leverage ${leverage.strength}/10): ${leverage.primary}. ${capitalContextNote(capitalContext)}`;

  // ── 7. OBJECTIONS (color — independent of style) ──
  const objections: string[] = [];
  if (boxPapers === "full_set") objections.push("Full set adds 15% to resale, you have to pay for it");
  if (boxPapers === "neither") objections.push("The watch matters, not the cardboard");
  if (serviceHistory) objections.push("Recently serviced — no maintenance for years");
  if (liquidity === "High") objections.push("This reference is hot right now");
  if (liquidity === "Low") objections.push("Rare reference, you won't see another like it");
  if (typeof sellerFeedbackCount === "number" && sellerFeedbackCount >= 1000) {
    objections.push("Established seller, firm on price");
  }
  objections.push("I have other interested buyers");
  objections.push("I paid above wholesale at retail");

  // ── HOLD + EXIT ──
  const holdDays = HOLD_DAYS_BY_LIQUIDITY[liquidity];
  const t = (tag ?? "").toLowerCase();
  let exitPlatform: string;
  let exitReasoning: string;
  if (t === "dress") {
    exitPlatform = "Direct to private dealer network";
    exitReasoning = "Dress segment moves slowly on consumer platforms — dealer-to-dealer is the fastest exit.";
  } else if (t === "vintage") {
    exitPlatform = "Specialist auction (Phillips, Christie's online)";
    exitReasoning = "Vintage commands premiums in curated channels; consumer platforms underprice provenance.";
  } else if (buyPrice >= 25000) {
    exitPlatform = "Chrono24 with authentication, or grey dealer network";
    exitReasoning = "High-end pieces move fastest through authenticated channels; dealer network bypasses platform fees.";
  } else if (buyPrice >= 10000) {
    exitPlatform = "Chrono24 or WatchBox-style dealer network";
    exitReasoning = "Mid-tier sport pieces have deep buyer pools on Chrono24; ~6.5% commission is worth the velocity.";
  } else {
    exitPlatform = "WatchUSeek WTS forum or eBay (Authenticity Guarantee)";
    exitReasoning = "Sub-$10K pieces have abundant buyers on enthusiast forums and eBay's authenticated marketplace.";
  }

  // ── CAPITAL PRIORITY (score-driven) ──
  const capitalPriority: CapitalPriority =
    score >= 8 ? "anchor" :
    score >= 6 ? "core" :
    score >= 4 ? "satellite" :
    "skip";

  // ── UNIFIED DECISION (executive summary) ──
  // Conviction blends valuation confidence + deal quality, then is HARD
  // CAPPED by the action policy. WALK can never have positive conviction;
  // WAIT can never exceed 4; PROBE can never exceed 6; etc. This is a
  // coherence invariant — conviction can never disagree with action.
  const dealQ = dealQEarly;
  const dqFloor = dealQualityConvictionFloor(dealQ);
  const blendedMult = Math.max(confAdj.convictionMultiplier, dqFloor) * Math.min(1, dqFloor + 0.15);
  const fragilityConvMult = fragility >= 60 ? 0.80 : fragility >= 35 ? 0.92 : 1.00;
  const rawConviction = Math.round(score * blendedMult * fragilityConvMult * 10) / 10;
  const adjustedConviction = Math.min(rawConviction, policy.convictionCap);

  const reasoning = `${compressed.action} — ${compressed.qualifier}`;

  const decision: UnifiedDecision = {
    decision: signal,
    conviction: adjustedConviction,
    dominantAction: compressed.action,
    execution: {
      timing: policy.timing,
      maxBuyPrice: ceiling,
      walkAwayPrice: ceilingPlusBuffer,
    },
    negotiation: {
      anchorPrice: opening,
      strategy: policy.strategy,
      reasoning,
      posture: policy.posture,
    },
  };

  return {
    openingOffer: opening,
    targetBuy: target,
    hardCeiling: ceiling,
    walkAwayTrigger,
    negotiationStyle: style,
    negotiationReasoning,
    likelyObjections: objections.slice(0, 4),
    counterStrategy: policy.counterStrategy,
    followUpWindowHours: policy.followUpWindowHours,
    estimatedHoldDays: holdDays,
    exitPlatform,
    exitReasoning,
    urgency: policy.urgency,
    capitalPriority,
    primaryLeverage: leverage.primary,
    leverageStrength: leverage.strength,
    fallbackLeverage: leverage.fallback,
    negotiationPhase: policy.negotiationPhase,
    capitalContext,
    decision,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// REAL ESTATE
// ─────────────────────────────────────────────────────────────────────────

export type RealEstateAcquisitionInput = {
  label: string;
  askUsd: number;
  maoUsd: number;
  arvUsd: number;
  risk: string;
  tag?: string;
  riskFactors?: string[];
  score?: number;
  /** 0-100 valuation confidence; defaults to 100 (full trust) when omitted. */
  confidenceScore?: number;
  /** 0-100 valuation fragility; defaults to 0. */
  fragilityScore?: number;
  /** Dominant-assumption flags from the valuation engine. */
  fragilityFlags?: string[];
};

function computeRealEstateLeverage(args: {
  askUsd: number;
  maoUsd: number;
  risk: string;
  capitalContext: CapitalContext;
  style: NegotiationStyle;
}): LeverageResult {
  const { askUsd, maoUsd, risk, capitalContext, style } = args;
  const askVsMao = askUsd / maoUsd;

  if (style === "Walk-ready") {
    return {
      primary:
        "Walking is the only leverage — no path to profit above ceiling, save the time for the next deal",
      strength: 4,
      fallback: "Re-engage at 30 days on market when seller is more flexible",
    };
  }

  if (askVsMao <= 0.95 && (risk === "Low" || risk === "Low-Med")) {
    const baseStrength = capitalContext === "anchor" ? 9 : 8;
    return {
      primary:
        "Cash + 7-day close + zero contingencies — you ARE the deal in this market",
      strength: baseStrength,
      fallback:
        "Escalator clause on price (capped at MAO) in exchange for accelerated close timeline",
    };
  }

  if (askVsMao <= 1.0) {
    return {
      primary:
        "Cash terms and close certainty — non-negotiable execution against retail competition",
      strength: 7,
      fallback: "Add earnest money escalation in exchange for waived inspection contingency",
    };
  }

  if (askVsMao <= 1.05) {
    return {
      primary:
        "Terms over price — your cash close beats retail buyers needing financing",
      strength: 6,
      fallback: "Anchor on closing speed and POF; concede on minor closing costs if needed",
    };
  }

  // 1.05 < askVsMao <= 1.20
  return {
    primary:
      "Time leverage — make a firm offer with hard expiration, re-engage at 30 DOM",
    strength: 5,
    fallback: "Walk and let DOM age the listing; sellers come back to standing offers",
  };
}

export function computeRealEstateAcquisition(
  input: RealEstateAcquisitionInput
): AcquisitionPlan | null {
  const { label, askUsd, maoUsd, risk, tag, riskFactors, score, confidenceScore, fragilityScore, fragilityFlags } = input;

  const upperLabelRaw = (label ?? "").toUpperCase();
  if (upperLabelRaw === "PASS" || upperLabelRaw === "AVOID") return null;
  if (!Number.isFinite(askUsd) || askUsd <= 0) return null;
  if (!Number.isFinite(maoUsd) || maoUsd <= 0) return null;

  // ── CONFIDENCE GATE ──
  const confAdj: ConfidenceAdjustment = confidenceToExecution(
    typeof confidenceScore === "number" ? confidenceScore : 100
  );
  const upperLabel = confAdj.forceMonitor && (upperLabelRaw === "ACT NOW" || upperLabelRaw === "STRONG BUY" || upperLabelRaw === "BUY")
    ? "MONITOR"
    : upperLabelRaw;

  // ── EDGE CLASS (computed early) ──
  // RE has no BuySignal in the watches sense — we map curated label to it.
  const earlySignal: BuySignal =
    upperLabel === "ACT NOW" || upperLabel === "STRONG BUY" || upperLabel === "STRONG"
      ? "STRONG BUY"
      : upperLabel === "BUY"
      ? "BUY"
      : upperLabel === "MONITOR"
      ? "MONITOR"
      : "PASS";
  const equityPctEarly = ((maoUsd - askUsd) / askUsd) * 100;
  const arvSpreadPctEarly = ((input.arvUsd - askUsd) / askUsd) * 100;
  const liquidityProxy: string =
    (risk ?? "").toLowerCase() === "low" || (risk ?? "").toLowerCase() === "low-med"
      ? "High"
      : (risk ?? "").toLowerCase() === "medium"
      ? "Med"
      : "Low";
  const dealQEarly = dealQualityScore({
    annualized: arvSpreadPctEarly,
    netMarginPct: equityPctEarly,
    liquidity: liquidityProxy,
  });
  const fragility = typeof fragilityScore === "number" ? fragilityScore : 0;
  const edgeClass = computeEdgeClass({
    signal: earlySignal,
    dealQuality: dealQEarly,
    confidenceScore: typeof confidenceScore === "number" ? confidenceScore : 100,
    fragilityScore: fragility,
  });

  // ── 1. PRICE LADDER ──
  // RE has no per-record trust score; risk band is the proxy. High-risk
  // properties get a small additional ceiling shrink, same logic shape as
  // the watches trust cliff smoothing.
  const riskCeilMult =
    (risk ?? "").toLowerCase() === "high" ? 0.96 :
    (risk ?? "").toLowerCase() === "medium" ? 0.98 :
    1.00;
  const fragilityCeilMult =
    fragility >= 60 ? 0.94 :
    fragility >= 35 ? 0.97 :
    1.00;
  const ceiling = Math.round(maoUsd * confAdj.ceilingMultiplier * riskCeilMult * fragilityCeilMult);

  // Edge-aware opening — premium-edge deals anchor harder.
  const openingMult = openingMultForEdge(edgeClass);
  // RE openings start tighter than watches (0.92 baseline) — adjust the
  // edge mult into RE's range by mapping 0.80→0.88, 0.83→0.90, etc.
  const reOpeningMult = openingMult + 0.08;
  const opening = round500(Math.min(askUsd * reOpeningMult, ceiling * reOpeningMult));
  const target = round500(Math.min(askUsd * 0.96, ceiling * 0.97));

  // ── 2. CAPITAL CONTEXT ──
  let capitalContext: CapitalContext;
  if (typeof score === "number" && score >= 8) capitalContext = "anchor";
  else if (typeof score === "number" && score >= 5) capitalContext = "optional";
  else capitalContext = "last-slot";

  // ── 3. COMPRESSION (the control plane) ──
  // RE pseudo-trust: derive a trust-equivalent score from risk band +
  // risk-factor flags so the compression layer's hard-stop logic works
  // identically to watches. Without this, RE compression was effectively
  // always-trusted and could WALK only via the ceiling check.
  const pseudoTrust = realEstatePseudoTrust(risk, riskFactors);
  const compressed = compressToDominantAction({
    trustScore: pseudoTrust,
    fragilityScore: fragility,
    edgeClass,
    confidenceScore: typeof confidenceScore === "number" ? confidenceScore : 100,
    dealQuality: dealQEarly,
    buyOverCeiling: askUsd > ceiling,
    signal: earlySignal,
  });
  const policy = applyDominantActionPolicy(compressed.action);
  const style: NegotiationStyle = realEstateStyleForAction(compressed.action);

  // ── 4. LEVERAGE (uses compressed-action style) ──
  const leverage = computeRealEstateLeverage({
    askUsd,
    maoUsd,
    risk,
    capitalContext,
    style,
  });

  // ── 5. NEGOTIATION REASONING (leverage-prioritized) ──
  const negotiationReasoning = `${style} style (leverage ${leverage.strength}/10): ${leverage.primary}. ${capitalContextNote(capitalContext)}`;

  // ── 6. WALK-AWAY TRIGGER ──
  const baseBuffer = confAdj.walkAwayBufferPct;
  const fragilityWalkBufferMult = fragility >= 60 ? 0 : fragility >= 35 ? 0.5 : 1;
  const walkBufferPct = compressed.action === "WALK" ? 0 : baseBuffer * fragilityWalkBufferMult;
  const ceilingPlusBufferRe = Math.round(ceiling * (1 + walkBufferPct));
  const walkAwayTrigger =
    compressed.action === "WALK"
      ? "Engine has already walked. MAO is non-negotiable — re-engagement requires new evidence (price drop, condition update, or risk band downgrade)."
      : `If seller refuses to move below $${ceilingPlusBufferRe.toLocaleString("en-US")} (${(walkBufferPct * 100).toFixed(1)}% above max-buy ceiling — buffer narrowed by valuation confidence and fragility), or if inspection reveals undisclosed material issues that push rehab above current estimate, walk and re-engage at 30 days on market.`;

  // ── OBJECTIONS ──
  const objections: string[] = [];
  objections.push("Comps support our list price");
  objections.push("We have multiple offers / strong interest");
  if (tag === "Flip") objections.push("Your ARV is too conservative");
  if (risk === "High") objections.push("The disclosed issues are minor / overstated");
  const hasRehabFlag = (riskFactors ?? []).some(f =>
    /rehab|foundation|roof|hvac|kitchen|electrical|plumbing|structural/i.test(f)
  );
  if (hasRehabFlag) objections.push("Your rehab budget is too high");

  // ── HOLD + EXIT (tag-driven) ──
  const t = (tag ?? "").toLowerCase();
  let estimatedHoldDays: number;
  let exitPlatform: string;
  let exitReasoning: string;

  if (t === "rental") {
    estimatedHoldDays = 365 * 5;
    exitPlatform = "Hold long-term, refinance after stabilization";
    exitReasoning = "Rental thesis — long hold for cash flow and appreciation. Cash-out refi at 12-18 months to recycle equity.";
  } else if (t === "brrrr") {
    estimatedHoldDays = 180;
    exitPlatform = "Refinance and hold (BRRRR)";
    exitReasoning = "Refi at 75% LTV after rehab to pull most of your basis back, then hold for cash flow.";
  } else if (t === "flip") {
    estimatedHoldDays = 120;
    exitPlatform = "MLS retail listing with FSBO outreach";
    exitReasoning = "Standard rehab-and-flip — MLS gives broad exposure; FSBO outreach captures investor buyers fast.";
  } else if (t === "equity play") {
    estimatedHoldDays = 90;
    exitPlatform = "MLS retail listing or wholesale assignment";
    exitReasoning = "Already-discounted entry — flip retail for full ARV capture, or assign to another investor for fast turn.";
  } else {
    estimatedHoldDays = 120;
    exitPlatform = "MLS retail listing";
    exitReasoning = "Default rehab-and-flip exit through retail MLS channel.";
  }

  // ── CAPITAL PRIORITY ──
  const capitalPriority: CapitalPriority =
    typeof score === "number" && score >= 8 ? "anchor" :
    typeof score === "number" && score >= 6.5 ? "core" :
    typeof score === "number" && score >= 5 ? "satellite" :
    "skip";

  // ── UNIFIED DECISION ──
  // For real estate, "decision" mirrors the curated label (ACT NOW, STRONG BUY,
  // MONITOR, PASS) — we coerce into the shared DecisionLabel space.
  const decisionLabel: DecisionLabel =
    upperLabel === "ACT NOW" || upperLabel === "STRONG BUY" || upperLabel === "STRONG"
      ? "STRONG BUY"
      : upperLabel === "BUY"
      ? "BUY"
      : upperLabel === "MONITOR"
      ? "MONITOR"
      : upperLabel === "AVOID"
      ? "AVOID"
      : "PASS";

  // Conviction blend, then HARD-CAPPED by action policy. Coherence invariant:
  // conviction can never exceed what the dominant action allows.
  const dealQ = dealQEarly;
  const dqFloor = dealQualityConvictionFloor(dealQ);
  const baseScore = typeof score === "number" ? score : 0;
  const blendedMult = Math.max(confAdj.convictionMultiplier, dqFloor) * Math.min(1, dqFloor + 0.15);
  const fragilityConvMult = fragility >= 60 ? 0.80 : fragility >= 35 ? 0.92 : 1.00;
  const rawConviction = Math.round(baseScore * blendedMult * fragilityConvMult * 10) / 10;
  const adjustedConviction = Math.min(rawConviction, policy.convictionCap);

  const reasoning = `${compressed.action} — ${compressed.qualifier}`;

  const decision: UnifiedDecision = {
    decision: decisionLabel,
    conviction: adjustedConviction,
    dominantAction: compressed.action,
    execution: {
      timing: policy.timing,
      maxBuyPrice: ceiling,
      walkAwayPrice: ceilingPlusBufferRe,
    },
    negotiation: {
      anchorPrice: opening,
      strategy: policy.strategy,
      reasoning,
      posture: policy.posture,
    },
  };

  return {
    openingOffer: opening,
    targetBuy: target,
    hardCeiling: ceiling,
    walkAwayTrigger,
    negotiationStyle: style,
    negotiationReasoning,
    likelyObjections: objections.slice(0, 4),
    counterStrategy: policy.counterStrategy,
    followUpWindowHours: policy.followUpWindowHours,
    estimatedHoldDays,
    exitPlatform,
    exitReasoning,
    urgency: policy.urgency,
    capitalPriority,
    primaryLeverage: leverage.primary,
    leverageStrength: leverage.strength,
    fallbackLeverage: leverage.fallback,
    negotiationPhase: policy.negotiationPhase,
    capitalContext,
    decision,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// NEGOTIATION STATE EVOLUTION
// ─────────────────────────────────────────────────────────────────────────
//
// Pure function. Takes a base AcquisitionPlan and a NegotiationState, returns
// a new plan that has been evolved according to the seller's response and
// elapsed time. Same inputs always produce the same output.
//
// The hard ceiling stays sacred — any state that would imply paying above
// ceiling forces a Walk-ready style and walk phase.

const URGENCY_DOWN: Record<Urgency, Urgency> = {
  "act-now": "this-week",
  "this-week": "this-month",
  "this-month": "passive",
  "passive": "passive",
};

export function evolveAcquisitionPlan(
  base: AcquisitionPlan,
  state: NegotiationState
): AcquisitionPlan {
  const plan: AcquisitionPlan = { ...base };
  const sr = state.sellerResponse;
  const t = state.timeSinceLastActionHours;
  const window = plan.followUpWindowHours;

  // ── ACCEPTED ──
  if (sr === "accepted") {
    plan.negotiationPhase = "counter";
    plan.negotiationReasoning =
      `Seller accepted. Move to closing — verify funds, lock the wire, complete the trade. ` +
      plan.negotiationReasoning;
    return plan;
  }

  // ── REJECTED ──
  if (sr === "rejected") {
    const oldPrimary = plan.primaryLeverage;
    plan.primaryLeverage = plan.fallbackLeverage;
    plan.fallbackLeverage = "Out of leverage — disengage and protect your time for the next deal.";
    plan.leverageStrength = Math.max(1, plan.leverageStrength - 2);
    plan.negotiationStyle = "Walk-ready";
    plan.negotiationPhase = "walk";
    plan.negotiationReasoning =
      `Seller rejected the offer. Primary leverage exhausted — falling back to: ${plan.primaryLeverage}. (Was: ${oldPrimary}.) ` +
      plan.negotiationReasoning;
    return plan;
  }

  // ── COUNTERED ──
  if (sr === "countered") {
    const counter = state.sellerCounterPrice;
    if (typeof counter === "number" && Number.isFinite(counter) && counter > 0) {
      if (counter > plan.hardCeiling) {
        // Sacred ceiling — walk
        plan.negotiationStyle = "Walk-ready";
        plan.negotiationPhase = "walk";
        plan.negotiationReasoning =
          `Seller countered at $${counter.toLocaleString("en-US")} — above your hard ceiling of $${plan.hardCeiling.toLocaleString("en-US")}. The ceiling is sacred. Walk away. ` +
          plan.negotiationReasoning;
      } else {
        // Workable counter — recompute target as midpoint of opening and seller counter
        const newTarget = Math.round((plan.openingOffer + counter) / 2);
        const oldTarget = plan.targetBuy;
        plan.targetBuy = newTarget;
        plan.negotiationPhase = "counter";
        plan.negotiationReasoning =
          `Seller countered at $${counter.toLocaleString("en-US")}. Target updated from $${oldTarget.toLocaleString("en-US")} to $${newTarget.toLocaleString("en-US")} (midpoint of opening and seller counter). Hard ceiling $${plan.hardCeiling.toLocaleString("en-US")} unchanged. ` +
          plan.negotiationReasoning;
      }
    } else {
      plan.negotiationPhase = "counter";
      plan.negotiationReasoning =
        `Seller countered (price unspecified). Hold target at $${plan.targetBuy.toLocaleString("en-US")} until they name a number. ` +
        plan.negotiationReasoning;
    }
    return plan;
  }

  // ── STALLED ──
  if (sr === "stalled") {
    if (t > window * 2) {
      plan.negotiationStyle = "Walk-ready";
      plan.negotiationPhase = "walk";
      plan.urgency = URGENCY_DOWN[plan.urgency];
      plan.negotiationReasoning =
        `Seller stalled for ${t}h (${(t / window).toFixed(1)}× your follow-up window of ${window}h). Silence is a no. Walk away and free the capital. ` +
        plan.negotiationReasoning;
    } else {
      const oldPrimary = plan.primaryLeverage;
      plan.primaryLeverage = plan.fallbackLeverage;
      plan.fallbackLeverage = "Walk away if no response within the next follow-up window.";
      plan.negotiationReasoning =
        `Seller stalled (${t}h since last action). Re-engaging with fallback leverage: ${plan.primaryLeverage}. (Original primary was: ${oldPrimary}.) ` +
        plan.negotiationReasoning;
    }
    return plan;
  }

  // ── NO RESPONSE — time-based escalation ──
  if (sr === "none") {
    if (t > window * 2) {
      plan.negotiationStyle = "Walk-ready";
      plan.negotiationPhase = "walk";
      plan.negotiationReasoning =
        `${t}h since last action — exceeds 2× your follow-up window (${window}h). Walk away. ` +
        plan.negotiationReasoning;
    } else if (t > window) {
      const oldPrimary = plan.primaryLeverage;
      plan.primaryLeverage = plan.fallbackLeverage;
      plan.fallbackLeverage = "Walk away within the next follow-up window if still no response.";
      plan.negotiationReasoning =
        `${t}h since last action — past follow-up window (${window}h). Escalate with fallback leverage: ${plan.primaryLeverage}. (Was: ${oldPrimary}.) ` +
        plan.negotiationReasoning;
    }
    // If t <= window, no change — still within the patience window
    return plan;
  }

  return plan;
}
