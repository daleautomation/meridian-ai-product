import { redirect } from "next/navigation";
import { AeJobOperatingSystem } from "@/components/operator/AeJobOperatingSystem";
import { getSession } from "@/lib/auth";
import { buildAeJobsWorkspaceModel } from "@/lib/ae-jobs/workspace";
import { loadAeJobsStore } from "@/lib/ae-jobs/store";

export const dynamic = "force-dynamic";

export default async function AeJobsPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/operator/jobs");

  const store = await loadAeJobsStore(user.id);
  const model = buildAeJobsWorkspaceModel(store.opportunities, user, store.lastIngestedAt);

  return <AeJobOperatingSystem initialModel={model} />;
}
