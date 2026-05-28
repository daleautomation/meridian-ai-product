/**
 * enrich-opportunity — wire CRM contacts + canonical public-record
 * substrate through the existing scoreContactOpportunity() and persist
 * the resulting OpportunitySignal to each contact's enrichment block.
 *
 * Pipeline:
 *   CRM contacts (Neon)
 *     → workspace_contact_parcel_links (active only)
 *       → public_parcels
 *         → public_ownership_snapshots (latest active)
 *           → buildOpportunityScoringInput (pure)
 *             → scoreContactOpportunity (pure)
 *               → applyContactOpportunityNeon (jsonb_set on contact.enrichment.opportunity)
 *
 * Modes:
 *   default = dry-run  (assemble + score; print summary; no writes)
 *   --write           = persist OpportunitySignal to each contact
 *
 * Hard constraints (Commit C scope):
 *   • workspace-scoped at every read AND write
 *   • CRM truth (name / company / phone / email / address / tags / notes)
 *     is NEVER mutated; only source_metadata.enrichment.opportunity is
 *     written
 *   • no opportunity is fabricated — when no active link exists, the
 *     ownership factors do not fire (handled by the existing scorer)
 *   • no scoring weights change
 *   • no MLS / Dotloop / provider data — listing fields are honest empties
 *
 * Usage:
 *   npm run enrich-opportunity -- --customer=nicole-lonergan
 *   npm run enrich-opportunity -- --customer=nicole-lonergan --write
 */

import { listContactsNeon } from "@/lib/crm-import/crmContactsNeonAdapter";
import { applyContactOpportunityNeon } from "@/lib/crm-import/crmContactsNeonAdapter";
import { filterOutInternalDiagnosticContacts } from "@/lib/crm-import/internalContactFilter";
import { assertWorkspaceSlug, getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";
import { ensurePublicRecordsSchema } from "@/lib/enrichment/public-records/canonicalStorage/initSchema";
import {
  getParcelById,
  getSnapshotById,
  listActiveLinksForContact,
} from "@/lib/enrichment/public-records/canonicalStorage/neonAdapter";
import { buildOpportunityScoringInput } from "@/lib/enrichment/opportunity/buildScoringInput";
import { scoreContactOpportunity } from "@/lib/enrichment/opportunity/scoreOpportunity";
import type {
  OpportunitySignal,
  OpportunityTier,
} from "@/lib/enrichment/opportunity/types";
import { buildPriorityContext, summarizePriorityContext } from "@/lib/personal-workspace/priorityContext";
import { getWorkspaceBySlug } from "@/config/workspaces";

interface CliFlags {
  customer: string;
  write: boolean;
  sample: number;
}

function parseFlags(argv: readonly string[]): CliFlags {
  let customer = "";
  let write = false;
  let sample = 10;
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a === "--write") write = true;
    else if (a.startsWith("--sample=")) {
      const n = Number.parseInt(a.slice("--sample=".length), 10);
      if (Number.isFinite(n) && n > 0) sample = n;
    }
  }
  if (!customer) {
    console.error(
      "Usage: enrich-opportunity -- --customer=<workspace-slug> [--write] [--sample=N]",
    );
    process.exit(2);
  }
  return { customer, write, sample };
}

interface PerContactPlan {
  contactId: string;
  contactName: string;
  hadActiveLink: boolean;
  parcelId: string | null;
  snapshotId: string | null;
  signal: OpportunitySignal;
}

interface RunSummary {
  workspaceId: string;
  contactsConsidered: number;
  internalDiagnosticSkipped: number;
  contactsWithLink: number;
  contactsWithoutLink: number;
  tiers: Record<OpportunityTier, number>;
  capReasonCounts: Record<string, number>;
  uncertaintyCounts: Record<string, number>;
  factorAppliedCounts: Record<string, number>;
  topSourceBackedOpportunities: Array<{
    contactId: string;
    contactName: string;
    tier: OpportunityTier;
    score: number;
    address: string | null;
    source: string | null;
  }>;
  writes: { applied: number; missing: number };
  mode: "dry-run" | "write";
}

