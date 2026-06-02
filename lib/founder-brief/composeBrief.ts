// Founder Morning Brief — pure prioritization + markdown composition.
//
// Revenue-first. Evidence-only. No I/O, no secrets, no invented metrics.
// The runner (scripts/founder-morning-brief.ts) collects facts and feeds them here.

import type { OpsCheckResult, OpsDeployment, OpsStatus } from "@/lib/ops/opsCenter";

export interface GitEvidence {
  branch: string;
  head: string;
  aheadOfMain: number;
  dirty: boolean;
  changedPaths: string[];
  recentCommits: string[];
}

export interface WeeklyStateEvidence {
  customer: string;
  currentWeekId: string;
  snapshotExists: boolean;
  snapshotAgeHours: number | null;
}

export interface OpsEvidence {
  present: boolean;
  generatedAt: string | null;
  stale: boolean;
  overall: OpsStatus | null;
  counts: { blocking: number; review: number; healthy: number } | null;
  deployment: OpsDeployment | null;
  checks: OpsCheckResult[];
}

export interface BriefEvidence {
  /** YYYY-MM-DD in local framing (caller passes date string). */
  dateLabel: string;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  git: GitEvidence;
  ops: OpsEvidence;
  weekly: WeeklyStateEvidence;
  docs: {
    founderRunbook: boolean;
    productBifurcation: boolean;
  };
}

export interface BriefSection {
  title: string;
  bullets: string[];
}

export interface ComposedBrief {
  /** Answers: "What is the highest leverage use of Dylan today?" */
  headline: string;
  sections: BriefSection[];
  markdown: string;
}

// ── Path classifiers (read-only git paths) ─────────────────────────────

const RE_PREFIXES = ["lib/relationship-engine/", "app/api/relationship-engine/"];

const PRODUCT2_PATTERNS = [
  /(^|\/)labortech(\/|$|\.)/i,
  /config\/signals\/labortech/i,
  /docs\/labortech/i,
];

const FROZEN_PREFIXES = [
  "components/OperatorConsole.jsx",
  "components/CalendarCommandCenter.jsx",
  "app/showcase/",
  "app/roofing-intelligence/",
  "app/operator/relationship-priority/",
  "app/admin/runs",
  "app/admin/prospects",
  "app/api/mcp/",
  "lib/mcp/tools/",
  "app/demo/",
  "lib/calendar/market",
  "lib/calendar/global",
  "lib/calendar/team",
];

function matchesAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p));
}

function isRelationshipEngine(path: string): boolean {
  return matchesAny(path, RE_PREFIXES);
}

function isProduct2(path: string): boolean {
  return PRODUCT2_PATTERNS.some((re) => re.test(path));
}

function isFrozen(path: string): boolean {
  return matchesAny(path, FROZEN_PREFIXES);
}

function isDeliveryWindow(dayOfWeek: number): boolean {
  // Mon–Wed: weekly brief delivery window per founder runbook cadence.
  return dayOfWeek >= 1 && dayOfWeek <= 3;
}

function workspaceTruthCheck(checks: OpsCheckResult[]): OpsCheckResult | undefined {
  return checks.find((c) => c.id === "workspace-truth");
}

function blockingChecks(checks: OpsCheckResult[]): OpsCheckResult[] {
  return checks.filter((c) => c.status === "BLOCKING");
}

function reviewChecks(checks: OpsCheckResult[]): OpsCheckResult[] {
  return checks.filter((c) => c.status === "REVIEW");
}

function changedByCategory(paths: string[]): {
  relationshipEngine: string[];
  product2: string[];
  frozen: string[];
  opsUi: string[];
} {
  const relationshipEngine: string[] = [];
  const product2: string[] = [];
  const frozen: string[] = [];
  const opsUi: string[] = [];
  for (const p of paths) {
    if (isRelationshipEngine(p)) relationshipEngine.push(p);
    if (isProduct2(p)) product2.push(p);
    if (isFrozen(p)) frozen.push(p);
    if (/^(app\/operator\/ops|components\/operator\/OpsCenter|lib\/ops\/|scripts\/ops-center)/.test(p)) {
      opsUi.push(p);
    }
  }
  return { relationshipEngine, product2, frozen, opsUi };
}

// ── Section builders ───────────────────────────────────────────────────

