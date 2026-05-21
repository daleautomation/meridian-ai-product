import { Suspense } from "react";
import type { Metadata } from "next";
import { DevAuthDebug } from "@/components/auth/DevAuthDebug";
import { SignedInLoginPortal } from "@/components/auth/SignedInLoginPortal";
import { WorkspaceLoginForm } from "@/components/auth/WorkspaceLoginForm";
import { getSession } from "@/lib/auth";

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
