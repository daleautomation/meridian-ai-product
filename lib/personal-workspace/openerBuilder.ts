// Meridian — deterministic opener builder.
//
// Replaces the generic "Reference your last interaction and one clear
// next step" template with a specific, operator-grade line composed
// from material the CRM actually carries: notes, tags, last-touch age,
// source label.
//
// Strict rules:
//   • Pure function. No randomness. No `Date.now()` — `now` is injected.
//   • No AI generation. No LLM call. Pattern match only.
//   • Never fabricate. Every opener cites the exact CRM fragment that
//     justified it in `supportingEvidence`.
//   • No salesy or AI-flavored language. Banned phrases: "perfect time",
//     "great opportunity", "leverage", "engage", "personalize".
//   • Honest fallbacks. When notes/tags/touch are empty, the fallback
//     SAYS so rather than fake personalization.

import type { CrmContactRecord } from "@/lib/crm-import/types";

// ── Public types ───────────────────────────────────────────────────

export type OpenerTrust = "HIGH" | "MED" | "WEAK";

export type OpenerSource =
  // notes-derived (HIGH)
  | "notes:renovation"
  | "notes:contractor"
  | "notes:investment_property"
  | "notes:growing_family"
  | "notes:relocation"
  | "notes:downsizing"
  | "notes:refinance"
  | "notes:school_district"
  | "notes:timing_signal"
  | "notes:plain_quote"
  // tag-derived (MED–HIGH)
  | "tag:past_buyer"
  | "tag:past_seller"
  | "tag:repeat_client"
  | "tag:referral_source"
  | "tag:investor"
  | "tag:farm"
  | "tag:sphere"
  | "tag:first_time_buyer"
  // history-derived (MED)
  | "last_close:date"
  // verified external enrichment (MED) — only fires when provenance,
  // confidence ≥ 75, and at least company or role are present.
  | "enrichment:hunter_role"
  // public-record-backed opportunity priority (MED) — only fires when
  // tier is HIGH or MED AND parcel grounding exists.
  | "enrichment:opportunity_priority"
  // stale-only (WEAK)
  | "stale_relationship:months"
  | "stale_relationship:years"
  // honest fallback (WEAK)
  | "fallback:tag_only"
  | "fallback:no_context";

export interface SuggestedOpener {
  /** Operator-facing next-step line. Short, calm, never salesy. */
  opener: string;
  openerSource: OpenerSource;
  /** Verbatim CRM fragment that justified the opener (≤ 80 chars). */
  supportingEvidence: string;
  trustLevel: OpenerTrust;
  /** False when the opener is one of the two honest fallbacks. */
  isSpecific: boolean;
}

export interface OpenerInput {
  name: string;
  notes: string | null;
  tags: readonly string[];
  lastInteractionAt: string | null;
  sourceCrm: string | null;
  /** Optional external enrichment captured via a verified provider.
   *  The extractor only uses this when status === "found", confidence
   *  ≥ HUNTER_OPENER_CONFIDENCE_FLOOR, and either company or role is set. */
  hunter?: {
    status: "found" | "not_found" | "skipped" | "error";
    confidence: number | null;
    company?: string;
    role?: string;
    fetchedAt: string;
  } | null;
  /**
   * Public-record-backed opportunity signal (Commit C). The extractor
   * only fires when:
   *   • priorityTier is HIGH or MED (never WEAK / REVIEW)
   *   • a parcel + ownership snapshot grounded the score
   *     (publicRecordSource present)
   *   • a higher-trust opener (notes, Hunter) did NOT fire upstream
   *
   * Carries only the fields the opener uses. The full signal lives on
   * the contact's enrichment.opportunity for audit + downstream UI.
   */
  opportunity?: {
    priorityTier: "HIGH" | "MED" | "WEAK" | "REVIEW";
    transparentPriorityScore: number;
    matchedPropertyAddress: string | null;
    ownerName: string | null;
    ownershipDurationYears: number | null;
    publicRecordSource: string | null;
    fetchedAt: string;
    /** Names of factors with applied: true, sorted by weight desc. */
    topAppliedFactorNames: readonly string[];
  } | null;
}

