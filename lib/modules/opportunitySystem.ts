// Meridian AI — Opportunity System builder.
//
// Joins prioritized angles + leadsByAngle + the bucket action config
// into a single render-ready structure for the UI. Pure: no I/O, no
// React. Same input → same output.
//
//   { tiers, topBucketId, hasAnyReady, totalLeads }
//
// Sorting within each tier:
//   1. revenue potential (descending)
//   2. lead count (descending)
//   3. label (stable)

import { leadOpportunityValue } from "../leads/leadActions";
import {
  BUCKET_ACTIONS,
  TIER_ORDER,
  TIER_SUBTITLES,
  TIER_TITLES,
  bucketTierFromPriorityLabel,
  resolveBucketAction,
  type BucketTier,
} from "./bucketActionConfig";
import type { TradeId } from "./tradeConfigs";
import type { PrioritizedServiceAngle } from "./anglePrioritization";

export interface OpportunityBucket {
  bucketId: string;
  /** Action-based label, e.g. "Fix their website". */
  actionLabel: string;
  /** Original engine label, e.g. "Website Conversion". Kept for the
   *  cases where a downstream component still wants the raw name. */
  engineLabel: string;
  description: string;
  tier: BucketTier;
  count: number;
  highConfidenceCount: number;
  /** Sum of probability-adjusted opportunity across leads in this bucket. */
  revenuePotential: number;
  /** True when there is at least one lead the operator can call. */
  ready: boolean;
}

export interface OpportunityTier {
  id: BucketTier;
  title: string;
  subtitle: string;
  buckets: OpportunityBucket[];
  totalLeads: number;
  totalRevenue: number;
}

export interface OpportunitySystem {
  tiers: OpportunityTier[];
  /** Bucket id of the highest-priority Call First bucket. Aligned with
   *  the "Where to start" surface so they never disagree. */
  topBucketId: string | null;
  hasAnyReady: boolean;
  totalLeads: number;
  totalRevenue: number;
}

interface Lead {
  expectedValue?: number | null;
  revenueImpact?: number | null;
}

export interface OpportunitySystemOptions {
  /** Hide buckets the operator can't realistically work right now —
   *  no leads AND below revenue threshold. The top Call First bucket
   *  is always shown so the surface never goes empty. */
  meaningfulOnly?: boolean;
  /** Minimum lead count for a bucket to be shown when meaningfulOnly. */
  minLeads?: number;
  /** Minimum revenue potential for an empty bucket to be shown. */
  minRevenue?: number;
}

/** Build the render-ready opportunity system for a trade. */
export function buildOpportunitySystem(
  prioritizedAngles: PrioritizedServiceAngle[] | null | undefined,
  leadsByAngle: Record<string, Lead[]> | null | undefined,
  tradeId: TradeId,
  options: OpportunitySystemOptions = {},
): OpportunitySystem {
  const empty: OpportunitySystem = {
    tiers: TIER_ORDER.map((id) => ({
      id, title: TIER_TITLES[id], subtitle: TIER_SUBTITLES[id],
      buckets: [], totalLeads: 0, totalRevenue: 0,
    })),
    topBucketId: null,
    hasAnyReady: false,
    totalLeads: 0,
    totalRevenue: 0,
  };
  if (!Array.isArray(prioritizedAngles) || prioritizedAngles.length === 0) {
    return empty;
  }

  // Index angles for cheap lookup; we want to render every config-known
  // bucket even if the engine didn't produce a row (e.g. count = 0).
  const angleById = new Map<string, PrioritizedServiceAngle>();
  for (const a of prioritizedAngles) angleById.set(a.bucketId, a);

  const allBucketIds = new Set<string>([
    ...Object.keys(BUCKET_ACTIONS),
    ...prioritizedAngles.map((a) => a.bucketId),
  ]);

  const buckets: OpportunityBucket[] = [];
  for (const bucketId of allBucketIds) {
    const angle = angleById.get(bucketId);
    // We only render a bucket if (a) the trade declared it via the
    // engine OR (b) we have leads for it. Globally-defined buckets that
    // are irrelevant to this trade stay hidden.
    if (!angle && !(leadsByAngle && Array.isArray(leadsByAngle[bucketId]) && leadsByAngle[bucketId].length > 0)) {
      continue;
    }
    const action = resolveBucketAction(
      bucketId,
      tradeId,
      angle?.bucketLabel ?? bucketId,
    );
    const count = angle?.count ?? 0;
    const highConfidenceCount = angle?.highConfidenceCount ?? 0;
    const leads = (leadsByAngle && leadsByAngle[bucketId]) || [];
    let revenuePotential = 0;
    for (const lead of leads) {
      const v = leadOpportunityValue(lead);
      if (v) revenuePotential += v;
    }
    // Engine label wins when present; fall back to action label.
    const engineLabel = angle?.bucketLabel ?? action.actionLabel;
    // Tier comes from the engine; if the engine doesn't classify (e.g.
    // count == 0 + no override), fall back to the config default.
    const tierFromEngine = bucketTierFromPriorityLabel(angle?.priorityLabel);
    const tier: BucketTier = tierFromEngine ?? action.defaultTier;

    buckets.push({
      bucketId,
      actionLabel: action.actionLabel,
      engineLabel,
      description: action.description,
      tier,
      count,
      highConfidenceCount,
      revenuePotential,
      ready: count > 0,
    });
  }

  // Group + sort within each tier.
  const grouped: Record<BucketTier, OpportunityBucket[]> = {
    call_first: [],
    set_up_next: [],
    wait: [],
  };
  for (const b of buckets) grouped[b.tier].push(b);

  const sortBuckets = (a: OpportunityBucket, b: OpportunityBucket) => {
    if (b.revenuePotential !== a.revenuePotential) return b.revenuePotential - a.revenuePotential;
    if (b.count !== a.count) return b.count - a.count;
    return a.actionLabel.localeCompare(b.actionLabel);
  };
  for (const tier of TIER_ORDER) grouped[tier].sort(sortBuckets);

  // Top bucket id = highest-ranked ready bucket in Call First.
  // Computed before filtering so filter never hides the top.
  const callFirstReady = grouped.call_first.find((b) => b.ready);
  const topBucketId = callFirstReady?.bucketId ?? null;

  // Optional filter: hide buckets that are weak AND not the top.
  // "Weak" = no leads AND revenue potential below threshold.
  if (options.meaningfulOnly) {
    const minLeads = options.minLeads ?? 1;
    const minRevenue = options.minRevenue ?? 1000;
    for (const tier of TIER_ORDER) {
      grouped[tier] = grouped[tier].filter((b) => {
        if (b.bucketId === topBucketId) return true;
        if (b.count >= minLeads) return true;
        if (b.revenuePotential >= minRevenue) return true;
        return false;
      });
    }
  }

  const tiers: OpportunityTier[] = TIER_ORDER.map((id) => {
    const tierBuckets = grouped[id];
    return {
      id,
      title: TIER_TITLES[id],
      subtitle: TIER_SUBTITLES[id],
      buckets: tierBuckets,
      totalLeads: tierBuckets.reduce((s, b) => s + b.count, 0),
      totalRevenue: tierBuckets.reduce((s, b) => s + b.revenuePotential, 0),
    };
  });

  const totalLeads = tiers.reduce((s, t) => s + t.totalLeads, 0);
  const totalRevenue = tiers.reduce((s, t) => s + t.totalRevenue, 0);
  const hasAnyReady = tiers.some((t) => t.buckets.some((b) => b.ready));

  return { tiers, topBucketId, hasAnyReady, totalLeads, totalRevenue };
}
