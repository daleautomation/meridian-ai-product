// Meridian AI — Intelligence Scope.
//
// Pure tenant-aware addressing layer. No I/O, no persistence — only
// normalization and key formatting. Every other learning module reads a
// scope from here so memory, pattern learning, and future server-backed
// stores all share the same identity contract.
//
// Single-user mode is preserved: every missing field resolves to a
// stable fallback string so a logged-out / no-session caller still gets
// a deterministic, scoped key without any special-casing.

export interface IntelligenceScope {
  userId?: string;
  tenantId?: string;
  clientId?: string;
  moduleId?: string;
  marketId?: string;
  tradeId?: string;
  nicheId?: string;
}

export type IntelligenceScopeKey = string;

export const SCOPE_FALLBACKS = {
  userId:   "local-user",
  tenantId: "local-tenant",
  clientId: "local-client",
  moduleId: "default-module",
  marketId: "default-market",
  tradeId:  "default-trade",
  nicheId:  "default-niche",
} as const;

const BASE_MEMORY_KEY = "meridian.calendar.outcomeEvents.v1";

function pickString(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  const t = v.trim();
  return t.length > 0 ? t : fallback;
}

export function normalizeScope(scope?: IntelligenceScope | null): Required<IntelligenceScope> {
  const s = scope ?? {};
  return {
    userId:   pickString(s.userId,   SCOPE_FALLBACKS.userId),
    tenantId: pickString(s.tenantId, SCOPE_FALLBACKS.tenantId),
    clientId: pickString(s.clientId, SCOPE_FALLBACKS.clientId),
    moduleId: pickString(s.moduleId, SCOPE_FALLBACKS.moduleId),
    marketId: pickString(s.marketId, SCOPE_FALLBACKS.marketId),
    tradeId:  pickString(s.tradeId,  SCOPE_FALLBACKS.tradeId),
    nicheId:  pickString(s.nicheId,  SCOPE_FALLBACKS.nicheId),
  };
}

export function scopeKey(scope?: IntelligenceScope | null): IntelligenceScopeKey {
  const n = normalizeScope(scope);
  return `tenant:${n.tenantId}|client:${n.clientId}|module:${n.moduleId}|market:${n.marketId}|trade:${n.tradeId}|niche:${n.nicheId}|user:${n.userId}`;
}

export function scopedOutcomeMemoryKey(scope?: IntelligenceScope | null): string {
  return `${BASE_MEMORY_KEY}::${scopeKey(scope)}`;
}

export function sameScope(
  a?: IntelligenceScope | null,
  b?: IntelligenceScope | null,
): boolean {
  return scopeKey(a) === scopeKey(b);
}

export const LEGACY_OUTCOME_MEMORY_KEY = BASE_MEMORY_KEY;
