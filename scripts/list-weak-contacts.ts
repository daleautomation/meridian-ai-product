/**
 * list-weak-contacts — produce a founder-readable, ordered table of
 * contacts most worth repairing in a 30-minute rehab session.
 *
 * Output is read top-to-bottom during the founder + operator call.
 * Each row asks the operator a single question, e.g.:
 *   "Greg — surname?"   or
 *   "Phil — what's his address?"
 *
 * Priority order is deterministic:
 *   1. WEAK rows that are ONE field away from MED tier (highest leverage).
 *   2. WEAK rows with existing relationship history (lastInteractionAt
 *      present) — operator knows them.
 *   3. WEAK rows with at least one actionable channel.
 *   4. Remaining WEAK rows.
 *
 * No AI scoring. No fuzzy heuristics. The classifier from
 * lib/crm-import/integrity.ts produces the tier; this script orders
 * the WEAK subset by deterministic readiness-to-repair signals.
 *
 * Usage:
 *   set -a; source .env.local; set +a
 *   npm run list:weak -- --customer=nicole-lonergan
 *   npm run list:weak -- --customer=nicole-lonergan --limit=40
 *   npm run list:weak -- --customer=nicole-lonergan --format=json > rehab.json
 */

import { listContactsByWorkspace } from "@/lib/crm-import/store";
import { classifyCrmIntegrity, type CrmIntegrityReport } from "@/lib/crm-import/integrity";
import { isInternalDiagnosticContact } from "@/lib/crm-import/internalContactFilter";
import type { CrmContactRecord } from "@/lib/crm-import/types";

interface CliArgs {
  customer: string;
  limit: number;
  format: "table" | "json";
}

