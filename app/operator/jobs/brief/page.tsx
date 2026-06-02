import { redirect } from "next/navigation";
import { CareerBrief } from "@/components/operator/CareerBrief";
import { buildCareerBriefModel } from "@/lib/ae-jobs/career-brief";
import { loadAeJobsStore } from "@/lib/ae-jobs/store";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CareerBriefPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/operator/jobs/brief");

  const store = await loadAeJobsStore(user.id);
  const model = buildCareerBriefModel(store.opportunities, user);

  return <CareerBrief model={model} />;
}
