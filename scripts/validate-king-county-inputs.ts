/**
 * King County intake — file-level preflight validation.
 *
 * Discovers the two raw exports under `data/raw/king-county/` (or the
 * directory passed via `--dir=<path>`), confirms each is present,
 * non-empty, and UTF-8 readable, and emits typed problems for anything
 * that would block downstream parsing.
 *
 * Importable: `scripts/inspect-king-county-headers.ts` calls
 * `discoverFiles` + `validateFile` to build its preflight. The bottom
 * of this file is a small CLI that runs the same checks standalone:
 *
 *   npx tsx scripts/validate-king-county-inputs.ts
 *
 * Exit codes:
 *   0 — files present and pass every file-level check
 *   1 — at least one file-level problem detected
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// ── Types ──────────────────────────────────────────────────────────

export type ValidationCode =
  | "directory_missing"
  | "directory_unreadable"
  | "missing_assessor"
  | "missing_recorder"
  | "ambiguous_assessor"
  | "ambiguous_recorder"
  | "empty_file"
  | "unreadable_file"
  | "binary_file";

export interface ValidationProblem {
  code: ValidationCode;
  detail: string;
  filePath?: string;
}

export interface DiscoveredFiles {
  dir: string;
  assessor: string | null;
  recorder: string | null;
  candidates: {
    assessor: string[];
    recorder: string[];
  };
}

export interface DiscoveryResult {
  files: DiscoveredFiles;
  problems: ValidationProblem[];
}

// ── Filename heuristics ────────────────────────────────────────────

const ASSESSOR_NAME_HINTS = [
  "assessor",
  "parcel",
  "real-property",
  "realproperty",
  "real_property",
  "ereal",
] as const;

const RECORDER_NAME_HINTS = [
  "recorder",
  "deed",
  "transfer",
  "instrument",
  "recording",
  "real-estate-excise",
] as const;

function matchesHint(filename: string, hints: readonly string[]): boolean {
  const lower = filename.toLowerCase();
  return hints.some((h) => lower.includes(h));
}

// ── File discovery ─────────────────────────────────────────────────

/**
 * Discover the assessor + recorder CSV files in the intake directory.
 * Sorts deterministically by filename ASC so two runs against the same
 * directory always pick the same candidate.
 */
export async function discoverFiles(opts: {
  dir?: string;
  assessor?: string;
  recorder?: string;
}): Promise<DiscoveryResult> {
  const problems: ValidationProblem[] = [];
  const dir = opts.dir ?? "data/raw/king-county";

  let assessor = opts.assessor ?? null;
  let recorder = opts.recorder ?? null;
  let assessorCandidates: string[] = [];
  let recorderCandidates: string[] = [];

  if (!assessor || !recorder) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        problems.push({
          code: "directory_missing",
          detail: `Directory ${dir} does not exist. Create it and drop the two raw CSV exports inside.`,
        });
      } else {
        problems.push({
          code: "directory_unreadable",
          detail: `Cannot read ${dir}: ${(err as Error).message}`,
        });
      }
      return {
        files: { dir, assessor, recorder, candidates: { assessor: [], recorder: [] } },
        problems,
      };
    }

    const csvFiles = entries
      .filter((f) => f.toLowerCase().endsWith(".csv"))
      .sort(); // deterministic

    assessorCandidates = csvFiles.filter(
      (f) =>
        matchesHint(f, ASSESSOR_NAME_HINTS) && !matchesHint(f, RECORDER_NAME_HINTS),
    );
    recorderCandidates = csvFiles.filter(
      (f) =>
        matchesHint(f, RECORDER_NAME_HINTS) && !matchesHint(f, ASSESSOR_NAME_HINTS),
    );

    if (!assessor) {
      if (assessorCandidates.length === 0) {
        problems.push({
          code: "missing_assessor",
          detail:
            `No assessor-like CSV in ${dir}. Filename must include one of: ` +
            `${ASSESSOR_NAME_HINTS.join(", ")}. Use --assessor=<path> to override.`,
        });
      } else if (assessorCandidates.length > 1) {
        problems.push({
          code: "ambiguous_assessor",
          detail:
            `Multiple assessor candidates: ${assessorCandidates.join(", ")}. ` +
            `Use --assessor=<path> to choose explicitly.`,
        });
      } else {
        assessor = path.join(dir, assessorCandidates[0]);
      }
    }

    if (!recorder) {
      if (recorderCandidates.length === 0) {
        problems.push({
          code: "missing_recorder",
          detail:
            `No recorder-like CSV in ${dir}. Filename must include one of: ` +
            `${RECORDER_NAME_HINTS.join(", ")}. Use --recorder=<path> to override.`,
        });
      } else if (recorderCandidates.length > 1) {
        problems.push({
          code: "ambiguous_recorder",
          detail:
            `Multiple recorder candidates: ${recorderCandidates.join(", ")}. ` +
            `Use --recorder=<path> to choose explicitly.`,
        });
      } else {
        recorder = path.join(dir, recorderCandidates[0]);
      }
    }
  }

  return {
    files: {
      dir,
      assessor,
      recorder,
      candidates: { assessor: assessorCandidates, recorder: recorderCandidates },
    },
    problems,
  };
}

