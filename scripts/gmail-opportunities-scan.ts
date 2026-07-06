// Meridian Command — Gmail opportunity scan CLI.
//
// Reads a batch of Gmail threads (produced by Claude via the Gmail MCP, or the
// bundled fixture), runs the deterministic scanner, and prints opportunities in
// the required format. Read-only by default; --write persists the staging store
// (and the Opportunity Graph when Postgres is available).
//
// Usage:
//   npm run gmail:opportunities:scan                 # dry-run over the fixture
//   npm run gmail:opportunities:scan -- --batch data/gmail/inbox-batch.json
//   npm run gmail:opportunities:scan -- --batch <f> --write
//
// The batch file is a GmailThreadBatch (or the raw {threads:[...]} from the MCP).

import { promises as fs } from "node:fs";
import path from "node:path";
import { scanThreads } from "../lib/gmail/scan";
import { loadGmailStore, saveGmailStore } from "../lib/gmail/persist";
import { persistGmailToGraph } from "../lib/gmail/graphBridge";
import type { DetectedOpportunity, GmailThreadBatch } from "../lib/gmail/types";

const OWNER_EMAILS = (process.env.MERIDIAN_OWNER_EMAILS ?? "dylandinkc@gmail.com")
  .split(",").map((s) => s.trim()).filter(Boolean);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadBatch(): Promise<GmailThreadBatch> {
  const file = arg("--batch") ?? (process.argv.includes("--fixture") || !arg("--batch")
    ? "fixtures/gmail/sample-threads.json" : undefined);
  const raw = JSON.parse(await fs.readFile(path.join(process.cwd(), file!), "utf8"));
  const threads = raw.threads ?? raw; // accept full batch or raw thread array
  return {
    fetchedAt: raw.fetchedAt ?? new Date().toISOString(),
    ownerEmails: raw.ownerEmails ?? OWNER_EMAILS,
    queries: raw.queries ?? [],
    threads,
  };
}

function line(label: string, value: string): string {
  return `    ${label.padEnd(16)} ${value}`;
}

function render(opp: DetectedOpportunity, idx: number): string {
  const lines = [
    `\n[${idx + 1}] ${opp.name}   (${opp.kind})`,
    line("Company", `${opp.company}${opp.companyDomain ? ` (${opp.companyDomain})` : ""}`),
    line("People", opp.people.join(", ") || "—"),
    line("Stage", opp.stage),
    line("Status", opp.status),
    line("Momentum", opp.momentum),
    line("Last inbound", opp.lastInboundAt?.slice(0, 10) ?? "—"),
    line("Last outbound", opp.lastOutboundAt?.slice(0, 10) ?? "—"),
    line("Waiting on", opp.waitingOn),
    line("Next action", opp.nextAction),
    line("Why now", opp.whyNow),
    line("Confidence", `${opp.confidence} (relevance ${opp.relevance}/100)`),
    line("What changed", opp.whatChanged),
    line("Why this stage", opp.reason),
    `    Evidence:`,
    ...opp.evidence.map(
      (e) => `      • [${e.direction}] ${e.date.slice(0, 10)} ${e.sender} — "${e.subject}"\n        ${e.excerpt}\n        (thread ${e.threadId} / msg ${e.messageId})`,
    ),
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const nowMs = process.env.MERIDIAN_GMAIL_NOW ? Date.parse(process.env.MERIDIAN_GMAIL_NOW) : Date.now();

  const batch = await loadBatch();
  const prev = (await loadGmailStore()).opportunities;
  const result = scanThreads(batch, { nowMs, previous: prev });

  console.log(`\n=== Meridian Gmail Opportunity Scan ===`);
  console.log(`scannedAt=${result.scannedAt}  threads=${result.threadsScanned}  ` +
    `opportunities=${result.opportunities.length}  dropped(noise)=${result.droppedAsNoise}  unknown=${result.unknown}`);
  console.log(`owner=${batch.ownerEmails.join(",")}  mode=${write ? "WRITE" : "DRY-RUN"}`);

  result.opportunities.forEach((o, i) => console.log(render(o, i)));

  if (!write) {
    console.log(`\n(dry-run — nothing written. Re-run with --write to persist.)`);
    return;
  }

  const ok = await saveGmailStore(result.opportunities, result.scannedAt);
  const graph = await persistGmailToGraph(result.opportunities, result.scannedAt);
  console.log(`\n[write] staging=${ok ? "saved data/gmail/opportunities.json" : "FAILED (fs)"}  ` +
    `graph=${graph.persisted ? `persisted ${graph.nodes} nodes / ${graph.edges} edges` : `skipped (${graph.reason})`}`);
}

main().catch((err) => {
  console.error("[gmail:scan] failed", err);
  process.exitCode = 1;
});