/** Minimum Hunter score that allows an opener to cite Hunter data.
 *  Anything below this is stored but never surfaced to the operator. */
export const HUNTER_OPENER_CONFIDENCE_FLOOR = 75;

export interface OpenerOptions {
  now?: Date;
}

// ── Helpers ────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function firstName(fullName: string): string {
  return (fullName.trim().split(/\s+/)[0] ?? fullName).trim();
}

function monthsBetween(thenIso: string | null, now: Date): number | null {
  if (!thenIso) return null;
  const t = Date.parse(thenIso);
  if (!Number.isFinite(t)) return null;
  const days = (now.getTime() - t) / MS_PER_DAY;
  if (!Number.isFinite(days) || days < 0) return null;
  return Math.floor(days / 30);
}

function yearOf(thenIso: string | null): number | null {
  if (!thenIso) return null;
  const t = Date.parse(thenIso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).getUTCFullYear();
}

function windowAround(text: string, index: number, span: number): string {
  const start = Math.max(0, index - 16);
  const end = Math.min(text.length, index + span);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function clipEvidence(text: string, limit = 80): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return `${collapsed.slice(0, limit - 1)}…`;
}

function normalizeTag(tag: string): string {
  return tag.toLowerCase().trim().replace(/[\s_-]+/g, "_");
}

function hasTag(tags: readonly string[], patterns: readonly RegExp[]): string | null {
  for (const raw of tags) {
    const norm = normalizeTag(raw);
    for (const p of patterns) {
      if (p.test(norm)) return raw;
    }
  }
  return null;
}

// ── Note extractors (HIGH trust when a topical phrase is matched) ──

interface NoteMatch {
  source: OpenerSource;
  match: RegExpExecArray;
  opener: string;
  trustLevel: OpenerTrust;
}

function quoteWindow(notes: string, idx: number): string {
  return clipEvidence(`"${windowAround(notes, idx, 80)}"`);
}

function extractRenovation(notes: string, name: string): NoteMatch | null {
  // Topic-specific renovations first — they produce a more specific opener.
  const topicRe = /\b(kitchen|bathroom|basement|attic|garage|primary suite|master bath)\s+(?:reno(?:vation)?|remodel(?:ing|led)?|refresh|build[-\s]?out|upgrade|gut)/i;
  const broadRe = /\b(?:reno(?:vation)?|remodel(?:ing|led)?|gut(?:ted|ting)?|tear[-\s]?down)\b/i;
  const topic = topicRe.exec(notes);
  if (topic) {
    const phrase = topic[0].toLowerCase();
    return {
      source: "notes:renovation",
      match: topic,
      opener: `Your notes mention a ${phrase} — worth a calm check on whether it wrapped up.`,
      trustLevel: "HIGH",
    };
  }
  const broad = broadRe.exec(notes);
  if (broad) {
    return {
      source: "notes:renovation",
      match: broad,
      opener: `Your notes mention a renovation for ${firstName(name)} — worth a quick check on how it landed.`,
      trustLevel: "HIGH",
    };
  }
  return null;
}

function extractContractor(notes: string): NoteMatch | null {
  const re = /\b(?:contractor|general contractor|GC|sub[-\s]?contractor|builder|crew|tradesperson|tradespeople)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  return {
    source: "notes:contractor",
    match: m,
    opener: `Your notes reference a contractor — easy reason to check whether the project finished cleanly.`,
    trustLevel: "HIGH",
  };
}

function extractInvestmentProperty(notes: string): NoteMatch | null {
  const re = /\b(?:invest(?:or|ment)|rental|cap rate|cash[-\s]?flow|portfolio|landlord|tenant|duplex|triplex|fourplex|multi[-\s]?family|short[-\s]?term rental|STR|Airbnb|VRBO)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  const focus = m[0].toLowerCase();
  return {
    source: "notes:investment_property",
    match: m,
    opener: `Notes reference ${focus} interest — calm market temperature check is appropriate.`,
    trustLevel: "HIGH",
  };
}

function extractGrowingFamily(notes: string): NoteMatch | null {
  const re = /\b(?:baby|pregnant|expecting|newborn|toddler|growing family|second child|third child|kids in school|new addition|nursery)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  return {
    source: "notes:growing_family",
    match: m,
    opener: `Notes mention a growing family — light timeline check fits, no agenda needed.`,
    trustLevel: "HIGH",
  };
}

