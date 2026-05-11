export type LeadQualityKind =
  | "scan_closeability"
  | "market_fit"
  | "sales_probability"
  | "task_probability"
  | "unknown";

export type LeadQualitySource =
  | "laborTechScan.closeability.score"
  | "closeProbability100"
  | "salesStrategy.closeProbability"
  | "closeProbability"
  | "marketFit.calibrated"
  | "laborTechScan.incomplete"
  | "none";

export type LeadQualityDisplay = {
  kind: LeadQualityKind;
  value: number | null;
  label: string;
  source: LeadQualitySource;
  isFallback: boolean;
  isUnknown: boolean;
};

type QualityInput = {
  laborTechScan?: ScanLike | null;
  serviceNeed?: { needScore?: number | null } | null;
  marketFitScore?: number | null;
  closeProbability100?: number | null;
  salesStrategy?: { closeProbability?: number | null } | null;
  closeProbability?: number | null;
  closeability?: { score?: number | null } | null;
  decision?: { score?: number | null } | null;
  score?: number | null;
  phone?: string | null;
  qualified?: boolean | null;
  qualificationReason?: string | null;
  primaryPain?: string | null;
  primaryService?: string | null;
} | null | undefined;

type ScanLike = {
  qualified?: boolean | null;
  qualificationReason?: string | null;
  primaryPain?: string | null;
  primaryService?: string | null;
  closeability?: { score?: number | null } | null;
} | null | undefined;

const UNKNOWN: LeadQualityDisplay = {
  kind: "unknown",
  value: null,
  label: "SCAN LIMITED",
  source: "none",
  isFallback: true,
  isUnknown: true,
};

function clampPercent(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asPercent(n: number): number {
  return n <= 1 ? n * 100 : n;
}

function tierLabel(value: number): string {
  const tier = value >= 80 ? "High" : value >= 50 ? "Medium" : "Lower";
  return `${tier.toUpperCase()} · ${value}%`;
}

function firstFinite(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function percentValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampPercent(asPercent(value), 0, 100);
}

function calibratedMarketFit(
  input: QualityInput,
  scanScore: number | null,
  scanLimited: boolean,
): number | null {
  const explicit = percentValue(input?.marketFitScore);
  if (explicit !== null) return explicit;

  const serviceNeed = percentValue(input?.serviceNeed?.needScore);
  if (serviceNeed === null) return null;

  const sales = percentValue(firstFinite(
    input?.closeProbability100,
    input?.salesStrategy?.closeProbability,
    input?.closeProbability,
  ));
  const decision = percentValue(firstFinite(input?.decision?.score, input?.score));
  const scan = scanLimited ? null : percentValue(scanScore);
  const contact = input?.phone ? 75 : 45;

  const parts: Array<{ value: number; weight: number }> = [
    { value: serviceNeed, weight: 0.42 },
    ...(sales !== null ? [{ value: sales, weight: 0.25 }] : []),
    ...(scan !== null ? [{ value: scan, weight: 0.20 }] : []),
    ...(decision !== null ? [{ value: decision, weight: 0.10 }] : []),
    { value: contact, weight: 0.03 },
  ];
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return null;
  const weighted = parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight;
  let score = clampPercent(weighted, 0, 100);

  // Align the visible card score with operator priority when every
  // non-scan signal agrees the lead belongs in the call queue.
  if (decision !== null && sales !== null && decision >= 70 && sales >= 70 && serviceNeed >= 60) {
    score = Math.max(score, 70);
  }
  if (decision !== null && decision >= 80 && serviceNeed >= 70) {
    score = Math.max(score, 80);
  }
  return score;
}

function scanFrom(input: QualityInput): ScanLike {
  if (!input) return null;
  return input.laborTechScan ?? (
    input.closeability || typeof input.qualified !== "undefined"
      ? input
      : null
  );
}

function isIncompleteScan(scan: ScanLike): boolean {
  if (!scan) return false;
  const reason = typeof scan.qualificationReason === "string"
    ? scan.qualificationReason.toLowerCase()
    : "";
  if (scan.qualified === false) return true;
  if (reason.includes("temp bypass")) return true;
  if (
    scan.closeability?.score === 15 &&
    scan.primaryService === "Diagnostics" &&
    typeof scan.primaryPain === "string" &&
    scan.primaryPain.toLowerCase().includes("secondary opportunity")
  ) {
    return true;
  }
  return false;
}

function resolvedUnknown(source: LeadQualitySource): LeadQualityDisplay {
  return { ...UNKNOWN, source };
}

export function resolveLeadQualityDisplay(input: QualityInput): LeadQualityDisplay {
  const scan = scanFrom(input);
  const scanScore = scan?.closeability?.score ?? input?.closeability?.score;
  const scanLimited = isIncompleteScan(scan);
  const marketFit = calibratedMarketFit(
    input,
    typeof scanScore === "number" && Number.isFinite(scanScore) ? scanScore : null,
    scanLimited,
  );
  if (marketFit !== null) {
    return {
      kind: "market_fit",
      value: marketFit,
      label: tierLabel(marketFit),
      source: "marketFit.calibrated",
      isFallback: true,
      isUnknown: false,
    };
  }

  if (scanLimited) {
    return resolvedUnknown("laborTechScan.incomplete");
  }

  if (typeof scanScore === "number" && Number.isFinite(scanScore)) {
    const value = clampPercent(asPercent(scanScore), 15, 95);
    return {
      kind: "scan_closeability",
      value,
      label: tierLabel(value),
      source: "laborTechScan.closeability.score",
      isFallback: false,
      isUnknown: false,
    };
  }

  const close100 = input?.closeProbability100;
  if (typeof close100 === "number" && Number.isFinite(close100)) {
    const value = clampPercent(asPercent(close100), 0, 100);
    return {
      kind: "sales_probability",
      value,
      label: tierLabel(value),
      source: "closeProbability100",
      isFallback: true,
      isUnknown: false,
    };
  }

  const strategyProbability = input?.salesStrategy?.closeProbability;
  if (typeof strategyProbability === "number" && Number.isFinite(strategyProbability)) {
    const value = clampPercent(asPercent(strategyProbability), 0, 100);
    return {
      kind: "sales_probability",
      value,
      label: tierLabel(value),
      source: "salesStrategy.closeProbability",
      isFallback: true,
      isUnknown: false,
    };
  }

  const taskProbability = input?.closeProbability;
  if (typeof taskProbability === "number" && Number.isFinite(taskProbability)) {
    const value = clampPercent(asPercent(taskProbability), 0, 100);
    return {
      kind: "task_probability",
      value,
      label: tierLabel(value),
      source: "closeProbability",
      isFallback: true,
      isUnknown: false,
    };
  }

  return UNKNOWN;
}
