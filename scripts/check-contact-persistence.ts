/**
 * CRM contact persistence validation.
 *
 * Verifies the durable-contact contract that the Nicole Lonergan
 * workspace depends on:
 *
 *   1. An import write under workspace=A produces a contact that survives
 *      a process-restart (memory cache cleared).
 *   2. Reads scoped to workspace=B never see workspace=A's contacts.
 *   3. On a Vercel-style production host (VERCEL=1) WITHOUT a Postgres
 *      URL, BOTH writes AND reads fail loudly with explicit error codes
 *      instead of silently degrading to []. Empty state only appears
 *      when storage is configured AND truly empty.
 *   4. `getWorkspaceContactCounts` reflects what the workspace page
 *      would see (no divergence between diagnostic and live read paths).
 *
 * The script writes test contacts to a sandbox directory under
 * `data/crm-contacts/` via the `MERIDIAN_CRM_CONTACTS_DIR` override
 * so it does not collide with real customer data on this host.
 */

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

interface TestContext {
  sandboxDir: string;
  testWorkspaceA: string;
  testWorkspaceB: string;
}

async function withSandbox<T>(fn: (ctx: TestContext) => Promise<T>): Promise<T> {
  // Sandbox dir lives under data/ so the MERIDIAN_CRM_CONTACTS_DIR
  // override accepts it (the override validator rejects paths outside
  // data/).
  const dirName = `persistence-check-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const sandboxDir = path.join("data", dirName);
  const absolute = path.resolve(sandboxDir);
  await fs.mkdir(absolute, { recursive: true });

  const previous = process.env.MERIDIAN_CRM_CONTACTS_DIR;
  process.env.MERIDIAN_CRM_CONTACTS_DIR = dirName;

  try {
    return await fn({
      sandboxDir: absolute,
      testWorkspaceA: "persist-check-a",
      testWorkspaceB: "persist-check-b",
    });
  } finally {
    if (previous === undefined) delete process.env.MERIDIAN_CRM_CONTACTS_DIR;
    else process.env.MERIDIAN_CRM_CONTACTS_DIR = previous;
    await fs.rm(absolute, { recursive: true, force: true });
  }
}

function makeContact(workspaceId: string, suffix: string) {
  const now = new Date().toISOString();
  return {
    id: `crm-persist-check-${workspaceId}-${suffix}`,
    workspaceId,
    importJobId: `job-${workspaceId}-${suffix}`,
    name: `Persist Check ${suffix}`,
    company: null,
    phone: null,
    email: null,
    address: null,
    notes: null,
    tags: [],
    lastInteractionAt: now,
    sourceCrm: "test",
    normalizedPhone: null,
    normalizedEmail: null,
    normalizedCompany: null,
    normalizedName: `persist check ${suffix}`,
    dataTrust: {
      level: "weak" as const,
      score: 10,
      reasons: ["test"],
      hasPhone: false,
      hasEmail: false,
      hasName: true,
      hasCompany: false,
    },
    relationshipScore: 0,
    scoreMetadata: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function freshImports() {
  // Importing inside the function (not at top of file) so we can re-import
  // after toggling env vars in the production-mode test below.
  return await import(`@/lib/crm-import/store?cb=${randomUUID()}`);
}

async function runLocalRoundTrip(): Promise<void> {
  await withSandbox(async (ctx) => {
    const store = await freshImports();
    store.__resetCrmImportMemoryForTests();

    // 1. Storage-mode reads as "file"+non-durable locally (no Vercel, no Neon).
    const desc = store.describeContactStorageMode();
    if (desc.mode !== "file" || desc.durable !== false) {
      fail(`local storage mode: expected file/non-durable, got ${desc.mode}/${desc.durable}`);
    }

    // 2. Write contacts to workspace A.
    const contactsA = [
      makeContact(ctx.testWorkspaceA, "1"),
      makeContact(ctx.testWorkspaceA, "2"),
      makeContact(ctx.testWorkspaceA, "3"),
    ];
    const result = await store.upsertContacts(contactsA);
    if (result.inserted !== 3) {
      fail(`upsert: expected 3 inserted, got ${result.inserted}`);
    }

    // 3. Read back — should see 3.
    const readA = await store.listContactsByWorkspace(ctx.testWorkspaceA);
    if (readA.length !== 3) {
      fail(`read workspace A: expected 3, got ${readA.length}`);
    }

    // 4. Simulate process restart: drop the in-memory cache + reload module.
    store.__resetCrmImportMemoryForTests();
    const store2 = await freshImports();
    store2.__resetCrmImportMemoryForTests();
    const readAAfterRestart = await store2.listContactsByWorkspace(ctx.testWorkspaceA);
    if (readAAfterRestart.length !== 3) {
      fail(
        `simulated restart: expected 3 contacts persisted to disk, got ${readAAfterRestart.length}`,
      );
    }

    // 5. Workspace isolation: reads for B see nothing.
    const readB = await store2.listContactsByWorkspace(ctx.testWorkspaceB);
    if (readB.length !== 0) {
      fail(`workspace isolation: workspace B should see 0, got ${readB.length}`);
    }

    // 6. getWorkspaceContactCounts mirrors the live reads.
    const counts = await store2.getWorkspaceContactCounts([
      ctx.testWorkspaceA,
      ctx.testWorkspaceB,
    ]);
    const a = counts.workspaces.find((w: { workspaceId: string }) => w.workspaceId === ctx.testWorkspaceA);
    const b = counts.workspaces.find((w: { workspaceId: string }) => w.workspaceId === ctx.testWorkspaceB);
    if (a?.count !== 3) fail(`counts.A: expected 3, got ${a?.count}`);
    if (b?.count !== 0) fail(`counts.B: expected 0, got ${b?.count}`);
    if (a?.error !== null || b?.error !== null) {
      fail(`counts: unexpected error fields (A=${a?.error} B=${b?.error})`);
    }
    if (counts.storage.mode !== "file") {
      fail(`counts.storage.mode: expected file, got ${counts.storage.mode}`);
    }
  });
}

async function runProductionWithoutPostgres(): Promise<void> {
  // Temporarily simulate Vercel production with no Postgres. Capture the
  // existing env so we can restore it.
  const previousVercel = process.env.VERCEL;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPostgresUrl = process.env.POSTGRES_URL;
  process.env.VERCEL = "1";
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;

  try {
    const store = await freshImports();
    store.__resetCrmImportMemoryForTests();

    const desc = store.describeContactStorageMode();
    if (desc.mode !== "none" || desc.durable !== false) {
      fail(`production-no-postgres: expected mode=none/non-durable, got ${desc.mode}/${desc.durable}`);
    }

    // Writes must throw the durable-storage-not-configured error.
    let writeError: Error | null = null;
    try {
      await store.upsertContacts([makeContact("nicole-lonergan", "vercel-1")]);
    } catch (err) {
      writeError = err as Error;
    }
    if (!writeError) {
      fail("production-no-postgres: upsertContacts should throw, did not");
    } else if (!/not configured|DURABLE/i.test(writeError.message)) {
      fail(
        `production-no-postgres: upsert error should mention durable storage, got "${writeError.message}"`,
      );
    }

    // Reads must throw ContactStorageUnavailableError — NOT silently return [].
    let readError: Error | null = null;
    try {
      await store.listContactsByWorkspace("nicole-lonergan");
    } catch (err) {
      readError = err as Error;
    }
    if (!readError) {
      fail("production-no-postgres: listContactsByWorkspace should throw, returned silently");
    } else if (readError.name !== "ContactStorageUnavailableError") {
      fail(
        `production-no-postgres: expected ContactStorageUnavailableError, got ${readError.name}`,
      );
    } else if (!/nicole-lonergan/i.test(readError.message)) {
      fail("production-no-postgres: error message must mention the affected workspace");
    }

    // getWorkspaceContactCounts surfaces the error without throwing — it
    // shapes the report so an audit page can show the precise reason.
    const counts = await store.getWorkspaceContactCounts(["nicole-lonergan", "labortech"]);
    if (counts.storage.mode !== "none") {
      fail(`production-no-postgres: counts.storage.mode expected "none", got ${counts.storage.mode}`);
    }
    for (const w of counts.workspaces) {
      if (w.count !== null) {
        fail(`production-no-postgres: workspace ${w.workspaceId} count should be null when storage missing`);
      }
      if (!w.error) {
        fail(`production-no-postgres: workspace ${w.workspaceId} must carry error string`);
      }
    }
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousDatabaseUrl !== undefined) process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousPostgresUrl !== undefined) process.env.POSTGRES_URL = previousPostgresUrl;
  }
}

async function main(): Promise<void> {
  await runLocalRoundTrip();
  await runProductionWithoutPostgres();

  if (failures.length > 0) {
    console.error("contact persistence check FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }
  console.log("contact persistence check passed", {
    checks: [
      "local storage mode is file/non-durable",
      "upsertContacts writes 3 contacts to workspace A",
      "listContactsByWorkspace reads 3 contacts back",
      "simulated process restart preserves all 3 contacts on disk",
      "workspace isolation: workspace B sees 0",
      "getWorkspaceContactCounts mirrors live reads (counts + storage mode)",
      "production-without-postgres: storage mode reports 'none'",
      "production-without-postgres: upsertContacts throws durable-storage-not-configured",
      "production-without-postgres: listContactsByWorkspace throws ContactStorageUnavailableError (NOT silent [])",
      "production-without-postgres: error mentions affected workspaceId",
      "production-without-postgres: getWorkspaceContactCounts shapes errors without throwing",
    ],
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[contact-persistence:check] crashed");
  console.error(message);
  process.exit(1);
});
