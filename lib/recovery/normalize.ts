// Meridian — Recovery Brief raw-export normalization.
//
// Accepts a single CSV row (already parsed to {header: value}) and resolves
// a set of logical fields the generator cares about by matching common CRM
// column aliases (HubSpot, Pipedrive, Salesforce, Close, Copper, etc.).
//
// Hardened for ugly real-world data:
//   - case-insensitive, whitespace/punctuation-tolerant header matching
//   - null-like values ("N/A", "TBD", "—", "null", etc.) collapse to null
//   - duplicate aliases pick the first non-null value found
//   - merged "Name, Title" contact fields split into name + title
//   - partial / clearly-fake phone numbers reject to null
//   - multi-format date parsing returns ISO or null (never invents)
//   - malformed booleans degrade to null instead of guessing
//
// No external APIs. No AI. Deterministic.

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
  lastContactedAt: string | null;       // ISO date string or null
  lastActivityAt: string | null;        // ISO date string or null
  lastNote: string | null;
  nextStep: string | null;
  status: string | null;
  lifecycleStage: string | null;
  dealStage: string | null;
  recentActivity: boolean | null;
  owner: string | null;
  source: string | null;
  industry: string | null;
  // Optional founder-authored boosts. Honored when present so internal
  // samples can override engine output. The engine must produce strong
  // language without them.
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
    "direct phone", "office phone", "phone1", "tel", "telephone",
  ],
  email: [
    "email", "email address", "emailaddress", "primary email", "primaryemail",
    "contact email", "work email", "business email", "e-mail",
  ],
  city: ["city", "town", "locality"],
  state: ["state", "region", "province", "state / province"],
  location: ["location", "address", "full address", "city state", "city, state"],
  website: ["website", "domain", "url", "company website", "homepage", "site"],
  lastContactedAt: [
    "lastcontactedat", "last contacted", "last contacted at", "last contact",
    "last contact date", "last touch", "last touch at", "last touched",
    "last interaction", "last meeting", "last email sent", "last call",
    "last outreach", "lasttouchdate", "last contacted (date)",
  ],
  lastActivityAt: [
    "lastactivityat", "last activity", "last activity at", "last activity date",
    "last engagement", "lastengagement", "last engaged", "last engagement date",
    "last seen", "last_activity_date",
  ],
  lastNote: [
    "lastnote", "last note", "latest note", "notes", "note", "sales note",
    "salesnote", "contact notes", "summary", "recent note", "last comment",
    "comments", "internal note", "internal notes", "notes/comments",
  ],
  nextStep: [
    "nextstep", "next step", "next steps", "next action", "nextaction",
    "action item", "todo", "to do", "to-do", "follow up", "followup",
    "next followup",
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
    "rep", "sales rep", "salesrep", "account manager", "assigned rep",
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

// ── Null-like value detection ─────────────────────────────────────────
// Operators paste these into CRMs all the time. Treat as missing.
const NULL_LIKE = new Set([
  "", "-", "—", "–", "n/a", "na", "null", "none", "nil", "tbd", "tba",
  "unknown", "?", "??", ".", "..", "...", "(blank)", "<blank>", "<null>",
  "no value", "n.a.", "n/a.",
]);

function isNullLike(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const lower = value.trim().toLowerCase();
  return NULL_LIKE.has(lower);
}

// Collapse weird whitespace (tabs, newlines, double-spaces) to single space
// and trim. Returns null for null-like input.
export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = String(value)
    .replace(/[ \t\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (isNullLike(collapsed)) return null;
  return collapsed;
}

// Header canonicalization: lowercase, strip non-alphanumeric except spaces,
// collapse spaces.
function canonicalKey(value: string): string {
  return value.toLowerCase().replace(/[\s_\-/]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
}

function indexRow(row: RawCsvRow): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue;
    const cleaned = cleanText(value);
    if (cleaned === null) continue;
    const canonical = canonicalKey(key);
    if (canonical && !out.has(canonical)) out.set(canonical, cleaned);
    const nospace = canonical.replace(/\s+/g, "");
    if (nospace && !out.has(nospace)) out.set(nospace, cleaned);
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

// ── Boolean parsing ───────────────────────────────────────────────────
const TRUTHY = new Set(["true", "yes", "y", "1", "active", "t", "yep", "yeah", "yes please"]);
const FALSY = new Set(["false", "no", "n", "0", "inactive", "f", "nope"]);

function pickBoolean(indexed: Map<string, string>, aliases: readonly string[]): boolean | null {
  const raw = pickString(indexed, aliases);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  return null; // malformed booleans degrade to null, not a guess
}

// ── Date parsing ─────────────────────────────────────────────────────
// Accepts:
//   - ISO 8601 (2026-01-15, 2026-01-15T...)
//   - M/D/YYYY, MM/DD/YYYY
//   - YYYY/MM/DD
//   - "Jan 15 2026", "January 15, 2026"
// Rejects vague tokens like "Q1 2026", "last week", "Jan", etc. — we will
// not invent precision from imprecise input.
export function parseDateLenient(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Reject obvious imprecise tokens.
  if (/^q[1-4]\b/i.test(trimmed)) return null;
  if (/^(this|last|next)\s/i.test(trimmed)) return null;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.test(trimmed)) return null;

  // Try native Date parse last; first try a few common forms.
  // M/D/YYYY or MM/DD/YYYY
  const mdy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(trimmed);
  if (mdy) {
    const [, mStr, dStr, yStr] = mdy;
    const month = Number(mStr);
    const day = Number(dStr);
    let year = Number(yStr);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    // Sanity-clamp wildly out-of-range parses.
    const year = direct.getUTCFullYear();
    if (year >= 2000 && year <= 2099) return direct.toISOString();
  }
  return null;
}

// ── Phone hardening ──────────────────────────────────────────────────
// CRM exports often contain partial numbers ("(816) 555"), area-code-only
// strings ("+1"), or 555-01XX reserved fictional numbers. We reject these
// at the boundary so they never reach the operator's dial button.
function sanitizePhone(raw: string | null): string | null {
  if (raw === null) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 10) return null;
  // North American Numbering Plan 555-01XX is reserved for fiction.
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10 && national.slice(3, 6) === "555" && national.slice(6, 8) === "01") {
    return null;
  }
  return raw.trim();
}

