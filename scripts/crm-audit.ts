/**
 * Workspace CRM audit — brutally honest, founder-readable.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npm run crm:audit -- --customer=nicole-lonergan
 *   npm run crm:audit -- --customer=labortech
 *
 * Output:
 *   • record counts (total / visible / internal-diagnostic)
 *   • integrity distribution (HIGH / MED / WEAK)
 *   • completeness % per field
 *   • duplicate-entity count
 *   • enrichment eligibility per provider with named skip reasons
 *   • the trust-killer checks: Greg·Greg, no-channel, fake-confidence
 *
 * No vanity metrics. No engagement-style framing. Numbers only the
 * founder cares about before a pricing conversation.
 */

import { listContactsByWorkspace } from "@/lib/crm-import/store";
import type { OpportunitySignal, OpportunityTier } from "@/lib/enrichment/opportunity/types";
import {
  classifyCrmIntegrity,
  summarizeCrmIntegrity,
} from "@/lib/crm-import/integrity";
import { summarizeEnrichmentEligibility } from "@/lib/crm-import/enrichmentEligibility";
import { isInternalDiagnosticContact } from "@/lib/crm-import/internalContactFilter";
import { companyLooksLikeContactName } from "@/lib/personal-workspace/workspace";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import {
  readSubstrateCounts,
  readWorkspaceLinkAudit,
} from "@/lib/enrichment/public-records/canonicalStorage/auditView";
import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import {
  listParcelsByCanonicalKey,
} from "@/lib/enrichment/public-records/canonicalStorage/neonAdapter";

const SUPPORTED_COUNTIES: readonly string[] = [
  "us-mo-jackson",
  "us-ks-johnson",
] as const;

interface CliArgs {
  customer: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let customer = "";
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
  }
  if (!customer) {
    console.error("Usage: npm run crm:audit -- --customer=<slug>");
    process.exit(1);
  }
  return { customer };
}