function emptySummary(workspaceId: string, mode: "dry-run" | "write"): RunSummary {
  return {
    workspaceId,
    contactsConsidered: 0,
    internalDiagnosticSkipped: 0,
    contactsWithLink: 0,
    contactsWithoutLink: 0,
    tiers: { HIGH: 0, MED: 0, WEAK: 0, REVIEW: 0 },
    capReasonCounts: {},
    uncertaintyCounts: {},
    factorAppliedCounts: {},
    topSourceBackedOpportunities: [],
    writes: { applied: 0, missing: 0 },
    mode,
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  assertWorkspaceSlug(flags.customer);

  if (!getCrmDatabaseUrl()) {
    console.error("Set DATABASE_URL or POSTGRES_URL before running enrich-opportunity");
    process.exit(1);
  }
  await ensurePublicRecordsSchema();

  const workspaceConfig = getWorkspaceBySlug(flags.customer);
  const operatorSellerBias =
    workspaceConfig?.preferences?.sellerBias ?? 0;

  const allContacts = await listContactsNeon(flags.customer);
  const contacts = filterOutInternalDiagnosticContacts(allContacts);

  const summary = emptySummary(flags.customer, flags.write ? "write" : "dry-run");
  summary.internalDiagnosticSkipped = allContacts.length - contacts.length;

  const now = new Date();
  const plans: PerContactPlan[] = [];

  for (const c of contacts) {
    const links = await listActiveLinksForContact({
      workspaceId: flags.customer,
      contactId: c.id,
    });

    let link = links[0] ?? null;
    let parcel = null;
    let snapshot = null;
    if (link) {
      parcel = await getParcelById(link.parcelId);
      snapshot = await getSnapshotById(link.ownerSnapshotId);
    }

    const input = buildOpportunityScoringInput({
      contact: {
        contactId: c.id,
        contactName: c.name,
        tags: c.tags ?? [],
        email: c.email ?? c.normalizedEmail ?? null,
        phone: c.phone ?? c.normalizedPhone ?? null,
        lastInteractionAt: c.lastInteractionAt ?? null,
      },
      link,
      parcel,
      snapshot,
      operatorSellerBias,
      now,
    });

    const signal = scoreContactOpportunity(input);

    plans.push({
      contactId: c.id,
      contactName: c.name,
      hadActiveLink: link !== null,
      parcelId: parcel?.id ?? null,
      snapshotId: snapshot?.id ?? null,
      signal,
    });

    summary.contactsConsidered += 1;
    if (link !== null) summary.contactsWithLink += 1;
    else summary.contactsWithoutLink += 1;
    summary.tiers[signal.priorityTier] += 1;
    if (signal.tierCapReason) {
      summary.capReasonCounts[signal.tierCapReason] =
        (summary.capReasonCounts[signal.tierCapReason] ?? 0) + 1;
    }
    for (const u of signal.uncertaintyReasons) {
      summary.uncertaintyCounts[u.code] =
        (summary.uncertaintyCounts[u.code] ?? 0) + 1;
    }
    for (const f of signal.priorityFactors) {
      if (f.applied) {
        summary.factorAppliedCounts[f.name] =
          (summary.factorAppliedCounts[f.name] ?? 0) + 1;
      }
    }
  }

  // Top source-backed opportunities — highest score among contacts with
  // an active link AND parcelId set. Ties broken by name.
  const sourced = plans.filter((p) => p.signal.parcelId !== null);
  sourced.sort((a, b) => {
    if (b.signal.transparentPriorityScore !== a.signal.transparentPriorityScore) {
      return b.signal.transparentPriorityScore - a.signal.transparentPriorityScore;
    }
    return a.contactName.localeCompare(b.contactName);
  });
  summary.topSourceBackedOpportunities = sourced.slice(0, flags.sample).map((p) => ({
    contactId: p.contactId,
    contactName: p.contactName,
    tier: p.signal.priorityTier,
    score: p.signal.transparentPriorityScore,
    address: p.signal.matchedPropertyAddress,
    source: p.signal.publicRecordSource,
  }));

  if (!flags.write) {
    console.log("enrich-opportunity DRY-RUN", summary);
    console.log("");
    console.log(`Sample factor breakdowns (top ${Math.min(flags.sample, plans.length)} source-backed contacts):`);
    for (const p of sourced.slice(0, flags.sample)) {
      const ctx = buildPriorityContext(p.signal);
      console.log(`  ${p.contactName} (${p.contactId.slice(0, 8)})`);
      console.log(`    → ${summarizePriorityContext(ctx)}`);
      const applied = p.signal.priorityFactors.filter((f) => f.applied);
      for (const f of applied) {
        console.log(`    + ${f.name.padEnd(36)} weight=${f.weight}  source=${f.source}`);
      }
      if (p.signal.uncertaintyReasons.length > 0) {
        console.log(`    ⚠ uncertainty: ${p.signal.uncertaintyReasons.map((u) => u.code).join(", ")}`);
      }
    }
    console.log("");
    console.log("Pass --write to persist OpportunitySignal to each contact's enrichment.opportunity.");
    return;
  }

  // ── Write path ──────────────────────────────────────────────────
  for (const p of plans) {
    const ok = await applyContactOpportunityNeon(flags.customer, p.contactId, p.signal);
    if (ok) summary.writes.applied += 1;
    else summary.writes.missing += 1;
  }

  console.log("enrich-opportunity complete", summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
