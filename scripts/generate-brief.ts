import { promises as fs } from "node:fs";
import path from "node:path";
import brooksideConfig from "../config/signals/nicole-lonergan";
import labortechConfig from "../config/signals/labortech";
import { parseCsv } from "../lib/ingestion/csvParser";
import { normalizeLead } from "../lib/leads/normalizedLead";
import { resolveContact } from "../lib/contacts/resolver";
import { companyKey } from "../lib/mcp/types";
import { safeWriteJson } from "../lib/utils/fsSafeWrite";
import { evaluateStaleness } from "../lib/recovery/staleness";
import { generateWhyNow, type WhyNowInput } from "../lib/recovery/whyNow";
import { computeRecoveryDecision } from "../lib/recovery/decisionScore";
import { evaluateLead, rankLeads } from "../lib/recovery/signals/evaluator";
import type {
  RecoverySignal,
  SignalDefinition,
  WorkspaceSignalConfig,
} from "../lib/recovery/signals/types";
import {
  buildSuggestedOpener,
  formatContactPath,
  renderRecoveryBriefHtml,
  type FounderReviewSummary,
  type RecoveryBrief,
  type RecoveryBriefItem,
} from "../lib/recovery/brief";
import { adaptWiseAgentRows, isWiseAgentExport } from "../lib/recovery/wiseAgentRowAdapter";
import {
  buildPropertyEnrichmentSignals,
  parsePropertyEnrichmentFromRow,
} from "../lib/enrichment/brookside";

type CsvRow = Record<string, string>;

type BuiltLead = {
  item: Omit<
    RecoveryBriefItem,
    | "score"
    | "weakOnly"
    | "headlineSignal"
    | "signalContributions"
    | "scoreBreakdown"
    | "whyNow"
    | "priorityContext"
  >;
  signals: RecoverySignal[];
  whyNowInput: WhyNowInput;
  priorityNote?: string;
  opportunityLabel?: string;
  customOpener?: string;
};

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

/** CRM provenance label from export metadata (e.g. wise_agent), never invented. */
function crmSourceFromRow(row: CsvRow): string {
  const raw = get(row, "sourceCrm", "source crm", "source") ?? "hubspot";
  const norm = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (norm.startsWith("crm:")) return norm;
  return `crm:${norm}`;
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

/** Deterministic evaluation instant from ISO week (Monday 12:00 UTC). */
function weekAnchorIso(week: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(week.trim());
  if (!match) return "1970-01-01T12:00:00.000Z";
  const year = Number(match[1]);
  const weekNum = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (weekNum - 1) * 7);
  weekStart.setUTCHours(12, 0, 0, 0);
  return weekStart.toISOString();
}

function resolveNowIso(args: Map<string, string>, week: string): string {
  const explicit = args.get("now");
  if (explicit) return explicit;
  return weekAnchorIso(week);
}

function resolveWorkspaceConfig(
  customer: string,
  category: string,
  args: Map<string, string>,
): WorkspaceSignalConfig {
  const customerSlug = slugify(customer);
  const workspaceArg = argsWorkspaceSlug(args);
  if (workspaceArg === "labortech") return labortechConfig;
  if (workspaceArg === "nicole-lonergan") return brooksideConfig;
  if (customerSlug.includes("labor") || customerSlug === "labortech" || customerSlug === "john") {
    return labortechConfig;
  }
  if (
    customerSlug.includes("brookside") ||
    customerSlug.includes("nicole") ||
    customerSlug === "nicole-lonergan"
  ) {
    return brooksideConfig;
  }
  if (category.trim().toLowerCase() === "roofing") return labortechConfig;
  return brooksideConfig;
}

function argsWorkspaceSlug(args: Map<string, string>): string | undefined {
  const value = args.get("workspace");
  return value ? slugify(value) : undefined;
}

function contactScore(path: { verified?: boolean; confidence?: string } | undefined): number {
  if (!path) return 20;
  if (path.verified) return 100;
  const confidence = (path.confidence ?? "").toLowerCase();
  if (confidence === "high") return 85;
  if (confidence === "medium") return 65;
  if (confidence === "low") return 40;
  return 20;
}

