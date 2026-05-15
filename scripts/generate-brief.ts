import { promises as fs } from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/ingestion/csvParser";
import { normalizeLead } from "../lib/leads/normalizedLead";
import { resolveContact } from "../lib/contacts/resolver";
import { decideNormalizedLead } from "../lib/scoring/decision";
import { safeWriteJson } from "../lib/utils/fsSafeWrite";
import { evaluateStaleness } from "../lib/recovery/staleness";
import { generateWhyNow } from "../lib/recovery/whyNow";
import { generateOpener } from "../lib/recovery/opener";
import { generatePriorityRead } from "../lib/recovery/priorityRead";
import { classifyDataQuality, isMetaNote, isVagueNote, normalizeExportRow } from "../lib/recovery/normalize";
import {
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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "brief";
}

function opportunityImpact(value: string | null | undefined): "high" | "medium" | "low" {
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

function pathConfidenceWeight(label: string | null | undefined): number {
  const lower = (label ?? "").toLowerCase();
  if (lower.includes("verified")) return 100;
  if (lower.includes("high")) return 85;
  if (lower.includes("medium")) return 65;
  if (lower.includes("low")) return 40;
  return 20;
}

function inferModuleFromIndustry(industry: string | null): string {
  const lower = (industry ?? "").toLowerCase();
  if (/roof|exterior/.test(lower)) return "roofing";
  if (/hvac|heating|cooling/.test(lower)) return "hvac";
  if (/plumb/.test(lower)) return "plumbing";
  if (/remodel|carpentry/.test(lower)) return "remodeling";
  return "roofing";
}

async function buildItem(row: CsvRow, index: number, now: Date): Promise<RecoveryBriefItem> {
  const r = normalizeExportRow(row);
  const companyName = r.companyName ?? `Company ${index + 1}`;
  const contactName = r.contactName;
  const location = r.location;
  const moduleId = inferModuleFromIndustry(r.industry);
  const quality = classifyDataQuality(r);

  // Drop notes that are either vague ("vm", "followed up") or meta-commentary
  // about data state ("no specific note", "was sourced from a directory").
  // Either type produces nonsense when templated as customer speech.
  const usableNote = (isVagueNote(r.lastNote) || isMetaNote(r.lastNote)) ? null : r.lastNote;
  const usableNextStep = (isVagueNote(r.nextStep) || isMetaNote(r.nextStep)) ? null : r.nextStep;

  const lead = normalizeLead({
    id: slugify(companyName),
    companyName,
    location: location ?? undefined,
    website: r.website ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    source: "manual",
    sourceStatus: "available",
    signals: { hasWebsite: r.website ? true : undefined, recentActivity: r.recentActivity ?? undefined },
    crm: { status: r.status ?? undefined, lastAction: usableNote ?? undefined, notes: usableNote ?? undefined },
  }, { workspaceSlug: "recovery-brief", moduleId });

  const contactResolution = await resolveContact({
    companyName,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    category: moduleId,
    website: r.website ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
  });
  const bestPath = contactResolution.paths.find((p) => p.verified) ?? contactResolution.paths[0];
  const verifiedContactPath = formatContactPath(bestPath);

  const staleness = evaluateStaleness({
    lastContactedAt: r.lastContactedAt ?? undefined,
    lastActivityAt: r.lastActivityAt ?? undefined,
    recentActivity: r.recentActivity ?? undefined,
    activityWindowDays: 30,
    now,
  });

  const decision = decideNormalizedLead({
    ...lead,
    phone: contactResolution.phone ?? lead.phone,
    email: contactResolution.email ?? lead.email,
  });

  const whyNow = generateWhyNow({
    companyName,
    daysSinceTouch: staleness.daysSinceTouch,
    staleCategory: staleness.staleCategory,
    recentActivity: r.recentActivity,
    activityLabel: r.activityLabel,
    lastNote: usableNote,
    nextStep: usableNextStep,
    crmStatus: r.status,
    lifecycleStage: r.lifecycleStage,
    dealStage: r.dealStage,
    industry: r.industry,
    hasVerifiedContactPath: Boolean(bestPath?.verified),
    dataQuality: quality,
  });

  const suggestedOpener = r.suggestedOpener ?? generateOpener({
    companyName,
    contactName,
    lastNote: usableNote,
    nextStep: usableNextStep,
    activityLabel: r.activityLabel,
    recentActivity: r.recentActivity,
    crmStatus: r.status,
    dealStage: r.dealStage,
    lifecycleStage: r.lifecycleStage,
    industry: r.industry,
    daysSinceTouch: staleness.daysSinceTouch,
    dataQuality: quality,
  });

  const priorityContext = generatePriorityRead({
    bucket: decision.bucket,
    staleCategory: staleness.staleCategory,
    daysSinceTouch: staleness.daysSinceTouch,
    lastNote: usableNote,
    nextStep: usableNextStep,
    activityLabel: r.activityLabel,
    opportunityLabel: r.opportunityLabel,
    priorityNote: r.priorityNote,
    crmStatus: r.status,
    dealStage: r.dealStage,
    lifecycleStage: r.lifecycleStage,
    industry: r.industry,
    hasVerifiedContactPath: Boolean(bestPath?.verified),
    companyName,
    dataQuality: quality,
  });

  const recoveryScore = Math.round(
    (staleness.staleScore * 0.45) +
    (decision.score * 0.40) +
    (pathConfidenceWeight(bestPath?.label ?? bestPath?.confidence ?? null) * 0.15),
  );

  const opportunityLabel = r.opportunityLabel ?? null;
  const primaryOpportunity = opportunityLabel
    ? {
        id: slugify(opportunityLabel),
        label: opportunityLabel,
        reason: r.priorityNote ?? "Specific commercial reason to reopen the relationship.",
        revenueImpact: opportunityImpact(decision.primaryOpportunity?.revenueImpact),
        services: [],
      }
    : undefined;

  return {
    rank: 0,
    companyName,
    contactName,
    location,
    relationshipFreshness: staleness.staleCategory,
    staleness,
    whyNow,
    verifiedContactPath,
    suggestedOpener,
    priorityContext,
    recoveryScore,
    decision: { bucket: decision.bucket, score: decision.score, primaryOpportunity },
  };
}

async function main() {
  const args = readArgs();
  const customer = args.get("customer");
  const csvPath = args.get("csv");
  const week = args.get("week") ?? isoWeek(new Date());
  const outputRoot = args.get("out") ?? "data/recovery-briefs";
  const topRaw = args.get("top");
  const topParsed = topRaw ? Number(topRaw) : Number.NaN;
  const top = Number.isFinite(topParsed) ? topParsed : 12;

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
