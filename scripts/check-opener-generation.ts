/**
 * Validation for the deterministic opener builder.
 *
 *   1. Synthetic fixtures across every extractor — asserts source + trust
 *      label + that the supporting evidence quotes the CRM material it
 *      claims to.
 *   2. Determinism: identical input → byte-identical opener.
 *   3. Banned-phrase scan: no salesy / AI / urgency language in any
 *      generated opener.
 *   4. Live audit against Nicole's Neon contacts when DATABASE_URL is
 *      set. Asserts ≥ 70% of contacts produce a non-generic opener;
 *      reports the source-tier distribution + sample lines.
 *
 * Exit codes:
 *   0 — all assertions pass
 *   1 — at least one assertion failed
 */

import { listContactsNeon } from "@/lib/crm-import/crmContactsNeonAdapter";
import {
  buildSuggestedOpener,
  buildSuggestedOpenerFromContact,
  type OpenerInput,
  type OpenerSource,
  type SuggestedOpener,
} from "@/lib/personal-workspace/openerBuilder";

const FIXED_NOW = new Date("2026-05-26T12:00:00.000Z");
const NICOLE_WORKSPACE = "nicole-lonergan";
const SPECIFIC_OPENER_TARGET = 0.7; // ≥ 70% of contacts non-generic

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

// Banned in any generated opener. These keep the line operator-grade.
const BANNED_PHRASES = [
  /perfect time/i,
  /great opportunity/i,
  /game[-\s]?changing/i,
  /\bleverage\b/i,
  /personalize/i,
  /AI[-\s]?(?:powered|driven|suggests|recommends|believes)/i,
  /likely to (?:close|sell|buy)/i,
  /unlock/i,
  /\bsynergy\b/i,
  /act now/i,
  /don't miss/i,
] as const;

function assertCleanLanguage(s: SuggestedOpener, label: string): void {
  for (const re of BANNED_PHRASES) {
    if (re.test(s.opener)) {
      fail(`${label}: opener contains banned phrase /${re.source}/ → "${s.opener}"`);
    }
  }
}

// ── Synthetic fixture battery ──────────────────────────────────────

function makeInput(overrides: Partial<OpenerInput>): OpenerInput {
  return {
    name: "Jane Smith",
    notes: null,
    tags: [],
    lastInteractionAt: null,
    sourceCrm: "Wise Agent",
    ...overrides,
  };
}

interface FixtureCase {
  label: string;
  input: OpenerInput;
  expectedSource: OpenerSource;
  expectedTrust: SuggestedOpener["trustLevel"];
  evidenceMustInclude?: string;
}

