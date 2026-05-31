export type CheckStatus = "pass" | "fail" | "error";

export interface HeartbeatCheck {
  id: string;
  script: string;
  label: string;
  description: string;
}

export interface CheckResult {
  id: string;
  script: string;
  label: string;
  description: string;
  status: CheckStatus;
  exitCode: number | null;
  durationMs: number;
  output: string;
}

export interface HeartbeatRun {
  runAt: string;
  date: string;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
  };
}

export interface RegressionDelta {
  id: string;
  label: string;
  previous: CheckStatus;
  current: CheckStatus;
}

export interface RegressionSummary {
  isFirstRun: boolean;
  priorDate: string | null;
  deltas: RegressionDelta[];
  newlyFailing: CheckResult[];
  newlyPassing: string[];
}

export interface CeoDecision {
  checkId: string;
  label: string;
  message: string;
}
