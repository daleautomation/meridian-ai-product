/**
 * repair-contacts — founder-led CRM rehabilitation writer.
 *
 * Append-only writer for the 5-field closed set (name / company /
 * email / phone / address). NEVER overwrites the original imported
 * value in `normalized.<field>`. Every repair is appended to
 * `source_metadata.repairs[]` with provenance (originalValue +
 * newValue + repairedAt + source).
 *
 * Two modes:
 *   Single repair (one row, one field):
 *     npm run repair:contacts -- --customer=<slug> \\
 *       --contact=<id> --field=name --value="Greg Smith" --write
 *
 *   Surname shortcut (appends to existing first name):
 *     npm run repair:contacts -- --customer=<slug> \\
 *       --contact=<id> --surname="Smith" --write
 *
 *   Batch from YAML/JSON file:
 *     npm run repair:contacts -- --file=repairs.json --write
 *     (file shape documented below)
 *
 * Defaults to dry-run. Pass --write to persist. Logs every action;
 * never prints unmodified secrets (Hunter keys etc. are unaffected).
 *
 * Batch file shape (JSON, sorted alphabetically by contactId):
 *   {
 *     "customer": "nicole-lonergan",
 *     "operator": "founder",
 *     "repairs": [
 *       { "contactId": "...", "field": "name",    "value": "Greg Smith", "note": "confirmed via call" },
 *       { "contactId": "...", "surname": "Doe" },
 *       { "contactId": "...", "field": "address", "value": "100 Main St, KC, MO 64108" }
 *     ]
 *   }
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import {
  applyContactNameRepairNeon,
  applyContactRepairNeon,
  listContactsNeon,
} from "@/lib/crm-import/crmContactsNeonAdapter";
import type {
  ContactRepairField,
  ContactRepairSource,
  CrmContactRecord,
} from "@/lib/crm-import/types";

const ALLOWED_FIELDS: ReadonlySet<ContactRepairField> = new Set([
  "name",
  "company",
  "email",
  "phone",
  "address",
]);

interface SingleArgs {
  mode: "single";
  customer: string;
  contactId: string;
  field?: ContactRepairField;
  value?: string;
  surname?: string;
  note?: string;
  operator?: string;
  write: boolean;
}

interface BatchArgs {
  mode: "batch";
  file: string;
  write: boolean;
}

type CliArgs = SingleArgs | BatchArgs;

function parseArgs(argv: readonly string[]): CliArgs {
  const get = (k: string): string | undefined => {
    const eq = argv.find((a) => a.startsWith(`--${k}=`));
    if (eq) return eq.slice(`--${k}=`.length);
    const idx = argv.indexOf(`--${k}`);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return undefined;
  };
  const write = argv.includes("--write");
  const file = get("file");
  if (file) {
    return { mode: "batch", file, write };
  }
  const customer = get("customer") ?? "";
  const contactId = get("contact") ?? "";
  const fieldRaw = get("field");
  const value = get("value");
  const surname = get("surname");
  const note = get("note");
  const operator = get("operator");
  if (!customer || !contactId) {
    console.error(
      "Usage:\n" +
        "  npm run repair:contacts -- --customer=<slug> --contact=<id> --field=<name|company|email|phone|address> --value=\"...\" [--note=\"...\"] [--write]\n" +
        "  npm run repair:contacts -- --customer=<slug> --contact=<id> --surname=\"Smith\" [--write]\n" +
        "  npm run repair:contacts -- --file=<repairs.json> [--write]",
    );
    process.exit(1);
  }
  if (!fieldRaw && !surname) {
    console.error("repair-contacts: must specify --field=<field> --value or --surname=\"...\"");
    process.exit(1);
  }
  if (fieldRaw && !ALLOWED_FIELDS.has(fieldRaw as ContactRepairField)) {
    console.error(
      `repair-contacts: field "${fieldRaw}" is not in the allowed set [${[...ALLOWED_FIELDS].join(", ")}]`,
    );
    process.exit(1);
  }
  return {
    mode: "single",
    customer,
    contactId,
    field: fieldRaw as ContactRepairField | undefined,
    value,
    surname,
    note,
    operator,
    write,
  };
}

interface RepairAction {
  contactId: string;
  field: ContactRepairField;
  originalValue: string | null;
  newValue: string;
  note?: string;
}

function readField(contact: CrmContactRecord, field: ContactRepairField): string | null {
  switch (field) {
    case "name":
      return contact.name ?? null;
    case "company":
      return contact.company ?? null;
    case "email":
      return contact.email ?? null;
    case "phone":
      return contact.phone ?? null;
    case "address":
      return contact.address ?? null;
  }
}

/**
 * For repairs, "originalValue" must always be the import-time value,
 * NEVER the effective post-repair value. We read it from
 * `contact.originalImport` if a prior repair exists; otherwise the
 * current value IS the import-time original.
 */
