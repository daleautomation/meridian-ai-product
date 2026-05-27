/**
 * Nicole workspace — Hunter enrichment pass.
 *
 * Strict rules (constitution-aligned):
 *   • Dry-run by default. Pass --write to persist.
 *   • Only enriches contacts that already have an email on file.
 *   • Skips personal-domain emails (gmail / yahoo / hotmail / icloud /
 *     aol / outlook / msn / live / proton / pm). These are not the
 *     domains Hunter can usefully resolve a role at.
 *   • Skips contacts with an existing enrichment.hunter entry whose
 *     fetchedAt is within the last 90 days (freshness window).
 *   • Rate-limited: small sleep between calls so we don't spike
 *     Hunter quota and so Vercel doesn't get angry if this is ever
 *     re-deployed as a job.
 *   • Never logs the full email address. Only the domain.
 *   • Never overwrites name / tags / notes / lastInteractionAt.
 *     Writes only source_metadata.enrichment.hunter.
 *   • Records EVERY outcome — found, not_found, skipped, error — so
 *     a follow-up run can honour the 90-day window for negative
 *     results too.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/enrich-nicole-hunter.ts              # dry-run
 *   npx tsx scripts/enrich-nicole-hunter.ts --write      # persist
 *   npx tsx scripts/enrich-nicole-hunter.ts --limit 5    # cap calls
 */

import {
  applyContactEnrichmentNeon,
  listContactsNeon,
} from "@/lib/crm-import/crmContactsNeonAdapter";
import { filterOutInternalDiagnosticContacts } from "@/lib/crm-import/internalContactFilter";
import { getHunterApiKey } from "@/lib/integrations/hunterConfig";
import type {
  CrmContactRecord,
  HunterEnrichmentEntry,
} from "@/lib/crm-import/types";

const WORKSPACE = "nicole-lonergan";

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "outlook.com",
  "msn.com",
  "live.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "mac.com",
  "me.com",
]);

const FRESHNESS_WINDOW_DAYS = 90;
const FRESHNESS_WINDOW_MS = FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const RATE_LIMIT_DELAY_MS = 1500;
const EMAIL_FINDER_URL = "https://api.hunter.io/v2/email-finder";

