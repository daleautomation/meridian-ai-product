// Meridian AI — human review queue persistence.
//
// JSON file at data/reviews.json keyed by review id. Same atomic-write
// pattern as alertStore / negotiationStore / companySnapshotStore.
//
// Reviews are created by tools or by the operator when a downstream action
// needs approval. Kinds are free strings so new checkpoints can be added
// without a schema change — recommended set:
//   - "outreach"        — approve calling a lead
//   - "pitch"           — approve a generated pitch angle before sending
//   - "status_change"   — approve a material status move (e.g. → CLOSED_WON)

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ReviewItem = {
  id: string;
  kind: string;                  // e.g. "outreach" | "pitch" | "status_change"
  subjectKey: string;            // companyKey or other subject identifier
  subjectLabel: string;          // human-readable subject
  payload: Record<string, unknown>;
  requestedBy: string;
  createdAt: string;
  status: ReviewStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
};

const STORE_PATH = path.join(process.cwd(), "data", "reviews.json");

async function readAll(): Promise<Record<string, ReviewItem>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, ReviewItem>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[reviewQueueStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, ReviewItem>): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, STORE_PATH);
}

export async function createReview(
  input: Omit<ReviewItem, "id" | "createdAt" | "status">
): Promise<ReviewItem> {
  const all = await readAll();
  const item: ReviewItem = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "PENDING",
  };
  all[item.id] = item;
  await writeAll(all);
  return item;
}

export async function listReviews(opts?: {
  status?: ReviewStatus;
  kind?: string;
  subjectKey?: string;
  limit?: number;
}): Promise<ReviewItem[]> {
  const all = await readAll();
  let arr = Object.values(all);
  if (opts?.status) arr = arr.filter((r) => r.status === opts.status);
  if (opts?.kind) arr = arr.filter((r) => r.kind === opts.kind);
  if (opts?.subjectKey) arr = arr.filter((r) => r.subjectKey === opts.subjectKey);
  arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (opts?.limit) arr = arr.slice(0, Math.max(1, Math.min(500, opts.limit)));
  return arr;
}

export async function resolveReview(
  id: string,
  decision: "APPROVED" | "REJECTED",
  resolver: { resolvedBy: string; note?: string }
): Promise<ReviewItem | null> {
  const all = await readAll();
  const existing = all[id];
  if (!existing) return null;
  if (existing.status !== "PENDING") return existing; // idempotent
  const next: ReviewItem = {
    ...existing,
    status: decision,
    resolvedAt: new Date().toISOString(),
    resolvedBy: resolver.resolvedBy,
    resolutionNote: resolver.note,
  };
  all[id] = next;
  await writeAll(all);
  return next;
}
