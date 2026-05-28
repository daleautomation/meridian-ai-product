/**
 * check-grounding-quality — operational visibility into the
 * 109-contact intelligence corpus BEFORE adding more.
 *
 * Sections:
 *   1. CRM-side readiness (parcel-grounding opportunity)
 *      ─ visible contact count
 *      ─ relationship-type breakdown (seller / buyer / sphere / referral / unknown)
 *      ─ actionable-channel coverage
 *      ─ surname presence (single-token names cap at WEAK owner match)
 *      ─ address quality (would canonicalize vs weak)
 *      ─ likely duplicates (normalized name / email / phone)
 *      ─ parcel-eligibility estimate (the prefiltered candidate pool)
 *   2. Substrate state (gracefully absent when not initialized)
 *      ─ parcels + snapshots + sources
 *      ─ active links + confidence/reason breakdown
 *   3. Coverage analysis (CRM × substrate)
 *      ─ contacts WITH active link
 *      ─ contacts WITHOUT, broken down by reason
 *      ─ duplicate-parcel candidates within the workspace
 *   4. Top likely HIGH-tier candidates BEFORE enrichment
 *      (founder-readable lookup priority list)
 *   5. Risks
 *      ─ contacts linked to a parcel whose ownership-mismatch fires
 *      ─ suspicious snapshot ages (very old)
 *      ─ cross-county canonical-key collisions
 *
 * Usage:
 *   npm run check-grounding-quality -- --customer=nicole-lonergan
 *
 * Pure operational visibility. No scoring changes. No writes.
 * Workspace-scoped at every read.
 */

import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import { classifyRelationshipType } from "@/lib/enrichment/opportunity/relationshipType";
import { listContactsNeon } from "@/lib/crm-import/crmContactsNeonAdapter";
import { filterOutInternalDiagnosticContacts } from "@/lib/crm-import/internalContactFilter";
import {
  assertWorkspaceSlug,
  getCrmDatabaseUrl,
} from "@/lib/crm-import/storageConfig";
import {
  readActiveLinksByContactId,
  readSubstrateCounts,
  readWorkspaceLinkAudit,
  type ActiveLinkSummary,
} from "@/lib/enrichment/public-records/canonicalStorage/auditView";
import type { CrmContactRecord } from "@/lib/crm-import/types";

const SUPPORTED_COUNTIES = ["us-mo-jackson", "us-ks-johnson"] as const;

function parseArgs(argv: readonly string[]): { customer: string } {
  let customer = "";
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
  }
  if (!customer) {
    console.error("Usage: check-grounding-quality -- --customer=<workspace-slug>");
    process.exit(2);
  }
  return { customer };
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function hasSurname(contact: CrmContactRecord): boolean {
  const tokens = (contact.name ?? "").trim().split(/\s+/).filter(Boolean);
  // At least 2 tokens AND the surname token is not a single initial.
  if (tokens.length < 2) return false;
  let i = tokens.length - 1;
  while (i >= 0 && tokens[i].replace(/[.,]/g, "").length <= 1) i--;
  return i > 0;
}

function hasChannel(contact: CrmContactRecord): boolean {
  return !!(contact.email || contact.normalizedEmail || contact.phone || contact.normalizedPhone);
}

interface AddressStrength {
  hasAddress: boolean;
  canonicalKey: string | null;
  weakReason: string | null;
}

function analyzeAddress(contact: CrmContactRecord): AddressStrength {
  if (!contact.address || contact.address.trim().length === 0) {
    return { hasAddress: false, canonicalKey: null, weakReason: null };
  }
  try {
    const normalized = normalizeAddress(contact.address);
    const weak = detectWeakAddress(normalized);
    if (weak) {
      return { hasAddress: true, canonicalKey: null, weakReason: `${weak.code}: ${weak.detail}` };
    }
    return {
      hasAddress: true,
      canonicalKey: canonicalPropertyKey(normalized),
      weakReason: null,
    };
  } catch {
    return { hasAddress: true, canonicalKey: null, weakReason: "canonicalization_failed" };
  }
}

interface ContactClassification {
  contact: CrmContactRecord;
  relationshipType: "prior_seller" | "prior_buyer" | "sphere" | "referral" | "unknown";
  hasChannel: boolean;
  hasSurname: boolean;
  address: AddressStrength;
  activeLink: ActiveLinkSummary | null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertWorkspaceSlug(args.customer);

