/**
 * Generate the Monday workspace snapshot for a customer.
 *
 * Usage:
 *   tsx scripts/generate-weekly-state.ts --customer=nicole-lonergan [--now=ISO]
 *
 * Output:
 *   data/weekly-state/<customer>/<weekId>.json       — full snapshot
 *   data/weekly-state/<customer>/<weekId>.email.txt — plain-text activation
 *
 * Founder-runnable. Pure I/O around the deterministic
 * `buildWeeklyState` builder. No email sending, no HTML, no AI.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { getWorkspaceBySlug } from "@/config/workspaces";
import { listContactsByWorkspace } from "@/lib/crm-import/store";
import { readCustomerOutcomes } from "@/lib/recovery/outcomes/persistence";
import { buildResurfacingBuckets } from "@/lib/relationship-intelligence/resurfacing";
import { buildPersonalWorkspaceModel } from "@/lib/personal-workspace/workspace";
import { buildWeeklyState, isoWeekId } from "@/lib/personal-workspace/weeklyState";
import type { CrmContactRecord } from "@/lib/crm-import/types";

interface CliArgs {
  customer: string;
  now: Date;
  outputRoot: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let customer = "";
  let nowIso: string | null = null;
  let outputRoot = path.join(process.cwd(), "data", "weekly-state");
  for (const arg of argv) {
    if (arg.startsWith("--customer=")) customer = arg.slice("--customer=".length);
    else if (arg.startsWith("--now=")) nowIso = arg.slice("--now=".length);
    else if (arg.startsWith("--output-root=")) outputRoot = arg.slice("--output-root=".length);
  }
  if (!customer) {
    throw new Error("--customer=<slug> is required (e.g. --customer=nicole-lonergan)");
  }
  const now = nowIso ? new Date(nowIso) : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error(`--now must be a valid ISO instant; got "${nowIso}"`);
  }
  return { customer, now, outputRoot };
}

function buildWorkspaceUrl(slug: string): string {
  const base = (process.env.MERIDIAN_WORKSPACE_URL ?? "https://www.meridianai.work").replace(/\/$/, "");
  return `${base}/personal?workspace=${encodeURIComponent(slug)}`;
}

function pickResurfaceHighlight(
  buckets: ReturnType<typeof buildResurfacingBuckets>,
): { contactId: string; name: string; bucketLabel: string; whyNow: string } | null {
  // Same priority order surfaced in the existing console resurfacing
  // strip: overdue → forgotten high-value → stale reengage → dormant.
  const order = [
    "overdue_follow_ups",
    "forgotten_high_value",
    "stale_reengage",
    "dormant_high_frequency",
  ];
  for (const bucketId of order) {
    const bucket = buckets.find((b) => b.id === bucketId);
    if (!bucket || bucket.contacts.length === 0) continue;
    const first = bucket.contacts[0];
    return {
      contactId: first.contactId,
      name: first.name ?? first.contactId,
      bucketLabel: bucket.label,
      whyNow: first.whyNow ?? "Resurfaced relationship",
    };
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspace = getWorkspaceBySlug(args.customer);
  if (!workspace) {
    throw new Error(`Unknown workspace slug: ${args.customer}`);
  }
  const weekId = isoWeekId(args.now);
  const customerDir = path.join(args.outputRoot, args.customer);
  await fs.mkdir(customerDir, { recursive: true });

  const contacts: CrmContactRecord[] = await listContactsByWorkspace(args.customer);
  const resurfacingBuckets = buildResurfacingBuckets(contacts);
  const model = buildPersonalWorkspaceModel({
    workspace,
    user: {
      id: "weekly-state-generator",
      name: "Weekly State Generator",
      accessRole: "admin_operator",
      modules: [],
      geo: [],
      workspaces: [args.customer],
    },
    crmContacts: contacts,
    resurfacingBuckets,
    generatedAt: args.now.toISOString(),
  });

  const outcomes = await readCustomerOutcomes(args.customer);
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  // Pass the full rank-ordered contact list so the rule engine has
  // room to skip excluded contacts (meeting_booked, closed_*,
  // wrong_contact, deferred follow_up_later) and backfill from
  // further down the list. buildWeeklyState applies the outcome rules
  // and then slices to its WEEKLY_PRIORITY_LIMIT.
  const state = buildWeeklyState({
    workspaceSlug: args.customer,
    workspaceDisplayName: workspace.branding?.displayName ?? workspace.name,
    workspaceUrl: buildWorkspaceUrl(args.customer),
    priorityCards: model.allContacts,
    contactsById,
    outcomes,
    resurfacingHighlight: pickResurfaceHighlight(resurfacingBuckets),
    now: args.now,
  });

  const stateFile = path.join(customerDir, `${weekId}.json`);
  const emailFile = path.join(customerDir, `${weekId}.email.txt`);
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
  await fs.writeFile(
    emailFile,
    `Subject: ${state.activationEmail.subject}\n\n${state.activationEmail.body}\n`,
    "utf8",
  );

  console.log(`[weekly-state] wrote ${stateFile}`);
  console.log(`[weekly-state] wrote ${emailFile}`);
  console.log(
    `[weekly-state] customer=${args.customer} weekId=${weekId} ` +
      `priorities=${state.priorities.length} ` +
      `resurface=${state.resurfacedRelationship?.name ?? "(none)"} ` +
      `insightKind=${state.continuityInsight.kind} ` +
      `outcomes7d=${state.outcomeRollup.outcomesCaptured}`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[weekly-state] failed");
  console.error(message);
  process.exit(1);
});
