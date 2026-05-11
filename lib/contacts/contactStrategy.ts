// Meridian — Contact Strategy + Hunter eligibility guard.
//
// Pure / client-safe. Decides the best outreach channel for a lead and
// gates Hunter lookups so cost-protection happens BEFORE the API call.
//
// Hunter is never auto-fired. This module only answers two questions:
//   1. evaluateHunterEligibility(lead) — should we even let the user
//      click Find Email? (returns a status enum + reason)
//   2. getContactStrategy(lead) — for display: "Phone First" /
//      "Phone + Email" / "Email Follow-Up" / "Research Needed".
//
// Plus a tiny session cache so the same lead/domain doesn't trigger
// repeated wasted lookups inside one tab.

import { getDialablePhone } from "../leads/phone";

// ── Public types ─────────────────────────────────────────────────────

export type HunterLookupStatus =
  | "eligible"
  | "not_eligible"
  | "already_verified"
  | "recently_attempted"
  | "no_domain"
  | "failed";

export type HunterEligibility = {
  status: HunterLookupStatus;
  reason: string;
};

export type ContactStrategy = {
  primaryMethod: "Phone First" | "Phone + Email" | "Email Follow-Up" | "Research Needed";
  reason: string;
  hunterEligible: boolean;
};

// Loose lead shape — accepts NormalizedLead, decision-engine leads,
// and overlaid leads. Read-only access; never mutates.
type LeadLike = {
  id?: string | null;
  key?: string | null;
  website?: string | null;
  domain?: string | null;
  resolvedBusinessUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  verifiedEmail?: string | null;
  emailSource?: string | null;
  emailConfidence?: string | null;
  moduleId?: string | null;
  trade?: string | null;
  tradeId?: string | null;
  contactPaths?: Array<{
    method?: string | null;
    value?: string | null;
    source?: string | null;
    verified?: boolean | null;
    confidence?: string | null;
    rank?: number | null;
    checkedAt?: string | null;
  }> | null;
  contacts?: { primaryPhone?: string | null; primaryEmail?: string | null; contactName?: string | null } | null;
  signals?: {
    reviewCount?: number | null;
    rating?: number | null;
    recentActivity?: boolean | null;
    hasWebsite?: boolean | null;
  } | null;
  laborTechScan?: { qualified?: boolean | null } | null;
};

// Trade-aware contact reasoning. Owner-operated trades (HVAC,
// plumbing, electrical, small roofing crews) almost always answer
// the phone themselves — phone wins. Visual trades (painting,
// carpentry, remodeling) often have an admin filter and email
// land-rate is comparable.
function readTrade(lead: LeadLike): string {
  return (lead.moduleId || lead.trade || lead.tradeId || "").toString().toLowerCase();
}

function isOwnerOperatedTrade(trade: string): boolean {
  return trade === "hvac" || trade === "plumbing" || trade === "electrical" || trade === "roofing";
}

function businessSizeHint(lead: LeadLike): "small" | "established" | "large" {
  const rc = lead.signals?.reviewCount;
  if (typeof rc === "number" && rc >= 100) return "large";
  if (typeof rc === "number" && rc >= 30) return "established";
  return "small";
}

// ── Domain normalization ─────────────────────────────────────────────

/**
 * Pull a clean domain out of a lead. Returns null when the lead has
 * no usable identifier (no website, no domain, only a placeholder).
 *
 * Example:
 *   { website: "https://www.xyzroofingkc.com/contact" }
 *   → "xyzroofingkc.com"
 */
export function normalizeLeadDomain(lead: LeadLike | null | undefined): string | null {
  if (!lead) return null;
  const candidates = [lead.domain, lead.website, lead.resolvedBusinessUrl];
  for (const raw of candidates) {
    const cleaned = cleanDomainString(raw);
    if (cleaned) return cleaned;
  }
  return null;
}

