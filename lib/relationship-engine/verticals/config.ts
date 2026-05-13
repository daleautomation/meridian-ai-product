// Meridian Relationship Engine — vertical configuration layer.
//
// Verticals may tune presentation and policy inputs. They must not redefine
// canonical entities, lifecycle state, timeline taxonomy, score trace shape,
// repository interfaces, or DTO boundary rules.

import type { FollowUpCadenceWindow } from "../followups/policies";
import type { LifecycleState } from "../relationship/lifecycle";
import type { HealthScoreComponentKey } from "../scoring/healthScoreTrace";
import type { TimelineEventCategory } from "../timeline/events";
import type { VerticalId } from "../primitives";

export interface VerticalLifecycleAlias {
  canonical: LifecycleState;
  label: string;
  aliases?: string[];
}

export interface VerticalEventWeight {
  category: TimelineEventCategory;
  type?: string;
  weight: number;
  rationale: string;
}

export interface VerticalWorkflowEmphasis {
  key:
    | "speed_to_lead"
    | "promise_integrity"
    | "retention"
    | "referrals"
    | "reactivation"
    | "opportunity_creation";
  weight: number;
  rationale: string;
}

export interface VerticalRelationshipConfig {
  id: VerticalId;
  label: string;
  lifecycleAliases?: VerticalLifecycleAlias[];
  cadenceWindows?: Partial<Record<LifecycleState, FollowUpCadenceWindow>>;
  eventWeights?: VerticalEventWeight[];
  healthComponentWeights?: Partial<Record<HealthScoreComponentKey, number>>;
  workflowEmphasis?: VerticalWorkflowEmphasis[];
  copyLabels?: Record<string, string>;
}

export const CANONICAL_VERTICAL_BOUNDARIES = [
  "RelationshipEntity shape",
  "RelationshipId identity semantics",
  "LifecycleState canonical values and transition validity",
  "TimelineEvent category taxonomy",
  "HealthScoreTrace component evidence requirements",
  "QueueCandidate why-now and evidence requirements",
  "Repository interface responsibilities",
  "DTO boundary ownership",
] as const;
