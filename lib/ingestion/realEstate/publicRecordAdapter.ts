// Meridian AI — public-record style property → NormalizedRealEstateRecord.
//
// Pure deterministic transform. Computes:
//   - MAO ≈ ARV × 0.70 - rehab cost (standard 70% rule)
//   - Risk tier from riskFlags (regex match on "foundation/structural" → High)
//   - Score from equity ratio × risk multiplier
//   - Label from score thresholds
//
// All math is conservative — the curator can override any field after import
// by hand-editing the normalized JSON. Source-derived fields are reasonable
// defaults, not opinions.

import type { DecisionLabelType } from "@/lib/types";
import type {
  NormalizedRealEstateRecord,
  RawPropertyRecord,
} from "@/lib/ingestion/types";

const MAO_PERCENTAGE = 0.70;

function formatUsd(n: number | undefined): string | undefined {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}K`;
}

function deriveRisk(flags: string[]): string {
  if (flags.length === 0) return "Low";
  const hasMajor = flags.some((f) =>
    /foundation|structural|fire|flood|sinkhole|asbestos|mold/i.test(f)
  );
  if (hasMajor) return "High";
  const hasMinor = flags.some((f) =>
    /roof|hvac|electrical|plumbing|kitchen|bathroom/i.test(f)
  );
  if (hasMinor) return "Medium";
  return "Low-Med";
}

function deriveLabel(score: number): { label: string; labelType: DecisionLabelType } {
  if (score >= 8.5) return { label: "ACT NOW", labelType: "green" };
  if (score >= 7.0) return { label: "STRONG BUY", labelType: "green" };
  if (score >= 5.0) return { label: "MONITOR", labelType: "amber" };
  return { label: "PASS", labelType: "red" };
}

function deriveTag(propertyType: string | undefined, equityRatio: number): string {
  if (equityRatio >= 0.35) return "Equity Play";
  if (propertyType && /multi|duplex|triplex/i.test(propertyType)) return "Rental";
  if (equityRatio >= 0.20) return "Flip";
  return "BRRRR";
}

function deriveNextAction(score: number, ask: number, mao: number): string {
  const gap = mao - ask;
  if (score >= 8.5 && gap > 0) {
    return `Submit LOI at $${ask.toLocaleString("en-US")} — $${gap.toLocaleString("en-US")} under MAO. Move within 48 hours.`;
  }
  if (score >= 7.0) {
    return `Engage seller. Math works; verify comps before LOI.`;
  }
  if (score >= 5.0) {
    return `Wait — re-engage at 30 days on market or after price drop.`;
  }
  return `No action — math doesn't work at current ask.`;
}

export function normalizePropertyRecord(
  raw: RawPropertyRecord
): NormalizedRealEstateRecord | null {
  const arv = raw.arvEstimate ?? raw.estimatedValue ?? 0;
  const ask = raw.listPrice ?? 0;
  const rehab = raw.estimatedRehabCost ?? 0;
  if (arv <= 0 || ask <= 0) return null;

  const mao = Math.max(0, Math.round(arv * MAO_PERCENTAGE - rehab));
  const equity = arv - ask;
  const equityRatio = arv > 0 ? equity / arv : 0;

  // Score: 0–10 from equity ratio, penalized by risk.
  // Calibrated against existing curated scores: 40% equity / Low risk ≈ 8.8.
  const flags = raw.riskFlags ?? [];
  const risk = deriveRisk(flags);
  const baseScore = Math.min(equityRatio * 22, 10);
  const riskMult =
    risk === "High" ? 0.4 : risk === "Medium" ? 0.7 : risk === "Low-Med" ? 0.85 : 1.0;
  const score = Math.max(0, Math.round(baseScore * riskMult * 10) / 10);

  const { label, labelType } = deriveLabel(score);
  const tag = deriveTag(raw.propertyType, equityRatio);
  const nextAction = deriveNextAction(score, ask, mao);

  const id = raw.parcelId || raw.mlsId || `re-${raw.address.zip}-${raw.address.street.replace(/\s+/g, "-")}`;

  return {
    id,
    zip: raw.address.zip,
    title: raw.address.street,
    sub: `${raw.address.city}, ${raw.address.state} ${raw.address.zip}`,
    score,
    label,
    labelType,
    tag,
    arv: formatUsd(arv),
    mao: formatUsd(mao),
    ask: formatUsd(ask),
    risk,
    nextAction,
    riskFactors: flags.slice(0, 4),
  };
}

export function normalizePropertyRecords(
  raws: RawPropertyRecord[]
): NormalizedRealEstateRecord[] {
  return raws
    .map(normalizePropertyRecord)
    .filter((r): r is NormalizedRealEstateRecord => r !== null);
}
