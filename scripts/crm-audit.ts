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
import {
  classifyCrmIntegrity,
  summarizeCrmIntegrity,
} from "@/lib/crm-import/integrity";
import { summarizeEnrichmentEligibility } from "@/lib/crm-import/enrichmentEligibility";
import { isInternalDiagnosticContact } from "@/lib/crm-import/internalContactFilter";
import { companyLooksLikeContactName } from "@/lib/personal-workspace/workspace";
import type { CrmContactRecord } from "@/lib/crm-import/types";

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

  console.log("Trust-killer checks (must be zero before paid customer)");
  const tkOk = (n: number) => (n === 0 ? "OK" : "BLOCKING");
  console.log(`  company == contact name      ${String(gregGreg).padStart(4)}   ${tkOk(gregGreg)}   (Greg · Greg render)`);
  console.log(`  no actionable channel        ${String(noChannel).padStart(4)}   ${tkOk(noChannel)}`);
  console.log(`  blank name                   ${String(blankNames).padStart(4)}   ${tkOk(blankNames)}`);
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

  // ── Founder verdict ─────────────────────────────────────────────
  console.log("Founder verdict");
  const verdicts: string[] = [];
  if (gregGreg > 0) {
    verdicts.push(`BLOCKING: ${gregGreg} contacts still render "Greg · Greg" (legacy normalizer corruption).`);
  }
  if (noChannel > 0) {
    verdicts.push(`BLOCKING: ${noChannel} contacts have no actionable channel — these will show as untouchable on cards.`);
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
