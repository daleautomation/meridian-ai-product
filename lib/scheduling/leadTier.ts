// Meridian — operator lead tier classifier.
//
// Maps a SchedulableLead onto a 3-tier execution band:
//   • CLOSE_NOW — top ~25%, ready to close, hard urgency
//   • STRONG    — middle ~50%, clear angle, mid urgency
//   • TEST      — bottom ~25%, viable but unproven, ride along
//
// Pure / deterministic. Reads only fields already on the lead — the
// premium scan's closeability + urgency drive tier; decision.score is
// the fallback so leads without a scan still land somewhere sensible.

export type LeadTier = "CLOSE_NOW" | "STRONG" | "TEST";

export const TIER_ORDER: LeadTier[] = ["CLOSE_NOW", "STRONG", "TEST"];

export const TIER_LABEL: Record<LeadTier, string> = {
  CLOSE_NOW: "Close Now",
  STRONG: "Strong",
  TEST: "Test",
};

const URGENCY_RANK: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

const CLOSE_LABEL_RANK: Record<string, number> = {
  "High-Intent": 0,
  Strong: 1,
  Moderate: 2,
  Weak: 3,
};

export type TierableLead = {
  decision?: { score?: number } | null;
  laborTechScan?:
    | {
        closeability?: { score?: number | null; label?: string | null } | null;
        urgency?: { label?: string | null } | null;
      }
    | null;
};

export function classifyLeadTier(lead: TierableLead | null | undefined): LeadTier {
  if (!lead) return "TEST";
  const closeScore = lead.laborTechScan?.closeability?.score ?? null;
  const closeLabel = lead.laborTechScan?.closeability?.label ?? null;
  const urgency = lead.laborTechScan?.urgency?.label ?? null;
  const fallbackScore = lead.decision?.score ?? null;

  // CLOSE_NOW — high-intent close OR strong + urgency, OR raw close >= 75
  // even with mid urgency.
  if (
    closeLabel === "High-Intent" ||
    (closeLabel === "Strong" && (urgency === "Critical" || urgency === "High")) ||
    (typeof closeScore === "number" && closeScore >= 75)
  ) {
    return "CLOSE_NOW";
  }

  // TEST — weak / unproven leads. Filter explicit Weak first, then
  // very low scan + decision floors.
  if (closeLabel === "Weak") return "TEST";
  if (
    typeof closeScore === "number" &&
    closeScore < 45 &&
    (urgency === "Low" || urgency === "Medium" || urgency === null)
  ) {
    return "TEST";
  }
  if (
    closeScore === null &&
    typeof fallbackScore === "number" &&
    fallbackScore < 40
  ) {
    return "TEST";
  }

  // STRONG — everything else. The middle of the curve.
  return "STRONG";
}

// Strict ordering inside a trade group:
//   tier asc → close score desc → urgency asc → close label asc → decision score desc
export function compareForTier(
  a: TierableLead,
  b: TierableLead,
): number {
  const ta = classifyLeadTier(a);
  const tb = classifyLeadTier(b);
  if (ta !== tb) return TIER_ORDER.indexOf(ta) - TIER_ORDER.indexOf(tb);
  const ca = a.laborTechScan?.closeability?.score ?? -1;
  const cb = b.laborTechScan?.closeability?.score ?? -1;
  if (ca !== cb) return cb - ca;
  const ua = URGENCY_RANK[a.laborTechScan?.urgency?.label ?? ""] ?? 99;
  const ub = URGENCY_RANK[b.laborTechScan?.urgency?.label ?? ""] ?? 99;
  if (ua !== ub) return ua - ub;
  const la = CLOSE_LABEL_RANK[a.laborTechScan?.closeability?.label ?? ""] ?? 99;
  const lb = CLOSE_LABEL_RANK[b.laborTechScan?.closeability?.label ?? ""] ?? 99;
  if (la !== lb) return la - lb;
  const sa = a.decision?.score ?? 0;
  const sb = b.decision?.score ?? 0;
  return sb - sa;
}