function extractRelocation(notes: string, name: string): NoteMatch | null {
  const re = /\b(?:reloc(?:ate|ation|ating)?|moving (?:to|out|cross)|out of state|new job (?:in|at)|transfer(?:ring)? to|deployment|PCS|moving back)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  return {
    source: "notes:relocation",
    match: m,
    opener: `Notes mention relocation for ${firstName(name)} — calm timeline check is appropriate.`,
    trustLevel: "HIGH",
  };
}

function extractDownsizing(notes: string): NoteMatch | null {
  const re = /\b(?:downsiz(?:e|ing)|empty[-\s]?nest(?:er)?|smaller (?:home|place)|55\+|moving down|aging in place|retirement (?:home|move))\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  return {
    source: "notes:downsizing",
    match: m,
    opener: `Notes mention downsizing — soft check on whether the timing has shifted.`,
    trustLevel: "HIGH",
  };
}

function extractRefinance(notes: string): NoteMatch | null {
  const re = /\b(?:refi(?:nance|nanced)?|rate[-\s]?lock|cash[-\s]?out|HELOC|pay[-\s]?down|recast)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  return {
    source: "notes:refinance",
    match: m,
    opener: `Notes reference a refi conversation — natural moment for a market check.`,
    trustLevel: "HIGH",
  };
}

function extractSchoolDistrict(notes: string): NoteMatch | null {
  const re = /\b(?:school district|school zone|elementary|middle school|high school|district transfer|Blue Valley|Shawnee Mission|North Kansas City SD)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  return {
    source: "notes:school_district",
    match: m,
    opener: `Notes mention school-district context — fits a soft check before the next school year.`,
    trustLevel: "HIGH",
  };
}

function extractTimingSignal(notes: string): NoteMatch | null {
  const re = /\b(?:next spring|next fall|spring market|fall market|after (?:the )?(?:wedding|holidays|summer|sale)|in (?:Q[1-4]|the new year)|listing season|when ready)\b/i;
  const m = re.exec(notes);
  if (!m) return null;
  const phrase = m[0].toLowerCase();
  return {
    source: "notes:timing_signal",
    match: m,
    opener: `Notes mention "${phrase}" as a timing cue — open with that reference.`,
    trustLevel: "HIGH",
  };
}

/**
 * Recognize automation residue from Wise Agent and similar CRMs so we
 * never quote it as if it were a human-authored note. These are bulk
 * campaign-event exports that repeat verbatim across many contacts.
 */
const AUTOMATION_NOTE_PATTERNS = [
  /Program:\s*\d+\s+Touch/i,                  // "Program: 12 Touch Past Client Text"
  /Event Description:/i,                       // Wise Agent campaign event marker
  /Data we found for you/i,                    // Wise Agent enrichment export (often timestamp-prefixed)
  /\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}.*-\s*Program:/i, // timestamped campaign log
  /^\s*Christmas card\s*$/i,                   // single-word holiday-card touches — not useful
] as const;

function isAutomationNote(text: string): boolean {
  return AUTOMATION_NOTE_PATTERNS.some((p) => p.test(text));
}

/** Last-resort within notes: quote the first meaningful sentence. */
function extractPlainNoteQuote(notes: string): NoteMatch | null {
  const cleaned = notes.replace(/\s+/g, " ").trim();
  if (cleaned.length < 25) return null; // too short to be useful
  // Skip purely structural fragments ("imported from..."), header noise.
  const skipRe = /^(?:imported|migrated|note added|see (?:above|below)|N\/?A)/i;
  if (skipRe.test(cleaned)) return null;
  // Skip CRM automation residue. A bulk campaign export pretending to be
  // an opener thread is worse than a clean tag fallback.
  if (isAutomationNote(cleaned)) return null;
  // First sentence-ish chunk up to ~120 chars.
  const slice = cleaned.length > 120 ? `${cleaned.slice(0, 119)}…` : cleaned;
  // Synthesize a fake exec result so the source-evidence pipeline still
  // gets a reasonable window.
  const fake = { index: 0, 0: slice } as unknown as RegExpExecArray;
  return {
    source: "notes:plain_quote",
    match: fake,
    opener: `Last note on file: "${slice}". Open with that thread.`,
    trustLevel: "HIGH",
  };
}