// ── Contact name + title split ───────────────────────────────────────
// Operators sometimes paste "Sarah Chen, COO" or "Sarah Chen (COO)" into a
// single Contact field. Split into name + title without inventing either.
function splitContactNameTitle(raw: string | null): { name: string | null; title: string | null } {
  if (raw === null) return { name: null, title: null };
  // "Sarah Chen, COO" or "Sarah Chen - COO" or "Sarah Chen (COO)"
  const commaMatch = /^([^,]+?)\s*[,\-–—]\s*(.+)$/.exec(raw);
  const parenMatch = /^([^(]+?)\s*\(([^)]+)\)\s*$/.exec(raw);
  if (parenMatch) {
    return { name: parenMatch[1].trim() || null, title: parenMatch[2].trim() || null };
  }
  if (commaMatch && !/\d/.test(commaMatch[2])) {
    return { name: commaMatch[1].trim() || null, title: commaMatch[2].trim() || null };
  }
  return { name: raw, title: null };
}

export function normalizeExportRow(row: RawCsvRow): NormalizedExportRow {
  const indexed = indexRow(row);

  const city = pickString(indexed, ALIASES.city);
  const state = pickString(indexed, ALIASES.state);
  const explicitLocation = pickString(indexed, ALIASES.location);
  const composedLocation = [city, state].filter(Boolean).join(", ") || null;

  const rawContact = pickString(indexed, ALIASES.contactName);
  const { name: splitName, title: splitTitle } = splitContactNameTitle(rawContact);
  const explicitTitle = pickString(indexed, ALIASES.contactTitle);

  return {
    companyName: pickString(indexed, ALIASES.companyName),
    contactName: splitName,
    contactTitle: explicitTitle ?? splitTitle,
    phone: sanitizePhone(pickString(indexed, ALIASES.phone)),
    email: pickString(indexed, ALIASES.email),
    city,
    state,
    location: explicitLocation ?? composedLocation,
    website: pickString(indexed, ALIASES.website),
    lastContactedAt: parseDateLenient(pickString(indexed, ALIASES.lastContactedAt)),
    lastActivityAt: parseDateLenient(pickString(indexed, ALIASES.lastActivityAt)),
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

// ── Data-quality classification ──────────────────────────────────────
// The generator behaves differently per tier. HIGH = lean into specifics.
// LOW = stay conservative, narrow, exploratory; never invent context.
export type DataQuality = "high" | "medium" | "low";

// Vague-note detection: notes like "followed up", "left voicemail",
// "no response", "." — technically non-null, carry no information.
// Exported so generators can drop them before quoting back to the operator.
const VAGUE_NOTE_PATTERNS = [
  /^followed up$/i, /^follow up$/i, /^left voicemail$/i, /^left vm$/i,
  /^vm$/i, /^no response$/i, /^no reply$/i, /^reached out$/i,
  /^touched base$/i, /^pinged$/i, /^chasing$/i, /^\.+$/, /^,+$/,
  /^see notes$/i, /^see crm$/i, /^na$/i, /^n\/a$/i, /^tbd$/i,
  /^reached out,? left vm$/i, /^reached out,? left voicemail$/i,
  /^no notes( on file)?$/i,
];

export function isVagueNote(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return VAGUE_NOTE_PATTERNS.some((r) => r.test(trimmed));
}

export function classifyDataQuality(row: NormalizedExportRow): DataQuality {
  const hasNote = !!row.lastNote && row.lastNote.length >= 10 && !isVagueNote(row.lastNote);
  const hasNextStep = !!row.nextStep && row.nextStep.length >= 6 && !isVagueNote(row.nextStep);
  const hasStage = !!(row.status || row.dealStage || row.lifecycleStage);
  const hasLastContact = !!row.lastContactedAt;
  const hasContactPath = !!(row.phone || row.email);

  if (hasNote || hasNextStep) return "high";
  if (hasStage && hasLastContact && hasContactPath) return "medium";
  if (hasContactPath || hasLastContact) return "medium";
  return "low";
}
