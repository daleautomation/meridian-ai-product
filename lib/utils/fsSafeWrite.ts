// Meridian AI — Safe filesystem write utility.
//
// Ensures directory exists, writes to tmp file, renames atomically.
// Never crashes the app on write failure — logs and continues.

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Safely write JSON data to a file path.
 * - Creates the parent directory if missing
 * - Writes to a .tmp file first, then renames (atomic)
 * - Never throws — logs errors and returns false on failure
 */
export async function safeWriteJson(filePath: string, data: unknown): Promise<boolean> {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.tmp`;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, filePath);
    return true;
  } catch (e) {
    console.error(`[safeWriteJson] failed to write ${filePath}:`, e);
    // Attempt cleanup of tmp file
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Safely read JSON from a file path.
 * Returns null if file doesn't exist or is unparseable.
 */
export async function safeReadJson<T = unknown>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.error(`[safeReadJson] failed to read ${filePath}:`, e);
    return null;
  }
}