function buildWhatMakesMoney(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];
  const wt = workspaceTruthCheck(ev.ops.checks);
  const wsReady = ev.weekly.snapshotExists;
  const wsClean = wt?.status === "HEALTHY";
  const inWindow = isDeliveryWindow(ev.dayOfWeek);

  if (wsReady && wsClean) {
    bullets.push(
      `Nicole weekly snapshot exists for ${ev.weekly.currentWeekId} and workspace truth is clean — highest leverage is **customer delivery**: send the Monday brief or confirm Nicole received it.`,
    );
  } else if (wsClean && !wsReady) {
    bullets.push(
      `Workspace data is clean but no snapshot for ${ev.weekly.currentWeekId} — run \`npm run weekly-state:generate -- --customer=${ev.weekly.customer}\` then ship. That is today's revenue move.`,
    );
  } else if (inWindow && !wsReady) {
    bullets.push(
      `Delivery window (Mon–Wed) with no ${ev.weekly.currentWeekId} snapshot — generating and shipping the brief is the only move that converts engineering into revenue today.`,
    );
  }

  const oppHealthy = ev.ops.checks.filter(
    (c) => c.category === "opportunity" && c.status === "HEALTHY",
  );
  if (oppHealthy.length > 0 && wsClean) {
    bullets.push(
      `Opportunity pipeline checks are green (${oppHealthy.map((c) => c.label).join(", ")}) — use proof from the brief to advance a retained-customer or pilot-pricing conversation.`,
    );
  }

  if (ev.docs.founderRunbook && !wsReady && wsClean) {
    bullets.push(
      "Follow `docs/founder-monday-runbook.md` generation block — the runbook exists; execution is the bottleneck, not documentation.",
    );
  }

  if (bullets.length === 0) {
    if (!ev.ops.present) {
      bullets.push(
        "Evidence gap: no ops snapshot. Run `npm run ops`, then `npm run founder:brief -- --refresh`. Until workspace truth is verified, revenue actions are speculative.",
      );
    } else if (wt?.status === "BLOCKING") {
      bullets.push(
        "No shippable brief until workspace truth is fixed. Today's money move is **data repair**, not new product work — then generate and deliver.",
      );
    } else {
      bullets.push(
        "No clear ship-ready signal. Default leverage: one founder-led customer proof call using whatever weekly snapshot or audit output you already have.",
      );
    }
  }

  return { title: "What Makes Money Today", bullets };
}

function buildWhatCanBreakRevenue(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];
  const wt = workspaceTruthCheck(ev.ops.checks);

  if (wt?.status === "BLOCKING") {
    bullets.push(`Workspace truth BLOCKING — ${wt.detail}. Shipping a brief on broken data destroys trust faster than skipping a week.`);
  } else if (wt?.status === "REVIEW") {
    bullets.push(`Workspace truth REVIEW — ${wt.detail}. Weak or incomplete data weakens the paid brief promise.`);
  } else if (ev.ops.present && !wt) {
    bullets.push("Workspace truth check did not run or is absent from ops snapshot — cannot confirm customer-ready data.");
  }

  for (const c of blockingChecks(ev.ops.checks).filter((x) => x.id !== "workspace-truth")) {
    bullets.push(`BLOCKING: ${c.label} — ${c.detail}`);
  }

  if (!ev.weekly.snapshotExists && isDeliveryWindow(ev.dayOfWeek)) {
    bullets.push(
      `Missing ${ev.weekly.currentWeekId} snapshot during delivery window — every day without shipment increases churn risk for a paying operator.`,
    );
  }

  if (ev.git.dirty && ev.git.aheadOfMain > 0) {
    bullets.push(
      `${ev.git.changedPaths.length} uncommitted paths on a branch ${ev.git.aheadOfMain} commits ahead of main — production may not match what you think you shipped.`,
    );
  }

  if (ev.ops.deployment && !ev.ops.deployment.productionTracksMain) {
    bullets.push(
      `Deployment posture: branch \`${ev.ops.deployment.branch}\` @ ${ev.ops.deployment.head} — ${ev.ops.deployment.note}. Revenue depends on what is actually deployed.`,
    );
  }

  if (ev.ops.stale) {
    bullets.push("Ops snapshot is stale (>24h). Revenue risk assessment may be wrong — refresh before acting.");
  }

  if (bullets.length === 0) {
    bullets.push("No elevated revenue-break signals in current evidence. Maintain delivery cadence; do not invent urgency.");
  }

  return { title: "What Can Break Revenue", bullets };
}