interface CliArgs {
  write: boolean;
  limit: number | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let write = false;
  let limit: number | null = null;
  for (const arg of argv) {
    if (arg === "--write") write = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (arg === "--limit") {
      // Skip — handled by paired arg
    }
  }
  // Support `--limit 5` as well as `--limit=5`.
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") {
      const n = Number.parseInt(argv[i + 1] ?? "", 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { write, limit };
}

function emailDomain(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

function splitName(full: string): { first: string; last: string } | null {
  const parts = full
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * Hunter Email Finder requires either a full_name OR both first_name
 * AND last_name. A single-token CRM name will be rejected with
 * HTTP 400 / wrong_params. We refuse to call Hunter in that case so
 * the no-last-name population doesn't burn quota on guaranteed errors.
 */
function hasUsableNameForHunter(
  parts: { first: string; last: string } | null,
): parts is { first: string; last: string } {
  return !!parts && parts.first.trim().length > 0 && parts.last.trim().length > 0;
}

function isFreshHunterEnrichment(
  existing: HunterEnrichmentEntry | undefined,
  now: Date,
): boolean {
  if (!existing?.fetchedAt) return false;
  const t = Date.parse(existing.fetchedAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= FRESHNESS_WINDOW_MS;
}

interface HunterFinderResponse {
  data?: {
    email?: string;
    score?: number;
    first_name?: string | null;
    last_name?: string | null;
    position?: string | null;
    company?: string | null;
    domain?: string | null;
    sources?: Array<{ uri?: string }>;
  };
  errors?: Array<{ id?: string; code?: number; details?: string }>;
}

interface CallResult {
  status: HunterEnrichmentEntry["status"];
  reason?: string;
  confidence: number | null;
  company?: string;
  role?: string;
  sourceUrl?: string;
}

/**
 * Map a Hunter error response (or HTTP-level failure) to a canonical
 * reason string. The reason is stored on the row so audit tooling can
 * group failures meaningfully.
 *
 * Canonical reasons:
 *   auth_error          — 401, or `invalid_api_key`
 *   quota_exceeded      — 4xx with `usage_exceeded` / `plan_limit_reached`
 *   rate_limited        — 429 or `too_many_requests`
 *   wrong_params:<id>   — 400 with `wrong_params` and a detail message
 *   transient_error:<…> — 5xx, network errors, parse errors
 */
interface HunterErrorBodyShape {
  errors?: Array<{ id?: string; code?: number; details?: string }>;
}

function classifyHunterFailure(httpStatus: number, body: HunterErrorBodyShape | null): {
  status: "error";
  reason: string;
} {
  const id = body?.errors?.[0]?.id;
  const details = body?.errors?.[0]?.details;

  if (httpStatus === 401 || id === "invalid_api_key") {
    return { status: "error", reason: "auth_error" };
  }
  if (httpStatus === 429 || id === "too_many_requests") {
    return { status: "error", reason: "rate_limited" };
  }
  if (id === "usage_exceeded" || id === "plan_limit_reached" || id === "monthly_limit_reached") {
    return { status: "error", reason: "quota_exceeded" };
  }
  if (id === "wrong_params") {
    const tag = details ? `wrong_params:${details.slice(0, 80)}` : "wrong_params";
    return { status: "error", reason: tag };
  }
  if (httpStatus >= 500) {
    return { status: "error", reason: `transient_error:http_${httpStatus}` };
  }
  if (id) {
    return { status: "error", reason: `hunter_error:${id}` };
  }
  return { status: "error", reason: `http_${httpStatus}` };
}

async function callHunterEmailFinder(
  domain: string,
  name: { first: string; last: string },
  apiKey: string,
): Promise<CallResult> {
  const params = new URLSearchParams();
  params.set("domain", domain);
  params.set("first_name", name.first);
  params.set("last_name", name.last);
  params.set("api_key", apiKey);
  let res: Response;
  try {
    res = await fetch(`${EMAIL_FINDER_URL}?${params.toString()}`, { cache: "no-store" });
  } catch (err) {
    return {
      status: "error",
      reason: `transient_error:network_${err instanceof Error ? err.name : "unknown"}`,
      confidence: null,
    };
  }
  let bodyText: string;
  try {
    bodyText = await res.text();
  } catch {
    return { status: "error", reason: `transient_error:body_read_${res.status}`, confidence: null };
  }
  if (!res.ok) {
    let body: HunterErrorBodyShape | null = null;
    try {
      body = JSON.parse(bodyText) as HunterErrorBodyShape;
    } catch {
      // Body was not JSON. Classify on status alone.
    }
    return { ...classifyHunterFailure(res.status, body), confidence: null };
  }
  let json: HunterFinderResponse;
  try {
    json = JSON.parse(bodyText) as HunterFinderResponse;
  } catch {
    return { status: "error", reason: "transient_error:json_parse", confidence: null };
  }
  const data = json.data;
  if (!data || typeof data.score !== "number") {
    return { status: "not_found", confidence: null };
  }
  return {
    status: "found",
    confidence: data.score,
    company: data.company ?? undefined,
    role: data.position ?? undefined,
    sourceUrl: data.sources?.[0]?.uri,
  };
}

async function processContact(
  contact: CrmContactRecord,
  now: Date,
  write: boolean,
  apiKey: string,
): Promise<HunterEnrichmentEntry> {
  // Already-fresh result wins. Don't re-bill Hunter.
  const existing = contact.enrichment?.hunter;
  if (isFreshHunterEnrichment(existing, now)) {
    return existing as HunterEnrichmentEntry;
  }

  const email = (contact.email ?? contact.normalizedEmail ?? "").trim();
  if (!email) {
    return {
      source: "hunter",
      status: "skipped",
      reason: "no_email",
      fetchedAt: now.toISOString(),
      confidence: null,
    };
  }
  const domain = emailDomain(email);
  if (!domain) {
    return {
      source: "hunter",
      status: "skipped",
      reason: "malformed_email",
      fetchedAt: now.toISOString(),
      confidence: null,
    };
  }
  if (PERSONAL_DOMAINS.has(domain)) {
    return {
      source: "hunter",
      status: "skipped",
      reason: "personal_domain",
      fetchedAt: now.toISOString(),
      confidence: null,
    };
  }
  const name = splitName(contact.name);
  if (!name || !name.first) {
    return {
      source: "hunter",
      status: "skipped",
      reason: "no_name",
      fetchedAt: now.toISOString(),
      confidence: null,
    };
  }
  if (!name.last) {
    return {
      source: "hunter",
      status: "skipped",
      reason: "no_last_name",
      fetchedAt: now.toISOString(),
      confidence: null,
    };
  }

  if (!write) {
    // Dry-run: do not call Hunter at all. Report what *would* be called.
    return {
      source: "hunter",
      status: "skipped",
      reason: "dry_run",
      fetchedAt: now.toISOString(),
      confidence: null,
    };
  }

  const result = await callHunterEmailFinder(domain, name, apiKey);
  return {
    source: "hunter",
    status: result.status,
    reason: result.reason,
    fetchedAt: now.toISOString(),
    confidence: result.confidence,
    company: result.company,
    role: result.role,
    sourceUrl: result.sourceUrl,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface CallPlan {
  contact: CrmContactRecord;
  domain: string;
  decision:
    | "would_call"
    | "would_skip_fresh"
    | "would_skip_personal"
    | "would_skip_no_email"
    | "would_skip_no_name"
    | "would_skip_no_last_name";
}

function planForContact(contact: CrmContactRecord, now: Date): CallPlan {
  const email = (contact.email ?? contact.normalizedEmail ?? "").trim();
  if (!email) {
    return { contact, domain: "", decision: "would_skip_no_email" };
  }
  const domain = emailDomain(email) ?? "";
  if (!domain) return { contact, domain: "", decision: "would_skip_no_email" };
  if (PERSONAL_DOMAINS.has(domain)) {
    return { contact, domain, decision: "would_skip_personal" };
  }
  if (isFreshHunterEnrichment(contact.enrichment?.hunter, now)) {
    return { contact, domain, decision: "would_skip_fresh" };
  }
  const name = splitName(contact.name);
  if (!name || !name.first) {
    return { contact, domain, decision: "would_skip_no_name" };
  }
  if (!hasUsableNameForHunter(name)) {
    return { contact, domain, decision: "would_skip_no_last_name" };
  }
  return { contact, domain, decision: "would_call" };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const apiKey = args.write ? getHunterApiKey() : null;
  if (args.write && !apiKey) {
    console.error("[enrich:hunter] HUNTER_API_KEY missing or malformed — refusing to --write.");
    process.exit(1);
  }

  const all = await listContactsNeon(WORKSPACE);
  const visible = filterOutInternalDiagnosticContacts(all);

  console.log("");
  console.log("Hunter enrichment pass");
  console.log("======================");
  console.log(`workspace=${WORKSPACE} write=${args.write} limit=${args.limit ?? "unlimited"}`);
  console.log(`visible contacts=${visible.length}`);
  console.log("");

  // Build a plan first so we can show a clean dry-run summary.
  const plans = visible.map((c) => planForContact(c, now));
  const counts = plans.reduce<Record<string, number>>((acc, p) => {
    acc[p.decision] = (acc[p.decision] ?? 0) + 1;
    return acc;
  }, {});
  const wouldCall = plans.filter((p) => p.decision === "would_call");
  const callBudget = args.limit ? Math.min(args.limit, wouldCall.length) : wouldCall.length;

  console.log("Plan:");
  for (const decision of [
    "would_call",
    "would_skip_fresh",
    "would_skip_personal",
    "would_skip_no_email",
    "would_skip_no_name",
    "would_skip_no_last_name",
  ] as const) {
    console.log(`  ${decision.padEnd(28)} ${counts[decision] ?? 0}`);
  }
  console.log(`  -- of would_call, this run will execute up to ${callBudget}`);
  console.log("");

  if (!args.write) {
    console.log("Domains that would be called (top 20, ordered alphabetically):");
    const domains = [...new Set(wouldCall.map((p) => p.domain))].sort();
    for (const d of domains.slice(0, 20)) {
      const n = wouldCall.filter((p) => p.domain === d).length;
      console.log(`  ${d.padEnd(36)} (${n} contact${n === 1 ? "" : "s"})`);
    }
    console.log("");
    console.log(`Dry-run complete. Rerun with --write to persist. Hunter calls would be ~${callBudget}.`);
    return;
  }

  // Write path.
  let executed = 0;
  let written = 0;
  const statusCounts: Record<string, number> = {};
  for (const plan of wouldCall) {
    if (args.limit && executed >= args.limit) break;
    const entry = await processContact(plan.contact, now, true, apiKey!);
    statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;
    const wrote = await applyContactEnrichmentNeon(WORKSPACE, plan.contact.id, { hunter: entry });
    if (wrote) written += 1;
    executed += 1;
    // Safe per-call log: domain only, no email, no name.
    console.log(
      `  [${executed}/${callBudget}] domain=${plan.domain.padEnd(30)} ` +
        `status=${entry.status} conf=${entry.confidence ?? "—"} ` +
        `role=${entry.role ? "yes" : "no"} company=${entry.company ? "yes" : "no"}`,
    );
    if (executed < callBudget) await sleep(RATE_LIMIT_DELAY_MS);
  }

  console.log("");
  console.log("Write summary:");
  console.log(`  contacts visited:  ${executed}`);
  console.log(`  rows updated:      ${written}`);
  for (const [k, v] of Object.entries(statusCounts).sort()) {
    console.log(`  status=${k.padEnd(14)} ${v}`);
  }
}

main().catch((err) => {
  console.error("[enrich:hunter] crashed");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
