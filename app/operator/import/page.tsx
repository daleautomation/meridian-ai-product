import { redirect } from "next/navigation";
import CrmImportWizard from "@/components/crm-import/CrmImportWizard";
import { getSession } from "@/lib/auth";
import { listWorkspacesForUser } from "@/config/workspaces";
import { getWorkspaceAccess } from "@/lib/workspaceAccess";

export const dynamic = "force-dynamic";

type SearchParams = {
  workspace?: string | string[];
};

export default async function CrmImportPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");

  const params = (await searchParams) ?? {};
  const requestedSlug = Array.isArray(params.workspace) ? params.workspace[0] : params.workspace;
  const workspaces = listWorkspacesForUser(user.workspaces ?? []);

  let workspaceSlug = requestedSlug;
  if (!workspaceSlug && workspaces.length === 1) {
    workspaceSlug = workspaces[0].slug;
  }
  if (!workspaceSlug) {
    redirect("/operator/relationship-priority");
  }

  const access = getWorkspaceAccess(user, workspaceSlug);
  if (!access.ok) redirect("/operator/relationship-priority");

  const workspace = access.workspace;
  return (
    <CrmImportWizard
      workspaceId={workspace.slug}
      workspaceName={workspace.branding?.displayName ?? workspace.name}
    />
  );
}
