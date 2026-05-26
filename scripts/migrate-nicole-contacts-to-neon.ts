/**
 * One-time promotion of `data/crm-contacts/nicole-lonergan.json` into
 * whichever Neon database DATABASE_URL points at in the current env.
 *
 * Usage (operator laptop, with .env.local mirroring Vercel's DATABASE_URL):
 *
 *   npx dotenv -e .env.local -- npm run nicole-contacts:migrate-from-file
 *
 * Or against a non-default file:
 *
 *   npx dotenv -e .env.local -- npx tsx \
 *     scripts/migrate-nicole-contacts-to-neon.ts \
 *     --file=/path/to/nicole-lonergan.json
 *
 * Refuses to run if any contact in the file carries a workspaceId
 * other than `nicole-lonergan` — workspace isolation cannot be
 * violated even by an operator-issued migration.
 *
 * Exit codes:
 *   0 — at least one row inserted or updated
 *   1 — file missing, schema missing, validation rejection, or
 *       Neon write failure
 *   2 — DATABASE_URL / POSTGRES_URL not set in env
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { upsertContacts, getWorkspaceContactCounts } from "@/lib/crm-import/store";
import { describeRuntimeFingerprint } from "@/lib/diagnostics/runtimeFingerprint";
import { getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";
import type { CrmContactRecord } from "@/lib/crm-import/types";

const WORKSPACE = "nicole-lonergan";
const DEFAULT_PATH = path.join("data", "crm-contacts", `${WORKSPACE}.json`);

function readArg(name: string): string | undefined {
  const flag = `--${name}=`;
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith(flag)) return raw.slice(flag.length);
  }
  return undefined;
}

interface ContactsFile {
  contacts: CrmContactRecord[];
}

function isContactRecord(value: unknown): value is CrmContactRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.workspaceId === "string" &&
    typeof r.name === "string" &&
    typeof r.createdAt === "string" &&
    typeof r.updatedAt === "string" &&
    Array.isArray(r.tags) &&
    typeof r.dataTrust === "object"
  );
}

async function main(): Promise<void> {
  if (!getCrmDatabaseUrl()) {
    console.error(
      "[migrate-nicole-contacts] No DATABASE_URL / POSTGRES_URL in this process.",
    );
    console.error(
      "  Hint: npx dotenv -e .env.local -- npm run nicole-contacts:migrate-from-file",
    );
    process.exit(2);
  }

  const filePath = path.resolve(readArg("file") ?? DEFAULT_PATH);
  console.log(`[migrate-nicole-contacts] reading ${path.relative(process.cwd(), filePath)}`);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(`[migrate-nicole-contacts] file not found: ${filePath}`);
      console.error("  Nothing to migrate. This host has no local file for the workspace.");
      process.exit(1);
    }
    throw err;
  }

  let parsed: ContactsFile;
  try {
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object" || !Array.isArray((obj as { contacts?: unknown }).contacts)) {
      throw new Error("file does not have shape { contacts: [...] }");
    }
    parsed = obj as ContactsFile;
  } catch (err) {
    console.error("[migrate-nicole-contacts] cannot parse JSON:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const valid: CrmContactRecord[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];
  for (let i = 0; i < parsed.contacts.length; i++) {
    const c = parsed.contacts[i];
    if (!isContactRecord(c)) {
      rejected.push({ index: i, reason: "not a well-formed CrmContactRecord" });
      continue;
    }
    if (c.workspaceId !== WORKSPACE) {
      rejected.push({
        index: i,
        reason: `workspaceId="${c.workspaceId}" must equal "${WORKSPACE}"`,
      });
      continue;
    }
    valid.push(c);
  }

  const fp = describeRuntimeFingerprint();
  console.log(`[migrate-nicole-contacts] target dbHost=${fp.dbHost} dbName=${fp.dbName}`);
  console.log(`[migrate-nicole-contacts] file rows=${parsed.contacts.length} valid=${valid.length} rejected=${rejected.length}`);
  if (rejected.length > 0) {
    console.error(
      `[migrate-nicole-contacts] refusing to migrate — ${rejected.length} contact(s) failed validation:`,
    );
    for (const r of rejected.slice(0, 10)) {
      console.error(`  - row ${r.index}: ${r.reason}`);
    }
    process.exit(1);
  }
  if (valid.length === 0) {
    console.error("[migrate-nicole-contacts] file has no contacts to migrate");
    process.exit(1);
  }

  let result: { inserted: number; updated: number };
  try {
    result = await upsertContacts(valid);
  } catch (err) {
    console.error("[migrate-nicole-contacts] upsert failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  let after: number | null = null;
  try {
    const counts = await getWorkspaceContactCounts([WORKSPACE]);
    after = counts.workspaces.find((w) => w.workspaceId === WORKSPACE)?.count ?? null;
  } catch (err) {
    console.error("[migrate-nicole-contacts] post-migration count failed:", err instanceof Error ? err.message : err);
  }

  console.log("[migrate-nicole-contacts] DONE");
  console.log(`  inserted: ${result.inserted}`);
  console.log(`  updated:  ${result.updated}`);
  console.log(`  workspace count after migration: ${after ?? "(error)"}`);
  console.log(`  dbHost: ${fp.dbHost}`);
  console.log(`  dbName: ${fp.dbName}`);
  console.log("");
  console.log("Verify with:");
  console.log("  npx dotenv -e .env.local -- npm run nicole-contacts:check");
  console.log("");
  console.log(
    "If production hits the same DATABASE_URL, /personal will now render contacts immediately " +
      "(force-dynamic + revalidate=0 are set on /personal).",
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[migrate-nicole-contacts] crashed");
  console.error(message);
  process.exit(1);
});
