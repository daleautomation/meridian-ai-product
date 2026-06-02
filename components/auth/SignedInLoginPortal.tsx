import Link from "next/link";
import type { PublicUser } from "@/config/tenants";
import {
  isPostLoginPathAllowed,
  postLoginRouteForUser,
  sanitizeInternalPath,
  workspaceSelectCardsForUser,
  type WorkspaceSelectCard,
} from "@/lib/auth/postLoginRouting";
import { isAdminOperator } from "@/lib/workspaceAccess";

const ADMIN_LINKS = [
  { href: "/operator/jobs/brief", label: "Career Brief", detail: "Daily operating surface" },
  { href: "/operator/jobs", label: "Full pipeline", detail: "AE job operating system" },
  { href: "/admin/prospects", label: "Prospect research", detail: "Internal outreach cohorts" },
  { href: "/admin/outreach", label: "Outreach", detail: "Founder outreach queue" },
  { href: "/admin/runs", label: "Runs", detail: "Pipeline run history" },
] as const;

type Props = {
  user: PublicUser;
  requestedNext?: string | null;
};

export function SignedInLoginPortal({ user, requestedNext }: Props) {
  const cards = workspaceSelectCardsForUser(user);
  const showAdmin = isAdminOperator(user);
  const safeNext = sanitizeInternalPath(requestedNext ?? null);
  const nextAllowed = safeNext && isPostLoginPathAllowed(user, safeNext) ? safeNext : null;
  const defaultRoute = postLoginRouteForUser(user);

  if (cards.length === 0) {
    return (
      <div className="workspace-login-layout">
        <section className="workspace-login-card">
          <p className="workspace-login-eyebrow">Meridian</p>
          <h1 className="workspace-login-title">No workspace assigned</h1>
          <p className="workspace-login-sub">Contact your Meridian administrator.</p>
          <PortalFooter />
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-login-layout">
      <section className="workspace-login-card workspace-select-card-wide">
        <p className="workspace-login-eyebrow">Meridian client portal</p>
        <h1 className="workspace-login-title">Signed in</h1>
        <p className="workspace-login-sub">
          You are signed in as <strong>{user.name}</strong>
          {showAdmin ? " — admin & builder access" : ""}. Choose a workspace to continue, or sign out
          to switch accounts.
        </p>

        {nextAllowed ? (
          <div className="workspace-login-next-banner">
            <Link href={nextAllowed} className="workspace-login-submit workspace-login-continue-primary">
              Continue to requested destination →
            </Link>
          </div>
        ) : defaultRoute === "/operator/jobs/brief" ? (
          <div className="workspace-login-next-banner">
            <Link
              href={defaultRoute}
              className="workspace-login-submit workspace-login-continue-primary"
            >
              Open Career Brief →
            </Link>
          </div>
        ) : null}

        {cards.length === 1 ? (
          <div className="workspace-login-continue-single">
            <Link
              href={cards[0].href}
              className="workspace-login-submit workspace-login-continue-primary"
            >
              {continueLabel(cards[0])} →
            </Link>
          </div>
        ) : (
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
        )}

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

        <PortalFooter />
      </section>
    </div>
  );
}

function PortalFooter() {
  return (
    <div className="workspace-select-footer workspace-login-portal-footer">
      <Link href="/" className="workspace-select-back">
        Back to meridian.ai
      </Link>
      <Link href="/api/auth/logout" className="workspace-select-back">
        Sign out
      </Link>
      <Link href="/api/auth/logout?next=/login" className="workspace-select-back">
        Switch account
      </Link>
    </div>
  );
}

function continueLabel(card: WorkspaceSelectCard): string {
  if (card.slug === "nicole-lonergan") return "Continue to Nicole Lonergan Workspace";
  if (card.slug === "labortech") return "Continue to LaborTech Workspace";
  return `Continue to ${card.title}`;
}

function kindLabel(kind: string): string {
  if (kind === "labortech") return "Operator";
  if (kind === "personal") return "Relationships";
  if (kind === "relationship") return "Demo desk";
  return "Workspace";
}