function cleanDomainString(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let d = raw.trim().toLowerCase();
  if (d.length === 0) return null;
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];          // strip path
  d = d.split("?")[0];          // strip query
  d = d.split("#")[0];          // strip fragment
  d = d.split(":")[0];          // strip port
  d = d.trim();
  if (d.length === 0 || d.includes(" ")) return null;
  // Reject obvious placeholders + non-TLD strings.
  if (/^(example|localhost|iana|w3)\.(org|com|net)$/.test(d)) return null;
  if (!/\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

// ── Session-scoped attempt cache ─────────────────────────────────────
//
// Tracks domains the user has already clicked Find Email on during
// this page-lifetime. Pure client-side, lives in module scope, never
// persists. Keeps repeated clicks from re-billing Hunter for a domain
// we already know returns nothing.

type AttemptOutcome = "in_flight" | "success" | "failed";
const sessionAttempts = new Map<string, AttemptOutcome>();

/** Mark a domain as attempted this session. Called from LeadEmailAction. */
export function markHunterAttempt(domain: string | null, outcome: AttemptOutcome): void {
  if (!domain) return;
  sessionAttempts.set(domain, outcome);
}

/** Read the session attempt outcome for a domain. */
export function getHunterAttempt(domain: string | null): AttemptOutcome | null {
  if (!domain) return null;
  return sessionAttempts.get(domain) ?? null;
}

/** Test-only: clears the session cache. */
export function _clearHunterSessionCache(): void {
  sessionAttempts.clear();
}

// ── Eligibility evaluator ────────────────────────────────────────────

/**
 * Decide whether Hunter should be allowed to run for this lead.
 *
 * Order of checks (first match wins):
 *   1. already_verified  — lead.verifiedEmail already exists, no need.
 *   2. recently_attempted — domain was hit this session.
 *   3. no_domain         — can't extract a usable domain.
 *   4. not_eligible      — laborTechScan flagged not-ready, OR no
 *                          quality signals (review/rating/activity/site).
 *   5. eligible          — passes all gates.
 *
 * Pure. Safe to call from render (no I/O, no mutation).
 */
export function evaluateHunterEligibility(lead: LeadLike | null | undefined): HunterEligibility {
  if (!lead) {
    return { status: "no_domain", reason: "No lead context — nothing to look up." };
  }

  // 1. Already have a verified email — skip.
  if (typeof lead.verifiedEmail === "string" && lead.verifiedEmail.length > 0) {
    return { status: "already_verified", reason: "Verified email already on file." };
  }

  // 2. Recently attempted in this session.
  const domain = normalizeLeadDomain(lead);
  const attempt = getHunterAttempt(domain);
  if (attempt === "failed") {
    return { status: "recently_attempted", reason: "Already searched this domain this session — no result." };
  }
  if (attempt === "in_flight") {
    return { status: "recently_attempted", reason: "Search already in progress for this domain." };
  }

  // 3. No usable domain.
  if (!domain) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[hunter-guard] Hunter skipped: no domain");
    }
    return { status: "no_domain", reason: "No website or domain on this lead — Hunter needs a domain to search." };
  }

  // 4. Quality gates.
  // Hard block: scan explicitly marked the lead as not ready.
  if (lead.laborTechScan?.qualified === false) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[hunter-guard] Hunter skipped: not eligible (lower priority)");
    }
    return {
      status: "not_eligible",
      reason: "Lead marked lower priority — strengthen signals before email outreach.",
    };
  }

  // Soft eligibility: at least one signal of being established.
  const reviewCount = lead.signals?.reviewCount;
  const rating = lead.signals?.rating;
  const recentActivity = lead.signals?.recentActivity === true;
  const hasWebsiteSignal = lead.signals?.hasWebsite === true || !!lead.website;

  const hasQualitySignal =
    (typeof reviewCount === "number" && reviewCount >= 15)
    || (typeof rating === "number" && rating >= 4.0)
    || recentActivity
    || hasWebsiteSignal;

  if (!hasQualitySignal) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[hunter-guard] Hunter skipped: not eligible (weak online footprint)");
    }
    return {
      status: "not_eligible",
      reason: "Weak online footprint — email lookup not recommended yet.",
    };
  }

  return { status: "eligible", reason: "Eligible for Hunter lookup." };
}

