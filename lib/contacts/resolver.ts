// Meridian AI — contact resolution engine.
//
// Identity-first orchestrator: normalize business → query all candidate
// sources in parallel → score candidates → extract best phone or fallback
// route → score confidence → return a structured result.
//
// Never throws. Partial source failures degrade gracefully (empty arrays).
// Never returns a "no contact found" dead-end if any fallback URL exists.

import { normalizeIdentity, scoreCandidate } from "./identity";
import { searchGooglePlaces } from "./sources/googlePlaces";
import { searchYelp } from "./sources/yelp";
import { searchBBB } from "./sources/bbb";
import { searchFacebook } from "./sources/facebook";
import { searchHunter } from "./sources/hunter";
import type {
  BusinessInput,
  ContactCandidate,
  ContactResolution,
  ContactSource,
  ContactConfidence,
  ContactPath,
  MatchedCandidate,
  EmailType,
  BestNextAction,
  ContactCompleteness,
  PerSourceTimestamps,
} from "./types";

// Provider rank for verified-phone paths. Lower number = higher preference.
// Matches the waterfall spec: GBP > Yelp > BBB > Facebook.
const PROVIDER_RANK: Record<ContactSource, number> = {
  google_places: 1,
  yelp: 2,
  bbb: 3,
  angi: 4,
  facebook: 5,
  bing: 6,
  scrape: 7,
  hunter: 8,             // Hunter is email-only; phones never come from it
};

function sourceConfidence(source: ContactSource): ContactConfidence {
  // Verified provider phones. Per engine contract:
  //   Google Places: high
  //   Yelp:          high (verified listing)
  //   BBB:           medium (directory — verified listing but not as strong)
  //   Hunter:        medium (observed emails with provider-reported score)
  //   Facebook / Bing / scrape: low (unverified)
  if (source === "google_places") return "high";
  if (source === "yelp") return "high";
  if (source === "bbb") return "medium";
  if (source === "hunter") return "medium";
  return "low";
}

function providerLabel(source: ContactSource): string {
  switch (source) {
    case "google_places": return "Google Business Profile";
    case "yelp": return "Yelp";
    case "bbb": return "BBB";
    case "angi": return "Angi";
    case "facebook": return "Facebook";
    case "bing": return "Bing Places";
    case "scrape": return "Scrape";
    case "hunter": return "Hunter";
  }
}

