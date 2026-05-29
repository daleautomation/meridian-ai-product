/**
 * King County Assessor + Recorder → unified public-records CSV.
 *
 * Reads two raw CSV exports, runs the pure deterministic joiner, and
 * writes:
 *   • data/public-records/king-wa.csv      (joined output)
 *   • data/public-records/king-wa.audit.json (rejections + counts)
 *   • a SHA-256 hash of the CSV is logged to stdout for hash-pinning
 *
 * Usage:
 *   npx tsx scripts/join-king-county-records.ts \
 *     --assessor=data/raw/king-county/assessor.csv \
 *     --recorder=data/raw/king-county/recorder.csv \
 *     --observed-at=2026-05-22T00:00:00.000Z \
 *     [--out=data/public-records/king-wa.csv] \
 *     [--audit=data/public-records/king-wa.audit.json] \
 *     [--source=county_recorder:king_wa] \
 *     [--record-url-template=https://blue.kingcounty.com/...?ParcelNbr={parcelId}]
 *
 * Output CSV is byte-stable for identical inputs (verified by
 * `npm run king-county:check`).
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  joinKingCountyRecords,
  serializeJoinedRowsToCsv,
  type AssessorRow,
  type RecorderRow,
} from "@/lib/enrichment/public-records/king-county";

type RawRow = Record<string, string | undefined>;

function readArgs(): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args.set(key, rest.join("=") || "true");
  }
  return args;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        buf += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  out.push(buf.trim());
  return out;
}

function parseCsv(text: string): RawRow[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.every((c) => c === "")) continue;
    const row: RawRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

async function main(): Promise<void> {
  const args = readArgs();
  const assessorPath = args.get("assessor");
  const recorderPath = args.get("recorder");
  const observedAt = args.get("observed-at");
  const outPath = args.get("out") ?? "data/public-records/king-wa.csv";
  const auditPathArg = args.get("audit");
  const sourceName = args.get("source");
  const recordUrlTemplate = args.get("record-url-template");

  if (!assessorPath || !recorderPath || !observedAt) {
    throw new Error(
      "Usage: npx tsx scripts/join-king-county-records.ts " +
        "--assessor=<csv> --recorder=<csv> --observed-at=<iso> " +
        "[--out=<csv>] [--audit=<json>] [--source=<label>] " +
        "[--record-url-template=<url with {parcelId}>]",
    );
  }

  const assessorText = await fs.readFile(path.resolve(assessorPath), "utf8");
  const recorderText = await fs.readFile(path.resolve(recorderPath), "utf8");
  const assessor = parseCsv(assessorText) as AssessorRow[];
  const recorder = parseCsv(recorderText) as RecorderRow[];

  const { rows, audit } = joinKingCountyRecords({
    assessor,
    recorder,
    observedAt,
    sourceName,
    recordUrlTemplate,
  });

  const csv = serializeJoinedRowsToCsv(rows);
  const csvHash = createHash("sha256").update(csv).digest("hex");

  const outResolved = path.resolve(outPath);
  await fs.mkdir(path.dirname(outResolved), { recursive: true });
  await fs.writeFile(outResolved, csv, "utf8");

  const auditPath = auditPathArg ?? outResolved.replace(/\.csv$/, ".audit.json");
  const auditAbs = path.resolve(auditPath);
  await fs.mkdir(path.dirname(auditAbs), { recursive: true });
  await fs.writeFile(
    auditAbs,
    JSON.stringify(
      {
        joinedAt: observedAt,
        csvHash,
        ...audit,
      },
      null,
      2,
    ),
    "utf8",
  );

  // eslint-disable-next-line no-console
  console.log(
    `[king-county] accepted=${audit.acceptedRows} rejected=${audit.rejectedRows} ` +
      `duplicates=${audit.duplicateParcelCount} orphans=${audit.orphanRecorderCount}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[king-county] hash=${csvHash}`);
  // eslint-disable-next-line no-console
  console.log(`[king-county] csv   -> ${path.relative(process.cwd(), outResolved)}`);
  // eslint-disable-next-line no-console
  console.log(`[king-county] audit -> ${path.relative(process.cwd(), auditAbs)}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error("[king-county] failed");
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
