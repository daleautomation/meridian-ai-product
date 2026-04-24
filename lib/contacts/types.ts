// Meridian AI — contact resolution engine types.
//
// Identity-first pipeline: normalize business → resolve across sources in
// parallel → score candidates → extract contact → score confidence → output.

export type ContactSource =
  | "google_places"
  | "yelp"
  | "bbb"
  | "angi"
  | "facebook"
  | "bing"
  | "scrape"
  | "hunter";

// One pre-collected site-email hit carried from inspect_website into the
// resolver. Mirrors SiteEmailHit from inspectWebsite but decoupled at the
// type level so the resolver does not import from the MCP tool tree.
export type SiteEmailObservation = {
  email: string;
  method: "website_mailto" | "website_visible" | "website_schema" | "website_obfuscated";
  page: string;
};

export type BusinessInput = {
  companyName: string;
  city?: string;
  state?: string;
  category?: string;
  website?: string;
  phone?: string;                    // pre-known phone (e.g. from live site scan)
  email?: string;                    // pre-known chosen primary email (legacy single-value)
  siteEmails?: SiteEmailObservation[]; // full list from inspect_website
  hasContactForm?: boolean;          // inspectWebsite detected a contact/quote form
};

export type Identity = {
  rawName: string;
  normalizedName: string;
  city: string;
  state: string;
  locationKey: string;      // "city|ST"
  category: string;
  // Optional — populated from BusinessInput.website. Required by providers
  // that query by domain (Hunter). Empty string when unknown.
  domain: string;
};

export type ContactCandidate = {
  name: string;
  address?: string;
  phone?: string;
  email?: string;                 // provider-returned email (Hunter)
  contactName?: string;           // provider-returned person name (Hunter)
  contactPosition?: string;       // provider-returned job title (Hunter)
  website?: string;
  rating?: number;
  reviewCount?: number;
  source: ContactSource;
  sourceId?: string;
  fallbackUrl?: string;     // facebook page, contact page, etc.
  // Raw 0–100 confidence number emitted by the provider (Hunter). The
  // resolver normalizes this into the canonical low/medium/high tier.
  providerConfidence?: number;
};

export type CandidateScore = {
  name: number;             // 0..1
  location: number;         // 0..1
  category: number;         // 0..1
  total: number;            // 0..1 — (name*0.6) + (location*0.3) + (category*0.1)
};

export type MatchedCandidate = ContactCandidate & { score: CandidateScore };

export type ContactSummary = "found" | "fallback" | "empty";

export type ContactConfidence = "high" | "medium" | "low" | "none";

export type FallbackRoute = "facebook" | "contact_page" | null;

// Individual contact path (one way to reach the business). Multiple paths
// are ranked in a waterfall: GBP phone > Yelp phone > site-extracted phone >
// contact form > website contact page > social fallback > inferred email.
export type ContactPathMethod = "phone" | "email" | "form" | "website" | "social";

export type ContactPath = {
  method: ContactPathMethod;
  value: string;                              // phone number, email, or URL
  source: ContactSource | "website" | "inferred";
  verified: boolean;                           // true when source is GBP/Yelp/BBB (provider-verified)
  confidence: ContactConfidence;
  rank: number;                                // lower is better (1 = best)
  label?: string;                              // optional UI label (e.g. "GBP phone")
};

// Email classification for the primary email, when one exists.
//   person_email    — name-bearing local-part (firstname, firstname.last, etc.)
//                     OR provider explicitly labeled it as "personal"
//   generic_inbox   — info@, contact@, sales@, office@, hello@, etc.
//   unknown_email_type — pattern does not match either classifier
export type EmailType = "person_email" | "generic_inbox" | "unknown_email_type";

// The operator's recommended next action based on the strongest available
// path. Keeps contact presentation and ranking aligned with what the
// operator can actually do right now.
export type BestNextAction =
  | "READY TO CALL"
  | "READY TO EMAIL"
  | "SUBMIT FORM"
  | "MANUAL VERIFY"
  | "RESEARCH FURTHER";

// Overall completeness of the contact package.
export type ContactCompleteness = "COMPLETE" | "STRONG" | "PARTIAL" | "WEAK";

