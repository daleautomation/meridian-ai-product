import { mkdir, appendFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { getIntakeFlow } from "@/content/public/intake";
import {
  type IntakeFields,
  type IntakeLeadSource,
  type IntakeSubmission,
  type IntakeType,
} from "@/lib/intake/types";

const MAX_FIELD_LENGTH = 1200;

interface IntakeSubmissionInput {
  type: IntakeType;
  fields: IntakeFields;
  leadSource: IntakeLeadSource;
  userAgent: string | null;
  referrer: string | null;
}

function cleanField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, MAX_FIELD_LENGTH);
}

function cleanFields(fields: IntakeFields): IntakeFields {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, cleanField(value)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  ) as IntakeFields;
}

function getIntakeDirectory() {
  return process.env.MERIDIAN_INTAKE_DIR ?? path.join(process.cwd(), ".meridian", "intake");
}

export async function storeIntakeSubmission(input: IntakeSubmissionInput) {
  const flow = getIntakeFlow(input.type);
  const submittedAt = new Date().toISOString();
  const submission: IntakeSubmission = {
    id: `intake_${submittedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`,
    type: input.type,
    requestType: flow.requestType,
    vertical: flow.vertical,
    leadSource: input.leadSource,
    status: "operator_review_queue",
    submittedAt,
    fields: cleanFields(input.fields),
    intakeNotes: [
      `Queue: ${flow.queueLabel}`,
      `Pending state: ${flow.pendingLabel}`,
      `Review focus: ${flow.reviewBullets.join("; ")}`,
    ],
    userAgent: input.userAgent,
    referrer: input.referrer,
  };

  const directory = getIntakeDirectory();
  await mkdir(directory, { recursive: true });
  await appendFile(
    path.join(directory, "operator-review-queue.jsonl"),
    `${JSON.stringify(submission)}\n`,
    "utf8",
  );

  return submission;
}
