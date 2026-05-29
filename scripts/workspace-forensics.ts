/**
 * workspace-forensics — read-only audit of a workspace's contact corpus.
 *
 * Uses the existing Neon connection layer via `listContactsByWorkspace`.
 * No psql. No new architecture. Pure analysis on the same data the
 * existing audit scripts read.
 *
 * Reports:
 *   SECTION A — total / distinct identities / inflation / % unique
 *   SECTION B — cluster-size distribution + largest clusters
 *   SECTION C — ID-shape distribution (legacy rowIndex vs identity-derived)
 *   SECTION D — workspace vs source CSV email overlap (when --source given)
 *   SECTION E — company == name corruption concentration in duplicate clusters
 *
 * Usage:
 *   npm run workspace-forensics -- --customer=nicole-lonergan \
 *     [--source=/path/to/wiseagent.csv]
 *
 * If --source is omitted, SECTION D is skipped with a notice.
 */

import { promises as fs } from "node:fs";
import { listContactsByWorkspace } from "@/lib/crm-import/store";
import { parseCsv } from "@/lib/ingestion/csvParser";
import {
  detectColumnMapping,
  normalizeCrmRows,
} from "@/lib/crm-import/normalize";
import {
  assertWorkspaceSlug,
  getCrmDatabaseUrl,
} from "@/lib/crm-import/storageConfig";
import type { CrmContactRecord } from "@/lib/crm-import/types";

interface Args {
  customer: string;
  source: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  let customer = "";
  let source: string | null = null;
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a.startsWith("--source=")) source = a.slice("--source=".length);
  }
  if (!customer) {
    console.error(
      "Usage: workspace-forensics -- --customer=<workspace-slug> [--source=<csv-path>]",
    );
    process.exit(2);
  }
  return { customer, source };
}

// Identity-key derivation — same precedence as lib/crm-import/identityKey.ts
// but for read-only analysis (collapses contacts that the resolver would
// consider the same person).
function identityKey(c: CrmContactRecord): { kind: string; key: string } {
  const email = (c.normalizedEmail ?? "").trim().toLowerCase();
  if (email) return { kind: "email", key: email };
  const phone = (c.normalizedPhone ?? "").trim();
  if (phone) return { kind: "phone", key: phone };
  const name = (c.normalizedName ?? "").trim().toLowerCase();
  const address = (c.address ?? "").trim().toLowerCase();
  if (name && address) return { kind: "name_addr", key: `${name}|${address}` };
  if (name) return { kind: "name", key: name };
  return { kind: "no_id", key: c.id };
}

