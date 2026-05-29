// Meridian CRM import — column mapping and row normalization.

import { normalizePhoneForTrust } from "@/lib/contacts/trust";
import { buildDatumTrust } from "./trust";
import {
  CRM_IMPORT_FIELDS,
  type ColumnMapping,
  type CrmImportField,
  type NormalizedCrmContact,
} from "./types";

/**
 * Column alias table.
 *
 * Single-value fields (`name`, `address`) list ONLY full-value column
 * names. Component fields (`firstName`, `lastName`, `street`, etc.)
 * list the source columns whose contents need to be ASSEMBLED into the
 * canonical single-value field by `normalizeCrmRow`.
 *
 * The previous version of this table mixed both classes under `name`
 * (`["name", ..., "first name", "firstname", "last name", "lastname", ...]`)
 * and `address` (`["address", "street", ...]`). The first-match-wins
 * detection then claimed only the first component column it found
 * (typically "First Name" / "Home Street"), silently discarding the
 * remaining columns. The corpus audit on 2026-05-28 surfaced this:
 * 1/130 surnames and 7/130 canonical addresses across Nicole's
 * WiseAgent export.
 *
 * The fix is structural: separate the two classes, claim headers in
 * specificity order (components before generals), and assemble the
 * single-value field at normalization time.
 */
export const COLUMN_ALIASES: Record<CrmImportField, string[]> = {
  // ── Single-value name (used when CSV has a full-name column) ──
  // Intentionally NARROW — does NOT include first/last variants. Those
  // belong to firstName / lastName so the component pathway can fire.
  //
  // DO NOT add single-word generic aliases like "contact" or "person"
  // here. The matcher uses `header.key.includes(alias)`, so a one-word
  // alias matches any longer header that happens to contain it:
  //   • "contact" → captures "Contact Status" / "Contact Type" /
  //     "Contact Source" → assembled name short-circuits to the
  //     status / category value (e.g., "No Status") and firstName +
  //     lastName assembly never runs.
  //   • "person" → captures "Personal Email" / "Person Type".
  // Every alias here must be specific enough that it cannot be a
  // substring of an unrelated column header.
  name: [
    "name", "full name", "fullname", "contact name",
    "client name", "lead name", "primary contact", "display name",
  ],
  // ── Component names ──
  firstName: [
    "first name", "firstname", "given name", "fname",
  ],
  lastName: [
    "last name", "lastname", "surname", "family name", "lname",
  ],

  company: [
    "company", "organization", "org", "account", "account name", "business",
    "employer", "firm",
  ],
  phone: [
    "phone", "mobile", "cell", "telephone", "work phone", "primary phone",
    "phone number", "mobile phone", "contact phone", "cell phone", "mobile number",
    "primary phone number", "phone 1", "phone1", "home phone", "day phone",
    "evening phone", "main phone", "direct phone",
    "business phone", "office phone", "personal phone", "mobile 1", "mobile1",
    "phone (mobile)", "phone (home)", "phone (work)", "phone (primary)",
  ],
  email: [
    "email", "e-mail", "email address", "work email", "primary email",
    "personal email", "alternate email", "secondary email", "email 1", "email1",
    "primary email address", "personal email address", "work email address",
    "contact email",
  ],

  // ── Single-value address (used when CSV has a full-address column) ──
  // Intentionally NARROW — does NOT include "street" alone, since that
  // belongs to the street component.
  address: [
    "address", "full address", "mailing address", "home address", "location",
  ],
  // ── Component address fields ──
  street: [
    "street", "street address", "address line 1", "addr1",
    "home street", "street 1", "street1",
  ],
  unit: [
    "apt", "apartment", "unit", "suite", "address line 2", "addr2",
  ],
  city: [
    "city", "home city", "town",
  ],
  state: [
    "state", "home state", "province", "region",
  ],
  postalCode: [
    "zip", "zipcode", "zip code", "postal code", "postcode",
    "home postal code", "home zip", "home zip code",
  ],

  notes: [
    "notes", "note", "description", "comments", "memo",
    "details", "remarks", "summary", "contact notes", "agent notes",
  ],
  tags: [
    "tags", "tag", "labels", "categories", "segment",
    "groups", "group", "lists", "list", "type", "stage", "status",
  ],
  lastInteraction: [
    "last interaction", "last contact", "last activity", "last touch",
    "last contacted", "last seen", "last modified", "updated at",
    "last activity date", "last communication", "last touch date",
    "last contact date", "last email", "last call",
  ],
  sourceCrm: [
    "source", "crm", "source crm", "origin", "import source", "lead source",
  ],
};

