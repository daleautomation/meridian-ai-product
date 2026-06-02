import path from "node:path";
import { safeReadJson, safeWriteJson } from "@/lib/utils/fsSafeWrite";
import { seedOpportunities } from "./seed";
import type { AeJobsStoreFile, JobOpportunity, OpportunityChecklist } from "./types";

const DATA_PATH = path.join(process.cwd(), "data", "ae-jobs", "opportunities.json");
const DEFAULT_OWNER = "dylan";

export async function loadAeJobsStore(ownerId = DEFAULT_OWNER): Promise<AeJobsStoreFile> {
  const file = await safeReadJson<AeJobsStoreFile>(DATA_PATH);
  if (file?.version === 1 && Array.isArray(file.opportunities)) {
    const opportunities =
      file.opportunities.length > 0 ? file.opportunities : seedOpportunities();
    return {
      ...file,
      ownerId: file.ownerId || ownerId,
      opportunities,
    };
  }
  return {
    version: 1,
    ownerId,
    opportunities: seedOpportunities(),
    lastIngestedAt: null,
  };
}

export async function saveAeJobsStore(store: AeJobsStoreFile): Promise<boolean> {
  return safeWriteJson(DATA_PATH, store);
}

export async function listOpportunities(ownerId = DEFAULT_OWNER): Promise<JobOpportunity[]> {
  const store = await loadAeJobsStore(ownerId);
  return store.opportunities;
}

export async function updateOpportunityChecklist(
  opportunityId: string,
  checklist: Partial<OpportunityChecklist>,
  ownerId = DEFAULT_OWNER,
): Promise<JobOpportunity | null> {
  const store = await loadAeJobsStore(ownerId);
  const idx = store.opportunities.findIndex((o) => o.id === opportunityId);
  if (idx < 0) return null;
  const opp = store.opportunities[idx];
  store.opportunities[idx] = {
    ...opp,
    checklist: { ...opp.checklist, ...checklist },
    updatedAt: new Date().toISOString(),
  };
  await saveAeJobsStore(store);
  return store.opportunities[idx];
}

export async function updateOpportunityFields(
  opportunityId: string,
  patch: Partial<Pick<JobOpportunity, "nextAction" | "followUpDate" | "priority" | "stage" | "notes">>,
  ownerId = DEFAULT_OWNER,
): Promise<JobOpportunity | null> {
  const store = await loadAeJobsStore(ownerId);
  const idx = store.opportunities.findIndex((o) => o.id === opportunityId);
  if (idx < 0) return null;
  store.opportunities[idx] = {
    ...store.opportunities[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await saveAeJobsStore(store);
  return store.opportunities[idx];
}
