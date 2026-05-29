/**
 * rebuild-workspace-from-csv — destructive workspace rebuild from a
 * canonical CRM CSV. Mirrors the canonical preview/execute path:
 *   parseCsv → detectColumnMapping → normalizeCrmRows → mintContactId
 *
 * Uses existing Neon adapters via destructivelyReplaceWorkspaceContactsNeon.
 * Auto-creates a backup before any destructive write.
 *
 * Safety gates:
 *   • --confirm="REBUILD <slug>" required for live writes
 *   • Refuses to run if any workspace_contact_parcel_link exists for
 *     the workspace
 *   • Auto-creates backup file before destructive replace
 *   • Dry-run mode (default when --confirm is absent) writes nothing
 *
 * Usage:
 *   npm run rebuild-workspace-from-csv -- \
 *     --customer=nicole-lonergan \
 *     --source=/path/to/wiseagent.csv \
 *     [--dry-run]                             # explicit dry-run
 *     [--confirm="REBUILD nicole-lonergan"]   # required for live write
 *     [--preserve-non-csv-contacts]           # include workspace-only
 *                                             # contacts in rebuilt set
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/ingestion/csvParser";
import {
  detectColumnMapping,
  normalizeCrmRows,
} from "@/lib/crm-import/normalize";
import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import { mintContactId } from "@/lib/crm-import/identityKey";
import {
  destructivelyReplaceWorkspaceContactsNeon,
  listContactsNeon,
} from "@/lib/crm-import/crmContactsNeonAdapter";
import { readWorkspaceLinkAudit } from "@/lib/enrichment/public-records/canonicalStorage/auditView";
import {
  assertWorkspaceSlug,
  getCrmDatabaseUrl,
} from "@/lib/crm-import/storageConfig";
import { computeRelationshipScore } from "@/lib/relationship-intelligence/scoring";
import { scoreMetadataForImport } from "@/lib/crm-import/scoreTransparency";
import type {
  CrmContactRecord,
  NormalizedCrmContact,
} from "@/lib/crm-import/types";
import { createWorkspaceBackup } from "./backup-workspace";

interface Args {
  customer: string;
  source: string;
  dryRun: boolean;
  confirm: string | null;
  preserveNonCsv: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let customer = "";
  let source = "";
  let dryRun = false;
  let confirm: string | null = null;
  let preserveNonCsv = false;
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a.startsWith("--source=")) source = a.slice("--source=".length);
    else if (a === "--dry-run") dryRun = true;
    else if (a.startsWith("--confirm=")) confirm = a.slice("--confirm=".length);
    else if (a === "--preserve-non-csv-contacts") preserveNonCsv = true;
  }
  if (!customer || !source) {
    console.error(
      [
        "Usage: rebuild-workspace-from-csv -- \\",
        "         --customer=<workspace-slug> \\",
        "         --source=<csv-path> \\",
        "         [--dry-run | --confirm=\"REBUILD <slug>\"] \\",
        "         [--preserve-non-csv-contacts]",
      ].join("\n"),
    );
    process.exit(2);
  }
  return { customer, source, dryRun, confirm, preserveNonCsv };
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

function hasChannel(c: { phone: string | null; email: string | null; normalizedPhone: string | null; normalizedEmail: string | null }): boolean {
  return Boolean(c.phone || c.normalizedPhone || c.email || c.normalizedEmail);
}

interface BuildOutcome {
  records: CrmContactRecord[];
  duplicatesCollapsedInCsv: number;
  rejectedRows: number;
}

function buildRecordsFromNormalizedRows(
  rows: ReadonlyArray<NormalizedCrmContact>,
  workspaceId: string,
  importJobId: string,
  nowIso: string,
): BuildOutcome {
  // Identity-derived IDs collapse same-identity CSV rows into one record.
  // First-write-wins for in-CSV duplicates so the rebuild is byte-stable.
  const recordsById = new Map<string, CrmContactRecord>();
  let duplicatesCollapsedInCsv = 0;
  let rejectedRows = 0;
  for (const row of rows) {
    if (row.validationErrors.length > 0) {
      rejectedRows += 1;
      continue;
    }
    const minted = mintContactId(workspaceId, row, { importJobId });
    if (recordsById.has(minted.id)) {
      duplicatesCollapsedInCsv += 1;
      continue;
    }
    const score = computeRelationshipScore({
      lastInteractionAt: row.lastInteractionAt,
      tags: row.tags,
      hasPhone: Boolean(row.normalizedPhone),
      hasEmail: Boolean(row.normalizedEmail),
      notesLength: row.notes?.length ?? 0,
      dataTrust: row.dataTrust,
    });
    const record: CrmContactRecord = {
      id: minted.id,
      workspaceId,
      importJobId,
      name: row.name,
      company: row.company,
      phone: row.phone,
      email: row.email,
      address: row.address,
      notes: row.notes,
      tags: row.tags,
      lastInteractionAt: row.lastInteractionAt,
      sourceCrm: row.sourceCrm,
      normalizedPhone: row.normalizedPhone,
      normalizedEmail: row.normalizedEmail,
      normalizedCompany: row.normalizedCompany,
      normalizedName: row.normalizedName,
      dataTrust: row.dataTrust,
      relationshipScore: score.total,
      scoreMetadata: {
        ...scoreMetadataForImport(score),
        sourceFieldsUsed: [
          ...(row.lastInteractionAt ? ["lastInteractionAt"] : []),
          ...(row.tags.length > 0 ? ["tags"] : []),
          ...(row.notes?.trim() ? ["notes"] : []),
          ...(row.normalizedPhone ? ["phone"] : []),
          ...(row.normalizedEmail ? ["email"] : []),
          ...(row.company?.trim() ? ["company"] : []),
          ...(row.name?.trim() ? ["name"] : []),
        ],
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    recordsById.set(minted.id, record);
  }
  return {
    records: Array.from(recordsById.values()),
    duplicatesCollapsedInCsv,
    rejectedRows,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertWorkspaceSlug(args.customer);
  if (!getCrmDatabaseUrl()) {
    console.error("DATABASE_URL / POSTGRES_URL not configured. Set it in .env.local and retry.");
    process.exit(1);
  }

  const isDryRun = args.dryRun || args.confirm === null;
  const expectedConfirm = `REBUILD ${args.customer}`;
  if (!isDryRun && args.confirm !== expectedConfirm) {
    console.error(`Refusing to rebuild without --confirm="${expectedConfirm}".`);
    console.error(`Provided: ${args.confirm === null ? "(none)" : JSON.stringify(args.confirm)}`);
    process.exit(1);
  }

  console.log("");
  console.log(`rebuild-workspace-from-csv  ${args.customer}`);
  console.log("================");
  console.log(`  mode:                ${isDryRun ? "DRY-RUN (no writes)" : "LIVE (will destroy + rebuild)"}`);
  console.log(`  source CSV:          ${args.source}`);

  // ── Pre-flight 1: read current workspace state ───────────────────
  const existing = await listContactsNeon(args.customer);
  console.log(`  current contact count: ${existing.length}`);

  // ── Pre-flight 2: refuse if any active parcel links exist ────────
  const linkAudit = await readWorkspaceLinkAudit(args.customer);
  if (linkAudit.totalActiveLinks > 0) {
    console.error("");
    console.error(`REFUSING: ${linkAudit.totalActiveLinks} active workspace_contact_parcel_links exist.`);
    console.error("Destructive rebuild would orphan them. Clean up the links first.");
    process.exit(1);
  }
  console.log(`  active parcel links:   ${linkAudit.totalActiveLinks}  (safe)`);

  // ── Parse CSV through the canonical importer ────────────────────
  const text = await fs.readFile(args.source, "utf8");
  const parsed = parseCsv(text);
  const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
  const mapping = detectColumnMapping(headers);
  const normalizedRows = normalizeCrmRows(parsed, mapping, "wise_agent_rebuild");
  console.log(`  CSV rows parsed:       ${parsed.length}`);
  console.log(`  normalized rows:       ${normalizedRows.length}`);

  // ── Identify workspace-only contacts (not in CSV by email) ──────
  const csvEmails = new Set<string>();
  for (const r of normalizedRows) {
    const e = (r.normalizedEmail ?? "").trim().toLowerCase();
    if (e) csvEmails.add(e);
  }
  const workspaceOnlyContacts: CrmContactRecord[] = [];
  for (const c of existing) {
    const e = (c.normalizedEmail ?? "").trim().toLowerCase();
    if (e && !csvEmails.has(e)) workspaceOnlyContacts.push(c);
  }

  // ── Build the proposed rebuilt corpus ──────────────────────────
  const rebuildJobId = `rebuild-${args.customer}-${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();
  const csvBuild = buildRecordsFromNormalizedRows(
    normalizedRows,
    args.customer,
    rebuildJobId,
    nowIso,
  );

  let preservedRecords: CrmContactRecord[] = [];
  const distinctWorkspaceOnlyEmails = new Set<string>(
    workspaceOnlyContacts
      .map((c) => (c.normalizedEmail ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (args.preserveNonCsv) {
    // Collapse workspace-only contacts by email first-wins; preserve the
    // earliest-created record per email.
    const byEmail = new Map<string, CrmContactRecord>();
    for (const c of [...workspaceOnlyContacts].sort((a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    )) {
      const e = (c.normalizedEmail ?? "").trim().toLowerCase();
      if (e && !byEmail.has(e)) byEmail.set(e, c);
    }
    preservedRecords = Array.from(byEmail.values());
  }
  const proposedRecords: CrmContactRecord[] = [
    ...csvBuild.records,
    ...preservedRecords,
  ];

  // ── Projected metrics ──────────────────────────────────────────
  const projectedGregGreg = proposedRecords.filter(
    (r) => r.name && r.company && r.name.trim().toLowerCase() === r.company.trim().toLowerCase(),
  ).length;
  const projectedWithSurname = proposedRecords.filter((r) => hasSurname(r.name)).length;
  const projectedCanonicalAddrs = proposedRecords.filter((r) => addressCanonicalizes(r.address)).length;
  const projectedParcelEligible = proposedRecords.filter(
    (r) => hasSurname(r.name) && addressCanonicalizes(r.address) && hasChannel(r),
  ).length;
  const projectedIdentityDerived = proposedRecords.filter((r) =>
    /^crm-[a-z0-9_-]+-[0-9a-f]{12}$/.test(r.id),
  ).length;
  const projectedDistinctEmails = new Set(
    proposedRecords
      .map((r) => (r.normalizedEmail ?? "").trim().toLowerCase())
      .filter(Boolean),
  ).size;

  console.log("");
  console.log("Projected rebuilt corpus");
  console.log(`  total contacts:            ${proposedRecords.length}`);
  console.log(`    from CSV:                 ${csvBuild.records.length}  (after collapsing ${csvBuild.duplicatesCollapsedInCsv} in-CSV duplicates, rejecting ${csvBuild.rejectedRows} invalid rows)`);
  console.log(`    preserved (non-CSV):      ${preservedRecords.length}  ${args.preserveNonCsv ? "(operator opted in)" : "(use --preserve-non-csv-contacts to include)"}`);
  console.log(`  identity-derived IDs:      ${projectedIdentityDerived}`);
  console.log(`  distinct emails:           ${projectedDistinctEmails}`);
  console.log(`  Greg=Greg corruption:      ${projectedGregGreg}`);
  console.log(`  with surname:              ${projectedWithSurname}  (${proposedRecords.length === 0 ? "0" : Math.round(100 * projectedWithSurname / proposedRecords.length)}%)`);
  console.log(`  with canonical address:    ${projectedCanonicalAddrs}  (${proposedRecords.length === 0 ? "0" : Math.round(100 * projectedCanonicalAddrs / proposedRecords.length)}%)`);
  console.log(`  parcel-eligible:           ${projectedParcelEligible}`);

  // ── Workspace-only contacts inspection ─────────────────────────
  console.log("");
  console.log("Workspace contacts NOT in source CSV (by email)");
  console.log(`  distinct workspace-only emails: ${distinctWorkspaceOnlyEmails.size}`);
  console.log(`  rows holding those emails:      ${workspaceOnlyContacts.length}`);
  if (workspaceOnlyContacts.length > 0) {
    console.log("  Inspection (up to 10):");
    for (const c of workspaceOnlyContacts.slice(0, 10)) {
      const looksSynthetic =
        /^persist@/.test(c.normalizedEmail ?? "") ||
        /test|example|persist|sample|placeholder/i.test(c.normalizedEmail ?? "") ||
        /test|persist|placeholder/i.test(c.name ?? "");
      console.log(`    id:    ${c.id}`);
      console.log(`    name:  ${JSON.stringify(c.name)}`);
      console.log(`    email: ${JSON.stringify(c.email)}`);
      console.log(`    phone: ${JSON.stringify(c.phone)}`);
      console.log(`    addr:  ${JSON.stringify(c.address)}`);
      console.log(`    tags:  ${JSON.stringify(c.tags ?? [])}`);
      console.log(`    notes: ${JSON.stringify((c.notes ?? "").slice(0, 80))}`);
      console.log(`    looks_synthetic: ${looksSynthetic ? "YES" : "no"}`);
      console.log("");
    }
    if (workspaceOnlyContacts.length > 10) {
      console.log(`    ... ${workspaceOnlyContacts.length - 10} more`);
    }
    if (!args.preserveNonCsv) {
      console.log("  DECISION REQUIRED: pass --preserve-non-csv-contacts to retain these");
      console.log("    in the rebuild, OR omit the flag to let them be discarded.");
    }
  }

  // ── Public-record link audit (must be 0) ───────────────────────
  console.log("");
  console.log(`Active workspace_contact_parcel_links: ${linkAudit.totalActiveLinks}  ${linkAudit.totalActiveLinks === 0 ? "(safe)" : "(WOULD ORPHAN — refused)"}`);

  console.log("");
  console.log(`Backup would be created: ${isDryRun ? "(no — dry-run)" : "YES (auto-created before destructive write)"}`);

  if (isDryRun) {
    console.log("");
    console.log("DRY-RUN complete. No writes performed.");
    console.log("");
    console.log("To execute the rebuild, re-run with:");
    console.log(`  --confirm="${expectedConfirm}"`);
    if (workspaceOnlyContacts.length > 0 && !args.preserveNonCsv) {
      console.log("  [optionally add --preserve-non-csv-contacts]");
    }
    return;
  }

  // ── LIVE PATH ──────────────────────────────────────────────────
  console.log("");
  console.log("LIVE REBUILD ─ Step 1: create backup");
  const backup = await createWorkspaceBackup(args.customer);
  console.log(`  backup file:    ${backup.path}`);
  console.log(`  rows in backup: ${backup.rowCount}`);
  if (backup.rowCount !== existing.length) {
    console.error(`  REFUSING: backup row count (${backup.rowCount}) differs from pre-read count (${existing.length}). Concurrent mutation detected.`);
    process.exit(1);
  }

  console.log("");
  console.log("LIVE REBUILD ─ Step 2: destructive replace");
  console.log(`  deleting ${existing.length} rows; inserting ${proposedRecords.length} fresh rows`);
  await destructivelyReplaceWorkspaceContactsNeon(args.customer, proposedRecords);
  console.log("  destructive replace complete");

  console.log("");
  console.log("LIVE REBUILD ─ Step 3: verify");
  const after = await listContactsNeon(args.customer);
  console.log(`  contacts after rebuild: ${after.length}`);
  if (after.length !== proposedRecords.length) {
    console.error(`  WARNING: post-rebuild count (${after.length}) does not match proposed count (${proposedRecords.length}).`);
    console.error("  Inspect the workspace state immediately and restore from backup if needed.");
    process.exit(1);
  }

  console.log("");
  console.log("Rebuild complete.");
  console.log("");
  console.log("Next:");
  console.log(`  npm run workspace-forensics -- --customer=${args.customer} --source="${args.source}"`);
  console.log(`  npm run check-grounding-quality -- --customer=${args.customer}`);
  console.log(`  npm run crm:audit -- --customer=${args.customer}`);
  console.log("");
  console.log(`Backup retained at: ${backup.path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
