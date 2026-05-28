/**
 * check-manual-parcels-csv — pre-preprocessing inspection of a
 * hand-curated manual-parcels CSV. Surfaces operationally-risky
 * patterns BEFORE the preprocessor consumes them.
 *
 * Warnings only — never blocks. The founder reads the warnings and
 * decides whether each is a typo to fix or a real ambiguity to
 * preserve via founderNotes.
 *
 * Pure: no DB, no env. Same input → same output.
 *
 * Usage:
 *   npm run check-manual-parcels-csv -- \
 *     --in=data/raw/manual-parcels/nicole-2026-05-27.csv
 *
 * Categories:
 *   ─ required-field warnings (missing parcelId / situsAddress / ownerName / countyCode)
 *   ─ unknown countyCode (outside the supported list)
 *   ─ duplicate parcelId within county
 *   ─ duplicate canonical-address (ambiguity flag)
 *   ─ suspicious ownership duration (>100yr ago, in the future)
 *   ─ malformed date that won't parse
 *   ─ weak address (no comma, no ZIP, very short street)
 *   ─ assessedValue out of plausible range
 *   ─ informational: owner looks like LLC/Trust
 */

import { readFileSync } from "node:fs";
import {
  canonicalPropertyKey,
  detectWeakAddress,
  normalizeAddress,
} from "@/lib/enrichment/address";
import { preNormalizeAddress } from "@/lib/enrichment/address/preNormalize";
import {
  coerceIsoDate,
  parseCsvToRows,
} from "@/lib/enrichment/public-records/preprocessing/canonicalCsv";

const SUPPORTED_COUNTIES = new Set<string>([
  "us-mo-jackson",
  "us-ks-johnson",
]);

const PLAUSIBLE_MIN_OWNERSHIP_YEAR = 1900;

interface Finding {
  rowIndex: number;
  category: string;
  detail: string;
  rowSummary: string;
}

interface Args {
  inPath: string;
}

function parseArgs(argv: readonly string[]): Args {
  let inPath = "";
  for (const a of argv) {
    if (a.startsWith("--in=")) inPath = a.slice("--in=".length);
  }
  if (!inPath) {
    console.error("Usage: check-manual-parcels-csv -- --in=<path>");
    process.exit(2);
  }
  return { inPath };
}

function summarizeRow(row: Record<string, string>): string {
  const parts: string[] = [];
  if (row.countyCode) parts.push(row.countyCode);
  if (row.parcelId) parts.push(`parcel=${row.parcelId}`);
  if (row.situsAddress) parts.push(`situs="${row.situsAddress.slice(0, 60)}"`);
  if (row.ownerName) parts.push(`owner="${row.ownerName.slice(0, 40)}"`);
  return parts.join(" · ");
}

function findingsByCategory(findings: Finding[]): Map<string, Finding[]> {
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = grouped.get(f.category);
    if (list) list.push(f);
    else grouped.set(f.category, [f]);
  }
  return grouped;
}