// Optional per-source verification timestamps. Populated when a given
// provider returned a candidate in this resolution. Keeps the existing
// `lastCheckedAt` (overall) in place.
export type PerSourceTimestamps = {
  googleVerifiedAt?: string;
  yelpCheckedAt?: string;
  bbbCheckedAt?: string;
  facebookCheckedAt?: string;
  hunterCheckedAt?: string;
  websiteCheckedAt?: string;
};

// Final output shape consumed by the UI.
export type ContactResolution = {
  phone: string | null;
  email: string | null;
  fallbackRoute: FallbackRoute;
  fallbackUrl: string | null;
  source: ContactSource | "none";
  confidence: ContactConfidence;
  checkedSources: ContactSource[];
  matchedName?: string;
  matchedAddress?: string;
  rating?: number;
  reviewCount?: number;
  lastCheckedAt: string;    // ISO
  summary: ContactSummary;
  paths: ContactPath[];     // ranked contact paths, best first
  // Debug — why we got this result. Values include provider skip reasons
  // like "google_skipped_no_key" or outcome tags like
  // "verified_phone_found_google" / "site_phone_found_unverified" /
  // "contact_page_only". Never blocks UI; informational only.
  detail?: string;
  skippedSources?: string[];

  // ── Phase 6: richer contact intelligence (all optional for bw compat) ──
  // Source-specific confidence for each path type.
  phoneConfidence?: ContactConfidence;
  emailConfidence?: ContactConfidence;
  nameConfidence?: ContactConfidence;
  fallbackConfidence?: ContactConfidence;
  // Did multiple sources agree? E.g. Google phone == site phone.
  corroborated?: boolean;
  corroborationReasons?: string[];
  // Business entity name vs. real person name (Hunter/site-derived).
  businessName?: string;
  contactName?: string;
  contactRole?: string;
  // Person vs generic-inbox classification of the primary email.
  primaryEmailType?: EmailType;
  // What should the operator do next?
  bestNextAction?: BestNextAction;
  bestNextActionReason?: string;
  // Completeness of the overall contact package.
  contactCompleteness?: ContactCompleteness;
  contactCompletenessReason?: string;
  // One-line human explanation of why the primary path was chosen.
  primaryContactReason?: string;
  // Per-source verification timestamps.
  timestamps?: PerSourceTimestamps;

  // ── Phase 7: at-a-glance contact quality ──
  // Deterministic 0–10 score derived from existing fields. See resolver.
  contactQualityScore?: number;
  contactQualityLabel?: "Elite Contact" | "Strong Contact" | "Usable Contact" | "Weak Contact";
  // Who the operator should ask for on the call. Multiple entries allowed
  // (name + role, or a default list when no real person is on file).
  askFor?: string[];

  // ── Handoff fields (match type + alternates, derived from paths/scored) ──
  // exact     — high-confidence match (verified provider agreed on name+location)
  // closest   — lower-confidence / approximate match (near-miss threshold)
  // unresolved — no business identity matched at all
  matchType?: "exact" | "closest" | "unresolved";
  matchedDomain?: string;
  // Alternate phone / email values (after the primary) observed during the
  // same resolution. Derived from paths[] — never fabricated.
  alternatePhones?: string[];
  alternateEmails?: string[];

  // ── Phase 8: best reachable path + no-email explanation ──
  bestReachablePath?:
    | "Verified phone"
    | "Unverified phone"
    | "Person email"
    | "Generic inbox"
    | "Contact form"
    | "Website only"
    | "Listing only"
    | "None";
  bestReachablePathReason?: string;
  // Deterministic reason the lead has no email. Present only when no email
  // is on file; omitted otherwise.
  noEmailReason?:
    | "no_email_found_on_site"
    | "no_provider_email_found"
    | "contact_form_only"
    | "website_only_no_email"
    | "no_website_no_email"
    | "contact_page_found_no_email"
    | "website_unreachable"
    | "domain_mismatch_blocked_email"
    | "low_trust_candidates_only";
  // True when the Hunter email domain does not match the business website
  // domain. When true, emailConfidence is forced down to "low".
  emailDomainMismatch?: boolean;
  // How the primary email was obtained. Populated alongside `email` and
  // matches the resolver's single chosen method.
  emailMethod?:
    | "website_mailto"
    | "website_visible"
    | "website_schema"
    | "website_obfuscated"
    | "provider_verified"
    | "provider_observed"
    | "fallback_listing"
    | "unresolved";
};
