// Meridian — Recovery Brief raw-export normalization.

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
  activityLabel: string | null;
  opportunityLabel: string | null;
  priorityNote: string | null;
  suggestedOpener: string | null;
};

const ALIASES: Record<keyof NormalizedExportRow, readonly string[]> = {
  companyName: ["companyname", "company", "company name", "account", "account name", "accountname", "organization", "organization name", "org", "orgname", "business", "business name"],
  contactName: ["contactname", "contact", "contact name", "full name", "name", "primary contact", "primarycontact", "contact full name", "lead name", "person", "person name"],
  contactTitle: ["title", "job title", "jobtitle", "position", "role", "contact title"],
  phone: ["phone", "phone number", "phonenumber", "primary phone", "primaryphone", "mobile", "mobile phone", "work phone", "workphone", "contact phone", "direct phone", "office phone", "phone1", "tel", "telephone"],
  email: ["email", "email address", "emailaddress", "primary email", "primaryemail", "contact email", "work email", "business email", "e-mail"],
  city: ["city", "town", "locality"],
  state: ["state", "region", "province", "state / province"],
  location: ["location", "address", "full address", "city state", "city, state"],
  website: ["website", "domain", "url", "company website", "homepage", "site"],
  lastContactedAt: ["lastcontactedat", "last contacted", "last contacted at", "last contact", "last contact date", "last touch", "last touch at", "last touched", "last interaction", "last meeting", "last email sent", "last call", "last outreach", "lasttouchdate", "last contacted (date)"],
  lastActivityAt: ["lastactivityat", "last activity", "last activity at", "last activity date", "last engagement", "lastengagement", "last engaged", "last engagement date", "last seen", "last_activity_date"],
  lastNote: ["lastnote", "last note", "latest note", "notes", "note", "sales note", "salesnote", "contact notes", "summary", "recent note", "last comment", "comments", "internal note", "internal notes", "notes/comments"],
  nextStep: ["nextstep", "next step", "next steps", "next action", "nextaction", "action item", "todo", "to do", "to-do", "follow up", "followup", "next followup"],
  status: ["status", "account status", "contact status", "crm status", "crmstatus", "current status", "lead status", "leadstatus"],
  lifecycleStage: ["lifecycle stage", "lifecyclestage", "stage", "customer stage", "relationship stage", "account stage"],
  dealStage: ["deal stage", "dealstage", "opportunity stage", "opp stage", "pipeline stage", "deal status"],
  recentActivity: ["recentactivity", "recent activity", "recently active", "active", "is active", "currently active"],
  owner: ["owner", "owner name", "account owner", "assigned to", "assignedto", "rep", "sales rep", "salesrep", "account manager", "assigned rep"],
  source: ["source", "lead source", "leadsource", "origin", "acquisition source", "channel"],
  industry: ["industry", "sector", "vertical", "account industry", "category", "trade", "module", "business type"],
  activityLabel: ["activitylabel", "activity label", "activity reason"],
  opportunityLabel: ["opportunitylabel", "opportunity label", "opportunity"],
  priorityNote: ["prioritynote", "priority note", "priority"],
  suggestedOpener: ["suggestedopener", "suggested opener", "opener"],
};

const NULL_LIKE = new Set([
  "", "-", "—", "–", "n/a", "na", "null", "none", "nil", "tbd", "tba",
  "unknown", "?", "??", ".", "..", "...", "(blank)", "<blank>", "<null>",
  "no value", "n.a.", "n/a.",
]);

function isNullLike(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return NULL_LIKE.has(value.trim().toLowerCase());
}

export function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const collapsed = String(value).replace(/[ \t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (isNullLike(collapsed)) return null;
  return collapsed;
}

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

const TRUTHY = new Set(["true", "yes", "y", "1", "active", "t", "yep", "yeah", "yes please"]);
const FALSY = new Set(["false", "no", "n", "0", "inactive", "f", "nope"]);

function pickBoolean(indexed: Map<string, string>, aliases: readonly string[]): boolean | null {
  const raw = pickString(indexed, aliases);
  if (raw === null) return null;
  const lower = raw.toLowerCase();
  if (TRUTHY.has(lower)) return true;
  if (FALSY.has(lower)) return false;
  return null;
}

export function parseDateLenient(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^q[1-4]\b/i.test(trimmed)) return null;
  if (/^(this|last|next)\s/i.test(trimmed)) return null;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.test(trimmed)) return null;

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
    const year = direct.getUTCFullYear();
    if (year >= 2000 && year <= 2099) return direct.toISOString();
  }
  return null;
}

