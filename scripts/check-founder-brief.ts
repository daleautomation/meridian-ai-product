// Founder Morning Brief — composition logic check (no I/O).

import { composeBrief, type BriefEvidence } from "../lib/founder-brief/composeBrief";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function baseEvidence(overrides: Partial<BriefEvidence> = {}): BriefEvidence {
  return {
    dateLabel: "2026-06-02",
    dayOfWeek: 1, // Monday
    git: {
      branch: "main",
      head: "abc1234",
      aheadOfMain: 0,
      dirty: false,
      changedPaths: [],
      recentCommits: ["fix integrity"],
    },
    ops: {
      present: true,
      generatedAt: new Date().toISOString(),
      stale: false,
      overall: "HEALTHY",
      counts: { blocking: 0, review: 0, healthy: 12 },
      deployment: {
        branch: "main",
        head: "abc1234",
        aheadOfMain: 0,
        ciConfigured: true,
        productionTracksMain: true,
        note: "on main, CI present",
      },
      checks: [
        {
          id: "workspace-truth",
          label: "Live workspace truth",
          category: "integrity",
          outcome: "PASS",
          status: "HEALTHY",
          detail: "no blocking issues",
        },
      ],
    },
    weekly: {
      customer: "nicole-lonergan",
      currentWeekId: "2026-W23",
      snapshotExists: false,
      snapshotAgeHours: null,
    },
    docs: { founderRunbook: true, productBifurcation: true },
    ...overrides,
  };
}

function main() {
  // 1. Revenue-first section order
  const clean = composeBrief(baseEvidence());
  const titles = clean.sections.map((s) => s.title);
  assert(titles[0] === "What Makes Money Today", "first section must be revenue");
  assert(titles[1] === "What Can Break Revenue", "second section must be revenue risk");
  assert(titles[4] === "Pushback", "pushback is fifth");
  assert(titles[9] === "Technical State", "technical state is last");

  // 2. Headline is leverage-focused, not repo state
  assert(/Highest leverage today/i.test(clean.headline), "headline must frame leverage");
  assert(!/^Git:/i.test(clean.headline), "headline must not lead with git");

  // 3. Pushback hard-thing sentence
  const pushback = clean.sections.find((s) => s.title === "Pushback")!;
  assert(
    pushback.bullets.some((b) => b.startsWith("Dylan, the hard thing you are probably avoiding is")),
    "pushback must include mandated hard-thing sentence",
  );

  // 4. Missing snapshot on Monday → money section mentions generate
  assert(
    clean.markdown.includes("weekly-state:generate"),
    "Monday without snapshot should push generation",
  );

  // 5. Relationship Engine drift
  const re = composeBrief(
    baseEvidence({
      git: {
        ...baseEvidence().git,
        dirty: true,
        changedPaths: ["lib/relationship-engine/timeline/events.ts"],
      },
    }),
  );
  assert(
    re.sections.find((s) => s.title === "Stop Touching")!.bullets.some((b) => /Relationship Engine/i.test(b)),
    "RE paths → stop touching",
  );
  assert(
    re.sections.find((s) => s.title === "Pushback")!.bullets.some((b) => /Relationship Engine/i.test(b)),
    "RE paths → pushback",
  );

  // 6. Blocking workspace truth → break revenue + CEO attention
  const blocking = composeBrief(
    baseEvidence({
      ops: {
        ...baseEvidence().ops,
        overall: "BLOCKING",
        counts: { blocking: 1, review: 0, healthy: 0 },
        checks: [
          {
            id: "workspace-truth",
            label: "Live workspace truth",
            category: "integrity",
            outcome: "FAIL",
            status: "BLOCKING",
            detail: "BLOCKING: Greg · Greg",
          },
        ],
      },
    }),
  );
  assert(
    blocking.sections.find((s) => s.title === "What Can Break Revenue")!.bullets.some((b) => /BLOCKING/i.test(b)),
    "blocking truth → revenue break",
  );

  // 7. No ops snapshot → evidence gap stated, not invented metrics
  const noOps = composeBrief(baseEvidence({ ops: { ...baseEvidence().ops, present: false, checks: [] } }));
  assert(
    noOps.markdown.includes("Evidence gap") || noOps.markdown.includes("no ops snapshot"),
    "missing ops must say evidence gap",
  );

  // 8. Technical state at bottom contains git summary
  const tech = clean.sections.find((s) => s.title === "Technical State")!;
  assert(tech.bullets.some((b) => b.startsWith("Git:")), "technical section has git facts");

  console.log("founder-brief composition check passed", {
    sections: titles.length,
    headline: clean.headline.slice(0, 80),
  });
}

main();