function normalizeHeaderKey(header: string): string {
  return header.trim().replace(/^\uFEFF/, "").toLowerCase();
}

/**
 * Phone columns belonging to the CONTACT, in selection priority.
 *
 * Mobile/cell beats home beats work beats a generic "phone" column,
 * with free-text "extra phone numbers" as the last resort. This is the
 * fix for the WiseAgent regression: the contact's MOBILE number is the
 * reachable one (59/105 in Nicole's export) while HOME was almost always
 * blank (7/105). The previous detector claimed whichever phone header
 * appeared first in the CSV row \u2014 "Home Phone" \u2014 and stranded 56
 * reachable contacts.
 *
 * Spouse / fax / DNC columns are deliberately excluded: a spouse's
 * mobile is a different person, and fax/DNC are not call targets.
 */
const PHONE_PRIORITY: string[] = [
  "mobile phone", "cell phone", "mobile number", "mobile 1", "mobile1",
  "mobile", "cell", "phone (mobile)",
  "primary phone number", "primary phone", "phone (primary)",
  "home phone", "phone (home)",
  "work phone", "office phone", "business phone", "direct phone",
  "main phone", "day phone", "evening phone", "personal phone", "phone (work)",
  "telephone", "contact phone", "phone number", "phone 1", "phone1", "phone",
  "extra phone numbers",
];

const PHONE_EXCLUDE = /spouse|fax|dnc/;

/**
 * Return the contact's own phone headers from a header list, ordered by
 * selection priority (PHONE_PRIORITY). Spouse/fax/DNC excluded. Each
 * header appears once.
 */
function orderedPhoneHeaders(headers: string[]): string[] {
  const candidates = headers.map((raw) => ({ raw, key: normalizeHeaderKey(raw) }));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const alias of PHONE_PRIORITY) {
    for (const c of candidates) {
      if (seen.has(c.raw)) continue;
      if (PHONE_EXCLUDE.test(c.key)) continue;
      if (c.key === alias || c.key.includes(alias)) {
        picked.push(c.raw);
        seen.add(c.raw);
      }
    }
  }
  return picked;
}

/**
 * "Extra Phone Numbers" can hold several numbers and labels
 * (e.g. "816-555-0150 (work); 816-555-0151"). Take the first phone-like
 * run so multi-number free-text isn't digit-concatenated into a bogus
 * number by the downstream normalizer.
 */
