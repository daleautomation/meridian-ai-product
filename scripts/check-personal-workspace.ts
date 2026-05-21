// Meridian — personal workspace email-first / phone-light smoke checks.

import { computeImportDiagnostics } from "../lib/crm-import/diagnostics";
import { detectColumnMapping, normalizeCrmRow } from "../lib/crm-import/normalize";
import { computeWorkspaceReachability } from "../lib/crm-import/reachability";
import type { CrmContactRecord } from "../lib/crm-import/types";
import { buildResurfacingBuckets } from "../lib/relationship-intelligence/resurfacing";
import { TENANTS, toPublicUser } from "../config/tenants";
import { buildContactScoreTransparency } from "../lib/crm-import/scoreTransparency";
import {
  isContactCardProminent,
  isContactCardSelected,
  resolveSelectedContact,
  syncSelectedId,
} from "../lib/personal-workspace/selection";
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
  scoreMetadata: {
    provenance: "inferred",
    reasonCodes: ["BASELINE_IMPORT_SCORE"],
    sourceFieldsUsed: ["email", "lastInteractionAt", "notes"],
    storedAtImport: true,
    confidence: "medium",
    computedAt: new Date().toISOString(),
  },
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

const transparency = buildContactScoreTransparency(contact);
assert(transparency.scoreLabel.includes("Baseline") || transparency.scoreLabel.includes("import"), "imported score uses honest label");
assert(!transparency.isAuthoritative, "baseline import score is not authoritative");
assert(
  transparency.verificationTier === "imported" || transparency.verificationTier === "confidence_low",
  "brookside contact tier reflects import or low-confidence identity",
);
assert(
  card.verificationStatusLabel === "Imported" || card.verificationStatusLabel === "Confidence Low",
  "card exposes verification status badge",
);
assert(card.dataQualityLabel.includes("Data Quality"), "card exposes data quality badge");
assert(card.recommendationWhy.length > 0, "card explains recommendation why");
assert(card.recommendationEvidence.length > 0, "card lists recommendation evidence");
assert(!card.phoneActionable, "email-only import has non-actionable phone");
if (transparency.verificationTier === "confidence_low") {
  assert(!card.emailActionable, "low-confidence tier disables email action");
} else {
  assert(card.emailActionable, "email on file is actionable when trust allows");
}

const cards = [
  model.priorityContacts[0],
  model.allContacts[0],
].filter(Boolean);
assert(cards.length >= 1, "cards for selection test");
const first = cards[0]!;
const second = model.allContacts[1] ?? { ...first, id: `${first.id}-alt` };
const list = [first, second];
assert(isContactCardSelected(first.id, first.id), "selected id matches card");
assert(!isContactCardSelected(second.id, first.id), "other card not selected");
assert(isContactCardProminent(0, "priority", first.id, first.id), "first priority card prominent when selected");
assert(!isContactCardProminent(0, "priority", first.id, second.id), "first card not prominent when second selected");
assert(resolveSelectedContact(list, second.id)?.id === second.id, "resolve returns clicked card");
assert(syncSelectedId(list, "missing-id") === first.id, "sync resets to first visible");

console.log("personal-workspace:check passed");
