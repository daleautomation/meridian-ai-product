// Meridian — multi-layer closeability model.
//
// Closeability is no longer a single heuristic — it's the weighted
// combination of four layers that mirror how reps actually decide
// which lead is "easy to close":
//
//   STRUCTURAL — can we even reach this business?
//   PAIN       — how strongly is revenue leaking right now?
//   CONVERSION — can a rep deliver the pitch in under 10 seconds?
//   TIMING     — is there a clock on this opportunity?
//
// A weighted blend produces a base score; caps, an easy-win boost,
// friction tax, and a believability check then shape the spread so
// top leads land at 90+ and weak leads sit visibly under 60.
//
// Pure / deterministic. No I/O.

import type { NormalizedLead } from "@/lib/leads/normalizedLead";
import type { Finding, LeadDiagnostics } from "@/lib/diagnostics/leadDiagnostics";

export type CloseabilityLabel = "Weak" | "Moderate" | "Strong" | "High-Intent";

export type CloseabilityLayers = {
  structural: number;  // 0..100
  pain: number;        // 0..100
  conversion: number;  // 0..100
  timing: number;      // 0..100
};

export type CloseabilityResult = {
  score: number;        // 0..100, integer
  label: CloseabilityLabel;
  reason: string;
  layers: CloseabilityLayers;
  /** Adjustments applied on top of the weighted blend (boost/tax/cap). */
  adjustments: string[];
};

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

// ── Layer scorers ────────────────────────────────────────────────────

function scoreStructural(lead: NormalizedLead): number {
  let s = 50;
  if (lead.phone) s += 25;
  if (lead.email || lead.verifiedEmail) s += 15;
  if (lead.website) s += 10;
  if (lead.location) s += 5;
  if (lead.crm?.status && lead.crm.status !== "NEW") s += 5;
  if (!lead.companyName || lead.companyName === "(unknown)") s -= 30;
  return clamp(s);
}

function scorePain(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
  top: Finding | null,
): number {
  let s = 30;
  if (top) {
    if (top.confidence === "high") s += 35;
    else if (top.confidence === "medium") s += 20;
    else s += 10;
  } else {
    s -= 20; // no finding = unclear pain
  }
  const findings = diagnostics?.findings ?? [];
  const highCount = findings.filter((f) => f.confidence === "high").length;
  if (highCount >= 2) s += 15; // revenue clearly leaking from multiple angles
  // Specific high-pain markers — concrete, observable losses.
  if (lead.signals.hasWebsite === false || !lead.website) s += 10;
  if (typeof lead.signals.rating === "number" && lead.signals.rating < 4.0) s += 10;
  if (typeof lead.signals.reviewCount === "number" && lead.signals.reviewCount < 30) s += 5;
  // Trade-aware: HVAC in season is acute pain because every missed
  // call right now is a job lost forever.
  if (lead.moduleId === "hvac") s += 10;
  return clamp(s);
}

function scoreConversion(
  lead: NormalizedLead,
  top: Finding | null,
): number {
  let s = 50;
  // Concrete, fast-to-explain angles raise conversion. Abstract
  // angles drop it.
  if (top) {
    switch (top.type) {
      case "website":
      case "conversion":
        s += 30; // "you don't have a website" lands in 5 seconds
        break;
      case "reviews":
        s += 20; // "your review count is half your competitor's" — concrete
        break;
      case "seo":
        s += 5;  // needs explanation
        break;
      case "content":
      case "opportunity":
        s -= 5;  // abstract — rep has to teach before pitching
        break;
    }
  } else {
    s -= 10;
  }
  // Easier warm-up if we have a name to address.
  if (lead.phone && (lead.email || lead.verifiedEmail)) s += 5;
  // Believability check: low-confidence top findings need more
  // narrative than the rep can deliver in 10s.
  if (top?.confidence === "low") s -= 10;
  // Opportunity-fallback findings are positioning, not problems —
  // harder to land cold.
  if (top?.type === "opportunity") s -= 8;
  return clamp(s);
}

