import { redirect } from "next/navigation";
import CrmImportWizard from "@/components/crm-import/CrmImportWizard";
import { getSession } from "@/lib/auth";
import { listWorkspacesForUser } from "@/config/workspaces";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";
import { isPersonalWorkspace, workspaceHomePath, workspaceImportPath } from "@/lib/workspaceRouting";

export const dynamic = "force-dynamic";

type SearchParams = {
  workspace?: string | string[];
};

export default async function PersonalImportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await getSession();
  if (!user) redirect("/login?next=/personal/import");

  const params = (await searchParams) ?? {};
  const requestedSlug = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const personalWorkspaces = listWorkspacesForUser(user.workspaces ?? []).filter(isPersonalWorkspace);

  let workspaceSlug = requestedSlug;
  if (!workspaceSlug && personalWorkspaces.length === 1) {
    workspaceSlug = personalWorkspaces[0].slug;
  }
  if (!workspaceSlug) {
    redirect("/personal");
  }

  const access = getWorkspaceAccess(user, workspaceSlug);
  if (!access.ok) redirect("/personal");

  const workspace = access.workspace;
  if (!isPersonalWorkspace(workspace)) {
    redirect(workspaceImportPath(workspace));
  }

  const home = workspaceHomePath(workspace);
  return (
    <CrmImportWizard
      workspaceId={workspace.slug}
      workspaceName={workspace.branding?.displayName ?? workspace.name}
      returnPath={home}
      backLabel="Back to workspace"
      doneLabel={`Open ${workspace.branding?.displayName ?? "Nicole Lonergan"}'s workspace`}
    />
  );
}
