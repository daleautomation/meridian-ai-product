// Validates AE Job OS domain model without starting the dev server.
import { buildAeJobsWorkspaceModel, groupByRoleCategory } from "../lib/ae-jobs/workspace";
import { seedOpportunities } from "../lib/ae-jobs/seed";
import { ROLE_CATEGORIES, CHECKLIST_KEYS } from "../lib/ae-jobs/types";

const user = { id: "dylan", name: "Dylan", accessRole: "admin_operator" as const, modules: ["roofing" as const], geo: [], workspaces: [] };

const opportunities = seedOpportunities();
const model = buildAeJobsWorkspaceModel(opportunities, user, null);
const groups = groupByRoleCategory(opportunities);

let failed = 0;
function check(label: string, ok: boolean) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

check("seed has opportunities", opportunities.length >= 5);
check("today actions surfaced", model.todayActions.length > 0);
check("role grouping covers categories", groups.length >= 3);
check("checklist keys defined", CHECKLIST_KEYS.length === 9);
check("role categories defined", ROLE_CATEGORIES.length === 5);

for (const cat of ROLE_CATEGORIES) {
  check(`summary counts ${cat}`, typeof model.summary.byCategory[cat] === "number");
}

for (const opp of opportunities) {
  for (const key of CHECKLIST_KEYS) {
    check(`${opp.id} checklist.${key}`, typeof opp.checklist[key] === "boolean");
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll AE Job OS checks passed.");