const NOTE_EXTRACTORS: ReadonlyArray<
  (notes: string, name: string) => NoteMatch | null
> = [
  (notes, name) => extractRenovation(notes, name),
  (notes) => extractContractor(notes),
  (notes) => extractInvestmentProperty(notes),
  (notes) => extractGrowingFamily(notes),
  (notes, name) => extractRelocation(notes, name),
  (notes) => extractDownsizing(notes),
  (notes) => extractRefinance(notes),
  (notes) => extractSchoolDistrict(notes),
  (notes) => extractTimingSignal(notes),
  (notes) => extractPlainNoteQuote(notes),
];

// ── Tag extractors (MED) ───────────────────────────────────────────

const TAG_PATTERNS = {
  past_buyer: [
    /^past_?buyer$/,
    /^buyer$/, // Wise Agent / many CRMs export a bare "Buyer" tag for past buyer clients
    /^buyer_?(client|past)$/,
    /^bought_with_us$/,
  ],
  past_seller: [
    /^past_?seller$/,
    /^seller$/, // bare Wise Agent / CRM seller tag
    /^seller_?(client|past)$/,
    /^sold_with_us$/,
    /^listing_?past$/,
  ],
  repeat_client: [/^repeat_?client$/, /^past_?client$/, /^client_?(past|repeat)$/, /^closed$/],
  referral_source: [/^referral_?source$/, /^referral$/, /^referrer$/, /^referred_by$/],
  investor: [/^investor$/, /^investor_?lead$/, /^investment_?lead$/],
  farm: [/^farm$/, /^farm_?lead$/, /^geographic_?farm$/, /.*_?farm$/],
  sphere: [
    /^sphere$/,
    /^soi$/,
    /^sphere_?of_?influence$/,
    /^personal_?network$/,
    /^center_of_influence$/, // common Wise Agent label
    /^coi$/,
  ],
  first_time_buyer: [/^first_?time_?buyer$/, /^ftb$/, /^first_?time$/],
} as const;

function tagOpener(
  contact: OpenerInput,
  source: OpenerSource,
  matchedTag: string,
  text: string,
  trust: OpenerTrust,
): SuggestedOpener {
  return {
    opener: text,
    openerSource: source,
    supportingEvidence: clipEvidence(`tag: "${matchedTag}"`),
    trustLevel: trust,
    isSpecific: true,
  };
}

// ── Stale-relationship + close-date helpers ────────────────────────

function staleOpener(months: number, name: string): SuggestedOpener {
  if (months >= 12) {
    const years = Math.floor(months / 12);
    return {
      opener: `${years === 1 ? "Over a year" : `Over ${years} years`} since last touch and no recent notes. Soft restart, no agenda.`,
      openerSource: "stale_relationship:years",
      supportingEvidence: clipEvidence(`${months} months since last touch`),
      trustLevel: "WEAK",
      isSpecific: false,
    };
  }
  return {
    opener: `${months} months since last touch and no recent notes for ${firstName(name)}. Calm reconnect.`,
    openerSource: "stale_relationship:months",
    supportingEvidence: clipEvidence(`${months} months since last touch`),
    trustLevel: "WEAK",
    isSpecific: false,
  };
}

// ── Hunter-enrichment extractor ────────────────────────────────────

function formatHunterDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Build an opener that cites Hunter enrichment when (a) the call
 * returned, (b) confidence meets the floor, and (c) at least one of
 * company / role is set. Every claim is qualified with the Hunter
 * confidence and fetch date so an operator can verify it.
 *
 * Returns `null` to defer to the rest of the extractor chain.
 */
