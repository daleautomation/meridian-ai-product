import assert from "node:assert/strict";
import { parseHunterApiKey } from "../lib/integrations/hunterConfig";
import {
  _clearHunterCache,
  applyHunterResultToLead,
  findEmailForLead,
} from "../lib/integrations/hunter";
import { normalizeLead } from "../lib/leads/normalizedLead";

const originalEnv = process.env.HUNTER_API_KEY;
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

type FetchCall = { url: string };

function mockHunterFetch(calls: FetchCall[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          domain: "example-roofing.com",
          organization: "Example Roofing",
          emails: [{
            value: "owner@example-roofing.com",
            type: "personal",
            confidence: 92,
            first_name: "Riley",
            last_name: "Owner",
            position: "Owner",
          }],
        },
      }),
    } as Response;
  }) as typeof fetch;
}

async function main() {
  const warnings: string[] = [];
  console.warn = ((message?: unknown) => {
    warnings.push(String(message));
  }) as typeof console.warn;

  try {
    assert.deepEqual(parseHunterApiKey("hunter_raw_123-abc"), {
      status: "configured",
      key: "hunter_raw_123-abc",
    });
    assert.equal(
      parseHunterApiKey("https://api.hunter.io/v2/domain-search?domain=x.com&api_key=secret").status,
      "malformed",
    );

    const calls: FetchCall[] = [];
    mockHunterFetch(calls);
    process.env.HUNTER_API_KEY = "hunter_raw_123-abc";
    _clearHunterCache();

    const lead = {
      id: "lead-1",
      workspaceSlug: "labortech",
      moduleId: "roofing" as const,
      companyName: "Example Roofing",
      website: "https://www.example-roofing.com/contact",
      source: "manual" as const,
      sourceStatus: "available" as const,
      signals: { hasWebsite: true },
      crm: {},
      evidence: [],
    };

    const result = await findEmailForLead(lead);
    assert.equal(result?.email, "owner@example-roofing.com");
    assert.equal(result?.confidence, "high");
    assert.equal(result?.rawScore, 92);
    assert.equal(result?.contactName, "Riley Owner");
    assert.equal(result?.contactPosition, "Owner");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/api\.hunter\.io\/v2\/domain-search\?/);

    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.searchParams.get("domain"), "example-roofing.com");
    assert.equal(requestUrl.searchParams.get("api_key"), "hunter_raw_123-abc");

    const wrote = applyHunterResultToLead(lead, result);
    assert.equal(wrote, true);
    const normalized = normalizeLead(lead as unknown as Record<string, unknown>, { workspaceSlug: "labortech", moduleId: "roofing" });
    assert.equal(normalized.verifiedEmail, "owner@example-roofing.com");
    assert.equal(normalized.emailSource, "hunter");
    assert.equal(normalized.emailConfidence, "high");
    assert.equal(normalized.emailStatus, "verified");
    assert.match(normalized.emailVerifiedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

    const malformedCalls: FetchCall[] = [];
    mockHunterFetch(malformedCalls);
    process.env.HUNTER_API_KEY = "https://api.hunter.io/v2/domain-search?api_key=not-a-raw-key";
    _clearHunterCache();
    const malformedResult = await findEmailForLead({
      ...lead,
      id: "lead-2",
      website: "https://www.no-fetch-roofing.com",
      verifiedEmail: undefined,
      emailConfidence: undefined,
      emailSource: undefined,
      emailStatus: undefined,
      emailVerifiedAt: undefined,
    });
    assert.equal(malformedResult, null);
    assert.equal(malformedCalls.length, 0);
    assert.equal(warnings.some((w) => w.includes("[hunter-config] HUNTER_API_KEY ignored")), true);
    assert.equal(warnings.some((w) => w.includes("not-a-raw-key")), false);

    console.log("✓ Hunter raw-key parsing rejects URL-style env values");
    console.log("✓ Hunter Domain Search request uses domain + raw api_key query params");
    console.log("✓ Hunter enrichment returns verified email with confidence and contact metadata");
    console.log("✓ Hunter metadata survives lead normalization");
    console.log("✓ Malformed Hunter config fails gracefully without fetch or secret logging");
  } finally {
    if (typeof originalEnv === "string") process.env.HUNTER_API_KEY = originalEnv;
    else delete process.env.HUNTER_API_KEY;
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    _clearHunterCache();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
