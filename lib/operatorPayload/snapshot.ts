// Meridian — Operator payload snapshot.
//
// On a cold Vercel container the operator page does ~6 module
// ingests + 185 sales-strategy generations + scheduling + service
// classification per request. End-to-end that's 30–60s of white
// screen for the first user after a deploy.
//
// This module reads a pre-baked JSON payload — every prop the
// OperatorConsole needs — from data/snapshots/<workspace>-operator.json.
// When the snapshot exists and is fresh, the operator page returns
// it in milliseconds and skips ingestion entirely. The snapshot
// ships in the deploy bundle so it's available on the very first
// request after a cold start.
//
// The snapshot is regenerated on a slow-path render (cache miss) and
// best-effort written back to disk so warm-container subsequent
// requests stay fast. On Vercel the write lands in /tmp (ephemeral)
// or gets rejected silently; the in-bundle snapshot remains the
// reliable launch-day fast path.
//
// Schema is *intentionally* loose — it mirrors whatever the operator
// page passes into <OperatorConsole {...props} />. Adding a new prop
// to the page does not require schema changes here, only a snapshot
// regeneration.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface OperatorPayloadSnapshot {
  version: 1;
  workspaceSlug: string;
  generatedAt: string;
  expiresAt: string;
  // The operator page passes whatever shape it currently builds —
  // we serialize it as-is. Treat as opaque on the read path.
  props: Record<string, unknown>;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function snapshotDir(): string {
  // Use the deploy bundle by default. On Vercel, process.cwd() is
  // the function root and includes everything bundled. The MERIDIAN_
  // SNAPSHOT_DIR override exists for tests + local debugging.
  return process.env.MERIDIAN_SNAPSHOT_DIR ?? path.join(process.cwd(), "data", "snapshots");
}

function snapshotPath(workspaceSlug: string): string {
  const safe = workspaceSlug.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(snapshotDir(), `${safe}-operator.json`);
}

/**
 * Read the pre-baked operator payload for a workspace. Returns null
 * if missing, malformed, or expired. Never throws.
 */
export async function readOperatorSnapshot(
  workspaceSlug: string,
): Promise<OperatorPayloadSnapshot | null> {
  try {
    const filePath = snapshotPath(workspaceSlug);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.workspaceSlug !== "string" || parsed.workspaceSlug !== workspaceSlug) return null;
    if (typeof parsed.expiresAt !== "string") return null;
    const expiresAt = new Date(parsed.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
    if (!parsed.props || typeof parsed.props !== "object") return null;
    return parsed as OperatorPayloadSnapshot;
  } catch {
    return null;
  }
}

/**
 * Best-effort write. Failures are silent — Vercel's read-only
 * deploy tree will reject the write but the in-bundle snapshot
 * remains valid. On dev / writable environments this keeps the
 * snapshot fresh after every slow-path render.
 */
export async function writeOperatorSnapshot(
  workspaceSlug: string,
  props: Record<string, unknown>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<boolean> {
  try {
    const dir = snapshotDir();
    await fs.mkdir(dir, { recursive: true });
    const generatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const payload: OperatorPayloadSnapshot = {
      version: 1,
      workspaceSlug,
      generatedAt,
      expiresAt,
      props,
    };
    await fs.writeFile(snapshotPath(workspaceSlug), JSON.stringify(payload), "utf8");
    return true;
  } catch {
    return false;
  }
}
