// Meridian Command — the Daily Command Brief (Meridian Home).
//
// Assembles Beliefs + Recommendations into ONE page. No graphs, no widgets, no
// fabricated numbers. Revenue "forecast" and capital summary are ordinal/honest
// per MERIDIAN_TRUST_MODEL.md — they say "insufficient calibrated evidence" rather
// than inventing dollars. Every line traces to observed reality.

import type { Belief } from "@/lib/beliefs/types";
import type { Recommendation } from "@/lib/beliefs/recommend";

export interface DailyBrief {
  generatedAt: string;
  owner: string;
  realitySummary: { totalBeliefs: number; changed: number; newlyFormed: number };
  topActions: Recommendation[]; // up to 3
  momentumRising: Array<{ label: string; claim: string }>;
  momentumFalling: Array<{ label: string; claim: string }>;
  companiesToWatch: Array<{ company: string; reason: string }>;
  meetingsRequiringAction: Array<{ label: string; detail: string }>;
  waitingOnMe: Array<{ label: string; since: string }>;
  waitingOnThem: Array<{ label: string; since: string }>;
  newOpportunities: Array<{ label: string; claim: string }>;
  risks: Array<{ label: string; detail: string }>;
  blocked: Array<{ label: string; detail: string }>;
  revenueOutlook: string; // ordinal + honest
  capitalSummary: string[]; // qualitative
}

const ACTIVE_KINDS = new Set(["career", "sales", "consulting", "partnership", "referral"]);

