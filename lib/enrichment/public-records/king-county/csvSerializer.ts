// Meridian — King County joined-output CSV serializer.
//
// Fixed column order. Always writes `\n`-terminated lines. Always
// double-quotes fields containing `,`, `"`, or `\n`. Outputs a trailing
// newline so the file ends cleanly.
//
// The column order is contractual: downstream
// `parsePublicRecordCsv` reads on these column names. Do not rename
// columns without updating the public-records adapter and bumping the
// pipeline contract.

import type { JoinedRow } from "./joiner";

export const OUTPUT_COLUMNS = [
  "parcelId",
  "situsAddress",
  "ownerName",
  "mailingAddress",
  "ownershipStartDate",
  "lastTransferDate",
  "assessedValue",
  "propertyType",
  "recordUrl",
  "sourceName",
  "observedAt",
] as const;

export type OutputColumn = (typeof OUTPUT_COLUMNS)[number];

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize joined rows to a deterministic CSV string. */
export function serializeJoinedRowsToCsv(rows: readonly JoinedRow[]): string {
  const out: string[] = [];
  out.push(OUTPUT_COLUMNS.join(","));
  for (const row of rows) {
    const cells = OUTPUT_COLUMNS.map((col) => csvEscape(row[col] ?? ""));
    out.push(cells.join(","));
  }
  return `${out.join("\n")}\n`;
}
