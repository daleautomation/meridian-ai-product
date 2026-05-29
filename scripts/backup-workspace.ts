/**
 * backup-workspace — read-only export of a workspace's contacts to a
 * timestamped local JSON file. Uses the existing Neon adapter via
 * `listContactsByWorkspace`. No psql, no new connection layer.
 *
 * Usage:
 *   npm run backup-workspace -- --customer=nicole-lonergan
 *
 * Output:
 *   data/backups/<customer>-<iso-timestamp>.json
 *
 * The backup JSON contains every CrmContactRecord field returned by the
 * adapter, including normalized fields, source_metadata (with repairs +
 * enrichment), dataTrust, scoreMetadata, createdAt/updatedAt — i.e.
 * everything needed to restore via upsertContactsNeon.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { listContactsByWorkspace } from "@/lib/crm-import/store";
import {
  assertWorkspaceSlug,
  getCrmDatabaseUrl,
} from "@/lib/crm-import/storageConfig";

interface Args {
  customer: string;
  outDir: string;
}

function parseArgs(argv: readonly string[]): Args {
  let customer = "";
  let outDir = path.join("data", "backups");
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a.startsWith("--out-dir=")) outDir = a.slice("--out-dir=".length);
  }
  if (!customer) {
    console.error("Usage: backup-workspace -- --customer=<workspace-slug> [--out-dir=<dir>]");
    process.exit(2);
  }
  return { customer, outDir };
}

export async function createWorkspaceBackup(
  customer: string,
  outDir: string = path.join("data", "backups"),
): Promise<{ path: string; rowCount: number }> {
  assertWorkspaceSlug(customer);
  if (!getCrmDatabaseUrl()) {
    throw new Error("DATABASE_URL / POSTGRES_URL not configured");
  }
  const contacts = await listContactsByWorkspace(customer);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${customer}-${ts}.json`);
  const payload = {
    backupCreatedAt: new Date().toISOString(),
    workspaceId: customer,
    rowCount: contacts.length,
    contacts,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  return { path: outPath, rowCount: contacts.length };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await createWorkspaceBackup(args.customer, args.outDir);
  console.log("");
  console.log(`backup-workspace  ${args.customer}`);
  console.log("================");
  console.log(`  rows backed up:  ${result.rowCount}`);
  console.log(`  file path:       ${result.path}`);
  console.log("");
  console.log("Restore (if needed):");
  console.log(`  node -e "const fs = require('fs'); const path = '${result.path}';`);
  console.log(`           const data = JSON.parse(fs.readFileSync(path, 'utf8'));`);
  console.log(`           // then pass data.contacts to upsertContactsNeon(...) or`);
  console.log(`           // destructivelyReplaceWorkspaceContactsNeon(...) via a`);
  console.log(`           // small admin script."`);
  console.log("");
  console.log("Or hold the backup file as audit-only insurance; the rebuild script");
  console.log("does not require an explicit restore path to validate.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
