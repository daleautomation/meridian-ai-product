// Meridian AI — import_companies tool.
//
// Wide-funnel ingestion. Accepts either a JSON array of raw company
// records OR raw CSV text (reusing lib/ingestion/csvParser so there's no
// parallel parser). De-dupes on write via rawCompaniesStore key logic.
//
// This is the operator's path for feeding 150–400 companies into the
// engine immediately without waiting on live scrapers.

import type { ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { parseCsv } from "@/lib/ingestion/csvParser";
import { upsertRaw, type RawCompany } from "@/lib/state/rawCompaniesStore";

export type ImportCompaniesInput = {
  source: string;                                // e.g. "manual_csv" | "google_places_export"
  sourceUrl?: string;
  companies?: Array<Partial<RawCompany>>;        // JSON shape
  csv?: string;                                  // CSV text (headers: name, city, state, zip, website, phone, category)
};

export type ImportCompaniesData = {
  received: number;
  inserted: number;
  duplicates: number;
  total: number;
  dropped: Array<{ row: number; reason: string }>;
};

function coerce(input: Partial<RawCompany>, source: string, sourceUrl?: string): Omit<RawCompany, "key"> | null {
  const name = (input.name ?? "").trim();
  if (!name) return null;
  return {
    name,
    city: input.city?.trim() || undefined,
    state: input.state?.trim() || undefined,
    zip: input.zip?.trim() || undefined,
    website: input.website?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    category: input.category?.trim() || undefined,
    source,
    sourceUrl: input.sourceUrl ?? sourceUrl,
    collectedAt: input.collectedAt ?? nowIso(),
  };
}

async function handler(input: ImportCompaniesInput): Promise<ToolResult<ImportCompaniesData>> {
  const timestamp = nowIso();

  if (!input.source?.trim()) {
    return {
      tool: "import_companies",
      company: { name: "*" },
      timestamp,
      confidence: 0,
      confidenceLabel: "LOW",
      evidence: [],
      data: { received: 0, inserted: 0, duplicates: 0, total: 0, dropped: [] },
      stub: false,
      error: "missing_source",
    };
  }

  const rawRecords: Array<Partial<RawCompany>> = [];
  const dropped: Array<{ row: number; reason: string }> = [];

  if (Array.isArray(input.companies)) {
    input.companies.forEach((c, i) => {
      if (!c || typeof c !== "object") {
        dropped.push({ row: i, reason: "not_an_object" });
        return;
      }
      rawRecords.push(c);
    });
  }

  if (typeof input.csv === "string" && input.csv.trim()) {
    const rows = parseCsv(input.csv);
    rows.forEach((r, i) => {
      // Headers are lowercased by convention from the parser? No — parseCsv
      // preserves casing. Normalize access with a lookup helper.
      const get = (k: string) =>
        r[k] ?? r[k.toLowerCase()] ?? r[k.toUpperCase()] ?? "";
      const rec: Partial<RawCompany> = {
        name: get("name"),
        city: get("city"),
        state: get("state"),
        zip: get("zip"),
        website: get("website"),
        phone: get("phone"),
        category: get("category"),
      };
      if (!rec.name) {
        dropped.push({ row: i, reason: "missing_name" });
        return;
      }
      rawRecords.push(rec);
    });
  }

  if (rawRecords.length === 0) {
    return {
      tool: "import_companies",
      company: { name: "*" },
      timestamp,
      confidence: 20,
      confidenceLabel: "LOW",
      evidence: [],
      data: { received: 0, inserted: 0, duplicates: 0, total: 0, dropped },
      stub: false,
      error: dropped.length > 0 ? "all_rows_dropped" : "no_records_supplied",
    };
  }

  const coerced: Array<Omit<RawCompany, "key">> = [];
  rawRecords.forEach((r, i) => {
    const c = coerce(r, input.source.trim(), input.sourceUrl);
    if (!c) {
      dropped.push({ row: i, reason: "missing_name_after_coerce" });
      return;
    }
    coerced.push(c);
  });

  const result = await upsertRaw(coerced);

  return {
    tool: "import_companies",
    company: { name: "*" },
    timestamp,
    confidence: 95,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "persistence_write",
        source: "data/rawCompanies.json",
        observedAt: timestamp,
        detail: `received=${rawRecords.length} inserted=${result.inserted} duplicates=${result.duplicates} dropped=${dropped.length} total=${result.total}`,
      },
    ],
    data: {
      received: rawRecords.length,
      inserted: result.inserted,
      duplicates: result.duplicates,
      total: result.total,
      dropped,
    },
    stub: false,
    notes: [
      "CSV headers supported: name, city, state, zip, website, phone, category (case-insensitive).",
      'Next step: call prefilter_companies, then batch_inspect.',
    ],
  };
}

export const importCompaniesTool: ToolDefinition<ImportCompaniesInput, ImportCompaniesData> = {
  name: "import_companies",
  description:
    "Wide-funnel ingestion. Accepts either a JSON array of raw company records or CSV text. De-dupes on write. Persists to data/rawCompanies.json.",
  inputSchema: {
    type: "object",
    properties: {
      source: { type: "string", description: "Source label (e.g. manual_csv, google_places_export)" },
      sourceUrl: { type: "string", description: "Optional URL of the source" },
      companies: { type: "array", description: "JSON array of Partial<RawCompany> records" },
      csv: { type: "string", description: "CSV text with headers: name,city,state,zip,website,phone,category" },
    },
    required: ["source"],
    additionalProperties: false,
  },
  handler,
};
