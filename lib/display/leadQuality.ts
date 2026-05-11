export type LeadQualityKind =
  | "scan_closeability"
  | "sales_probability"
  | "task_probability"
  | "unknown";

export type LeadQualitySource =
  | "laborTechScan.closeability.score"
  | "closeProbability100"
  | "salesStrategy.closeProbability"
  | "closeProbability"
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
  closeProbability100?: number | null;
  salesStrategy?: { closeProbability?: number | null } | null;
  closeProbability?: number | null;
  closeability?: { score?: number | string | null } | null;
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
  closeability?: { score?: number | string | null } | null;
} | null | undefined;

const UNKNOWN: LeadQualityDisplay = {
  kind: "unknown",
  value: null,
  label: "INCOMPLETE",
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

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function tierLabel(value: number): string {
  const tier = value >= 80 ? "High" : value >= 50 ? "Medium" : "Lower";
  return `${tier.toUpperCase()} · ${value}%`;
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
    finiteNumber(scan.closeability?.score) === 15 &&
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
  if (isIncompleteScan(scan)) {
    return resolvedUnknown("laborTechScan.incomplete");
  }

  const scanScore = finiteNumber(scan?.closeability?.score ?? input?.closeability?.score);
  if (scanScore !== null) {
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
