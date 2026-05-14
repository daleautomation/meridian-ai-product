export const INTAKE_TYPES = [
  "roofing-demo",
  "visibility-scan",
  "strategy-call",
  "workspace-request",
] as const;

export type IntakeType = (typeof INTAKE_TYPES)[number];

export type IntakeStatus = "operator_review_queue";

export type IntakeLeadSource =
  | "homepage"
  | "roofing-intelligence"
  | "visibility-scan"
  | "direct";

export type IntakeFieldName =
  | "companyName"
  | "website"
  | "market"
  | "teamSize"
  | "growthBottleneck"
  | "workflowProblems"
  | "contactName"
  | "email"
  | "phone"
  | "notes";

export type IntakeFields = Partial<Record<IntakeFieldName, string>>;

export interface IntakeSubmission {
  id: string;
  type: IntakeType;
  requestType: string;
  vertical: string;
  leadSource: IntakeLeadSource;
  status: IntakeStatus;
  submittedAt: string;
  fields: IntakeFields;
  intakeNotes: string[];
  userAgent: string | null;
  referrer: string | null;
}

export function isIntakeType(value: unknown): value is IntakeType {
  return typeof value === "string" && INTAKE_TYPES.includes(value as IntakeType);
}

export function toLeadSource(value: unknown): IntakeLeadSource {
  if (
    value === "homepage" ||
    value === "roofing-intelligence" ||
    value === "visibility-scan" ||
    value === "direct"
  ) {
    return value;
  }
  return "direct";
}
