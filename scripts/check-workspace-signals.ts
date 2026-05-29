/**
 * T8 — Per-workspace signal config sanity check.
 *
 * Validates Brookside and LaborTech signal configs against
 * autonomy/SIGNAL_TRUST_RULES.md and autonomy/ACCEPTANCE_CRITERIA.md §T8.
 */

import brooksideConfig from "@/config/signals/nicole-lonergan";
import labortechConfig from "@/config/signals/labortech";
import {
  isSignalCategory,
  isSignalConfidence,
  isSourceTrustTier,
  type SignalDefinition,
  type SourceTrustTier,
  type WorkspaceSignalConfig,
} from "@/lib/recovery/signals/types";

const BANNED_PHRASES = [
  "ai says",
  "high leverage",
  "likelihood to convert",
  "proprietary intelligence",
  "predicted",
] as const;

const BROOKSIDE_REQUIRED_SIGNALS = [
  "long_term_owner",
  "ownership_duration",
  "seller_probability",
  "nod_filing",
  "property_turnover_alignment",
  "refinancing_signal",
  "mortgage_release",
  "permit_activity",
  "neighborhood_velocity_alignment",
  "permit_pulled",
  "neighborhood_comparable_sale",
  "prior_client_recency",
  "crm_interest_signal",
  "stale_relationship",
  "investor_indicator",
  "repeat_client_probability",
  "verified_email",
  "verified_phone",
] as const;

const LABORTECH_REQUIRED_SIGNALS = [
  "permit_pulled",
  "storm_event",
  "active_google_ads",
  "weak_google_rating",
  "high_review_count",
  "website_quality_gap",
  "missing_ssl",
  "missing_schema",
  "missing_google_business_profile",
  "recent_business_filing",
  "license_recently_issued",
  "stale_operator_touch",
  "verified_phone",
  "verified_email",
  "service_area_match",
] as const;

const MAX_HALF_LIFE_DAYS = 1825;

type ExtendedSignalDefinition = SignalDefinition & {
  allowedSourceTiers?: readonly SourceTrustTier[];
  confidenceFloor?: unknown;
  evidenceLabel?: unknown;
  explanationTemplate?: unknown;
  rampDefinition?: unknown;
};

const WORKSPACES: readonly {
  label: string;
  config: WorkspaceSignalConfig;
  requiredSignals: readonly string[];
  requiredRamp?: string;
  weightOrdering?: { lower: string; upper: string };
}[] = [
  {
    label: "brookside (nicole-lonergan)",
    config: brooksideConfig,
    requiredSignals: BROOKSIDE_REQUIRED_SIGNALS,
    requiredRamp: "stale_relationship",
    weightOrdering: { lower: "crm_interest_signal", upper: "long_term_owner" },
  },
  {
    label: "labortech",
    config: labortechConfig,
    requiredSignals: LABORTECH_REQUIRED_SIGNALS,
    requiredRamp: "stale_operator_touch",
    weightOrdering: { lower: "active_google_ads", upper: "permit_pulled" },
  },
];

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIntegerWeight(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function containsBannedPhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) return phrase;
  }
  return null;
}

function asExtended(signal: SignalDefinition): ExtendedSignalDefinition {
  return signal as ExtendedSignalDefinition;
}

