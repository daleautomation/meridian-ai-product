// Meridian — public session reset endpoint.
//
// Temporary self-recovery surface for customers stuck on a stale
// browser bundle / stale auth cookie. Anyone can hit this URL: the
// route clears every Meridian auth cookie name (current + historic),
// disables intermediate caches, and renders a calm page with a single
// button to /login?fresh=brookside.
//
// No credentials required, no session created. The page is intentionally
// hand-written HTML so it survives even if the React bundle a stale
// browser is holding is broken.

import { NextResponse } from "next/server";
import { isSecureSessionRequest } from "@/lib/session";
import {
  applyAuthNoStoreHeaders,
  clearAllMeridianAuthCookies,
} from "@/lib/auth/sessionCleanup";

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="meridian-auth-build" content="brookside-login-fix" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Session reset · Meridian</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100dvh;
      background: linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%);
      color: #1F2937;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif;
    }
    main {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(440px, 100%);
      padding: 32px 28px;
      border: 1px solid #E2E8F0;
      border-radius: 20px;
      background: #FFFFFF;
      box-shadow: 0 28px 70px rgba(15,23,42,0.08);
    }
    .eyebrow {
      color: #7c6f61;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin: 0 0 10px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      letter-spacing: -0.02em;
      color: #0F172A;
    }
    p {
      margin: 0 0 22px;
      color: #475569;
      font-size: 14px;
      line-height: 1.55;
    }
    a.button {
      display: inline-block;
      background: #2563EB;
      color: #FFFFFF;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.02em;
      padding: 11px 18px;
      border-radius: 10px;
      text-decoration: none;
    }
    a.secondary {
      display: inline-block;
      margin-left: 10px;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <p class="eyebrow">Meridian</p>
      <h1>Session reset complete.</h1>
      <p>
        Old workspace credentials have been cleared from this browser.
        Continue to the login page to sign in fresh.
      </p>
      <a class="button" href="/login?fresh=brookside">Continue to login</a>
      <a class="secondary" href="/">Back to meridian.ai</a>
    </section>
    <!-- meridian-auth-build=brookside-login-fix -->
  </main>
  <script>
    // Belt-and-suspenders: clear any client-side cached auth hints the
    // old bundle may have written. Storage clears are scoped to this
    // origin so they never touch unrelated apps.
    try { window.localStorage.removeItem("meridian.session"); } catch (_) {}
    try { window.localStorage.removeItem("meridian.user"); } catch (_) {}
    try { window.localStorage.removeItem("meridian.workspace"); } catch (_) {}
    try { window.sessionStorage.clear(); } catch (_) {}
  </script>
</body>
</html>`;

function buildResetResponse(req: Request): NextResponse {
  const res = new NextResponse(PAGE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  clearAllMeridianAuthCookies(res, isSecureSessionRequest(req));
  return applyAuthNoStoreHeaders(res);
}

export async function GET(req: Request) {
  return buildResetResponse(req);
}

export async function POST(req: Request) {
  return buildResetResponse(req);
}