function sanitizePhone(raw: string | null): string | null {
  if (raw === null) return null;
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 10) return null;
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10 && national.slice(3, 6) === "555" && national.slice(6, 8) === "01") return null;
  return raw.trim();
}

function splitContactNameTitle(raw: string | null): { name: string | null; title: string | null } {
  if (raw === null) return { name: null, title: null };
  const parenMatch = /^([^(]+?)\s*\(([^)]+)\)\s*$/.exec(raw);
  if (parenMatch) return { name: parenMatch[1].trim() || null, title: parenMatch[2].trim() || null };
  const commaMatch = /^([^,]+?)\s*[,\-–—]\s*(.+)$/.exec(raw);
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
  if (/finance|hedge|private equity|private credit|asset management|bank/.test(lower)) return "fund-cycle hiring windows";
  if (/architecture|engineering|construction|aec/.test(lower)) return "project-mobilization windows";
  if (/biotech|pharma|life sciences|clinical/.test(lower)) return "trial and milestone windows";
  return null;
}

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

const META_NOTE_PATTERNS = [
  /^no\s+(specific\s+)?notes?\b/i,
  /^no\s+contact\s+named/i,
  /^no\s+(active\s+)?(activity|engagement|outreach|push|history)/i,
  /^was\s+sourced/i,
  /^older\s+than\s+most/i,
  /^was\s+previously\s+routed/i,
  /^account\s+was\s+reactivated\b/i,
  /^sourced\s+from\b/i,
  /^routed\s+through\b/i,
];

export function isMetaNote(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return META_NOTE_PATTERNS.some((r) => r.test(trimmed));
}

const LEADING_VERBS = new Set([
  "asked", "wanted", "requested", "paused", "mentioned", "spoke", "said",
  "talked", "agreed", "confirmed", "shared", "raised", "flagged",
  "expressed", "noted", "indicated", "pushed", "declined",
  "deferred", "delayed", "needed", "promised",
]);

export function leadsWithActionVerb(value: string | null | undefined): boolean {
  if (!value) return false;
  const first = value.trim().split(/\s+/)[0]?.toLowerCase().replace(/[.,;:!?]+$/, "");
  if (!first) return false;
  return LEADING_VERBS.has(first);
}

const THIRD_PERSON_TAIL = /\b(they|their|theirs|themselves|said they|wanted)\b/i;

export function containsThirdPersonTail(value: string | null | undefined): boolean {
  if (!value) return false;
  const tokens = value.trim().split(/\s+/);
  if (tokens.length < 4) return false;
  const tail = tokens.slice(1).join(" ");
  return THIRD_PERSON_TAIL.test(tail);
}

export function firstSentenceOf(value: string | null | undefined, maxChars = 90): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const sentenceEnd = trimmed.search(/[.!?](?:\s|$)/);
  let candidate = sentenceEnd >= 10 ? trimmed.slice(0, sentenceEnd) : trimmed;
  if (candidate.length > maxChars) {
    const cut = candidate.lastIndexOf(" ", maxChars);
    candidate = cut > 30 ? candidate.slice(0, cut) + "…" : candidate.slice(0, maxChars) + "…";
  }
  return candidate.replace(/[.,;:!?]+$/, "").trim() || null;
}

export type DataQuality = "high" | "medium" | "low";

export function classifyDataQuality(row: NormalizedExportRow): DataQuality {
  const noteUsable = !!row.lastNote && row.lastNote.length >= 10 && !isVagueNote(row.lastNote) && !isMetaNote(row.lastNote);
  const stepUsable = !!row.nextStep && row.nextStep.length >= 6 && !isVagueNote(row.nextStep) && !isMetaNote(row.nextStep);
  const hasStage = !!(row.status || row.dealStage || row.lifecycleStage);
  const hasLastContact = !!row.lastContactedAt;
  const hasContactPath = !!(row.phone || row.email);

  if (noteUsable || stepUsable) return "high";
  if (hasStage && hasLastContact && hasContactPath) return "medium";
  if (hasContactPath || hasLastContact) return "medium";
  return "low";
}
