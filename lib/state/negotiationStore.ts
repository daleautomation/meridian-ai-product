// Meridian AI — file-based negotiation state persistence.
//
// Single JSON file at data/negotiation_state.json keyed by itemId. Atomic
// writes via temp-file-rename. Single-user dev assumption — no locking.
// Per-user namespacing not needed yet (each item id is unique to one owner
// in the current dataset).

import { promises as fs } from "node:fs";
import path from "node:path";
import { safeWriteJson } from "@/lib/utils/fsSafeWrite";
import type { NegotiationState } from "@/lib/scoring/acquisition";

export type StoredNegotiation = {
  negotiationState: NegotiationState;
  lastOfferSent?: number;
  lastUpdated: string;       // ISO timestamp
};

const STORE_PATH = path.join(process.cwd(), "data", "negotiation_state.json");

async function readAll(): Promise<Record<string, StoredNegotiation>> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("[negotiationStore] data/negotiation_state.json is not an object");
      return {};
    }
    return parsed as Record<string, StoredNegotiation>;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[negotiationStore] read failed", e);
    return {};
  }
}

async function writeAll(data: Record<string, StoredNegotiation>): Promise<void> {
  await safeWriteJson(STORE_PATH, data);
}

export async function getNegotiation(itemId: string): Promise<StoredNegotiation | null> {
  const all = await readAll();
  return all[itemId] ?? null;
}

export async function getAllNegotiations(): Promise<Record<string, StoredNegotiation>> {
  return readAll();
}

export async function setNegotiation(
  itemId: string,
  entry: { negotiationState: NegotiationState; lastOfferSent?: number }
): Promise<StoredNegotiation> {
  const all = await readAll();
  const stored: StoredNegotiation = {
    negotiationState: entry.negotiationState,
    lastOfferSent: entry.lastOfferSent,
    lastUpdated: new Date().toISOString(),
  };
  all[itemId] = stored;
  await writeAll(all);
  return stored;
}

export async function clearNegotiation(itemId: string): Promise<void> {
  const all = await readAll();
  if (itemId in all) {
    delete all[itemId];
    await writeAll(all);
  }
}
