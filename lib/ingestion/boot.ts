// Meridian AI — ingestion boot.
//
// Call once at server startup to begin continuous ingestion.
// Safe to call multiple times — the runner is a singleton.
//
// Usage in any server-side code:
//   import "@/lib/ingestion/boot";
//
// Or explicitly:
//   import { bootIngestion } from "@/lib/ingestion/boot";
//   bootIngestion();

import { startIngestionRunner, isRunnerActive } from "@/lib/ingestion/runner";

const INGESTION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const INGESTION_ENABLED = process.env.INGESTION_ENABLED !== "false";

export function bootIngestion(): void {
  if (!INGESTION_ENABLED) return;
  if (isRunnerActive()) return;

  startIngestionRunner({
    intervalMs: INGESTION_INTERVAL_MS,
    enabled: true,
    logging: true,
  });
}

// Auto-start when this module is imported on the server side.
// Guard against client-side imports (Next.js can accidentally import server code).
if (typeof globalThis.process !== "undefined" && globalThis.process.versions?.node) {
  bootIngestion();
}
