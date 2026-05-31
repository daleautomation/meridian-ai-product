#!/usr/bin/env node
/**
 * Local heartbeat notification helper (macOS).
 * Reads brief-today.md, prints its path, and triggers a desktop notification.
 * No network · No secrets · No app data writes.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BRIEF_PATH = path.join(ROOT, "generated/heartbeat/brief-today.md");

if (!existsSync(BRIEF_PATH)) {
  console.error(`Brief not found: ${BRIEF_PATH}`);
  console.error("Run npm run heartbeat:run first.");
  process.exit(1);
}

readFileSync(BRIEF_PATH, "utf8");
console.log(BRIEF_PATH);

if (process.platform === "darwin") {
  execFileSync("osascript", [
    "-e",
    'display notification "Meridian brief is ready" with title "Meridian Heartbeat"',
  ]);
  console.log("Local notification sent.");
} else {
  console.log("Desktop notification skipped (macOS only).");
}
