// Meridian Command — Gmail thread normalization.
//
// Pure. Turns a raw thread into deterministic signals: direction of each message,
// last inbound/outbound, who owes a reply, participants, company, and the intent
// flags the classifier needs. Full-thread aware (a sent email with no reply and an
// unanswered inbound are both first-class signals).

import { hasAnySignal, isNoiseSender, matchSeed } from "./seeds";
import type { GmailMessage, GmailThread, MessageDirection } from "./types";

export function parseEmail(raw: string): { email: string; name: string } {
  const m = raw.match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim().toLowerCase();
  const name = (m ? raw.slice(0, m.index).replace(/["']/g, "").trim() : raw.split("@")[0]).trim();
  return { email, name };
}

export function decodeExcerpt(snippet: string | undefined, max = 180): string {
  if (!snippet) return "";
  const decoded = snippet
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/[͏​-‏⁠­]/g, "") // zero-width/soft-hyphen noise
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length > max ? `${decoded.slice(0, max)}…` : decoded;
}

function domainOf(email: string): string | null {
  const at = email.indexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase();
  // ignore consumer/provider domains for company inference
  const generic = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me"]);
  return generic.has(d) ? null : d;
}

export interface ThreadSignals {
  threadId: string;
  ownerEmails: Set<string>;
  messages: Array<GmailMessage & { direction: MessageDirection; ts: number }>;
  counterparties: string[]; // non-owner emails, most-frequent first
  primaryCounterparty: string | null;
  companyDomain: string | null;
  subject: string;
  combinedText: string; // subjects + snippets, lowercased
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  firstAt: number;
  lastAt: number;
  lastDirection: MessageDirection | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  isCalendarInvite: boolean;
  seedCompany: string | null;
  flags: {
    rejection: boolean;
    offer: boolean;
    applicationAck: boolean;
    meeting: boolean;
    referral: boolean;
    proposal: boolean;
    career: boolean;
  };
}

function directionOf(msg: GmailMessage, ownerEmails: Set<string>): MessageDirection {
  const { email } = parseEmail(msg.sender);
  if (ownerEmails.has(email)) return "outbound";
  if ((msg.labelIds ?? []).includes("SENT")) return "outbound";
  return "inbound";
}

export function normalizeThread(thread: GmailThread, ownerEmailsArr: string[]): ThreadSignals {
  const ownerEmails = new Set(ownerEmailsArr.map((e) => e.toLowerCase()));
  const messages = (thread.messages ?? [])
    .map((m) => ({ ...m, direction: directionOf(m, ownerEmails), ts: Date.parse(m.date) || 0 }))
    .filter((m) => m.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  const counterCounts = new Map<string, number>();
  for (const m of messages) {
    const from = parseEmail(m.sender).email;
    if (!ownerEmails.has(from)) counterCounts.set(from, (counterCounts.get(from) ?? 0) + 1);
    for (const r of m.toRecipients ?? []) {
      const e = parseEmail(r).email;
      if (!ownerEmails.has(e)) counterCounts.set(e, (counterCounts.get(e) ?? 0) + 0.5);
    }
  }
  const counterparties = [...counterCounts.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  const primaryCounterparty = counterparties[0] ?? null;

  const subjects = messages.map((m) => m.subject ?? "").filter(Boolean);
  const combinedText = messages.map((m) => `${m.subject ?? ""} ${m.snippet ?? ""}`).join(" ").toLowerCase();
  const subject = subjects[0] ?? "(no subject)";

  const inbound = messages.filter((m) => m.direction === "inbound");
  const outbound = messages.filter((m) => m.direction === "outbound");
  const last = messages[messages.length - 1] ?? null;

  const companyDomain = primaryCounterparty ? domainOf(primaryCounterparty) : null;
  const seed = matchSeed(`${combinedText} ${primaryCounterparty ?? ""} ${companyDomain ?? ""}`);

  const isCalendarInvite = subjects.some((s) => /^invitation:/i.test(s.trim()))
    || /google meet|has invited you|invited you to|calendar invite/i.test(combinedText);

  return {
    threadId: thread.id,
    ownerEmails,
    messages,
    counterparties,
    primaryCounterparty,
    companyDomain,
    subject,
    combinedText,
    messageCount: messages.length,
    inboundCount: inbound.length,
    outboundCount: outbound.length,
    firstAt: messages[0]?.ts ?? 0,
    lastAt: last?.ts ?? 0,
    lastDirection: last?.direction ?? null,
    lastInboundAt: inbound.length ? inbound[inbound.length - 1].ts : null,
    lastOutboundAt: outbound.length ? outbound[outbound.length - 1].ts : null,
    isCalendarInvite,
    seedCompany: seed?.company ?? null,
    flags: {
      rejection: hasAnySignal(combinedText, "rejection"),
      offer: hasAnySignal(combinedText, "offer"),
      applicationAck: hasAnySignal(combinedText, "applicationAck"),
      meeting: hasAnySignal(combinedText, "meeting") || isCalendarInvite,
      referral: hasAnySignal(combinedText, "referral"),
      proposal: hasAnySignal(combinedText, "proposal"),
      career: hasAnySignal(combinedText, "career"),
    },
  };
}

/** Is this thread just automated noise (newsletter/no-reply, owner never engaged, no seed)? */
export function isNoiseThread(sig: ThreadSignals): boolean {
  if (sig.seedCompany) return false; // known entity always kept
  if (sig.outboundCount > 0) return false; // owner engaged → real
  const everyInboundNoise = sig.messages
    .filter((m) => m.direction === "inbound")
    .every((m) => isNoiseSender(parseEmail(m.sender).email));
  return everyInboundNoise;
}

export { domainOf };