// ── Contact Strategy ────────────────────────────────────────────────

/**
 * Decide the best outreach channel for a lead based on what contact
 * data we have. Display-only — never triggers a call.
 */
export function getContactStrategy(lead: LeadLike | null | undefined): ContactStrategy {
  if (!lead) {
    return {
      primaryMethod: "Research Needed",
      reason: "No lead context — research before outreach.",
      hunterEligible: false,
    };
  }

  const phone = getDialablePhone(lead);
  const verifiedEmail = lead.verifiedEmail || null;
  const plainEmail = lead.email || lead.contacts?.primaryEmail || null;

  const hasPhone = typeof phone === "string" && phone.length > 0;
  const hasVerifiedEmail = typeof verifiedEmail === "string" && verifiedEmail.length > 0;
  const hasAnyEmail = hasVerifiedEmail || (typeof plainEmail === "string" && plainEmail.length > 0);

  const eligibility = evaluateHunterEligibility(lead);
  const hunterEligible = eligibility.status === "eligible";

  const trade = readTrade(lead);
  const ownerOperated = isOwnerOperatedTrade(trade);
  const size = businessSizeHint(lead);
  const tradeLabel =
    trade === "hvac" ? "HVAC"
    : trade === "plumbing" ? "plumbing"
    : trade === "electrical" ? "electrical"
    : trade === "roofing" ? "roofing"
    : trade === "carpentry" ? "carpentry"
    : trade === "painting" ? "painting"
    : trade === "remodeling" ? "remodeling"
    : "this trade";

  if (hasPhone && hasVerifiedEmail) {
    const reason = ownerOperated
      ? `Call first — ${tradeLabel} is owner-operated, phone lands fastest. Verified email is your follow-up path.`
      : `Call first, then send a verified follow-up email — both channels are live.`;
    return { primaryMethod: "Phone + Email", reason, hunterEligible: false };
  }
  if (hasPhone && hasAnyEmail) {
    const reason = ownerOperated
      ? `Call first — ${tradeLabel} owners pick up live. Email backs it up if voicemail.`
      : `Call first; send the email as a follow-up if no answer.`;
    return { primaryMethod: "Phone + Email", reason, hunterEligible };
  }
  if (hasPhone && !hasAnyEmail) {
    const phoneReason =
      ownerOperated
        ? `Call first — ${tradeLabel} is typically owner-operated, fastest response channel.`
        : size === "large"
          ? `Call first — large operator, ask for the decision-maker by name.`
          : `Call first — phone is the strongest channel for ${tradeLabel} at this size.`;
    const reason = hunterEligible
      ? `${phoneReason} Find Email available to add a follow-up path.`
      : phoneReason;
    return { primaryMethod: "Phone First", reason, hunterEligible };
  }
  if (!hasPhone && hasAnyEmail) {
    return {
      primaryMethod: "Email Follow-Up",
      reason: ownerOperated
        ? `No phone yet — open with email and ask for the best line back. Owner-operated, you'll get a direct reply.`
        : `Email is the only channel today — keep it short, lead with the gap, and ask for a call.`,
      hunterEligible: false,
    };
  }
  // Neither phone nor email.
  if (hunterEligible) {
    return {
      primaryMethod: "Research Needed",
      reason: `No phone or email yet — try Find Email; ${tradeLabel} businesses at this size usually have a contact form too.`,
      hunterEligible: true,
    };
  }
  return {
    primaryMethod: "Research Needed",
    reason: eligibility.reason,
    hunterEligible: false,
  };
}
