// Meridian Command — Gmail seed entities + signal vocabulary.
//
// Seeds are KNOWN entities that boost relevance and canonicalize company names.
// They are NOT an allowlist: any real two-way human thread can become an
// opportunity. Seeds just make sure the ones we know about are never missed and
// are labeled consistently.

import type { OpportunityKind } from "./types";

export interface SeedEntity {
  company: string;
  kind: OpportunityKind;
  /** Lowercased match tokens: domains, names, keywords. Any hit = seed match. */
  match: string[];
}

/** Founder-curated seed registry. Extend as new entities appear — data, not logic. */
export const SEED_ENTITIES: SeedEntity[] = [
  { company: "Clue Insights", kind: "career", match: ["clue", "clue insights", "getclue.com", "getclue", "chandler", "josh mcdonald", "recruiterflow"] },
  { company: "Quext / OwnerLM", kind: "partnership", match: ["quext", "ownerlm", "owner lm", "blake"] },
  { company: "Chandler (Clue)", kind: "career", match: ["chandler"] },
  { company: "Ronco", kind: "career", match: ["ronco"] },
  { company: "Block & Mortar", kind: "partnership", match: ["block & mortar", "block and mortar", "usman"] },
  { company: "Clipboard Health", kind: "career", match: ["clipboard", "clipboardhealth", "clipboard health"] },
  { company: "SafetyCulture", kind: "career", match: ["safetyculture", "safety culture"] },
  { company: "Oracle", kind: "career", match: ["oracle"] },
  { company: "Holland 1916", kind: "sales", match: ["holland 1916", "holland1916"] },
  { company: "SoftDoes", kind: "partnership", match: ["softdoes", "soft does"] },
  { company: "Preston / Painting", kind: "consulting", match: ["preston", "painting", "bidding", "bid ", "estimate"] },
  { company: "LaborTech", kind: "sales", match: ["labortech", "labor tech"] },
];

/** Automated / newsletter senders — noise unless the owner engaged or a seed matched. */
export const NOISE_SENDER_PATTERNS = [
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "newsletter", "digest", "notifications@", "notification@",
  "alerts@", "jobseekers@", "mailer@", "updates@", "marketing@",
  "@email.ihire.com", "energyjobline.com", "historyfacts.com",
  "mail.coinbase.com", "messaging-digest-noreply@linkedin.com",
];

// ── Signal vocabularies (deterministic keyword sets) ────────────────────────

export const SIGNALS = {
  career: ["recruiter", "recruiting", "talent", "role", "position", "account executive", "ae role", "interview", "hiring", "hiring manager", "candidate", "application", "applying", "job", "offer letter", "onsite", "screen"],
  proposal: ["proposal", "estimate", "quote", "bid", "bidding", "scope of work", "statement of work", "sow", "contract", "invoice", "pricing"],
  referral: ["introduce", "introduction", "intro", "connect you", "connected with", "referral", "referred", "put you in touch", "loop in"],
  meeting: ["invitation:", "google meet", "zoom", "calendar", "meeting", "call", "let's chat", "schedule", "availability", "reschedule", "book a time"],
  rejection: ["not moving forward", "moving forward with other", "with other candidates", "other candidates", "proceed with other", "stronger fit", "a stronger candidate", "position has been filled", "decided to go", "decided to move forward with", "no longer considering", "not a fit", "will not be proceeding", "not to move forward", "pursue other candidates", "filled the position", "decided not to move"],
  offer: ["offer", "extend an offer", "excited to offer", "welcome to the team", "accepted", "signed", "onboarding"],
  applicationAck: ["thank you for applying", "received your application", "we will review your application", "application has been received"],
} as const;

const ALL_MATCH = SEED_ENTITIES.flatMap((s) => s.match);

/** Return the first seed entity whose tokens appear in the given text. */
export function matchSeed(text: string): SeedEntity | null {
  const t = text.toLowerCase();
  for (const seed of SEED_ENTITIES) {
    if (seed.match.some((m) => t.includes(m))) return seed;
  }
  return null;
}

export function textHasSeed(text: string): boolean {
  const t = text.toLowerCase();
  return ALL_MATCH.some((m) => t.includes(m));
}

export function isNoiseSender(sender: string): boolean {
  const s = sender.toLowerCase();
  return NOISE_SENDER_PATTERNS.some((p) => s.includes(p));
}

export function hasAnySignal(text: string, group: keyof typeof SIGNALS): boolean {
  const t = text.toLowerCase();
  return SIGNALS[group].some((k) => t.includes(k));
}
