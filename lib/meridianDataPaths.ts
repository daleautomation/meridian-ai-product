// Bounded repo `data/` paths for Turbopack NFT (single scoped process.cwd() join).

import path from "node:path";

export const MERIDIAN_DATA_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
);

export const USAGE_EVENTS_LOG_PATH = path.join(MERIDIAN_DATA_DIR, "usage-events.jsonl");