function firstPhoneToken(value: string): string {
  const match = value.match(/[+(]?\d[\d().\-\s]{6,}\d/);
  return match ? match[0].trim() : value.trim();
}

/**
 * Resolve a single phone value for a row: the primary mapped column
 * first (mobile-preferred via detectColumnMapping), then the contact's
 * other own-phone columns in priority order. This per-row fallback is
 * what recovers contacts whose primary column is blank for that row.
 */
function resolvePhoneValue(
  row: Record<string, string>,
  mapping: ColumnMapping,
): string {
  const primary = getMappedValue(row, mapping, "phone");
  if (primary.trim()) return primary.trim();
  for (const header of orderedPhoneHeaders(Object.keys(row))) {
    const raw = (row[header] ?? "").trim();
    if (!raw) continue;
    return /extra/i.test(header) ? firstPhoneToken(raw) : raw;
  }
  return "";
}

/**
 * Fields that identify or reach the CONTACT themselves. A header naming
 * a different person (spouse/partner) must never populate these.
 */
const CONTACT_IDENTITY_FIELDS: ReadonlySet<CrmImportField> = new Set<CrmImportField>([
  "firstName", "lastName", "name", "company", "phone", "email", "address",
]);

/** Headers belonging to someone other than the contact, or to a
 * non-contact channel — excluded from every contact-identity field. */
const NON_CONTACT_HEADER = /\b(spouse|partner|fax|dnc)\b/;

/** Address-component words. A header carrying one is part of an address,
 * never a company name — defends "Business Street/City/State" → company. */
const ADDRESS_COMPONENT_WORD =
  /\b(street|avenue|ave|road|drive|lane|city|state|province|zip|postal|postcode|county|suite|apt|unit|address)\b/;

/** Other-channel words. A header carrying one is not a postal address —
 * defends "…Email Address" → address. */
const NON_ADDRESS_CHANNEL_WORD = /\b(e-?mail|phone|fax|web|url|page)\b/;

/**
 * Field-scoped guard layered on top of alias matching. Alias matching
 * is substring-based (`key.includes(alias)`), which lets a short alias
 * match an unrelated header that merely contains it ("business" ⊂
 * "Business Street"; "address" ⊂ "Spouse Email Address"). This guard
 * rejects headers whose own words prove they belong to a different
 * field or person, defeating those false-positives.
 */
function headerAllowedForField(key: string, field: CrmImportField): boolean {
  if (CONTACT_IDENTITY_FIELDS.has(field) && NON_CONTACT_HEADER.test(key)) return false;
  if (field === "company" && ADDRESS_COMPONENT_WORD.test(key)) return false;
  if (field === "address" && NON_ADDRESS_CHANNEL_WORD.test(key)) return false;
  return true;
}

/**
 * Walk the headers per field in CRM_IMPORT_FIELDS order, claiming each
 * matched header so a more-specific field (e.g. firstName) does not
 * compete with a more-general field (e.g. name) for the same column.
 *
 * The previous version did not track claimed headers, which let `name`
 * match "First Name" via `.includes("name")` and silently truncated
 * imports to first-name-only.
 */
export function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    key: normalizeHeaderKey(h),
  }));
  const mapping: ColumnMapping = {};
  const claimedKeys = new Set<string>();

  for (const field of CRM_IMPORT_FIELDS) {
    // Phone selection is priority-ordered (mobile > home > work > …),
    // not header-order, and excludes spouse/fax/DNC. See orderedPhoneHeaders.
    if (field === "phone") {
      const primary = orderedPhoneHeaders(headers).find(
        (raw) => !claimedKeys.has(normalizeHeaderKey(raw)),
      );
      if (primary) {
        mapping.phone = primary;
        claimedKeys.add(normalizeHeaderKey(primary));
      }
      continue;
    }
    const aliases = COLUMN_ALIASES[field];
    const match = normalizedHeaders.find(
      (header) =>
        !claimedKeys.has(header.key) &&
        headerAllowedForField(header.key, field) &&
        aliases.some((alias) => header.key === alias || header.key.includes(alias)),
    );
    if (match) {
      mapping[field] = match.raw;
      claimedKeys.add(match.key);
    }
  }

  return mapping;
}

