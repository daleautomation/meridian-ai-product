interface WorkspaceProp {
  id: string;
  name: string;
  slug: string;
  defaultModule: string;
  enabledModules: string[];
  comingSoonModules: string[];
  branding?: { displayName?: string; accentLabel?: string };
}

interface SourceReadinessItemProp {
  id: string;
  label: string;
  status: "Connected" | "Available" | "Not connected" | "Error";
  detail?: string;
}

interface OperatorConsoleProps {
  user: { name: string; id: string };
  workspace: WorkspaceProp;
  sourceReadiness?: SourceReadinessItemProp[];
  connectedEnvVars?: string[];
  /** True when HUNTER_API_KEY is server-configured. Drives whether
   *  LeadEmailAction surfaces "Find Email" mode. */
  hunterAvailable?: boolean;
  overflowQueueCount?: number;
  /** Capped overflow queue (≤50) — fed to ExecutionOutcomePanel so a
   *  successful outbound outcome can pull the next eligible lead
   *  forward into today via the existing override layer. Order is the
   *  team scheduler's priority (highest-value first). */
  overflowEntries?: Array<{ leadKey: string; companyKey?: string | null; crmKey?: string | null; companyName?: string | null }>;
  teamWorkload?: {
    perRep: Array<{ id: string; name: string; total: number; today?: number }>;
    perWeek: Record<string, number>;
    horizonWeeks: number;
    weekendSkips: number;
    scheduled: number;
    overflow: number;
    today?: number;
    thisWeek?: number;
  };
  serviceBucketsByTrade?: Record<string, {
    cards: Array<{
      serviceId: string;
      label: string;
      tier: "primary" | "secondary" | "advanced";
      count: number;
      topLeadName: string | null;
      topReason: string | null;
      leadKeys: string[];
    }>;
    leadsByService: Record<string, Array<{
      leadKey: string;
      companyName: string;
      location?: string;
      phone?: string;
      serviceLabel: string;
      reason: string;
      needScore: number;
      urgency: "call_now" | "build_next" | "monitor";
      suggestedPitch: string;
      services: Array<{ id: string; label: string }>;
      serviceTags?: Array<{ id: string; label: string; reason: string }>;
      leadState?: "ready_to_call" | "in_progress" | "follow_up" | "closed";
      findings: Array<{ issue: string; evidence: string; impact: string; confidence: "high" | "medium" | "low" }>;
      closeProbability?: number;
      closeLabel?: string;
      primaryAngleLabel?: string;
      primaryAngleEvidence?: string;
      primaryAngleImpact?: string;
      opener?: string;
      recommendedOffer?: string;
      topObjection?: { objection: string; response: string };
    }>>;
  }>;
  callTheseFirst: unknown[];
  todayList: unknown[];
  remaining: unknown[];
  rest?: unknown[];
  pendingReviews: unknown[];
  totalPipeline: number;
  pipelineMap?: Record<string, unknown>;
  roi?: unknown;
  calendarEvents?: unknown[];
  recentActivities?: unknown[];
  lastPipelineJob?: { completedAt: string; errors: number; enriched: number } | null;
  /** ISO timestamp the operator payload snapshot was generated at.
   *  Powers the freshness pill in the header. Null means slow-path. */
  snapshotGeneratedAt?: string | null;
  /** True when the SSR pulled the cached snapshot. False on slow path. */
  snapshotIsFresh?: boolean;
}

declare function OperatorConsole(props: OperatorConsoleProps): React.JSX.Element;
export default OperatorConsole;
