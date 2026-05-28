/**
 * rehab-truncated-from-csv — minimum repair pass.
 *
 * Re-import via the canonical pipeline only updates contacts where
 * identity resolution finds a match (email/phone). Historical
 * contacts whose identity signals don't match incoming rows stay
 * truncated forever. This script closes that gap by applying the
 * existing append-only repair-overlay (the same one Sprint 4
 * built for founder-typed corrections) to upgrade single-token
 * names and street-only addresses to assembled values using a
 * direct lookup against the source CSV.
 *
 * What it does:
 *   1. Parses the source WiseAgent CSV through the current
 *      importer (multi-column assembly → "Susie Adams" +
 *      canonical address).
 *   2. Indexes the assembled rows by normalized email and
 *      normalized phone.
 *   3. Walks every visible contact in the workspace.
 *   4. For each contact whose name is single-token OR whose
 *      address fails canonicalization, looks up the matching
 *      source row. Falls through email → phone in that order.
 *   5. If a match is found AND the source has an assembled value
 *      better than the existing, appends a repair entry via
 *      `applyContactRepairNeon` so the read-time overlay
 *      surfaces the assembled value going forward.
 *
 * What it does NOT do:
 *   • Does not insert any new contacts.
 *   • Does not delete or merge duplicate contacts.
 *   • Does not overwrite `normalized.*` directly — the repair
 *     overlay preserves the original truncated value as audit.
 *   • Does not write any record without an identity match.
 *
 * Defaults to dry-run. `--write` persists the repairs.
 *
 * Usage:
 *   npm run rehab-truncated-from-csv -- \
 *     --customer=nicole-lonergan \
 *     --source=/path/to/wiseagent-export.csv \
 *     [--write]
 */

import { promises as fs } from "node:fs";
import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import {
  applyContactRepairNeon,
  listContactsNeon,
} from "@/lib/crm-import/crmContactsNeonAdapter";
import { filterOutInternalDiagnosticContacts } from "@/lib/crm-import/internalContactFilter";
import { parseCsv } from "@/lib/ingestion/csvParser";
import {
  detectColumnMapping,
  normalizeCrmRows,
} from "@/lib/crm-import/normalize";
import {
  assertWorkspaceSlug,
  getCrmDatabaseUrl,
} from "@/lib/crm-import/storageConfig";
import type {
  ContactRepair,
  CrmContactRecord,
  NormalizedCrmContact,
} from "@/lib/crm-import/types";

interface Args {
  customer: string;
  source: string;
  write: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let customer = "";
  let source = "";
  let write = false;
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a.startsWith("--source=")) source = a.slice("--source=".length);
    else if (a === "--write") write = true;
  }
  if (!customer || !source) {
    console.error(
      "Usage: rehab-truncated-from-csv -- --customer=<workspace-slug> --source=<csv-path> [--write]",
    );
    process.exit(2);
  }
  return { customer, source, write };
}

function hasSurname(name: string | null): boolean {
  if (!name) return false;
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  let i = tokens.length - 1;
  while (i >= 0 && tokens[i].replace(/[.,]/g, "").length <= 1) i--;
  return i > 0;
}

function addressCanonicalizes(addr: string | null): boolean {
  if (!addr || !addr.trim()) return false;
  try {
    const normalized = normalizeAddress(addr);
    if (detectWeakAddress(normalized)) return false;
    return canonicalPropertyKey(normalized).length > 0;
  } catch {
    return false;
  }
}

interface SourceIndex {
  byEmail: Map<string, NormalizedCrmContact>;
  byPhone: Map<string, NormalizedCrmContact>;
}

function indexSource(rows: NormalizedCrmContact[]): SourceIndex {
  const byEmail = new Map<string, NormalizedCrmContact>();
  const byPhone = new Map<string, NormalizedCrmContact>();
  for (const r of rows) {
    if (r.normalizedEmail) byEmail.set(r.normalizedEmail.toLowerCase(), r);
    if (r.normalizedPhone) byPhone.set(r.normalizedPhone, r);
  }
  return { byEmail, byPhone };
}

