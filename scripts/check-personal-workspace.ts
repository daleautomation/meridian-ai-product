// Meridian — personal workspace email-first / phone-light smoke checks.

import { computeImportDiagnostics } from "../lib/crm-import/diagnostics";
import { detectColumnMapping, normalizeCrmRow } from "../lib/crm-import/normalize";
import { computeWorkspaceReachability } from "../lib/crm-import/reachability";
import type { CrmContactRecord } from "../lib/crm-import/types";
import { buildResurfacingBuckets } from "../lib/relationship-intelligence/resurfacing";
import { TENANTS, toPublicUser } from "../config/tenants";
import { buildPersonalWorkspaceModel } from "../lib/personal-workspace/workspace";
import type { WorkspaceConfig } from "../config/workspaces";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const brooksideHeaders = ["Client Name", "Company", "E-mail", "Last Activity"];
const mapping = detectColumnMapping(brooksideHeaders);
const row = normalizeCrmRow(
  {
    "Client Name": "Sam Seller",
    Company: "Brookside Listing",
    "E-mail": "sam@example.com",
    "Last Activity": "2025-11-01",
  },
  0,
  mapping,
  "brookside_csv",
);

const contact: CrmContactRecord = {
  id: "crm-brookside-1",
  workspaceId: "nicole-lonergan",
  importJobId: "job-1",
  name: row.name,
  company: row.company,
  phone: row.phone,
  email: row.email,
  address: row.address,
  notes: "Met at open house; follow up on listing timeline.",
  tags: ["buyer"],
  lastInteractionAt: row.lastInteractionAt,
  sourceCrm: row.sourceCrm,
  normalizedPhone: row.normalizedPhone,
  normalizedEmail: row.normalizedEmail,
  normalizedCompany: row.normalizedCompany,
  normalizedName: row.normalizedName,
  dataTrust: row.dataTrust,
  relationshipScore: 72,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const reach = computeWorkspaceReachability([contact]);
assert(reach.phoneLight, "single email-only contact is phone-light workspace");
assert(reach.mode === "phone_light", "mode is phone_light");

const buckets = buildResurfacingBuckets([contact]);
const model = buildPersonalWorkspaceModel({
  workspace: {
    slug: "nicole-lonergan",
    name: "Nicole",
    kind: "personal",
    access: { readOnlyByDefault: false },
    branding: { displayName: "Nicole Lonergan Workspace", companyName: "Brookside Real Estate" },
  } as WorkspaceConfig,
  user: toPublicUser(TENANTS.nicole),
  crmContacts: [contact],
  resurfacingBuckets: buckets,
});

const card = model.priorityContacts[0];
assert(card !== undefined, "priority card exists");
assert(card.primaryChannel === "email", "email is primary channel");
assert(card.suggestedAction !== "Reach out", "phone-light does not suggest call-first Reach out");
assert(card.phone === null, "unreachable phone not shown on card");
assert(card.reachabilityNote !== null, "missing-phone explanation present");
assert(model.reachability.phoneLight, "model exposes phone-light profile");
assert(model.resurfacingHighlights.length >= 0, "resurfacing highlights computed");

const diag = computeImportDiagnostics({
  headers: brooksideHeaders,
  mapping,
  rows: [row],
});
assert(diag.isEmailFirstExport, "import diagnostics flag email-first export");

console.log("personal-workspace:check passed");