function buildCeoAttention(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];
  const cats = changedByCategory(ev.git.changedPaths);

  if (blockingChecks(ev.ops.checks).length > 0) {
    bullets.push("Decide: fix blocking workspace/check failures before any new build work — only you can prioritize customer trust over feature velocity.");
  }

  if (!ev.weekly.snapshotExists && workspaceTruthCheck(ev.ops.checks)?.status !== "BLOCKING") {
    bullets.push(
      `Approve time to generate and review ${ev.weekly.currentWeekId} snapshot for ${ev.weekly.customer} — this is founder-gated delivery, not autonomous cleanup.`,
    );
  }

  if (ev.git.aheadOfMain >= 5) {
    bullets.push(
      `${ev.git.aheadOfMain} commits ahead of main — you own the merge/deploy decision. Unmerged work is invisible revenue.`,
    );
  }

  if (cats.product2.length > 0 || cats.relationshipEngine.length > 0) {
    bullets.push("Stop or redirect in-flight Product 2 / Relationship Engine work — strategic focus is Product 1 CRM Intelligence Layer.");
  }

  if (ev.ops.deployment && !ev.ops.deployment.ciConfigured) {
    bullets.push("CI is not configured — you need a merge gate before scaling customer count.");
  }

  if (bullets.length === 0) {
    bullets.push("No founder-only decisions flagged. Protect calendar for customer proof and brief quality review.");
  }

  return { title: "CEO Attention", bullets };
}

function buildDayStructure(ev: BriefEvidence, money: BriefSection, breakRev: BriefSection): BriefSection {
  const steps: string[] = [];
  const wt = workspaceTruthCheck(ev.ops.checks);

  if (wt?.status === "BLOCKING" || blockingChecks(ev.ops.checks).length > 0) {
    steps.push("Block 1 (90 min): Fix blocking data/check failures — run `npm run crm:audit -- --customer=nicole-lonergan` and address trust-killers.");
  } else if (!ev.weekly.snapshotExists) {
    steps.push("Block 1 (60 min): Generate weekly snapshot — `npm run weekly-state:generate -- --customer=nicole-lonergan`, review output, ship.");
  } else {
    steps.push("Block 1 (45 min): Customer delivery — confirm brief sent/received; capture one outcome note.");
  }

  if (ev.git.aheadOfMain > 0) {
    steps.push("Block 2 (60 min): Merge and deploy path — PR review, promote to main, verify production matches.");
  } else {
    steps.push("Block 2 (60 min): Revenue conversation — pilot pricing, retention check-in, or one new operator outreach.");
  }

  steps.push("Block 3 (90 min): Autonomous work queue only — let Meridian run checks/fixes from the Autonomous Work section.");
  steps.push("Block 4 (hard stop): No new architecture. If tempted, re-read Pushback.");

  if (money.bullets[0]) {
    steps.unshift(`**North star:** ${money.bullets[0].replace(/\*\*/g, "")}`);
  }
  if (breakRev.bullets[0]?.includes("BLOCKING")) {
    steps.unshift("**Guardrail:** Do not ship customer-facing output until workspace truth is clean.");
  }

  return { title: "Recommended Day Structure", bullets: steps };
}

function buildPushback(ev: BriefEvidence): { section: BriefSection; hardThing: string } {
  const cats = changedByCategory(ev.git.changedPaths);
  const wt = workspaceTruthCheck(ev.ops.checks);
  const challenges: string[] = [];
  let hardThing = "";

  if (cats.relationshipEngine.length > 0) {
    hardThing = "investing in the Relationship Engine instead of shipping Product 1 proof to a paying operator.";
    challenges.push(
      `${cats.relationshipEngine.length} changed Relationship Engine path(s) — frozen speculative platform per NO_DRIFT_RULES.`,
    );
  } else if (cats.product2.length > 0) {
    hardThing = "working on Product 2 (LaborTech) when Product 1 has not closed the next retained customer.";
    challenges.push(`${cats.product2.length} Product 2 path(s) in git status — bifurcation doc says v1 is CRM Intelligence Layer.`);
  } else if (cats.opsUi.length > 0 && wt?.status === "BLOCKING") {
    hardThing = "building operator infrastructure while workspace truth is broken — dashboards do not pay invoices.";
    challenges.push("Ops Center / ops UI changes in flight while live workspace truth is BLOCKING.");
  } else if (cats.opsUi.length > 0 && !ev.weekly.snapshotExists && isDeliveryWindow(ev.dayOfWeek)) {
    hardThing = "polishing internal tooling instead of generating and shipping this week's customer brief.";
    challenges.push("Ops infrastructure work during delivery window with no current-week snapshot.");
  } else if (ev.git.dirty && ev.git.changedPaths.length >= 8) {
    hardThing = "accumulating uncommitted surface area instead of finishing one revenue-critical thread.";
    challenges.push(`${ev.git.changedPaths.length} dirty paths — breadth without ship is drift.`);
  } else if (!ev.weekly.snapshotExists && isDeliveryWindow(ev.dayOfWeek) && wt?.status !== "BLOCKING") {
    hardThing = "deferring Monday brief generation when the data is clean enough to ship.";
    challenges.push(`No ${ev.weekly.currentWeekId} snapshot in delivery window — execution gap, not engineering gap.`);
  } else if (ev.git.aheadOfMain >= 10) {
    hardThing = "stacking commits on a feature branch instead of merging and learning from production.";
    challenges.push(`${ev.git.aheadOfMain} commits ahead of main — review debt compounds.`);
  } else if (wt?.status === "BLOCKING") {
    hardThing = "starting new work while customer data still has blocking integrity failures.";
    challenges.push(`Workspace truth: ${wt.detail}`);
  } else {
    hardThing = "assuming activity equals progress without a customer proof event today.";
    challenges.push("No strong drift signal in git/ops evidence — default risk is comfort work.");
  }

  const bullets = [
    `Dylan, the hard thing you are probably avoiding is ${hardThing}`,
    ...challenges,
  ];

  if (!ev.ops.present) {
    bullets.push("You may be avoiding verification — run `npm run ops` before trusting this brief.");
  }

  return { section: { title: "Pushback", bullets }, hardThing };
}

