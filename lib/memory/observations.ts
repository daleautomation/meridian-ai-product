// Meridian Command — memory as a Reality Layer sensor.
//
// Active memories emit Observations so they are visible in the reality stream and
// health. IMPORTANT: these observations never affect momentum/stage in the Belief
// Engine (which excludes memory types) — they are context. Ranking influence
// happens transparently at the recommendation layer (lib/beliefs/recommend).

import { observationId, type Observation, type ObservationType } from "@/lib/connectors/types";
import { confidenceScore, isStale, type Memory } from "./types";

const TYPE_TO_OBS: Record<Memory["type"], ObservationType> = {
  strategic_knowledge: "strategic_memory_active",
  preference: "preference_active",
  fact: "fact_active",
};

export function memoriesToObservations(memories: Memory[], nowMs: number): Observation[] {
  const observedAt = new Date(nowMs).toISOString();
  const out: Observation[] = [];

  for (const m of memories) {
    if (m.status === "rejected" || m.status === "pending") continue; // pending never emits
    const stale = isStale(m, nowMs);
    const type: ObservationType = stale ? "memory_stale" : TYPE_TO_OBS[m.type];
    out.push({
      id: observationId("memory", type, m.id),
      connector: "memory",
      type,
      timestamp: m.updatedAt,
      observedAt,
      entity: m.subject.toLowerCase(),
      people: [],
      company: m.subject && !["global", "self", "dylan", "meridian"].includes(m.subject.toLowerCase()) ? m.subject : null,
      direction: null,
      evidence: { source: "memory", nativeId: m.id, subject: `${m.type}: ${m.subject}`, excerpt: m.statement },
      confidence: confidenceScore(m.confidence),
      metadata: { memoryType: m.type, impactAreas: m.impactAreas, tags: m.tags, statusStale: stale },
    });
  }
  return out;
}
