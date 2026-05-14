"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { IntakeFlowConfig } from "@/content/public/intake";
import type { IntakeFieldName } from "@/lib/intake/types";

type FormState = "idle" | "submitting" | "submitted" | "error";

export function MeridianIntakeForm({
  flow,
  leadSource,
}: {
  flow: IntakeFlowConfig;
  leadSource: string;
}) {
  const initialValues = useMemo(
    () =>
      Object.fromEntries(flow.fields.map((field) => [field.name, ""])) as Record<
        IntakeFieldName,
        string
      >,
    [flow.fields],
  );
  const [values, setValues] = useState(initialValues);
  const [state, setState] = useState<FormState>("idle");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<IntakeFieldName, string>>>({});
  const [queueId, setQueueId] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("submitting");
    setFieldErrors({});

    const response = await fetch("/api/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: flow.type,
        leadSource,
        fields: values,
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) {
      setFieldErrors(result?.fieldErrors ?? {});
      setState("error");
      return;
    }

    setQueueId(result.id ?? null);
    setState("submitted");
  }

  if (state === "submitted") {
    return (
      <div className="public-intake-success" role="status">
        <span className="public-eyebrow">{flow.pendingLabel}</span>
        <h2>{flow.successTitle}</h2>
        <p>{flow.successText}</p>
        <div className="public-intake-success-panel">
          <span className="public-live-dot" />
          <div>
            <strong>{flow.queueLabel}</strong>
            <p>
              Request ID {queueId ?? "queued"} is ready for Meridian operator
              review.
            </p>
          </div>
        </div>
        <Link className="public-secondary-button" href="/">
          Back to Meridian
        </Link>
      </div>
    );
  }

  return (
    <form className="public-intake-form" onSubmit={onSubmit}>
      <div className="public-intake-form-grid">
        {flow.fields.map((field) => {
          const id = `intake-${flow.type}-${field.name}`;
          const sharedProps = {
            id,
            name: field.name,
            value: values[field.name] ?? "",
            required: field.required,
            placeholder: field.placeholder,
            onChange: (
              event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => setValues((current) => ({ ...current, [field.name]: event.target.value })),
          };
          return (
            <label
              className={field.multiline ? "public-intake-field public-intake-field-wide" : "public-intake-field"}
              key={field.name}
              htmlFor={id}
            >
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea {...sharedProps} rows={4} />
              ) : (
                <input
                  {...sharedProps}
                  type={
                    field.inputMode === "email"
                      ? "email"
                      : field.inputMode === "tel"
                        ? "tel"
                        : field.inputMode === "url"
                          ? "url"
                          : "text"
                  }
                />
              )}
              {fieldErrors[field.name] ? <em>{fieldErrors[field.name]}</em> : null}
            </label>
          );
        })}
      </div>
      {state === "error" ? (
        <p className="public-intake-error">
          Check the highlighted fields and send the request again.
        </p>
      ) : null}
      <button className="public-primary-button public-intake-submit" disabled={state === "submitting"} type="submit">
        {state === "submitting" ? "Sending to operator queue..." : flow.submitLabel}
      </button>
      <p className="public-intake-disclaimer">
        No newsletter funnel. No generic drip sequence. Meridian reviews intake
        as an operator request.
      </p>
    </form>
  );
}
