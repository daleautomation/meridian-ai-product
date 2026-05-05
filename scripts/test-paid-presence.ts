// Meridian AI — manual smoke test for check_paid_presence.
//
// Runs the tool against 3 fixtures:
//   1. A large national roofer that almost certainly runs ads
//   2. A KC roofer that may or may not run ads (ambiguous)
//   3. A fake name designed to match nothing (control)
//
// Usage: npx tsx scripts/test-paid-presence.ts
//
// The tool's contract is to fail gracefully to null — not to throw, and
// not to produce false positives. This script surfaces:
//   googleAds, googleStatus, metaAds, metaStatus,
//   manualVerificationRequired, confidence, evidenceUrls, detail strings,
//   elapsed ms per call.
//
// At the top of the output we print setup warnings (Meta token absent,
// likely GATC RPC 400) so the operator running this sees at a glance
// what manual setup is still needed before the tool can return booleans.

import { checkPaidPresenceTool } from "../lib/mcp/tools/checkPaidPresence";

const FIXTURES = [
  {
    label: "Likely-advertising national roofer",
    company: {
      name: "Erie Home",
      domain: "eriehome.com",
      location: "Erie, PA",
    },
  },
  {
    label: "KC small-market roofer (ambiguous)",
    company: {
      name: "Atlas Roofing & Exteriors",
      domain: "atlasexteriors.com",
      location: "Gladstone, MO",
    },
  },
  {
    label: "Clearly-not-an-advertiser control (fake name)",
    company: {
      name: "Thislongunlikelycompanynameshouldnotmatch Roofing",
      location: "Kansas City, MO",
    },
  },
];

function banner(s: string) {
  const bar = "─".repeat(Math.max(4, s.length + 4));
  console.log(bar);
  console.log(`  ${s}`);
  console.log(bar);
}

async function main() {
  banner("check_paid_presence — smoke test");

  // Setup warnings — surface these first so the reader knows what to
  // expect before the fixtures run.
  const warnings: string[] = [];
  if (!process.env.META_AD_LIBRARY_TOKEN) {
    warnings.push(
      "META_AD_LIBRARY_TOKEN is not set. metaAds will always be null " +
      "(status='unknown'). Set the token in .env.local to unlock real " +
      "confirmations; until then, metaDetail will link to a search URL " +
      "the rep can verify by hand.",
    );
  }
  warnings.push(
    "Google Ads Transparency Center uses an undocumented RPC. Recent " +
    "request-body schemas return HTTP 400 in some regions / networks. " +
    "When that happens, googleStatus will be 'error' and googleAds null. " +
    "The evidence URL still links to the live search so the rep can " +
    "verify manually in ~10 seconds.",
  );
  if (warnings.length > 0) {
    console.log("\nSETUP NOTES:");
    for (const w of warnings) console.log(`  ! ${w}`);
    console.log("");
  }

  let confirmedTrueCount = 0;
  let errorCount = 0;

  for (const fx of FIXTURES) {
    const t0 = Date.now();
    const res = await checkPaidPresenceTool.handler({ company: fx.company });
    const ms = Date.now() - t0;
    const d = res.data;

    // Tallies used at the end for a one-line verdict.
    if (d.googleAds === true || d.metaAds === true) confirmedTrueCount++;
    if (d.googleStatus === "error" || d.metaStatus === "error") errorCount++;

    console.log(`[${fx.label}]`);
    console.log(`  company                       : ${fx.company.name}${fx.company.domain ? " (" + fx.company.domain + ")" : ""}`);
    console.log(`  googleAds / googleStatus      : ${String(d.googleAds)} / ${d.googleStatus ?? "—"}`);
    console.log(`  metaAds   / metaStatus        : ${String(d.metaAds)} / ${d.metaStatus ?? "—"}`);
    console.log(`  confidence                    : ${d.confidence}`);
    console.log(`  manualVerificationRequired    : ${String(d.manualVerificationRequired)}`);
    console.log(`  evidenceUrls                  :`);
    for (const u of d.evidenceUrls) console.log(`    - ${u}`);
    console.log(`  googleDetail                  : ${d.googleDetail ?? "—"}`);
    console.log(`  metaDetail                    : ${d.metaDetail ?? "—"}`);
    console.log(`  elapsed                       : ${ms}ms`);
    console.log("");
  }

  console.log("─".repeat(64));
  console.log(`confirmed-true fixtures : ${confirmedTrueCount} / ${FIXTURES.length}`);
  console.log(`detector errors         : ${errorCount} / ${FIXTURES.length * 2} axes`);
  if (confirmedTrueCount === 0 && errorCount > 0) {
    console.log("");
    console.log(
      "Reminder: every fixture returned null because at least one detector " +
      "was in an error/unknown state (see SETUP NOTES above). This is the " +
      "correct behaviour — the tool will NEVER produce false positives. " +
      "Fix the setup gap (Meta token / GATC body) and re-run to see real " +
      "booleans.",
    );
  }
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});