function extractHunterRole(input: OpenerInput): SuggestedOpener | null {
  const h = input.hunter;
  if (!h) return null;
  if (h.status !== "found") return null;
  if (typeof h.confidence !== "number" || h.confidence < HUNTER_OPENER_CONFIDENCE_FLOOR) {
    return null;
  }
  if (!h.company && !h.role) return null;

  const dateStr = formatHunterDate(h.fetchedAt);
  const confStr = `${Math.round(h.confidence)}%`;

  // Construct calm operator-facing language. No buzzwords, no
  // certainty inflation. The phrasing carries source + confidence +
  // date inline so the claim cannot drift into "Meridian says…".
  let opener: string;
  if (h.company && h.role) {
    opener = `Hunter places ${firstName(input.name)} at ${h.company} as ${h.role} (${confStr} confidence, ${dateStr}). Worth opening with that, then confirming.`;
  } else if (h.company) {
    opener = `Hunter places ${firstName(input.name)} at ${h.company} (${confStr} confidence, ${dateStr}). Worth opening with that, then confirming.`;
  } else {
    opener = `Hunter notes ${firstName(input.name)}'s role as ${h.role} (${confStr} confidence, ${dateStr}). Worth opening with that, then confirming.`;
  }

  const evidenceParts = [
    `Hunter ${dateStr}`,
    `${confStr} confidence`,
    h.company ? `company: ${h.company}` : null,
    h.role ? `role: ${h.role}` : null,
  ].filter(Boolean);
  const supportingEvidence = clipEvidence(evidenceParts.join(" · "));

  return {
    opener,
    openerSource: "enrichment:hunter_role",
    supportingEvidence,
    trustLevel: "MED",
    isSpecific: true,
  };
}

// ── Opportunity-priority extractor ─────────────────────────────────

function formatIsoDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function describeFactor(name: string): string {
  // Operator-facing label for the closed set of factor names. Calm,
  // descriptive — never inflated. New factor names default to a
  // sanitized form of the name string.
  switch (name) {
    case "prior_seller_relationship": return "you helped them sell before";
    case "prior_buyer_relationship": return "you helped them buy before";
    case "operator_preference_seller_bias": return "seller-side fit for your book";
    case "active_listing_found": return "an active listing on file";
    case "listed_by_another_agent": return "listed with another agent";
    case "ownership_duration_over_7yr": return "held the property 7+ years";
    case "stale_relationship_over_12mo": return "12+ months since last touch";
    case "verified_contact_path": return "a working contact channel";
    default: return name.replace(/_/g, " ");
  }
}

/**
 * Build an opener that cites the transparent opportunity priority.
 * Only fires when:
 *   • priorityTier is HIGH or MED
 *   • a public_record source grounded the score (publicRecordSource
 *     present)
 *
 * Every claim is sourced and dated inline. No hype framing — banned-
 * phrase regex scans cover this in check-opener-generation +
 * check-opportunity-pipeline.
 */
function extractOpportunityPriority(input: OpenerInput): SuggestedOpener | null {
  const o = input.opportunity;
  if (!o) return null;
  if (o.priorityTier !== "HIGH" && o.priorityTier !== "MED") return null;
  // Requires actual parcel grounding — Commit C contract: no opener
  // without a source.
  if (!o.publicRecordSource) return null;
  if (!o.matchedPropertyAddress) return null;
  if (o.topAppliedFactorNames.length === 0) return null;

  const factorBlurb = describeFactor(o.topAppliedFactorNames[0]);
  const tierLabel = o.priorityTier === "HIGH" ? "this week" : "this cycle";
  const ownershipBlurb =
    o.ownershipDurationYears !== null && o.ownershipDurationYears >= 7
      ? `held the property ${o.ownershipDurationYears}+ years`
      : o.ownershipDurationYears !== null
        ? `${o.ownershipDurationYears} yr${o.ownershipDurationYears === 1 ? "" : "s"} on title`
        : "current owner on title";
  const dateStr = formatIsoDate(o.fetchedAt);

  const opener =
    `Public record shows ${firstName(input.name)} on title at ${o.matchedPropertyAddress} (${ownershipBlurb}, source ${o.publicRecordSource}). ` +
    `Worth surfacing as a priority ${tierLabel} — ${factorBlurb}.`;

  const evidenceParts = [
    `${o.priorityTier} · score ${o.transparentPriorityScore}`,
    o.matchedPropertyAddress,
    o.publicRecordSource,
    `as of ${dateStr}`,
  ];
  const supportingEvidence = clipEvidence(evidenceParts.join(" · "));

  return {
    opener,
    openerSource: "enrichment:opportunity_priority",
    supportingEvidence,
    trustLevel: "MED",
    isSpecific: true,
  };
}

