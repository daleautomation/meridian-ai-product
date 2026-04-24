// Meridian AI — set_contact_preferences MCP tool.
//
// Operator-facing override hook. Persists manual contact values into the
// existing snapshot via setContactPreferences(). Resolver output continues
// to run in parallel; overrides always win when present. Pass an empty
// string ("") for any field to clear it (return control to the resolver).

import type { CompanyRef, ToolDefinition, ToolResult } from "@/lib/mcp/types";
import { nowIso } from "@/lib/mcp/types";
import { setContactPreferences } from "@/lib/state/companySnapshotStore";

export type SetContactPreferencesInput = {
  company: CompanyRef;
  preferredPhone?: string;
  preferredEmail?: string;
  preferredContactName?: string;
  preferredContactRole?: string;
  preferredContactSource?: string;
  contactNotes?: string;
  performedBy?: string;
};

export type SetContactPreferencesData = {
  key: string;
  preferredPhone?: string;
  preferredEmail?: string;
  preferredContactName?: string;
  preferredContactRole?: string;
  preferredContactSource?: string;
  contactNotes?: string;
  preferredUpdatedAt?: string;
  preferredUpdatedBy?: string;
};

async function handler(
  input: SetContactPreferencesInput,
): Promise<ToolResult<SetContactPreferencesData>> {
  const timestamp = nowIso();
  const snap = await setContactPreferences(input.company, {
    preferredPhone: input.preferredPhone,
    preferredEmail: input.preferredEmail,
    preferredContactName: input.preferredContactName,
    preferredContactRole: input.preferredContactRole,
    preferredContactSource: input.preferredContactSource,
    contactNotes: input.contactNotes,
    performedBy: input.performedBy ?? "operator",
  });

  return {
    tool: "set_contact_preferences",
    company: input.company,
    timestamp,
    confidence: 100,
    confidenceLabel: "HIGH",
    evidence: [
      {
        kind: "store_write",
        source: "companySnapshotStore",
        observedAt: timestamp,
        detail: `overrides set by ${snap.preferredUpdatedBy ?? "operator"}`,
      },
    ],
    data: {
      key: snap.key,
      preferredPhone: snap.preferredPhone,
      preferredEmail: snap.preferredEmail,
      preferredContactName: snap.preferredContactName,
      preferredContactRole: snap.preferredContactRole,
      preferredContactSource: snap.preferredContactSource,
      contactNotes: snap.contactNotes,
      preferredUpdatedAt: snap.preferredUpdatedAt,
      preferredUpdatedBy: snap.preferredUpdatedBy,
    },
    stub: false,
  };
}

export const setContactPreferencesTool: ToolDefinition<SetContactPreferencesInput, SetContactPreferencesData> = {
  name: "set_contact_preferences",
  description:
    "Sets or clears operator-curated contact overrides (preferredPhone, preferredEmail, preferredContactName, preferredContactRole, preferredContactSource, contactNotes). Pass an empty string to clear a field. Operator values always win over resolver output.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "object", description: "CompanyRef identifying the lead" },
      preferredPhone: { type: "string", description: "Operator-entered phone; '' clears" },
      preferredEmail: { type: "string", description: "Operator-entered email; '' clears" },
      preferredContactName: { type: "string", description: "Real contact person name; '' clears" },
      preferredContactRole: { type: "string", description: "Contact's role/title; '' clears" },
      preferredContactSource: { type: "string", description: "Freeform source hint ('referred by Dylan', 'LinkedIn DM'); '' clears" },
      contactNotes: { type: "string", description: "Freeform operator notes; '' clears" },
      performedBy: { type: "string", description: "userId of the operator performing the update" },
    },
    required: ["company"],
    additionalProperties: false,
  },
  handler,
};