function idShape(id: string, workspaceId: string): "legacy_rowindex" | "identity_derived" | "other" {
  const escaped = workspaceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^crm-${escaped}-\\d+-[a-z0-9]+$`).test(id)) return "legacy_rowindex";
  if (new RegExp(`^crm-${escaped}-[0-9a-f]{12}$`).test(id)) return "identity_derived";
  return "other";
}

function section(title: string): void {
  console.log("");
  console.log("=".repeat(64));
  console.log(title);
  console.log("=".repeat(64));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertWorkspaceSlug(args.customer);
  if (!getCrmDatabaseUrl()) {
    console.error("DATABASE_URL / POSTGRES_URL not configured. Set it in .env.local and retry.");
    process.exit(1);
  }

  const contacts = await listContactsByWorkspace(args.customer);
  const total = contacts.length;

  // ── Identity index ─────────────────────────────────────────────
  const keys = contacts.map(identityKey);
  const clusterCounts = new Map<string, number>();
  for (const k of keys) {
    const composite = `${k.kind}:${k.key}`;
    clusterCounts.set(composite, (clusterCounts.get(composite) ?? 0) + 1);
  }
  const distinctIdentities = clusterCounts.size;

  // ── SECTION A ──────────────────────────────────────────────────
  section(`SECTION A — Workspace Reality (workspace=${args.customer})`);
  console.log(`  total contacts:        ${total}`);
  console.log(`  distinct identities:   ${distinctIdentities}`);
  console.log(`  inflation count:       ${total - distinctIdentities}`);
  console.log(`  percent unique:        ${total === 0 ? "0.0" : ((distinctIdentities / total) * 100).toFixed(1)}%`);

  // ── SECTION B ──────────────────────────────────────────────────
  section("SECTION B — Duplicate cluster distribution");
  const sizeHistogram = new Map<number, number>();
  for (const size of clusterCounts.values()) {
    sizeHistogram.set(size, (sizeHistogram.get(size) ?? 0) + 1);
  }
  const sizes = Array.from(sizeHistogram.keys()).sort((a, b) => a - b);
  console.log(`  cluster_size  ×  num_clusters  =  contacts_in_clusters`);
  for (const sz of sizes) {
    const nClusters = sizeHistogram.get(sz)!;
    console.log(
      `  size ${String(sz).padStart(3)}      ×  ${String(nClusters).padStart(4)}         =  ${String(sz * nClusters).padStart(4)} contacts`,
    );
  }
  console.log("");
  console.log("  Largest clusters (top 10):");
  const sorted = Array.from(clusterCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of sorted.slice(0, 10)) {
    if (n === 1) break;
    console.log(`    size ${String(n).padStart(3)}   ${k.slice(0, 70)}`);
  }

  // ── SECTION C ──────────────────────────────────────────────────
  section("SECTION C — Legacy import damage (contact_id shape)");
  const shapes = { legacy_rowindex: 0, identity_derived: 0, other: 0 };
  for (const c of contacts) shapes[idShape(c.id, args.customer)] += 1;
  console.log(`  legacy_rowindex IDs:   ${shapes.legacy_rowindex}  (${total === 0 ? "0.0" : ((shapes.legacy_rowindex / total) * 100).toFixed(1)}%)`);
  console.log(`  identity_derived IDs:  ${shapes.identity_derived}  (${total === 0 ? "0.0" : ((shapes.identity_derived / total) * 100).toFixed(1)}%)`);
  console.log(`  other shape:           ${shapes.other}`);

  // ── SECTION D ──────────────────────────────────────────────────
  section("SECTION D — Source CSV cross-check");
  if (!args.source) {
    console.log("  (skipped — pass --source=<csv-path> to enable)");
  } else {
    try {
      const text = await fs.readFile(args.source, "utf8");
      const parsed = parseCsv(text);
      const headers = parsed.length > 0 ? Object.keys(parsed[0]) : [];
      const mapping = detectColumnMapping(headers);
      const sourceRows = normalizeCrmRows(parsed, mapping, "wise_agent_forensics");

      const csvEmails = new Set<string>();
      for (const r of sourceRows) {
        const e = (r.normalizedEmail ?? "").trim().toLowerCase();
        if (e) csvEmails.add(e);
      }
      const workspaceEmails = new Set<string>();
      for (const c of contacts) {
        const e = (c.normalizedEmail ?? "").trim().toLowerCase();
        if (e) workspaceEmails.add(e);
      }

      let inBoth = 0;
      let workspaceOnly = 0;
      let csvOnly = 0;
      for (const e of workspaceEmails) {
        if (csvEmails.has(e)) inBoth += 1;
        else workspaceOnly += 1;
      }
      for (const e of csvEmails) {
        if (!workspaceEmails.has(e)) csvOnly += 1;
      }

      console.log(`  source CSV path:                  ${args.source}`);
      console.log(`  source CSV rows parsed:           ${sourceRows.length}`);
      console.log(`  CSV distinct emails:              ${csvEmails.size}`);
      console.log(`  workspace distinct emails:        ${workspaceEmails.size}`);
      console.log(`  workspace emails IN CSV:          ${inBoth}`);
      console.log(`  workspace emails NOT in CSV:      ${workspaceOnly}`);
      console.log(`  CSV emails NOT in workspace:      ${csvOnly}`);
      if (workspaceEmails.size > 0) {
        console.log(`  overlap percentage (ws ∩ csv) / ws: ${((inBoth / workspaceEmails.size) * 100).toFixed(1)}%`);
      }
    } catch (err) {
      console.log(`  ERROR reading source CSV: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── SECTION E ──────────────────────────────────────────────────
  section("SECTION E — Greg=Greg corruption concentration");
  let totalCorrupted = 0;
  let corruptedInDuplicate = 0;
  let corruptedUnique = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const name = (c.name ?? "").trim().toLowerCase();
    const company = (c.company ?? "").trim().toLowerCase();
    if (!name || name !== company) continue;
    totalCorrupted += 1;
    const composite = `${keys[i].kind}:${keys[i].key}`;
    const clusterSize = clusterCounts.get(composite) ?? 1;
    if (clusterSize > 1) corruptedInDuplicate += 1;
    else corruptedUnique += 1;
  }
  console.log(`  total company == name rows:           ${totalCorrupted}`);
  console.log(`  ... in duplicate clusters:            ${corruptedInDuplicate}  (${totalCorrupted === 0 ? "0.0" : ((corruptedInDuplicate / totalCorrupted) * 100).toFixed(1)}%)`);
  console.log(`  ... in single-cluster (unique) rows:  ${corruptedUnique}  (${totalCorrupted === 0 ? "0.0" : ((corruptedUnique / totalCorrupted) * 100).toFixed(1)}%)`);

  // ── ID-shape × corruption cross-tab (bonus signal — no extra cost) ──
  console.log("");
  console.log("  Greg=Greg by contact_id shape:");
  const corruptedByShape = { legacy_rowindex: 0, identity_derived: 0, other: 0 };
  for (const c of contacts) {
    const name = (c.name ?? "").trim().toLowerCase();
    const company = (c.company ?? "").trim().toLowerCase();
    if (!name || name !== company) continue;
    corruptedByShape[idShape(c.id, args.customer)] += 1;
  }
  console.log(`    legacy_rowindex:    ${corruptedByShape.legacy_rowindex}`);
  console.log(`    identity_derived:   ${corruptedByShape.identity_derived}`);
  console.log(`    other shape:        ${corruptedByShape.other}`);

  console.log("");
  console.log("=".repeat(64));
  console.log("end of workspace-forensics");
  console.log("=".repeat(64));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
