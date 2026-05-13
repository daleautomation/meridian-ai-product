// Meridian Relationship Engine — canonical lifecycle model.
//
// Lifecycle is relationship state, not UI tab state. Vertical labels may alias
// these values, but persisted engine state must remain one of these constants.

export const LIFECYCLE_STATE = {
  NEW: "NEW",
  QUALIFIED: "QUALIFIED",
  ACTIVE: "ACTIVE",
  NURTURING: "NURTURING",
  OPPORTUNITY: "OPPORTUNITY",
  RETAINED: "RETAINED",
  REFERRAL_SOURCE: "REFERRAL_SOURCE",
  DORMANT: "DORMANT",
  REACTIVATION: "REACTIVATION",
  RETENTION_RISK: "RETENTION_RISK",
  CLOSED_LOST: "CLOSED_LOST",
} as const;

export type LifecycleState = (typeof LIFECYCLE_STATE)[keyof typeof LIFECYCLE_STATE];

export const LIFECYCLE_STATES: LifecycleState[] = Object.values(LIFECYCLE_STATE);

export const TERMINAL_LIFECYCLE_STATES: LifecycleState[] = [
  LIFECYCLE_STATE.CLOSED_LOST,
];

export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  NEW: [
    LIFECYCLE_STATE.QUALIFIED,
    LIFECYCLE_STATE.NURTURING,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  QUALIFIED: [
    LIFECYCLE_STATE.ACTIVE,
    LIFECYCLE_STATE.NURTURING,
    LIFECYCLE_STATE.OPPORTUNITY,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  ACTIVE: [
    LIFECYCLE_STATE.NURTURING,
    LIFECYCLE_STATE.OPPORTUNITY,
    LIFECYCLE_STATE.RETAINED,
    LIFECYCLE_STATE.RETENTION_RISK,
    LIFECYCLE_STATE.DORMANT,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  NURTURING: [
    LIFECYCLE_STATE.ACTIVE,
    LIFECYCLE_STATE.OPPORTUNITY,
    LIFECYCLE_STATE.DORMANT,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  OPPORTUNITY: [
    LIFECYCLE_STATE.ACTIVE,
    LIFECYCLE_STATE.RETAINED,
    LIFECYCLE_STATE.NURTURING,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  RETAINED: [
    LIFECYCLE_STATE.REFERRAL_SOURCE,
    LIFECYCLE_STATE.RETENTION_RISK,
    LIFECYCLE_STATE.DORMANT,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  REFERRAL_SOURCE: [
    LIFECYCLE_STATE.RETAINED,
    LIFECYCLE_STATE.NURTURING,
    LIFECYCLE_STATE.DORMANT,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  DORMANT: [
    LIFECYCLE_STATE.REACTIVATION,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  REACTIVATION: [
    LIFECYCLE_STATE.ACTIVE,
    LIFECYCLE_STATE.NURTURING,
    LIFECYCLE_STATE.DORMANT,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  RETENTION_RISK: [
    LIFECYCLE_STATE.ACTIVE,
    LIFECYCLE_STATE.RETAINED,
    LIFECYCLE_STATE.DORMANT,
    LIFECYCLE_STATE.CLOSED_LOST,
  ],
  CLOSED_LOST: [],
};

export const LIFECYCLE_INVARIANTS: Record<LifecycleState, string[]> = {
  NEW: ["Relationship exists but has not yet been qualified by evidence or operator action."],
  QUALIFIED: ["Identity and fit are credible enough for deliberate engagement."],
  ACTIVE: ["There is recent two-way activity or an active operator motion."],
  NURTURING: ["Relationship is intentionally maintained without an immediate opportunity."],
  OPPORTUNITY: ["There is a concrete commercial or strategic outcome in progress."],
  RETAINED: ["Relationship has produced a successful retained outcome."],
  REFERRAL_SOURCE: ["Relationship can credibly introduce or influence other relationships."],
  DORMANT: ["No meaningful activity is present inside the configured dormancy window."],
  REACTIVATION: ["Engine or operator is actively attempting to revive a dormant relationship."],
  RETENTION_RISK: ["Retained relationship has evidence of churn, dissatisfaction, or missed promises."],
  CLOSED_LOST: ["Relationship is no longer actionable unless explicitly reopened by a new entity event."],
};

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && LIFECYCLE_STATES.includes(value as LifecycleState);
}

export function isLifecycleTransitionAllowed(
  from: LifecycleState,
  to: LifecycleState,
): boolean {
  if (from === to) return true;
  return ALLOWED_LIFECYCLE_TRANSITIONS[from].includes(to);
}
