// Meridian Command — GmailConnector (read-only). Observes only.
//
// Reuses lib/gmail/normalize (parseEmail, direction, decode) but emits ONLY
// Observations — no stages, no opportunities, no scoring. The stage/momentum
// interpretation that lib/gmail/classify.ts does for the standalone scanner now
// belongs to the Belief Engine; this connector just reports what happened.

import { decodeExcerpt, isNoiseThread, normalizeThread, parseEmail } from "@/lib/gmail/normalize";
import { hasAnySignal } from "@/lib/gmail/seeds";
import type { GmailThreadBatch } from "@/lib/gmail/types";
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

const ID = "gmail";

export class GmailConnector implements Connector<GmailThreadBatch> {
  capabilities(): Capabilities {
    return {
      id: ID,
      emits: ["message_received", "message_sent", "meeting_invited", "interview_invited",
        "application_ack", "rejection_received", "offer_received", "referral_offered", "no_response"],
      readOnly: true,
      inputMode: "batch",
      description: "Reads Gmail threads (via MCP-produced batch) and emits communication + lifecycle observations.",
    };
  }

  async health(input?: GmailThreadBatch): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!input || !Array.isArray(input.threads)) {
      return { id: ID, state: "unavailable", detail: "no thread batch provided", checkedAt };
    }
    if (!input.ownerEmails?.length) {
      return { id: ID, state: "degraded", detail: "ownerEmails missing — direction may be wrong", checkedAt };
    }
    return { id: ID, state: "ok", detail: `${input.threads.length} threads`, checkedAt };
  }

  async authenticate(): Promise<AuthStatus> {
    return { id: ID, authenticated: true, method: "mcp-session", detail: "Gmail read via Claude MCP session (read-only)." };
  }

  async lastSync(): Promise<string | null> {
    return null;
  }

  async collectObservations(batch: GmailThreadBatch, nowMs: number): Promise<Observation[]> {
    const observedAt = new Date(nowMs).toISOString();
    const owner = batch.ownerEmails ?? [];
    const out: Observation[] = [];

    for (const thread of batch.threads ?? []) {
      const sig = normalizeThread(thread, owner);
      if (isNoiseThread(sig)) continue; // pure newsletters aren't reality worth observing
      const company = sig.companyDomain;
      const people = sig.counterparties;

      for (const m of sig.messages) {
        const type: ObservationType = m.direction === "outbound" ? "message_sent" : "message_received";
        out.push(mk(type, m.id, thread.id, m.ts, people, company, m.direction, {
          subject: m.subject, excerpt: decodeExcerpt(m.snippet),
        }, { from: parseEmail(m.sender).email }));
      }

      // Derived lifecycle observations (facts, not stages).
      const text = sig.combinedText;
      const lastTs = sig.lastAt;
      if (sig.isCalendarInvite) {
        out.push(mk("meeting_invited", `${thread.id}:invite`, thread.id, lastTs, people, company, "inbound",
          { subject: sig.subject, excerpt: "calendar invitation present in thread" }, {}));
      }
      if (hasAnySignal(text, "applicationAck")) {
        out.push(mk("application_ack", `${thread.id}:appack`, thread.id, lastTs, people, company, "inbound",
          { subject: sig.subject, excerpt: "application acknowledgement" }, {}));
      }
      if (hasAnySignal(text, "rejection")) {
        out.push(mk("rejection_received", `${thread.id}:reject`, thread.id, lastTs, people, company, "inbound",
          { subject: sig.subject, excerpt: "rejection language detected" }, {}));
      }
      if (hasAnySignal(text, "offer")) {
        out.push(mk("offer_received", `${thread.id}:offer`, thread.id, lastTs, people, company, "inbound",
          { subject: sig.subject, excerpt: "offer language detected" }, {}));
      }
      if (hasAnySignal(text, "referral")) {
        out.push(mk("referral_offered", `${thread.id}:referral`, thread.id, lastTs, people, company, null,
          { subject: sig.subject, excerpt: "referral/introduction language detected" }, {}));
      }
      // No-response: I sent last and it's been quiet.
      if (sig.lastDirection === "outbound" && (nowMs - sig.lastAt) >= 3 * 86_400_000) {
        out.push(mk("no_response", `${thread.id}:noresp`, thread.id, sig.lastAt, people, company, "outbound",
          { subject: sig.subject, excerpt: `no reply since ${new Date(sig.lastAt).toISOString().slice(0, 10)}` }, {}));
      }
    }
    return out;

    function mk(
      type: ObservationType, nativeId: string, entity: string, ts: number,
      people: string[], company: string | null, direction: Observation["direction"],
      ev: { subject?: string; excerpt?: string }, metadata: Record<string, unknown>,
    ): Observation {
      return {
        id: observationId(ID, type, nativeId), connector: ID, type,
        timestamp: new Date(ts).toISOString(), observedAt,
        entity, people, company, direction,
        evidence: { source: ID, nativeId, subject: ev.subject, excerpt: ev.excerpt },
        confidence: 1, metadata,
      };
    }
  }

  run(input: GmailThreadBatch, nowMs: number): Promise<SyncResult> {
    return runConnector(this, input, nowMs);
  }
}
