import { createDemoSessionResponse, resolveDemoProfile } from "@/lib/demo/session";

// Meridian — Friendlier demo entry point at /demo/john.
//
// Same behavior as /api/auth/demo-login?user=john&workspace=labortech
// but on a non-/api path so ngrok-free's interstitial / browser cookie
// handling treats it as a normal page navigation. This is the URL
// John clicks; the path is allow-listed in proxy.ts so the auth gate
// doesn't bounce him to /login first.
//
// Fires a session_start tracking event so the post-session review
// shows when John actually entered the workspace.

export async function GET(req: Request) {
  return createDemoSessionResponse({
    req,
    profile: resolveDemoProfile("john"),
    entry: "/demo/john",
  });
}
