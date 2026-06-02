import { redirect } from "next/navigation";
import { CareerBrief } from "@/components/operator/CareerBrief";
import { buildCareerBriefModel } from "@/lib/ae-jobs/career-brief";
import { ensureDemoCalendarIfEmpty } from "@/lib/ae-jobs/calendar-store";
import { loadAeJobsStore } from "@/lib/ae-jobs/store";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CareerBriefPage() {
  const user = await getSession();
  if (!user) redirect("/login?next=/operator/jobs/brief");

  const [store, calendarStore] = await Promise.all([
    loadAeJobsStore(user.id),
    ensureDemoCalendarIfEmpty(user.id),
  ]);

  const model = buildCareerBriefModel(store.opportunities, user, {
    lastIngestedAt: store.lastIngestedAt,
    lastResult: store.lastIngestionResult ?? null,
  }, {
    events: calendarStore.events,
    lastSyncedAt: calendarStore.lastSyncedAt,
  });

  return <CareerBrief model={model} />;
}
