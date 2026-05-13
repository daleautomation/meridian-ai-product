// Meridian Relationship Engine — lifecycle transition validation.
//
// This layer is a guardrail, not a workflow engine. It validates proposed
// transitions and reason requirements without saving entities or timeline
// events. Future fixture tests should cover canonical states, legacy CRM alias
// normalization, terminal states, and reason/evidence requirements.

import type { EvidenceRef } from "../primitives";
import {
  ALLOWED_LIFECYCLE_TRANSITIONS,
  LIFECYCLE_STATE,
  isLifecycleState,
  type LifecycleState,
} from "../relationship/lifecycle";

export interface LifecycleTransitionRequest {
  from: LifecycleState;
  to: LifecycleState;
  reason?: string | null;
  evidence?: EvidenceRef[];
  requireEvidence?: boolean;
}

export type LifecycleTransitionValidationCode =
  | "invalid_transition"
  | "missing_transition_reason"
  | "missing_transition_evidence";

export interface LifecycleTransitionValidationResult {
  ok: boolean;
  from: LifecycleState;
  to: LifecycleState;
  code?: LifecycleTransitionValidationCode;
  message?: string;
}

export class InvalidLifecycleTransitionError extends Error {
  readonly code: LifecycleTransitionValidationCode;
  readonly from: LifecycleState;
  readonly to: LifecycleState;

  constructor(result: LifecycleTransitionValidationResult) {
    super(result.message ?? "Invalid lifecycle transition");
    this.name = "InvalidLifecycleTransitionError";
    this.code = result.code ?? "invalid_transition";
    this.from = result.from;
    this.to = result.to;
  }
}

const LEGACY_LIFECYCLE_ALIASES: Record<string, LifecycleState> = {
  NEW: LIFECYCLE_STATE.NEW,
  READY_TO_CALL: LIFECYCLE_STATE.QUALIFIED,
  CONTACTED: LIFECYCLE_STATE.ACTIVE,
  VOICEMAIL: LIFECYCLE_STATE.ACTIVE,
  EMAILED: LIFECYCLE_STATE.ACTIVE,
  INTERESTED: LIFECYCLE_STATE.OPPORTUNITY,
  FOLLOW_UP: LIFECYCLE_STATE.NURTURING,
  QUALIFIED: LIFECYCLE_STATE.QUALIFIED,
  CLOSED_WON: LIFECYCLE_STATE.RETAINED,
  CLOSED_LOST: LIFECYCLE_STATE.CLOSED_LOST,
  NOT_QUALIFIED: LIFECYCLE_STATE.CLOSED_LOST,
  ARCHIVED: LIFECYCLE_STATE.CLOSED_LOST,
};

export function normalizeLifecycleState(
  value: unknown,
  aliases: Record<string, LifecycleState> = LEGACY_LIFECYCLE_ALIASES,
): LifecycleState | null {
  if (isLifecycleState(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replaceAll(" ", "_");
  return aliases[normalized] ?? null;
}

export function validateLifecycleTransition(
  request: LifecycleTransitionRequest,
): LifecycleTransitionValidationResult {
  if (request.from === request.to) {
    return { ok: true, from: request.from, to: request.to };
  }
  if (!ALLOWED_LIFECYCLE_TRANSITIONS[request.from].includes(request.to)) {
    return {
      ok: false,
      from: request.from,
      to: request.to,
      code: "invalid_transition",
      message: `Lifecycle transition ${request.from} -> ${request.to} is not allowed.`,
    };
  }
  if (!request.reason || request.reason.trim().length === 0) {
    return {
      ok: false,
      from: request.from,
      to: request.to,
      code: "missing_transition_reason",
      message: "Lifecycle transitions require an explicit reason.",
    };
  }
  if (request.requireEvidence && (!request.evidence || request.evidence.length === 0)) {
    return {
      ok: false,
      from: request.from,
      to: request.to,
      code: "missing_transition_evidence",
      message: "Lifecycle transitions require evidence in this context.",
    };
  }
  return { ok: true, from: request.from, to: request.to };
}

export function assertLifecycleTransition(
  request: LifecycleTransitionRequest,
): LifecycleTransitionValidationResult {
  const result = validateLifecycleTransition(request);
  if (!result.ok) throw new InvalidLifecycleTransitionError(result);
  return result;
}