function buildAutonomousWork(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];

  for (const c of [...blockingChecks(ev.ops.checks), ...reviewChecks(ev.ops.checks)]) {
    const script = c.id === "workspace-truth"
      ? "`npm run crm:audit -- --customer=nicole-lonergan`"
      : c.id === "crm-integrity"
        ? "`npm run check-crm-integrity`"
        : "`npm run ops` (see check detail)";
    bullets.push(`${c.label} [${c.status}]: ${c.detail} → ${script}`);
  }

  if (ev.ops.stale) {
    bullets.push("Refresh ops snapshot: `npm run ops` then re-run this brief with `--refresh`.");
  }

  if (bullets.length === 0) {
    bullets.push("Run fixture checks in CI subset: `npm run crm-import:check`, `check-crm-integrity`, `relationship-classification:check` — keep green while you sell.");
  }

  return { title: "Autonomous Work", bullets };
}

function buildStopTouching(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];
  const cats = changedByCategory(ev.git.changedPaths);

  if (cats.relationshipEngine.length > 0) {
    bullets.push(`Relationship Engine (${cats.relationshipEngine.slice(0, 3).join(", ")}${cats.relationshipEngine.length > 3 ? "…" : ""}) — frozen.`);
  }
  if (cats.product2.length > 0) {
    bullets.push(`Product 2 / LaborTech (${cats.product2.slice(0, 3).join(", ")}${cats.product2.length > 3 ? "…" : ""}) — deferred until Product 1 retention proof.`);
  }
  if (cats.frozen.length > 0) {
    bullets.push(`Frozen surfaces (${cats.frozen.slice(0, 3).join(", ")}${cats.frozen.length > 3 ? "…" : ""}) — NO_DRIFT_RULES §1.`);
  }
  if (cats.opsUi.length > 0 && !ev.weekly.snapshotExists) {
    bullets.push("Ops Center UI — stop until current-week brief is generated and shipped.");
  }

  bullets.push("Customer-facing UI changes — not today unless fixing a trust-killer blocking shipment.");
  bullets.push("New architecture, external integrations, calendar/email — out of scope.");

  return { title: "Stop Touching", bullets };
}

function buildProductDrift(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];
  const cats = changedByCategory(ev.git.changedPaths);

  if (cats.relationshipEngine.length > 0) {
    bullets.push("Relationship Engine edits detected — platform speculation ahead of paying-customer proof.");
  }
  if (cats.product2.length > 0) {
    bullets.push("Product 2 paths in working tree — violates Product 1 focus in `docs/product-bifurcation-correction.md`.");
  }
  if (cats.opsUi.length > 0 && workspaceTruthCheck(ev.ops.checks)?.status !== "HEALTHY") {
    bullets.push("Internal ops dashboard work while workspace truth is not HEALTHY — building the cockpit before the engine runs.");
  }
  if (ev.git.changedPaths.some((p) => /^REVIEW_/.test(p))) {
    bullets.push("REVIEW package docs in flight — packaging for external review is not the same as customer revenue.");
  }

  if (bullets.length === 0) {
    bullets.push("No Product 2 / RE / frozen-surface drift detected in current git paths.");
  }

  return { title: "Product Drift", bullets };
}