function parseArgs(argv: readonly string[]): CliArgs {
  let customer = "";
  let limit = 50;
  let format: "table" | "json" = "table";
  for (const a of argv) {
    if (a.startsWith("--customer=")) customer = a.slice("--customer=".length);
    else if (a.startsWith("--limit=")) {
      const n = Number.parseInt(a.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (a.startsWith("--format=")) {
      const v = a.slice("--format=".length);
      if (v === "json" || v === "table") format = v;
    }
  }
  if (!customer) {
    console.error("Usage: npm run list:weak -- --customer=<slug> [--limit=N] [--format=table|json]");
    process.exit(1);
  }
  return { customer, limit, format };
}

interface RankedWeak {
  contact: CrmContactRecord;
  report: CrmIntegrityReport;
  missingFields: string[];
  fieldsAwayFromMed: number;
  hasHistory: boolean;
  hasChannel: boolean;
  priorityScore: number;
}

/**
 * Compute the closed-set of FIVE strengths the integrity classifier
 * looks at: surname / business_domain / parseable_address /
 * actionable_channel / (touch-on-file as a softer ancillary).
 *
 * `fieldsAwayFromMed` counts how many MORE strengths this row needs
 * to cross WEAK → MED. MED tier requires ≥3 of the 4 hard strengths
 * (surname, business_domain, parseable_address, actionable_channel).
 *
 * Pure. Deterministic.
 */
function classifyForRehab(contact: CrmContactRecord, report: CrmIntegrityReport): RankedWeak {
  const tokens = (contact.name ?? "").trim().split(/\s+/).filter(Boolean);
  const hasSurname = tokens.length >= 2 && tokens[tokens.length - 1].length > 1;

  const email = (contact.email ?? contact.normalizedEmail ?? "").toLowerCase().trim();
  const at = email.indexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : "";
  const PERSONAL_DOMAINS = new Set([
    "gmail.com", "yahoo.com", "hotmail.com", "icloud.com", "aol.com",
    "outlook.com", "msn.com", "live.com", "proton.me", "protonmail.com",
    "pm.me", "mac.com", "me.com", "ymail.com",
  ]);
  const hasBusinessDomain = domain.length > 0 && !PERSONAL_DOMAINS.has(domain);

  const hasParseableAddress = (() => {
    const a = (contact.address ?? "").trim();
    if (a.length < 8) return false;
    return /\d/.test(a) && (/\b\d{5}\b/.test(a) || /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i.test(a));
  })();

  const hasChannel = report.hasActionableChannel;
  const hardStrengths =
    (hasSurname ? 1 : 0) +
    (hasBusinessDomain ? 1 : 0) +
    (hasParseableAddress ? 1 : 0) +
    (hasChannel ? 1 : 0);
  const fieldsAwayFromMed = Math.max(0, 3 - hardStrengths);

  const hasHistory = !!(contact.lastInteractionAt ?? "").trim();

  // What the operator should be asked about, in display order.
  const missingFields: string[] = [];
  if (!hasSurname) missingFields.push("surname");
  if (!hasBusinessDomain && !email) missingFields.push("email");
  if (!hasBusinessDomain && email) missingFields.push("(personal email — won't enrich)");
  if (!hasParseableAddress && !(contact.address ?? "").trim()) missingFields.push("address");
  if (!hasParseableAddress && (contact.address ?? "").trim()) missingFields.push("(address unparseable)");
  if (!hasChannel) missingFields.push("no channel");

  // Priority scoring — deterministic, no AI, no fuzzy magic:
  //   • Lower fieldsAwayFromMed wins (one fix == big tier jump)
  //   • Has-history breaks ties (operator knows them)
  //   • Has-channel breaks remaining ties (we can already reach them)
  //   • Contact id breaks final ties (stable output across runs)
  const priorityScore =
    (fieldsAwayFromMed * 1000) +
    (hasHistory ? 0 : 100) +
    (hasChannel ? 0 : 50);

  return {
    contact,
    report,
    missingFields,
    fieldsAwayFromMed,
    hasHistory,
    hasChannel,
    priorityScore,
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s.padEnd(n);
  return `${s.slice(0, n - 1)}…`;
}

function maskEmailHost(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  return at < 0 ? "—" : `***@${email.slice(at + 1)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const all = await listContactsByWorkspace(args.customer);
  const visible = all.filter((c) => !isInternalDiagnosticContact(c));

  // Classify all visible. Keep WEAK only.
  const ranked: RankedWeak[] = visible
    .map((c) => {
      const report = classifyCrmIntegrity(c);
      return classifyForRehab(c, report);
    })
    .filter((r) => r.report.tier === "WEAK")
    .sort((a, b) => {
      if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore;
      return a.contact.id.localeCompare(b.contact.id);
    });

  if (args.format === "json") {
    const payload = ranked.slice(0, args.limit).map((r) => ({
      contactId: r.contact.id,
      name: r.contact.name,
      company: r.contact.company || null,
      currentEmail: r.contact.email,
      currentPhone: r.contact.phone,
      currentAddress: r.contact.address,
      lastInteractionAt: r.contact.lastInteractionAt,
      sourceCrm: r.contact.sourceCrm,
      missingFields: r.missingFields,
      fieldsAwayFromMed: r.fieldsAwayFromMed,
      hasHistory: r.hasHistory,
      hasChannel: r.hasChannel,
      tier: r.report.tier,
    }));
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  console.log("");
  console.log(`Weak contacts in ${args.customer} — rehab session list`);
  console.log("=".repeat(80));
  console.log(
    `Showing ${Math.min(args.limit, ranked.length)} of ${ranked.length} WEAK contacts.`,
  );
  console.log(
    "Sort: closest-to-MED first, then has-history, then has-channel, then contactId.",
  );
  console.log("");

  // Table header
  const header = [
    "#".padEnd(3),
    "Name".padEnd(22),
    "→MED in".padEnd(8),
    "Hist".padEnd(5),
    "Chan".padEnd(5),
    "Missing".padEnd(26),
    "Last touch".padEnd(11),
    "Email host".padEnd(20),
  ].join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  ranked.slice(0, args.limit).forEach((r, idx) => {
    const lastTouch = (r.contact.lastInteractionAt ?? "").slice(0, 10) || "—";
    console.log(
      [
        String(idx + 1).padEnd(3),
        truncate(r.contact.name || "(blank)", 22),
        `${r.fieldsAwayFromMed}`.padEnd(8),
        (r.hasHistory ? "yes" : "no").padEnd(5),
        (r.hasChannel ? "yes" : "no").padEnd(5),
        truncate(r.missingFields.join(", ") || "—", 26),
        lastTouch.padEnd(11),
        truncate(maskEmailHost(r.contact.email), 20),
      ].join("  "),
    );
  });

  console.log("");
  console.log("Suggested rehab flow (per row, in conversation):");
  console.log("  1.  'Who is <Name>?' — confirm they're real, not duplicates");
  console.log("  2.  Ask the missing field shown in the 'Missing' column");
  console.log("  3.  Run: npm run repair:contacts -- --customer=<slug> \\");
  console.log("        --contact=<id> --field=<name|company|email|phone|address> \\");
  console.log("        --value=\"<new value>\" --write");
  console.log("  4.  After every ~10 repairs: npm run crm:audit -- --customer=<slug>");
  console.log("      (watch HIGH/MED counts climb in real time)");
  console.log("");
  console.log("Contact ids in copy-pasteable form (first 10):");
  ranked.slice(0, Math.min(10, args.limit)).forEach((r, idx) => {
    console.log(`  ${String(idx + 1).padEnd(3)} ${r.contact.id}`);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[list:weak] crashed");
  console.error(message);
  process.exit(1);
});
