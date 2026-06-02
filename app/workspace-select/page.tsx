import Link from "next/link";
import { redirect } from "next/navigation";
import { DevAuthDebug } from "@/components/auth/DevAuthDebug";
import { getSession } from "@/lib/auth";
import {
  postLoginRouteForUser,
  workspaceSelectCardsForUser,
} from "@/lib/auth/postLoginRouting";
import { isAdminOperator } from "@/lib/workspaceAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_LINKS = [
  { href: "/operator/jobs/brief", label: "Career Brief", detail: "Daily operating surface" },
  { href: "/operator/jobs", label: "Full pipeline", detail: "AE job operating system" },
  { href: "/admin/prospects", label: "Prospect research", detail: "Internal outreach cohorts" },
  { href: "/admin/outreach", label: "Outreach", detail: "Founder outreach queue" },
  { href: "/admin/runs", label: "Runs", detail: "Pipeline run history" },
] as const;

export default async function WorkspaceSelectPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/workspace-select");

  const cards = workspaceSelectCardsForUser(user);
  if (cards.length === 0) {
    return (
      <main className="workspace-select-shell">
        <section className="workspace-select-card">
          <p className="workspace-select-eyebrow">Meridian</p>
          <h1>No workspace assigned</h1>
          <p className="workspace-select-copy">Contact your Meridian administrator.</p>
          <Link href="/login" className="workspace-select-back">Sign in with a different account</Link>
        </section>
      </main>
    );
  }

  if (cards.length === 1) {
    redirect(postLoginRouteForUser(user));
  }

  const showAdmin = isAdminOperator(user);

  return (
    <main className="workspace-select-shell">
      <DevAuthDebug page="workspace-select" />
      <section className="workspace-select-card workspace-select-card-wide">
        <p className="workspace-select-eyebrow">Meridian workspace access</p>
        <h1>Choose a workspace</h1>
        <p className="workspace-select-copy">
          Signed in as <strong>{user.name}</strong>
          {showAdmin ? " — admin & builder access" : ""}
        </p>

        <div className="workspace-select-grid" role="list">
          {cards.map((card) => (
            <Link
              key={card.slug}
              href={card.href}
              className="workspace-select-tile"
              role="listitem"
              aria-label={`Open ${card.title}`}
            >
              <span className="workspace-select-tile-kind">{kindLabel(card.kind)}</span>
              <strong>{card.title}</strong>
              <span>{card.subtitle}</span>
              <span className="workspace-select-tile-action" aria-hidden="true">
                Open workspace →
              </span>
            </Link>
          ))}
        </div>

        {showAdmin ? (
          <div className="workspace-select-admin">
            <p className="workspace-select-admin-label">Admin tools</p>
            <div className="workspace-select-admin-grid">
              {ADMIN_LINKS.map((link) => (
                <Link key={link.href} href={link.href} className="workspace-select-admin-link">
                  <strong>{link.label}</strong>
                  <span>{link.detail}</span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="workspace-select-footer">
          <Link href="/" className="workspace-select-back">Back to meridian.ai</Link>
          <Link href="/api/auth/logout" className="workspace-select-back">
            Sign out
          </Link>
        </div>
      </section>
    </main>
  );
}

function kindLabel(kind: string): string {
  if (kind === "labortech") return "Operator";
  if (kind === "personal") return "Relationships";
  if (kind === "relationship") return "Demo desk";
  return "Workspace";
}
