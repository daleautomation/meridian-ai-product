// Meridian — /api/debug/nicole-contact-count
//
// Admin-only diagnostic. Queries Neon directly (no cache, no `store.ts`
// memory layer) and returns:
//   • current row count for workspace_id='nicole-lonergan'
//   • every distinct workspace_id present in crm_contacts
//   • the masked DB host the live function is using
//   • the runtime fingerprint
//
// Lets an operator confirm in one curl whether production is reading
// from the same Neon DB that `.env.local` points at — and whether the
// last import actually landed there.

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getSession } from "@/lib/auth";
import { applyAuthNoStoreHeaders } from "@/lib/auth/sessionCleanup";
import { getCrmDatabaseUrl } from "@/lib/crm-import/storageConfig";
import {
  describeRuntimeFingerprint,
  logRuntimeBannerOnce,
} from "@/lib/diagnostics/runtimeFingerprint";
import { isAdminOperator } from "@/lib/workspaceAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const WORKSPACE = "nicole-lonergan";

export async function GET() {
  logRuntimeBannerOnce();
  const user = await getSession();
  if (!user) {
    return applyAuthNoStoreHeaders(
      NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    );
  }
  if (!isAdminOperator(user)) {
    return applyAuthNoStoreHeaders(
      NextResponse.json({ ok: false, error: "Admin role required" }, { status: 403 }),
    );
  }

  const fingerprint = describeRuntimeFingerprint();
  const url = getCrmDatabaseUrl();

  if (!url) {
    return applyAuthNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          error: "No DATABASE_URL / POSTGRES_URL configured in this runtime.",
          fingerprint,
        },
        { status: 500 },
      ),
    );
  }

  const sql = neon(url);

  try {
    const tableProbe = (await sql`
      select to_regclass('public.crm_contacts') as oid
    `) as Array<{ oid: string | null }>;
    const tableExists = tableProbe[0]?.oid !== null;

    if (!tableExists) {
      return applyAuthNoStoreHeaders(
        NextResponse.json(
          {
            ok: false,
            error: "crm_contacts table does not exist in this database.",
            fingerprint,
          },
          { status: 500 },
        ),
      );
    }

    const distinct = (await sql`
      select workspace_id, count(*)::int as count
      from crm_contacts
      group by workspace_id
      order by workspace_id
    `) as Array<{ workspace_id: string; count: number }>;

    const nicoleRow = distinct.find((d) => d.workspace_id === WORKSPACE);
    const nicoleCount = nicoleRow?.count ?? 0;

    return applyAuthNoStoreHeaders(
      NextResponse.json({
        ok: true,
        fingerprint,
        workspace: WORKSPACE,
        nicoleCount,
        distinctWorkspaces: distinct,
      }),
    );
  } catch (err) {
    return applyAuthNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          fingerprint,
        },
        { status: 500 },
      ),
    );
  }
}
