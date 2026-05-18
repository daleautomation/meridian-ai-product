// Meridian AI — company current-state persistence.
//
// Public API remains stable while Phase 1 can route current state to file,
// dual-write, or Neon via MERIDIAN_TRUTH_STORE.

import type { ContactResolution } from "@/lib/contacts/types";
import type { CompanyRef, ToolResult } from "@/lib/mcp/types";
import { dbReadFallbackEnabled, dualWriteStrict, getTruthStoreMode } from "@/lib/truth/types";
import {
  addNoteToFile,
  clearPaidPresenceOverrideFromFile,
  getSnapshotFromFile,
  listSnapshotsFromFile,
  logDealActionToFile,
  recordToolResultToFile,
  setContactPreferencesToFile,
  setNextActionToFile,
  setPaidPresenceOverrideToFile,
  setStatusToFile,
  upsertContactResolutionToFile,
  upsertPaidPresenceToFile,
  upsertProfileToFile,
} from "./companySnapshotFileAdapter";
import {
  getSnapshotFromNeon,
  listSnapshotsFromNeon,
  recordToolResultToNeon,
  setNextActionToNeon,
  setStatusToNeon,
} from "./companyCurrentStateNeonAdapter";

export type CompanyProfile = {
  name: string;
  domain?: string;
  url?: string;
  location?: string;
  placeId?: string;
  canonicalizedAt: string;
};

export type CompanyNote = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  tags?: string[];
};

export type StatusChange = {
  status: string;
  changedAt: string;
  changedBy: string;
  note?: string;
};

export type ScorePoint = {
  at: string;
  opportunityLevel: "HIGH" | "MEDIUM" | "LOW";
  confidence: number;
  recommendedAction: string;
  // Must reference deterministic scoring tools only. AI/Claude summaries are
  // assistive prose and are not allowed to write operational score history.
  sourceTool: string;
};

export type DealAction = {
  type: string;
  outcome?: string;
  note?: string;
  performedBy: string;
  performedAt: string;
};

export type PaidPresenceConfidence = "high" | "medium" | "low";
export type PaidPresenceSourceStatus = "confirmed" | "unknown" | "error";

export type PaidPresence = {
  googleAds: boolean | null;
  metaAds: boolean | null;
  confidence: PaidPresenceConfidence;
  asOf: string;
  evidenceUrls: string[];
  googleDetail?: string;
  metaDetail?: string;
  googleStatus?: PaidPresenceSourceStatus;
  metaStatus?: PaidPresenceSourceStatus;
  manualVerificationRequired?: boolean;
};

export type PaidPresenceOverride = {
  googleAds?: boolean | null;
  metaAds?: boolean | null;
  confidence?: PaidPresenceConfidence;
  note?: string;
  evidenceUrls?: string[];
  updatedAt: string;
  updatedBy?: string;
};

export type CompanySnapshot = {
  key: string;
  company: CompanyRef;
  createdAt: string;
  updatedAt: string;
  latest: Record<string, ToolResult<unknown>>;
  history: Array<{ tool: string; timestamp: string; result: ToolResult<unknown> }>;
  profile?: CompanyProfile;
  status?: string;
  statusHistory?: StatusChange[];
  notes?: CompanyNote[];
  scoreHistory?: ScorePoint[];
  lastCheckedAt?: string;
  lastAction?: DealAction;
  nextAction?: string;
  nextActionDate?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  dealActions?: DealAction[];
  callAttempts?: number;
  consecutiveNoAnswers?: number;
  lastAttemptType?: string;
  lastAttemptOutcome?: string;
  escalationStage?: number;
  contactResolution?: ContactResolution;
  contactResolutionCheckedAt?: string;
  preferredPhone?: string;
  preferredEmail?: string;
  preferredContactName?: string;
  preferredContactRole?: string;
  preferredContactSource?: string;
  contactNotes?: string;
  preferredUpdatedAt?: string;
  preferredUpdatedBy?: string;
  trade?: string;
  serviceBucket?: string;
  paidPresence?: PaidPresence;
  paidPresenceCheckedAt?: string;
  paidPresenceOverride?: PaidPresenceOverride;
};

export type ContactPreferencesUpdate = {
  preferredPhone?: string;
  preferredEmail?: string;
  preferredContactName?: string;
  preferredContactRole?: string;
  preferredContactSource?: string;
  contactNotes?: string;
  performedBy: string;
};