// ── Main builder ───────────────────────────────────────────────────

/**
 * Generate one operator-facing opener. Pure. Same input → same output.
 * Always returns a result — falls back to honest "no context on file"
 * when nothing specific is available.
 */
export function buildSuggestedOpener(
  input: OpenerInput,
  options: OpenerOptions = {},
): SuggestedOpener {
  const now = options.now ?? new Date();
  const name = (input.name ?? "this contact").trim() || "this contact";
  const notes = input.notes?.trim() ?? "";

  // 1. Try every note extractor in priority order. Each is independent
  //    and pure; the first hit wins.
  if (notes) {
    for (const run of NOTE_EXTRACTORS) {
      const hit = run(notes, name);
      if (!hit) continue;
      const evidence = hit.source === "notes:plain_quote"
        ? clipEvidence(`notes: "${notes.slice(0, 80)}…"`)
        : clipEvidence(`notes: ${quoteWindow(notes, hit.match.index ?? 0)}`);
      return {
        opener: hit.opener,
        openerSource: hit.source,
        supportingEvidence: evidence,
        trustLevel: hit.trustLevel,
        isSpecific: true,
      };
    }
  }

  // 2. Hunter-enrichment opener. Only fires when the provider returned,
  //    confidence ≥ HUNTER_OPENER_CONFIDENCE_FLOOR, and at least one of
  //    company / role is set. Otherwise defer to tag chain.
  const hunterOpener = extractHunterRole(input);
  if (hunterOpener) return hunterOpener;

  // 3. Public-record-backed opportunity-priority opener. Only fires when
  //    tier is HIGH/MED AND parcel grounding (publicRecordSource +
  //    matchedPropertyAddress) is present. Otherwise defer to tag chain.
  const opportunityOpener = extractOpportunityPriority(input);
  if (opportunityOpener) return opportunityOpener;

  // 4. Tag-based openers. Past-buyer / past-seller / repeat carry the
  //    last-close year when available.
  const tags = input.tags ?? [];
  const closeYear = yearOf(input.lastInteractionAt);
  const monthsSince = monthsBetween(input.lastInteractionAt, now);

  const pastSellerTag = hasTag(tags, [...TAG_PATTERNS.past_seller]);
  if (pastSellerTag) {
    const yearStr = closeYear ? ` in ${closeYear}` : "";
    return tagOpener(
      input,
      "tag:past_seller",
      pastSellerTag,
      `You helped ${firstName(name)} sell${yearStr}. Worth a check on what's next for them.`,
      "MED",
    );
  }

  const pastBuyerTag = hasTag(tags, [...TAG_PATTERNS.past_buyer]);
  if (pastBuyerTag) {
    const yearStr = closeYear ? ` in ${closeYear}` : "";
    return tagOpener(
      input,
      "tag:past_buyer",
      pastBuyerTag,
      `You helped ${firstName(name)} buy${yearStr}. Good candidate for a simple market check-in.`,
      "MED",
    );
  }

  const repeatTag = hasTag(tags, [...TAG_PATTERNS.repeat_client]);
  if (repeatTag) {
    const yearStr = closeYear ? ` (${closeYear})` : "";
    return tagOpener(
      input,
      "tag:repeat_client",
      repeatTag,
      `Past client per your tags${yearStr}. Anniversary-style check-in works.`,
      "MED",
    );
  }

  const referralTag = hasTag(tags, [...TAG_PATTERNS.referral_source]);
  if (referralTag) {
    return tagOpener(
      input,
      "tag:referral_source",
      referralTag,
      `Referral-source relationship — easy reconnect, no agenda needed.`,
      "MED",
    );
  }

  const investorTag = hasTag(tags, [...TAG_PATTERNS.investor]);
  if (investorTag) {
    return tagOpener(
      input,
      "tag:investor",
      investorTag,
      `Tagged investor — short market temperature note is the right touch.`,
      "MED",
    );
  }

  const farmTag = hasTag(tags, [...TAG_PATTERNS.farm]);
  if (farmTag) {
    const ageHint = monthsSince !== null ? ` ${monthsSince} months since last touch.` : "";
    return tagOpener(
      input,
      "tag:farm",
      farmTag,
      `From the "${farmTag}" farm.${ageHint} Brief neighborhood check-in.`,
      "MED",
    );
  }

  const sphereTag = hasTag(tags, [...TAG_PATTERNS.sphere]);
  if (sphereTag) {
    return tagOpener(
      input,
      "tag:sphere",
      sphereTag,
      `Sphere relationship — context-only note works, no real-estate angle needed.`,
      "MED",
    );
  }

  const firstTimeTag = hasTag(tags, [...TAG_PATTERNS.first_time_buyer]);
  if (firstTimeTag) {
    const yearStr = closeYear ? ` (${closeYear})` : "";
    return tagOpener(
      input,
      "tag:first_time_buyer",
      firstTimeTag,
      `First-time buyer${yearStr}. Anniversary check-in is a natural touch.`,
      "MED",
    );
  }

  // 3. Date-only tier. The thresholds split into three operator-meaningful
  //    buckets:
  //      • ≥ 36 months → "stale_relationship:years" (long absence, soft restart)
  //      • 6–35 months → "last_close:date" (fairly recent, cite the year)
  //      • 1–5 months  → "stale_relationship:months" (recent but quiet)
  if (monthsSince !== null) {
    if (monthsSince >= 36) {
      return staleOpener(monthsSince, name);
    }
    if (closeYear !== null && monthsSince >= 6) {
      return {
        opener: `Last contact in ${closeYear}. Open with a brief check-in — no specific thread on file.`,
        openerSource: "last_close:date",
        supportingEvidence: clipEvidence(`lastInteractionAt: ${input.lastInteractionAt}`),
        trustLevel: "MED",
        isSpecific: true,
      };
    }
    if (monthsSince >= 1) {
      return staleOpener(monthsSince, name);
    }
  }

  // 5. Tag-but-no-pattern fallback. Honest naming.
  if (tags.length > 0) {
    return {
      opener: `Tagged ${tags.slice(0, 2).map((t) => `"${t}"`).join(" + ")} — open with that as the only context on file.`,
      openerSource: "fallback:tag_only",
      supportingEvidence: clipEvidence(`tags: ${tags.slice(0, 3).join(", ")}`),
      trustLevel: "WEAK",
      isSpecific: false,
    };
  }

  // 6. Last resort. Nothing in the CRM. State that plainly.
  return {
    opener: `Imported contact with no notes, tags, or recent interactions on file. Enrich first or open with a calm neutral check-in.`,
    openerSource: "fallback:no_context",
    supportingEvidence: "no CRM evidence available",
    trustLevel: "WEAK",
    isSpecific: false,
  };
}