function priorityContext(item: {
  staleScore: number;
  decisionScore: number;
  decisionBucket: string;
  opportunityLabel?: string;
  priorityNote?: string;
  weakOnly: boolean;
}): string {
  if (item.weakOnly) {
    return "Soft touch only. Limited signals on file — keep outreach narrow and factual.";
  }

  const action =
    item.decisionBucket === "Call now" ? "Call now" :
    item.decisionBucket === "Call this week" ? "Call this week" :
    item.decisionBucket === "Watch" ? "Soft touch only" :
    "Hold";

  const note = item.priorityNote?.trim();
  if (note) {
    const punctuated = /[.!?]$/.test(note) ? note : `${note}.`;
    return `${action}. ${punctuated}`;
  }

  const label = item.opportunityLabel?.trim();
  if (label) {
    const lowered = label.charAt(0).toLowerCase() + label.slice(1);
    return `${action}. Lead with the ${lowered} angle as the cleanest reason to revisit.`;
  }

  const fallback =
    item.decisionBucket === "Call now"
      ? "Worth a single, specific check-in this week — keep the ask narrow."
      : item.decisionBucket === "Call this week"
        ? "Schedule a brief, low-pressure check-in this week."
        : item.decisionBucket === "Watch"
          ? "Keep the thread warm without forcing a meeting."
          : "Hold for now — no fresh signal to lead with.";
  return `${action}. ${fallback}`;
}

function toIso8601(value: string | undefined, fallbackIso: string): string | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function lookupSignalDef(config: WorkspaceSignalConfig, name: string): SignalDefinition | undefined {
  return config.signals.find((def) => def.name === name);
}

function makeAdapterSignal(
  config: WorkspaceSignalConfig,
  name: string,
  leadKey: string,
  recordId: string,
  observedAt: string,
  overrides: Partial<RecoverySignal> = {},
): RecoverySignal | null {
  const def = lookupSignalDef(config, name);
  if (!def) return null;

  return {
    id: overrides.id ?? `adapter:${config.slug}:${leadKey}:${name}`,
    name: def.name,
    category: overrides.category ?? def.category,
    source: overrides.source ?? def.source,
    sourceTier: overrides.sourceTier ?? def.sourceTier,
    recordId,
    observedAt,
    confidence:
      overrides.confidence ??
      (def.sourceTier === "WEAK" ? "WEAK" : def.sourceTier === "MED" ? "MED" : "HIGH"),
    halfLifeDays: overrides.halfLifeDays ?? def.defaultHalfLifeDays,
    weight: overrides.weight ?? def.defaultWeight,
    evidenceUrl: overrides.evidenceUrl ?? null,
    payload: overrides.payload ?? { leadKey },
    workspaceSlug: config.slug,
    status: overrides.status ?? "active",
    explanation: overrides.explanation ?? null,
    evidenceLabel: overrides.evidenceLabel ?? null,
    sourceUrl: overrides.sourceUrl ?? null,
  };
}

function isQualifiedCrmStatus(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["qualified", "open", "proposal", "demo", "interested", "warm"].includes(normalized);
}

/**
 * Maps existing CSV / resolver fields into RecoverySignal[] for the evaluator.
 * Only emits signals backed by row data or contact resolution — no invented sources.
 */
