import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DevAuthDebug } from "@/components/auth/DevAuthDebug";
import { WorkspaceLoginForm } from "@/components/auth/WorkspaceLoginForm";
import { getSession } from "@/lib/auth";
import { resolvePostLoginRedirect } from "@/lib/auth/postLoginRouting";

export const dynamic = "force-dynamic";

type SearchParams = {
  next?: string | string[];
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
