// Meridian AI — before/after rerank diagnostic.
//
// Runs rank_companies against the live snapshot store and compares the
// engine's own bucket assignments to the closeability rerank. Used to
// produce the pilot-readiness report (exact bucket counts, top-10 lists,
// demoted / promoted leads with reasons).
//
// Run: npx tsx scripts/rerank-report.ts

import { listSnapshots } from "../lib/state/companySnapshotStore";
import { rankCompanies } from "../lib/scoring/companyDecision";
import { rerankByCloseability } from "../lib/scoring/closeability";

async function main() {
  const snaps = await listSnapshots();
  const ranked = rankCompanies(snaps);
  const snapshotsByKey = new Map(snaps.map((s) => [s.key, s]));
  const rerank = rerankByCloseability(ranked, snapshotsByKey);

  // Before counts from the existing engine.
  const beforeCounts = { "CALL NOW": 0, TODAY: 0, MONITOR: 0, PASS: 0 } as Record<string, number>;
  for (const d of ranked) {
    const b = d.bucket ?? "MONITOR";
    beforeCounts[b] = (beforeCounts[b] ?? 0) + 1;
  }

  const afterCounts = {
    "CALL NOW": rerank.callNow.length,
    TODAY: rerank.today.length,
    MONITOR: rerank.monitor.length,
    PASS: rerank.pass.length,
  };

  const beforeKeys = new Map(ranked.map((d, i) => [d.key, { bucket: d.bucket, rank: i + 1, name: d.name }]));
  const afterByKey = new Map(rerank.all.map((l) => [l.key, l]));

  const demoted: Array<{ name: string; from: string; to: string; reason: string }> = [];
  const promoted: Array<{ name: string; from: string; to: string; reason: string }> = [];
  const BUCKET_RANK: Record<string, number> = { "CALL NOW": 0, TODAY: 1, MONITOR: 2, PASS: 3 };
  for (const d of ranked) {
    const before = d.bucket;
    const after = afterByKey.get(d.key)?.closeability.bucket ?? "MONITOR";
    if (before === after) continue;
    const reason = afterByKey.get(d.key)?.closeability.bucketReason ?? "";
    const rec = { name: d.name, from: before, to: after, reason };
    if (BUCKET_RANK[after] > BUCKET_RANK[before]) demoted.push(rec);
    else promoted.push(rec);
  }

  const top10Before = ranked.slice(0, 10).map((d) => ({
    rank: d.rank,
    name: d.name,
    bucket: d.bucket,
    score: d.score,
    phone: d.contacts?.primaryPhone ?? null,
  }));
  const top10After = [...rerank.callNow, ...rerank.today, ...rerank.monitor, ...rerank.pass]
    .slice(0, 10)
    .map((l) => ({
      name: l.name,
      bucket: l.closeability.bucket,
      score: l.closeability.score,
      intent: l.closeability.intent.level,
      leak: l.closeability.leak.level,
      reach: l.closeability.reach.level,
      timing: l.closeability.timing.level,
      phone: l.contacts?.primaryPhone ?? null,
    }));

  // Validation — nothing in CALL NOW should have a 555 placeholder
  // phone or a reach level of "Missing" or "Weak".
  const callNowAudit = rerank.callNow.map((l) => ({
    name: l.name,
    phone: l.contacts?.primaryPhone ?? null,
    reach: l.closeability.reach.level,
    leak: l.closeability.leak.level,
    intent: l.closeability.intent.level,
    intentReason: l.closeability.intent.reason,
    leakReason: l.closeability.leak.reason,
    reachReason: l.closeability.reach.reason,
    bucketReason: l.closeability.bucketReason,
  }));

  const placeholderPhoneRe = /^\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?555[-.\s]?\d{4}$/;
  const violations = callNowAudit.filter((l) =>
    !l.phone ||
    placeholderPhoneRe.test(String(l.phone).replace(/\s+/g, "")) ||
    l.reach !== "Verified" ||
    l.leak === "Low" ||
    l.leak === "None" ||
    l.intent === "Unknown",
  );

  const report = {
    totalSnapshots: snaps.length,
    totalDecisions: ranked.length,
    beforeCounts,
    afterCounts,
    top10Before,
    top10After,
    demoted: demoted.slice(0, 20),
    demotedCount: demoted.length,
    promoted: promoted.slice(0, 20),
    promotedCount: promoted.length,
    callNowAudit,
    violations,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
