import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DevAuthDebug } from "@/components/auth/DevAuthDebug";
import { SignedInLoginPortal } from "@/components/auth/SignedInLoginPortal";
import { WorkspaceLoginForm } from "@/components/auth/WorkspaceLoginForm";
import { getSession } from "@/lib/auth";
import {
  isPostLoginPathAllowed,
  sanitizeInternalPath,
  workspaceSelectCardsForUser,
} from "@/lib/auth/postLoginRouting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Hidden production build marker. Lets a deploy be verified from a
 * stale customer browser by checking the page's <head> without
 * exposing any debug UI. The token rotates per cache-fix rollout.
 */
const AUTH_BUILD_MARKER = "client-portal-login-v2";

export const metadata: Metadata = {
  title: "Sign in · Meridian",
  robots: { index: false, follow: false },
  other: {
    "meridian-auth-build": AUTH_BUILD_MARKER,
  },
};

type SearchParams = {
  next?: string | string[];
  fresh?: string | string[];
};

export default async function LoginPage(props: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await getSession();
  const params = (await props.searchParams) ?? {};
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;

  // Signed-in users land here in three shapes:
  //   1. With an allowed `next` → forward immediately. No interstitial.
  //   2. With no `next` but exactly one accessible workspace → forward
  //      to that workspace's home path. No interstitial.
  //   3. With no `next` and multiple workspaces → render the portal
  //      so they can choose. This is the only legitimate case for the
  //      "Continue to …" buttons.
  // redirect() throws a Next.js NEXT_REDIRECT signal and never returns,
  // so the rest of this function only runs for the form-render path.
  if (user) {
    const sanitized = sanitizeInternalPath(nextRaw ?? null);
    if (sanitized && isPostLoginPathAllowed(user, sanitized)) {
      redirect(sanitized);
    }
    if (!sanitized) {
      const cards = workspaceSelectCardsForUser(user);
      if (cards.length === 1) {
        redirect(cards[0].href);
      }
    }
  }

  return (
    <main className="workspace-login-shell">
      {/* meridian-auth-build=client-portal-login-v2 */}
      <DevAuthDebug page="login" />
      {user ? (
        <SignedInLoginPortal user={user} requestedNext={nextRaw ?? null} />
      ) : (
        <Suspense fallback={<LoginLoading />}>
          <WorkspaceLoginForm initialNext={nextRaw ?? null} />
        </Suspense>
      )}
    </main>
  );
}

function LoginLoading() {
  return (
    <div className="workspace-login-layout" aria-busy="true">
      <div className="workspace-login-card">
        <p className="workspace-login-eyebrow">Workspace access</p>
        <h1 className="workspace-login-title">Preparing sign-in…</h1>
      </div>
    </div>
  );
}
