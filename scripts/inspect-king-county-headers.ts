/**
 * King County intake — full preflight inspection.
 *
 * Combines the file-level validator with header detection, sample
 * parsing, and ownership-transfer surveying. Produces deterministic
 * console output that an operator can read before running the join.
 *
 * Behavior summary:
 *   1. Discover assessor + recorder CSVs (file-level validation first)
 *   2. Parse first 100 data rows of each
 *   3. Detect which header alias was used for every required field
 *   4. Sample-validate parcel IDs (count malformed in sample)
 *   5. Survey recorder document types; count transfer-eligible rows
 *   6. Flag unknown headers + mailing-address fragmentation as warnings
 *   7. Print the report
 *
 * Exit codes:
 *   0 — preflight passed (warnings allowed)
 *   1 — file-level validation failed OR required header missing
 *
 * The alias lists here MUST stay in sync with
 * `lib/enrichment/public-records/king-county/joiner.ts:pick(...)`
 * call sites. Anything the joiner accepts must be listed here so the
 * inspector does not warn about a header the joiner would honor.
 *
 * Usage:
 *   npx tsx scripts/inspect-king-county-headers.ts \
 *     [--dir=data/raw/king-county] \
 *     [--assessor=<path>] [--recorder=<path>] \
 *     [--sample=100]
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { normalizeKingCountyParcelId } from "@/lib/enrichment/public-records/king-county";
import { isOwnershipTransferDoc } from "@/lib/enrichment/public-records/king-county";

import {
  discoverFiles,
  readArgs,
  validateFile,
  type ValidationProblem,
} from "./validate-king-county-inputs";

// ── Header alias inventory (mirrors joiner pick() call sites) ──────

type FieldName =
  | "parcelId"
  | "situsAddress"
  | "ownerName"
  | "mailingAddress"
  | "assessedValue"
  | "propertyType"
  | "documentType"
  | "recordingDate"
  | "documentNumber";

interface FieldSpec {
  field: FieldName;
  aliases: readonly string[];
  required: boolean;
}

const ASSESSOR_FIELDS: readonly FieldSpec[] = [
  { field: "parcelId", aliases: ["parcelId", "parcel_number", "pin", "parcel", "major", "account"], required: true },
  { field: "situsAddress", aliases: ["situsAddress", "address", "propertyAddress", "locationAddress", "street"], required: true },
  { field: "ownerName", aliases: ["ownerName", "taxpayerName", "owner", "taxpayer"], required: false },
  { field: "mailingAddress", aliases: ["mailingAddress", "mailingStreet"], required: false },
  { field: "assessedValue", aliases: ["assessedValue", "appraisedValue", "totalValue", "appraisal"], required: false },
  { field: "propertyType", aliases: ["propertyType", "presentUse", "useCode", "dorUse"], required: false },
];

const RECORDER_FIELDS: readonly FieldSpec[] = [
  { field: "parcelId", aliases: ["parcelId", "parcel_number", "pin", "parcel", "associatedParcel"], required: true },
  { field: "documentType", aliases: ["documentType", "docType", "instrumentType", "type"], required: true },
  { field: "recordingDate", aliases: ["recordingDate", "recordedDate", "filingDate", "date"], required: true },
  { field: "documentNumber", aliases: ["documentNumber", "instrumentNumber", "recordingNumber"], required: false },
];

// Mailing-address fragmentation watch list — if these appear together
// without a unified `mailingAddress` header, the inspector flags it so
// the operator can pre-combine before the join.
const MAILING_FRAGMENT_HEADERS = [
  "mailingStreet",
  "mailingCity",
  "mailingState",
  "mailingZip",
  "mailingPostalCode",
] as const;

// ── Header canonicalization (mirrors joiner) ───────────────────────

function canonicalHeader(key: string): string {
  return key.toLowerCase().replace(/[_\s\-.]+/g, "");
}

function aliasMatches(headerKey: string, aliases: readonly string[]): boolean {
  const canon = canonicalHeader(headerKey);
  return aliases.some((alias) => canonicalHeader(alias) === canon);
}

// ── Minimal CSV parser (handles double-quote escaping) ─────────────

interface ParsedHead {
  headers: string[];
  rows: Record<string, string>[];
  totalRowCount: number;
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

function parseCsvHead(text: string, sampleSize: number): ParsedHead {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], totalRowCount: 0 };
  }
  const headers = splitCsvLine(lines[0]);
  const dataLines = lines.slice(1);
  const rows: Record<string, string>[] = [];
  const limit = Math.min(sampleSize, dataLines.length);
  for (let i = 0; i < limit; i++) {
    const cells = splitCsvLine(dataLines[i]);
    if (cells.every((c) => c === "")) continue;
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return { headers, rows, totalRowCount: dataLines.length };
}

// ── Header detection ───────────────────────────────────────────────

interface HeaderDetection {
  field: FieldName;
  detected: string | null;
  required: boolean;
}

function detectHeaders(
  spec: readonly FieldSpec[],
  headers: readonly string[],
): { detections: HeaderDetection[]; unknownHeaders: string[] } {
  const detections: HeaderDetection[] = [];
  const claimed = new Set<string>();

  for (const f of spec) {
    let found: string | null = null;
    for (const h of headers) {
      if (claimed.has(h)) continue;
      if (aliasMatches(h, f.aliases)) {
        found = h;
        claimed.add(h);
        break;
      }
    }
    detections.push({ field: f.field, detected: found, required: f.required });
  }

  const knownCanon = new Set<string>();
  for (const f of spec) {
    for (const alias of f.aliases) knownCanon.add(canonicalHeader(alias));
  }
  for (const mf of MAILING_FRAGMENT_HEADERS) knownCanon.add(canonicalHeader(mf));
  knownCanon.add(canonicalHeader("grantor"));
  knownCanon.add(canonicalHeader("grantee"));
  knownCanon.add(canonicalHeader("legalDescription"));

  const unknownHeaders = headers
    .filter((h) => !knownCanon.has(canonicalHeader(h)))
    .sort();

  return { detections, unknownHeaders };
}

// ── Sample analysis ────────────────────────────────────────────────

function sampleParcelIds(
  rows: readonly Record<string, string>[],
  parcelHeader: string | null,
  limit: number,
): { sample: string[]; malformedCount: number; totalChecked: number } {
  if (!parcelHeader) {
    return { sample: [], malformedCount: 0, totalChecked: 0 };
  }
  const sample: string[] = [];
  let malformed = 0;
  for (const row of rows) {
    const raw = (row[parcelHeader] ?? "").trim();
    if (!raw) continue;
    const norm = normalizeKingCountyParcelId(raw);
    if (norm === null) {
      malformed += 1;
    } else if (sample.length < limit) {
      sample.push(norm);
    }
  }
  return { sample, malformedCount: malformed, totalChecked: rows.length };
}

interface DocTypeSurvey {
  distinctTypes: string[];
  transferTypes: string[];
  transferRowCount: number;
}

function surveyDocTypes(
  rows: readonly Record<string, string>[],
  docTypeHeader: string | null,
): DocTypeSurvey {
  if (!docTypeHeader) {
    return { distinctTypes: [], transferTypes: [], transferRowCount: 0 };
  }
  const seen = new Set<string>();
  const transfers = new Set<string>();
  let transferRows = 0;
  for (const row of rows) {
    const raw = (row[docTypeHeader] ?? "").trim();
    if (!raw) continue;
    seen.add(raw);
    if (isOwnershipTransferDoc(raw)) {
      transfers.add(raw);
      transferRows += 1;
    }
  }
  return {
    distinctTypes: [...seen].sort(),
    transferTypes: [...transfers].sort(),
    transferRowCount: transferRows,
  };
}

// ── Reporting ──────────────────────────────────────────────────────

interface FileInspection {
  label: "assessor" | "recorder";
  filePath: string;
  totalRowCount: number;
  detections: HeaderDetection[];
  unknownHeaders: string[];
  parcelSample: string[];
  parcelMalformedInSample: number;
  parcelSampleSize: number;
  docTypes?: DocTypeSurvey;
  hasMailingFragments: boolean;
  mailingFragmentHeaders: string[];
}

function printFileSection(insp: FileInspection): void {
  console.log(`${insp.label} file: ${insp.filePath}`);
  console.log(`${insp.label} rows: ${insp.totalRowCount}`);
  for (const d of insp.detections) {
    if (d.detected) {
      console.log(`${insp.label} ${d.field} header detected: ${d.detected}`);
    } else if (d.required) {
      console.log(`${insp.label} ${d.field} header detected: MISSING (required)`);
    }
  }
}

function collectWarnings(
  assessor: FileInspection,
  recorder: FileInspection,
): string[] {
  const warnings: string[] = [];

  if (assessor.hasMailingFragments) {
    warnings.push(
      `mailing address split across ${assessor.mailingFragmentHeaders.length} fields ` +
        `(${assessor.mailingFragmentHeaders.join(", ")}) — combine before the join, or the unified mailingAddress column will be empty`,
    );
  }

  if (assessor.parcelMalformedInSample > 0) {
    warnings.push(
      `${assessor.parcelMalformedInSample} malformed parcel id(s) detected in first ${assessor.parcelSampleSize} assessor rows`,
    );
  }
  if (recorder.parcelMalformedInSample > 0) {
    warnings.push(
      `${recorder.parcelMalformedInSample} malformed parcel id(s) detected in first ${recorder.parcelSampleSize} recorder rows`,
    );
  }

  for (const h of assessor.unknownHeaders) {
    warnings.push(`unknown assessor header: ${h}`);
  }
  for (const h of recorder.unknownHeaders) {
    warnings.push(`unknown recorder header: ${h}`);
  }

  if (recorder.docTypes && recorder.docTypes.transferTypes.length === 0) {
    warnings.push(
      `no ownership-transfer document types detected in first ${recorder.parcelSampleSize} recorder rows — ` +
        `every row in the sample is DOT/REL/NOD/other non-transfer. Verify the recorder export is not filtered to mortgages only.`,
    );
  }

  return warnings;
}

// ── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = readArgs();
  const sampleSize = Math.max(1, Number.parseInt(args.get("sample") ?? "100", 10) || 100);

  // Phase 1: file-level discovery + validation.
  const discovery = await discoverFiles({
    dir: args.get("dir"),
    assessor: args.get("assessor"),
    recorder: args.get("recorder"),
  });

  const fileProblems: ValidationProblem[] = [...discovery.problems];
  if (discovery.files.assessor) {
    fileProblems.push(...(await validateFile(discovery.files.assessor)));
  }
  if (discovery.files.recorder) {
    fileProblems.push(...(await validateFile(discovery.files.recorder)));
  }
  fileProblems.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return (a.filePath ?? "") < (b.filePath ?? "") ? -1 : 1;
  });

  if (fileProblems.length > 0) {
    console.error("[inspect] preflight failed (file-level checks)");
    for (const p of fileProblems) {
      const where = p.filePath ? ` (${path.relative(process.cwd(), p.filePath)})` : "";
      console.error(`  - ${p.code}${where}: ${p.detail}`);
    }
    console.error("");
    console.error("Next step: drop the two raw CSV exports into");
    console.error(`  ${discovery.files.dir}/`);
    console.error("Expected filenames contain `assessor` / `parcel` (for the assessor export)");
    console.error("and `recorder` / `deed` / `transfer` (for the recorder export).");
    process.exit(1);
  }

  // Phase 2: parse heads of both files.
  const assessorText = await fs.readFile(discovery.files.assessor!, "utf8");
  const recorderText = await fs.readFile(discovery.files.recorder!, "utf8");
  const assessorParsed = parseCsvHead(assessorText, sampleSize);
  const recorderParsed = parseCsvHead(recorderText, sampleSize);

  // Phase 3: header detection.
  const assessorDetect = detectHeaders(ASSESSOR_FIELDS, assessorParsed.headers);
  const recorderDetect = detectHeaders(RECORDER_FIELDS, recorderParsed.headers);

  // Phase 4: required-field gate.
  const missingRequired: string[] = [];
  for (const d of assessorDetect.detections) {
    if (d.required && !d.detected) missingRequired.push(`assessor.${d.field}`);
  }
  for (const d of recorderDetect.detections) {
    if (d.required && !d.detected) missingRequired.push(`recorder.${d.field}`);
  }

  // Phase 5: sample analysis.
  const assessorParcelHeader = assessorDetect.detections.find((d) => d.field === "parcelId")?.detected ?? null;
  const recorderParcelHeader = recorderDetect.detections.find((d) => d.field === "parcelId")?.detected ?? null;
  const recorderDocTypeHeader = recorderDetect.detections.find((d) => d.field === "documentType")?.detected ?? null;

  const assessorParcelStats = sampleParcelIds(assessorParsed.rows, assessorParcelHeader, 5);
  const recorderParcelStats = sampleParcelIds(recorderParsed.rows, recorderParcelHeader, 5);
  const recorderDocSurvey = surveyDocTypes(recorderParsed.rows, recorderDocTypeHeader);

  // Phase 6: mailing fragmentation check.
  const assessorMailingFragments = MAILING_FRAGMENT_HEADERS.filter((mh) =>
    assessorParsed.headers.some((h) => canonicalHeader(h) === canonicalHeader(mh)),
  );
  const hasUnifiedMailing = assessorDetect.detections.find((d) => d.field === "mailingAddress")?.detected;
  const hasFragments = !hasUnifiedMailing && assessorMailingFragments.length >= 2;

  // Phase 7: assemble inspection summaries.
  const assessorInspection: FileInspection = {
    label: "assessor",
    filePath: path.relative(process.cwd(), discovery.files.assessor!),
    totalRowCount: assessorParsed.totalRowCount,
    detections: assessorDetect.detections,
    unknownHeaders: assessorDetect.unknownHeaders,
    parcelSample: assessorParcelStats.sample,
    parcelMalformedInSample: assessorParcelStats.malformedCount,
    parcelSampleSize: assessorParcelStats.totalChecked,
    hasMailingFragments: hasFragments,
    mailingFragmentHeaders: assessorMailingFragments,
  };
  const recorderInspection: FileInspection = {
    label: "recorder",
    filePath: path.relative(process.cwd(), discovery.files.recorder!),
    totalRowCount: recorderParsed.totalRowCount,
    detections: recorderDetect.detections,
    unknownHeaders: recorderDetect.unknownHeaders,
    parcelSample: recorderParcelStats.sample,
    parcelMalformedInSample: recorderParcelStats.malformedCount,
    parcelSampleSize: recorderParcelStats.totalChecked,
    docTypes: recorderDocSurvey,
    hasMailingFragments: false,
    mailingFragmentHeaders: [],
  };

  // Phase 8: print report (deterministic, no timestamps).
  console.log("[inspect]");
  printFileSection(assessorInspection);
  printFileSection(recorderInspection);

  if (recorderInspection.docTypes && recorderInspection.docTypes.transferTypes.length > 0) {
    console.log(
      `ownership transfer doc types detected: ${recorderInspection.docTypes.transferTypes.join(", ")} ` +
        `(${recorderInspection.docTypes.transferRowCount} transfer row(s) in first ${recorderInspection.parcelSampleSize} rows)`,
    );
  } else {
    console.log("ownership transfer doc types detected: NONE in sample");
  }

  if (assessorInspection.parcelSample.length > 0) {
    console.log("sample assessor parcel ids:");
    for (const pid of assessorInspection.parcelSample) console.log(`  ${pid}`);
  }
  if (recorderInspection.docTypes && recorderInspection.docTypes.distinctTypes.length > 0) {
    console.log(`sample recorder document types: ${recorderInspection.docTypes.distinctTypes.join(", ")}`);
  }

  // Phase 9: warnings + hard failures.
  const warnings = collectWarnings(assessorInspection, recorderInspection);

  if (missingRequired.length > 0) {
    console.error("");
    console.error("Required headers missing:");
    for (const m of missingRequired) console.error(`  - ${m}`);
    console.error("");
    console.error("Next step: confirm the export contains the listed field under one of the accepted aliases.");
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }

  console.log("");
  console.log("OK to join.");
  console.log("");
  console.log("Next command:");
  console.log("  npx tsx scripts/join-king-county-records.ts \\");
  console.log(`    --assessor=${assessorInspection.filePath} \\`);
  console.log(`    --recorder=${recorderInspection.filePath} \\`);
  console.log("    --observed-at=<ISO-8601 pull date>");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[inspect-king-county-headers] crashed");
  console.error(message);
  process.exit(1);
});
