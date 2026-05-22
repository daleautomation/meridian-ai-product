// Meridian — deterministic half-life decay for RecoverySignal (§4–§5).
//
// Pure functions only. `now` is always passed in — never Date.now() here.

import type { RampDefinition, RecoverySignal, SignalStatus } from "./types";

const MS_PER_DAY = 86_400_000;

/** ISO-8601 UTC with optional fractional seconds and Z or offset. */
const ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Decay multiplier at or below which a signal is classified stale (§4). */
const STALE_MULTIPLIER_THRESHOLD = 0.01;

/**
 * Parse an ISO-8601 observation instant to epoch milliseconds.
 *
 * @returns ms since epoch, or `null` when the string is missing or invalid.
 *
 * @example
 * parseObservedAt("2024-06-01T12:00:00Z") // 1717243200000
 * parseObservedAt("not-a-date") // null
 */
export function parseObservedAt(observedAt: string): number | null {
  if (!ISO_8601_RE.test(observedAt)) return null;
  const ms = Date.parse(observedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whole-day age of an observation relative to `nowIso` (UTC ms math).
 *
 * @returns fractional days ≥ 0, or `null` when either instant is invalid.
 *
 * @example
 * daysSinceObserved(
 *   parseObservedAt("2024-01-01T00:00:00Z"),
 *   "2024-01-11T00:00:00Z",
 * ) // 10
 */
export function daysSinceObserved(
  observedAtMs: number | null,
  nowIso: string,
): number | null {
  if (observedAtMs === null) return null;
  const nowMs = parseObservedAt(nowIso);
  if (nowMs === null) return null;
  const days = (nowMs - observedAtMs) / MS_PER_DAY;
  return days < 0 ? 0 : days;
}

/**
 * Exponential half-life multiplier: `0.5 ^ (daysSince / halfLifeDays)` (§4).
 *
 * @returns factor in [0, 1]; `0` when inputs are invalid or observation is future-dated.
 *
 * @example
 * calculateDecayMultiplier(90, 90) // 0.5 — one half-life elapsed
 * calculateDecayMultiplier(-1, 90) // 0 — future observation
 */
export function calculateDecayMultiplier(
  daysSince: number | null,
  halfLifeDays: number,
): number {
  if (daysSince === null || !Number.isFinite(daysSince)) return 0;
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) return 0;
  if (daysSince < 0) return 0;
  return 0.5 ** (daysSince / halfLifeDays);
}

/**
 * Config weight scaled by a decay multiplier, bounded 0–100.
 */
export function calculateDecayedWeight(weight: number, multiplier: number): number {
  const normalized = normalizeSignalWeight(weight);
  if (normalized <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return clampScore(normalized * multiplier);
}

/**
 * Classify pipeline freshness for a signal at evaluation time.
 *
 * BANNED and invalid or future-dated observations are `excluded` / unusable.
 * WEAK confidence never upgrades to active. Stale observations may still score
 * at reduced contribution via decay.
 */
export function classifySignalFreshness(
  signal: RecoverySignal,
  nowIso: string,
): SignalStatus {
  if (signal.sourceTier === "BANNED" || signal.status === "banned") {
    return "banned";
  }

  const observedMs = parseObservedAt(signal.observedAt);
  const nowMs = parseObservedAt(nowIso);
  if (observedMs === null || nowMs === null) return "excluded";
  if (observedMs > nowMs) return "excluded";
  if (signal.status === "excluded") return "excluded";

  if (signal.confidence === "WEAK" || signal.status === "weak") {
    return "weak";
  }

  if (signal.status === "stale") return "stale";

  const days = daysSinceObserved(observedMs, nowIso);
  const multiplier = calculateDecayMultiplier(days, signal.halfLifeDays);
  if (multiplier > 0 && multiplier <= STALE_MULTIPLIER_THRESHOLD) {
    return "stale";
  }

  return "active";
}

/**
 * Clamp a workspace-config weight to [0, 100]. Non-finite values become 0.
 */
export function normalizeSignalWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0;
  return clampScore(weight);
}

/**
 * Clamp a score or weight to [0, 100]. Non-finite values become 0.
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score));
}

/**
 * Whether a signal may enter the scoring sum at `nowIso`.
 *
 * Banned and excluded signals are dropped. Stale and weak signals remain
 * eligible at reduced or background contribution — decay handles magnitude.
 */
export function isSignalUsableForScoring(signal: RecoverySignal, nowIso: string): boolean {
  const freshness = classifySignalFreshness(signal, nowIso);
  if (freshness === "banned" || freshness === "excluded") return false;
  if (!Number.isFinite(signal.halfLifeDays) || signal.halfLifeDays <= 0) return false;
  if (normalizeSignalWeight(signal.weight) <= 0) return false;
  return true;
}

/**
 * Decayed contribution for one signal (§4).
 *
 * Pure half-life decay: `weight × 0.5 ^ ((now - observedAt) / halfLifeDays)`.
 * Returns `0` when `weight ≤ 0`, `halfLifeDays ≤ 0`, `observedAt > now`, or
 * either timestamp is invalid.
 *
 * @example
 * decay(100, "2024-01-01T00:00:00Z", 90, "2024-04-01T00:00:00Z")
 * // 100 * 0.5^(90/90) === 50
 *
 * @example
 * decay(50, "2025-01-01T00:00:00Z", 30, "2024-01-01T00:00:00Z") // 0 — future
 */
export function decay(
  weight: number,
  observedAt: string,
  halfLifeDays: number,
  now: string,
): number {
  if (weight <= 0 || halfLifeDays <= 0) return 0;

  const observedMs = parseObservedAt(observedAt);
  const nowMs = parseObservedAt(now);
  if (observedMs === null || nowMs === null) return 0;
  if (observedMs > nowMs) return 0;

  const days = daysSinceObserved(observedMs, now);
  const multiplier = calculateDecayMultiplier(days, halfLifeDays);
  return calculateDecayedWeight(weight, multiplier);
}

/**
 * Inverse-time ramp factor for §5 signals (value grows as time passes).
 *
 * @returns factor in [0, 1] per the declared ramp; `0` when timestamps are invalid
 * or the observation is future-dated relative to `now`.
 *
 * @example
 * const ramp = { kind: "linear", startDays: 180, endDays: 365, startFactor: 0, endFactor: 1 };
 * inverseTimeRamp("2023-01-01T00:00:00Z", ramp, "2023-07-01T00:00:00Z") // ~0.33 linear
 */
export function inverseTimeRamp(
  observedAt: string,
  ramp: RampDefinition,
  now: string,
): number {
  const observedMs = parseObservedAt(observedAt);
  const nowMs = parseObservedAt(now);
  if (observedMs === null || nowMs === null) return 0;
  if (observedMs > nowMs) return 0;

  const days = daysSinceObserved(observedMs, now) ?? 0;
  const { kind, startDays, endDays, startFactor, endFactor } = ramp;

  if (!Number.isFinite(startDays) || !Number.isFinite(endDays) || endDays <= startDays) {
    return 0;
  }

  if (days <= startDays) return clampRampFactor(startFactor);
  if (days >= endDays) return clampRampFactor(endFactor);

  if (kind === "step") {
    return clampRampFactor(startFactor);
  }

  const span = endDays - startDays;
  const t = (days - startDays) / span;
  return clampRampFactor(startFactor + t * (endFactor - startFactor));
}

function clampRampFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 0;
  return Math.min(1, Math.max(0, factor));
}
