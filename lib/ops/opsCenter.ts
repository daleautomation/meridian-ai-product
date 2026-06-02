// Meridian Operations Center — pure status model.
//
// This module ONLY aggregates the pass/fail of EXISTING validation
// scripts and a few read-only git/deployment facts into one operator
// status: BLOCKING / REVIEW / HEALTHY. It is not a scoring system, not
// an intelligence system, and never reads Neon or product logic — the
// runner (scripts/ops-center.ts) executes the existing checks and feeds
// their outcomes here.
//
// Pure: no I/O, no child_process, no Date.now() (caller injects time).

export type OpsStatus = "HEALTHY" | "REVIEW" | "BLOCKING";

/** Outcome of running one existing check. */
export type CheckOutcome =
  | "PASS"          // exit 0
  | "FAIL"          // nonzero exit (other than usage)
  | "NEEDS_CONFIG"  // exit 2 / usage error — the check needs args/env
  | "SKIPPED";      // not run (e.g. Neon required but DATABASE_URL absent)

export type OpsCategory =
  | "import"
  | "integrity"
  | "prioritization"
  | "opportunity"
  | "deployment"
  | "ui";

export interface OpsCheckDef {
  id: string;
  label: string;
  /** Existing npm script to run, or null for an inline-computed check. */
  npmScript: string | null;
  category: OpsCategory;
  /** Severity when this check FAILS. */
  onFail: "BLOCKING" | "REVIEW";
  /** True when the check reads Neon (skipped if DATABASE_URL is absent). */
  needsNeon?: boolean;
  /**
   * How the runner derives the outcome:
   *   "exit"    — exit code (default; existing logic checks).
   *   "verdict" — run the script and map its OWN printed verdict to a
   *               status via a pure parser (e.g. crm:audit, which always
   *               exits 0 but prints a Founder verdict). Live-data signal.
   */
  kind?: "exit" | "verdict";
  /** Workspace slug passed as `-- --customer=<slug>` (verdict checks). */
  customerArg?: string;
}

export interface OpsCheckResult {
  id: string;
  label: string;
  category: OpsCategory;
  outcome: CheckOutcome;
  status: OpsStatus;
  detail: string;
  durationMs?: number;
}

export interface OpsDeployment {
  branch: string;
  head: string;
  aheadOfMain: number;
  ciConfigured: boolean;
  productionTracksMain: boolean;
  note: string;
}

export interface OpsReport {
  generatedAt: string;
  overall: OpsStatus;
  counts: { blocking: number; review: number; healthy: number };
  deployment: OpsDeployment;
  checks: OpsCheckResult[];
}

const RANK: Record<OpsStatus, number> = { HEALTHY: 0, REVIEW: 1, BLOCKING: 2 };

/**
 * The catalog of EXISTING checks the Operations Center consolidates.
 * Every `npmScript` already exists in package.json; nothing new is
 * computed here. Arg-requiring tools (e.g. check-import-quality) are
 * intentionally excluded — they cannot run unattended.
 */
export const OPS_CHECKS: OpsCheckDef[] = [
  // ── Import integrity (regressions here break the customer's book) ──
  { id: "crm-import", label: "CRM import pipeline", npmScript: "crm-import:check", category: "import", onFail: "BLOCKING" },
  { id: "reimport-survival", label: "Re-import dedupe survival", npmScript: "check-reimport-survival", category: "import", onFail: "BLOCKING", needsNeon: true },
  { id: "column-mapping", label: "Column mapping (no false claims)", npmScript: "column-mapping:check", category: "import", onFail: "REVIEW" },
  { id: "phone-mapping", label: "Phone mapping (mobile preferred)", npmScript: "phone-mapping:check", category: "import", onFail: "REVIEW" },

  // ── Workspace / contamination / duplicates (logic, fixtures) ──
  { id: "crm-integrity", label: "Workspace contamination & duplicates", npmScript: "check-crm-integrity", category: "integrity", onFail: "BLOCKING", needsNeon: true },

  // ── LIVE Workspace Truth — Signal #1 (Operational Truth) ──
  // Runs crm:audit against the real Neon workspace and maps its OWN
  // Founder verdict to a status. crm:audit always exits 0 and prints a
  // textual verdict, so kind:"verdict" parses that verdict rather than
  // trusting the exit code. Read-only; never writes Neon.
  {
    id: "workspace-truth",
    label: "Live workspace truth (crm:audit on Neon)",
    npmScript: "crm:audit",
    category: "integrity",
    onFail: "BLOCKING",
    needsNeon: true,
    kind: "verdict",
    customerArg: "nicole-lonergan",
  },

  // ── Prioritization ──
  { id: "relationship-classification", label: "Relationship classification", npmScript: "relationship-classification:check", category: "prioritization", onFail: "BLOCKING" },
  { id: "personal-workspace", label: "Personal workspace model", npmScript: "personal-workspace:check", category: "prioritization", onFail: "REVIEW", needsNeon: true },

  // ── Opportunity engine (gated; must stay market-evidence-only) ──
  { id: "opportunity-scoring", label: "Opportunity scoring gate", npmScript: "check-opportunity-scoring", category: "opportunity", onFail: "REVIEW" },
  { id: "opportunity-pipeline", label: "Opportunity pipeline", npmScript: "check-opportunity-pipeline", category: "opportunity", onFail: "REVIEW", needsNeon: true },

  // ── UI / deployment verification ──
  { id: "autonoma-spec", label: "Autonoma UI test spec present", npmScript: "autonoma:nicole:check-spec", category: "ui", onFail: "REVIEW" },
];

