import { getRawTruthStoreMode, getTruthStoreMode } from "@/lib/truth/types";

export type NeonMutationIntent = {
  execute: boolean;
  confirmationEnv?: string | string[];
};

export type NeonMutationGuardOptions = NeonMutationIntent & {
  operation: string;
};

export const RUNTIME_NEON_MUTATION_INTENT: NeonMutationIntent = {
  execute: true,
  confirmationEnv: "MERIDIAN_NEON_WRITE_CONFIRM",
};

const DEFAULT_CONFIRMATION_ENVS = ["MERIDIAN_NEON_WRITE_CONFIRM"];
const loggedWriteOperations = new Set<string>();

function envTrue(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function requiredConfirmationEnvs(extra?: string | string[]): string[] {
  const values = Array.isArray(extra) ? extra : extra ? [extra] : [];
  return Array.from(new Set([...DEFAULT_CONFIRMATION_ENVS, ...values]));
}

export function assertNeonMutationAllowed(options: NeonMutationGuardOptions): void {
  const mode = getTruthStoreMode();
  const rawMode = getRawTruthStoreMode();
  if (mode === "file") {
    throw new Error(
      `Neon mutation blocked for ${options.operation}: MERIDIAN_TRUTH_STORE is ${rawMode ?? "unset"}; FILE MODE ACTIVE`,
    );
  }
  if (!options.execute) {
    throw new Error(`Neon mutation blocked for ${options.operation}: execute=true is required`);
  }

  const missing = requiredConfirmationEnvs(options.confirmationEnv).filter((name) => !envTrue(name));
  if (missing.length > 0) {
    throw new Error(`Neon mutation blocked for ${options.operation}: missing confirmation env(s): ${missing.join(", ")}`);
  }

  const key = `${mode}:${options.operation}`;
  if (!loggedWriteOperations.has(key)) {
    loggedWriteOperations.add(key);
    console.warn(`[truth-store] WRITE EXECUTION ENABLED: ${options.operation}`);
    console.warn(`[truth-store] NEON WRITE MODE ACTIVE: MERIDIAN_TRUTH_STORE=${mode}`);
  }
}
