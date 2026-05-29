// Meridian — CRM import phone-mapping check.
//
// Guards the WiseAgent regression where the importer selected the
// "Home Phone" column (7/105 populated in Nicole's export) over
// "Mobile Phone" (59/105), stranding 56 reachable contacts with no
// phone. The contact's OWN phone columns must be preferred in priority
// order — mobile/cell first, then home, then work, then a generic
// phone column, then the first number in "Extra Phone Numbers". A
// spouse's mobile and fax/DNC columns are never used as the contact's
// phone.

import {
  detectColumnMapping,
  normalizeCrmRow,
} from "../lib/crm-import/normalize";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Representative WiseAgent export header (order matters — Home Phone
// precedes Mobile Phone, which is what triggered the original bug).
const WISEAGENT_HEADERS = [
  "First Name",
  "Last Name",
  "Home Street",
  "Home City",
  "Home State",
  "Home Postal Code",
  "Home Phone",
  "Mobile Phone",
  "E-mail Address",
  "Extra Phone Numbers",
  "Spouse",
  "Spouse Mobile Phone",
  "Notes",
  "Categories",
  "Last Contact Date",
  "Source",
];

function row(over: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = Object.fromEntries(
    WISEAGENT_HEADERS.map((h) => [h, ""]),
  );
  return { ...base, ...over };
}

function main() {
  const mapping = detectColumnMapping(WISEAGENT_HEADERS);

  // ── 1. Column selection: Mobile Phone must be the primary phone ──
  assert(
    mapping.phone === "Mobile Phone",
    `Expected primary phone column "Mobile Phone", got "${mapping.phone}". ` +
      `Home Phone must not win just because it appears earlier in the header row.`,
  );

  // ── 2. Per-row: Home blank + Mobile set → Mobile used ──
  const r2 = normalizeCrmRow(
    row({ "First Name": "Susan", "Last Name": "Adams", "Mobile Phone": "314-482-6270" }),
    0,
    mapping,
    "wise_agent",
  );
  assert(
    r2.normalizedPhone === "3144826270",
    `Home blank + Mobile set should yield the mobile number; got ${JSON.stringify(r2.normalizedPhone)}.`,
  );

  // ── 3. Per-row fallback: Mobile blank + Home set → Home used ──
  const r3 = normalizeCrmRow(
    row({ "First Name": "Pat", "Last Name": "Jones", "Home Phone": "816-555-0100" }),
    1,
    mapping,
    "wise_agent",
  );
  assert(
    r3.normalizedPhone === "8165550100",
    `Mobile blank + Home set should fall back to the home number; got ${JSON.stringify(r3.normalizedPhone)}.`,
  );

  // ── 4. Spouse phone must NOT be used as the contact's phone ──
  const r4 = normalizeCrmRow(
    row({ "First Name": "Lee", "Last Name": "Park", "Spouse Mobile Phone": "913-555-0199" }),
    2,
    mapping,
    "wise_agent",
  );
  assert(
    r4.normalizedPhone === null,
    `Spouse Mobile Phone must never become the contact's phone; got ${JSON.stringify(r4.normalizedPhone)}.`,
  );

  // ── 5. Extra Phone Numbers as last-resort fallback (first number) ──
  const r5 = normalizeCrmRow(
    row({ "First Name": "Dana", "Last Name": "Cole", "Extra Phone Numbers": "816-555-0150 (work); 816-555-0151" }),
    3,
    mapping,
    "wise_agent",
  );
  assert(
    r5.normalizedPhone === "8165550150",
    `Extra Phone Numbers should yield the first number as fallback; got ${JSON.stringify(r5.normalizedPhone)}.`,
  );

  console.log("✓ phone-mapping check passed (mobile-preferred with per-row fallback, spouse excluded)");
}

main();