interface PlannedRepair {
  contactId: string;
  contactName: string;
  matchKey: "email" | "phone";
  matchValue: string;
  nameRepair: { from: string; to: string } | null;
  addressRepair: { from: string; to: string } | null;
}

function planRepair(
  contact: CrmContactRecord,
  index: SourceIndex,
): PlannedRepair | null {
  const existingNameOk = hasSurname(contact.name);
  const existingAddrOk = addressCanonicalizes(contact.address);
  if (existingNameOk && existingAddrOk) return null;

  // Identity lookup: email first, then phone.
  let match: NormalizedCrmContact | undefined;
  let matchKey: "email" | "phone" = "email";
  let matchValue = "";
  if (contact.normalizedEmail) {
    const m = index.byEmail.get(contact.normalizedEmail.toLowerCase());
    if (m) {
      match = m;
      matchKey = "email";
      matchValue = contact.normalizedEmail;
    }
  }
  if (!match && contact.normalizedPhone) {
    const m = index.byPhone.get(contact.normalizedPhone);
    if (m) {
      match = m;
      matchKey = "phone";
      matchValue = contact.normalizedPhone;
    }
  }
  if (!match) return null;

  // Decide which fields to repair.
  let nameRepair: PlannedRepair["nameRepair"] = null;
  if (!existingNameOk && hasSurname(match.name) && match.name !== contact.name) {
    nameRepair = { from: contact.name ?? "", to: match.name };
  }
  let addressRepair: PlannedRepair["addressRepair"] = null;
  if (
    !existingAddrOk &&
    match.address &&
    addressCanonicalizes(match.address) &&
    match.address !== contact.address
  ) {
    addressRepair = { from: contact.address ?? "", to: match.address };
  }
  if (!nameRepair && !addressRepair) return null;

  return {
    contactId: contact.id,
    contactName: contact.name ?? "(unnamed)",
    matchKey,
    matchValue,
    nameRepair,
    addressRepair,
  };
}