export function buildDailyBrief(allBeliefs: Belief[], recs: Recommendation[], owner: string, generatedAt: string): DailyBrief {
  // Cold one-way inbound (newsletters, cold blasts, leasing agents) is observed and
  // believed, but excluded from every surfaced section — it is not a relationship.
  const beliefs = allBeliefs.filter((b) => b.engagement !== "inbound_cold" && b.engagement !== "none");
  const changed = beliefs.filter((b) => b.changeLog !== "no change since last scan" && b.momentumDelta !== "new").length;
  const newlyFormed = beliefs.filter((b) => b.momentumDelta === "new").length;

  const rising = beliefs.filter((b) => b.momentumDelta === "rising" || (b.momentumDelta === "new" && (b.momentum === "accelerating" || b.momentum === "warm")));
  const falling = beliefs.filter((b) => b.momentumDelta === "falling" || b.momentum === "cooling");

  const waitingMe = beliefs.filter((b) => b.waitingOn === "me" && b.stage !== "rejected");
  const waitingThem = beliefs.filter((b) => b.waitingOn === "them" && !["rejected", "closed_lost"].includes(b.stage));

  const meetings = beliefs.filter((b) => b.stage === "meeting_scheduled" || b.stage === "meeting_completed");
  const newOpps = beliefs.filter((b) => b.momentumDelta === "new" && ["discovered", "contacted", "waiting_on_them", "referral"].includes(b.stage) && ACTIVE_KINDS.has(b.kind));
  const risks = beliefs.filter((b) => b.stage === "stalled" || b.status === "blocked");
  const dead = beliefs.filter((b) => b.stage === "rejected" || b.momentum === "dead");

  const activeRevenue = beliefs.filter((b) => ACTIVE_KINDS.has(b.kind) && !["rejected", "closed_lost"].includes(b.stage) && b.momentum !== "dead");
  const byKind = countBy(activeRevenue.map((b) => b.kind));

  const revenueOutlook =
    `${activeRevenue.length} active revenue-relevant relationships in motion ` +
    `(${Object.entries(byKind).map(([k, n]) => `${k}: ${n}`).join(", ") || "none"}). ` +
    `No dollar forecast — insufficient calibrated outcome history to price honestly (per the Trust Model). ` +
    `Ranking is ordinal until outcomes accumulate.`;

  const capitalSummary = [
    `Time: ${recs.length} live moves competing for today's attention — top ${Math.min(3, recs.length)} below.`,
    `Relationship: ${beliefs.length} relationships tracked; ${rising.length} gaining momentum, ${falling.length} fading.`,
    `Momentum (perishable): ${beliefs.filter((b) => b.momentum === "accelerating").length} hot, ` +
      `${falling.length} cooling and at risk of being wasted.`,
    `Financial: not yet calibrated — outcomes will unlock this.`,
    dead.length ? `Closed/dead this cycle: ${dead.length} (kept warm for future chains).` : `No closed/dead items this cycle.`,
  ];

  return {
    generatedAt,
    owner,
    realitySummary: { totalBeliefs: beliefs.length, changed, newlyFormed },
    topActions: recs.slice(0, 3),
    momentumRising: rising.map((b) => ({ label: b.subjectLabel, claim: b.claim })),
    momentumFalling: falling.map((b) => ({ label: b.subjectLabel, claim: b.claim })),
    companiesToWatch: dedupeByCompany(beliefs).map((b) => ({ company: b.company ?? b.subjectLabel, reason: b.claim })),
    meetingsRequiringAction: meetings.map((b) => ({ label: b.subjectLabel, detail: `${b.stage.replace(/_/g, " ")} — ${b.claim}` })),
    waitingOnMe: waitingMe.map((b) => ({ label: b.subjectLabel, since: b.lastActivityAt.slice(0, 10) })),
    waitingOnThem: waitingThem.map((b) => ({ label: b.subjectLabel, since: b.lastActivityAt.slice(0, 10) })),
    newOpportunities: newOpps.map((b) => ({ label: b.subjectLabel, claim: b.claim })),
    risks: risks.map((b) => ({ label: b.subjectLabel, detail: b.claim })),
    blocked: beliefs.filter((b) => b.status === "blocked").map((b) => ({ label: b.subjectLabel, detail: b.claim })),
    revenueOutlook,
    capitalSummary,
  };
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function dedupeByCompany(beliefs: Belief[]): Belief[] {
  const seen = new Set<string>();
  const out: Belief[] = [];
  for (const b of beliefs) {
    if (["rejected", "closed_lost"].includes(b.stage) || b.momentum === "dead") continue;
    const c = (b.company ?? b.subjectLabel).toLowerCase();
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(b);
  }
  return out.slice(0, 6);
}

/** Render the one-page brief as plain text (the same model backs the Home page). */
export function renderBrief(brief: DailyBrief): string {
  const L: string[] = [];
  const bar = "━".repeat(52);
  L.push(bar);
  L.push(`GOOD MORNING ${brief.owner.toUpperCase()}`);
  L.push("");
  L.push(`Reality changed overnight. ${brief.realitySummary.newlyFormed} new, ${brief.realitySummary.changed} updated, ${brief.realitySummary.totalBeliefs} tracked.`);
  L.push("");
  section(L, "HIGHEST-LEVERAGE ACTIONS", brief.topActions.map((r, i) =>
    `${i + 1}. ${r.action}\n     why: ${r.why}\n     opportunity cost: ${r.opportunityCost}\n     confidence: ${r.confidence} · ${r.changeLog}`));
  section(L, "MOMENTUM RISING", brief.momentumRising.map((m) => `• ${m.label} — ${m.claim}`));
  section(L, "MOMENTUM FADING (perishable — act or lose)", brief.momentumFalling.map((m) => `• ${m.label} — ${m.claim}`));
  section(L, "MEETINGS REQUIRING ACTION", brief.meetingsRequiringAction.map((m) => `• ${m.label} — ${m.detail}`));
  section(L, "WAITING ON ME", brief.waitingOnMe.map((w) => `• ${w.label} (since ${w.since})`));
  section(L, "WAITING ON THEM", brief.waitingOnThem.map((w) => `• ${w.label} (since ${w.since})`));
  section(L, "NEW OPPORTUNITIES", brief.newOpportunities.map((o) => `• ${o.label} — ${o.claim}`));
  section(L, "RISKS / STALLED", brief.risks.map((r) => `• ${r.label} — ${r.detail}`));
  section(L, "COMPANIES TO WATCH", brief.companiesToWatch.map((c) => `• ${c.company}`));
  L.push("");
  L.push("REVENUE OUTLOOK");
  L.push(`  ${brief.revenueOutlook}`);
  L.push("");
  L.push("PROFESSIONAL CAPITAL");
  brief.capitalSummary.forEach((c) => L.push(`  • ${c}`));
  L.push(bar);
  return L.join("\n");
}

function section(L: string[], title: string, lines: string[]): void {
  if (lines.length === 0) return;
  L.push(`${title}`);
  lines.forEach((l) => L.push(`  ${l}`));
  L.push("");
}
