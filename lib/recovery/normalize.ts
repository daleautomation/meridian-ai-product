// Meridian — Recovery Brief raw-export normalization.
//
// Accepts a single CSV row (already parsed to {header: value}) and resolves
// a set of logical fields the generator cares about by matching common CRM
// column aliases (HubSpot, Pipedrive, Salesforce, Close, Copper, etc.).
//
// No external APIs. No AI. Pure lookups.
//
// Header matching is case- and punctuation-insensitive: "Last Contacted",
// "last_contacted", "Last-Contacted" all collapse to the same key.

export type RawCsvRow = Record<string, string>;

export type NormalizedExportRow = {
  companyName: string | null;
  contactName: string | null;
  contactTitle: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  location: string | null;
  website: string | null;
  lastContactedAt: string | null;
  lastActivityAt: string | null;
  lastNote: string | null;
  nextStep: string | null;
  status: string | null;
  lifecycleStage: string | null;
  dealStage: string | null;
  recentActivity: boolean | null;
  owner: string | null;
  source: string | null;
  industry: string | null;
  // Optional founder-authored boosts. These are honored if present so
  // internal samples can override engine output, but the generator must
  // produce strong language without them.
  activityLabel: string | null;
  opportunityLabel: string | null;
  priorityNote: string | null;
  suggestedOpener: string | null;
};

const ALIASES: Record<keyof NormalizedExportRow, readonly string[]> = {
  companyName: [
    "companyname", "company", "company name", "account", "account name",
    "accountname", "organization", "organization name", "org", "orgname",
    "business", "business name",
  ],
  contactName: [
    "contactname", "contact", "contact name", "full name", "name",
    "primary contact", "primarycontact", "contact full name", "lead name",
    "person", "person name",
  ],
  contactTitle: [
    "title", "job title", "jobtitle", "position", "role", "contact title",
  ],
  phone: [
    "phone", "phone number", "phonenumber", "primary phone", "primaryphone",
    "mobile", "mobile phone", "work phone", "workphone", "contact phone",
    "direct phone", "office phone",
  ],
  email: [
    "email", "email address", "emailaddress", "primary email", "primaryemail",
    "contact email", "work email", "business email",
  ],
  city: ["city", "town", "locality"],
  state: ["state", "region", "province", "state / province"],
  location: ["location", "address", "full address", "city state", "city, state"],
  website: ["website", "domain", "url", "company website", "homepage", "site"],
  lastContactedAt: [
    "lastcontactedat", "last contacted", "last contacted at", "last contact",
    "last contact date", "last touch", "last touch at", "last touched",
    "last interaction", "last meeting", "last email sent", "last call",
    "last outreach", "lastoutreach", "lasttouchdate",
  ],
  lastActivityAt: [
    "lastactivityat", "last activity", "last activity at", "last activity date",
    "last engagement", "lastengagement", "last engaged", "last engagement date",
    "last seen", "last_activity_date",
  ],
  lastNote: [
    "lastnote", "last note", "latest note", "notes", "note", "sales note",
    "salesnote", "contact notes", "summary", "recent note", "last comment",
    "comments", "internal note", "internal notes",
  ],
  nextStep: [
    "nextstep", "next step", "next steps", "next action", "nextaction",
    "action item", "todo", "to do", "to-do", "follow up", "followup",
    "follow_up", "next followup",
  ],
  status: [
    "status", "account status", "contact status", "crm status", "crmstatus",
    "current status", "lead status", "leadstatus",
  ],
  lifecycleStage: [
    "lifecycle stage", "lifecyclestage", "stage", "customer stage",
    "relationship stage", "account stage",
  ],
  dealStage: [
    "deal stage", "dealstage", "opportunity stage", "opp stage",
    "pipeline stage", "deal status",
  ],
  recentActivity: [
    "recentactivity", "recent activity", "recently active", "active",
    "is active", "currently active",
  ],
  owner: [
    "owner", "owner name", "account owner", "assigned to", "assignedto",
    "rep", "sales rep", "salesrep", "account manager",
  ],
  source: [
    "source", "lead source", "leadsource", "origin", "acquisition source",
    "channel",
  ],
  industry: [
    "industry", "sector", "vertical", "account industry", "category",
    "trade", "module", "business type",
  ],
  activityLabel: ["activitylabel", "activity label", "activity reason"],
  opportunityLabel: ["opportunitylabel", "opportunity label", "opportunity"],
  priorityNote: ["prioritynote", "priority note", "priority"],
  suggestedOpener: ["suggestedopener", "suggested opener", "opener"],
};

