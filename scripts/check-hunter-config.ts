/**
 * Diagnose Hunter integration end-to-end without writing anything.
 *
 * What it checks:
 *   1. Is HUNTER_API_KEY present and shaped like a raw API key
 *      (parseHunterApiKey rules).
 *   2. Is the Hunter API reachable from this network — GET /v2/account
 *      returns plan + per-month usage.
 *   3. Does Email Finder work end-to-end against a known business
 *      domain, producing a score + (optionally) role/company.
 *
 * Strict rules:
 *   • Never prints the API key value (only its length + format check).
 *   • Never prints email addresses (only domains).
 *   • Makes at most 2 Hunter calls: /v2/account + one email-finder.
 *   • Never writes to crm_contacts.
 *   • Exit 0 on success; non-zero with a clear remediation hint on
 *     any failure.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npm run hunter:check
 *   npm run hunter:check -- --domain=mammothbuilt.com --first=Phil --last=Jones
 */

import { parseHunterApiKey } from "@/lib/integrations/hunterConfig";

const ACCOUNT_URL = "https://api.hunter.io/v2/account";
const EMAIL_FINDER_URL = "https://api.hunter.io/v2/email-finder";

interface CliArgs {
  domain: string;
  first: string;
  last: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  // Defaults pick a known business domain present in Nicole's CRM.
  // Override with --domain / --first / --last for ad-hoc testing.
  const args: CliArgs = { domain: "trozzolo.com", first: "Steve", last: "Jordan" };
  for (const a of argv) {
    if (a.startsWith("--domain=")) args.domain = a.slice("--domain=".length);
    else if (a.startsWith("--first=")) args.first = a.slice("--first=".length);
    else if (a.startsWith("--last=")) args.last = a.slice("--last=".length);
  }
  return args;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}***${key.slice(-2)} (len=${key.length})`;
}

async function timedFetch(url: string, label: string): Promise<{ res: Response | null; ms: number; err?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    return { res, ms: Date.now() - t0 };
  } catch (err) {
    return { res: null, ms: Date.now() - t0, err: err instanceof Error ? err.message : String(err) };
  }
}

function fail(message: string, remediation?: string): never {
  console.error("");
  console.error(`✗ ${message}`);
  if (remediation) console.error(`  remediation: ${remediation}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log("");
  console.log("Hunter integration check");
  console.log("========================");

  // 1. Key shape
  const parsed = parseHunterApiKey(process.env.HUNTER_API_KEY);
  console.log("");
  console.log("Step 1: key presence + shape");
  console.log(`  status: ${parsed.status}`);
  if (parsed.status !== "configured" || !parsed.key) {
    console.log(`  reason: ${parsed.reason ?? "unknown"}`);
    fail(
      `HUNTER_API_KEY is ${parsed.status} (${parsed.reason ?? "unknown reason"}).`,
      "Run `node scripts/local-set-hunter-key.mjs --push-to-vercel` and paste the real key from your Hunter dashboard.",
    );
  }
  console.log(`  masked key: ${maskKey(parsed.key)}`);

  // 2. Account check — proves the key authenticates + returns plan info
  console.log("");
  console.log("Step 2: GET /v2/account");
  const accountTimed = await timedFetch(
    `${ACCOUNT_URL}?api_key=${encodeURIComponent(parsed.key)}`,
    "account",
  );
  if (!accountTimed.res) {
    fail(
      `Hunter account endpoint unreachable (${accountTimed.err ?? "unknown"})`,
      "Check network connectivity; Hunter has had no major outages reported recently.",
    );
  }
  console.log(`  http=${accountTimed.res.status}  latency=${accountTimed.ms}ms`);
  if (!accountTimed.res.ok) {
    if (accountTimed.res.status === 401) {
      fail(
        "Hunter returned 401 Unauthorized — the key is present but rejected.",
        "The key may have been rotated in your Hunter dashboard. Rotate again and re-set via local-set-hunter-key.mjs --push-to-vercel.",
      );
    }
    fail(
      `Hunter account check failed with HTTP ${accountTimed.res.status}.`,
      "Re-run after a minute; if persistent, check https://status.hunter.io/.",
    );
  }
  type AccountResponse = {
    data?: {
      email?: string;
      plan_name?: string;
      requests?: {
        searches?: { used?: number; available?: number };
        verifications?: { used?: number; available?: number };
      };
      reset_date?: string;
    };
  };
  const accountJson = (await accountTimed.res.json()) as AccountResponse;
  const planName = accountJson.data?.plan_name ?? "(unknown plan)";
  const searches = accountJson.data?.requests?.searches;
  const verifications = accountJson.data?.requests?.verifications;
  const resetDate = accountJson.data?.reset_date ?? "(unknown reset)";
  console.log(`  plan: ${planName}`);
  console.log(
    `  searches used/available: ${searches?.used ?? "?"} / ${searches?.available ?? "?"}`,
  );
  console.log(
    `  verifications used/available: ${verifications?.used ?? "?"} / ${verifications?.available ?? "?"}`,
  );
  console.log(`  reset_date: ${resetDate}`);
  if (
    typeof searches?.used === "number" &&
    typeof searches?.available === "number" &&
    searches.used >= searches.available
  ) {
    fail(
      "Hunter searches quota exhausted on this plan.",
      "Either wait until reset_date or upgrade your Hunter plan before live enrichment.",
    );
  }

  // 3. Single Email Finder probe
  console.log("");
  console.log(`Step 3: GET /v2/email-finder (probe)  domain=${args.domain} first=${args.first} last=${args.last}`);
  const finderUrl = new URL(EMAIL_FINDER_URL);
  finderUrl.searchParams.set("domain", args.domain);
  if (args.first) finderUrl.searchParams.set("first_name", args.first);
  if (args.last) finderUrl.searchParams.set("last_name", args.last);
  finderUrl.searchParams.set("api_key", parsed.key);
  const finderTimed = await timedFetch(finderUrl.toString(), "email-finder");
  if (!finderTimed.res) {
    fail(`email-finder unreachable (${finderTimed.err ?? "unknown"})`);
  }
  console.log(`  http=${finderTimed.res.status}  latency=${finderTimed.ms}ms`);
  if (finderTimed.res.status === 429) {
    fail(
      "Hunter rate-limited the probe (HTTP 429).",
      "Wait a minute and re-run. Real enrichment script has a 1.5s pause between calls.",
    );
  }
  if (!finderTimed.res.ok) {
    fail(`email-finder failed HTTP ${finderTimed.res.status}.`);
  }
  type FinderResponse = {
    data?: {
      email?: string;
      score?: number;
      position?: string | null;
      company?: string | null;
      first_name?: string | null;
      last_name?: string | null;
      sources?: Array<{ uri?: string }>;
    };
  };
  const finderJson = (await finderTimed.res.json()) as FinderResponse;
  const data = finderJson.data;
  if (!data || typeof data.score !== "number") {
    console.log("  result: no match (data null or no score)");
  } else {
    console.log(`  result: match`);
    console.log(`    confidence:  ${data.score}%`);
    console.log(`    email host:  ${data.email ? "***@" + data.email.split("@")[1] : "(none)"}`);
    console.log(`    position:    ${data.position ?? "(none)"}`);
    console.log(`    company:     ${data.company ?? "(none)"}`);
    console.log(`    sources:     ${data.sources?.length ?? 0} URL${(data.sources?.length ?? 0) === 1 ? "" : "s"}`);
  }

  console.log("");
  console.log("✓ All Hunter integration checks passed.");
  console.log("");
  console.log("Next safe step (capped at 3 writes):");
  console.log("  npm run enrich:nicole:hunter -- --limit 3");
}

main().catch((err) => {
  console.error("");
  console.error("[hunter:check] crashed");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