// Build a ranked contact-path waterfall from the scored candidate list plus
// any site-extracted signals passed in via BusinessInput (phone_from_site,
// email_from_site, has_contact_form, website URL).
function buildContactPaths(
  scored: MatchedCandidate[],
  input: BusinessInput,
): ContactPath[] {
  const paths: ContactPath[] = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  const seenUrls = new Set<string>();

  // 1–5: Provider-verified phone numbers, ranked by provider quality.
  const withPhone = scored
    .filter((c) => !!c.phone)
    .sort((a, b) => PROVIDER_RANK[a.source] - PROVIDER_RANK[b.source]);
  for (const c of withPhone) {
    const phone = c.phone!;
    if (seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    paths.push({
      method: "phone",
      value: phone,
      source: c.source,
      verified: c.source !== "facebook" && c.source !== "bing" && c.source !== "scrape",
      confidence: sourceConfidence(c.source),
      rank: PROVIDER_RANK[c.source],
      label: `${providerLabel(c.source)} phone`,
    });
  }

  // 6: Phone extracted directly from live website scan.
  if (input.phone && !seenPhones.has(input.phone)) {
    seenPhones.add(input.phone);
    paths.push({
      method: "phone",
      value: input.phone,
      source: "website",
      verified: false,
      confidence: "medium",
      rank: 10,
      label: "Phone on homepage",
    });
  }

  // 7: Contact form on homepage (pass-through from inspector).
  const website = input.website || scored.find((c) => !!c.website)?.website;
  if (website && !seenUrls.has(website)) {
    seenUrls.add(website);
    paths.push({
      method: "website",
      value: website,
      source: "website",
      verified: false,
      confidence: "low",
      rank: 20,
      label: "Website contact page",
    });
  }

  // 7b: Contact form detected on the website (inspectWebsite). Treated as a
  // first-class fallback when no direct phone/email exists. `form` paths are
  // emitted even when site email is later added so the operator can still
  // see the form option in the ranked list.
  if (input.hasContactForm) {
    const formUrl = input.website ?? scored.find((c) => !!c.website)?.website;
    const formKey = (formUrl ?? "") + "#form";
    if (formUrl && !seenUrls.has(formKey)) {
      seenUrls.add(formKey);
      paths.push({
        method: "form",
        value: formUrl,
        source: "website",
        verified: false,
        confidence: "medium",
        rank: 28,
        label: "Website contact form",
      });
    }
  }

  // 8: Social fallback (Facebook page).
  const fb = scored.find((c) => c.source === "facebook" && !!c.fallbackUrl);
  if (fb?.fallbackUrl && !seenUrls.has(fb.fallbackUrl)) {
    seenUrls.add(fb.fallbackUrl);
    paths.push({
      method: "social",
      value: fb.fallbackUrl,
      source: "facebook",
      verified: false,
      confidence: "low",
      rank: 30,
      label: "Facebook page",
    });
  }

  // 9a: Provider-returned emails (Hunter). Ranked above site-scraped email.
  // Hunter emails are observed in public sources (not inferred/guessed) and
  // come with a provider-reported confidence score.
  const withEmail = scored.filter((c) => !!c.email);
  for (const c of withEmail) {
    const email = c.email!;
    if (seenEmails.has(email.toLowerCase())) continue;
    seenEmails.add(email.toLowerCase());
    const personLabel = c.contactName ? ` (${c.contactName}${c.contactPosition ? `, ${c.contactPosition}` : ""})` : "";
    const pc = c.providerConfidence ?? 0;
    const conf: ContactConfidence = c.source === "hunter"
      ? (pc >= 85 ? "high" : pc >= 60 ? "medium" : "low")
      : sourceConfidence(c.source);
    paths.push({
      method: "email",
      value: email,
      source: c.source,
      verified: c.source === "hunter" ? pc >= 85 : false,
      confidence: conf,
      rank: c.source === "hunter" ? 35 : 38,
      label: `${providerLabel(c.source)} email${personLabel}`,
    });
  }

  // 9b: Emails collected from live site scan. When the inspector supplied
  // a full `siteEmails[]` array (method + page per hit) we emit one ranked
  // path per hit so the ranked list reflects the provenance. Mailto hits
  // are treated as medium confidence (they are real links, on the site);
  // schema hits also medium; visible/obfuscated get low.
  const siteEmailObs = input.siteEmails ?? [];
  if (siteEmailObs.length > 0) {
    for (const hit of siteEmailObs) {
      const email = hit.email.toLowerCase();
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
      const methodRank = hit.method === "website_mailto" ? 39
        : hit.method === "website_schema" ? 40
        : hit.method === "website_visible" ? 41
        : 42;
      const methodConfidence: ContactConfidence =
        hit.method === "website_mailto" || hit.method === "website_schema"
          ? "medium" : "low";
      const methodLabel = hit.method === "website_mailto" ? "mailto on site"
        : hit.method === "website_schema" ? "schema email on site"
        : hit.method === "website_obfuscated" ? "obfuscated email on site"
        : "email on site";
      paths.push({
        method: "email",
        value: hit.email,
        source: "website",
        verified: false,
        confidence: methodConfidence,
        rank: methodRank,
        label: methodLabel,
      });
    }
  } else {
    // Legacy single-value fallback when the inspector only produced
    // `input.email`. Kept so older snapshots still surface an email path.
    const siteEmail = (input as BusinessInput & { email?: string }).email;
    if (siteEmail && !seenEmails.has(siteEmail.toLowerCase())) {
      seenEmails.add(siteEmail.toLowerCase());
      paths.push({
        method: "email",
        value: siteEmail,
        source: "website",
        verified: false,
        confidence: "low",
        rank: 40,
        label: "Email on homepage",
      });
    }
  }

  return paths.sort((a, b) => a.rank - b.rank);
}

// Below this score, we do not trust a candidate is the same business.
// Name similarity + location + category weighted. Relaxed from 0.80 → 0.60
// so partial name matches clear when location + category are strong — a
// common case for "Smith Roofing" vs "Smith's Roofing LLC". Candidates that
// still fall below this drop into the near-miss fallback path.
const MATCH_THRESHOLD = 0.60;

// Secondary acceptance: accept a candidate that falls under the composite
// threshold IFF all three of these hold — ensures we don't accept unrelated
// businesses just because they're in the same city.
const MIN_NAME_SIM_FOR_BYPASS = 0.50;
const MIN_LOCATION_FOR_BYPASS = 0.70;

type Adapter = {
  key: ContactSource;
  fn: (identity: ReturnType<typeof normalizeIdentity>) => Promise<ContactCandidate[]>;
};

const ADAPTERS: Adapter[] = [
  { key: "google_places", fn: searchGooglePlaces },
  { key: "yelp", fn: searchYelp },
  { key: "bbb", fn: searchBBB },
  { key: "facebook", fn: searchFacebook },
  { key: "hunter", fn: searchHunter },
];

// Enumerates provider env vars. Used to explain WHY a source returned []:
// skipped for missing key vs. queried-and-empty. Keeps the resolver honest
// when debugging why a lead came back empty.
function providerSkipReasons(): string[] {
  const skipped: string[] = [];
  if (!process.env.GOOGLE_API_KEY && !process.env.GOOGLE_PLACES_API_KEY) skipped.push("google_skipped_no_key");
  if (!process.env.YELP_API_KEY) skipped.push("yelp_skipped_no_key");
  if (!process.env.BBB_SEARCH_URL) skipped.push("bbb_skipped_no_endpoint");
  if (!process.env.FACEBOOK_SEARCH_URL) skipped.push("facebook_skipped_no_endpoint");
  if (!process.env.HUNTER_API_KEY) skipped.push("hunter_skipped_no_key");
  return skipped;
}

// ── Phase 6: contact-intelligence helpers ──────────────────────────────

// Compact a phone string to digits only for comparison. "+1 (816) 555-0184"
// and "(816) 555-0184" should corroborate. Area code + last 7 is the
// canonical key.
function compactPhone(p: string | null | undefined): string {
  if (!p) return "";
  const digits = String(p).replace(/\D/g, "");
  // Drop leading "1" so "18165550184" and "8165550184" compare equal.
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

// Generic inbox detection — deterministic local-part list. Never guesses
// personhood; Hunter's `type: "personal"` can override classification
// downstream when we know the provider labeled it.
const GENERIC_INBOX_LOCALPARTS = new Set([
  "info", "contact", "office", "sales", "support", "hello", "admin",
  "service", "team", "help", "inquiries", "inquiry", "customer",
  "customers", "mail", "marketing", "accounting", "billing",
  "noreply", "no-reply", "donotreply",
]);

function classifyEmail(email: string | null, hintType?: "personal" | "generic"): EmailType {
  if (!email) return "unknown_email_type";
  if (hintType === "personal") return "person_email";
  if (hintType === "generic") return "generic_inbox";
  const local = String(email).split("@")[0]?.toLowerCase() ?? "";
  if (!local) return "unknown_email_type";
  if (GENERIC_INBOX_LOCALPARTS.has(local)) return "generic_inbox";
  // Single dotted firstname.lastname or first+last style.
  if (/^[a-z]{2,}\.[a-z]{2,}$/.test(local)) return "person_email";
  if (/^[a-z]{2,}_[a-z]{2,}$/.test(local)) return "person_email";
  // First initial + last (jsmith) or firstname + last initial — ambiguous.
  return "unknown_email_type";
}

function emailDomain(email: string | null | undefined): string {
  if (!email) return "";
  return String(email).split("@")[1]?.toLowerCase() ?? "";
}

// Corroboration — which independent signals agree? Keeps the check honest:
// matches only count when the underlying values are non-empty.
function computeCorroboration(
  scored: MatchedCandidate[],
  input: BusinessInput,
  identity: ReturnType<typeof normalizeIdentity>,
): { corroborated: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const sitePhone = compactPhone(input.phone);
  const googlePhone = compactPhone(scored.find((c) => c.source === "google_places")?.phone);
  const yelpPhone = compactPhone(scored.find((c) => c.source === "yelp")?.phone);
  const bbbPhone = compactPhone(scored.find((c) => c.source === "bbb")?.phone);

  if (googlePhone && sitePhone && googlePhone === sitePhone) {
    reasons.push("google_phone_matches_site_phone");
  }
  if (googlePhone && yelpPhone && googlePhone === yelpPhone) {
    reasons.push("google_phone_matches_yelp_phone");
  }
  if (yelpPhone && sitePhone && yelpPhone === sitePhone) {
    reasons.push("yelp_phone_matches_site_phone");
  }
  if (bbbPhone && googlePhone && bbbPhone === googlePhone) {
    reasons.push("bbb_phone_matches_google_phone");
  }

  const hunterEmail = scored.find((c) => c.source === "hunter")?.email;
  const hunterDomain = emailDomain(hunterEmail);
  if (hunterDomain && identity.domain && hunterDomain === identity.domain) {
    reasons.push("hunter_email_matches_site_domain");
  }

  const hunterName = scored.find((c) => c.source === "hunter")?.contactName?.toLowerCase();
  // "matchedName" from Google comes back as business entity, not person, so
  // we only corroborate names when a person name from Hunter appears in the
  // site body. input does not carry site body, so this is a limited check:
  // skip unless we have a second provider-supplied contactName that matches.
  const otherName = scored.find(
    (c) => c.source !== "hunter" && !!c.contactName,
  )?.contactName?.toLowerCase();
  if (hunterName && otherName && hunterName === otherName) {
    reasons.push("contact_name_agrees_across_sources");
  }

  return { corroborated: reasons.length > 0, reasons };
}

// Best next action from the ranked paths. Deterministic lookup, no ML.
function deriveBestNextAction(
  paths: ContactPath[],
  emailType: EmailType,
): { action: BestNextAction; reason: string } {
  const phonePath = paths.find((p) => p.method === "phone");
  const emailPath = paths.find((p) => p.method === "email");
  const formPath = paths.find((p) => p.method === "form");
  const socialPath = paths.find((p) => p.method === "social");
  const sitePath = paths.find((p) => p.method === "website");

  if (phonePath?.verified) {
    return { action: "READY TO CALL", reason: `verified ${phonePath.label ?? phonePath.source} phone on file` };
  }
  if (phonePath) {
    return { action: "READY TO CALL", reason: `phone on file via ${phonePath.label ?? phonePath.source}` };
  }
  if (emailPath && emailType !== "generic_inbox") {
    return { action: "READY TO EMAIL", reason: `${emailType === "person_email" ? "person" : "direct"} email available via ${emailPath.label ?? emailPath.source}` };
  }
  if (emailPath) {
    return { action: "READY TO EMAIL", reason: `generic inbox available via ${emailPath.label ?? emailPath.source}` };
  }
  if (formPath) {
    return { action: "SUBMIT FORM", reason: "contact form detected on site" };
  }
  if (sitePath || socialPath) {
    return { action: "MANUAL VERIFY", reason: `only ${socialPath ? "social" : "website"} fallback available` };
  }
  return { action: "RESEARCH FURTHER", reason: "no direct contact path found" };
}

// Completeness classification.
function computeCompleteness(
  paths: ContactPath[],
  phone: string | null,
  email: string | null,
  fallbackUrl: string | null,
  corroborated: boolean,
): { level: ContactCompleteness; reason: string } {
  const phonePath = paths.find((p) => p.method === "phone");
  const emailPath = paths.find((p) => p.method === "email");
  const formPath = paths.find((p) => p.method === "form");
  const socialPath = paths.find((p) => p.method === "social");
  const verifiedPhone = phonePath?.verified === true;
  const verifiedEmail = emailPath?.verified === true;

  if (verifiedPhone && (email || emailPath) && fallbackUrl) {
    return { level: "COMPLETE", reason: corroborated ? "verified phone + email + corroborated" : "verified phone + email + website on file" };
  }
  if (verifiedPhone || verifiedEmail) {
    return { level: "STRONG", reason: `${verifiedPhone ? "verified phone" : "verified email"} on file` };
  }
  if (phone || email || formPath) {
    return { level: "PARTIAL", reason: phone ? "unverified phone only" : email ? "email only" : "contact form only" };
  }
  if (socialPath || fallbackUrl) {
    return { level: "WEAK", reason: "listing or social fallback only" };
  }
  return { level: "WEAK", reason: "no contact path found" };
}

// Human-friendly one-liner for why this primary path won. Phrased in
// operator-direct terms (what the source was, whether it agrees with other
// sources) — never vague.
function buildPrimaryContactReason(
  paths: ContactPath[],
  corroborated: boolean,
  corroborationReasons: string[],
  phone: string | null,
  email: string | null,
  emailType: EmailType,
): string {
  const phonePath = paths.find((p) => p.method === "phone");
  const emailPath = paths.find((p) => p.method === "email");
  const phoneCorroborated = corroborated && corroborationReasons.some((r) => r.includes("phone"));

  if (phonePath?.verified) {
    if (phoneCorroborated) {
      if (corroborationReasons.includes("google_phone_matches_site_phone")) {
        return "Google Business Profile phone verified and matches website.";
      }
      if (corroborationReasons.includes("google_phone_matches_yelp_phone")) {
        return "Google Business Profile phone verified and matches Yelp.";
      }
      if (corroborationReasons.includes("yelp_phone_matches_site_phone")) {
        return "Yelp phone verified and matches website.";
      }
      return `${phonePath.label ?? phonePath.source} phone verified; corroborated across sources.`;
    }
    return `${phonePath.label ?? phonePath.source} phone verified.`;
  }
  if (phonePath) {
    return `Phone on file via ${phonePath.label ?? phonePath.source} (unverified).`;
  }
  if (phone) {
    return "Phone extracted from live website scan (unverified).";
  }
  if (emailPath?.source === "hunter") {
    return "High-confidence email from Hunter.";
  }
  if (email && emailType === "person_email") {
    return "Person email found on the site.";
  }
  if (email && emailType === "generic_inbox") {
    return "Generic inbox email found (info@, sales@, etc.).";
  }
  if (email) {
    return "Email address available.";
  }
  const formPath = paths.find((p) => p.method === "form");
  if (formPath) return "Only a contact form was found on the site.";
  return "Fallback only: no direct contact found.";
}

// Deterministic 0–10 contact quality score. Derived purely from existing
// resolver fields — no new inputs, no ML. Cap at 10.
function computeContactQuality(
  paths: ContactPath[],
  corroborated: boolean,
  corroborationReasons: string[],
  emailType: EmailType,
  completeness: ContactCompleteness,
  contactName: string | undefined,
): { score: number; label: "Elite Contact" | "Strong Contact" | "Usable Contact" | "Weak Contact" } {
  let score = 0;
  const phonePath = paths.find((p) => p.method === "phone");
  const emailPath = paths.find((p) => p.method === "email");

  // Verified Google/Yelp phone.
  if (phonePath?.verified && (phonePath.source === "google_places" || phonePath.source === "yelp")) {
    score += 5;
  } else if (phonePath?.verified) {
    // Other verified providers (bbb) — give partial credit.
    score += 3;
  }

  // Corroboration across independent sources.
  if (corroborated && corroborationReasons.some((r) => r.includes("phone"))) {
    score += 2;
  } else if (corroborated) {
    score += 1;
  }

  // Email tiering.
  if (emailPath?.source === "hunter" && emailType === "person_email") score += 1.5;
  else if (emailType === "person_email") score += 1;
  else if (emailPath) score += 0.5;

  // Contact name available.
  if (contactName) score += 0.5;

  // Completeness floor.
  if (completeness === "COMPLETE" || completeness === "STRONG") score += 1;

  score = Math.round(Math.min(10, score) * 10) / 10;
  const label: "Elite Contact" | "Strong Contact" | "Usable Contact" | "Weak Contact" =
    score >= 9 ? "Elite Contact"
    : score >= 7 ? "Strong Contact"
    : score >= 5 ? "Usable Contact"
    : "Weak Contact";
  return { score, label };
}

// Heuristic: does a candidate "name" field actually describe a person, or
// is it the business entity? Names matching GENERIC_SUFFIXES (LLC, Inc, …)
// or typical business-sounding tokens (Roofing, Solutions, Services, etc.)
// are treated as entities. Keeps business entity names out of the
// person-facing `contactName` slot.
const BUSINESS_NAME_TOKENS = /(\b(llc|l\.?l\.?c\.?|inc\.?|incorporated|co\.?|company|corp\.?|corporation|ltd\.?|limited|pllc|lp|llp|group|solutions|services|systems|roofing|construction|contractors?|exteriors?|restoration)\b)/i;

function looksLikeBusinessEntity(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = String(name).trim();
  if (!n) return false;
  if (BUSINESS_NAME_TOKENS.test(n)) return true;
  // A name with >=4 tokens and no obvious person-name feel is likely a
  // business ("Apex Roofing and Restoration of Kansas City").
  const tokens = n.split(/\s+/);
  if (tokens.length >= 4) return true;
  return false;
}

// Deterministic no-email explanation. Called by enrichResolution when the
// primary result has no email. Sourced entirely from existing fields.
function computeNoEmailReason(
  input: BusinessInput,
  paths: ContactPath[],
  scored: MatchedCandidate[],
  domainMismatchDropped: boolean,
): NonNullable<ContactResolution["noEmailReason"]> {
  // Strongest signal first — mismatch blocks trump all other reasons.
  if (domainMismatchDropped) return "domain_mismatch_blocked_email";
  // Did the inspector confirm the homepage itself was unreachable?
  const hasHomepageFetch = input.website !== undefined;
  if (hasHomepageFetch && (input.siteEmails?.length ?? 0) === 0 && !input.phone && !input.hasContactForm) {
    // Site was checked but nothing landed — treat as unreachable when the
    // site fetch itself failed upstream. Callers that pass website=url
    // without any other site signals usually got an unreachable page.
    return "website_unreachable";
  }
  // Contact page found but no email on it — we know this when a form
  // exists (implies we reached a contact page) but no emails turned up.
  if (input.hasContactForm && (input.siteEmails?.length ?? 0) === 0) {
    return "contact_page_found_no_email";
  }
  const hasForm = paths.some((p) => p.method === "form");
  if (hasForm) return "contact_form_only";
  if (!input.website) return "no_website_no_email";
  // Any provider candidate matched? If yes but no email, say so specifically.
  if (scored.length > 0 && input.website && !input.email) return "no_provider_email_found";
  if (input.website && !input.email) return "no_email_found_on_site";
  return "no_provider_email_found";
}

// Best reachable outreach path. Summarizes the single strongest route —
// not a list, a single label the operator can act on immediately.
function computeBestReachable(
  paths: ContactPath[],
  emailType: EmailType,
  fallbackUrl: string | null,
): {
  path:
    | "Verified phone"
    | "Unverified phone"
    | "Person email"
    | "Generic inbox"
    | "Contact form"
    | "Website only"
    | "Listing only"
    | "None";
  reason: string;
} {
  const phonePath = paths.find((p) => p.method === "phone");
  const emailPath = paths.find((p) => p.method === "email");
  const formPath = paths.find((p) => p.method === "form");
  const sitePath = paths.find((p) => p.method === "website");
  const socialPath = paths.find((p) => p.method === "social");

  if (phonePath?.verified) {
    return { path: "Verified phone", reason: `${phonePath.label ?? phonePath.source} phone verified.` };
  }
  if (phonePath) {
    return { path: "Unverified phone", reason: `Phone on file via ${phonePath.label ?? phonePath.source} (unverified).` };
  }
  if (emailPath) {
    if (emailType === "person_email") {
      return { path: "Person email", reason: `${emailPath.label ?? emailPath.source}` };
    }
    if (emailType === "generic_inbox") {
      return { path: "Generic inbox", reason: `${emailPath.label ?? emailPath.source}` };
    }
    return { path: "Person email", reason: `${emailPath.label ?? emailPath.source}` };
  }
  if (formPath) {
    return { path: "Contact form", reason: "Contact form detected on site." };
  }
  if (sitePath) {
    return { path: "Website only", reason: "Only a website URL is on file." };
  }
  if (socialPath || fallbackUrl) {
    return { path: "Listing only", reason: socialPath ? "Only a social/listing page is available." : "Only a fallback listing is available." };
  }
  return { path: "None", reason: "No reachable contact path found." };
}

// Deterministic "who to ask for" string(s). Three honest states:
//   1) a real person name is on file → ask for them and only them
//   2) we matched a business but have no person → "no direct contact found"
//   3) we have neither → a single concise default
function buildAskFor(
  contactName?: string,
  contactRole?: string,
  hasBusinessMatch?: boolean,
): string[] {
  if (contactName) {
    const roleSuffix = contactRole ? ` (${contactRole})` : "";
    return [`Ask for: ${contactName}${roleSuffix}`];
  }
  if (hasBusinessMatch) {
    // Matched a real business but no person on file. LaborTech's target
    // voices at a roofing company: owner first, then office manager or
    // whoever handles marketing / the website.
    return ["No direct contact found — ask for Owner, Office Manager, or whoever handles the website."];
  }
  return ["Ask for: Owner or Office Manager"];
}

// Source-level confidence for the primary of each kind.
function pathConfidences(paths: ContactPath[]): {
  phoneConfidence?: ContactConfidence;
  emailConfidence?: ContactConfidence;
  fallbackConfidence?: ContactConfidence;
} {
  const phonePath = paths.find((p) => p.method === "phone");
  const emailPath = paths.find((p) => p.method === "email");
  const fallbackPath = paths.find((p) => p.method === "form" || p.method === "website" || p.method === "social");
  return {
    phoneConfidence: phonePath?.confidence,
    emailConfidence: emailPath?.confidence,
    fallbackConfidence: fallbackPath?.confidence,
  };
}

// Per-source timestamps. Sources that returned a candidate in this run are
// timestamped `now`. Not stored if the provider did not participate.
function buildTimestamps(
  scored: MatchedCandidate[],
  now: string,
  websiteCheckedAt: string | undefined,
): PerSourceTimestamps {
  const out: PerSourceTimestamps = {};
  if (scored.some((c) => c.source === "google_places")) out.googleVerifiedAt = now;
  if (scored.some((c) => c.source === "yelp")) out.yelpCheckedAt = now;
  if (scored.some((c) => c.source === "bbb")) out.bbbCheckedAt = now;
  if (scored.some((c) => c.source === "facebook")) out.facebookCheckedAt = now;
  if (scored.some((c) => c.source === "hunter")) out.hunterCheckedAt = now;
  if (websiteCheckedAt) out.websiteCheckedAt = websiteCheckedAt;
  return out;
}

// Applies all of the new fields to any already-built ContactResolution.
// Keeps per-branch logic simple: branches construct the core, this adds
// the Phase-6 intelligence layer in one place.
function enrichResolution(
  r: ContactResolution,
  opts: {
    scored: MatchedCandidate[];
    input: BusinessInput;
    identity: ReturnType<typeof normalizeIdentity>;
    now: string;
  },
): ContactResolution {
  const { scored, input, identity, now } = opts;
  const pc = pathConfidences(r.paths);
  const phoneConfidence = pc.phoneConfidence;
  let emailConfidence = pc.emailConfidence;
  const fallbackConfidence = pc.fallbackConfidence;
  const { corroborated, reasons: corroborationReasons } = computeCorroboration(scored, input, identity);

  // Email type: Hunter explicitly labels via `contactName`-present heuristic.
  const hunterCandidate = scored.find((c) => c.source === "hunter" && c.email === r.email);
  const hint = hunterCandidate
    ? (hunterCandidate.contactName ? "personal" : "generic")
    : undefined;
  const primaryEmailType = classifyEmail(r.email, hint);

  // Domain trust — if the primary email domain does not match the business
  // website domain, downgrade email confidence and flag the mismatch.
  const primaryEmailDomain = emailDomain(r.email);
  const emailDomainMismatch =
    !!primaryEmailDomain && !!identity.domain && primaryEmailDomain !== identity.domain;
  if (emailDomainMismatch) {
    emailConfidence = "low";
  }

  const { level: contactCompleteness, reason: contactCompletenessReason } = computeCompleteness(
    r.paths, r.phone, r.email, r.fallbackUrl, corroborated,
  );

  const { action: bestNextAction, reason: bestNextActionReason } = deriveBestNextAction(r.paths, primaryEmailType);

  const primaryContactReason = buildPrimaryContactReason(
    r.paths, corroborated, corroborationReasons, r.phone, r.email, primaryEmailType,
  );

  // Business vs contact name split — resolver's existing `matchedName` is
  // the business entity; surface person-level name from Hunter separately
  // when available. Defensive check: if the provider-returned "person"
  // name actually matches the business entity (or looks business-y), drop
  // it so the UI falls back to the default ask-for list.
  const personCandidate = scored.find((c) => !!c.contactName);
  let contactName = personCandidate?.contactName ?? undefined;
  const businessName = r.matchedName ?? scored[0]?.name ?? undefined;
  if (contactName && looksLikeBusinessEntity(contactName)) contactName = undefined;
  if (contactName && businessName && contactName.toLowerCase().trim() === businessName.toLowerCase().trim()) {
    contactName = undefined;
  }
  const contactRole = contactName ? personCandidate?.contactPosition ?? undefined : undefined;

  const nameConfidence: ContactConfidence | undefined =
    contactName
      ? (personCandidate?.source === "hunter" ? "medium" : "low")
      : businessName ? "medium" : undefined;

  // Reachability summary + no-email explanation.
  const { path: bestReachablePath, reason: bestReachablePathReason } =
    computeBestReachable(r.paths, primaryEmailType, r.fallbackUrl);
  const noEmailReason = r.email
    ? undefined
    : computeNoEmailReason(input, r.paths, scored, emailDomainMismatch);

  // emailMethod — classify how we got the primary email. Walks the ranked
  // paths[] and returns the provenance of the matching email, or
  // "unresolved" when there is none.
  const emailMethod: ContactResolution["emailMethod"] = (() => {
    if (!r.email) return "unresolved";
    const emailLc = r.email.toLowerCase();
    const path = r.paths.find((p) => p.method === "email" && p.value.toLowerCase() === emailLc);
    if (!path) return "unresolved";
    if (path.source === "hunter") {
      const hc = scored.find((c) => c.source === "hunter" && c.email?.toLowerCase() === emailLc);
      return (hc?.providerConfidence ?? 0) >= 85 ? "provider_verified" : "provider_observed";
    }
    if (path.source === "website") {
      // Map the path label back to the SiteEmailObservation method when
      // we have site hit details, else fall back to visible.
      const obs = (input.siteEmails ?? []).find((s) => s.email.toLowerCase() === emailLc);
      if (obs) return obs.method;
      return "website_visible";
    }
    if (path.source === "scrape") return "website_visible";
    return "fallback_listing";
  })();

  const websiteCheckedAt = input.website ? now : undefined;
  const timestamps = buildTimestamps(scored, now, websiteCheckedAt);

  const { score: contactQualityScore, label: contactQualityLabel } = computeContactQuality(
    r.paths, corroborated, corroborationReasons, primaryEmailType, contactCompleteness, contactName,
  );
  const hasBusinessMatch = !!businessName || scored.length > 0;
  const askFor = buildAskFor(contactName, contactRole, hasBusinessMatch);

  // Match type — deterministic. "exact" when a provider-verified candidate
  // agreed on name+location strongly (i.e. at least one scored candidate
  // passed the match threshold AND supplied a phone or domain). "closest"
  // when we only have a near-miss path (source: scrape or fallback-only).
  // "unresolved" when no business identity came back at all.
  let matchType: "exact" | "closest" | "unresolved";
  if (scored.length === 0 && !businessName) matchType = "unresolved";
  else if (scored.some((c) => c.source !== "hunter" && c.source !== "scrape" && (!!c.phone || !!c.website))) {
    matchType = "exact";
  } else matchType = "closest";

  // Matched domain — prefer a scored candidate's website; fall back to the
  // input.website we were called with.
  const matchedDomainRaw = scored.find((c) => !!c.website)?.website ?? input.website ?? undefined;
  const matchedDomain = matchedDomainRaw
    ? String(matchedDomainRaw).replace(/^https?:\/\//i, "").replace(/\/$/, "")
    : undefined;

  // Alternates — every extra phone/email across paths, minus the primary.
  const primaryPhoneLc = String(r.phone ?? "").toLowerCase();
  const primaryEmailLc = String(r.email ?? "").toLowerCase();
  const altPhoneSet = new Set<string>();
  const altEmailSet = new Set<string>();
  for (const p of r.paths) {
    if (p.method === "phone" && String(p.value).toLowerCase() !== primaryPhoneLc) {
      altPhoneSet.add(p.value);
    }
    if (p.method === "email" && String(p.value).toLowerCase() !== primaryEmailLc) {
      altEmailSet.add(p.value);
    }
  }
  const alternatePhones = Array.from(altPhoneSet);
  const alternateEmails = Array.from(altEmailSet);

  return {
    ...r,
    phoneConfidence,
    emailConfidence,
    fallbackConfidence,
    nameConfidence,
    corroborated,
    corroborationReasons: corroborationReasons.length > 0 ? corroborationReasons : undefined,
    primaryEmailType,
    bestNextAction,
    bestNextActionReason,
    contactCompleteness,
    contactCompletenessReason,
    primaryContactReason,
    businessName,
    contactName,
    contactRole,
    timestamps,
    contactQualityScore,
    contactQualityLabel,
    askFor,
    bestReachablePath,
    bestReachablePathReason,
    noEmailReason,
    emailDomainMismatch: emailDomainMismatch ? true : undefined,
    emailMethod,
    matchType,
    matchedDomain,
    alternatePhones: alternatePhones.length > 0 ? alternatePhones : undefined,
    alternateEmails: alternateEmails.length > 0 ? alternateEmails : undefined,
  };
}

export async function resolveContact(input: BusinessInput): Promise<ContactResolution> {
  const identity = normalizeIdentity(input);
  const now = new Date().toISOString();
  const checkedSources: ContactSource[] = [];
  const skippedSources = providerSkipReasons();

  const settled = await Promise.allSettled(ADAPTERS.map((a) => a.fn(identity)));

  const allCandidates: ContactCandidate[] = [];
  settled.forEach((s, i) => {
    checkedSources.push(ADAPTERS[i].key);
    if (s.status === "fulfilled") allCandidates.push(...s.value);
  });

  // Closure that threads the new per-source confidences / corroboration /
  // completeness / best-next-action / primary-reason / per-source
  // timestamps onto any branch's ContactResolution. Keeps per-branch logic
  // unchanged; enrichment happens in one place.
  const enrich = (r: ContactResolution, scoredForEnrich: MatchedCandidate[] = []) =>
    enrichResolution(r, { scored: scoredForEnrich, input, identity, now });

  if (allCandidates.length === 0) {
    // Nothing came back from any provider. If site-extracted phone/email
    // signals were passed in, they become the primary result (still
    // unverified). Otherwise emit the best fallback from input signals.
    const paths = buildContactPaths([], input);
    if (input.phone) {
      return enrich({
        phone: input.phone,
        email: input.email ?? null,
        fallbackRoute: null,
        fallbackUrl: input.website ?? null,
        source: "scrape",
        confidence: "medium",
        checkedSources,
        lastCheckedAt: now,
        summary: "found",
        paths,
        detail: "site_phone_found_unverified",
        skippedSources,
      });
    }
    if (input.website) {
      return enrich({
        phone: null,
        email: input.email ?? null,
        fallbackRoute: "contact_page",
        fallbackUrl: input.website,
        source: "scrape",
        confidence: "low",
        checkedSources,
        lastCheckedAt: now,
        summary: "fallback",
        paths,
        detail: skippedSources.length > 0 ? `no_provider_match_contact_page_only (${skippedSources.join(",")})` : "contact_page_only",
        skippedSources,
      });
    }
    return enrich(emptyResult(checkedSources, now, paths, skippedSources,
      skippedSources.length === ADAPTERS.length
        ? "all_providers_skipped_no_keys"
        : "no_candidates_from_any_provider"
    ));
  }

  const allScored = allCandidates
    .map((c) => ({ ...c, score: scoreCandidate(c, identity) }))
    .sort((a, b) => b.score.total - a.score.total);

  // Primary filter: composite ≥ MATCH_THRESHOLD (0.60).
  // Secondary acceptance: composite below threshold but name similarity and
  // location are both strong AND the candidate has a phone — the "best
  // valid match" rule. Keeps unrelated businesses out while rescuing
  // close-but-imperfect name matches.
  const scored: MatchedCandidate[] = allScored.filter((c) => {
    if (c.score.total >= MATCH_THRESHOLD) return true;
    if (
      c.score.name >= MIN_NAME_SIM_FOR_BYPASS &&
      c.score.location >= MIN_LOCATION_FOR_BYPASS &&
      !!c.phone
    ) {
      return true;
    }
    return false;
  });

  const paths = buildContactPaths(scored, input);

  if (scored.length === 0) {
    // We got candidates but nothing clears the name/location threshold.
    // Still return the closest one's fallback URL if we have one so the
    // operator can verify manually instead of seeing a dead-end.
    const nearMiss = allCandidates
      .map((c) => ({ ...c, score: scoreCandidate(c, identity) }))
      .sort((a, b) => b.score.total - a.score.total)[0];
    if (nearMiss?.fallbackUrl) {
      const nearMissPaths = buildContactPaths([{ ...nearMiss }], input);
      return enrich({
        phone: null,
        email: null,
        fallbackRoute: nearMiss.source === "facebook" ? "facebook" : "contact_page",
        fallbackUrl: nearMiss.fallbackUrl,
        source: nearMiss.source,
        confidence: "low",
        checkedSources,
        matchedName: nearMiss.name,
        lastCheckedAt: now,
        summary: "fallback",
        paths: nearMissPaths,
        detail: `near_miss_match_${nearMiss.source}`,
        skippedSources,
      }, [{ ...nearMiss }]);
    }
    return enrich(emptyResult(checkedSources, now, paths, skippedSources, "no_threshold_match"));
  }

  // Best email available across scored candidates (Hunter first because it
  // has the lowest rank among email-producing sources). Also tracks the
  // person-level contact name if Hunter surfaced one.
  const emailCandidate = scored.find((c) => !!c.email);
  const bestEmail = emailCandidate?.email
    ?? (input as BusinessInput & { email?: string }).email
    ?? null;
  const hunterPersonName = emailCandidate?.contactName ?? undefined;

  // Phone preference: first top-scored candidate with a phone.
  const withPhone = scored.find((c) => !!c.phone);

  if (withPhone) {
    const confidence = sourceConfidence(withPhone.source);
    return enrich({
      phone: withPhone.phone ?? null,
      email: bestEmail,
      fallbackRoute: null,
      fallbackUrl: withPhone.website ?? null,
      source: withPhone.source,
      confidence,
      checkedSources,
      matchedName: withPhone.name,
      matchedAddress: withPhone.address,
      rating: withPhone.rating,
      reviewCount: withPhone.reviewCount,
      lastCheckedAt: now,
      summary: "found",
      paths,
      detail: bestEmail
        ? `verified_phone_found_${withPhone.source}_with_email`
        : `verified_phone_found_${withPhone.source}`,
      skippedSources,
    }, scored);
  }

  // No provider phone. If the live site scan captured a phone, treat that as
  // the primary (flagged verified=false so downstream knows it was scraped).
  if (input.phone) {
    return enrich({
      phone: input.phone,
      email: bestEmail,
      fallbackRoute: null,
      fallbackUrl: input.website ?? null,
      source: "scrape",
      confidence: "medium",
      checkedSources,
      matchedName: hunterPersonName ?? scored[0]?.name,
      lastCheckedAt: now,
      summary: "found",
      paths,
      detail: "site_phone_found_unverified",
      skippedSources,
    }, scored);
  }

  // No phone of any kind. If a provider email is available (Hunter), emit
  // an email-only "found" result so the UI shows a real reachable contact
  // instead of a vague fallback.
  if (emailCandidate && emailCandidate.email) {
    const pc = emailCandidate.providerConfidence ?? 0;
    const conf: ContactConfidence = emailCandidate.source === "hunter"
      ? (pc >= 85 ? "high" : pc >= 60 ? "medium" : "low")
      : "medium";
    return enrich({
      phone: null,
      email: emailCandidate.email,
      fallbackRoute: input.website ? "contact_page" : null,
      fallbackUrl: input.website ?? null,
      source: emailCandidate.source,
      confidence: conf,
      checkedSources,
      matchedName: hunterPersonName ?? emailCandidate.name,
      lastCheckedAt: now,
      summary: "found",
      paths,
      detail: emailCandidate.source === "hunter"
        ? "hunter_email_found"
        : "website_email_found",
      skippedSources,
    }, scored);
  }

  // If only a site-scraped email is available (no provider hit, no phone).
  if ((input as BusinessInput & { email?: string }).email) {
    const siteEmail = (input as BusinessInput & { email?: string }).email!;
    return enrich({
      phone: null,
      email: siteEmail,
      fallbackRoute: input.website ? "contact_page" : null,
      fallbackUrl: input.website ?? null,
      source: "scrape",
      confidence: "low",
      checkedSources,
      matchedName: scored[0]?.name,
      lastCheckedAt: now,
      summary: "found",
      paths,
      detail: "website_email_found",
      skippedSources,
    }, scored);
  }

  // No phone, no email anywhere. Prefer Facebook fallback (Messenger is
  // actionable), then any candidate with a fallback URL (contact page).
  const fb = scored.find((c) => c.source === "facebook" && !!c.fallbackUrl);
  if (fb) {
    return enrich({
      phone: null,
      email: (input as BusinessInput & { email?: string }).email ?? null,
      fallbackRoute: "facebook",
      fallbackUrl: fb.fallbackUrl ?? null,
      source: "facebook",
      confidence: "medium",
      checkedSources,
      matchedName: fb.name,
      lastCheckedAt: now,
      summary: "fallback",
      paths,
      detail: "facebook_page_only",
      skippedSources,
    }, scored);
  }

  const site = scored.find((c) => !!c.website);
  if (site?.website) {
    return enrich({
      phone: null,
      email: bestEmail,
      fallbackRoute: "contact_page",
      fallbackUrl: site.website,
      source: site.source,
      confidence: "low",
      checkedSources,
      matchedName: hunterPersonName ?? site.name,
      lastCheckedAt: now,
      summary: "fallback",
      paths,
      detail: "contact_page_only",
      skippedSources,
    }, scored);
  }

  return enrich(emptyResult(checkedSources, now, paths, skippedSources, "no_direct_contact_found"), scored);
}

function emptyResult(
  checkedSources: ContactSource[],
  now: string,
  paths: ContactPath[] = [],
  skippedSources: string[] = [],
  detail?: string,
): ContactResolution {
  return {
    phone: null,
    email: null,
    fallbackRoute: null,
    fallbackUrl: null,
    source: "none",
    confidence: "none",
    checkedSources,
    lastCheckedAt: now,
    summary: "empty",
    paths,
    detail,
    skippedSources,
  };
}
