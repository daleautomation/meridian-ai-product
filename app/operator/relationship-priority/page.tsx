import Link from "next/link";
import { redirect } from "next/navigation";
import { listWorkspacesForUser, defaultWorkspaceFor, type WorkspaceConfig } from "@/config/workspaces";
import { RelationshipPriorityWorkspace } from "@/components/operator";
import { getSession } from "@/lib/auth";
import { buildRelationshipEngineOperatorSurface } from "@/lib/relationship-engine/operatorIntegration";
import { buildRelationshipPriorityWorkspaceModel } from "@/lib/relationship-priority/workspace";
import { parseShowcaseConfig } from "@/lib/relationship-priority/showcase";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";
import { palette } from "@/lib/theme";

export const dynamic = "force-dynamic";

type SearchParams = {
  workspace?: string | string[];
  mode?: string | string[];
  showcase?: string | string[];
  vertical?: string | string[];
  preset?: string | string[];
};

export default async function RelationshipPriorityPage(props: {
  searchParams?: Promise<SearchParams>;
}) {
  try {
    return await renderRelationshipPriorityPage(props);
  } catch (err) {
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return <PriorityLoadError message={message} />;
  }
}

async function renderRelationshipPriorityPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const params = (await searchParams) ?? {};
  const requestedSlug = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const userWorkspaces = listWorkspacesForUser(user.workspaces ?? []);

  if (userWorkspaces.length === 0) {
    return <WorkspaceEmptyState userName={user.name ?? user.id} />;
  }

  let workspace: WorkspaceConfig | null = null;
  if (requestedSlug) {
    const access = getWorkspaceAccess(user, requestedSlug);
    if (!access.ok) {
      return (
        <WorkspaceAccessDenied
          requestedSlug={requestedSlug}
          workspaces={userWorkspaces}
          reason={access.reason}
        />
      );
    }
    workspace = access.workspace;
  }

  if (!workspace) {
    if (userWorkspaces.length === 1) {
      const only = defaultWorkspaceFor(user.workspaces ?? []);
      if (only) redirect(`/operator/relationship-priority?workspace=${only.slug}`);
    }
    return <WorkspacePicker workspaces={userWorkspaces} userName={user.name ?? user.id} />;
  }

  const surface = await buildRelationshipEngineOperatorSurface({ workspace, user });
  const showcaseConfig = parseShowcaseConfig(params);
  const model = buildRelationshipPriorityWorkspaceModel({
    surface,
    workspace,
    user,
    showcaseConfig,
  });
  return <RelationshipPriorityWorkspace model={model} />;
}

function WorkspacePicker({
  workspaces,
  userName,
}: {
  workspaces: WorkspaceConfig[];
  userName: string;
}) {
  return (
    <AuthStateShell eyebrow="Choose workspace" title={`Welcome, ${userName}`}>
      <p style={styles.copy}>Open the relationship-priority desk for the workspace you want to run today.</p>
      <div style={styles.choiceGrid}>
        {workspaces.map((workspace) => (
          <Link
            key={workspace.slug}
            href={`/operator/relationship-priority?workspace=${workspace.slug}`}
            style={styles.choiceCard}
          >
            <strong>{workspace.branding?.displayName ?? workspace.name}</strong>
            <span>{workspace.branding?.accentLabel ?? "Relationship workspace"}</span>
          </Link>
        ))}
      </div>
    </AuthStateShell>
  );
}

function WorkspaceAccessDenied({
  requestedSlug,
  workspaces,
  reason,
}: {
  requestedSlug: string;
  workspaces: WorkspaceConfig[];
  reason: string;
}) {
  return (
    <AuthStateShell eyebrow="Access denied" title={`Workspace "${requestedSlug}" is unavailable`}>
      <p style={styles.copy}>{reason}</p>
      <div style={styles.choiceGrid}>
        {workspaces.map((workspace) => (
          <Link
            key={workspace.slug}
            href={`/operator/relationship-priority?workspace=${workspace.slug}`}
            style={styles.choiceCard}
          >
            <strong>{workspace.branding?.displayName ?? workspace.name}</strong>
            <span>Open available workspace</span>
          </Link>
        ))}
      </div>
    </AuthStateShell>
  );
}

function WorkspaceEmptyState({ userName }: { userName: string }) {
  return (
    <AuthStateShell eyebrow="No workspace" title={`No relationship desk for ${userName}`}>
      <p style={styles.copy}>This account has no Meridian workspace assigned.</p>
    </AuthStateShell>
  );
}

function PriorityLoadError({ message }: { message: string }) {
  return (
    <AuthStateShell eyebrow="Load error" title="Relationship priority workspace failed to load">
      <p style={styles.copy}>{message}</p>
    </AuthStateShell>
  );
}

function AuthStateShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main style={styles.authShell}>
      <section style={styles.authCard}>
        <div style={styles.eyebrow}>{eyebrow}</div>
        <h1 style={styles.title}>{title}</h1>
        {children}
        <Link href="/operator" style={styles.legacyLink}>Open legacy operator console</Link>
      </section>
    </main>
  );
}

const styles = {
  authShell: {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background:
      "radial-gradient(circle at 20% 0%, rgba(37,99,235,0.16), transparent 30%), linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%)",
    color: palette.textPrimary,
    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  },
  authCard: {
    width: "min(560px, 100%)",
    padding: "28px",
    border: `1px solid ${palette.border}`,
    borderRadius: "28px",
    background: palette.surfaceGlass,
    boxShadow: "0 28px 70px rgba(15,23,42,0.10)",
  },
  eyebrow: {
    color: palette.blue,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
  },
  title: {
    margin: "8px 0 8px",
    fontSize: "34px",
    lineHeight: 1,
    letterSpacing: "-0.04em",
  },
  copy: {
    color: palette.textSecondary,
    fontSize: "14px",
    lineHeight: 1.5,
  },
  choiceGrid: {
    display: "grid",
    gap: "10px",
    marginTop: "18px",
  },
  choiceCard: {
    display: "grid",
    gap: "4px",
    padding: "16px",
    border: `1px solid ${palette.border}`,
    borderRadius: "18px",
    background: palette.surface,
    color: palette.textPrimary,
    textDecoration: "none",
  },
  legacyLink: {
    display: "inline-flex",
    marginTop: "18px",
    color: palette.textSecondary,
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
  },
};
