import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { OpsCenter } from "@/components/operator";
import { loadOpsReport } from "@/lib/ops/opsReportStore";

// Operator-only operations surface. Reads the latest snapshot written by
// `npm run ops`; never runs checks or touches Neon at request time.
export const dynamic = "force-dynamic";

export default async function OpsCenterPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const report = await loadOpsReport();
  return <OpsCenter report={report} />;
}
