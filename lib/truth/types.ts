export type TruthStoreMode = "file" | "dual" | "neon";

const loggedTruthStoreContexts = new Set<string>();

export function getTruthStoreMode(): TruthStoreMode {
  const raw = process.env.MERIDIAN_TRUTH_STORE?.trim().toLowerCase();
  if (raw === "dual" || raw === "neon" || raw === "file") return raw;
  return "file";
}

export function getRawTruthStoreMode(): string | null {
  return process.env.MERIDIAN_TRUTH_STORE?.trim().toLowerCase() || null;
}

export function neonEnvConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim());
}

export function logTruthStoreModeGuard(context: string, mode = getTruthStoreMode()): void {
  const neonEnv = neonEnvConfigured();
  const key = `${context}:${mode}:${neonEnv ? "neon-env" : "no-neon-env"}`;
  if (loggedTruthStoreContexts.has(key)) return;
  loggedTruthStoreContexts.add(key);

  if (mode === "file") {
    console.info(`[truth-store] FILE MODE ACTIVE: ${context}; Neon writes disabled`);
    if (neonEnv) {
      console.warn(`[truth-store] ${context}: Neon env vars are configured while file mode remains active`);
    }
    return;
  }

  console.info(`[truth-store] NEON WRITE MODE ACTIVE: ${context}; MERIDIAN_TRUTH_STORE=${mode}`);
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
