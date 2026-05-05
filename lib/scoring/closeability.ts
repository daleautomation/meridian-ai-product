// INTERNAL ENGINE INPUT — do not consume from the UI.
// User-facing surfaces must read lib/scoring/decision.ts (LeadDecision).
// decision.ts wraps the axes computed here into the final bucket.
//
// Meridian — closeability rerank layer.
//
// Re-buckets an already-computed CompanyDecision using a stricter
// four-axis rule set: INTENT, LEAK, REACH, TIMING. Pure function, no IO.
//
// The upstream decision engine (companyDecision.ts) is preserved
// untouched — this layer sits on top of its output and rewrites
// `bucket` / `recommendedAction` based on observable buyer-readiness
// signals only. No new data sources, no fabricated values.
//
// Called from app/operator/page.tsx after rank_companies returns.

import type { CompanyDecision } from "@/lib/scoring/companyDecision";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";

export type IntentLevel = "Strong" | "Weak" | "Unknown";
export type LeakLevel = "High" | "Medium" | "Low" | "None";
export type ReachLevel = "Verified" | "Weak" | "Missing";
export type CloseabilityBucket = "CALL NOW" | "TODAY" | "MONITOR" | "PASS";

export type CloseabilityAxis<L extends string> = {
  level: L;
  points: number;
  reason: string;
};

export type Closeability = {
  bucket: CloseabilityBucket;
  score: number; // 0–100
  intent: CloseabilityAxis<IntentLevel>;
  leak: CloseabilityAxis<LeakLevel>;
  reach: CloseabilityAxis<ReachLevel>;
  timing: CloseabilityAxis<"Now" | "Soon" | "None">;
  bucketReason: string;
  disqualificationReason?: string;
};

// Reserved in North America — seed file uses 555 exchanges as placeholders.
// A real business phone will never match this.
const PLACEHOLDER_PHONE_RE = /^\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?555[-.\s]?\d{4}$/;
function isPlaceholderPhone(p?: string | null): boolean {
  if (!p) return false;
  return PLACEHOLDER_PHONE_RE.test(p.replace(/\s+/g, ""));
}

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

// Blocking CRM states that should never land in CALL NOW even if
// everything else aligns. "ARCHIVED" / closed leads are already pre-
// filtered upstream; this is a defensive re-check.
const BLOCKING_STATUSES = new Set([
  "CLOSED_WON",
  "CLOSED_LOST",
  "NOT_QUALIFIED",
  "ARCHIVED",
  "DO_NOT_CONTACT",
]);

