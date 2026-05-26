import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonalWorkspace } from "@/components/personal";
import { getSession } from "@/lib/auth";
import {
  ContactStorageUnavailableError,
  describeContactStorageMode,
  listContactsByWorkspace,
} from "@/lib/crm-import/store";
import { buildResurfacingBuckets } from "@/lib/relationship-intelligence/resurfacing";
import { buildPersonalWorkspaceModel } from "@/lib/personal-workspace/workspace";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";
import {
  defaultWorkspaceFor,
  listWorkspacesForUser,
  type WorkspaceConfig,
} from "@/config/workspaces";
import {
  isPersonalWorkspace,
  shouldRedirectToWorkspaceSelect,
  WORKSPACE_SELECT_PATH,
  workspaceHomePath,
} from "@/lib/workspaceRouting";
import { personalPalette } from "@/lib/personal-workspace/config";

export const dynamic = "force-dynamic";
// Belt-and-suspenders on top of force-dynamic so no intermediate cache
// layer can serve a stale "0 contacts" view of /personal after an import.
export const revalidate = 0;
export const fetchCache = "force-no-store";

type SearchParams = {
  workspace?: string | string[];
};

export default async function PersonalWorkspacePage(props: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await getSession();
  if (!user) redirect("/login?next=/personal");

  const params = (await props.searchParams) ?? {};
  const requestedSlug = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const userWorkspaces = listWorkspacesForUser(user.workspaces ?? []).filter(isPersonalWorkspace);

  if (userWorkspaces.length === 0) {
    const allAssigned = listWorkspacesForUser(user.workspaces ?? []);
    if (allAssigned.length === 0) {
      return <PersonalAuthShell title="No workspace assigned" copy="This account has no Meridian workspace." />;
    }
    return (
      <PersonalAuthShell
        title="Nicole Lonergan workspace only"
        copy="This account is not assigned to Nicole Lonergan's relationship workspace. Use LaborTech or the advisor demo instead."
      >
        <div style={pickerStyles.grid}>
          {allAssigned.map((ws) => (
            <Link key={ws.slug} href={workspaceHomePath(ws)} style={pickerStyles.card}>
              <strong>{ws.branding?.displayName ?? ws.name}</strong>
              <span>{ws.branding?.accentLabel}</span>
            </Link>
          ))}
        </div>
      </PersonalAuthShell>
    );
  }

  let workspace: WorkspaceConfig | null = null;
  if (requestedSlug) {
    const access = getWorkspaceAccess(user, requestedSlug);
    if (!access.ok) {
      return (
        <PersonalAuthShell title="Access denied" copy={access.reason}>
          <div style={pickerStyles.grid}>
            {userWorkspaces.map((ws) => (
              <Link key={ws.slug} href={workspaceHomePath(ws)} style={pickerStyles.card}>
                <strong>{ws.branding?.displayName ?? ws.name}</strong>
              </Link>
            ))}
          </div>
        </PersonalAuthShell>
      );
    }
    if (!isPersonalWorkspace(access.workspace)) {
      redirect(workspaceHomePath(access.workspace));
    }
    workspace = access.workspace;
  }

  if (!workspace) {
    if (shouldRedirectToWorkspaceSelect(user)) {
      redirect(WORKSPACE_SELECT_PATH);
    }
    if (userWorkspaces.length === 1) {
      const only = defaultWorkspaceFor(user.workspaces ?? []);
      if (only && isPersonalWorkspace(only)) {
        redirect(workspaceHomePath(only));
      }
    }
    return (
      <PersonalAuthShell
        title={`Welcome, ${user.name ?? user.id}`}
        copy="Choose Nicole Lonergan's relationship workspace."
      >
        <div style={pickerStyles.grid}>
          {userWorkspaces.map((ws) => (
            <Link key={ws.slug} href={workspaceHomePath(ws)} style={pickerStyles.card}>
              <strong>{ws.branding?.displayName ?? ws.name}</strong>
              <span>{ws.branding?.accentLabel}</span>
            </Link>
          ))}
        </div>
      </PersonalAuthShell>
    );
  }

  let crmContacts;
  try {
    crmContacts = await listContactsByWorkspace(workspace.slug);
  } catch (err) {
    if (err instanceof ContactStorageUnavailableError) {
      return (
        <PersonalAuthShell
          title="Contact storage not configured"
          copy={
            `Imports for "${workspace.branding?.displayName ?? workspace.name}" cannot be loaded ` +
            `because durable storage is not configured for this deployment. ` +
            `Set DATABASE_URL or POSTGRES_URL in the production environment, redeploy, ` +
            `and re-run the contact import. This page intentionally refuses to render ` +
            `as "0 contacts" when previously-imported data may still exist elsewhere.`
          }
        />
      );
    }
    throw err;
  }
  // Diagnostic — surface the exact workspaceId / count / storage path
  // each render takes. Lets an operator confirm /personal is reading
  // from the same backend the import wrote to. If `rawCrmContacts`
  // here is > 0 but the model's `totalContacts` is 0, the model
  // filtered every contact out (defect should be in
  // buildPersonalWorkspaceModel). If `rawCrmContacts` is 0 but the
  // import response said inserted=N, the read path is hitting a
  // different store than the write — operator must reconcile
  // DATABASE_URL across environments.
  const personalStorage = describeContactStorageMode();
  const rawCrmContacts = crmContacts;
  // eslint-disable-next-line no-console
  console.log(
    `[personal/page] read workspaceId=${workspace.slug} ` +
      `rawCrmContacts.length=${rawCrmContacts.length} ` +
      `storageMode=${personalStorage.mode} durable=${personalStorage.durable}`,
  );
  const resurfacingBuckets = buildResurfacingBuckets(rawCrmContacts);
  const model = buildPersonalWorkspaceModel({
    workspace,
    user,
    crmContacts: rawCrmContacts,
    resurfacingBuckets,
  });
  // eslint-disable-next-line no-console
  console.log(
    `[personal/page] model workspaceId=${workspace.slug} ` +
      `totalContacts=${model.summary.totalContacts} ` +
      `priorityCount=${model.summary.priorityCount} ` +
      `followUpsDue=${model.summary.followUpsDue} ` +
      `dormantCount=${model.summary.dormantCount} ` +
      `needsEnrichment=${model.summary.needsEnrichment}`,
  );

  return <PersonalWorkspace model={model} />;
}

function PersonalAuthShell({
  title,
  copy,
  children,
}: {
  title: string;
  copy: string;
  children?: React.ReactNode;
}) {
  return (
    <main style={pickerStyles.shell}>
      <section style={pickerStyles.cardShell}>
        <h1 style={pickerStyles.title}>{title}</h1>
        <p style={pickerStyles.copy}>{copy}</p>
        {children}
      </section>
    </main>
  );
}

const pickerStyles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: personalPalette.bg,
    fontFamily: "var(--font-inter), sans-serif",
  },
  cardShell: {
    width: "min(480px, 100%)",
    padding: "28px",
    borderRadius: "20px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surface,
  },
  title: {
    margin: "0 0 8px",
    fontSize: "24px",
    fontWeight: 600,
    color: personalPalette.text,
  },
  copy: {
    margin: "0 0 16px",
    fontSize: "14px",
    color: personalPalette.textMuted,
    lineHeight: 1.5,
  },
  grid: {
    display: "grid",
    gap: "10px",
  },
  card: {
    display: "grid",
    gap: "4px",
    padding: "14px 16px",
    borderRadius: "12px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surfaceMuted,
    color: personalPalette.text,
    textDecoration: "none",
  },
};