function pct(n: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function detectDuplicates(contacts: readonly CrmContactRecord[]): {
  byNormalizedEmail: number;
  byNormalizedName: number;
  byNormalizedPhone: number;
} {
  const counts = (key: (c: CrmContactRecord) => string | null) => {
    const seen = new Map<string, number>();
    for (const c of contacts) {
      const k = key(c);
      if (!k) continue;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    let dupes = 0;
    for (const v of seen.values()) if (v > 1) dupes += v - 1;
    return dupes;
  };
  return {
    byNormalizedEmail: counts((c) => c.normalizedEmail?.toLowerCase() ?? null),
    byNormalizedName: counts((c) => c.normalizedName?.toLowerCase() ?? null),
    byNormalizedPhone: counts((c) => c.normalizedPhone ?? null),
  };
}

function bar(n: number, total: number, width = 24): string {
  if (total === 0) return " ".repeat(width);
  const filled = Math.round((n / total) * width);
  return "█".repeat(Math.max(0, filled)) + "·".repeat(Math.max(0, width - filled));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = await listContactsByWorkspace(args.customer);
  if (all.length === 0) {
    console.log("");
    console.log(`crm:audit ${args.customer}`);
    console.log("================");
    console.log("");
    console.log("  No contacts found for this workspace.");
    console.log("  Either the customer hasn't imported yet, or the storage backend is misconfigured.");
    return;
  }

  const visible = all.filter((c) => !isInternalDiagnosticContact(c));
  const integrity = summarizeCrmIntegrity(all);
  const eligibility = summarizeEnrichmentEligibility(visible);
  const dups = detectDuplicates(visible);

  // ── Trust-killer checks (operator-visible regressions worth blocking) ──
  const gregGreg = visible.filter((c) => companyLooksLikeContactName(c.company, c.name)).length;
  const noChannel = visible.filter(
    (c) => !c.phone && !c.normalizedPhone && !c.email && !c.normalizedEmail,
  ).length;
  const blankNames = visible.filter((c) => !(c.name ?? "").trim()).length;

  // ── Completeness counts ─────────────────────────────────────────
  const completeness = {
    name: visible.filter((c) => (c.name ?? "").trim()).length,
    surname: visible.filter((c) => (c.name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2).length,
    phone: visible.filter((c) => c.phone || c.normalizedPhone).length,
    email: visible.filter((c) => c.email || c.normalizedEmail).length,
    address: visible.filter((c) => (c.address ?? "").trim()).length,
    tags: visible.filter((c) => (c.tags ?? []).length > 0).length,
    notes: visible.filter((c) => (c.notes ?? "").trim()).length,
    lastInteraction: visible.filter((c) => (c.lastInteractionAt ?? "").trim()).length,
  };

  // Business-domain emails (T1 enrichment-eligible).
  const PERSONAL = new Set([
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "icloud.com",
    "aol.com",
    "outlook.com",
    "msn.com",
    "live.com",
    "proton.me",
    "protonmail.com",
    "pm.me",
    "mac.com",
    "me.com",
    "ymail.com",
  ]);
  const businessDomain = visible.filter((c) => {
    const e = (c.email ?? c.normalizedEmail ?? "").toLowerCase().trim();
    const at = e.indexOf("@");
    if (at < 0) return false;
    return !PERSONAL.has(e.slice(at + 1));
  }).length;

  // ── Print report ─────────────────────────────────────────────────
  console.log("");
  console.log(`crm:audit  ${args.customer}`);
  console.log("================");
  console.log(`  total rows in storage:    ${integrity.total}`);
  console.log(`  visible to operator:      ${integrity.visible}`);
  console.log(`  internal/test rows:       ${integrity.internalDiagnostic}  (hidden by filter)`);
  console.log("");

  console.log("Integrity tiers (visible)");
  console.log(`  HIGH  ${String(integrity.high).padStart(4)}  ${bar(integrity.high, integrity.visible)}  ${pct(integrity.high, integrity.visible)}`);
  console.log(`  MED   ${String(integrity.med).padStart(4)}  ${bar(integrity.med, integrity.visible)}  ${pct(integrity.med, integrity.visible)}`);
  console.log(`  WEAK  ${String(integrity.weak).padStart(4)}  ${bar(integrity.weak, integrity.visible)}  ${pct(integrity.weak, integrity.visible)}`);
  console.log("");

  console.log("Field completeness (visible)");
  for (const [k, v] of Object.entries(completeness)) {
    console.log(`  ${k.padEnd(20)} ${String(v).padStart(4)} / ${integrity.visible}   ${bar(v, integrity.visible)}  ${pct(v, integrity.visible)}`);
  }
  console.log(`  business_domain_email${"".padEnd(0)} ${String(businessDomain).padStart(4)} / ${integrity.visible}   ${bar(businessDomain, integrity.visible)}  ${pct(businessDomain, integrity.visible)}`);
  console.log("");

  console.log("Trust-killer checks (integrity → BLOCKING; completeness → REVIEW)");
  const tkOk = (n: number) => (n === 0 ? "OK" : "BLOCKING");
  const tkReview = (n: number) => (n === 0 ? "OK" : "REVIEW");
  console.log(`  company == contact name      ${String(gregGreg).padStart(4)}   ${tkOk(gregGreg)}   (Greg · Greg render)`);
  console.log(`  no actionable channel        ${String(noChannel).padStart(4)}   ${tkReview(noChannel)}   (completeness gap; gated as Not Reachable)`);
  console.log(`  blank name                   ${String(blankNames).padStart(4)}   ${tkOk(blankNames)}`);
  console.log("");

  console.log("Repairs applied (founder-led rehab sessions)");
  const repairFieldCounts = new Map<string, number>();
  let contactsWithRepairs = 0;
  for (const c of visible) {
    if (c.repairs && c.repairs.length > 0) {
      contactsWithRepairs += 1;
      for (const r of c.repairs) {
        repairFieldCounts.set(r.field, (repairFieldCounts.get(r.field) ?? 0) + 1);
      }
    }
  }
  if (contactsWithRepairs === 0) {
    console.log("  No repairs applied yet. Workspace data is import-fresh.");
  } else {
    console.log(`  contacts repaired:           ${contactsWithRepairs} / ${integrity.visible}`);
    for (const [field, n] of [...repairFieldCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${field.padEnd(28)} ${n}`);
    }
    console.log("");
    console.log("  Import-time originals preserved in source_metadata.repairs[].originalValue.");
    console.log("  Effective values shown above reflect chronological overlay.");
  }
  console.log("");

  console.log("Duplicate entities");
  console.log(`  same normalized email        ${dups.byNormalizedEmail}`);
  console.log(`  same normalized name         ${dups.byNormalizedName}`);
  console.log(`  same normalized phone        ${dups.byNormalizedPhone}`);
  console.log("");

  console.log("Top gaps (most common reason for WEAK / MED tiers)");
  for (const [gap, n] of integrity.topGaps.slice(0, 8)) {
    console.log(`  ${gap.padEnd(32)} ${n}`);
  }
  console.log("");

  console.log("Enrichment eligibility (visible)");
  console.log("  Hunter:");
  for (const [k, v] of Object.entries(eligibility.hunter).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(28)} ${v}`);
  }
  console.log("  Property:");
  for (const [k, v] of Object.entries(eligibility.property).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(28)} ${v}`);
  }
  console.log("");

  // ── Public-record substrate coverage (workspace-agnostic + per-ws) ──
  // Wrapped in try/catch so a missing schema or DB hiccup doesn't tank
  // the audit. The constitution forbids fake-data fallbacks — if the
  // substrate is not initialized we say so honestly.
  let substrateAvailable = true;
  let parcelResolutionUnresolved = 0;
  let parcelResolutionAmbiguous = 0;
  let parcelResolutionWeakAddress = 0;
  let parcelResolutionNoAddress = 0;
  let parcelResolutionMatched = 0;
  try {
    const counts = await readSubstrateCounts();
    const linkAudit = await readWorkspaceLinkAudit(args.customer);

    console.log("Public-record substrate");
    if (!counts.schemaInitialized) {
      console.log("  schema not initialized — run `npm run init-public-records-schema` and");
      console.log("  ingest a canonical CSV before opportunity scoring can run.");
      substrateAvailable = false;
    } else {
      console.log(`  total parcels:               ${counts.totalParcels}`);
      for (const [county, n] of Object.entries(counts.parcelsByCounty)) {
        console.log(`    ${county.padEnd(20)} ${n}`);
      }
      console.log(`  ownership snapshots:         ${counts.totalSnapshots}`);
      console.log(`  distinct sources ingested:   ${counts.distinctSources}`);
      if (counts.oldestSnapshot && counts.newestSnapshot) {
        console.log(`  snapshot range:              ${counts.oldestSnapshot.slice(0,10)} → ${counts.newestSnapshot.slice(0,10)}`);
      }
    }
    console.log("");

    if (substrateAvailable) {
      // Per-contact resolution preview — honest counts of what would
      // resolve against the substrate as it stands TODAY. Does not
      // mutate any state.
      for (const contact of visible) {
        if (!contact.address) {
          parcelResolutionNoAddress += 1;
          continue;
        }
        const normalized = normalizeAddress(contact.address);
        if (detectWeakAddress(normalized)) {
          parcelResolutionWeakAddress += 1;
          continue;
        }
        const key = canonicalPropertyKey(normalized);
        let candidateCount = 0;
        for (const county of SUPPORTED_COUNTIES) {
          const parcels = await listParcelsByCanonicalKey({ countyCode: county, propertyKey: key });
          candidateCount += parcels.length;
        }
        if (candidateCount === 0) parcelResolutionUnresolved += 1;
        else if (candidateCount > 1) parcelResolutionAmbiguous += 1;
        else parcelResolutionMatched += 1;
      }
    }

    console.log("Workspace parcel resolution (this workspace)");
    if (!substrateAvailable) {
      console.log("  unavailable: public-record substrate not initialized.");
    } else {
      console.log(`  active links:                ${linkAudit.totalActiveLinks}`);
      console.log(`  superseded links (audit):    ${linkAudit.totalSupersededLinks}`);
      console.log(`    HIGH                        ${linkAudit.linksByConfidence.HIGH}`);
      console.log(`    MED                         ${linkAudit.linksByConfidence.MED}`);
      console.log(`    WEAK                        ${linkAudit.linksByConfidence.WEAK}`);
      console.log("  link reasons:");
      const reasonOrder = ["exact", "surname", "trust_or_llc", "fuzzy", "ownership_mismatch"];
      for (const reason of reasonOrder) {
        const n = linkAudit.linksByMatchReason[reason] ?? 0;
        console.log(`    ${reason.padEnd(28)} ${n}`);
      }
      console.log("  review flags:");
      console.log(`    stale observation           ${linkAudit.staleObservationLinks}`);
      console.log(`    ownership mismatch          ${linkAudit.ownershipMismatchLinks}`);
      console.log(`    trust or LLC                ${linkAudit.trustOrLlcLinks}`);
      console.log(`    surname-only match          ${linkAudit.surnameOnlyLinks}`);
      console.log("");
      console.log("Contact-to-parcel resolution preview");
      console.log(`  contacts with parcel match:  ${parcelResolutionMatched}`);
      console.log(`  no parcel match (out of substrate or out of county): ${parcelResolutionUnresolved}`);
      console.log(`  ambiguous (multiple parcels match address): ${parcelResolutionAmbiguous}`);
      console.log(`  weak address (cannot canonicalize): ${parcelResolutionWeakAddress}`);
      console.log(`  no address on contact: ${parcelResolutionNoAddress}`);
      console.log("");
      console.log("  → run `npm run resolve-contact-parcels -- --customer=<slug> --write` to");
      console.log("    persist active links into workspace_contact_parcel_links.");
    }
  } catch (err) {
    console.log("Public-record substrate");
    console.log(`  unavailable: ${err instanceof Error ? err.message : String(err)}`);
    substrateAvailable = false;
  }
  console.log("");

  // ── Opportunity tier coverage (per-contact enrichment.opportunity) ──
  // Reads each contact's persisted OpportunitySignal. Contacts without
  // a signal are reported honestly; the audit does NOT score on the fly.
  const opportunitySignals: Array<{ contact: CrmContactRecord; signal: OpportunitySignal }> = [];
  let contactsMissingOpportunity = 0;
  for (const c of visible) {
    const o = c.enrichment?.opportunity;
    if (o && o.source === "meridian_opportunity_v1") {
      opportunitySignals.push({ contact: c, signal: o });
    } else {
      contactsMissingOpportunity += 1;
    }
  }
  const tierCounts: Record<OpportunityTier, number> = { HIGH: 0, MED: 0, WEAK: 0, REVIEW: 0 };
  const capReasonCounts: Record<string, number> = {};
  const factorAppliedCounts: Record<string, number> = {};
  const uncertaintyCountsAudit: Record<string, number> = {};
  let cappedByWeakOwner = 0;
  let cappedByNoChannel = 0;
  for (const { signal } of opportunitySignals) {
    tierCounts[signal.priorityTier] += 1;
    if (signal.tierCapReason) {
      capReasonCounts[signal.tierCapReason] = (capReasonCounts[signal.tierCapReason] ?? 0) + 1;
      if (signal.tierCapReason === "weak_owner_match") cappedByWeakOwner += 1;
      if (signal.tierCapReason === "no_actionable_channel") cappedByNoChannel += 1;
    }
    for (const f of signal.priorityFactors) {
      if (f.applied) factorAppliedCounts[f.name] = (factorAppliedCounts[f.name] ?? 0) + 1;
    }
    for (const u of signal.uncertaintyReasons) {
      uncertaintyCountsAudit[u.code] = (uncertaintyCountsAudit[u.code] ?? 0) + 1;
    }
  }

  console.log("Opportunity tier distribution (visible)");
  if (opportunitySignals.length === 0) {
    console.log("  No contacts carry an enrichment.opportunity signal yet.");
    console.log("  Run `npm run enrich-opportunity -- --customer=<slug> --write` to populate.");
  } else {
    console.log(`  HIGH   ${String(tierCounts.HIGH).padStart(4)}  ${bar(tierCounts.HIGH, opportunitySignals.length)}  ${pct(tierCounts.HIGH, opportunitySignals.length)}`);
    console.log(`  MED    ${String(tierCounts.MED).padStart(4)}  ${bar(tierCounts.MED, opportunitySignals.length)}  ${pct(tierCounts.MED, opportunitySignals.length)}`);
    console.log(`  REVIEW ${String(tierCounts.REVIEW).padStart(4)}  ${bar(tierCounts.REVIEW, opportunitySignals.length)}  ${pct(tierCounts.REVIEW, opportunitySignals.length)}`);
    console.log(`  WEAK   ${String(tierCounts.WEAK).padStart(4)}  ${bar(tierCounts.WEAK, opportunitySignals.length)}  ${pct(tierCounts.WEAK, opportunitySignals.length)}`);
    console.log("");
    console.log(`  contacts missing opportunity signal: ${contactsMissingOpportunity} / ${visible.length}`);
  }
  console.log("");

  if (opportunitySignals.length > 0) {
    // Top source-backed opportunities — contacts with parcelId set,
    // sorted by transparentPriorityScore desc.
    const sourced = opportunitySignals.filter(({ signal }) => signal.parcelId !== null);
    sourced.sort((a, b) => {
      if (b.signal.transparentPriorityScore !== a.signal.transparentPriorityScore) {
        return b.signal.transparentPriorityScore - a.signal.transparentPriorityScore;
      }
      return a.contact.name.localeCompare(b.contact.name);
    });
    console.log("Top source-backed opportunities (this workspace)");
    if (sourced.length === 0) {
      console.log("  (none — no contacts have public-record-backed opportunity signals yet)");
    } else {
      for (const { contact, signal } of sourced.slice(0, 10)) {
        const grounding = signal.matchedPropertyAddress ?? "(address withheld)";
        const sourceTag = signal.publicRecordSource ?? "(source unknown)";
        console.log(
          `  ${signal.priorityTier.padEnd(6)} ${String(signal.transparentPriorityScore).padStart(3)} · ${contact.name.padEnd(28).slice(0, 28)} · ${grounding}  [${sourceTag}]`,
        );
      }
    }
    console.log("");

    console.log("Top applied factors (across all contacts)");
    const factorPairs = Object.entries(factorAppliedCounts).sort((a, b) => b[1] - a[1]);
    for (const [name, n] of factorPairs.slice(0, 8)) {
      console.log(`  ${name.padEnd(36)} ${n}`);
    }
    console.log("");

    console.log("Top uncertainty reasons (across all contacts)");
    const uncertaintyPairs = Object.entries(uncertaintyCountsAudit).sort((a, b) => b[1] - a[1]);
    if (uncertaintyPairs.length === 0) {
      console.log("  (none)");
    } else {
      for (const [code, n] of uncertaintyPairs) {
        console.log(`  ${code.padEnd(36)} ${n}`);
      }
    }
    console.log("");

    console.log("Tier cap reasons");
    console.log(`  capped by weak owner match → REVIEW    ${cappedByWeakOwner}`);
    console.log(`  capped by no actionable channel → WEAK ${cappedByNoChannel}`);
    if (Object.keys(capReasonCounts).length === 0) {
      console.log("  (no caps fired — all tiers are score-derived)");
    }
    console.log("");
  }

  // ── Founder verdict ─────────────────────────────────────────────
  console.log("Founder verdict");
  const verdicts: string[] = [];
  // BLOCKING is reserved for trust / integrity / correctness failures.
  if (gregGreg > 0) {
    verdicts.push(`BLOCKING: ${gregGreg} contacts still render "Greg · Greg" (legacy normalizer corruption).`);
  }
  if (blankNames > 0) {
    verdicts.push(`BLOCKING: ${blankNames} contacts have a blank name — import-integrity violation (the pipeline guarantees a non-empty name).`);
  }
  // No actionable channel is a data-completeness gap, not a correctness
  // failure — the relationship layer already gates these as "Not
  // Reachable". Classified REVIEW, not BLOCKING (severity audit 2026-05).
  if (noChannel > 0) {
    verdicts.push(`REVIEW: ${noChannel} contacts have no actionable channel — completeness gap; relationship layer gates these as "Not Reachable".`);
  }
  if (integrity.weak / Math.max(1, integrity.visible) > 0.5) {
    verdicts.push(`MAJORITY-WEAK workspace: ${integrity.weak} of ${integrity.visible} rows are WEAK tier. This workspace cannot carry a paid pricing conversation without a CRM rehab pass.`);
  }
  if (eligibility.hunter.eligible === 0) {
    verdicts.push(`Hunter cannot be run usefully here — 0 eligible rows. Pause Hunter for this workspace.`);
  }
  if (eligibility.property.eligible === 0) {
    verdicts.push(`Property cannot be run usefully here — 0 eligible rows. Pause Property for this workspace.`);
  }
  if (substrateAvailable && parcelResolutionUnresolved + parcelResolutionAmbiguous + parcelResolutionWeakAddress + parcelResolutionNoAddress > parcelResolutionMatched && parcelResolutionMatched === 0) {
    verdicts.push(`Public-record coverage is empty for this workspace — ingest county data before opportunity scoring can produce meaningful tiers.`);
  }
  if (verdicts.length === 0) {
    console.log("  ✓ No blocking issues detected. Workspace is paid-customer ready from a data-integrity standpoint.");
  } else {
    for (const v of verdicts) console.log(`  • ${v}`);
  }
  console.log("");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[crm:audit] crashed");
  console.error(message);
  process.exit(1);
});