  if (!getCrmDatabaseUrl()) {
    console.error("Set DATABASE_URL or POSTGRES_URL before running check-grounding-quality");
    process.exit(1);
  }

  const allContacts = await listContactsNeon(args.customer);
  const contacts = filterOutInternalDiagnosticContacts(allContacts);
  const total = contacts.length;
  const internalDiagnostic = allContacts.length - contacts.length;

  // Substrate state (graceful when not initialized).
  const substrate = await readSubstrateCounts();
  const linkAudit = await readWorkspaceLinkAudit(args.customer);
  const activeLinks = await readActiveLinksByContactId(args.customer);

  // Per-contact classification.
  const classifications: ContactClassification[] = contacts.map((c) => {
    const rel = classifyRelationshipType(c.tags);
    return {
      contact: c,
      relationshipType: rel.relationshipType,
      hasChannel: hasChannel(c),
      hasSurname: hasSurname(c),
      address: analyzeAddress(c),
      activeLink: activeLinks.get(c.id) ?? null,
    };
  });

  const sellers = classifications.filter((c) => c.relationshipType === "prior_seller");
  const buyers = classifications.filter((c) => c.relationshipType === "prior_buyer");
  const spheres = classifications.filter((c) => c.relationshipType === "sphere");
  const referrals = classifications.filter((c) => c.relationshipType === "referral");
  const unknownRel = classifications.filter((c) => c.relationshipType === "unknown");
  const withChannel = classifications.filter((c) => c.hasChannel);
  const withSurname = classifications.filter((c) => c.hasSurname);
  const withAddress = classifications.filter((c) => c.address.hasAddress);
  const canonicalizable = classifications.filter((c) => c.address.canonicalKey !== null);

  // Parcel-eligible: has surname + canonical address + actionable channel.
  // These are the contacts whose CRM data supports a parcel grounding session.
  const parcelEligible = classifications.filter(
    (c) => c.hasSurname && c.address.canonicalKey !== null && c.hasChannel,
  );

  // CRM-rehab class: blocked by missing surname OR weak address OR no channel.
  const needsCrmRehab = classifications.filter(
    (c) => !c.hasSurname || !c.address.canonicalKey || !c.hasChannel,
  );

