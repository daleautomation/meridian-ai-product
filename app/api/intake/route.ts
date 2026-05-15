import { NextRequest, NextResponse } from "next/server";
import { getIntakeFlow } from "@/content/public/intake";
import { storeIntakeSubmission } from "@/lib/intake/storage";
import {
  isIntakeType,
  toLeadSource,
  type IntakeFields,
  type IntakeFieldName,
} from "@/lib/intake/types";

export const runtime = "nodejs";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFields(value: unknown): IntakeFields {
  if (!isObject(value)) return {};
  const fields: IntakeFields = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      fields[key as IntakeFieldName] = raw.trim();
    }
  }
  return fields;
}

function hasValidEmail(email: string | undefined) {
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!isIntakeType(body.type)) {
    return NextResponse.json({ ok: false, error: "invalid_intake_type" }, { status: 400 });
  }

  const flow = getIntakeFlow(body.type);
  const fields = normalizeFields(body.fields);
  const fieldErrors: Partial<Record<IntakeFieldName, string>> = {};

  for (const field of flow.fields) {
    if (field.required && !fields[field.name]) {
      fieldErrors[field.name] = "Required";
    }
  }

  if (fields.email && !hasValidEmail(fields.email)) {
    fieldErrors.email = "Use a valid work email";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json(
      { ok: false, error: "validation_failed", fieldErrors },
      { status: 400 },
    );
  }

  try {
    const submission = await storeIntakeSubmission({
      type: body.type,
      fields,
      leadSource: toLeadSource(body.leadSource ?? flow.leadSource),
      userAgent: req.headers.get("user-agent"),
      referrer: req.headers.get("referer"),
    });

    return NextResponse.json({
      ok: true,
      id: submission.id,
      status: submission.status,
      submittedAt: submission.submittedAt,
      queueLabel: flow.queueLabel,
      pendingLabel: flow.pendingLabel,
    });
  } catch (error) {
    console.error("[intake] failed_to_store_submission", error);
    return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });
  }
}
