// Meridian AI — find_stale_companies tool.
//
// Returns companies whose lastCheckedAt is older than the threshold, or
// who have never been checked. Use to drive the refresh workflow.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { listSnapshots } from "@/lib/state/companySnapshotStore";

export type FindStaleCompaniesInput = {
  olderThanDays?: number;       // default 7
  limit?: number;
};

export type StaleEntry = {
  key: string;
  name: string;
  domain?: string;
  status?: string;
  lastCheckedAt: string | null;
  staleDays: number | null;     // null = never checked
};

export type FindStaleCompaniesData = {
  thresholdDays: number;
  total: number;
  companies: StaleEntry[];
};

function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

async function handler(
  input: FindStaleCompaniesInput
): Promise<ToolResult<FindStaleCompaniesData>> {
  const timestamp = nowIso();
  const threshold = Math.max(0, input.olderThanDays ?? 7);
  const all = await listSnapshots();

  const entries: StaleEntry[] = all
    .map((s) => ({
      key: s.key,
      name: s.company.name,
      domain: s.company.domain,
      status: s.status,
      lastCheckedAt: s.lastCheckedAt ?? null,
      staleDays: daysSince(s.lastCheckedAt),
    }))
    .filter((e) => e.staleDays === null || e.staleDays >= threshold)
    // never-checked first, then oldest first
    .sort((a, b) => {
      if (a.staleDays === null && b.staleDays !== null) return -1;
      if (b.staleDays === null && a.staleDays !== null) return 1;
      return (b.staleDays ?? 0) - (a.staleDays ?? 0);
    });

  const limit = Math.max(1, Math.min(500, input.limit ?? 100));
  const sliced = entries.slice(0, limit);

  return {
    tool: "find_stale_companies",
    company: { name: "*" },
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_read",
        source: "data/companySnapshots.json",
        observedAt: timestamp,
        detail: `scanned ${all.length} snapshots; ${entries.length} stale at threshold=${threshold}d`,
      },
    ],
    data: { thresholdDays: threshold, total: entries.length, companies: sliced },
    stub: false,
  };
}

export const findStaleCompaniesTool: ToolDefinition<
  FindStaleCompaniesInput,
  FindStaleCompaniesData
> = {
  name: "find_stale_companies",
  description:
    "Lists companies whose lastCheckedAt is older than olderThanDays (default 7) or who have never been checked.",
  inputSchema: {
    type: "object",
    properties: {
      olderThanDays: { type: "number", description: "Staleness threshold in days (default 7)" },
      limit: { type: "number", description: "Max records (default 100, max 500)" },
    },
    additionalProperties: false,
  },
  handler,
};
