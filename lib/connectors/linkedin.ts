// Meridian Command — LinkedInConnector (read-only, manual ingestion). Observes only.
//
// LinkedIn has no safe official read API for messages, and scraping risks the
// account — so this connector NEVER scrapes. It reads what Dylan pastes/exports:
//   1. data/linkedin/observations.json — manual notes + signals (primary)
//   2. data/linkedin/messages.json     — pasted message threads (optional)
// Both are optional; whichever exists is used. Every item becomes an Observation[]
// with a linkedin_* type. No scoring here.

import { promises as fs } from "node:fs";
import path from "node:path";
import { runConnector } from "./base";
import {
  observationId,
  type AuthStatus,
  type Capabilities,
  type Connector,
  type ConnectorHealth,
  type Observation,
  type ObservationType,
  type SyncResult,
} from "./types";

/** One hand-entered LinkedIn observation (data/linkedin/observations.json). */
export interface LinkedInManualObservation {
  id?: string;
  type: ObservationType; // e.g. linkedin_message_received | linkedin_manual_note | linkedin_job_signal
  timestamp: string; // ISO — when it happened
  person?: string; // display name or handle
  people?: string[];
  company?: string;
  direction?: "inbound" | "outbound" | null;
  note?: string; // free text → evidence excerpt
  subject?: string;
}

export interface LinkedInObservationsFile {
  version: 1;
  ownerHandle: string;
  observations: LinkedInManualObservation[];
}

/** Pasted message threads (data/linkedin/messages.json). */
export interface LinkedInMessagesFile {
  version: 1;
  ownerHandle: string;
  threads: Array<{
    with: string; // person name/handle
    company?: string;
    messages: Array<{ from: "me" | "them"; date: string; text: string }>;
  }>;
}

export interface LinkedInInput {
  observationsPath?: string;
  messagesPath?: string;
}

const ID = "linkedin";

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, "utf8")) as T; }
  catch { return null; }
}

export class LinkedInConnector implements Connector<LinkedInInput> {
  private obsPath(i?: LinkedInInput) { return i?.observationsPath ?? path.join(process.cwd(), "data", "linkedin", "observations.json"); }
  private msgPath(i?: LinkedInInput) { return i?.messagesPath ?? path.join(process.cwd(), "data", "linkedin", "messages.json"); }

  capabilities(): Capabilities {
    return {
      id: ID,
      emits: ["linkedin_message_received", "linkedin_message_sent", "linkedin_connection_added",
        "linkedin_profile_viewed", "linkedin_job_signal", "linkedin_company_signal", "linkedin_manual_note"],
      readOnly: true,
      inputMode: "file",
      description: "Manual/read-only LinkedIn ingestion (pasted notes + message threads). Never scrapes.",
    };
  }

  async health(input?: LinkedInInput): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    const obs = await readJson<LinkedInObservationsFile>(this.obsPath(input));
    const msg = await readJson<LinkedInMessagesFile>(this.msgPath(input));
    const n = (obs?.observations?.length ?? 0) + (msg?.threads?.length ?? 0);
    if (n === 0) return { id: ID, state: "degraded", detail: "no LinkedIn observations/messages files found (optional)", checkedAt };
    return { id: ID, state: "ok", detail: `${obs?.observations?.length ?? 0} notes, ${msg?.threads?.length ?? 0} threads`, checkedAt };
  }

  async authenticate(): Promise<AuthStatus> {
    return { id: ID, authenticated: true, method: "file", detail: "Manual paste/export; no LinkedIn API, no scraping." };
  }

  async lastSync(): Promise<string | null> {
    return null;
  }

  async collectObservations(input: LinkedInInput, nowMs: number): Promise<Observation[]> {
    const observedAt = new Date(nowMs).toISOString();
    const out: Observation[] = [];

    const obsFile = await readJson<LinkedInObservationsFile>(this.obsPath(input));
    for (const [i, o] of (obsFile?.observations ?? []).entries()) {
      const nativeId = o.id ?? `note-${i}-${o.timestamp}`;
      const people = o.people ?? (o.person ? [o.person] : []);
      out.push({
        id: observationId(ID, o.type, nativeId), connector: ID, type: o.type,
        timestamp: o.timestamp, observedAt,
        entity: (o.company ?? o.person ?? nativeId).toLowerCase(),
        people, company: o.company ?? null,
        direction: o.direction ?? (o.type === "linkedin_message_received" ? "inbound" : o.type === "linkedin_message_sent" ? "outbound" : null),
        evidence: { source: ID, nativeId, subject: o.subject ?? `LinkedIn: ${o.person ?? o.company ?? "note"}`, excerpt: o.note ?? "" },
        confidence: 1, metadata: { manual: true },
      });
    }

    const msgFile = await readJson<LinkedInMessagesFile>(this.msgPath(input));
    for (const [t, thread] of (msgFile?.threads ?? []).entries()) {
      for (const [m, msg] of thread.messages.entries()) {
        const type: ObservationType = msg.from === "me" ? "linkedin_message_sent" : "linkedin_message_received";
        const nativeId = `thread-${t}-msg-${m}-${msg.date}`;
        out.push({
          id: observationId(ID, type, nativeId), connector: ID, type,
          timestamp: msg.date, observedAt,
          entity: (thread.company ?? thread.with).toLowerCase(),
          people: [thread.with], company: thread.company ?? null,
          direction: msg.from === "me" ? "outbound" : "inbound",
          evidence: { source: ID, nativeId, subject: `LinkedIn DM with ${thread.with}`, excerpt: msg.text.slice(0, 180) },
          confidence: 1, metadata: { manual: true, thread: thread.with },
        });
      }
    }
    return out;
  }

  run(input: LinkedInInput, nowMs: number): Promise<SyncResult> {
    return runConnector(this, input, nowMs);
  }
}