function canonicalKey(value: string): string {
  return value.toLowerCase().replace(/[\s_\-/]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

function indexRow(row: RawCsvRow): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    const trimmed = String(value).trim();
    if (!trimmed) continue;
    out.set(canonicalKey(key), trimmed);
    // Also store a no-space variant so "Company Name" matches "companyname".
    out.set(canonicalKey(key).replace(/\s+/g, ""), trimmed);
  }
  return out;
}

function pickString(indexed: Map<string, string>, aliases: readonly string[]): string | null {
  for (const alias of aliases) {
    const canonical = canonicalKey(alias);
    const direct = indexed.get(canonical);
    if (direct) return direct;
    const nospace = indexed.get(canonical.replace(/\s+/g, ""));
    if (nospace) return nospace;
  }
  return null;
}

const TRUTHY = new Set(["true", "yes", "y", "1", "active", "t"]);
const FALSY = new Set(["false", "no", "n", "0", "inactive", "f", ""]);

function pickBoolean(indexed: Map<string, string>, aliases: readonly string[]): boolean | null {
  const raw = pickString(indexed, aliases);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  return null;
}

export function normalizeExportRow(row: RawCsvRow): NormalizedExportRow {
  const indexed = indexRow(row);

  const city = pickString(indexed, ALIASES.city);
  const state = pickString(indexed, ALIASES.state);
  const explicitLocation = pickString(indexed, ALIASES.location);
  const composedLocation = [city, state].filter(Boolean).join(", ") || null;

  return {
    companyName: pickString(indexed, ALIASES.companyName),
    contactName: pickString(indexed, ALIASES.contactName),
    contactTitle: pickString(indexed, ALIASES.contactTitle),
    phone: pickString(indexed, ALIASES.phone),
    email: pickString(indexed, ALIASES.email),
    city,
    state,
    location: explicitLocation ?? composedLocation,
    website: pickString(indexed, ALIASES.website),
    lastContactedAt: pickString(indexed, ALIASES.lastContactedAt),
    lastActivityAt: pickString(indexed, ALIASES.lastActivityAt),
    lastNote: pickString(indexed, ALIASES.lastNote),
    nextStep: pickString(indexed, ALIASES.nextStep),
    status: pickString(indexed, ALIASES.status),
    lifecycleStage: pickString(indexed, ALIASES.lifecycleStage),
    dealStage: pickString(indexed, ALIASES.dealStage),
    recentActivity: pickBoolean(indexed, ALIASES.recentActivity),
    owner: pickString(indexed, ALIASES.owner),
    source: pickString(indexed, ALIASES.source),
    industry: pickString(indexed, ALIASES.industry),
    activityLabel: pickString(indexed, ALIASES.activityLabel),
    opportunityLabel: pickString(indexed, ALIASES.opportunityLabel),
    priorityNote: pickString(indexed, ALIASES.priorityNote),
    suggestedOpener: pickString(indexed, ALIASES.suggestedOpener),
  };
}

// Detect timing/seasonal cues from an industry string. Lightweight — used
// by the why-now and opener generators to anchor language when nothing
// stronger is available. Returns null when the industry isn't recognized
// or carries no seasonal/timing signal.
export function timingCueForIndustry(industry: string | null | undefined): string | null {
  const lower = (industry ?? "").toLowerCase();
  if (!lower) return null;
  if (/hvac|heating|cooling|air condition/.test(lower)) return "cooling-season demand";
  if (/roof|exterior/.test(lower)) return "spring inspection demand";
  if (/recruit|staffing|talent|search|hiring/.test(lower)) return "active requisition windows";
  if (/logistic|freight|supply chain/.test(lower)) return "carrier capacity planning";
  if (/medical|health|clinic|billing/.test(lower)) return "payer-cycle deadlines";
  if (/facilit|maintenance|janit/.test(lower)) return "facility-renewal cycles";
  if (/advisor|consult|advisory/.test(lower)) return "Q-end planning cycles";
  if (/saas|software|tech/.test(lower)) return "renewal and pilot windows";
  if (/legal|law/.test(lower)) return "matter-intake windows";
  return null;
}
