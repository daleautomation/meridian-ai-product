// Meridian — Outcome Loop, file persistence.
//
// One JSON file per customer at data/outcomes/<customer>.json. The file
// holds an append-only array of RelationshipOutcome records.
//
// Design rules:
//   • append-only on disk — never rewrite existing entries
//   • atomic writes via tmp-file + rename so a crash mid-write cannot
//     leave a half-written JSON array
//   • missing file → empty list (a customer who has never had an
//     outcome recorded is indistinguishable from a brand-new customer)
//   • the customer slug is validated to a strict shape so the file
//     path can never escape data/outcomes/

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { RelationshipOutcome } from "./types";
import { isOutcomeSource, isOutcomeType } from "./types";

const OUTCOMES_DIRNAME = "outcomes";
const CUSTOMER_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function outcomesRoot(): string {
  // Honor the same env override pattern the snapshot store uses, so
  // serverless deploys (Vercel) can point at a writable directory.
  return (
    process.env.MERIDIAN_OUTCOMES_DIR
    ?? path.join(process.cwd(), "data", OUTCOMES_DIRNAME)
  );
}

function assertCustomerSlug(customer: string): void {
  if (!CUSTOMER_SLUG_RE.test(customer)) {
    throw new Error(
      `outcomes: invalid customer slug "${customer}" — expected lowercase alphanumeric with hyphens/underscores`,
    );
  }
}

function customerFilePath(customer: string): string {
  assertCustomerSlug(customer);
  return path.join(outcomesRoot(), `${customer}.json`);
}

/**
 * Read every outcome ever recorded for this customer. Returns [] if the
 * file has not been written yet. Caller-supplied ordering is preserved
 * (append order), but downstream helpers should sort by recordedAt
 * when they care about chronology.
 */
export async function readCustomerOutcomes(customer: string): Promise<RelationshipOutcome[]> {
  const file = customerFilePath(customer);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`outcomes: corrupt JSON at ${file}: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`outcomes: expected array in ${file}, got ${typeof parsed}`);
  }
  // Filter out malformed records rather than throw — continuity history
  // is more valuable than a strict schema gate. Operators can hand-edit
  // the file in genuinely bad cases.
  return parsed.filter(isWellFormedRecord);
}

/**
 * Append a single outcome to the customer's history. The disk write is
 * atomic: the entire next array is staged to a tmp file then renamed
 * over the original. Concurrent writers in the same process serialize
 * via a per-customer in-memory queue.
 */
export async function appendCustomerOutcome(
  customer: string,
  outcome: RelationshipOutcome,
): Promise<void> {
  await withCustomerLock(customer, async () => {
    const file = customerFilePath(customer);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const existing = await readCustomerOutcomes(customer);
    const next = [...existing, outcome];
    const tmpName = `.${path.basename(file)}.${randomUUID()}.tmp`;
    const tmp = path.join(path.dirname(file), tmpName);
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, file);
  });
}

/**
 * For test setups and admin tooling only. Production code should not
 * call this — outcome history is append-only by design.
 */
export async function _unsafeReplaceCustomerOutcomes(
  customer: string,
  outcomes: RelationshipOutcome[],
): Promise<void> {
  await withCustomerLock(customer, async () => {
    const file = customerFilePath(customer);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmpName = `.${path.basename(file)}.${randomUUID()}.tmp`;
    const tmp = path.join(path.dirname(file), tmpName);
    await fs.writeFile(tmp, JSON.stringify(outcomes, null, 2), "utf8");
    await fs.rename(tmp, file);
  });
}

// ── Per-customer write serialization ────────────────────────────────
//
// Multiple concurrent appendCustomerOutcome() calls for the same
// customer must not interleave their read-modify-write cycle. We chain
// them through a per-customer promise so the second writer reads after
// the first writer's rename has landed.

const customerWriteLocks = new Map<string, Promise<unknown>>();

async function withCustomerLock<T>(customer: string, fn: () => Promise<T>): Promise<T> {
  const prior = customerWriteLocks.get(customer) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  customerWriteLocks.set(customer, next.catch(() => undefined));
  try {
    return await next;
  } finally {
    if (customerWriteLocks.get(customer) === next) {
      customerWriteLocks.delete(customer);
    }
  }
}

function isWellFormedRecord(value: unknown): value is RelationshipOutcome {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string"
    && typeof r.leadKey === "string"
    && typeof r.recordedAt === "string"
    && isOutcomeType(r.outcome)
    && isOutcomeSource(r.source)
  );
}