interface Summary {
  visible: number;
  alreadyHealthy: number;
  noIdentityMatch: number;
  duplicateSourceMatches: number;
  planned: number;
  nameRepairs: number;
  addressRepairs: number;
  writes: { applied: number; missing: number };
  unmatchedContactIds: string[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertWorkspaceSlug(args.customer);
  if (!getCrmDatabaseUrl()) {
    console.error("Set DATABASE_URL or POSTGRES_URL before running rehab-truncated-from-csv");
    process.exit(1);
  }

  // ── Load + assemble the source CSV ──────────────────────────────
  const text = await fs.readFile(args.source, "utf8");
  const parsed = parseCsv(text);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const mapping = detectColumnMapping(headers);
  const sourceRows = normalizeCrmRows(parsed, mapping, "wise_agent_rehab");
  const index = indexSource(sourceRows);

  // ── Load the workspace's existing contacts ──────────────────────
  const allContacts = await listContactsNeon(args.customer);
  const contacts = filterOutInternalDiagnosticContacts(allContacts);

  // ── Plan repairs ───────────────────────────────────────────────
  const summary: Summary = {
    visible: contacts.length,
    alreadyHealthy: 0,
    noIdentityMatch: 0,
    duplicateSourceMatches: 0,
    planned: 0,
    nameRepairs: 0,
    addressRepairs: 0,
    writes: { applied: 0, missing: 0 },
    unmatchedContactIds: [],
  };
  const plans: PlannedRepair[] = [];
  const sourceRowMatchCount = new Map<string, number>();

  for (const c of contacts) {
    if (hasSurname(c.name) && addressCanonicalizes(c.address)) {
      summary.alreadyHealthy += 1;
      continue;
    }
    const plan = planRepair(c, index);
    if (!plan) {
      summary.noIdentityMatch += 1;
      summary.unmatchedContactIds.push(c.id);
      continue;
    }
    const key = `${plan.matchKey}:${plan.matchValue}`;
    sourceRowMatchCount.set(key, (sourceRowMatchCount.get(key) ?? 0) + 1);
    plans.push(plan);
  }

  for (const [, n] of sourceRowMatchCount) {
    if (n > 1) summary.duplicateSourceMatches += n - 1;
  }
  summary.planned = plans.length;
  summary.nameRepairs = plans.filter((p) => p.nameRepair).length;
  summary.addressRepairs = plans.filter((p) => p.addressRepair).length;

  // ── Report ─────────────────────────────────────────────────────
  console.log("");
  console.log(`rehab-truncated-from-csv  ${args.customer}`);
  console.log(`source: ${args.source}  (${sourceRows.length} assembled rows; ${index.byEmail.size} by email, ${index.byPhone.size} by phone)`);
  console.log("================");
  console.log(`  visible contacts:              ${summary.visible}`);
  console.log(`  already healthy (skip):        ${summary.alreadyHealthy}`);
  console.log(`  no identity match (skip):      ${summary.noIdentityMatch}`);
  console.log(`  planned repairs:               ${summary.planned}`);
  console.log(`    name repairs                  ${summary.nameRepairs}`);
  console.log(`    address repairs               ${summary.addressRepairs}`);
  console.log(`  duplicate contacts matched to same source row: ${summary.duplicateSourceMatches}`);
  console.log("");
  if (plans.length > 0) {
    console.log(`Sample planned repairs (showing up to 10):`);
    for (const p of plans.slice(0, 10)) {
      console.log(`  ${p.contactId.slice(0, 28).padEnd(28)} [${p.matchKey}]`);
      if (p.nameRepair) {
        console.log(`    name:    "${p.nameRepair.from}" → "${p.nameRepair.to}"`);
      }
      if (p.addressRepair) {
        console.log(`    address: "${p.addressRepair.from}" → "${p.addressRepair.to}"`);
      }
    }
    if (plans.length > 10) console.log(`  ... ${plans.length - 10} more`);
    console.log("");
  }

  if (!args.write) {
    console.log("This is a DRY RUN. No data was modified.");
    console.log("To persist the repairs:");
    console.log(`  npm run rehab-truncated-from-csv -- --customer=${args.customer} --source=${args.source} --write`);
    console.log("");
    if (summary.noIdentityMatch > 0) {
      console.log(`Note: ${summary.noIdentityMatch} contacts could not be matched to any source row`);
      console.log(`by email or phone. Those rows stay truncated unless the source CSV is`);
      console.log(`expanded or the contact's CRM truth is corrected.`);
    }
    return;
  }

  // ── Write path ──────────────────────────────────────────────────
  const now = new Date().toISOString();
  for (const plan of plans) {
    const note = `auto-rehab from ${args.source} (matched by ${plan.matchKey})`;
    if (plan.nameRepair) {
      const repair: ContactRepair = {
        field: "name",
        originalValue: plan.nameRepair.from,
        newValue: plan.nameRepair.to,
        source: "founder_rehab",
        repairedAt: now,
        note,
      };
      const ok = await applyContactRepairNeon(args.customer, plan.contactId, repair);
      if (ok) summary.writes.applied += 1;
      else summary.writes.missing += 1;
    }
    if (plan.addressRepair) {
      const repair: ContactRepair = {
        field: "address",
        originalValue: plan.addressRepair.from,
        newValue: plan.addressRepair.to,
        source: "founder_rehab",
        repairedAt: now,
        note,
      };
      const ok = await applyContactRepairNeon(args.customer, plan.contactId, repair);
      if (ok) summary.writes.applied += 1;
      else summary.writes.missing += 1;
    }
  }

  console.log("rehab-truncated-from-csv complete", {
    customer: args.customer,
    plannedRepairs: summary.planned,
    repairsApplied: summary.writes.applied,
    repairsMissing: summary.writes.missing,
    contactsAlreadyHealthy: summary.alreadyHealthy,
    contactsWithoutMatch: summary.noIdentityMatch,
    duplicateClusters: summary.duplicateSourceMatches,
  });
  console.log("");
  console.log("Next steps:");
  console.log(`  npm run check-grounding-quality -- --customer=${args.customer}`);
  console.log("Expected: surname coverage and canonical-address coverage jump");
  console.log("to roughly the planned-repair count plus the already-healthy count.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