function mergeSnapshots(fileRows: CompanySnapshot[], neonRows: CompanySnapshot[]): CompanySnapshot[] {
  const byKey = new Map<string, CompanySnapshot>();
  for (const row of fileRows) byKey.set(row.key, row);
  for (const row of neonRows) byKey.set(row.key, row);
  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getSnapshot(company: CompanyRef): Promise<CompanySnapshot | null> {
  const mode = getTruthStoreMode();
  if (mode === "file") return getSnapshotFromFile(company);
  try {
    const neonHit = await getSnapshotFromNeon(company);
    if (neonHit || !dbReadFallbackEnabled()) return neonHit;
  } catch (err) {
    if (!dbReadFallbackEnabled()) throw err;
    console.error("[companySnapshotStore] Neon getSnapshot failed; falling back to file", err);
  }
  return getSnapshotFromFile(company);
}

export async function listSnapshots(): Promise<CompanySnapshot[]> {
  const mode = getTruthStoreMode();
  if (mode === "file") return listSnapshotsFromFile();
  try {
    const neonRows = await listSnapshotsFromNeon();
    if (!dbReadFallbackEnabled()) return neonRows;
    const fileRows = await listSnapshotsFromFile();
    return mergeSnapshots(fileRows, neonRows);
  } catch (err) {
    if (!dbReadFallbackEnabled()) throw err;
    console.error("[companySnapshotStore] Neon listSnapshots failed; falling back to file", err);
    return listSnapshotsFromFile();
  }
}

export async function recordToolResult<T>(
  company: CompanyRef,
  result: ToolResult<T>,
): Promise<CompanySnapshot> {
  const mode = getTruthStoreMode();
  if (mode === "file") return recordToolResultToFile(company, result);
  if (mode === "neon") return recordToolResultToNeon(company, result);
  try {
    const neonResult = await recordToolResultToNeon(company, result);
    await recordToolResultToFile(company, result).catch((err) => {
      console.error("[companySnapshotStore] dual file recordToolResult failed", err);
    });
    return neonResult;
  } catch (err) {
    console.error("[companySnapshotStore] dual Neon recordToolResult failed", err);
    if (dualWriteStrict()) throw err;
    return recordToolResultToFile(company, result);
  }
}

export async function setStatus(
  company: CompanyRef,
  change: { status: string; changedBy: string; note?: string },
): Promise<{ snapshot: CompanySnapshot; change: StatusChange }> {
  const mode = getTruthStoreMode();
  if (mode === "file") return setStatusToFile(company, change);
  if (mode === "neon") return setStatusToNeon(company, change);
  try {
    const neonResult = await setStatusToNeon(company, change);
    await setStatusToFile(company, change).catch((err) => {
      console.error("[companySnapshotStore] dual file setStatus failed", err);
    });
    return neonResult;
  } catch (err) {
    console.error("[companySnapshotStore] dual Neon setStatus failed", err);
    if (dualWriteStrict()) throw err;
    return setStatusToFile(company, change);
  }
}

export async function setNextAction(
  company: CompanyRef,
  update: { nextAction: string; nextActionDate?: string; contactName?: string; contactPhone?: string; contactEmail?: string },
): Promise<CompanySnapshot> {
  const mode = getTruthStoreMode();
  if (mode === "file") return setNextActionToFile(company, update);
  if (mode === "neon") return setNextActionToNeon(company, update);
  try {
    const neonResult = await setNextActionToNeon(company, update);
    await setNextActionToFile(company, update).catch((err) => {
      console.error("[companySnapshotStore] dual file setNextAction failed", err);
    });
    return neonResult;
  } catch (err) {
    console.error("[companySnapshotStore] dual Neon setNextAction failed", err);
    if (dualWriteStrict()) throw err;
    return setNextActionToFile(company, update);
  }
}

// Out-of-scope Phase 1 fields keep using the local file adapter so this
// migration does not become a full CRM/snapshot rewrite.
export async function upsertProfile(
  company: CompanyRef,
  profile: Partial<Omit<CompanyProfile, "canonicalizedAt">>,
): Promise<CompanySnapshot> {
  return upsertProfileToFile(company, profile);
}

export async function addNote(
  company: CompanyRef,
  note: { author: string; body: string; tags?: string[] },
): Promise<{ snapshot: CompanySnapshot; note: CompanyNote }> {
  return addNoteToFile(company, note);
}

export async function logDealAction(
  company: CompanyRef,
  action: Omit<DealAction, "performedAt"> & { performedAt?: string },
): Promise<{ snapshot: CompanySnapshot; action: DealAction }> {
  return logDealActionToFile(company, action);
}

export async function upsertContactResolution(
  company: CompanyRef,
  resolution: ContactResolution,
): Promise<CompanySnapshot> {
  return upsertContactResolutionToFile(company, resolution);
}

export async function upsertPaidPresence(
  company: CompanyRef,
  presence: PaidPresence,
): Promise<CompanySnapshot> {
  return upsertPaidPresenceToFile(company, presence);
}

export async function setPaidPresenceOverride(
  company: CompanyRef,
  override: PaidPresenceOverride,
): Promise<CompanySnapshot> {
  return setPaidPresenceOverrideToFile(company, override);
}

export async function clearPaidPresenceOverride(company: CompanyRef): Promise<CompanySnapshot | null> {
  return clearPaidPresenceOverrideFromFile(company);
}

export async function setContactPreferences(
  company: CompanyRef,
  update: ContactPreferencesUpdate,
): Promise<CompanySnapshot> {
  return setContactPreferencesToFile(company, update);
}
