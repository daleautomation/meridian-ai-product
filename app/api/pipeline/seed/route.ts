// Meridian AI — seed pipeline endpoint.
//
// POST /api/pipeline/seed
// Imports KC roofing companies from data/seed/kc-roofing-companies.json,
// runs prefilter, then batch inspects (website + opportunity summary).
//
// GET /api/pipeline/seed?status=true
// Returns current pipeline counts without mutating.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { callTool } from "@/lib/mcp/registry";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — batch inspect can be slow

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ranked = await callTool("rank_companies", { limit: 500 });
  const data = ranked.data as { total: number; ranked: unknown[] } | null;

  return NextResponse.json({
    ok: true,
    pipeline: {
      total: data?.total ?? 0,
      ranked: data?.ranked?.length ?? 0,
    },
  });
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const skipInspect = url.searchParams.has("skipInspect");
  const inspectLimit = parseInt(url.searchParams.get("inspectLimit") ?? "25", 10);
  const concurrency = parseInt(url.searchParams.get("concurrency") ?? "3", 10);

  const results: Record<string, unknown> = {};

  // Step 1: Import from seed file
  const seedPath = path.join(process.cwd(), "data", "seed", "kc-roofing-companies.json");
  const seedRaw = await fs.readFile(seedPath, "utf8");
  const companies = JSON.parse(seedRaw);

  const importRes = await callTool("import_companies", {
    source: "labortech_kc_roofing_seed",
    companies,
  });
  results.import = {
    received: (importRes.data as Record<string, unknown>)?.received,
    inserted: (importRes.data as Record<string, unknown>)?.inserted,
    duplicates: (importRes.data as Record<string, unknown>)?.duplicates,
    total: (importRes.data as Record<string, unknown>)?.total,
  };

  // Step 2: Prefilter
  const prefilterRes = await callTool("prefilter_companies", { reapply: false });
  results.prefilter = {
    scanned: (prefilterRes.data as Record<string, unknown>)?.scanned,
    passed: (prefilterRes.data as Record<string, unknown>)?.passed,
    filtered: (prefilterRes.data as Record<string, unknown>)?.filtered,
  };

  // Step 3: Batch inspect (optional, limited)
  if (!skipInspect) {
    const inspectRes = await callTool("batch_inspect", {
      limit: Math.min(inspectLimit, 50),
      concurrency: Math.min(concurrency, 4),
      staleDays: 7,
    });
    const inspectData = inspectRes.data as Record<string, unknown>;
    results.inspect = {
      considered: inspectData?.considered,
      succeeded: inspectData?.succeeded,
      failed: inspectData?.failed,
      skippedFresh: inspectData?.skippedFresh,
    };
  }

  // Step 4: Get top opportunities summary
  const topRes = await callTool("top_opportunities", { callNowLimit: 25, todayLimit: 25 });
  const topData = topRes.data as Record<string, unknown>;
  results.topOpportunities = (topData as Record<string, unknown>)?.summary;

  return NextResponse.json({ ok: true, results });
}
