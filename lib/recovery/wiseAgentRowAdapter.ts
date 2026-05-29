// Maps Wise Agent CRM export columns into recovery-brief generator fields.
// No invented signals — only reshapes CRM fields the generator already reads.

type CsvRow = Record<string, string>;

function cell(row: CsvRow, ...headers: string[]): string {
  const norm = new Map(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), (v ?? "").trim()]),
  );
  for (const h of headers) {
    const v = norm.get(h.toLowerCase());
    if (v) return v;
  }
  return "";
}

function fullName(row: CsvRow): string {
  const first = cell(row, "First Name", "first name");
  const last = cell(row, "Last Name", "last name");
  return [first, last].filter(Boolean).join(" ").trim();
}

/** Latest M/D/YYYY (optional time) timestamp embedded in Notes. */
export function latestNoteTimestamp(notes: string): string | null {
  if (!notes.trim()) return null;
  const matches = [...notes.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)?/gi)];
  if (matches.length === 0) return null;
  let best: Date | null = null;
  for (const m of matches) {
    const parsed = new Date(`${m[1]}/${m[2]}/${m[3]}`);
    if (!Number.isNaN(parsed.getTime()) && (!best || parsed > best)) best = parsed;
  }
  return best ? best.toISOString() : null;
}

function parseUsDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function lastNoteSnippet(notes: string): string | null {
  const lines = notes
    .split(/\s{2,}|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  return last.length > 240 ? `${last.slice(0, 237)}...` : last;
}

export function isWiseAgentExport(headers: string[]): boolean {
  const keys = new Set(headers.map((h) => h.trim().toLowerCase()));
  return keys.has("first name") && keys.has("e-mail address") && keys.has("categories");
}

/**
 * Returns a row keyed for scripts/generate-brief.ts `get()` lookups.
 * Preserves original cells under `wiseAgent_*` for audit only.
 */
export function adaptWiseAgentRow(row: CsvRow): CsvRow {
  const name = fullName(row);
  const street = cell(row, "Home Street", "home street");
  const city = cell(row, "Home City", "home city");
  const state = cell(row, "Home State", "home state");
  const zip = cell(row, "Home Postal Code", "home postal code");
  const phone = cell(row, "Mobile Phone", "mobile phone") || cell(row, "Home Phone", "home phone");
  const email = cell(row, "E-mail Address", "e-mail address", "email address");
  const notes = cell(row, "Notes", "notes");
  const categories = cell(row, "Categories", "categories");
  const lastContact = cell(row, "Last Contact Date", "last contact date");
  const homeSaleAnniversary = cell(row, "Home Sale Anniversary", "home sale anniversary");
  const contactStatus = cell(row, "Contact Status", "contact status");
  const extra = cell(row, "Extra Details", "extra details");

  const locationParts = [street, city, state, zip].filter(Boolean);
  const location = locationParts.join(", ") || null;

  const noteActivity = latestNoteTimestamp(notes);
  const lastContactIso = parseUsDate(lastContact);
  const lastActivityIso = noteActivity ?? lastContactIso;
  const priorClientIso = parseUsDate(homeSaleAnniversary);

  const catLower = categories.toLowerCase();
  const priorInterest =
    /\bseller\b/.test(catLower) ||
    /\bbuyer\b/.test(catLower) ||
    /\bcenter of influence\b/.test(catLower);

  const opportunityLabel = /\bseller\b/.test(catLower)
    ? "Past seller relationship"
    : /\bbuyer\b/.test(catLower)
      ? "Buyer relationship on file"
      : undefined;

  const crmLastAction = lastNoteSnippet(notes) ?? (extra.trim() || null);

  const adapted: CsvRow = {
    ...row,
    companyName: name || "Unknown contact",
    contactName: name || "",
    city,
    state,
    location: location ?? "",
    phone,
    email,
    notes,
    category: "residential",
    crmStatus: contactStatus,
    crmLastAction: crmLastAction ?? "",
    lastContactedAt: lastContactIso ?? lastContact,
    lastActivityAt: lastActivityIso ?? "",
    priorClientClosedAt: priorClientIso ?? homeSaleAnniversary,
    priorInterest: priorInterest ? "true" : "false",
    relationshipFreshness: lastActivityIso ? "known" : "unknown",
    sourceCrm: "wise_agent",
  };

  if (opportunityLabel) adapted.opportunityLabel = opportunityLabel;

  return adapted;
}

export function adaptWiseAgentRows(rows: CsvRow[], headers: string[]): CsvRow[] {
  if (!isWiseAgentExport(headers)) return rows;
  return rows.map(adaptWiseAgentRow);
}
