// Meridian — relationship intelligence UI model checks.
//
// Validates that workspace models expose relationship classification
// as the primary signal and only surface market opportunity labels
// when listing/public-record evidence exists.

import type { CrmContactRecord } from "../lib/crm-import/types";
import { buildResurfacingBuckets } from "../lib/relationship-intelligence/resurfacing";
import { TENANTS, toPublicUser } from "../config/tenants";
import type { WorkspaceConfig } from "../config/workspaces";
import { buildPersonalWorkspaceModel } from "../lib/personal-workspace/workspace";
import { buildRelationshipPriorityWorkspaceModel } from "../lib/relationship-priority/workspace";
import type { RelationshipEngineOperatorSurface } from "../lib/relationship-engine/operatorIntegration";
import type { OpportunitySignal } from "../lib/enrichment/opportunity/types";
import { hasMarketEvidence } from "../lib/enrichment/opportunity/combinedPriority";

import { detectColumnMapping, normalizeCrmRow } from "../lib/crm-import/normalize";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const NOW = "2026-05-29T12:00:00.000Z";

const brooksideHeaders = ["Client Name", "Company", "E-mail", "Last Activity"];
const mapping = detectColumnMapping(brooksideHeaders);
const row = normalizeCrmRow(
  {
    "Client Name": "Pat Seller",
    Company: "Brookside Homes",
    "E-mail": "pat@example.com",
    "Last Activity": "2024-06-01",
  },
  0,
  mapping,
  "brookside_csv",
);

const sellerContact: CrmContactRecord = {
  id: "crm-seller-1",
  workspaceId: "nicole-lonergan",
  importJobId: "job-1",
  name: row.name,
  company: row.company,
  phone: row.phone,
  email: row.email,
  address: row.address,
  notes: "Closed listing 2022.",
  tags: ["Seller"],
  lastInteractionAt: row.lastInteractionAt,
  sourceCrm: row.sourceCrm,
  normalizedPhone: row.normalizedPhone,
  normalizedEmail: row.normalizedEmail,
  normalizedCompany: row.normalizedCompany,
  normalizedName: row.normalizedName,
  dataTrust: row.dataTrust,
  relationshipScore: 68,
  scoreMetadata: {
    provenance: "inferred",
    reasonCodes: ["BASELINE_IMPORT_SCORE"],
    sourceFieldsUsed: ["email", "tags"],
    storedAtImport: true,
    confidence: "medium",
    computedAt: NOW,
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const enrichedSeller: CrmContactRecord = {
  ...sellerContact,
  id: "crm-seller-enriched",
  enrichment: {
    opportunity: {
      source: "meridian_opportunity_v1",
      fetchedAt: NOW,
      contactId: "crm-seller-enriched",
      contactName: "Pat Seller",
      relationshipType: "prior_seller",
      relationshipTypeSource: "crm:tag:Seller",
      operatorPreferenceWeight: 15,
      matchedPropertyAddress: "123 Main St",
      parcelId: "parcel-1",
      ownerName: "Pat Seller",
      ownerMatchConfidence: "HIGH",
      ownershipDurationYears: 8,
      lastSaleDate: "2016-01-01",
      publicRecordSource: "us-mo-jackson_manual_2026-05-27",
      currentListingStatus: "unknown",
      listingAgentName: null,
      listingAgentMatch: "unknown",
      listingSource: null,
      listingObservedAt: null,
      revenueOpportunitySignals: ["ownership_duration_over_7yr"],
      priorityFactors: [
        {
          name: "prior_seller_relationship",
          weight: 30,
          applied: true,
          source: "crm:tag:Seller",
          evidenceLabel: "Tagged seller",
        },
        {
          name: "ownership_duration_over_7yr",
          weight: 15,
          applied: true,
          source: "public_record 2016-01-01",
          evidenceLabel: "Owned 7+ years",
        },
      ],
      uncertaintyReasons: [],
      transparentPriorityScore: 45,
      priorityTier: "MED",
      tierCapReason: null,
    } satisfies OpportunitySignal,
  },
};

const workspace: WorkspaceConfig = {
  slug: "nicole-lonergan",
  name: "Nicole",
  kind: "personal",
  access: { readOnlyByDefault: false },
  branding: { displayName: "Nicole Lonergan Workspace", companyName: "Brookside Real Estate" },
} as WorkspaceConfig;

function checkPersonalModel() {
  const buckets = buildResurfacingBuckets([sellerContact, enrichedSeller]);
  const model = buildPersonalWorkspaceModel({
    workspace,
    user: toPublicUser(TENANTS.nicole),
    crmContacts: [sellerContact, enrichedSeller],
    resurfacingBuckets: buckets,
    generatedAt: NOW,
  });

  const card = model.priorityContacts.find((c) => c.contactId === sellerContact.id);
  assert(card !== undefined, "seller card exists");
  assert(card.relationshipLabel === "Past Seller Reconnect", `expected Past Seller Reconnect, got ${card.relationshipLabel}`);
  assert(card.reachabilityStatus === "Reachable", "seller is reachable");
  assert(card.lastInteractionRecency.includes("days ago"), "recency is populated");
  assert(card.relationshipConfidence === "medium", "seller with date has medium confidence");
  assert(card.marketOpportunity === null, "CRM-only contact must not expose market opportunity");

  const enrichedCard = model.allContacts.find((c) => c.contactId === enrichedSeller.id);
  assert(enrichedCard !== undefined, "enriched card exists");
  assert(enrichedCard.marketOpportunity !== null, "enriched contact with public record shows market opportunity");
  assert(
    hasMarketEvidence(enrichedSeller.enrichment!.opportunity!),
    "fixture has market evidence",
  );
  assert(
    enrichedCard.marketOpportunity!.label === "Ownership duration signal",
    `expected ownership label, got ${enrichedCard.marketOpportunity!.label}`,
  );

  assert(model.summary.reachableCount >= 2, "summary counts reachable contacts");
  assert(model.hero.answer.includes("Past Seller Reconnect"), "hero uses relationship label not score");
  assert(!model.hero.answer.includes("Baseline"), "hero must not use CRM score label");
}

function checkOperatorModel() {
  const surface = {
    generatedAt: NOW,
    status: "ready",
    workflows: { relationshipSummaries: [] },
    queues: [],
    feeds: [],
    metadata: {
      summaryDisplay: { queueItemCount: 0, feedItemCount: 0 },
    },
  } as unknown as RelationshipEngineOperatorSurface;

  const model = buildRelationshipPriorityWorkspaceModel({
    surface,
    workspace,
    user: toPublicUser(TENANTS.nicole),
    crmContacts: [sellerContact],
    resurfacingBuckets: [],
  });

  const card = model.priorityQueue[0];
  assert(card !== undefined, "operator card exists");
  assert(card.relationship === "Past Seller Reconnect", `expected relationship label, got ${card.relationship}`);
  assert(card.reachabilityStatus === "Reachable", "operator card shows reachability");
  assert(card.lastInteractionRecency !== undefined, "operator card shows recency");
  assert(card.relationshipConfidence === "medium", "operator card shows confidence");
  assert(model.summary.reachableCount >= 1, "operator summary has reachable count");
}

function main() {
  checkPersonalModel();
  checkOperatorModel();
  console.log("✓ relationship-intelligence-ui check passed");
}

main();