function importTimeValue(
  contact: CrmContactRecord,
  field: ContactRepairField,
): string | null {
  if (contact.originalImport) {
    const ori = contact.originalImport;
    if (field === "name") return ori.name ?? null;
    if (field === "company") return ori.company ?? null;
    if (field === "email") return ori.email ?? null;
    if (field === "phone") return ori.phone ?? null;
    if (field === "address") return ori.address ?? null;
  }
  return readField(contact, field);
}

function buildAction(
  contact: CrmContactRecord,
  field: ContactRepairField,
  newValue: string,
  note?: string,
): RepairAction {
  return {
    contactId: contact.id,
    field,
    originalValue: importTimeValue(contact, field),
    newValue,
    note,
  };
}

function buildSurnameAction(
  contact: CrmContactRecord,
  surname: string,
  note?: string,
): RepairAction {
  // Append surname to existing first name. If the contact's current
  // name has > 1 token, the surname is replacing the last token.
  // Surname appending is deterministic — same input → same output.
  const existing = (contact.name ?? "").trim();
  const tokens = existing.split(/\s+/).filter(Boolean);
  let nextName: string;
  if (tokens.length === 0) {
    nextName = surname.trim();
  } else if (tokens.length === 1) {
    nextName = `${tokens[0]} ${surname.trim()}`;
  } else {
    // Replace last token (likely a wrong / unverified surname).
    nextName = `${tokens.slice(0, -1).join(" ")} ${surname.trim()}`;
  }
  return buildAction(contact, "name", nextName, note);
}

async function processSingle(args: SingleArgs): Promise<void> {
  const contacts = await listContactsNeon(args.customer);
  const contact = contacts.find((c) => c.id === args.contactId);
  if (!contact) {
    console.error(`repair-contacts: contact id "${args.contactId}" not found in workspace "${args.customer}"`);
    process.exit(1);
  }

  let action: RepairAction;
  if (args.surname) {
    action = buildSurnameAction(contact, args.surname, args.note);
  } else if (args.field && typeof args.value === "string") {
    action = buildAction(contact, args.field, args.value, args.note);
  } else {
    console.error("repair-contacts: missing --field=<...> --value=\"...\" or --surname=\"...\"");
    process.exit(1);
  }

  printPlannedAction(action, contact);

  if (!args.write) {
    console.log("");
    console.log("[repair-contacts] dry-run complete — no writes performed. Re-run with --write to persist.");
    return;
  }

  if (action.field === "name") {
    const wrote = await applyContactNameRepairNeon({
      workspaceId: args.customer,
      contactId: action.contactId,
      originalName: action.originalValue,
      newName: action.newValue,
      source: "founder_rehab",
      operator: args.operator,
      note: action.note,
    });
    if (!wrote) {
      console.error("[repair-contacts] WRITE FAILED — no row matched. Verify customer + contactId.");
      process.exit(1);
    }
  } else {
    const wrote = await applyContactRepairNeon(args.customer, action.contactId, {
      field: action.field,
      originalValue: action.originalValue,
      newValue: action.newValue,
      source: "founder_rehab" as ContactRepairSource,
      repairedAt: new Date().toISOString(),
      operator: args.operator,
      note: action.note,
    });
    if (!wrote) {
      console.error("[repair-contacts] WRITE FAILED — no row matched. Verify customer + contactId.");
      process.exit(1);
    }
  }
  console.log("");
  console.log("[repair-contacts] ✓ Repair recorded.");
}

