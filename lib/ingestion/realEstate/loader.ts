// Meridian AI — real-estate file loader.
//
// Reads JSON or CSV. Auto-detects format by extension. Caller specifies the
// source format ("normalized" | "public-record") to choose normalization.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/ingestion/csvParser";
import { normalizePropertyRecords } from "@/lib/ingestion/realEstate/publicRecordAdapter";
import type {
  NormalizedRealEstateRecord,
  RawPropertyRecord,
} from "@/lib/ingestion/types";

export type RealEstateLoadOptions = {
  source?: "normalized" | "public-record";
};

export async function loadRealEstateFromFile(
  filePath: string,
  options: RealEstateLoadOptions = {}
): Promise<NormalizedRealEstateRecord[]> {
  const source = options.source ?? "normalized";
  const ext = path.extname(filePath).toLowerCase();

  let raw: unknown[];
  try {
    const text = await fs.readFile(filePath, "utf8");
    if (ext === ".csv") {
      raw = parseCsv(text);
    } else {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        console.error(`[realEstate/loader] expected array in ${filePath}`);
        return [];
      }
      raw = parsed;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`[realEstate/loader] ${filePath} not found — returning empty`);
      return [];
    }
    console.error(`[realEstate/loader] failed to read ${filePath}`, e);
    return [];
  }

  if (source === "public-record") {
    return normalizePropertyRecords(raw as RawPropertyRecord[]);
  }

  // "normalized" — assume the file already matches NormalizedRealEstateRecord shape
  return raw as NormalizedRealEstateRecord[];
}
