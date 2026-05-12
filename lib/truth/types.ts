export type TruthStoreMode = "file" | "dual" | "neon";

export function getTruthStoreMode(): TruthStoreMode {
  const raw = process.env.MERIDIAN_TRUTH_STORE?.trim().toLowerCase();
  if (raw === "dual" || raw === "neon" || raw === "file") return raw;
  return "file";
}

export function dbReadFallbackEnabled(): boolean {
  return process.env.MERIDIAN_DB_READ_FALLBACK?.trim().toLowerCase() === "true";
}

export function dualWriteStrict(): boolean {
  return process.env.MERIDIAN_DUAL_WRITE_STRICT?.trim().toLowerCase() === "true";
}

export function shouldUseNeon(mode = getTruthStoreMode()): boolean {
  return mode === "dual" || mode === "neon";
}

export function shouldUseFile(mode = getTruthStoreMode()): boolean {
  return mode === "file" || mode === "dual";
}