function buildRisk(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];

  const skipped = ev.ops.checks.filter((c) => c.outcome === "SKIPPED");
  for (const c of skipped) {
    bullets.push(`${c.label} skipped — ${c.detail}`);
  }

  if (ev.ops.overall === "BLOCKING") {
    bullets.push(`Ops overall BLOCKING (${ev.ops.counts?.blocking ?? "?"} signals) — do not scale customer count.`);
  }

  if (ev.git.dirty) {
    bullets.push(`Working tree dirty (${ev.git.changedPaths.length} paths) — bisect and rollback are harder if something breaks in production.`);
  }

  if (!ev.docs.productBifurcation) {
    bullets.push("Evidence gap: `docs/product-bifurcation-correction.md` not found — strategic north star may be unclear to agents.");
  }

  if (bullets.length === 0) {
    bullets.push("No elevated operational risks beyond normal early-stage variance.");
  }

  return { title: "Risk", bullets };
}

function buildTechnicalState(ev: BriefEvidence): BriefSection {
  const bullets: string[] = [];
  const d = ev.ops.deployment;

  bullets.push(
    `Git: \`${ev.git.branch}\` @ \`${ev.git.head}\` · ${ev.git.aheadOfMain} ahead of main · ${ev.git.dirty ? `dirty (${ev.git.changedPaths.length} paths)` : "clean"}`,
  );

  if (ev.ops.present) {
    bullets.push(
      `Ops: ${ev.ops.overall ?? "unknown"} · ${ev.ops.counts?.blocking ?? 0} blocking / ${ev.ops.counts?.review ?? 0} review / ${ev.ops.counts?.healthy ?? 0} healthy · snapshot ${ev.ops.generatedAt ?? "unknown"}${ev.ops.stale ? " (stale)" : ""}`,
    );
  } else {
    bullets.push("Ops: no ops snapshot — run `npm run ops`");
  }

  bullets.push(
    `Weekly state: ${ev.weekly.snapshotExists ? `present for ${ev.weekly.currentWeekId}` : `missing for ${ev.weekly.currentWeekId}`}${ev.weekly.snapshotAgeHours != null ? ` (${Math.round(ev.weekly.snapshotAgeHours)}h old)` : ""}`,
  );

  if (d) {
    bullets.push(`Deployment: ${d.note}`);
  }

  if (ev.git.recentCommits.length > 0) {
    bullets.push(`Recent commits: ${ev.git.recentCommits.slice(0, 3).join(" · ")}`);
  }

  return { title: "Technical State", bullets };
}

function deriveHeadline(money: BriefSection, breakRev: BriefSection, pushbackHardThing: string): string {
  const firstMoney = money.bullets[0] ?? "";
  if (/customer delivery|ship|generate and ship|weekly-state:generate/i.test(firstMoney)) {
    return "Highest leverage today: ship or confirm customer brief delivery — that is the revenue event.";
  }
  if (/data repair|workspace truth|trust-killer|BLOCKING/i.test(firstMoney + breakRev.bullets.join(" "))) {
    return "Highest leverage today: fix blocking workspace data before any new build work.";
  }
  if (/customer proof|pricing|retention/i.test(firstMoney)) {
    return "Highest leverage today: one founder-led customer proof conversation.";
  }
  return `Highest leverage today: confront ${pushbackHardThing.replace(/\.$/, "")}.`;
}

function renderMarkdown(ev: BriefEvidence, headline: string, sections: BriefSection[]): string {
  const lines: string[] = [
    `# Founder Morning Brief — ${ev.dateLabel}`,
    "",
    `**${headline}**`,
    "",
  ];

  for (const s of sections) {
    lines.push(`## ${s.title}`);
    for (const b of s.bullets) {
      lines.push(`- ${b}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_Evidence-only. No secrets. Re-run: `npm run founder:brief -- --refresh`_");
  return lines.join("\n");
}

/** Compose the full brief from collected evidence. */
export function composeBrief(ev: BriefEvidence): ComposedBrief {
  const money = buildWhatMakesMoney(ev);
  const breakRev = buildWhatCanBreakRevenue(ev);
  const ceo = buildCeoAttention(ev);
  const day = buildDayStructure(ev, money, breakRev);
  const { section: pushback, hardThing } = buildPushback(ev);
  const autonomous = buildAutonomousWork(ev);
  const stop = buildStopTouching(ev);
  const drift = buildProductDrift(ev);
  const risk = buildRisk(ev);
  const technical = buildTechnicalState(ev);

  const sections = [
    money,
    breakRev,
    ceo,
    day,
    pushback,
    autonomous,
    stop,
    drift,
    risk,
    technical,
  ];

  const headline = deriveHeadline(money, breakRev, hardThing);
  const markdown = renderMarkdown(ev, headline, sections);

  return { headline, sections, markdown };
}
