import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { getTenantById, toPublicUser, type PublicUser } from "@/config/tenants";

export async function getSession(): Promise<PublicUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const tenant = getTenantById(payload.uid);
  if (!tenant) return null;
  return toPublicUser(tenant);
}
