// Meridian Command — GoogleContactsConnector (read-only). Observes only.
//
// There is no Contacts MCP, so this reuses the contacts Meridian already imported
// (data/crm-contacts/*.json) as the contacts source of reality — zero new OAuth.
// Emits identity/company observations (contact_added, contact_updated,
// duplicate_identity) that enrich belief subjects; it never creates opportunities.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { CrmContactRecord } from "@/lib/crm-import/types";
import { runConnector } from "./base";
import {
  observationId,
  type AuthStatus,
  type Capabilities,
  type Connector,
  type ConnectorHealth,
  type Observation,
  type SyncResult,
} from "./types";

export interface ContactsInput {
  /** Directory of per-workspace contact JSON files. Defaults to data/crm-contacts. */
  contactsDir?: string;
}

const ID = "google-contacts";

async function readContacts(dir: string): Promise<CrmContactRecord[]> {
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const all: CrmContactRecord[] = [];
  for (const f of files) {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as { contacts?: CrmContactRecord[] };
      if (parsed.contacts) all.push(...parsed.contacts);
    } catch {
      /* skip unreadable file */
    }
  }
  return all;
}

export class GoogleContactsConnector implements Connector<ContactsInput> {
  private dir(input?: ContactsInput): string {
    return input?.contactsDir ?? path.join(process.cwd(), "data", "crm-contacts");
  }

  capabilities(): Capabilities {
    return {
      id: ID,
      emits: ["contact_added", "contact_updated", "duplicate_identity"],
      readOnly: true,
      inputMode: "file",
      description: "Reads imported contacts (data/crm-contacts) and emits identity/company observations.",
    };
  }

  async health(input?: ContactsInput): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    const contacts = await readContacts(this.dir(input));
    if (contacts.length === 0) return { id: ID, state: "degraded", detail: "no contacts found", checkedAt };
    return { id: ID, state: "ok", detail: `${contacts.length} contacts`, checkedAt };
  }

  async authenticate(): Promise<AuthStatus> {
    return { id: ID, authenticated: true, method: "file", detail: "Reuses imported contacts; no OAuth required." };
  }

  async lastSync(): Promise<string | null> {
    return null;
  }

  async collectObservations(input: ContactsInput, nowMs: number): Promise<Observation[]> {
    const observedAt = new Date(nowMs).toISOString();
    const contacts = await readContacts(this.dir(input));
    const out: Observation[] = [];
    const byEmail = new Map<string, string[]>(); // email -> contact ids (dup detection)

    for (const c of contacts) {
      const email = (c.normalizedEmail ?? c.email ?? "").toLowerCase() || null;
      const company = c.normalizedCompany ?? c.company ?? null;
      const people = [email ?? c.id];
      const created = c.createdAt || observedAt;
      const changed = c.updatedAt && c.updatedAt !== c.createdAt;
      out.push({
        id: observationId(ID, changed ? "contact_updated" : "contact_added", c.id),
        connector: ID, type: changed ? "contact_updated" : "contact_added",
        timestamp: changed ? c.updatedAt! : created, observedAt,
        entity: c.id, people, company, direction: null,
        evidence: { source: ID, nativeId: c.id, subject: c.name, excerpt: `${c.name}${company ? ` @ ${company}` : ""}` },
        confidence: email ? 1 : 0.6,
        metadata: { sourceCrm: c.sourceCrm ?? null, lastInteractionAt: c.lastInteractionAt ?? null },
      });
      if (email) {
        const ids = byEmail.get(email) ?? [];
        ids.push(c.id);
        byEmail.set(email, ids);
      }
    }

    for (const [email, ids] of byEmail) {
      if (ids.length > 1) {
        out.push({
          id: observationId(ID, "duplicate_identity", email),
          connector: ID, type: "duplicate_identity",
          timestamp: observedAt, observedAt,
          entity: email, people: [email], company: null, direction: null,
          evidence: { source: ID, nativeId: email, excerpt: `${ids.length} contacts share ${email}` },
          confidence: 1, metadata: { contactIds: ids },
        });
      }
    }
    return out;
  }

  run(input: ContactsInput, nowMs: number): Promise<SyncResult> {
    return runConnector(this, input, nowMs);
  }
}
