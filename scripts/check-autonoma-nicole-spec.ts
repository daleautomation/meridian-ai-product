/**
 * Validates autonoma/tests/*.md files exist and cover required Nicole UI checks.
 * No network — repo structure only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = path.join(ROOT, "autonoma", "tests");

const REQUIRED = [
  "00-login-nicole-workspace.md",
  "01-relationship-primary-labels.md",
  "02-crm-only-no-opportunity-language.md",
  "03-reachability-recency-confidence-badges.md",
  "04-card-opens-detail-panel.md",
  "05-not-reachable-not-at-top.md",
  "06-mobile-layout-no-overflow.md",
];

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, "autonoma", "README.md"))) {
  fail("autonoma/README.md missing");
}

for (const file of REQUIRED) {
  const full = path.join(TEST_DIR, file);
  if (!fs.existsSync(full)) fail(`missing ${file}`);
  const body = fs.readFileSync(full, "utf8");
  if (!body.startsWith("---")) fail(`${file}: missing YAML frontmatter`);
  if (!body.includes("url:")) fail(`${file}: missing url in frontmatter`);
}

console.log(`✓ autonoma Nicole spec: ${REQUIRED.length} tests present`);