function printFindings(findings: Finding[]): void {
  if (findings.length === 0) {
    console.log("  (none)");
    return;
  }
  const grouped = findingsByCategory(findings);
  const ordered = Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length);
  for (const [category, list] of ordered) {
    console.log(`  ${category.padEnd(34)} ${list.length}`);
  }
  console.log("");
  for (const [category, list] of ordered) {
    console.log(`  ── ${category} ──`);
    for (const f of list.slice(0, 5)) {
      console.log(`     row ${String(f.rowIndex + 2).padStart(3)}: ${f.detail}`);
      console.log(`              ${f.rowSummary}`);
    }
    if (list.length > 5) {
      console.log(`     ... ${list.length - 5} more`);
    }
    console.log("");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = readFileSync(args.inPath, "utf8");
  const rows = parseCsvToRows(text);
  if (rows.length === 0) {
    console.error(`check-manual-parcels-csv: no data rows in ${args.inPath}`);
    process.exit(1);
  }

  const warnings: Finding[] = [];
  const informationals: Finding[] = [];

  // Indexes for duplicate detection.
  const byParcelKey = new Map<string, number[]>(); // "<county>::<parcelId>" → rowIndexes
  const byCanonicalKey = new Map<string, number[]>(); // "<county>::<canonical>" → rowIndexes

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const countyCode = (row.countyCode ?? row.county_code ?? "").trim();
    const parcelId = (row.parcelId ?? row.parcel_id ?? "").trim();
    const situs = (row.situsAddress ?? row.situs_address ?? row.propertyAddress ?? "").trim();
    const owner = (row.ownerName ?? row.owner_name ?? row.owner ?? "").trim();
    const ownershipStart = (row.ownershipStartDate ?? row.ownership_start_date ?? "").trim();
    const lastTransfer = (row.lastTransferDate ?? row.last_transfer_date ?? "").trim();
    const assessedRaw = (row.assessedValue ?? row.assessed_value ?? "").trim();
    const summary = summarizeRow(row);

    // ── Required fields ──────────────────────────────────────────
    if (!countyCode) {
      warnings.push({
        rowIndex: i, category: "missing_county_code",
        detail: "countyCode is empty — preprocessor will reject this row",
        rowSummary: summary,
      });
    } else if (!SUPPORTED_COUNTIES.has(countyCode.toLowerCase())) {
      warnings.push({
        rowIndex: i, category: "unknown_county_code",
        detail: `countyCode "${countyCode}" is not in the supported set {${[...SUPPORTED_COUNTIES].join(", ")}}`,
        rowSummary: summary,
      });
    }
    if (!parcelId) {
      warnings.push({
        rowIndex: i, category: "missing_parcel_id",
        detail: "parcelId is empty",
        rowSummary: summary,
      });
    }
    if (!situs) {
      warnings.push({
        rowIndex: i, category: "missing_situs_address",
        detail: "situsAddress is empty",
        rowSummary: summary,
      });
    }
    if (!owner) {
      warnings.push({
        rowIndex: i, category: "missing_owner_name",
        detail: "ownerName is empty",
        rowSummary: summary,
      });
    }

    // ── Duplicate detection (within the file) ───────────────────
    if (countyCode && parcelId) {
      const k = `${countyCode.toLowerCase()}::${parcelId}`;
      const list = byParcelKey.get(k);
      if (list) list.push(i);
      else byParcelKey.set(k, [i]);
    }
    if (countyCode && situs) {
      try {
        const ck = canonicalPropertyKey(normalizeAddress(preNormalizeAddress(situs)));
        if (ck) {
          const k = `${countyCode.toLowerCase()}::${ck}`;
          const list = byCanonicalKey.get(k);
          if (list) list.push(i);
          else byCanonicalKey.set(k, [i]);
        }
      } catch {
        // canonicalization may throw on garbage input — we surface that
        // separately under weak_address below.
      }
    }

    // ── Weak address (would fail canonicalization at ingest) ────
    if (situs) {
      const pre = preNormalizeAddress(situs);
      const normalized = normalizeAddress(pre);
      const weak = detectWeakAddress(normalized);
      if (weak) {
        warnings.push({
          rowIndex: i, category: "weak_address",
          detail: `situsAddress is weak — preprocessor will reject: ${weak.code} (${weak.detail})`,
          rowSummary: summary,
        });
      }
    }

    // ── Date parsing + plausibility ─────────────────────────────
    if (ownershipStart) {
      const iso = coerceIsoDate(ownershipStart);
      if (!iso) {
        warnings.push({
          rowIndex: i, category: "malformed_date",
          detail: `ownershipStartDate "${ownershipStart}" does not parse to an ISO date`,
          rowSummary: summary,
        });
      } else {
        const year = parseInt(iso.slice(0, 4), 10);
        if (year < PLAUSIBLE_MIN_OWNERSHIP_YEAR) {
          warnings.push({
            rowIndex: i, category: "suspicious_ownership_duration",
            detail: `ownershipStartDate year ${year} is implausibly old (< ${PLAUSIBLE_MIN_OWNERSHIP_YEAR})`,
            rowSummary: summary,
          });
        }
        if (iso > todayIso) {
          warnings.push({
            rowIndex: i, category: "suspicious_ownership_duration",
            detail: `ownershipStartDate ${iso} is in the future (today is ${todayIso})`,
            rowSummary: summary,
          });
        }
      }
    }
    if (lastTransfer) {
      const iso = coerceIsoDate(lastTransfer);
      if (!iso) {
        warnings.push({
          rowIndex: i, category: "malformed_date",
          detail: `lastTransferDate "${lastTransfer}" does not parse to an ISO date`,
          rowSummary: summary,
        });
      }
    }

    // ── assessedValue plausibility ───────────────────────────────
    if (assessedRaw) {
      const cleaned = assessedRaw.replace(/[$,\s]/g, "");
      const n = Number.parseFloat(cleaned);
      if (!Number.isFinite(n) || n < 0) {
        warnings.push({
          rowIndex: i, category: "implausible_assessed_value",
          detail: `assessedValue "${assessedRaw}" is not a non-negative number`,
          rowSummary: summary,
        });
      } else if (n > 100_000_000) {
        warnings.push({
          rowIndex: i, category: "implausible_assessed_value",
          detail: `assessedValue ${n} is implausibly large (> $100M); check for an extra digit`,
          rowSummary: summary,
        });
      }
    }

    // ── Informational: LLC / Trust pattern ───────────────────────
    if (/\b(llc|l\.l\.c\.|inc|corp|company|holdings|properties|trust|trustee)\b/i.test(owner)) {
      informationals.push({
        rowIndex: i, category: "owner_is_entity",
        detail:
          `ownerName "${owner}" looks like an LLC / trust — resolver will classify ` +
          `as trust_or_llc if it contains the contact's surname; otherwise WEAK ownership_mismatch`,
        rowSummary: summary,
      });
    }
  }

  // ── Duplicate findings (after the full pass) ──────────────────
  for (const [k, rowIndexes] of byParcelKey) {
    if (rowIndexes.length > 1) {
      const [, parcelId] = k.split("::");
      warnings.push({
        rowIndex: rowIndexes[0],
        category: "duplicate_parcel_id",
        detail: `parcelId ${parcelId} appears on rows ${rowIndexes.map((r) => r + 2).join(", ")} (header is row 1)`,
        rowSummary: `(see duplicate rows)`,
      });
    }
  }
  for (const [k, rowIndexes] of byCanonicalKey) {
    if (rowIndexes.length > 1) {
      const [, canonical] = k.split("::");
      warnings.push({
        rowIndex: rowIndexes[0],
        category: "duplicate_canonical_address",
        detail: `canonical address "${canonical}" appears on rows ${rowIndexes.map((r) => r + 2).join(", ")} — ambiguity OR typo`,
        rowSummary: `(see duplicate rows)`,
      });
    }
  }

  // ── Report ────────────────────────────────────────────────────
  console.log("");
  console.log(`check-manual-parcels-csv  ${args.inPath}`);
  console.log("================");
  console.log(`  rows parsed:                 ${rows.length}`);
  console.log(`  warnings:                    ${warnings.length}`);
  console.log(`  informational notes:         ${informationals.length}`);
  console.log("");
  console.log("Warnings (will affect ingestion or trust)");
  printFindings(warnings);
  console.log("Informational (no action required)");
  printFindings(informationals);
  console.log("Reminder: this tool ONLY surfaces risks. It does NOT block ingestion.");
  console.log("Decide row-by-row whether each warning is a typo to fix or an intentional");
  console.log("ambiguity to preserve via a founderNotes column (added to rawSourceRow).");
  console.log("");

  // Exit 0 always — warnings, not blocks.
}

main();