function buildRecoverySignalsFromRow(input: {
  row: CsvRow;
  config: WorkspaceSignalConfig;
  leadKey: string;
  nowIso: string;
  lastContactedAt?: string;
  lastActivityAt?: string;
  crmLastAction?: string | null;
  crmStatus?: string | null;
  priorInterest?: boolean | null;
  hasVerifiedPhone: boolean;
  hasVerifiedEmail: boolean;
  reviewCount?: number;
  rating?: number;
  websiteWeak?: boolean;
  hasWebsite?: boolean;
}): RecoverySignal[] {
  const signals: RecoverySignal[] = [];
  const crmSource = crmSourceFromRow(input.row);
  const staleName =
    input.config.slug === "labortech" ? "stale_operator_touch" : "stale_relationship";

  const touchIso =
    toIso8601(input.lastContactedAt, input.nowIso) ??
    toIso8601(input.lastActivityAt, input.nowIso);

  if (touchIso) {
    const stale = makeAdapterSignal(
      input.config,
      staleName,
      input.leadKey,
      `crm-touch:${input.leadKey}`,
      touchIso,
      {
        source: crmSource,
        recordId: `last-touch:${input.leadKey}`,
        explanation: `Last meaningful touch recorded on ${touchIso}.`,
      },
    );
    if (stale) signals.push(stale);
  }

  const crmObserved =
    toIso8601(get(input.row, "crmInterestObservedAt", "crm interest observed at"), input.nowIso) ??
    touchIso ??
    input.nowIso;

  if (input.priorInterest === true || isQualifiedCrmStatus(input.crmStatus)) {
    const crmSignal = makeAdapterSignal(
      input.config,
      "crm_interest_signal",
      input.leadKey,
      input.crmLastAction?.trim() || `interest:${input.leadKey}`,
      crmObserved,
      {
        source: crmSource,
        recordId: input.crmLastAction?.trim() || `interest:${input.leadKey}`,
      },
    );
    if (crmSignal) signals.push(crmSignal);
  }

  const priorClientAt = toIso8601(
    get(input.row, "priorClientClosedAt", "prior client closed at", "lastClosedAt"),
    input.nowIso,
  );
  if (priorClientAt && input.config.slug === "nicole-lonergan") {
    const prior = makeAdapterSignal(
      input.config,
      "prior_client_recency",
      input.leadKey,
      `closing:${input.leadKey}`,
      priorClientAt,
      { source: crmSource },
    );
    if (prior) signals.push(prior);
  }

  if (input.hasVerifiedPhone) {
    const phoneAt = touchIso ?? input.nowIso;
    const phone = makeAdapterSignal(
      input.config,
      "verified_phone",
      input.leadKey,
      `phone:${input.leadKey}`,
      phoneAt,
      { source: crmSource },
    );
    if (phone) signals.push(phone);
  }

  if (input.hasVerifiedEmail) {
    const emailAt = touchIso ?? input.nowIso;
    const email = makeAdapterSignal(
      input.config,
      "verified_email",
      input.leadKey,
      `email:${input.leadKey}`,
      emailAt,
      { source: "hunter.io" },
    );
    if (email) signals.push(email);
  }

  if (input.config.slug === "labortech") {
    if (typeof input.rating === "number" && input.rating > 0 && input.rating < 4.0) {
      const ratingAt =
        toIso8601(get(input.row, "ratingObservedAt", "places observed at"), input.nowIso) ?? input.nowIso;
      const lowRating = makeAdapterSignal(
        input.config,
        "weak_google_rating",
        input.leadKey,
        `places:${input.leadKey}`,
        ratingAt,
        { source: "google_places" },
      );
      if (lowRating) signals.push(lowRating);
    }

    if (typeof input.reviewCount === "number" && input.reviewCount >= 25) {
      const reviewsAt =
        toIso8601(get(input.row, "reviewObservedAt", "places observed at"), input.nowIso) ?? input.nowIso;
      const reviews = makeAdapterSignal(
        input.config,
        "high_review_count",
        input.leadKey,
        `reviews:${input.reviewCount}`,
        reviewsAt,
        { source: "google_places" },
      );
      if (reviews) signals.push(reviews);
    }

    if (input.websiteWeak === true) {
      const scanAt =
        toIso8601(get(input.row, "websiteScanAt", "website scan at"), input.nowIso) ?? input.nowIso;
      const gap = makeAdapterSignal(
        input.config,
        "website_quality_gap",
        input.leadKey,
        `scan:${input.leadKey}`,
        scanAt,
        { source: "website:quality_scan" },
      );
      if (gap) signals.push(gap);
    }

    if (input.hasWebsite === false) {
      const scanAt =
        toIso8601(get(input.row, "websiteScanAt", "website scan at"), input.nowIso) ?? input.nowIso;
      const missing = makeAdapterSignal(
        input.config,
        "missing_google_business_profile",
        input.leadKey,
        `gbp:${input.leadKey}`,
        scanAt,
        { source: "google_places" },
      );
      if (missing) signals.push(missing);
    }
  }

  appendExplicitRowSignals(signals, input.row, input.config, input.leadKey, input.nowIso);

  if (input.config.slug === "nicole-lonergan") {
    const staleTouch =
      toIso8601(input.lastContactedAt, input.nowIso) ??
      toIso8601(input.lastActivityAt, input.nowIso);
    const enrichment = parsePropertyEnrichmentFromRow(input.row, {
      staleRelationshipObservedAt: staleTouch,
    });
    if (enrichment) {
      signals.push(
        ...buildPropertyEnrichmentSignals({
          enrichment,
          config: input.config,
          leadKey: input.leadKey,
          nowIso: input.nowIso,
        }),
      );
    }
  }

  return signals;
}