/** Convenience: build directly from a stored CrmContactRecord. */
export function buildSuggestedOpenerFromContact(
  contact: CrmContactRecord,
  options: OpenerOptions = {},
): SuggestedOpener {
  const h = contact.enrichment?.hunter;
  const o = contact.enrichment?.opportunity;
  return buildSuggestedOpener(
    {
      name: contact.name,
      notes: contact.notes,
      tags: contact.tags,
      lastInteractionAt: contact.lastInteractionAt,
      sourceCrm: contact.sourceCrm,
      hunter: h
        ? {
            status: h.status,
            confidence: h.confidence,
            company: h.company,
            role: h.role,
            fetchedAt: h.fetchedAt,
          }
        : null,
      opportunity: o
        ? {
            priorityTier: o.priorityTier,
            transparentPriorityScore: o.transparentPriorityScore,
            matchedPropertyAddress: o.matchedPropertyAddress,
            ownerName: o.ownerName,
            ownershipDurationYears: o.ownershipDurationYears,
            publicRecordSource: o.publicRecordSource ?? null,
            fetchedAt: o.fetchedAt,
            topAppliedFactorNames: (o.priorityFactors ?? [])
              .filter((f) => f.applied)
              .slice()
              .sort((a, b) =>
                b.weight !== a.weight
                  ? b.weight - a.weight
                  : a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
              )
              .map((f) => f.name),
          }
        : null,
    },
    options,
  );
}
