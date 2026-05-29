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

/**
 * Status / category / tag-column values that some CRMs leak into the
 * Last Name field. If an assembled "name" is one of these, OR contains
 * any of these as a whole-word substring, the source row is not a
 * person record — refuse to write a name repair using it.
 *
 * Address repairs are unaffected: an address can still be canonical
 * even if the name field is polluted (different row, different
 * column, address might be intact).
 */
const NAME_STOP_PHRASES: ReadonlyArray<string> = [
  "no status",
  "active",
  "inactive",
  "past client",
  "past clients",
  "current client",
  "lead",
  "leads",
  "buyer",
  "buyers",
  "seller",
  "sellers",
  "prospect",
  "prospects",
  "client",
  "clients",
  "customer",
  "customers",
  "vendor",
  "partner",
  "referral",
  "referrer",
  "sphere",
  "soi",
  "coi",
  "vip",
  "cold",
  "warm",
  "hot",
  "do not contact",
  "dnc",
  "follow up",
  "follow-up",
  "qualified",
  "unqualified",
  "open",
  "closed",
  "pending",
  "archived",
  "won",
  "lost",
  "tbd",
  "n/a",
  "na",
  "none",
  "null",
  "test",
  "unknown",
  "new",
  "imported",
  "unassigned",
  "type",
  "category",
  "status",
  "stage",
  "tag",
  "tags",
  "label",
  "labels",
  "group",
  "groups",
  "list",
  "lists",
];

/**
 * Strict person-name validator. Accepts names like "Susie Adams",
 * "RaShondra Banks", "Leah B. Barnett". Rejects "No Status", "Active",
 * "Past Client", "Lead", "Buyer", "Seller", "Prospect", single tokens,
 * names whose first or last token isn't alphabetic, names containing
 * any stop-phrase as a whole-word substring.
 */
function looksLikePersonName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (trimmed.length < 3) return false;
  const lower = trimmed.toLowerCase();

  // Exact match against any stop phrase.
  for (const phrase of NAME_STOP_PHRASES) {
    if (lower === phrase) return false;
  }
  // Whole-word substring containment.
  for (const phrase of NAME_STOP_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    if (new RegExp(`(^|\\W)${escaped}($|\\W)`, "i").test(lower)) return false;
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;

  const firstToken = tokens[0].replace(/[.,]/g, "");
  const lastToken = tokens[tokens.length - 1].replace(/[.,]/g, "");

  // First and last token must each be a word starting with a letter,
  // ≥2 chars, letters / hyphens / apostrophes only. Unicode letter
  // class covers extended ASCII (María, García, Søren, Ðejan, etc.)
  // and CJK characters.
  const alphabeticWord = /^\p{L}[\p{L}'\-]+$/u;
  if (!alphabeticWord.test(firstToken)) return false;
  if (!alphabeticWord.test(lastToken)) return false;

  return true;
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

interface RejectedNameRepair {
  contactId: string;
  contactName: string;
  matchKey: "email" | "phone";
  matchValue: string;
  rejectedName: string;
  reason: string;
}

interface PlanOutcome {
  plan: PlannedRepair | null;
  rejected: RejectedNameRepair | null;
}

function planRepair(
  contact: CrmContactRecord,
  index: SourceIndex,
): PlanOutcome {
  const existingNameOk = hasSurname(contact.name);
  const existingAddrOk = addressCanonicalizes(contact.address);
  if (existingNameOk && existingAddrOk) return { plan: null, rejected: null };

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
  if (!match) return { plan: null, rejected: null };

  // ── Name repair candidate ────────────────────────────────────
  let nameRepair: PlannedRepair["nameRepair"] = null;
  let rejected: RejectedNameRepair | null = null;
  if (!existingNameOk && hasSurname(match.name) && match.name !== contact.name) {
    if (looksLikePersonName(match.name)) {
      nameRepair = { from: contact.name ?? "", to: match.name };
    } else {
      // Surname-bearing but matches a status/category vocabulary. The
      // source row's "name" came from a non-name column. Do NOT plan
      // a name repair; report it.
      rejected = {
        contactId: contact.id,
        contactName: contact.name ?? "(unnamed)",
        matchKey,
        matchValue,
        rejectedName: match.name,
        reason: "source name fails person-name validator (status / category / non-name column)",
      };
    }
  }

  // ── Address repair candidate ────────────────────────────────
  // Independent of the name decision. Operator explicitly allowed
  // address repairs to proceed even when name repair is rejected.
  let addressRepair: PlannedRepair["addressRepair"] = null;
  if (
    !existingAddrOk &&
    match.address &&
    addressCanonicalizes(match.address) &&
    match.address !== contact.address
  ) {
    addressRepair = { from: contact.address ?? "", to: match.address };
  }

  if (!nameRepair && !addressRepair) {
    return { plan: null, rejected };
  }

  return {
    plan: {
      contactId: contact.id,
      contactName: contact.name ?? "(unnamed)",
      matchKey,
      matchValue,
      nameRepair,
      addressRepair,
    },
    rejected,
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
  rejectedNameRepairs: number;
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
    rejectedNameRepairs: 0,
    writes: { applied: 0, missing: 0 },
    unmatchedContactIds: [],
  };
  const plans: PlannedRepair[] = [];
  const rejectedNameRepairs: RejectedNameRepair[] = [];
  const sourceRowMatchCount = new Map<string, number>();

  for (const c of contacts) {
    if (hasSurname(c.name) && addressCanonicalizes(c.address)) {
      summary.alreadyHealthy += 1;
      continue;
    }
    const { plan, rejected } = planRepair(c, index);
    if (rejected) rejectedNameRepairs.push(rejected);
    if (!plan) {
      // No plan AND no rejection → genuinely no identity match.
      // No plan WITH rejection → matched but name failed validation
      // AND no address upgrade available; treat as no-write.
      if (!rejected) {
        summary.noIdentityMatch += 1;
        summary.unmatchedContactIds.push(c.id);
      }
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
  summary.rejectedNameRepairs = rejectedNameRepairs.length;

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
  console.log(`  rejected name candidates:      ${summary.rejectedNameRepairs}  (source name failed person-name validator)`);
  console.log(`  duplicate contacts matched to same source row: ${summary.duplicateSourceMatches}`);
  console.log("");

  if (rejectedNameRepairs.length > 0) {
    console.log(`Rejected name repairs (showing up to 15):`);
    console.log(`  These contacts matched a source row by identity, but the source row's`);
    console.log(`  assembled "name" failed the person-name validator (looks like a status,`);
    console.log(`  category, tag, or non-name column value). NO name repair is planned for`);
    console.log(`  these contacts. Address repair may still be planned separately if the`);
    console.log(`  source row's address canonicalizes.`);
    console.log("");
    for (const r of rejectedNameRepairs.slice(0, 15)) {
      console.log(`  ${r.contactId.slice(0, 28).padEnd(28)} [${r.matchKey}]`);
      console.log(`    existing name:  "${r.contactName}"`);
      console.log(`    source name:    "${r.rejectedName}"  ← rejected`);
      console.log(`    reason:         ${r.reason}`);
    }
    if (rejectedNameRepairs.length > 15) {
      console.log(`  ... ${rejectedNameRepairs.length - 15} more rejected`);
    }
    console.log("");
  }
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