/** Optional CSV columns: signalName + ObservedAt / RecordId / EvidenceUrl for fixture HIGH signals. */
function appendExplicitRowSignals(
  out: RecoverySignal[],
  row: CsvRow,
  config: WorkspaceSignalConfig,
  leadKey: string,
  nowIso: string,
): void {
  for (const def of config.signals) {
    const observedKey = `${def.name}ObservedAt`;
    const observedAt = toIso8601(get(row, observedKey, `${def.name} observed at`), nowIso);
    if (!observedAt) continue;

    const enabled = parseBoolean(get(row, `${def.name}Present`, `${def.name} present`));
    if (enabled === false) continue;

    const recordId =
      get(row, `${def.name}RecordId`, `${def.name} record id`) ??
      `${def.name}:${leadKey}`;
    const evidenceUrl = get(row, `${def.name}EvidenceUrl`, `${def.name} evidence url`) ?? null;

    const signal = makeAdapterSignal(config, def.name, leadKey, recordId, observedAt, {
      evidenceUrl,
      id: `csv:${config.slug}:${leadKey}:${def.name}`,
    });
    if (signal) out.push(signal);
  }
}

function attachSignalEvaluation(
  built: BuiltLead,
  config: WorkspaceSignalConfig,
  nowIso: string,
): RecoveryBriefItem {
  const ranked = evaluateLead(built.signals, config, nowIso, built.item.leadKey);
  const scoreBreakdown = {
    leadKey: ranked.leadKey,
    totalScore: ranked.score,
    contributions: ranked.contributions,
    evaluatedAt: nowIso,
  };

  const whyNow = generateWhyNow({
    ...built.whyNowInput,
    weakOnly: ranked.weakOnly,
    headlineSignal: ranked.headlineSignal,
  });

  return {
    ...built.item,
    whyNow,
    score: ranked.score,
    weakOnly: ranked.weakOnly,
    headlineSignal: ranked.headlineSignal,
    signalContributions: ranked.contributions,
    scoreBreakdown,
    priorityContext: priorityContext({
      staleScore: built.item.staleness.staleScore,
      decisionScore: built.item.decision.score,
      decisionBucket: built.item.decision.bucket,
      opportunityLabel: built.opportunityLabel,
      priorityNote: built.priorityNote,
      weakOnly: ranked.weakOnly,
    }),
    suggestedOpener:
      built.customOpener ??
      buildSuggestedOpener(built.item.companyName, built.item.contactName, whyNow),
  };
}