export function getMappedValue(
  row: Record<string, string>,
  mapping: ColumnMapping,
  field: CrmImportField,
): string {
  const header = mapping[field];
  if (!header) return "";
  return (row[header] ?? row[header.toLowerCase()] ?? row[header.toUpperCase()] ?? "").trim();
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

function normalizeCompany(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePersonName(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Assemble a full name from first + last components.
 *
 * Returns "" when neither side has content. The single-value `name`
 * column ALWAYS wins when present; this function only fires when the
 * source CSV provides components instead. Whitespace is collapsed; no
 * order inversion or casing change is applied (Wise Agent stores names
 * cased correctly).
 */
function assembleNameFromComponents(parts: {
  firstName: string;
  lastName: string;
}): string {
  const first = parts.firstName.trim();
  const last = parts.lastName.trim();
  if (!first && !last) return "";
  return [first, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Assemble a full address from component fields.
 *
 * Returns "" when no street is present. Format:
 *   "{street}[ {unit}], {city}, {state} {postalCode}"
 * Empty components are skipped — a row with street + city but no state
 * still produces a useful "Street, City" string that the downstream
 * address normalizer can attempt to handle (it will flag as weak via
 * detectWeakAddress if state/zip are missing).
 *
 * No format coercion is applied — Wise Agent stores postal codes as
 * 5-digit strings and the situs normalizer is tolerant of "MO" vs
 * "Missouri" via its state-abbreviation table.
 */
function assembleAddressFromComponents(parts: {
  street: string;
  unit: string;
  city: string;
  state: string;
  postalCode: string;
}): string {
  const street = parts.street.trim();
  if (!street) return "";
  const line1 = parts.unit.trim() ? `${street} ${parts.unit.trim()}` : street;
  const result: string[] = [line1];
  if (parts.city.trim()) result.push(parts.city.trim());
  const stateAndZip = [parts.state.trim(), parts.postalCode.trim()]
    .filter(Boolean)
    .join(" ");
  if (stateAndZip) result.push(stateAndZip);
  return result.join(", ");
}

function parseTags(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseLastInteraction(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function normalizeCrmRow(
  row: Record<string, string>,
  rowIndex: number,
  mapping: ColumnMapping,
  sourceLabel: string,
): NormalizedCrmContact {
  // ── Name: single-value column wins; otherwise assemble from components ──
  const nameSingle = getMappedValue(row, mapping, "name");
  const firstName = getMappedValue(row, mapping, "firstName");
  const lastName = getMappedValue(row, mapping, "lastName");
  const name =
    nameSingle ||
    assembleNameFromComponents({ firstName, lastName });
  // Do NOT fall back to `name` when no company is present. Substituting
  // the contact's own name as their company produces the "Greg · Greg"
  // render bug — a fabricated detail that the operator immediately
  // distrusts. If the CSV doesn't carry a company, the company stays
  // empty and the render layer correctly hides it.
  const company = getMappedValue(row, mapping, "company");
  // Phone: primary mapped column (mobile-preferred), then per-row
  // fallback across the contact's other own-phone columns.
  const phone = resolvePhoneValue(row, mapping);
  const email = getMappedValue(row, mapping, "email");
  // ── Address: single-value column wins; otherwise assemble from components ──
  const addressSingle = getMappedValue(row, mapping, "address");
  const street = getMappedValue(row, mapping, "street");
  const unit = getMappedValue(row, mapping, "unit");
  const city = getMappedValue(row, mapping, "city");
  const state = getMappedValue(row, mapping, "state");
  const postalCode = getMappedValue(row, mapping, "postalCode");
  const address =
    addressSingle ||
    assembleAddressFromComponents({ street, unit, city, state, postalCode });
  const notes = getMappedValue(row, mapping, "notes");
  const tags = parseTags(getMappedValue(row, mapping, "tags"));
  const lastInteractionAt = parseLastInteraction(getMappedValue(row, mapping, "lastInteraction"));
  const sourceCrm = getMappedValue(row, mapping, "sourceCrm") || sourceLabel;

  const normalizedPhone = normalizePhoneForTrust(phone) || null;
  const normalizedEmail = normalizeEmail(email);
  const normalizedCompany = normalizeCompany(company);
  const normalizedName = normalizePersonName(name);

  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  if (!name.trim() && !company.trim()) {
    validationErrors.push("Row needs at least a name or company.");
  }
  if (!phone.trim() && !email.trim()) {
    validationWarnings.push("No phone or email — relationship reachability is limited.");
  }
  if (phone.trim() && !normalizedPhone) {
    validationWarnings.push("Phone could not be normalized to a usable format.");
  }
  if (email.trim() && !normalizedEmail) {
    validationWarnings.push("Email format looks invalid.");
  }

  const importSource = `crm_import:${sourceCrm}`;
  const phoneForTrust =
    normalizedPhone && normalizedPhone.length >= 10
      ? normalizedPhone
      : phone.trim() || null;

  return {
    rowIndex,
    name: name.trim() || company.trim(),
    // Empty string preserves the storage shape (CrmContactRecord.company
    // is typed `string`, not `string | null`) while letting render
    // layers cleanly suppress an absent company.
    company: company.trim(),
    phone: phone.trim() || null,
    email: normalizedEmail,
    address: address.trim() || null,
    notes: notes.trim() || null,
    tags,
    lastInteractionAt,
    sourceCrm,
    normalizedPhone: normalizedPhone && normalizedPhone.length >= 10 ? normalizedPhone : null,
    normalizedEmail,
    normalizedCompany,
    normalizedName,
    dataTrust: {
      name: buildDatumTrust(name.trim() || null, importSource, { required: true }),
      company: buildDatumTrust(company.trim() || null, importSource, { required: true }),
      phone: buildDatumTrust(phoneForTrust, importSource),
      email: buildDatumTrust(normalizedEmail, importSource),
      address: buildDatumTrust(address.trim() || null, importSource),
      lastInteraction: buildDatumTrust(lastInteractionAt, importSource),
    },
    validationErrors,
    validationWarnings,
  };
}

export function normalizeCrmRows(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  sourceLabel: string,
): NormalizedCrmContact[] {
  return rows.map((row, index) => normalizeCrmRow(row, index, mapping, sourceLabel));
}
