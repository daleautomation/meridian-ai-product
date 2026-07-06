// Meridian Command — load Phase 1 projection inputs from the existing JSON stores.
//
// Reads ONLY. Does not write or mutate any existing data file. Tolerates missing
// files (returns empty for that source) so the graph can be built from whatever
// data is present today. Shared by the backfill and validation scripts so both
// see identical inputs.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { CareerCalendarEvent } from "@/lib/ae-jobs/calendar";
import type { JobOpportunity } from "@/lib/ae-jobs/types";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import type { CompanySnapshot } from "@/lib/state/companySnapshotStore";
import type { ExecutionOutcome } from "./types";
import type { ProjectionInputs } from "./projection";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export interface LoadedInputCounts {
  opportunities: number;
  companies: number;
  contacts: number;
  calendarEvents: number;
  outcomes: number;
  contactFiles: string[];
}

export interface LoadedInputs {
  inputs: ProjectionInputs;
  counts: LoadedInputCounts;
}

/** Load every available source into a single ProjectionInputs bundle. */
export async function loadFileInputs(asOf: string, ownerId = "dylan"): Promise<LoadedInputs> {
  // AE job opportunities
  const oppFile = await readJson<{ opportunities?: JobOpportunity[] }>(
    path.join(DATA, "ae-jobs", "opportunities.json"),
  );
  const opportunities = oppFile?.opportunities ?? [];

  // Company snapshots (keyed object → values)
  const snapFile = await readJson<Record<string, CompanySnapshot>>(
    path.join(DATA, "companySnapshots.json"),
  );
  const companies = snapFile ? Object.values(snapFile) : [];

  // CRM contacts across every workspace file in data/crm-contacts/
  const contactsDir = path.join(DATA, "crm-contacts");
  const contactFiles = (await readDirSafe(contactsDir)).filter((f) => f.endsWith(".json")).sort();
  const contacts: CrmContactRecord[] = [];
  for (const file of contactFiles) {
    const parsed = await readJson<{ contacts?: CrmContactRecord[] }>(path.join(contactsDir, file));
    if (parsed?.contacts) contacts.push(...parsed.contacts);
  }

  // Career calendar events
  const calFile = await readJson<{ events?: CareerCalendarEvent[] }>(
    path.join(DATA, "ae-jobs", "calendar-events.json"),
  );
  const calendarEvents = calFile?.events ?? [];

  // Execution outcomes (may be absent — file mirror is not written in file mode).
  const outFile = await readJson<{
    byWorkspace?: Record<string, { history?: ExecutionOutcome[] }>;
  }>(path.join(DATA, "executionOutcomes.json"));
  const outcomes: ExecutionOutcome[] = [];
  if (outFile?.byWorkspace) {
    for (const ws of Object.values(outFile.byWorkspace)) {
      if (ws.history) outcomes.push(...ws.history);
    }
  }

  return {
    inputs: { opportunities, companies, contacts, calendarEvents, outcomes, ownerId, asOf },
    counts: {
      opportunities: opportunities.length,
      companies: companies.length,
      contacts: contacts.length,
      calendarEvents: calendarEvents.length,
      outcomes: outcomes.length,
      contactFiles,
    },
  };
}
