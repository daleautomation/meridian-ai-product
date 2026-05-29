/**
 * resolve-contact-parcels — deterministic workspace-scoped link
 * resolution between CRM contacts and canonical parcels/snapshots.
 *
 * For each contact in the workspace:
 *   • normalize address → canonicalPropertyKey
 *   • look up parcel(s) in every supported county
 *   • if exactly one candidate: resolveContactParcel(...) →
 *       upsertWorkspaceParcelLink + supersede prior link if it
 *       pointed to a different parcel
 *   • if zero candidates: NO_MATCH (no link written)
 *   • if multiple candidates: ambiguous_parcel — no link written,
 *     surfaced in summary for operator disambiguation
 *
 * Mode:
 *   default = dry-run (planning, no writes)
 *   --write = persist links via the canonical adapter
 *
 * Workspace-scoped at every read AND write. The canonical adapter
 * enforces the slug grammar; this script also short-circuits if the
 * workspaceId is invalid.
 *
 * Forbidden in this script:
 *   • opportunity scoring (Commit C)
 *   • opener-builder integration
 *   • weeklyState ranking
 *   • UI rendering
 *   • cross-workspace queries of any kind
 */

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import { filterOutInternalDiagnosticContacts } from "@/lib/crm-import/internalContactFilter";
import { listContactsNeon } from "@/lib/crm-import/crmContactsNeonAdapter";
import { assertWorkspaceSlug, getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";
import {
  getLatestOwnershipSnapshot,
  listActiveLinksForContact,
  listParcelsByCanonicalKey,
  supersedeWorkspaceParcelLink,
  upsertWorkspaceParcelLink,
} from "@/lib/enrichment/public-records/canonicalStorage/neonAdapter";
import { ensurePublicRecordsSchema } from "@/lib/enrichment/public-records/canonicalStorage/initSchema";
import type {
  PublicOwnershipSnapshot,
  PublicParcel,
} from "@/lib/enrichment/public-records/canonicalStorage/types";
import { resolveContactParcel } from "@/lib/enrichment/identity-resolution/resolveContactParcel";
import type { ContactParcelResolution } from "@/lib/enrichment/identity-resolution/types";

/**
 * Supported counties for v1. Future counties: append to this list.
 * Per the architecture, NO autonomous discovery — every new county is
 * an explicit code change so unsupported jurisdictions surface as
 * NO_MATCH rather than silently producing bad joins.
 */
const SUPPORTED_COUNTIES: readonly string[] = [
  "us-mo-jackson",
  "us-ks-johnson",
] as const;

function parseFlags(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) out[arg.slice(2)] = true;
    else out[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return out;
}

interface ResolutionPlan {
  contactId: string;
  contactName: string;
  outcome:
    | "no_address"
    | "weak_address"
    | "no_parcel_match"
    | "ambiguous_parcel"
    | "no_snapshot"
    | "resolved";
  resolution?: ContactParcelResolution;
  ambiguousParcels?: string[]; // parcel ids when ambiguous
  candidateCounties?: string[]; // counties where the canonical key matched
  willInsertLink?: boolean;
  willSupersedeLinkIds?: string[];
}

async function planForContact(
  workspaceId: string,
  contact: { id: string; name: string; address: string | null },
  now: Date,
): Promise<ResolutionPlan> {
  if (!contact.address) {
    return { contactId: contact.id, contactName: contact.name, outcome: "no_address" };
  }
  const normalized = normalizeAddress(contact.address);
  if (detectWeakAddress(normalized)) {
    return { contactId: contact.id, contactName: contact.name, outcome: "weak_address" };
  }
  const propertyKey = canonicalPropertyKey(normalized);

  // Gather candidates across supported counties.
  const candidates: Array<{ parcel: PublicParcel; snapshot: PublicOwnershipSnapshot | null }> = [];
  const matchingCounties: string[] = [];
  for (const countyCode of SUPPORTED_COUNTIES) {
    const parcels = await listParcelsByCanonicalKey({ countyCode, propertyKey });
    if (parcels.length === 0) continue;
    matchingCounties.push(countyCode);
    for (const parcel of parcels) {
      const snap = await getLatestOwnershipSnapshot(parcel.id);
      candidates.push({ parcel, snapshot: snap });
    }
  }

  if (candidates.length === 0) {
    return { contactId: contact.id, contactName: contact.name, outcome: "no_parcel_match" };
  }
  if (candidates.length > 1) {
    return {
      contactId: contact.id,
      contactName: contact.name,
      outcome: "ambiguous_parcel",
      ambiguousParcels: candidates.map((c) => c.parcel.id),
      candidateCounties: matchingCounties,
    };
  }

  const { parcel, snapshot } = candidates[0];
  if (!snapshot) {
    return {
      contactId: contact.id,
      contactName: contact.name,
      outcome: "no_snapshot",
      candidateCounties: matchingCounties,
    };
  }

  const resolution = resolveContactParcel(
    {
      contact: {
        contactId: contact.id,
        contactName: contact.name,
        contactAddress: contact.address,
      },
      parcel: {
        parcelId: parcel.id,
        countyCode: parcel.countyCode,
        propertyKey: parcel.propertyKey,
        situsAddress: parcel.situsAddress,
      },
      snapshot: {
        snapshotId: snapshot.id,
        ownerName: snapshot.ownerName,
        observedAt: snapshot.observedAt,
      },
      matchedBy: "address",
    },
    { now },
  );

  // Determine which existing active links would need to be superseded.
  const activeLinks = await listActiveLinksForContact({ workspaceId, contactId: contact.id });
  const willSupersedeLinkIds = activeLinks
    .filter((L) => L.parcelId !== resolution.parcelId)
    .map((L) => L.id);

  return {
    contactId: contact.id,
    contactName: contact.name,
    outcome: "resolved",
    resolution,
    candidateCounties: matchingCounties,
    willInsertLink: resolution.tier !== "NO_MATCH",
    willSupersedeLinkIds,
  };
}

interface RunSummary {
  workspaceId: string;
  contactsConsidered: number;
  internalDiagnosticSkipped: number;
  outcomes: Record<string, number>;
  tierCounts: { HIGH: number; MED: number; WEAK: number; NO_MATCH: number };
  matchReasonCounts: Record<string, number>;
  reviewReasonCounts: Record<string, number>;
  ambiguousContactCount: number;
  ambiguousContactIds: string[];
  staleObservationCount: number;
  ownershipMismatchCount: number;
  links: { inserted: number; updated: number; noop: number; superseded: number };
  mode: "dry-run" | "write";
}

function emptySummary(workspaceId: string, mode: "dry-run" | "write"): RunSummary {
  return {
    workspaceId,
    contactsConsidered: 0,
    internalDiagnosticSkipped: 0,
    outcomes: {},
    tierCounts: { HIGH: 0, MED: 0, WEAK: 0, NO_MATCH: 0 },
    matchReasonCounts: {},
    reviewReasonCounts: {},
    ambiguousContactCount: 0,
    ambiguousContactIds: [],
    staleObservationCount: 0,
    ownershipMismatchCount: 0,
    links: { inserted: 0, updated: 0, noop: 0, superseded: 0 },
    mode,
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const workspaceId = typeof flags.customer === "string" ? flags.customer : null;
  const isWrite = flags.write === true;

  if (!workspaceId) {
    console.error("Usage: resolve-contact-parcels -- --customer=<workspace-slug> [--write]");
    process.exit(2);
  }
  assertWorkspaceSlug(workspaceId);

  if (!getCrmDatabaseUrl()) {
    console.error("Set DATABASE_URL or POSTGRES_URL before running resolve-contact-parcels");
    process.exit(1);
  }

  await ensurePublicRecordsSchema();

  const allContacts = await listContactsNeon(workspaceId);
  const contacts = filterOutInternalDiagnosticContacts(allContacts);

  const summary = emptySummary(workspaceId, isWrite ? "write" : "dry-run");
  summary.internalDiagnosticSkipped = allContacts.length - contacts.length;

  const now = new Date();
  const plans: ResolutionPlan[] = [];
  for (const c of contacts) {
    const plan = await planForContact(
      workspaceId,
      { id: c.id, name: c.name, address: c.address },
      now,
    );
    plans.push(plan);
    summary.contactsConsidered += 1;
    summary.outcomes[plan.outcome] = (summary.outcomes[plan.outcome] ?? 0) + 1;
    if (plan.outcome === "ambiguous_parcel") {
      summary.ambiguousContactCount += 1;
      summary.ambiguousContactIds.push(plan.contactId);
    }
    if (plan.resolution) {
      summary.tierCounts[plan.resolution.tier] += 1;
      if (plan.resolution.matchReason) {
        const key = plan.resolution.matchReason;
        summary.matchReasonCounts[key] = (summary.matchReasonCounts[key] ?? 0) + 1;
      }
      for (const r of plan.resolution.reviewReasons) {
        summary.reviewReasonCounts[r] = (summary.reviewReasonCounts[r] ?? 0) + 1;
        if (r === "stale_observation") summary.staleObservationCount += 1;
        if (r === "ownership_mismatch") summary.ownershipMismatchCount += 1;
      }
    }
  }

  if (!isWrite) {
    console.log("resolve-contact-parcels DRY-RUN", summary);
    // Show a sample of resolved plans for readability.
    const samples = plans.filter((p) => p.outcome === "resolved").slice(0, 10);
    if (samples.length > 0) {
      console.log("");
      console.log("Sample resolved plans:");
      for (const p of samples) {
        console.log(
          `  ${p.contactName} (${p.contactId.slice(0, 8)}) → tier=${p.resolution?.tier} reason=${p.resolution?.matchReason} review=[${p.resolution?.reviewReasons.join(",")}]`,
        );
      }
    }
    if (summary.ambiguousContactIds.length > 0) {
      console.log("");
      console.log("Ambiguous contacts (no link written):");
      for (const cid of summary.ambiguousContactIds.slice(0, 20)) {
        const plan = plans.find((p) => p.contactId === cid);
        console.log(
          `  ${plan?.contactName} (${cid.slice(0, 8)}) — matched in counties: [${plan?.candidateCounties?.join(",")}]`,
        );
      }
    }
    console.log("");
    console.log("Pass --write to persist links.");
    return;
  }

  // ── Write path ──────────────────────────────────────────────────
  for (const plan of plans) {
    if (plan.outcome !== "resolved" || !plan.resolution) continue;
    const r = plan.resolution;
    if (r.tier === "NO_MATCH" || !r.parcelId || !r.snapshotId || !r.matchConfidence || !r.matchReason) {
      continue;
    }
    const linkResult = await upsertWorkspaceParcelLink({
      workspaceId,
      contactId: plan.contactId,
      parcelId: r.parcelId,
      ownerSnapshotId: r.snapshotId,
      matchConfidence: r.matchConfidence,
      matchReason: r.matchReason,
      linkCreatedAt: now.toISOString(),
    });
    if (linkResult.outcome === "inserted") summary.links.inserted += 1;
    else if (linkResult.outcome === "updated") summary.links.updated += 1;
    else summary.links.noop += 1;

    // Supersede prior links pointing to a DIFFERENT parcel.
    if (plan.willSupersedeLinkIds && plan.willSupersedeLinkIds.length > 0) {
      for (const oldId of plan.willSupersedeLinkIds) {
        if (oldId === linkResult.id) continue;
        await supersedeWorkspaceParcelLink({
          workspaceId,
          supersededLinkId: oldId,
          replacementLinkId: linkResult.id,
          supersededAt: now.toISOString(),
        });
        summary.links.superseded += 1;
      }
    }
  }

  console.log("resolve-contact-parcels complete", summary);
  if (summary.ambiguousContactIds.length > 0) {
    console.log("");
    console.log("Ambiguous contacts (no link written, need operator disambiguation):");
    for (const cid of summary.ambiguousContactIds.slice(0, 20)) {
      const plan = plans.find((p) => p.contactId === cid);
      console.log(
        `  ${plan?.contactName} (${cid.slice(0, 8)}) — matched in counties: [${plan?.candidateCounties?.join(",")}]`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
