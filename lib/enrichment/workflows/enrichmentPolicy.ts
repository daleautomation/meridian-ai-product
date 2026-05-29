// Meridian — Brookside targeted-enrichment policy + ledger types.
//
// The policy is the single source of truth for "which brief cards are
// eligible to be enriched in this run". Every skip decision the queue
// emits cites one of the canonical `EnrichmentSkipReason` codes. No
// fuzzy logic lives here.

const DEFAULT_CAP = 25;
const DEFAULT_RECENCY_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Tunable knobs the runner script may override via CLI. */
export interface EnrichmentPolicy {
  /** Maximum number of contacts to enrich per run. */
  cap: number;
  /** A leadKey enriched within this window is skipped to avoid churn. */
  recencyWindowDays: number;
  /** When false, MED address-only matches are downgraded to a skip. */
  allowAddressOnlyMatch: boolean;
  /** When true (default), an undeliverable / partial address is skipped. */
  requireStrongAddress: boolean;
}

export const DEFAULT_POLICY: EnrichmentPolicy = Object.freeze({
  cap: DEFAULT_CAP,
  recencyWindowDays: DEFAULT_RECENCY_WINDOW_DAYS,
  allowAddressOnlyMatch: true,
  requireStrongAddress: true,
});

/** Canonical skip reasons. Every audit entry maps to exactly one of these. */
export type EnrichmentSkipReason =
  | "no_property_key"
  | "weak_address"
  | "duplicate_property_key"
  | "already_enriched_recent"
  | "outside_cap"
  | "no_match"
  | "no_actionable_facts";

/** Every code admitted to skip the audit summary. Used by the audit roll-up. */
export const ENRICHMENT_SKIP_REASONS: readonly EnrichmentSkipReason[] = [
  "no_property_key",
  "weak_address",
  "duplicate_property_key",
  "already_enriched_recent",
  "outside_cap",
  "no_match",
  "no_actionable_facts",
] as const;

// ── Ledger ─────────────────────────────────────────────────────────

/** Persisted record of a previously-enriched contact. */
export interface LedgerEntry {
  leadKey: string;
  enrichedAt: string;
  signalCount: number;
}

/** On-disk shape for `data/enrichment/<customer>/ledger.json`. */
export interface EnrichmentLedgerFile {
  customer: string;
  entries: LedgerEntry[];
}

/** In-memory ledger used by the queue. Stable map of leadKey → entry. */
export interface EnrichmentLedger {
  readonly entriesByLeadKey: ReadonlyMap<string, LedgerEntry>;
}

export function emptyLedger(): EnrichmentLedger {
  return { entriesByLeadKey: new Map() };
}

export function ledgerFromFile(file: EnrichmentLedgerFile): EnrichmentLedger {
  const map = new Map<string, LedgerEntry>();
  for (const entry of file.entries) {
    if (!entry || typeof entry.leadKey !== "string") continue;
    if (typeof entry.enrichedAt !== "string") continue;
    map.set(entry.leadKey, {
      leadKey: entry.leadKey,
      enrichedAt: entry.enrichedAt,
      signalCount: Number.isFinite(entry.signalCount) ? entry.signalCount : 0,
    });
  }
  return { entriesByLeadKey: map };
}

/** Serialize deterministically — leadKeys sorted, entries stable. */
export function ledgerToFile(
  ledger: EnrichmentLedger,
  customer: string,
): EnrichmentLedgerFile {
  const sortedKeys = [...ledger.entriesByLeadKey.keys()].sort();
  const entries: LedgerEntry[] = sortedKeys.map((k) => {
    const e = ledger.entriesByLeadKey.get(k);
    if (!e) {
      // Defensive — should never happen for a key we just iterated from the map.
      return { leadKey: k, enrichedAt: "1970-01-01T00:00:00.000Z", signalCount: 0 };
    }
    return e;
  });
  return { customer, entries };
}

/** Return a new ledger with a leadKey's enriched-at updated. */
export function ledgerWithEnrichment(
  ledger: EnrichmentLedger,
  leadKey: string,
  enrichedAt: string,
  signalCount: number,
): EnrichmentLedger {
  const next = new Map(ledger.entriesByLeadKey);
  next.set(leadKey, { leadKey, enrichedAt, signalCount });
  return { entriesByLeadKey: next };
}

// ── Recency check ──────────────────────────────────────────────────

/**
 * True when `enrichedAt` is within `windowDays` of `nowIso`. Used to
 * suppress re-enrichment of the same contact across consecutive runs.
 */
export function isWithinRecencyWindow(
  enrichedAt: string,
  nowIso: string,
  windowDays: number,
): boolean {
  const enriched = Date.parse(enrichedAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(enriched) || !Number.isFinite(now)) return false;
  if (windowDays <= 0) return false;
  return now - enriched < windowDays * MS_PER_DAY;
}

// ── Policy validation ──────────────────────────────────────────────

/** Normalize / clamp a user-supplied policy. Pure. */
export function normalizePolicy(input: Partial<EnrichmentPolicy>): EnrichmentPolicy {
  const cap = Number.isFinite(input.cap)
    ? Math.max(0, Math.floor(input.cap as number))
    : DEFAULT_POLICY.cap;
  const recency = Number.isFinite(input.recencyWindowDays)
    ? Math.max(0, Math.floor(input.recencyWindowDays as number))
    : DEFAULT_POLICY.recencyWindowDays;
  return {
    cap,
    recencyWindowDays: recency,
    allowAddressOnlyMatch:
      typeof input.allowAddressOnlyMatch === "boolean"
        ? input.allowAddressOnlyMatch
        : DEFAULT_POLICY.allowAddressOnlyMatch,
    requireStrongAddress:
      typeof input.requireStrongAddress === "boolean"
        ? input.requireStrongAddress
        : DEFAULT_POLICY.requireStrongAddress,
  };
}
