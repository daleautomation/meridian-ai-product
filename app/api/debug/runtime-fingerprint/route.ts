// Meridian — /api/debug/runtime-fingerprint
//
// Admin-only diagnostic. Returns the exact commit / branch / build /
// storage / DB host serving this request. Used to verify production is
// running the branch the operator expects and the DATABASE_URL the
// operator expects.
//
//   curl https://meridianai.work/api/debug/runtime-fingerprint \
//     --cookie "meridian_session=<dylan's cookie>"
//
// Returns 401 without session, 403 without admin role.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAdminOperator } from "@/lib/workspaceAccess";
import {
  describeRuntimeFingerprint,
  logRuntimeBannerOnce,
} from "@/lib/diagnostics/runtimeFingerprint";
import { applyAuthNoStoreHeaders } from "@/lib/auth/sessionCleanup";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
  return applyAuthNoStoreHeaders(
    NextResponse.json({ ok: true, fingerprint }),
  );
}
