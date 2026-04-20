// Meridian AI — MCP tool layer shared types.
//
// Every MCP tool returns a ToolResult<T> envelope so the decision engine,
// persistence layer, and UI can consume tool output uniformly. The envelope
// carries evidence, confidence, and timestamps — no black-box outputs.
//
// These types are intentionally transport-agnostic. Phase 1 exposes them via
// a JSON-RPC-style HTTP endpoint (/api/mcp). A future phase can swap in the
// official @modelcontextprotocol/sdk without changing tool signatures.

export type CompanyRef = {
  name: string;
  domain?: string;       // normalized hostname, e.g. "acme.com"
  url?: string;          // original URL as provided
  location?: string;     // free-form "City, ST" — used for disambiguation
  placeId?: string;      // Google Place ID when known
};

export type Evidence = {
  kind: string;          // "http_status" | "html_meta" | "review_count" | ...
  source: string;        // "https://acme.com" | "google_places" | "stub"
  observedAt: string;    // ISO — per-observation freshness
  detail: string;        // human-readable fragment
};

export type ConfidenceLabel = "HIGH" | "MEDIUM" | "LOW";

export type ToolResult<T> = {
  tool: string;
  company: CompanyRef;
  timestamp: string;           // ISO — when the tool ran
  confidence: number;          // 0–100
  confidenceLabel: ConfidenceLabel;
  evidence: Evidence[];
  data: T;
  stub: boolean;               // true when MVP placeholder (no live data source)
  notes?: string[];
  error?: string;              // non-empty means the tool ran but observed failure
};

// ── Tool definition contract ────────────────────────────────────────────

// Minimal JSON Schema shape — avoids adding a `json-schema` dependency.
// Matches the subset of MCP's inputSchema that clients actually read.
export type ToolInputSchema = {
  type: "object";
  properties: Record<string, {
    type: "string" | "number" | "boolean" | "object" | "array";
    description?: string;
    enum?: readonly string[];
  }>;
  required?: string[];
  additionalProperties?: boolean;
};

export type ToolDefinition<I, O> = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: (input: I) => Promise<ToolResult<O>>;
};

// ── Helpers ─────────────────────────────────────────────────────────────

export function labelFromConfidence(score: number): ConfidenceLabel {
  if (score >= 75) return "HIGH";
  if (score >= 50) return "MEDIUM";
  return "LOW";
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeDomain(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export function companyKey(c: CompanyRef): string {
  const d = normalizeDomain(c.domain ?? c.url);
  if (d) return `domain:${d}`;
  return `name:${c.name.trim().toLowerCase()}`;
}