function validateConfig(entry: (typeof WORKSPACES)[number]): void {
  const { label, config, requiredSignals, requiredRamp, weightOrdering } = entry;
  const prefix = `${label}`;

  if (!isNonEmptyString(config.slug)) {
    fail(`${prefix}: config missing slug`);
    return;
  }

  if (!Array.isArray(config.signals) || config.signals.length === 0) {
    fail(`${prefix}: config missing signals (signal definitions)`);
    return;
  }

  const signalNames = new Set<string>();

  for (const signal of config.signals) {
    const sigPrefix = `${prefix}/${signal.name || "(unnamed)"}`;

    if (!isNonEmptyString(signal.name)) {
      fail(`${sigPrefix}: signal missing name`);
      continue;
    }

    if (signalNames.has(signal.name)) {
      fail(`${prefix}: duplicate signal name "${signal.name}"`);
    }
    signalNames.add(signal.name);

    if (!isSignalCategory(signal.category)) {
      fail(`${sigPrefix}: invalid or missing category`);
    }

    if (!isIntegerWeight(signal.defaultWeight)) {
      fail(`${sigPrefix}: defaultWeight must be integer 0–100 (got ${signal.defaultWeight})`);
    }

    const halfLife = signal.defaultHalfLifeDays;
    if (
      typeof halfLife !== "number" ||
      !Number.isFinite(halfLife) ||
      halfLife <= 0 ||
      halfLife > MAX_HALF_LIFE_DAYS
    ) {
      fail(
        `${sigPrefix}: defaultHalfLifeDays must be > 0 and <= ${MAX_HALF_LIFE_DAYS} (got ${halfLife})`,
      );
    }

    if (!isNonEmptyString(signal.source)) {
      fail(`${sigPrefix}: missing source`);
    }

    if (!isSourceTrustTier(signal.sourceTier)) {
      fail(`${sigPrefix}: invalid sourceTier`);
    } else if (signal.sourceTier === "BANNED") {
      fail(`${sigPrefix}: sourceTier must not be BANNED`);
    }

    const ext = asExtended(signal);

    if (!Array.isArray(ext.allowedSourceTiers) || ext.allowedSourceTiers.length === 0) {
      fail(`${sigPrefix}: missing allowedSourceTiers`);
    } else {
      for (const tier of ext.allowedSourceTiers) {
        if (!isSourceTrustTier(tier)) {
          fail(`${sigPrefix}: invalid tier in allowedSourceTiers`);
        } else if (tier === "BANNED") {
          fail(`${sigPrefix}: allowedSourceTiers must not include BANNED`);
        }
      }
    }

    if (!isSignalConfidence(ext.confidenceFloor)) {
      fail(
        `${sigPrefix}: confidenceFloor must be HIGH, MED, or WEAK (got ${String(ext.confidenceFloor)})`,
      );
    }

    if (!isNonEmptyString(ext.evidenceLabel)) {
      fail(`${sigPrefix}: missing evidenceLabel`);
    }

    if (!isNonEmptyString(ext.explanationTemplate)) {
      fail(`${sigPrefix}: missing explanationTemplate`);
    } else {
      const banned = containsBannedPhrase(ext.explanationTemplate);
      if (banned) {
        fail(`${sigPrefix}: explanationTemplate contains banned phrase "${banned}"`);
      }
    }

    if (ext.rampDefinition !== undefined && ext.rampDefinition === null) {
      fail(`${sigPrefix}: rampDefinition must not be null when present`);
    }
  }

  if (config.ramps) {
    for (const rampName of Object.keys(config.ramps)) {
      if (!signalNames.has(rampName)) {
        fail(`${prefix}: ramp "${rampName}" has no matching signal definition`);
      }
    }
  }

  for (const required of requiredSignals) {
    if (!signalNames.has(required)) {
      fail(`${prefix}: missing required signal "${required}"`);
    }
  }

  if (requiredRamp) {
    if (!config.ramps || !(requiredRamp in config.ramps)) {
      fail(`${prefix}: missing required ramp "${requiredRamp}" in ramps`);
    }
    if (!signalNames.has(requiredRamp)) {
      fail(`${prefix}: required ramp signal "${requiredRamp}" not declared in signals`);
    }
  }

  if (weightOrdering) {
    const lower = config.signals.find((s) => s.name === weightOrdering.lower);
    const upper = config.signals.find((s) => s.name === weightOrdering.upper);
    if (!lower) {
      fail(`${prefix}: weight ordering check missing signal "${weightOrdering.lower}"`);
    } else if (!upper) {
      fail(`${prefix}: weight ordering check missing signal "${weightOrdering.upper}"`);
    } else if (lower.defaultWeight > upper.defaultWeight) {
      fail(
        `${prefix}: ${weightOrdering.lower} weight (${lower.defaultWeight}) must be <= ${weightOrdering.upper} weight (${upper.defaultWeight})`,
      );
    }
  }
}

function main(): void {
  for (const workspace of WORKSPACES) {
    validateConfig(workspace);
  }

  if (failures.length > 0) {
    console.error("workspace signals check FAILED");
    for (const message of failures) {
      console.error(`  - ${message}`);
    }
    process.exit(1);
  }

  const checks = [
    "slug present",
    "signals (definitions) present",
    "required signal fields",
    "defaultWeight integer 0–100",
    "defaultHalfLifeDays in (0, 1825]",
    "no BANNED sourceTier",
    "allowedSourceTiers excludes BANNED",
    "confidenceFloor HIGH | MED | WEAK",
    "unique signal names per workspace",
    "ramp keys map to declared signals",
    "banned language absent from explanationTemplate",
    "Brookside required signal set",
    "LaborTech required signal set",
    "LaborTech active_google_ads weight <= permit_pulled",
    "Brookside stale_relationship ramp",
    "Brookside long_term_owner weight > crm_interest_signal",
    "LaborTech stale_operator_touch ramp",
  ];

  console.log("workspace signals check passed", {
    workspaces: WORKSPACES.map((w) => ({
      slug: w.config.slug,
      signalCount: w.config.signals.length,
      rampCount: w.config.ramps ? Object.keys(w.config.ramps).length : 0,
    })),
    checks,
  });
}

main();
