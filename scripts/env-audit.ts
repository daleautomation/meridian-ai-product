/**
 * env:audit — detect the Vercel "encrypted empty string" pattern.
 *
 * Twice in this codebase's history, `vercel env pull` overwrote
 * .env.local with `KEY=""` because the encrypted Vercel value was
 * itself an empty string. Each time, a critical integration silently
 * died until the next manual check. This script catches the pattern
 * across all Meridian-critical env vars in one pass.
 *
 * What it checks (local .env.local only — never queries Vercel for
 * secret values):
 *   • each required key is present
 *   • the line is non-empty AND not just paired quote characters
 *   • postgres URLs parse to a valid URL
 *   • Hunter / Anthropic / Google Places keys match raw-key shape
 *     (no URL-style values pasted in by mistake)
 *
 * Exits 0 if every required env var is healthy. Non-zero with a
 * named remediation per failure otherwise. Never prints a secret
 * value.
 */

import fs from "node:fs";
import path from "node:path";

const ENV_FILE = path.resolve(".env.local");
const RAW_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

type Severity = "block" | "warn";
interface Finding {
  key: string;
  severity: Severity;
  reason: string;
}

const findings: Finding[] = [];
function block(key: string, reason: string): void {
  findings.push({ key, severity: "block", reason });
}
function warn(key: string, reason: string): void {
  findings.push({ key, severity: "warn", reason });
}

function readEnv(): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(ENV_FILE)) return out;
  const text = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out.set(m[1], m[2]);
  }
  return out;
}

function unwrapValue(raw: string): string {
  let v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

function maskHost(rawValue: string): string {
  try {
    const u = new URL(unwrapValue(rawValue));
    const parts = u.hostname.split(".");
    const first = parts[0];
    const masked = first.length <= 3 ? "***" : `${first.slice(0, 3)}***`;
    return [masked, ...parts.slice(1)].join(".");
  } catch {
    return "(unparseable)";
  }
}

function checkPresent(env: Map<string, string>, key: string, severity: Severity = "block"): boolean {
  if (!env.has(key)) {
    findings.push({ key, severity, reason: "missing from .env.local" });
    return false;
  }
  return true;
}

function checkNonEmpty(env: Map<string, string>, key: string, severity: Severity = "block"): boolean {
  const raw = env.get(key);
  if (raw === undefined) return false;
  const v = unwrapValue(raw);
  if (v.length === 0) {
    findings.push({
      key,
      severity,
      reason:
        "present but empty (the Vercel encrypted-empty pattern). " +
        "Re-set the value in Vercel and re-pull, or paste directly into .env.local.",
    });
    return false;
  }
  return true;
}

function checkPostgresUrl(env: Map<string, string>, key: string): void {
  const raw = env.get(key);
  if (raw === undefined) return;
  const v = unwrapValue(raw);
  if (v.length === 0) return; // already reported by checkNonEmpty
  try {
    const u = new URL(v);
    if (u.protocol !== "postgres:" && u.protocol !== "postgresql:") {
      block(key, `not a postgres URL (protocol ${u.protocol})`);
    }
  } catch {
    block(key, "does not parse as a URL");
  }
}

function checkRawKey(env: Map<string, string>, key: string): void {
  const raw = env.get(key);
  if (raw === undefined) return;
  const v = unwrapValue(raw);
  if (v.length === 0) return;
  if (/api\.hunter\.io|api_key=|https?:\/\//i.test(v)) {
    block(key, "looks like a URL or query string, not a raw API key");
    return;
  }
  if (!RAW_KEY_PATTERN.test(v)) {
    block(key, "contains characters outside [A-Za-z0-9_-]");
    return;
  }
  if (v.length < 16) {
    warn(key, `suspiciously short (length=${v.length})`);
  }
}

const REQUIRED = [
  { key: "DATABASE_URL", kind: "postgres" as const },
  { key: "SESSION_SECRET", kind: "raw" as const },
  { key: "HUNTER_API_KEY", kind: "raw" as const },
  { key: "ANTHROPIC_API_KEY", kind: "raw" as const, optional: true },
  { key: "GOOGLE_PLACES_API_KEY", kind: "raw" as const, optional: true },
  { key: "NEXT_PUBLIC_APP_URL", kind: "url" as const, optional: true },
];

function main(): void {
  const env = readEnv();

  console.log("");
  console.log("env:audit — local .env.local");
  console.log("============================");
  if (!fs.existsSync(ENV_FILE)) {
    console.error("✗ .env.local does not exist.");
    console.error("  Remediation: `vercel env pull --environment=production` or paste your secrets in.");
    process.exit(1);
  }

  for (const spec of REQUIRED) {
    const severity: Severity = spec.optional ? "warn" : "block";
    if (!checkPresent(env, spec.key, severity)) continue;
    if (!checkNonEmpty(env, spec.key, severity)) continue;
    if (spec.kind === "postgres") {
      checkPostgresUrl(env, spec.key);
      const v = env.get(spec.key);
      if (v && unwrapValue(v).length > 0) {
        console.log(`  ${spec.key.padEnd(24)} OK   host=${maskHost(v)}`);
      }
    } else if (spec.kind === "raw") {
      checkRawKey(env, spec.key);
      const v = env.get(spec.key);
      if (v && unwrapValue(v).length > 0) {
        console.log(`  ${spec.key.padEnd(24)} OK   length=${unwrapValue(v).length}`);
      }
    } else {
      const v = env.get(spec.key);
      if (v && unwrapValue(v).length > 0) {
        console.log(`  ${spec.key.padEnd(24)} OK   value present`);
      }
    }
  }

  const blockers = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");

  if (warns.length > 0) {
    console.log("");
    console.log("Warnings");
    for (const w of warns) console.log(`  ⚠ ${w.key}: ${w.reason}`);
  }
  if (blockers.length > 0) {
    console.error("");
    console.error("Blocking issues — fix before live operations");
    for (const b of blockers) console.error(`  ✗ ${b.key}: ${b.reason}`);
    process.exit(1);
  }
  console.log("");
  console.log("✓ All required env vars are healthy.");
}

main();