function scoreTiming(
  lead: NormalizedLead,
  top: Finding | null,
): number {
  let s = 40;
  // Trade-driven urgency.
  if (lead.moduleId === "hvac") s += 30; // seasonal demand
  if (lead.signals.stormArea === true) s += 20;
  if (lead.signals.emergencyServiceGap === true) s += 20;
  // Active conversion leak = clock is ticking.
  if (top?.confidence === "high" && (top.type === "website" || top.type === "conversion")) s += 20;
  // Stale reputation = customers slipping right now.
  if (lead.signals.recentActivity === false) s += 15;
  // No urgency signal at all — no clock.
  if (
    !top &&
    lead.moduleId !== "hvac" &&
    lead.signals.stormArea !== true &&
    lead.signals.emergencyServiceGap !== true &&
    lead.signals.recentActivity !== false
  ) {
    s -= 10;
  }
  return clamp(s);
}

// ── Weighted blend + adjustments ─────────────────────────────────────

function applyAdjustments(
  base: number,
  layers: CloseabilityLayers,
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
  top: Finding | null,
): { score: number; adjustments: string[] } {
  const adjustments: string[] = [];
  let score = base;

  // Easy-win boost: when structural / pain / conversion all read >=75
  // the lead is ready to close on first touch. Boost size scales with
  // how high the floor of those three layers is.
  const tripleFloor = Math.min(layers.structural, layers.pain, layers.conversion);
  if (tripleFloor >= 75) {
    const boost = clamp(Math.round((tripleFloor - 75) * 0.6 + 15), 15, 25);
    score += boost;
    adjustments.push(`Easy-win boost +${boost}`);
  }

  // Friction tax: missing email + missing website together is a
  // discovery slog; no diagnostics findings means we're working from
  // pure heuristic.
  if (!lead.email && !lead.verifiedEmail && !lead.website) {
    score -= 8;
    adjustments.push("Friction tax −8 (no email + no website)");
  }
  if ((diagnostics?.findings.length ?? 0) === 0) {
    score -= 5;
    adjustments.push("Friction tax −5 (no diagnostic findings)");
  }
  if (!lead.crm?.status || lead.crm.status === "NEW") {
    // Unowned cold lead — slightly heavier lift than an in-pipeline one.
    if (!lead.phone) {
      score -= 4;
      adjustments.push("Friction tax −4 (cold + no phone)");
    }
  }

  // Score caps — hard ceilings the layers can't break through.
  if (!lead.phone) {
    if (score > 55) {
      score = 55;
      adjustments.push("Cap @55 (no phone)");
    }
  }
  if (!top) {
    if (score > 65) {
      score = 65;
      adjustments.push("Cap @65 (unclear pain)");
    }
  }
  if (layers.conversion < 50) {
    if (score > 70) {
      score = 70;
      adjustments.push("Cap @70 (weak pitch clarity)");
    }
  }

  return { score: clamp(score), adjustments };
}

function labelFor(score: number): CloseabilityLabel {
  if (score >= 90) return "High-Intent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Moderate";
  return "Weak";
}

function reasonFor(layers: CloseabilityLayers, top: Finding | null): string {
  // The strongest layer drives the headline reason — gives reps a
  // fast read on WHY the score is what it is.
  type LayerKey = "structural" | "pain" | "conversion" | "timing";
  const ranked: Array<[LayerKey, number]> = [
    ["pain", layers.pain],
    ["conversion", layers.conversion],
    ["timing", layers.timing],
    ["structural", layers.structural],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const [name] = ranked[0];
  switch (name) {
    case "pain":
      return top
        ? `${top.issue} is concrete and the value loss is direct.`
        : "Pain story is the strongest layer here — but verify on the call.";
    case "conversion":
      return "Pitch is fast to deliver — rep can land the angle in seconds.";
    case "timing":
      return "Active urgency window — every week of delay is lost jobs.";
    case "structural":
      return "Contact path is clean — discovery time is minimal.";
  }
}

// ── Public entry point ───────────────────────────────────────────────

export function computeCloseability(
  lead: NormalizedLead,
  diagnostics: LeadDiagnostics | undefined,
  top: Finding | null,
): CloseabilityResult {
  const layers: CloseabilityLayers = {
    structural: scoreStructural(lead),
    pain: scorePain(lead, diagnostics, top),
    conversion: scoreConversion(lead, top),
    timing: scoreTiming(lead, top),
  };

  // Weighted blend.
  const base =
    layers.structural * 0.25 +
    layers.pain * 0.35 +
    layers.conversion * 0.25 +
    layers.timing * 0.15;

  const { score, adjustments } = applyAdjustments(base, layers, lead, diagnostics, top);

  return {
    score: Math.round(score),
    label: labelFor(score),
    reason: reasonFor(layers, top),
    layers,
    adjustments,
  };
}
