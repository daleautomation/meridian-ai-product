// Maps verified property enrichment into RecoverySignal[] for the Brookside workspace.

import {
  buildSellerTimingSignals,
  SELLER_TIMING_TO_WORKSPACE_SIGNAL,
  type PropertyEnrichmentInput,
  type SellerTimingSignal,
} from "@/lib/enrichment/property";
import type { RecoverySignal, WorkspaceSignalConfig } from "@/lib/recovery/signals/types";
import { isWellFormedSignal } from "@/lib/recovery/signals/types";

function lookupDef(config: WorkspaceSignalConfig, name: string) {
  return config.signals.find((s) => s.name === name);
}

function workspaceSignalName(timing: SellerTimingSignal): string | null {
  const mapped = SELLER_TIMING_TO_WORKSPACE_SIGNAL[timing.kind];
  if (!mapped) return null;
  if (timing.kind === "stale_relationship_plus_property_match") {
    return "stale_relationship";
  }
  return mapped;
}

export function sellerTimingToRecoverySignal(
  timing: SellerTimingSignal,
  config: WorkspaceSignalConfig,
  leadKey: string,
): RecoverySignal | null {
  const signalName = workspaceSignalName(timing);
  if (!signalName) return null;

  const def = lookupDef(config, signalName);
  if (!def) return null;

  const signal: RecoverySignal = {
    id: `enrichment:${config.slug}:${leadKey}:${signalName}:${timing.recordId}`,
    name: def.name,
    category: def.category,
    source: timing.source,
    sourceTier: def.sourceTier,
    recordId: timing.recordId,
    observedAt: timing.observedAt,
    confidence: timing.confidence,
    halfLifeDays: def.defaultHalfLifeDays,
    weight: def.defaultWeight,
    evidenceUrl: timing.evidenceUrl,
    evidenceLabel: timing.evidenceLabel,
    explanation: timing.explanation,
    payload: {
      leadKey,
      propertyKey: timing.propertyKey,
      sellerTimingKind: timing.kind,
      evidence: timing.evidence,
    },
    workspaceSlug: config.slug,
    status: "active",
    sourceUrl: null,
  };

  return isWellFormedSignal(signal) ? signal : null;
}

export function buildPropertyEnrichmentSignals(input: {
  enrichment: PropertyEnrichmentInput;
  config: WorkspaceSignalConfig;
  leadKey: string;
  nowIso: string;
}): RecoverySignal[] {
  const timingSignals = buildSellerTimingSignals(input.enrichment, input.nowIso);
  const out: RecoverySignal[] = [];
  const seen = new Set<string>();

  for (const timing of timingSignals) {
    const mapped = workspaceSignalName(timing);
    if (!mapped || seen.has(mapped)) continue;
    const recovery = sellerTimingToRecoverySignal(timing, input.config, input.leadKey);
    if (recovery) {
      seen.add(mapped);
      out.push(recovery);
    }
  }

  return out;
}