async function processBatch(args: BatchArgs): Promise<void> {
  const fullPath = path.resolve(args.file);
  let text: string;
  try {
    text = await fs.readFile(fullPath, "utf8");
  } catch (err) {
    console.error(`repair-contacts: could not read batch file ${fullPath}: ${(err as Error).message}`);
    process.exit(1);
  }
  let payload: {
    customer: string;
    operator?: string;
    repairs: Array<{
      contactId: string;
      field?: ContactRepairField;
      value?: string;
      surname?: string;
      note?: string;
    }>;
  };
  try {
    payload = JSON.parse(text);
  } catch (err) {
    console.error(`repair-contacts: batch file is not valid JSON: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!payload.customer || !Array.isArray(payload.repairs)) {
    console.error("repair-contacts: batch file must have { customer: string, repairs: [...] }");
    process.exit(1);
  }
  const contacts = await listContactsNeon(payload.customer);
  const byId = new Map(contacts.map((c) => [c.id, c]));

  const actions: Array<RepairAction & { found: boolean }> = [];
  for (const entry of payload.repairs) {
    const contact = byId.get(entry.contactId);
    if (!contact) {
      actions.push({
        contactId: entry.contactId,
        field: "name",
        originalValue: null,
        newValue: "",
        found: false,
      });
      continue;
    }
    if (entry.surname) {
      actions.push({ ...buildSurnameAction(contact, entry.surname, entry.note), found: true });
    } else if (entry.field && ALLOWED_FIELDS.has(entry.field) && typeof entry.value === "string") {
      actions.push({ ...buildAction(contact, entry.field, entry.value, entry.note), found: true });
    } else {
      actions.push({
        contactId: entry.contactId,
        field: "name",
        originalValue: null,
        newValue: "(invalid entry — no field+value or surname)",
        found: false,
      });
    }
  }

  console.log("");
  console.log(`Batch repair plan for ${payload.customer}: ${actions.length} entries`);
  console.log("=".repeat(72));
  let valid = 0;
  for (const a of actions) {
    if (!a.found) {
      console.log(`  ✗ ${a.contactId}  — not found / invalid entry`);
      continue;
    }
    valid += 1;
    console.log(`  • ${a.contactId}  [${a.field}]  ${truncate(a.originalValue ?? "(none)", 30)}  →  ${truncate(a.newValue, 40)}`);
  }
  console.log("");
  console.log(`Valid: ${valid}  |  Invalid: ${actions.length - valid}`);

  if (!args.write) {
    console.log("[repair-contacts] dry-run complete — no writes performed.");
    console.log("                  Re-run with --write to persist.");
    return;
  }

  let written = 0;
  const now = new Date().toISOString();
  for (const a of actions) {
    if (!a.found) continue;
    if (a.field === "name") {
      const ok = await applyContactNameRepairNeon({
        workspaceId: payload.customer,
        contactId: a.contactId,
        originalName: a.originalValue,
        newName: a.newValue,
        source: "founder_rehab",
        operator: payload.operator,
        note: a.note,
      });
      if (ok) written += 1;
    } else {
      const ok = await applyContactRepairNeon(payload.customer, a.contactId, {
        field: a.field,
        originalValue: a.originalValue,
        newValue: a.newValue,
        source: "founder_rehab",
        repairedAt: now,
        operator: payload.operator,
        note: a.note,
      });
      if (ok) written += 1;
    }
  }
  console.log("");
  console.log(`[repair-contacts] ✓ ${written} repairs recorded.`);
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function printPlannedAction(action: RepairAction, contact: CrmContactRecord): void {
  console.log("");
  console.log(`repair plan for ${contact.id}`);
  console.log("=".repeat(60));
  console.log(`  field:           ${action.field}`);
  console.log(`  current value:   ${truncate(readField(contact, action.field) ?? "(none)", 60)}`);
  console.log(`  import original: ${truncate(action.originalValue ?? "(none)", 60)}`);
  console.log(`  new value:       ${truncate(action.newValue, 60)}`);
  if (action.note) console.log(`  note:            ${action.note}`);
  console.log("  source:          founder_rehab");
  console.log("  invariants:      import value preserved; no other field touched");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "single") await processSingle(args);
  else await processBatch(args);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error("[repair:contacts] crashed");
  console.error(message);
  process.exit(1);
});
