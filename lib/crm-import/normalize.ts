// Meridian CRM import — column mapping and row normalization.

import { normalizePhoneForTrust } from "@/lib/contacts/trust";
import { buildDatumTrust } from "./trust";
import {
  CRM_IMPORT_FIELDS,
  type ColumnMapping,
  type CrmImportField,
  type NormalizedCrmContact,
} from "./types";

export const COLUMN_ALIASES: Record<CrmImportField, string[]> = {
  name: [
    "name", "full name", "fullname", "contact name", "contact", "first name",
    "firstname", "last name", "lastname", "person", "client name", "lead name",
    "primary contact", "display name",
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
  ],
  email: [
    "email", "e-mail", "email address", "work email", "primary email",
  ],
  address: [
    "address", "street", "location", "mailing address", "city state",
  ],
  notes: [
    "notes", "note", "description", "comments", "memo",
  ],
  tags: [
    "tags", "tag", "labels", "categories", "segment",
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

export function detectColumnMapping(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    key: normalizeHeaderKey(h),
  }));
  const mapping: ColumnMapping = {};

  for (const field of CRM_IMPORT_FIELDS) {
    const aliases = COLUMN_ALIASES[field];
    const match = normalizedHeaders.find((header) =>
      aliases.some((alias) => header.key === alias || header.key.includes(alias)),
    );
    if (match) mapping[field] = match.raw;
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
  const name = getMappedValue(row, mapping, "name");
  // Do NOT fall back to `name` when no company is present. Substituting
  // the contact's own name as their company produces the "Greg · Greg"
  // render bug — a fabricated detail that the operator immediately
  // distrusts. If the CSV doesn't carry a company, the company stays
  // empty and the render layer correctly hides it.
  const company = getMappedValue(row, mapping, "company");
  const phone = getMappedValue(row, mapping, "phone");
  const email = getMappedValue(row, mapping, "email");
  const address = getMappedValue(row, mapping, "address");
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