  // Likely duplicates — normalized email/phone/name with ≥ 2 occurrences.
  function dupCount(key: (c: CrmContactRecord) => string | null): number {
    const seen = new Map<string, number>();
    for (const c of contacts) {
      const k = key(c);
      if (!k) continue;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    let dups = 0;
    for (const v of seen.values()) if (v > 1) dups += v - 1;
    return dups;
  }
  const dupEmail = dupCount((c) => c.normalizedEmail?.toLowerCase() ?? null);
  const dupName = dupCount((c) => c.normalizedName?.toLowerCase() ?? null);
  const dupPhone = dupCount((c) => c.normalizedPhone ?? null);

  // Coverage analysis (CRM × substrate).
  const grounded = classifications.filter((c) => c.activeLink !== null);
  const groundedHigh = grounded.filter((c) => c.activeLink?.matchConfidence === "HIGH");
  const groundedMed = grounded.filter((c) => c.activeLink?.matchConfidence === "MED");
  const groundedWeak = grounded.filter((c) => c.activeLink?.matchConfidence === "WEAK");
  const mismatched = grounded.filter((c) => c.activeLink?.matchReason === "ownership_mismatch");

  const unresolvedReasons = {
    no_address: 0,
    weak_address: 0,
    no_parcel_in_substrate: 0,
  };
  for (const c of classifications) {
    if (c.activeLink !== null) continue;
    if (!c.address.hasAddress) unresolvedReasons.no_address += 1;
    else if (!c.address.canonicalKey) unresolvedReasons.weak_address += 1;
    else unresolvedReasons.no_parcel_in_substrate += 1;
  }

  // Top likely HIGH-tier candidates BEFORE enrichment:
  //   • parcel-eligible (surname + canonical address + channel)
  //   • not already grounded
  //   • seller-tagged (HIGH structurally accessible only here)
  //   • stale relationship preferred (drives stale_relationship_over_12mo)
  //   • address falls in a supported county hint (no hard county check —
  //     just a sort preference for MO / KS state hints)
  const now = Date.now();
  const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
  const highCandidates = parcelEligible
    .filter((c) => c.activeLink === null)
    .filter((c) => c.relationshipType === "prior_seller")
    .map((c) => {
      const last = c.contact.lastInteractionAt ? Date.parse(c.contact.lastInteractionAt) : null;
      const stale = last !== null && Number.isFinite(last) && now - last > YEAR_MS;
      return { c, stale, lastInteractionAt: c.contact.lastInteractionAt };
    })
    .sort((a, b) => {
      // Stale first, then alphabetical for determinism
      if (a.stale !== b.stale) return a.stale ? -1 : 1;
      return a.c.contact.name.localeCompare(b.c.contact.name);
    });

  // Cross-county canonical key collisions (within the workspace).
  const canonicalKeyToContacts = new Map<string, string[]>();
  for (const c of classifications) {
    if (!c.address.canonicalKey) continue;
    const list = canonicalKeyToContacts.get(c.address.canonicalKey) ?? [];
    list.push(c.contact.id);
    canonicalKeyToContacts.set(c.address.canonicalKey, list);
  }
  const sharedCanonicalAddresses: Array<[string, string[]]> = [];
  for (const [k, ids] of canonicalKeyToContacts) {
    if (ids.length > 1) sharedCanonicalAddresses.push([k, ids]);
  }

  // ── Report ─────────────────────────────────────────────────────
  console.log("");
  console.log(`check-grounding-quality  ${args.customer}`);
  console.log("================");
  console.log(`  total contacts visible:      ${total}`);
  console.log(`  internal/test rows filtered: ${internalDiagnostic}`);
  console.log("");

  console.log("Section 1 — CRM-side readiness");
  console.log(`  relationship type:`);
  console.log(`    prior_seller                ${sellers.length}   (HIGH structurally accessible here)`);
  console.log(`    prior_buyer                 ${buyers.length}   (MED ceiling at 45)`);
  console.log(`    sphere                      ${spheres.length}`);
  console.log(`    referral                    ${referrals.length}`);
  console.log(`    unknown                     ${unknownRel.length}`);
  console.log(`  actionable channel:           ${withChannel.length} / ${total} (${pct(withChannel.length, total)})`);
  console.log(`  has surname:                  ${withSurname.length} / ${total} (${pct(withSurname.length, total)})`);
  console.log(`  has address:                  ${withAddress.length} / ${total} (${pct(withAddress.length, total)})`);
  console.log(`  address canonicalizes:        ${canonicalizable.length} / ${total} (${pct(canonicalizable.length, total)})`);
  console.log(`  parcel-eligible (3 criteria): ${parcelEligible.length} / ${total} (${pct(parcelEligible.length, total)})`);
  console.log(`  needs CRM rehab first:        ${needsCrmRehab.length} / ${total} (${pct(needsCrmRehab.length, total)})`);
  console.log(`  likely duplicates:`);
  console.log(`    same normalized email       ${dupEmail}`);
  console.log(`    same normalized name        ${dupName}`);
  console.log(`    same normalized phone       ${dupPhone}`);
  console.log("");

  console.log("Section 2 — Substrate state");
  if (!substrate.schemaInitialized) {
    console.log("  substrate schema not initialized — run `npm run init-public-records-schema`");
  } else {
    console.log(`  total parcels:              ${substrate.totalParcels}`);
    for (const [county, n] of Object.entries(substrate.parcelsByCounty)) {
      console.log(`    ${county.padEnd(20)} ${n}`);
    }
    console.log(`  ownership snapshots:        ${substrate.totalSnapshots}`);
    console.log(`  distinct sources:           ${substrate.distinctSources}`);
    console.log(`  active workspace links:     ${linkAudit.totalActiveLinks}`);
    console.log(`    HIGH                      ${linkAudit.linksByConfidence.HIGH}`);
    console.log(`    MED                       ${linkAudit.linksByConfidence.MED}`);
    console.log(`    WEAK                      ${linkAudit.linksByConfidence.WEAK}`);
    console.log(`  superseded links:           ${linkAudit.totalSupersededLinks}`);
  }
  console.log("");

  console.log("Section 3 — Coverage analysis (CRM × substrate)");
  console.log(`  grounded (has active link):   ${grounded.length} / ${total} (${pct(grounded.length, total)})`);
  if (grounded.length > 0) {
    console.log(`    HIGH match                  ${groundedHigh.length}`);
    console.log(`    MED match                   ${groundedMed.length}`);
    console.log(`    WEAK match                  ${groundedWeak.length}`);
    console.log(`    ownership_mismatch          ${mismatched.length}  (linked as cautionary chip — NOT claimed as ownership)`);
  }
  console.log(`  unresolved:                   ${total - grounded.length} / ${total}`);
  console.log(`    no address on contact       ${unresolvedReasons.no_address}`);
  console.log(`    weak/unparseable address    ${unresolvedReasons.weak_address}`);
  console.log(`    no matching parcel ingested ${unresolvedReasons.no_parcel_in_substrate}  ← next lookup-session targets`);
  console.log("");

  console.log("Section 4 — Top likely HIGH-tier candidates BEFORE enrichment");
  console.log("  (seller-tagged, parcel-eligible, not yet grounded — prioritize lookups)");
  if (highCandidates.length === 0) {
    console.log("  (none — no seller-tagged contacts in the parcel-eligible pool need grounding)");
  } else {
    console.log(`  total candidates: ${highCandidates.length}`);
    console.log("");
    const sample = highCandidates.slice(0, 25);
    for (const { c, stale, lastInteractionAt } of sample) {
      const staleStr = stale ? "stale" : "fresh";
      const lastStr = lastInteractionAt ? lastInteractionAt.slice(0, 10) : "(no last touch)";
      console.log(
        `  ${staleStr.padEnd(6)}  ${c.contact.name.padEnd(28).slice(0, 28)}  last: ${lastStr}  addr: ${(c.contact.address ?? "").slice(0, 50)}`,
      );
    }
    if (highCandidates.length > 25) {
      console.log(`  ... ${highCandidates.length - 25} more`);
    }
  }
  console.log("");

  console.log("Section 5 — Risks");
  console.log(`  contacts with ownership_mismatch link:      ${mismatched.length}`);
  if (sharedCanonicalAddresses.length > 0) {
    console.log(`  shared canonical addresses (cross-contact): ${sharedCanonicalAddresses.length}`);
    for (const [key, ids] of sharedCanonicalAddresses.slice(0, 5)) {
      const names = ids.map((id) => contacts.find((c) => c.id === id)?.name).filter(Boolean).join(", ");
      console.log(`    "${key}" — contacts: ${names}`);
    }
    if (sharedCanonicalAddresses.length > 5) {
      console.log(`    ... ${sharedCanonicalAddresses.length - 5} more`);
    }
  } else {
    console.log(`  shared canonical addresses (cross-contact): 0`);
  }
  if (substrate.schemaInitialized && substrate.oldestSnapshot) {
    const oldestYear = substrate.oldestSnapshot.slice(0, 4);
    const currentYear = String(new Date().getUTCFullYear());
    const ageYears = parseInt(currentYear, 10) - parseInt(oldestYear, 10);
    if (ageYears > 3) {
      console.log(`  oldest snapshot: ${substrate.oldestSnapshot.slice(0, 10)} (~${ageYears} yrs old) — staleness risk for grounded contacts`);
    }
  }
  console.log("");

  console.log("Operational reading");
  if (parcelEligible.length === 0) {
    console.log("  • Parcel-eligible pool is empty. The CRM has no contacts with the");
    console.log("    surname + canonical address + channel needed to ground. Resolve");
    console.log("    CRM rehab first (see crm:audit).");
  } else if (highCandidates.length === 0 && grounded.length === 0) {
    console.log("  • Substrate is empty AND there are no seller-tagged candidates to");
    console.log("    prioritize. Two options: (a) tag known sellers in the CRM first,");
    console.log("    or (b) grind through the broader parcel-eligible pool by hand.");
  } else if (highCandidates.length > 0) {
    console.log(`  • Next lookup session: target the top ${Math.min(highCandidates.length, 25)} candidates listed above.`);
    console.log(`    Most of them, when grounded, will land HIGH tier (seller + grounding + stale + channel).`);
    console.log(`    Stale-first ordering puts the highest-leverage outreach at the top.`);
  } else if (grounded.length > 0 && groundedHigh.length === 0) {
    console.log(`  • Substrate has ${grounded.length} grounded contact(s) but 0 are HIGH.`);
    console.log(`    Walk the factor breakdown via enrich-opportunity --sample to confirm.`);
  } else {
    console.log(`  • Workspace state appears healthy. Proceed with the validation cycle.`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
