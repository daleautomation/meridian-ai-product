/**
 * Brookside targeted enrichment — CLI runner.
 *
 * Loads a generated Recovery Brief, optionally a public-records CSV, and
 * a per-customer ledger; runs the pure orchestrator from
 * `lib/enrichment/workflows`; writes an audit JSON and the updated
 * ledger back to disk.
 *
 * Usage:
 *   npx tsx scripts/run-targeted-enrichment.ts \
 *     --customer=nicole-lonergan \
 *     --brief=data/recovery-briefs/nicole-lonergan/2026-W21.json \
 *     --public-records=data/public-records/king-wa.csv \
 *     --now=2026-05-22T12:00:00.000Z \
 *     [--cap=25] \
 *     [--recency-days=30] \
 *     [--ledger=data/enrichment/nicole-lonergan/ledger.json] \
 *     [--out=data/enrichment/nicole-lonergan/2026-W21.json]
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  buildParcelIndex,
  parsePublicRecordCsv,
  type ParcelIndex,
} from "@/lib/enrichment/public-records";
import {
  DEFAULT_POLICY,
  emptyLedger,
  ledgerFromFile,
  ledgerToFile,
  normalizePolicy,
  runTargetedEnrichment,
  type EnrichmentLedger,
  type EnrichmentLedgerFile,
  type EnrichmentPolicy,
} from "@/lib/enrichment/workflows";
import type { RecoveryBrief } from "@/lib/recovery/brief";
import brooksideConfig from "@/config/signals/nicole-lonergan";
import labortechConfig from "@/config/signals/labortech";

function readArgs(): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args.set(key, rest.join("=") || "true");
  }
  return args;
}

function parseIntegerArg(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function readJsonOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function workspaceConfigFor(customer: string) {
  if (customer === "nicole-lonergan") return brooksideConfig;
  if (customer === "labortech") return labortechConfig;
  throw new Error(
    `Unknown customer="${customer}". Targeted enrichment supports nicole-lonergan or labortech.`,
  );
}

async function main(): Promise<void> {
  const args = readArgs();
  const customer = args.get("customer");
  const briefPath = args.get("brief");
  const nowIso = args.get("now");

  if (!customer || !briefPath || !nowIso) {
    throw new Error(
      "Usage: npx tsx scripts/run-targeted-enrichment.ts --customer=<slug> --brief=<path> --now=<iso> " +
        "[--public-records=<csv>] [--cap=N] [--recency-days=N] [--ledger=<path>] [--out=<path>]",
    );
  }

  const absoluteBrief = path.resolve(briefPath);
  const brief = await readJsonOrNull<RecoveryBrief>(absoluteBrief);
  if (!brief) throw new Error(`Brief not found at ${absoluteBrief}`);

  const publicRecordsArg = args.get("public-records");
  let publicRecordIndex: ParcelIndex | null = null;
  let publicRecordSource: string | null = null;
  if (publicRecordsArg) {
    const absolutePr = path.resolve(publicRecordsArg);
    const csv = await fs.readFile(absolutePr, "utf8");
    const ingest = parsePublicRecordCsv(csv);
    publicRecordIndex = buildParcelIndex(ingest.records);
    publicRecordSource = path.relative(process.cwd(), absolutePr);
    console.log(
      `[targeted-enrichment] public-record ingest: admitted=${ingest.records.length} ` +
        `rejected=${ingest.rejections.length} sources=[${ingest.sourceNames.join(",")}]`,
    );
  }

  const ledgerPath =
    args.get("ledger") ??
    path.join("data", "enrichment", customer, "ledger.json");
  const absoluteLedger = path.resolve(ledgerPath);
  const ledgerFile = await readJsonOrNull<EnrichmentLedgerFile>(absoluteLedger);
  const ledger: EnrichmentLedger = ledgerFile ? ledgerFromFile(ledgerFile) : emptyLedger();

  const policy: EnrichmentPolicy = normalizePolicy({
    cap: parseIntegerArg(args.get("cap"), DEFAULT_POLICY.cap),
    recencyWindowDays: parseIntegerArg(
      args.get("recency-days"),
      DEFAULT_POLICY.recencyWindowDays,
    ),
    allowAddressOnlyMatch: args.get("address-only") !== "false",
    requireStrongAddress: args.get("require-strong-address") !== "false",
  });

  const { audit, nextLedger } = runTargetedEnrichment({
    customer,
    brief,
    briefSource: path.relative(process.cwd(), absoluteBrief),
    publicRecordIndex,
    publicRecordSource,
    workspaceConfig: workspaceConfigFor(customer),
    ledger,
    policy,
    nowIso,
  });

  const outPath =
    args.get("out") ??
    path.join("data", "enrichment", customer, `${brief.week}.json`);
  const absoluteOut = path.resolve(outPath);
  await fs.mkdir(path.dirname(absoluteOut), { recursive: true });
  await fs.writeFile(absoluteOut, JSON.stringify(audit, null, 2), "utf8");
  await fs.mkdir(path.dirname(absoluteLedger), { recursive: true });
  await fs.writeFile(
    absoluteLedger,
    JSON.stringify(ledgerToFile(nextLedger, customer), null, 2),
    "utf8",
  );

  console.log(
    `[targeted-enrichment] customer=${customer} brief=${brief.week} ` +
      `enriched=${audit.summary.enriched} skipped=${audit.summary.skipped} ` +
      `failed=${audit.summary.failed} enqueued=${audit.summary.enqueued}`,
  );
  console.log(`[targeted-enrichment] audit -> ${path.relative(process.cwd(), absoluteOut)}`);
  console.log(`[targeted-enrichment] ledger -> ${path.relative(process.cwd(), absoluteLedger)}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[targeted-enrichment] failed");
  console.error(message);
  process.exit(1);
});
