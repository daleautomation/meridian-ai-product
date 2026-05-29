// Meridian — CRM import column-mapping false-positive guard.
//
// The detector matches aliases with substring containment
// (`key.includes(alias)`), which produced two corruptions in Nicole's
// WiseAgent export:
//   • alias "business" ⊂ "Business Street"      → company ← Business Street
//   • alias "address"  ⊂ "Spouse Email Address" → address ← Spouse Email Address
//
// A header that names a DIFFERENT person (spouse) or that is really an
// address-component (street/city/state) or another channel (email)
// must never be claimed by the contact's own company/address fields.

import {
  detectColumnMapping,
  normalizeCrmRow,
} from "../lib/crm-import/normalize";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const WISEAGENT_HEADERS = [
  "First Name", "Last Name",
  "Home Street", "Home City", "Home State", "Home Postal Code",
  "Home Phone", "Mobile Phone", "E-mail Address", "Extra Phone Numbers",
  "Spouse", "Spouse Mobile Phone", "Spouse Email Address",
  "Business Street", "Business City", "Business State", "Business Postal Code",
  "Notes", "Categories", "Last Contact Date", "Source",
];

function rowFrom(headers: string[], over: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = Object.fromEntries(headers.map((h) => [h, ""]));
  return { ...base, ...over };
}

function main() {
  const m = detectColumnMapping(WISEAGENT_HEADERS);

  // ── 1. Spouse Email Address must NEVER become the address column ──
  assert(
    m.address !== "Spouse Email Address",
    `address must not map to "Spouse Email Address" (got "${m.address}").`,
  );

  // ── 2. Business Street must NEVER become the company column ──
  assert(
    m.company !== "Business Street",
    `company must not map to "Business Street" (got "${m.company}").`,
  );
  // No business-address component may stand in for company.
  assert(
    !["Business City", "Business State", "Business Postal Code"].includes(m.company ?? ""),
    `company must not map to a business-address component (got "${m.company}").`,
  );

  // ── 3. Address is assembled from real components, never an email ──
  const r = normalizeCrmRow(
    rowFrom(WISEAGENT_HEADERS, {
      "First Name": "Susan", "Last Name": "Adams",
      "Home Street": "123 Oak St", "Home City": "Kansas City",
      "Home State": "MO", "Home Postal Code": "64113",
      "Spouse Email Address": "spouse@example.com",
    }),
    0, m, "wise_agent",
  );
  assert(
    !!r.address && /123 Oak St/.test(r.address),
    `address should assemble from Home Street/City/State/Zip; got ${JSON.stringify(r.address)}.`,
  );
  assert(
    !(r.address ?? "").includes("@"),
    `address must never contain an email address; got ${JSON.stringify(r.address)}.`,
  );

  // ── 4. Correct address column wins over a spouse-email field ──
  const withMailing = ["First Name", "Mailing Address", "Spouse Email Address", "E-mail Address"];
  const mm = detectColumnMapping(withMailing);
  assert(
    mm.address === "Mailing Address",
    `"Mailing Address" must win the address slot over a spouse-email field (got "${mm.address}").`,
  );
  assert(mm.email === "E-mail Address", `email should map to "E-mail Address" (got "${mm.email}").`);

  // ── 5. Correct company column wins over a street field ──
  const withCompany = ["First Name", "Company", "Business Street", "E-mail Address"];
  const mc = detectColumnMapping(withCompany);
  assert(
    mc.company === "Company",
    `"Company" must win the company slot over "Business Street" (got "${mc.company}").`,
  );

  console.log("✓ column-mapping check passed (no spouse/street/email false-positive claims)");
}

main();
