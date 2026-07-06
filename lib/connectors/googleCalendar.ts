// Meridian Command — GoogleCalendarConnector (read-only). Observes only.
//
// Consumes a calendar-event batch (from the Google Calendar MCP, or the existing
// data/ae-jobs/calendar-events.json). Emits meeting observations — scheduled,
// completed, approaching, canceled — with no interpretation.

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

/** Connector-agnostic calendar event shape (maps cleanly from the Calendar MCP). */
export interface CalendarEventInput {
  id: string;
  summary: string;
  start: string; // ISO
  end?: string; // ISO
  status?: "confirmed" | "tentative" | "cancelled";
  attendees?: string[]; // emails
  organizer?: string;
  notes?: string;
}

export interface CalendarBatch {
  fetchedAt: string;
  ownerEmails: string[];
  events: CalendarEventInput[];
}

const ID = "google-calendar";
const DAY = 86_400_000;

function domainOf(email: string): string | null {
  const d = email.split("@")[1]?.toLowerCase();
  if (!d) return null;
  const generic = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"]);
  return generic.has(d) ? null : d;
}

export class GoogleCalendarConnector implements Connector<CalendarBatch> {
  capabilities(): Capabilities {
    return {
      id: ID,
      emits: ["meeting_scheduled", "meeting_completed", "meeting_approaching", "meeting_canceled"],
      readOnly: true,
      inputMode: "batch",
      description: "Reads Google Calendar events (via MCP batch) and emits meeting observations.",
    };
  }

  async health(input?: CalendarBatch): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!input || !Array.isArray(input.events)) {
      return { id: ID, state: "unavailable", detail: "no calendar batch provided", checkedAt };
    }
    return { id: ID, state: "ok", detail: `${input.events.length} events`, checkedAt };
  }

  async authenticate(): Promise<AuthStatus> {
    return { id: ID, authenticated: true, method: "mcp-session", detail: "Calendar read via Claude MCP session (read-only)." };
  }

  async lastSync(): Promise<string | null> {
    return null;
  }

  async collectObservations(batch: CalendarBatch, nowMs: number): Promise<Observation[]> {
    const observedAt = new Date(nowMs).toISOString();
    const owner = new Set((batch.ownerEmails ?? []).map((e) => e.toLowerCase()));
    const out: Observation[] = [];

    for (const ev of batch.events ?? []) {
      const startMs = Date.parse(ev.start);
      if (!startMs) continue;
      const people = (ev.attendees ?? []).map((a) => a.toLowerCase()).filter((a) => !owner.has(a));
      const company = people.map(domainOf).find(Boolean) ?? null;

      let type: ObservationType;
      if (ev.status === "cancelled") type = "meeting_canceled";
      else if (startMs < nowMs) type = "meeting_completed";
      else if (startMs - nowMs <= 2 * DAY) type = "meeting_approaching";
      else type = "meeting_scheduled";

      out.push({
        id: observationId(ID, type, ev.id), connector: ID, type,
        timestamp: ev.start, observedAt,
        entity: ev.id, people, company, direction: null,
        evidence: { source: ID, nativeId: ev.id, subject: ev.summary, excerpt: ev.notes ?? ev.summary },
        confidence: 1,
        metadata: { end: ev.end ?? null, organizer: ev.organizer ?? null, status: ev.status ?? "confirmed" },
      });
    }
    return out;
  }

  run(input: CalendarBatch, nowMs: number): Promise<SyncResult> {
    return runConnector(this, input, nowMs);
  }
}