const FIXTURES: FixtureCase[] = [
  {
    label: "notes:renovation topical",
    input: makeInput({ notes: "Mid-conversation about a kitchen renovation last spring." }),
    expectedSource: "notes:renovation",
    expectedTrust: "HIGH",
    evidenceMustInclude: "kitchen renovation",
  },
  {
    label: "notes:contractor",
    input: makeInput({ notes: "Working with a contractor in Mission Hills." }),
    expectedSource: "notes:contractor",
    expectedTrust: "HIGH",
    evidenceMustInclude: "contractor",
  },
  {
    label: "notes:investment_property",
    input: makeInput({ notes: "Asked about cap rate on a duplex in Overland Park." }),
    expectedSource: "notes:investment_property",
    expectedTrust: "HIGH",
    evidenceMustInclude: "cap rate",
  },
  {
    label: "notes:growing_family",
    input: makeInput({ notes: "Expecting a baby in March, started thinking about a bigger place." }),
    expectedSource: "notes:growing_family",
    expectedTrust: "HIGH",
    evidenceMustInclude: "baby",
  },
  {
    label: "notes:relocation",
    input: makeInput({ notes: "Job transfer to Denver — may need to relocate by Q3." }),
    expectedSource: "notes:relocation",
    expectedTrust: "HIGH",
    evidenceMustInclude: "transfer",
  },
  {
    label: "notes:downsizing",
    input: makeInput({ notes: "Empty-nester now, asked about a smaller place." }),
    expectedSource: "notes:downsizing",
    expectedTrust: "HIGH",
    evidenceMustInclude: "Empty",
  },
  {
    label: "notes:refinance",
    input: makeInput({ notes: "Refi conversation last quarter — looking at HELOC options." }),
    expectedSource: "notes:refinance",
    expectedTrust: "HIGH",
    evidenceMustInclude: "Refi",
  },
  {
    label: "notes:school_district",
    input: makeInput({ notes: "Wants Blue Valley school district for the kids." }),
    expectedSource: "notes:school_district",
    expectedTrust: "HIGH",
    evidenceMustInclude: "Blue Valley",
  },
  {
    label: "notes:timing_signal",
    input: makeInput({ notes: "Said they'd be ready in the spring market." }),
    expectedSource: "notes:timing_signal",
    expectedTrust: "HIGH",
    evidenceMustInclude: "spring market",
  },
  {
    label: "notes:plain_quote (long note, no topical match)",
    input: makeInput({ notes: "We had a long lunch and they were thinking about life changes." }),
    expectedSource: "notes:plain_quote",
    expectedTrust: "HIGH",
  },
  {
    label: "tag:past_buyer (with year)",
    input: makeInput({ tags: ["Past Buyer"], lastInteractionAt: "2021-03-15T00:00:00.000Z" }),
    expectedSource: "tag:past_buyer",
    expectedTrust: "MED",
    evidenceMustInclude: "Past Buyer",
  },
  {
    label: "tag:past_seller (with year)",
    input: makeInput({ tags: ["Past Seller"], lastInteractionAt: "2020-08-21T00:00:00.000Z" }),
    expectedSource: "tag:past_seller",
    expectedTrust: "MED",
  },
  {
    label: "tag:repeat_client",
    input: makeInput({ tags: ["Repeat Client"], lastInteractionAt: "2023-06-01T00:00:00.000Z" }),
    expectedSource: "tag:repeat_client",
    expectedTrust: "MED",
  },
  {
    label: "tag:referral_source",
    input: makeInput({ tags: ["Referral Source"] }),
    expectedSource: "tag:referral_source",
    expectedTrust: "MED",
  },
  {
    label: "tag:investor",
    input: makeInput({ tags: ["Investor Lead"] }),
    expectedSource: "tag:investor",
    expectedTrust: "MED",
  },
  {
    label: "tag:farm",
    input: makeInput({
      tags: ["Brookside Farm"],
      lastInteractionAt: "2024-08-15T00:00:00.000Z",
    }),
    expectedSource: "tag:farm",
    expectedTrust: "MED",
  },
  {
    label: "tag:sphere",
    input: makeInput({ tags: ["Sphere of Influence"] }),
    expectedSource: "tag:sphere",
    expectedTrust: "MED",
  },
  {
    label: "tag:first_time_buyer",
    input: makeInput({ tags: ["First Time Buyer"], lastInteractionAt: "2024-04-12T00:00:00.000Z" }),
    expectedSource: "tag:first_time_buyer",
    expectedTrust: "MED",
  },
  {
    label: "last_close:date (no tag, last touch 8 months ago)",
    input: makeInput({ lastInteractionAt: "2025-09-10T00:00:00.000Z" }),
    expectedSource: "last_close:date",
    expectedTrust: "MED",
  },
  {
    label: "stale_relationship:months (last touch 3 months ago)",
    input: makeInput({ lastInteractionAt: "2026-02-15T00:00:00.000Z" }),
    expectedSource: "stale_relationship:months",
    expectedTrust: "WEAK",
  },
  {
    label: "stale_relationship:years (last touch ~4 years ago)",
    input: makeInput({ lastInteractionAt: "2022-01-01T00:00:00.000Z" }),
    expectedSource: "stale_relationship:years",
    expectedTrust: "WEAK",
  },
  {
    label: "fallback:tag_only (unknown tag, no other context)",
    input: makeInput({ tags: ["Brunch Friends"] }),
    expectedSource: "fallback:tag_only",
    expectedTrust: "WEAK",
  },
  {
    label: "fallback:no_context",
    input: makeInput({}),
    expectedSource: "fallback:no_context",
    expectedTrust: "WEAK",
  },
];

function runFixtures(): void {
  for (const fixture of FIXTURES) {
    const result = buildSuggestedOpener(fixture.input, { now: FIXED_NOW });
    if (result.openerSource !== fixture.expectedSource) {
      fail(
        `${fixture.label}: expected source=${fixture.expectedSource}, got ${result.openerSource}`,
      );
      continue;
    }
    if (result.trustLevel !== fixture.expectedTrust) {
      fail(
        `${fixture.label}: expected trust=${fixture.expectedTrust}, got ${result.trustLevel}`,
      );
    }
    if (!result.opener.trim()) {
      fail(`${fixture.label}: empty opener string`);
    }
    if (!result.supportingEvidence.trim()) {
      fail(`${fixture.label}: empty supportingEvidence`);
    }
    if (
      fixture.evidenceMustInclude &&
      !result.supportingEvidence.toLowerCase().includes(fixture.evidenceMustInclude.toLowerCase())
    ) {
      fail(
        `${fixture.label}: supportingEvidence must include "${fixture.evidenceMustInclude}" — got "${result.supportingEvidence}"`,
      );
    }
    assertCleanLanguage(result, fixture.label);
    if (
      (fixture.expectedSource === "fallback:tag_only" ||
        fixture.expectedSource === "fallback:no_context" ||
        fixture.expectedSource === "stale_relationship:months" ||
        fixture.expectedSource === "stale_relationship:years") &&
      result.isSpecific
    ) {
      fail(`${fixture.label}: fallback sources must report isSpecific=false`);
    }
    if (
      !(
        fixture.expectedSource.startsWith("fallback:") ||
        fixture.expectedSource.startsWith("stale_relationship:")
      ) &&
      !result.isSpecific
    ) {
      fail(`${fixture.label}: non-fallback sources must report isSpecific=true`);
    }
  }
}

