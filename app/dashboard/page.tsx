import { redirect } from "next/navigation";
import PlatformShell from "../../components/PlatformShell";
import { getSession } from "../../lib/auth";
import { loadRealEstateItems } from "../../lib/adapters/realEstate";
import { loadWatchesItems } from "../../lib/adapters/watches";
import "@/lib/ingestion/boot";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  const params = await searchParams;
  const realEstateItems = user.modules.includes("real-estate")
    ? await loadRealEstateItems(user.geo, user.id)
    : null;
  const watchesItems = user.modules.includes("watches")
    ? await loadWatchesItems(user.id)
    : null;
  return (
    <PlatformShell
      realEstateItems={realEstateItems}
      watchesItems={watchesItems}
      initialModule={params?.module}
    />
  );
}