// ──────────────────────────────────────────────────────────────────────────
// INTENT — is this company demonstrably active / growth-oriented?
//
// Only observable proxies until real ad-presence and review-velocity
// signals land. Review count+rating is the strongest active-business
// proxy currently in the snapshot.
// ──────────────────────────────────────────────────────────────────────────
function scoreIntent(
  d: CompanyDecision,
  snap: CompanySnapshot | undefined,
): CloseabilityAxis<IntentLevel> {
  const cr = snap?.contactResolution;
  const reviewCount = cr?.reviewCount ?? 0;
  const rating = cr?.rating ?? 0;
  const hasForceAction = !!d.forceAction;

  if (reviewCount >= 20 && rating >= 4.2) {
    return {
      level: "Strong",
      points: 22,
      reason: `${reviewCount} reviews at ${rating.toFixed(1)}★ — active book of business.`,
    };
  }
  if (reviewCount >= 10 && rating >= 4.0) {
    return {
      level: "Strong",
      points: 14,
      reason: `${reviewCount} reviews at ${rating.toFixed(1)}★ — steady operator.`,
    };
  }
  if (reviewCount >= 5) {
    return {
      level: "Weak",
      points: 7,
      reason: `${reviewCount} reviews on record — some customer activity.`,
    };
  }
  if (hasForceAction) {
    return {
      level: "Weak",
      points: 5,
      reason: "Scheduled follow-up is due — prior work on this lead.",
    };
  }
  return {
    level: "Unknown",
    points: 0,
    reason: "No observable intent signal yet (no review activity, no scheduled action).",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// LEAK — is there a real, pitchable revenue leak?
//
// Weighted toward conversion-path failures (down, no mobile, no contact
// path, thin). Minor SEO (missing meta / OG) scores Low — never enough
// alone for CALL NOW.
// ──────────────────────────────────────────────────────────────────────────
function scoreLeak(d: CompanyDecision): CloseabilityAxis<LeakLevel> {
  const wp = d.websiteProof;
  const cls = wp?.site_classification;
  const weak = (d.topWeaknesses ?? []).join(" ").toLowerCase();

  const siteDown =
    wp?.homepage_fetch_ok === false ||
    cls === "site_unreachable" ||
    cls === "site_blank" ||
    /unreachable|offline|parked|coming soon|domain for sale/.test(weak);
  if (siteDown) {
    const label =
      cls === "site_blank"
        ? "Site blank — homepage returns no usable content."
        : /parked|coming soon|domain for sale/.test(weak)
        ? "Parked domain — homepage serves no business content."
        : "Site unreachable — homepage fails to load.";
    return { level: "High", points: 24, reason: label };
  }

  const noMobile = /viewport|mobile/.test(weak);
  const hasForm = wp?.has_contact_form === true;
  const sitePhone = wp?.phone_from_site;
  const contentLen = wp?.content_length ?? 0;

  // No conversion path on site: no form AND no visible phone.
  if (!hasForm && !sitePhone && wp) {
    return {
      level: "High",
      points: 18,
      reason: "No working contact path on site — no form and no visible phone.",
    };
  }

  if (noMobile) {
    return {
      level: "High",
      points: 16,
      reason: "No mobile viewport — ~60% of roofing searchers cannot render the page.",
    };
  }

  if (contentLen > 0 && contentLen < 2000) {
    return {
      level: "Medium",
      points: 10,
      reason: "Thin site — under 2KB of content. Google has little to rank.",
    };
  }

  if (
    typeof wp?.page_speed_mobile === "number" &&
    wp.page_speed_mobile !== null &&
    wp.page_speed_mobile < 40
  ) {
    return {
      level: "Medium",
      points: 8,
      reason: "Slow mobile page speed — conversion loss on ad clicks.",
    };
  }

  // Everything else = minor/cosmetic; not pitchable on its own.
  if ((d.topWeaknesses?.length ?? 0) > 0) {
    return {
      level: "Low",
      points: 3,
      reason: "Only minor/cosmetic issues — not a pitchable revenue leak on its own.",
    };
  }

  return {
    level: "None",
    points: 0,
    reason: "No detectable site issue.",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// REACH — can we get a decision-maker on the phone?
//
// The only "Verified" level currently available is a Google Places /
// Yelp / BBB provider match with a real phone number. A 555 placeholder
// or seed-only number is a hard "Missing" — cannot be CALL NOW.
// ──────────────────────────────────────────────────────────────────────────
function scoreReach(
  d: CompanyDecision,
  snap: CompanySnapshot | undefined,
): CloseabilityAxis<ReachLevel> {
  const primaryPhone = d.contacts?.primaryPhone;
  const source = (d.contacts?.source ?? "").toLowerCase();
  const phoneConf = (d.contacts?.phoneConfidence ?? d.contacts?.confidence ?? "").toLowerCase();
  const seedPhone = snap?.contactPhone;

  if (primaryPhone && isPlaceholderPhone(primaryPhone)) {
    return {
      level: "Missing",
      points: 0,
      reason: "Phone on file is a 555 placeholder — not a real business line.",
    };
  }

  // Only a seed 555 number is "known" — treat as Missing, never Weak.
  if (!primaryPhone && seedPhone && isPlaceholderPhone(seedPhone)) {
    return {
      level: "Missing",
      points: 0,
      reason: "Only a 555 placeholder phone on the seed record.",
    };
  }

  if (!primaryPhone) {
    return {
      level: "Missing",
      points: 0,
      reason: "No phone on file for this lead.",
    };
  }

  // "operator" on decision.contacts means the phone was curated into
  // snap.contactPhone / preferredPhone — the highest-quality source
  // because a human or the resolver wrote it deliberately. Provider
  // strings (google_places, yelp, bbb, gbp) are also Verified.
  const VERIFIED_SOURCES = new Set([
    "operator",
    "gbp",
    "google_places",
    "yelp",
    "bbb",
  ]);
  const verifiedSource = VERIFIED_SOURCES.has(source);
  const readableSource =
    source === "gbp" || source === "google_places"
      ? "Google Business Profile"
      : source === "operator"
      ? "curated record"
      : source;

  if (verifiedSource && phoneConf === "high") {
    return {
      level: "Verified",
      points: 22,
      reason: `Phone verified via ${readableSource}.`,
    };
  }
  if (verifiedSource) {
    return {
      level: "Verified",
      points: 18,
      reason: `Phone sourced from ${readableSource}.`,
    };
  }

  return {
    level: "Weak",
    points: 8,
    reason: "Phone on file but not provider-verified.",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// TIMING — is there a specific reason this call is today?
// ──────────────────────────────────────────────────────────────────────────
function scoreTiming(
  d: CompanyDecision,
  snap: CompanySnapshot | undefined,
): CloseabilityAxis<"Now" | "Soon" | "None"> {
  if (d.forceAction) {
    return {
      level: "Now",
      points: 18,
      reason: `Scheduled action is due (${d.forceAction.toLowerCase()}).`,
    };
  }

  const lastActionAt = snap?.lastAction?.performedAt;
  const daysSinceLast = daysSince(lastActionAt);
  if (daysSinceLast !== null && daysSinceLast >= 14 && d.score >= 55) {
    return {
      level: "Soon",
      points: 8,
      reason: `No touch in ${daysSinceLast} days — cooldown cleared.`,
    };
  }

  return {
    level: "None",
    points: 0,
    reason: "No specific time trigger — generic backlog.",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry.
// ──────────────────────────────────────────────────────────────────────────
export function computeCloseability(
  d: CompanyDecision,
  snap?: CompanySnapshot,
): Closeability {
  const intent = scoreIntent(d, snap);
  const leak = scoreLeak(d);
  const reach = scoreReach(d, snap);
  const timing = scoreTiming(d, snap);
  const score = intent.points + leak.points + reach.points + timing.points;

  // ── Hard disqualifiers → PASS ──
  const status = (snap?.status ?? d.accountSnapshot?.status ?? "").toUpperCase();
  if (status && BLOCKING_STATUSES.has(status)) {
    return {
      bucket: "PASS",
      score,
      intent,
      leak,
      reach,
      timing,
      bucketReason: `PASS: lead is in ${status}.`,
      disqualificationReason: `CRM status is ${status}.`,
    };
  }
  if (reach.level === "Missing" && intent.level === "Unknown" && leak.level !== "High") {
    return {
      bucket: "PASS",
      score,
      intent,
      leak,
      reach,
      timing,
      bucketReason: "PASS: no reachable contact and no intent signal.",
      disqualificationReason: reach.reason,
    };
  }
  if ((d.escalationStage ?? 0) >= 3) {
    return {
      bucket: "PASS",
      score,
      intent,
      leak,
      reach,
      timing,
      bucketReason: "PASS: escalation stage 3+ (prior attempts exhausted).",
      disqualificationReason: "Escalation stage exceeded.",
    };
  }

  // ── Cooldown block: recent attempt should not be CALL NOW ──
  const recentAttempt =
    (d.callAttempts ?? 0) >= 2 && (d.consecutiveNoAnswers ?? 0) >= 1;

  // ── CALL NOW: all four axes must contribute meaningfully ──
  const qualifiesForCallNow =
    intent.points >= 12 &&
    leak.points >= 15 &&
    reach.points >= 18 &&
    score >= 55 &&
    !recentAttempt;

  if (qualifiesForCallNow) {
    return {
      bucket: "CALL NOW",
      score,
      intent,
      leak,
      reach,
      timing,
      bucketReason: `CALL NOW: ${intent.level.toLowerCase()} intent, ${leak.level.toLowerCase()} leak, ${reach.level.toLowerCase()} reach.`,
    };
  }

  // ── TODAY: real leak + reachable, but intent weak/unknown ──
  if (leak.points >= 15 && reach.points >= 12 && score >= 35) {
    return {
      bucket: "TODAY",
      score,
      intent,
      leak,
      reach,
      timing,
      bucketReason: `TODAY: ${leak.level.toLowerCase()} leak with ${reach.level.toLowerCase()} contact — worth a sales review, intent unconfirmed.`,
    };
  }

  // ── MONITOR: some useful signal but not enough for sales action ──
  if (score >= 18 || leak.points > 0 || intent.points > 0) {
    return {
      bucket: "MONITOR",
      score,
      intent,
      leak,
      reach,
      timing,
      bucketReason: "MONITOR: partial signal — revisit after enrichment or timing trigger.",
    };
  }

  // ── Default: PASS ──
  return {
    bucket: "PASS",
    score,
    intent,
    leak,
    reach,
    timing,
    bucketReason: "PASS: no actionable signal across intent, leak, or reach.",
    disqualificationReason: "Insufficient data to justify a call.",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Batch helper: apply closeability to a ranked list, returning an
// augmented array (decision + closeability) plus bucket-split groups.
// ──────────────────────────────────────────────────────────────────────────
export type RerankedLead = CompanyDecision & { closeability: Closeability };

export type RerankResult = {
  all: RerankedLead[];
  callNow: RerankedLead[];
  today: RerankedLead[];
  monitor: RerankedLead[];
  pass: RerankedLead[];
};

export function rerankByCloseability(
  ranked: CompanyDecision[],
  snapshotsByKey: Map<string, CompanySnapshot>,
): RerankResult {
  const all: RerankedLead[] = ranked.map((d) => {
    const snap = snapshotsByKey.get(d.key);
    const closeability = computeCloseability(d, snap);
    return Object.assign({}, d, { closeability });
  });

  // Order within each bucket by closeability.score desc, with CALL NOW
  // leads that have "Now" timing first.
  const by = (b: CloseabilityBucket) =>
    all
      .filter((l) => l.closeability.bucket === b)
      .sort((a, z) => {
        if (a.closeability.timing.level !== z.closeability.timing.level) {
          const order = { Now: 0, Soon: 1, None: 2 } as const;
          return order[a.closeability.timing.level] - order[z.closeability.timing.level];
        }
        return z.closeability.score - a.closeability.score;
      });

  return {
    all,
    callNow: by("CALL NOW"),
    today: by("TODAY"),
    monitor: by("MONITOR"),
    pass: by("PASS"),
  };
}