async function buildLead(row: CsvRow, index: number, nowIso: string, config: WorkspaceSignalConfig): Promise<BuiltLead> {
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
  const leadKey = companyKey({ name: companyName });
  const now = new Date(nowIso);

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
    workspaceSlug: config.slug,
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

  const priorInterestFlag = parseBoolean(get(row, "priorInterest", "prior interest")) ?? null;
  const activityLabelText = get(row, "activityLabel", "activity reason") ?? null;
  const decision = computeRecoveryDecision({
    lastNote: lead.crm.lastAction ?? null,
    nextStep: get(row, "nextStep", "next step", "next action") ?? null,
    activityLabel: activityLabelText,
    priorInterest: priorInterestFlag,
    crmStatus: lead.crm.status ?? null,
    hasVerifiedContactPath: Boolean(bestPath?.verified),
  }, staleness.staleScore);

  const recoveryScore = Math.round(
    (staleness.staleScore * 0.50) +
    (decision.score * 0.25) +
    (contactScore(bestPath) * 0.25),
  );

  const opportunityLabel = get(row, "opportunityLabel", "opportunity label") ?? null;
  const priorityNote = get(row, "priorityNote", "priority note");
  const primaryOpportunity = opportunityLabel
    ? {
        id: slugify(opportunityLabel),
        label: opportunityLabel,
        reason: get(row, "opportunityReason", "opportunity reason") ?? priorityNote ?? "Specific commercial reason to reopen the relationship.",
        revenueImpact: opportunityImpact(get(row, "opportunityImpact", "opportunity impact")),
        services: [],
      }
    : undefined;

  const lastContactedAt = get(row, "lastContactedAt", "last contacted", "last touch");
  const lastActivityAt = get(row, "lastActivityAt", "last activity");
  const pathMethod = (bestPath?.method ?? "").toLowerCase();
  const signals = buildRecoverySignalsFromRow({
    row,
    config,
    leadKey,
    nowIso,
    lastContactedAt,
    lastActivityAt,
    crmLastAction: lead.crm.lastAction ?? null,
    crmStatus: lead.crm.status ?? null,
    priorInterest: priorInterestFlag,
    hasVerifiedPhone: Boolean(bestPath?.verified && pathMethod.includes("phone")),
    hasVerifiedEmail: Boolean(bestPath?.verified && pathMethod.includes("email")),
    reviewCount: lead.signals.reviewCount,
    rating: lead.signals.rating,
    websiteWeak: lead.signals.websiteWeak,
    hasWebsite: lead.signals.hasWebsite,
  });

  const whyNowInput: WhyNowInput = {
    daysSinceTouch: staleness.daysSinceTouch,
    staleCategory: staleness.staleCategory,
    recentActivity,
    activityLabel: activityLabelText,
    priorInterest: priorInterestFlag ?? undefined,
    relationshipFreshness,
    crmStatus: lead.crm.status,
    lastAction: lead.crm.lastAction,
    hasVerifiedContactPath: Boolean(bestPath?.verified),
  };

  const customOpener = get(row, "suggestedOpener", "suggested opener", "opener");

  return {
    signals,
    whyNowInput,
    priorityNote,
    opportunityLabel: opportunityLabel ?? undefined,
    customOpener,
    item: {
      rank: 0,
      leadKey,
      companyName,
      contactName,
      location,
      relationshipFreshness: staleness.staleCategory,
      staleness,
      verifiedContactPath,
      suggestedOpener: "",
      recoveryScore,
      decision: {
        bucket: decision.bucket,
        score: decision.score,
        primaryOpportunity,
      },
    },
  };
}

function buildFounderReview(
  items: RecoveryBriefItem[],
  inputRows: number,
  wiseAgent: boolean,
): FounderReviewSummary {
  const weakOnlyCount = items.filter((i) => i.weakOnly).length;
  const withHeadline = items.filter((i) => i.headlineSignal).length;
  const publicRecordSignals = items.filter((i) =>
    i.signalContributions.some((c) =>
      /county_recorder|permit:|mls:|shovels/.test(c.source),
    ),
  ).length;

  return {
    worked: [
      wiseAgent
        ? "Wise Agent export mapped to brief fields (name, email, phone, notes, last contact, categories) without inventing public-record signals."
        : "CSV rows consumed with existing column aliases.",
      `${items.length} ranked cards emitted with score, weakOnly, headlineSignal, and signalContributions for disclosure.`,
      `${withHeadline} card(s) have a non-null headline signal from CRM or relationship data on file.`,
    ],
    failed: [
      publicRecordSignals === 0
        ? "No county recorder, permit, or MLS signals — export has no enriched public-record layer."
        : `${publicRecordSignals} public-record signal(s) present (verify provenance before sharing).`,
      weakOnlyCount > items.length / 2
        ? `${weakOnlyCount} of ${items.length} top cards are weak-only — brief will read as CRM-staleness heavy, not seller-intent heavy.`
        : `${weakOnlyCount} weak-only card(s) in the top cohort.`,
    ],
    missingData: [
      "Seller probability, NOD, mortgage release, and permit signals require county/MLS enrichment not present in Wise Agent.",
      "Home street is often blank — location may be city/state only.",
      "Contact Status values like \"New\" do not map to qualified CRM interest; Buyer/Seller tags still emit crm_interest_signal — not seller_probability.",
    ],
    beforeNicoleSees: [
      "Attach verified public-record enrichment per property address, or label the brief as CRM-only.",
      "Founder review every weak-only card; do not present weak headlines as seller intent.",
      inputRows > items.length
        ? `Review ${inputRows - items.length} contacts below the top cut — many may be recently active or skipped.`
        : "Confirm top-card contact paths (email/phone) are the ones Nicole should use.",
    ],
  };
}

