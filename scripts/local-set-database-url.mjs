#!/usr/bin/env node
/**
 * Safely set or update DATABASE_URL in .env.local.
 *
 * Two modes:
 *
 *   1. Interactive (default):
 *        node scripts/local-set-database-url.mjs
 *      Prompts for the connection string with terminal echo suppressed.
 *
 *   2. Pull from Vercel Production:
 *        node scripts/local-set-database-url.mjs --from-vercel-production
 *      Runs `vercel env pull` against the production environment to a
 *      temp file, extracts only DATABASE_URL, merges it into
 *      .env.local, deletes the temp file. Other vars in .env.local
 *      are untouched.
 *
 * Strict rules:
 *   • Never echoes or logs the connection string value.
 *   • Only prints the host with the first segment partly masked.
 *   • Rewrites only the DATABASE_URL line; preserves every other line.
 *   • Refuses to commit (it's just a writer; .gitignore covers .env.local).
 *   • Validates the scheme is postgresql:// or postgres://.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const ENV_FILE = path.resolve(".env.local");
const ARGS = process.argv.slice(2);
const FROM_VERCEL = ARGS.includes("--from-vercel-production");
const PUSH_TO_VERCEL = ARGS.includes("--push-to-vercel");
const VERCEL_TARGETS = ["production", "preview"];

function fail(message) {
  console.error(`[set-database-url] ${message}`);
  process.exit(1);
}

function validateConnectionString(value) {
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    fail("Connection string must start with postgresql:// or postgres://");
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) fail("Connection string has no host.");
    return parsed;
  } catch (err) {
    fail(`Connection string failed URL parse: ${err.message}`);
  }
}

function maskHost(hostname) {
  // Mask first segment past 3 chars; keep the suffix so the operator
  // can recognize the region/project without exposing identifying detail.
  const parts = hostname.split(".");
  if (parts.length === 0) return "***";
  const first = parts[0];
  const masked = first.length <= 3 ? "***" : `${first.slice(0, 3)}***`;
  return [masked, ...parts.slice(1)].join(".");
}

function mergeDatabaseUrl(existingText, newValue) {
  const line = `DATABASE_URL=${newValue}`;
  if (/^DATABASE_URL=.*$/m.test(existingText)) {
    return existingText.replace(/^DATABASE_URL=.*$/m, line);
  }
  const sep = existingText.endsWith("\n") || existingText === "" ? "" : "\n";
  return `${existingText}${sep}${line}\n`;
}

async function promptSecret(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Print the prompt before disabling echo.
    process.stdout.write(promptText);
    // Suppress all subsequent terminal output from readline so each
    // keystroke is NOT echoed (the user sees nothing as they paste).
    rl._writeToOutput = function () {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function readEnvLocal() {
  if (!fs.existsSync(ENV_FILE)) return "";
  return fs.readFileSync(ENV_FILE, "utf8");
}

function writeEnvLocal(text) {
  fs.writeFileSync(ENV_FILE, text, { encoding: "utf8", mode: 0o600 });
}

async function pullFromVercelProduction() {
  const tempFile = path.join(os.tmpdir(), `meridian-vercel-env-${Date.now()}.env`);
  try {
    execFileSync("npx", ["vercel", "env", "pull", tempFile, "--environment=production", "--yes"], {
      stdio: ["inherit", "ignore", "ignore"],
    });
  } catch (err) {
    fail(
      `vercel env pull failed (${err.message ?? err}). Ensure you are logged in via 'vercel whoami' and the project is linked.`,
    );
  }
  let pulled;
  try {
    pulled = fs.readFileSync(tempFile, "utf8");
  } catch (err) {
    fail(`Could not read pulled env file at ${tempFile}: ${err.message}`);
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // ignore
    }
  }
  const match = pulled.match(/^DATABASE_URL=(.*)$/m);
  if (!match) {
    fail(
      "DATABASE_URL was not present in the pulled production env. Verify in Vercel dashboard → meridian-ai-product → Settings → Environment Variables.",
    );
  }
  let value = match[1];
  // Vercel sometimes wraps the value in quotes; strip them.
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  }
  if (!value) {
    fail("DATABASE_URL pulled from production was an empty string. Set the value in Vercel first.");
  }
  return value;
}

async function main() {
  let value;
  if (FROM_VERCEL) {
    console.log("[set-database-url] pulling DATABASE_URL from Vercel production env…");
    value = await pullFromVercelProduction();
  } else {
    console.log("[set-database-url] paste the Neon pooled connection string. Input is hidden.");
    value = await promptSecret("DATABASE_URL: ");
    if (!value) fail("Empty input.");
  }

  const parsed = validateConnectionString(value);
  const existing = readEnvLocal();
  const next = mergeDatabaseUrl(existing, value);
  writeEnvLocal(next);

  console.log("[set-database-url] wrote DATABASE_URL into .env.local");
  console.log(`[set-database-url] host: ${maskHost(parsed.hostname)}`);
  console.log("[set-database-url] reminder: .env.local is gitignored. Never commit it.");

  if (PUSH_TO_VERCEL) {
    console.log("[set-database-url] pushing DATABASE_URL to Vercel (production + preview)…");
    for (const env of VERCEL_TARGETS) {
      // Remove any existing (likely empty) value first; --yes makes it
      // idempotent — env_not_found is a non-fatal "nothing to remove".
      const rm = spawnSync("npx", ["vercel", "env", "rm", "DATABASE_URL", env, "--yes"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (rm.status !== 0 && !/env_not_found|not found/i.test(rm.stderr?.toString() ?? "")) {
        fail(`vercel env rm DATABASE_URL ${env} failed: ${rm.stderr?.toString().slice(0, 200)}`);
      }
      // Pipe the value to `vercel env add` on stdin so it never appears
      // on the process command line or in shell history.
      const add = spawnSync("npx", ["vercel", "env", "add", "DATABASE_URL", env], {
        input: value + "\n",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (add.status !== 0) {
        fail(`vercel env add DATABASE_URL ${env} failed: ${add.stderr?.toString().slice(0, 200)}`);
      }
      console.log(`[set-database-url] pushed to Vercel ${env}`);
    }
  }
}

main().catch((err) => {
  console.error("[set-database-url] crashed");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
