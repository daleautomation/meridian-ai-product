import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { defaultWorkspaceFor } from "../config/workspaces";
import WelcomePage from "../components/WelcomePage";

export default async function Page() {
  const user = await getSession();
  if (user) {
    const workspaces = user.workspaces ?? [];
    if (workspaces.length === 1) {
      const ws = defaultWorkspaceFor(workspaces);
      if (ws) redirect(`/operator?workspace=${ws.slug}`);
    }
    // Multiple or zero resolvable workspaces → operator handles picker.
    redirect("/operator");
  }
  return <WelcomePage isAuthenticated={false} />;
}