async function main() {
  const args = readArgs();
  const customer = args.get("customer");
  const csvPath = args.get("csv");
  const week = args.get("week") ?? isoWeek(new Date());
  const outputRoot = args.get("out") ?? "data/recovery-briefs";
  const top = parseNumber(args.get("top")) ?? 20;

  if (!customer || !csvPath) {
    throw new Error(
      "Usage: npx tsx scripts/generate-brief.ts --customer=test --csv=fixtures/sample-recovery.csv --now=2025-05-22T12:00:00.000Z",
    );
  }

  const absoluteCsv = path.resolve(csvPath);
  const rawRows = parseCsv(await fs.readFile(absoluteCsv, "utf8"));
  const headers = rawRows[0] ? Object.keys(rawRows[0]) : [];
  const wiseAgent = isWiseAgentExport(headers);
  const rows = adaptWiseAgentRows(rawRows, headers);
  const nowIso = resolveNowIso(args, week);
  const config = resolveWorkspaceConfig(
    customer,
    rows[0] ? (get(rows[0], "category", "trade", "module") ?? "roofing") : "roofing",
    args,
  );

  const built = await Promise.all(rows.map((row, index) => buildLead(row, index, nowIso, config)));
  const signalsByLead: Record<string, readonly RecoverySignal[]> = {};
  for (const lead of built) {
    signalsByLead[lead.item.leadKey] = lead.signals;
  }

  const rankedCards = rankLeads(signalsByLead, config, nowIso);
  const evaluated = built.map((lead) => attachSignalEvaluation(lead, config, nowIso));

  const rankedOrder = new Map(rankedCards.map((card, index) => [card.leadKey, index]));
  const sorted = evaluated.sort((a, b) => {
    const rankA = rankedOrder.get(a.leadKey);
    const rankB = rankedOrder.get(b.leadKey);
    if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
    if (rankA !== undefined) return -1;
    if (rankB !== undefined) return 1;
    return (
      (b.score - a.score) ||
      (b.recoveryScore - a.recoveryScore) ||
      (b.staleness.staleScore - a.staleness.staleScore) ||
      (b.decision.score - a.decision.score) ||
      a.leadKey.localeCompare(b.leadKey)
    );
  });

  const eligible = sorted.filter((item) =>
    item.decision.bucket !== "Skip" &&
    item.staleness.staleCategory !== "Recently active"
  );
  const opportunities = (eligible.length > 0 ? eligible : sorted)
    .slice(0, top)
    .map((item, index) => ({ ...item, rank: index + 1 }));

  const weakOnlyCount = opportunities.filter((item) => item.weakOnly).length;
  const founderReview = buildFounderReview(opportunities, rows.length, wiseAgent);

  const brief: RecoveryBrief = {
    customer,
    week,
    generatedAt: nowIso,
    sourceCsv: path.relative(process.cwd(), absoluteCsv),
    summary: {
      inputRows: rows.length,
      opportunities: opportunities.length,
      recoveryCandidates: opportunities.filter((item) => item.staleness.staleCategory === "Recovery candidate").length,
      weakOnlyCount,
      founderReview,
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
  console.log(`Workspace signals: ${config.slug} @ ${nowIso}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
