#!/usr/bin/env node
/**
 * Safely set or update HUNTER_API_KEY in .env.local — and optionally
 * push the same value to Vercel Production + Preview.
 *
 * Mirrors scripts/local-set-database-url.mjs: terminal echo
 * suppressed, surgical merge that touches only the HUNTER_API_KEY
 * line, no value ever printed or echoed.
 *
 * Usage:
 *   node scripts/local-set-hunter-key.mjs                  # interactive, local only
 *   node scripts/local-set-hunter-key.mjs --push-to-vercel # interactive + push
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ENV_FILE = path.resolve(".env.local");
const ARGS = process.argv.slice(2);
const PUSH = ARGS.includes("--push-to-vercel");
const VERCEL_TARGETS = ["production", "preview"];
const RAW_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

function fail(message) {
  console.error(`[set-hunter-key] ${message}`);
  process.exit(1);
}

function validate(value) {
  if (!value) fail("Empty input.");
  if (value.length < 20) fail("Hunter API keys are normally 30+ chars; rejecting suspiciously short value.");
  if (!RAW_KEY_PATTERN.test(value)) fail("Value must contain only [A-Za-z0-9_-].");
  if (/api\.hunter\.io|api_key=/i.test(value)) fail("Value looks like a Hunter request URL, not a raw key.");
  return value;
}

function mergeLine(existing, name, line) {
  const re = new RegExp(`^${name}=.*$`, "m");
  if (re.test(existing)) return existing.replace(re, line);
  const sep = existing.endsWith("\n") || existing === "" ? "" : "\n";
  return `${existing}${sep}${line}\n`;
}

async function promptSecret(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    process.stdout.write(promptText);
    rl._writeToOutput = function () {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("[set-hunter-key] paste your Hunter API key from hunter.io → Account → API. Input is hidden.");
  const value = validate(await promptSecret("HUNTER_API_KEY: "));

  // Write to .env.local surgically.
  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  const next = mergeLine(existing, "HUNTER_API_KEY", `HUNTER_API_KEY=${value}`);
  fs.writeFileSync(ENV_FILE, next, { encoding: "utf8", mode: 0o600 });
  console.log("[set-hunter-key] wrote HUNTER_API_KEY into .env.local (only that line touched).");
  console.log(`[set-hunter-key] key length: ${value.length}, prefix=${value.slice(0, 4)}***`);

  if (PUSH) {
    console.log("[set-hunter-key] pushing HUNTER_API_KEY to Vercel (production + preview)…");
    for (const env of VERCEL_TARGETS) {
      // Remove any existing (likely empty) value first; ignore env_not_found.
      const rm = spawnSync("npx", ["vercel", "env", "rm", "HUNTER_API_KEY", env, "--yes"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const rmErr = (rm.stderr?.toString() ?? "").replace(/<claude-code-hint[^>]*\/>/g, "");
      if (rm.status !== 0 && !/env_not_found|not found/i.test(rmErr)) {
        console.warn(`[set-hunter-key] rm ${env} non-fatal warning: ${rmErr.slice(0, 200)}`);
      }
      const add = spawnSync("npx", ["vercel", "env", "add", "HUNTER_API_KEY", env], {
        input: value + "\n",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (add.status !== 0) {
        const e = (add.stderr?.toString() ?? "").replace(/<claude-code-hint[^>]*\/>/g, "");
        fail(`vercel env add HUNTER_API_KEY ${env} failed: ${e.slice(0, 200)}`);
      }
      console.log(`[set-hunter-key] pushed to Vercel ${env}`);
    }
    console.log("[set-hunter-key] remember to redeploy so the new value reaches runtime: npx vercel --prod");
  }
}

main().catch((err) => {
  console.error("[set-hunter-key] crashed");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
