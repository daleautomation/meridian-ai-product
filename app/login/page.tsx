import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DevAuthDebug } from "@/components/auth/DevAuthDebug";
import { WorkspaceLoginForm } from "@/components/auth/WorkspaceLoginForm";
import { getSession } from "@/lib/auth";
import { resolvePostLoginRedirect } from "@/lib/auth/postLoginRouting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Hidden production build marker. Lets a deploy be verified from a
 * stale customer browser by checking the page's <head> without
 * exposing any debug UI. The token rotates per cache-fix rollout.
 */
const AUTH_BUILD_MARKER = "brookside-login-fix";

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

  if (user) {
    redirect(resolvePostLoginRedirect(user, nextRaw ?? null));
  }

  return (
    <main className="workspace-login-shell">
      {/* meridian-auth-build=brookside-login-fix */}
      <DevAuthDebug page="login" />
      <Suspense fallback={<LoginLoading />}>
        <WorkspaceLoginForm initialNext={nextRaw ?? null} />
      </Suspense>
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
