import { redirect } from "next/navigation";
import PlatformShell from "../components/PlatformShell";
import { getSession } from "../lib/auth";
import { loadRealEstateItems } from "../lib/adapters/realEstate";
import { loadWatchesItems } from "../lib/adapters/watches";

export default async function Page() {
  const user = await getSession();
  if (!user) redirect("/login");
  const realEstateItems = user.modules.includes("real-estate")
    ? await loadRealEstateItems(user.geo)
    : null;
  const watchesItems = user.modules.includes("watches")
    ? await loadWatchesItems(user.id)
    : null;
  return <PlatformShell realEstateItems={realEstateItems} watchesItems={watchesItems} />;
}
