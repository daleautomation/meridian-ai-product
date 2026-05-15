import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/ingestion/csvParser";
import { normalizeLead } from "../lib/leads/normalizedLead";
import { resolveContact } from "../lib/contacts/resolver";
import { decideNormalizedLead } from "../lib/scoring/decision";
import { safeWriteJson } from "../lib/utils/fsSafeWrite";
import { evaluateStaleness } from "../lib/recovery/staleness";
import { generateWhyNow } from "../lib/recovery/whyNow";
import {
  buildSuggestedOpener,
  formatContactPath,
  renderRecoveryBriefHtml,
  type RecoveryBrief,
  type RecoveryBriefItem,
} from "../lib/recovery/brief";

type CsvRow = Record<string, string>;

function readArgs(): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, ...rest] = raw.slice(2).split("=");
    args.set(key, rest.join("=") || "true");
  }
  return args;
}

function get(row: CsvRow, ...names: string[]): string | undefined {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value.trim()]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    if (value) return value;
  }
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(normalized)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(normalized)) return false;
  return undefined;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief";
}

function opportunityImpact(value: string | undefined): "high" | "medium" | "low" {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function isoWeek(date: Date): string {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function contactScore(pathLabel: string): number {
  if (pathLabel.includes("(verified)")) return 100;
  if (pathLabel.includes("(high)")) return 85;
  if (pathLabel.includes("(medium)")) return 65;
  if (pathLabel.includes("(low)")) return 40;
  return 20;
}

function priorityContext(item: {
  staleScore: number;
  decisionScore: number;
  decisionBucket: string;
  opportunityLabel?: string;
  priorityNote?: string;
}): string {
  const action = item.decisionBucket === "Call now" ? "Call now" :
    item.decisionBucket === "Call this week" ? "Call this week" :
    item.decisionBucket === "Watch" ? "Soft touch only" :
    "Hold";
  const angle = item.opportunityLabel ? ` Lead with: ${item.opportunityLabel}.` : "";
  const note = item.priorityNote ? ` ${item.priorityNote}` : "";
  return `${action}. ${item.decisionScore}/100 fit with ${item.staleScore}/100 relationship staleness.${angle}${note}`;
}

async function buildItem(row: CsvRow, index: number, now: Date): Promise<RecoveryBriefItem> {
  const companyName = get(row, "companyName", "company", "company name") ?? `Company ${index + 1}`;
  const contactName = get(row, "contactName", "contact", "contact name") ?? null;
  const city = get(row, "city");
  const state = get(row, "state");
  const inferredLocation = [city, state].filter(Boolean).join(", ");
  const location = get(row, "location") ?? (inferredLocation || null);
  const category = get(row, "category", "trade", "module") ?? "roofing";
  const website = get(row, "website", "domain");
  const phone = get(row, "phone", "primaryPhone");
  const email = get(row, "email", "primaryEmail");
  const recentActivity = parseBoolean(get(row, "recentActivity", "recent activity"));
  const relationshipFreshness = get(row, "relationshipFreshness", "relationship freshness") ?? "unknown";

  const lead = normalizeLead({
    id: get(row, "id") ?? slugify(companyName),
    companyName,
    location: location ?? undefined,
    website,
    phone,
    email,
    source: "manual",
    sourceStatus: "available",
    signals: {
      hasWebsite: parseBoolean(get(row, "hasWebsite", "has website")) ?? (website ? true : undefined),
      websiteWeak: parseBoolean(get(row, "websiteWeak", "website weak")),
      recentActivity,
      reviewCount: parseNumber(get(row, "reviewCount", "reviews", "review count")),
      rating: parseNumber(get(row, "rating", "google rating")),
    },
    crm: {
      status: get(row, "crmStatus", "status"),
      lastAction: get(row, "crmLastAction", "lastAction", "last action"),
      notes: get(row, "notes"),
    },
  }, {
    workspaceSlug: "recovery-brief",
    moduleId: category,
  });

  const contactResolution = await resolveContact({
    companyName,
    city,
    state,
    category,
    website,
    phone,
    email,
    hasContactForm: parseBoolean(get(row, "hasContactForm", "has contact form")),
  });
  const bestPath = contactResolution.paths.find((pathItem) => pathItem.verified) ?? contactResolution.paths[0];
  const verifiedContactPath = formatContactPath(bestPath);
  const staleness = evaluateStaleness({
    lastContactedAt: get(row, "lastContactedAt", "last contacted", "last touch"),
    lastActivityAt: get(row, "lastActivityAt", "last activity"),
    recentActivity,
    relationshipFreshness,
    activityWindowDays: parseNumber(get(row, "activityWindowDays", "activity window days")),
    now,
  });
  const decision = decideNormalizedLead({
    ...lead,
    phone: contactResolution.phone ?? lead.phone,
    email: contactResolution.email ?? lead.email,
  });
  const whyNow = generateWhyNow({
    daysSinceTouch: staleness.daysSinceTouch,
    staleCategory: staleness.staleCategory,
    recentActivity,
    activityLabel: get(row, "activityLabel", "activity reason"),
    priorInterest: parseBoolean(get(row, "priorInterest", "prior interest")),
    relationshipFreshness,
    crmStatus: lead.crm.status,
    lastAction: lead.crm.lastAction,
    hasVerifiedContactPath: Boolean(bestPath?.verified),
  });
  const recoveryScore = Math.round(
    (staleness.staleScore * 0.45) +
    (decision.score * 0.40) +
    (contactScore(verifiedContactPath) * 0.15),
  );
  const opportunityLabel = get(row, "opportunityLabel", "opportunity label") ??
    decision.primaryOpportunity?.label;
  const priorityNote = get(row, "priorityNote", "priority note");
  const primaryOpportunity = opportunityLabel
    ? {
        id: slugify(opportunityLabel),
        label: opportunityLabel,
        reason: get(row, "opportunityReason", "opportunity reason") ?? priorityNote ?? "Specific commercial reason to reopen the relationship.",
        revenueImpact: opportunityImpact(get(row, "opportunityImpact", "opportunity impact")),
        services: [],
      }
    : decision.primaryOpportunity;

  return {
    rank: 0,
    companyName,
    contactName,
    location,
    relationshipFreshness: staleness.staleCategory,
    staleness,
    whyNow,
    verifiedContactPath,
    suggestedOpener: get(row, "suggestedOpener", "suggested opener", "opener") ??
      buildSuggestedOpener(companyName, contactName, whyNow),
    priorityContext: priorityContext({
      staleScore: staleness.staleScore,
      decisionScore: decision.score,
      decisionBucket: decision.bucket,
      opportunityLabel,
      priorityNote,
    }),
    recoveryScore,
    decision: {
      bucket: decision.bucket,
      score: decision.score,
      primaryOpportunity,
    },
  };
}

async function main() {
  const args = readArgs();
  const customer = args.get("customer");
  const csvPath = args.get("csv");
  const week = args.get("week") ?? isoWeek(new Date());
  const outputRoot = args.get("out") ?? "data/recovery-briefs";
  const top = parseNumber(args.get("top")) ?? 12;

  if (!customer || !csvPath) {
    throw new Error("Usage: npx tsx scripts/generate-brief.ts --customer=test --csv=fixtures/sample-recovery.csv");
  }

  const absoluteCsv = path.resolve(csvPath);
  const rows = parseCsv(await fs.readFile(absoluteCsv, "utf8"));
  const now = new Date();
  const built = await Promise.all(rows.map((row, index) => buildItem(row, index, now)));
  const sorted = built.sort((a, b) =>
    (b.recoveryScore - a.recoveryScore) ||
    (b.staleness.staleScore - a.staleness.staleScore) ||
    (b.decision.score - a.decision.score)
  );
  const eligible = sorted.filter((item) =>
    item.decision.bucket !== "Skip" &&
    item.staleness.staleCategory !== "Recently active"
  );
  const opportunities = (eligible.length > 0 ? eligible : sorted)
    .slice(0, top)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const brief: RecoveryBrief = {
    customer,
    week,
    generatedAt: now.toISOString(),
    sourceCsv: path.relative(process.cwd(), absoluteCsv),
    summary: {
      inputRows: rows.length,
      opportunities: opportunities.length,
      recoveryCandidates: opportunities.filter((item) => item.staleness.staleCategory === "Recovery candidate").length,
    },
    opportunities,
  };

  const outputDir = path.join(outputRoot, slugify(customer));
  const jsonPath = path.join(outputDir, `${week}.json`);
  const htmlPath = path.join(outputDir, `${week}.html`);
  const wroteJson = await safeWriteJson(jsonPath, brief);
  if (!wroteJson) throw new Error(`Failed to write ${jsonPath}`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(htmlPath, renderRecoveryBriefHtml(brief), "utf8");

  console.log(`Recovery Brief generated: ${jsonPath}`);
  console.log(`HTML preview generated: ${htmlPath}`);
  console.log(`Opportunities: ${brief.summary.opportunities}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
