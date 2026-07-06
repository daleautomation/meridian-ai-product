// Meridian Command — Gmail opportunity staging persistence.
//
// Durable-enough file staging (data/gmail/opportunities.json), used both as the
// write target and as the "previous scan" source for the change log. Mirrors the
// ae-jobs store pattern (safeReadJson/safeWriteJson). When Postgres is configured,
// graphBridge additionally projects into the Opportunity Graph.

import path from "node:path";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { DetectedOpportunity, GmailOpportunityStore } from "./types";

const STORE_PATH = path.join(process.cwd(), "data", "gmail", "opportunities.json");
const DEFAULT_OWNER = "dylan";

export async function loadGmailStore(ownerId = DEFAULT_OWNER): Promise<GmailOpportunityStore> {
  const file = await safeReadJson<GmailOpportunityStore>(STORE_PATH);
  if (file?.version === 1 && Array.isArray(file.opportunities)) return file;
  return { version: 1, ownerId, scannedAt: null, opportunities: [] };
}

export async function saveGmailStore(
  opportunities: DetectedOpportunity[],
  scannedAt: string,
  ownerId = DEFAULT_OWNER,
): Promise<boolean> {
  const store: GmailOpportunityStore = { version: 1, ownerId, scannedAt, opportunities };
  return safeWriteJson(STORE_PATH, store);
}

export { STORE_PATH };
