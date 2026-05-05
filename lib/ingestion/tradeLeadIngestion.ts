// Meridian AI — Trade Lead Ingestion (scaffolding).
//
// Pure adapter layer. Defines the shape of trade-specific search inputs
// + the canonical TradeLeadRecord shape every source must normalize to.
// Does NOT call APIs. Real ingestion happens in a future server route
// (see TODO at bottom). Every function here is deterministic and safe
// to call client- or server-side.

import type { TradeId } from "../modules/tradeConfigs";

export type TradeLeadSource =
  | "google_places"
  | "serpapi"
  | "apollo"
  | "clearbit"
  | "builtwith"
  | "manual_csv";

export interface TradeLeadSourceInput {
  tradeId: TradeId;
  market: "kansas_city";
  source: TradeLeadSource;
  /** Free-form query strings the source operator should run. */
  queries: string[];
  /** Hint for downstream callers — never an actual key value. */
  envVar?: string;
}

export interface TradeLeadRecord {
  id: string;
  name: string;
  tradeId: TradeId;
  source: TradeLeadSource;
  market: "kansas_city";
  website?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  address?: string;
  /** Originating search query (e.g. "emergency HVAC Kansas City"). */
  sourceQuery?: string;
  /** Place types from the source (e.g. Google Places `types`). */
  sourceTypes?: string[];
  /** Free-form tokens combined for downstream classifiers. */
  rawSignals?: string[];
  /** ISO timestamp; ingestion path is responsible for setting this. */
  createdAt: string;
}

// ── Search-query catalog per trade ─────────────────────────────────────

const QUERIES_BY_TRADE: Record<TradeId, string[]> = {
  roofing: [
    "roofing companies Kansas City",
    "roof repair Kansas City",
    "commercial roofing Kansas City",
    "storm damage roofing Kansas City",
  ],
  hvac: [
    "HVAC Kansas City",
    "HVAC contractors Kansas City",
    "emergency HVAC Kansas City",
    "furnace repair Kansas City",
    "AC repair Kansas City",
    "air conditioning repair Kansas City",
    "commercial HVAC Kansas City",
    "heating and cooling Kansas City",
  ],
  carpentry: [
    "carpentry contractors Kansas City",
    "finish carpentry Kansas City",
    "custom carpentry Kansas City",
    "trim carpenter Kansas City",
  ],
  painting: [
    "painting contractors Kansas City",
    "house painters Kansas City",
    "exterior painting Kansas City",
    "cabinet painting Kansas City",
    "commercial painting Kansas City",
  ],
  plumbing: [
    "plumbing companies Kansas City",
    "emergency plumber Kansas City",
    "drain cleaning Kansas City",
    "water heater install Kansas City",
  ],
  electrical: [
    "electricians Kansas City",
    "electrical contractors Kansas City",
    "emergency electrician Kansas City",
    "panel upgrade Kansas City",
    "EV charger installation Kansas City",
    "commercial electrical Kansas City",
  ],
};

export function buildTradeSearchQueries(
  tradeId: TradeId,
  market: "kansas_city" = "kansas_city",
): TradeLeadSourceInput[] {
  const queries = QUERIES_BY_TRADE[tradeId] ?? [];
  if (queries.length === 0) return [];
  // One descriptor per source — caller picks which sources are wired up.
  // Env-var hints are advisory only; never values.
  return [
    {
      tradeId, market,
      source: "google_places",
      queries,
      envVar: "GOOGLE_PLACES_API_KEY",
    },
    {
      tradeId, market,
      source: "serpapi",
      queries,
      envVar: "SERPAPI_API_KEY",
    },
  ];
}

// ── Normalizer ─────────────────────────────────────────────────────────
// Accepts a raw object (Google Places place result, Apollo company,
// Clearbit, CSV row, etc.) and emits a canonical TradeLeadRecord.

interface RawShape {
  id?: unknown;
  place_id?: unknown;
  name?: unknown;
  business_name?: unknown;
  website?: unknown;
  domain?: unknown;
  phone?: unknown;
  formatted_phone_number?: unknown;
  rating?: unknown;
  user_ratings_total?: unknown;
  reviewCount?: unknown;
  formatted_address?: unknown;
  address?: unknown;
  sourceQuery?: unknown;
  sourceTypes?: unknown;
  rawSignals?: unknown;
  types?: unknown;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function pickNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string") {
      const n = parseFloat(c);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

export function normalizeTradeLead(
  raw: RawShape | null | undefined,
  tradeId: TradeId,
  source: TradeLeadSource,
): TradeLeadRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const name = pickString(raw.business_name, raw.name);
  if (!name) return null;
  const idSeed = pickString(raw.id, raw.place_id) ?? `${source}:${name}`;
  const sourceTypes = Array.isArray(raw.sourceTypes)
    ? (raw.sourceTypes as unknown[]).filter((s): s is string => typeof s === "string")
    : Array.isArray(raw.types)
      ? (raw.types as unknown[]).filter((s): s is string => typeof s === "string")
      : undefined;
  const rawSignals = Array.isArray(raw.rawSignals)
    ? (raw.rawSignals as unknown[]).filter((s): s is string => typeof s === "string")
    : undefined;
  return {
    id: `${source}:${idSeed}`,
    name,
    tradeId,
    source,
    market: "kansas_city",
    website: pickString(raw.website, raw.domain),
    phone: pickString(raw.formatted_phone_number, raw.phone),
    rating: pickNumber(raw.rating),
    reviewCount: pickNumber(raw.user_ratings_total, raw.reviewCount),
    address: pickString(raw.formatted_address, raw.address),
    sourceQuery: pickString(raw.sourceQuery),
    ...(sourceTypes && sourceTypes.length > 0 ? { sourceTypes } : {}),
    ...(rawSignals && rawSignals.length > 0 ? { rawSignals } : {}),
    createdAt: new Date().toISOString(),
  };
}

// ── Validator ──────────────────────────────────────────────────────────

export function validateTradeLeadRecord(
  record: TradeLeadRecord | null | undefined,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!record) {
    return { ok: false, reasons: ["record is null"] };
  }
  if (typeof record.id !== "string" || record.id.length === 0) reasons.push("missing id");
  if (typeof record.name !== "string" || record.name.length === 0) reasons.push("missing name");
  if (!record.tradeId) reasons.push("missing tradeId");
  if (record.market !== "kansas_city") reasons.push("non-KC market");
  if (typeof record.createdAt !== "string") reasons.push("missing createdAt");
  return { ok: reasons.length === 0, reasons };
}

// TODO: POST /api/ingestion/trade-leads — when a server-side ingestion
// route is added, accept TradeLeadSourceInput[], call the matching
// API (env-var-gated), normalize each result via normalizeTradeLead,
// validate via validateTradeLeadRecord, and persist with tradeId
// stamped so filterLeadsForTrade routes them automatically.