function runDeterminism(): void {
  const input = makeInput({
    notes: "Mid-conversation about a kitchen renovation last spring.",
    tags: ["Past Buyer"],
    lastInteractionAt: "2021-03-15T00:00:00.000Z",
  });
  const a = buildSuggestedOpener(input, { now: FIXED_NOW });
  const b = buildSuggestedOpener(input, { now: FIXED_NOW });
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail("determinism: two identical inputs produced different openers");
  }
}

// ── Live audit against Nicole's Neon contacts ──────────────────────

async function runLiveAudit(): Promise<void> {
  const url = (process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "").trim();
  if (!url) {
    console.log("[opener:check] DATABASE_URL not set — skipping Nicole live audit.");
    console.log("[opener:check] Run with `dotenv -e .env.local --` to include the live audit.");
    return;
  }

  const contacts = await listContactsNeon(NICOLE_WORKSPACE);
  if (contacts.length === 0) {
    console.log("[opener:check] Nicole workspace has 0 rows — skipping live audit.");
    return;
  }

  const sourceCounts = new Map<OpenerSource, number>();
  const trustCounts = { HIGH: 0, MED: 0, WEAK: 0 };
  const samples: Array<{ source: OpenerSource; opener: string; evidence: string; name: string }> = [];
  let specific = 0;

  for (const contact of contacts) {
    const result = buildSuggestedOpenerFromContact(contact, { now: FIXED_NOW });
    assertCleanLanguage(result, `nicole:${contact.id}`);

    sourceCounts.set(result.openerSource, (sourceCounts.get(result.openerSource) ?? 0) + 1);
    trustCounts[result.trustLevel] += 1;
    if (result.isSpecific) specific += 1;

    if (samples.length < 10 && result.isSpecific) {
      samples.push({
        source: result.openerSource,
        opener: result.opener,
        evidence: result.supportingEvidence,
        name: contact.name,
      });
    }
  }

  const total = contacts.length;
  const specificRate = specific / total;

  console.log("");
  console.log("Nicole live audit:");
  console.log(`  contacts:           ${total}`);
  console.log(`  specific openers:   ${specific} (${(specificRate * 100).toFixed(1)}%)`);
  console.log(`  generic fallbacks:  ${total - specific} (${((1 - specificRate) * 100).toFixed(1)}%)`);
  console.log(`  trust HIGH:         ${trustCounts.HIGH}`);
  console.log(`  trust MED:          ${trustCounts.MED}`);
  console.log(`  trust WEAK:         ${trustCounts.WEAK}`);
  console.log("");
  console.log("Source distribution:");
  const sortedSources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [source, count] of sortedSources) {
    console.log(`  ${source.padEnd(34)} ${String(count).padStart(4)}`);
  }
  console.log("");
  console.log("Sample specific openers (first 10):");
  for (const sample of samples) {
    console.log(`  [${sample.source}] ${sample.name}`);
    console.log(`    opener:   ${sample.opener}`);
    console.log(`    evidence: ${sample.evidence}`);
  }

  if (specificRate < SPECIFIC_OPENER_TARGET) {
    fail(
      `Nicole live audit: only ${(specificRate * 100).toFixed(1)}% of contacts produce a non-generic opener — ` +
        `target is ${SPECIFIC_OPENER_TARGET * 100}%.`,
    );
  }
}

async function main(): Promise<void> {
  runFixtures();
  runDeterminism();
  await runLiveAudit();

  if (failures.length > 0) {
    console.error("");
    console.error("check-opener-generation FAILED");
    for (const m of failures) console.error(`  - ${m}`);
    process.exit(1);
  }

  console.log("");
  console.log("check-opener-generation passed", {
    fixtures: FIXTURES.length,
    checks: [
      "every fixture source/trust matches expected",
      "every fixture has non-empty opener + evidence",
      "evidence quotes the CRM material it claims to",
      "fallback sources correctly report isSpecific=false",
      "non-fallback sources correctly report isSpecific=true",
      "no banned/salesy phrases in any opener",
      "deterministic: identical input → identical output",
      "Nicole live audit ≥ 70% specific (when DATABASE_URL present)",
    ],
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[opener:check] crashed");
  console.error(message);
  process.exit(1);
});