// ── File-level validation ──────────────────────────────────────────

/**
 * Validate one file: present, non-empty, no NUL bytes in the first 8KB.
 * Returns an empty array on success; one or more problems otherwise.
 */
export async function validateFile(filePath: string): Promise<ValidationProblem[]> {
  const problems: ValidationProblem[] = [];

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    problems.push({
      code: "unreadable_file",
      detail: `Cannot stat ${filePath}`,
      filePath,
    });
    return problems;
  }

  if (stat.size === 0) {
    problems.push({
      code: "empty_file",
      detail: `${filePath} is zero bytes`,
      filePath,
    });
    return problems;
  }

  // Quick UTF-8 / binary sanity: read the first chunk and reject if we
  // find NUL bytes. A real CSV may include unusual characters but never
  // a NUL inside the first 8KB.
  let head: Buffer;
  try {
    const fd = await fs.open(filePath, "r");
    try {
      const len = Math.min(8192, stat.size);
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, 0);
      head = buf;
    } finally {
      await fd.close();
    }
  } catch (err) {
    problems.push({
      code: "unreadable_file",
      detail: `Cannot read head bytes from ${filePath}: ${(err as Error).message}`,
      filePath,
    });
    return problems;
  }

  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) {
      problems.push({
        code: "binary_file",
        detail: `${filePath} contains a NUL byte at offset ${i} — not a CSV`,
        filePath,
      });
      return problems;
    }
  }

  return problems;
}

// ── Arg parsing helper ─────────────────────────────────────────────

export function readArgs(): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args.set(key, rest.join("=") || "true");
  }
  return args;
}

// ── CLI mode (only when invoked directly) ──────────────────────────

async function main(): Promise<void> {
  const args = readArgs();
  const result = await discoverFiles({
    dir: args.get("dir"),
    assessor: args.get("assessor"),
    recorder: args.get("recorder"),
  });

  const allProblems: ValidationProblem[] = [...result.problems];

  if (result.files.assessor) {
    allProblems.push(...(await validateFile(result.files.assessor)));
  }
  if (result.files.recorder) {
    allProblems.push(...(await validateFile(result.files.recorder)));
  }

  // Deterministic ordering for output.
  allProblems.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return (a.filePath ?? "") < (b.filePath ?? "") ? -1 : 1;
  });

  if (allProblems.length > 0) {
    console.error("[validate-king-county-inputs] preflight failed");
    for (const p of allProblems) {
      const where = p.filePath ? ` (${path.relative(process.cwd(), p.filePath)})` : "";
      console.error(`  - ${p.code}${where}: ${p.detail}`);
    }
    process.exit(1);
  }

  console.log("[validate-king-county-inputs] preflight passed");
  console.log(`  assessor: ${path.relative(process.cwd(), result.files.assessor ?? "")}`);
  console.log(`  recorder: ${path.relative(process.cwd(), result.files.recorder ?? "")}`);
}

// Guarded entry: only run main() when this file is invoked directly,
// not when imported by the inspector.
const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error("[validate-king-county-inputs] crashed");
    console.error(message);
    process.exit(1);
  });
}
