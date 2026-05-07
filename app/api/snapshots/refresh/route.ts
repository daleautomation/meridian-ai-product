// Meridian — Manually invalidate the operator snapshot.
//
// POST ?workspace=<slug>  →  { ok: true }
//
// Deletes the in-bundle snapshot's expiry stamp by writing a new
// snapshot with expiresAt in the past. The next operator-page render
// will see the stale snapshot, fall through to the slow path, and
// regenerate a fresh snapshot at the end.
//
// Useful when the operator wants the latest data after a known
// upstream change (new ingestion, manual edit) without waiting for
// the 24h TTL.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as fs from "node:fs/promises";
import * as path from "node:path";

function snapshotFile(slug: string): string {
  const safe = slug.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(process.cwd(), "data", "snapshots", `${safe}-operator.json`);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const workspace = url.searchParams.get("workspace") ?? "";
  if (!workspace) {
    return NextResponse.json({ ok: false, error: "Missing workspace" }, { status: 400 });
  }
  const userWorkspaces = session.workspaces ?? [];
  if (!userWorkspaces.includes(workspace) && session.id !== workspace) {
    return NextResponse.json({ ok: false, error: "Workspace not accessible" }, { status: 403 });
  }

  // Read the existing snapshot, rewrite with expiresAt in the past so
  // readOperatorSnapshot rejects it on the next render. We don't
  // delete the file — leaving it in place preserves the cached props
  // for the slow-path re-render to compare against if desired later.
  const filePath = snapshotFile(workspace);
  let invalidated = false;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      parsed.expiresAt = new Date(Date.now() - 60_000).toISOString();
      await fs.writeFile(filePath, JSON.stringify(parsed), "utf8");
      invalidated = true;
    }
  } catch {
    /* no snapshot, nothing to invalidate */
  }

  // eslint-disable-next-line no-console
  console.log(
    `[snapshot-refresh] workspace=${workspace} user=${session.id} ` +
    `invalidated=${invalidated}`,
  );

  return NextResponse.json({ ok: true, invalidated });
}