/**
 * Map crm:audit's OWN printed "Founder verdict" to an ops status.
 * crm:audit always exits 0, so we never trust its exit code — we read
 * the verdict it already computes against the live Neon workspace.
 *
 * Pure. Fail-safe: any unrecognized output → REVIEW, never HEALTHY, so
 * the board can never overstate live workspace health.
 */
export function parseCrmAuditVerdict(stdout: string): {
  status: OpsStatus;
  outcome: CheckOutcome;
  detail: string;
} {
  const text = stdout ?? "";

  // Empty / misconfigured workspace — cannot verify.
  if (/No contacts found for this workspace/i.test(text)) {
    return { status: "REVIEW", outcome: "NEEDS_CONFIG", detail: "no contacts in workspace — cannot verify (no import or storage misconfigured)" };
  }

  // Clean: crm:audit explicitly clears the workspace.
  if (/No blocking issues detected/i.test(text)) {
    return { status: "HEALTHY", outcome: "PASS", detail: "no blocking issues — workspace data-integrity clean" };
  }

  // Founder-verdict bullets (lines like "  • BLOCKING: ...").
  const bullets = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("• "))
    .map((l) => l.slice(2).trim());

  const blocking = bullets.find((b) => /^BLOCKING:/i.test(b));
  if (blocking) {
    return { status: "BLOCKING", outcome: "FAIL", detail: blocking.slice(0, 160) };
  }

  if (bullets.length > 0) {
    // Non-blocking advisories (majority-weak, pause-provider, empty
    // substrate). Real findings, but not ship-blockers → REVIEW.
    return { status: "REVIEW", outcome: "NEEDS_CONFIG", detail: bullets[0].slice(0, 160) };
  }

  // No recognizable verdict — fail safe.
  return { status: "REVIEW", outcome: "NEEDS_CONFIG", detail: "crm:audit verdict not recognized — failing safe to REVIEW" };
}

/** Resolve a single check's outcome to a status. */
export function resolveCheckStatus(def: OpsCheckDef, outcome: CheckOutcome): OpsStatus {
  switch (outcome) {
    case "PASS":
      return "HEALTHY";
    case "FAIL":
      return def.onFail;
    case "NEEDS_CONFIG":
    case "SKIPPED":
      // Not a failure, but verification is incomplete → operator should know.
      return "REVIEW";
  }
}

/** Severity of a deployment posture (read-only git facts only). */
export function deploymentStatus(d: Pick<OpsDeployment, "ciConfigured" | "productionTracksMain">): OpsStatus {
  // Missing CI is the keystone gap → REVIEW. Production not tracking main
  // is a real fragility → REVIEW. Neither is BLOCKING on its own.
  if (!d.ciConfigured || !d.productionTracksMain) return "REVIEW";
  return "HEALTHY";
}

/** Highest severity across all signals = the operator's overall status. */
export function classifyOverall(checks: OpsCheckResult[], deployment: OpsStatus): OpsStatus {
  let worst: OpsStatus = "HEALTHY";
  for (const c of checks) if (RANK[c.status] > RANK[worst]) worst = c.status;
  if (RANK[deployment] > RANK[worst]) worst = deployment;
  return worst;
}

export function summarizeCounts(checks: OpsCheckResult[], deployment: OpsStatus): OpsReport["counts"] {
  const all: OpsStatus[] = [...checks.map((c) => c.status), deployment];
  return {
    blocking: all.filter((s) => s === "BLOCKING").length,
    review: all.filter((s) => s === "REVIEW").length,
    healthy: all.filter((s) => s === "HEALTHY").length,
  };
}
