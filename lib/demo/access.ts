// Meridian — Demo-route host gate.
//
// `/demo/john` and `/api/auth/demo-login` both bypass the form-login
// flow and mint a session cookie directly. They are *not* a generic
// public API — they exist for the LaborTech go-live where John clicks
// a single URL and lands inside the operator console with a valid
// session.
//
// To prevent the demo flow from accidentally being exposed on every
// host the deployment serves, the route handlers gate on the host
// header. Dev/test environments always allow; production requires
// the request host to match an allowlist.
//
// Allowlist resolution (production only):
//   1. If MERIDIAN_DEMO_ALLOWED_HOSTS env var is set, use it as the
//      authoritative comma-separated list of host substrings.
//      Empty value disables demo entry entirely on production.
//   2. Otherwise fall back to DEFAULT_PRODUCTION_HOSTS — covers the
//      LaborTech go-live domain plus dev tunnels.
//
// Match is substring-based on a lowercased host. So "meridianai.work"
// matches both "www.meridianai.work" and "meridianai.work" without
// extra config.

const DEFAULT_PRODUCTION_HOSTS = [
  "meridianai.work",
  "ngrok",
  "localhost",
  "127.0.0.1",
] as const;

function resolveAllowlist(): readonly string[] {
  const env = process.env.MERIDIAN_DEMO_ALLOWED_HOSTS;
  if (typeof env !== "string") return DEFAULT_PRODUCTION_HOSTS;
  // Empty string is meaningful — it explicitly disables demo entry
  // in production. A non-empty value replaces the default list.
  const trimmed = env.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0);
}

export function isDemoAllowedHost(hostHeader: string | null | undefined): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (!hostHeader || typeof hostHeader !== "string") return false;
  const host = hostHeader.toLowerCase();
  const allow = resolveAllowlist();
  for (const candidate of allow) {
    if (host.includes(candidate)) return true;
  }
  return false;
}

/** Surface the resolved allowlist for diagnostics. Returned as a
 *  comma-separated string so it logs cleanly in one line. */
export function describeDemoAllowlist(): string {
  if (process.env.NODE_ENV !== "production") return "(dev: all hosts allowed)";
  const allow = resolveAllowlist();
  if (allow.length === 0) return "(prod: explicitly disabled)";
  return allow.join(",");
}
