// Meridian AI — Operator execution surface.
//
// Minimal page, orthogonal to the DecisionItem pipeline and the existing
// dashboard. Reads MCP tool output in-process (no HTTP round-trip) and
// renders a compact console: CALL NOW list, top opportunities, and the
// pending review queue. All mutations (generate pitch, create outreach
// review, resolve review) are delegated to the OperatorConsole client
// component, which POSTs to /api/mcp with the session cookie.

import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { callTool } from "../../lib/mcp/registry";
import OperatorConsole from "../../components/OperatorConsole";

export const dynamic = "force-dynamic";

type RankedDecision = {
  key: string;
  name: string;
  domain?: string;
  score: number;
  opportunityLevel: "HIGH" | "MEDIUM" | "LOW";
  recommendedAction: "CALL NOW" | "TODAY" | "MONITOR";
  closeProbability: "High" | "Medium" | "Low";
  topWeaknesses: string[];
  pitchAngle: string | null;
  rationale: string;
  confidenceFloor: number;
  staleDays: number | null;
};

type ReviewItem = {
  id: string;
  kind: string;
  subjectKey: string;
  subjectLabel: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedBy: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

export default async function OperatorPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const [rankedRes, pendingRes] = await Promise.all([
    callTool("rank_companies", { limit: 50 }),
    callTool("list_pending_reviews", { status: "PENDING", limit: 20 }),
  ]);

  const ranked = (rankedRes.data as { ranked: RankedDecision[] } | null)?.ranked ?? [];
  const pendingReviews =
    (pendingRes.data as { reviews: ReviewItem[] } | null)?.reviews ?? [];

  const callNow = ranked.filter((r) => r.recommendedAction === "CALL NOW");
  const today = ranked.filter((r) => r.recommendedAction === "TODAY");

  return (
    <OperatorConsole
      user={{ name: user.name ?? user.id, id: user.id }}
      callNow={callNow}
      today={today}
      pendingReviews={pendingReviews}
      totalPipeline={ranked.length}
    />
  );
}
