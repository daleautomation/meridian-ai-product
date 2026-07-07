// Meridian Command — initial strategic memories for Dylan.
//
// Confidence reflects how well-grounded each is in existing project context. These
// are the founder-curated starting truths; the nightly review may propose more
// (as `pending`, never auto-accepted).

import type { Memory } from "./types";

const T0 = "2026-07-06T00:00:00.000Z";

function mem(p: Omit<Memory, "createdAt" | "updatedAt" | "status"> & Partial<Pick<Memory, "status">>): Memory {
  return { createdAt: T0, updatedAt: T0, status: p.status ?? "active", ...p };
}

export const MEMORY_SEEDS: Memory[] = [
  mem({ id: "seed-mission", type: "strategic_knowledge", subject: "Meridian", confidence: "high",
    statement: "Meridian's primary mission is increasing Dylan's revenue and career upside.",
    source: "manual", evidence: "MERIDIAN_TRUST_MODEL.md + founder direction", tags: ["mission", "revenue", "career"], impactAreas: ["revenue", "career", "product"] }),
  mem({ id: "seed-remote-saas", type: "preference", subject: "global", confidence: "high",
    statement: "Dylan prefers remote SaaS roles.",
    source: "manual", evidence: "AE applications: Clipboard, SafetyCulture, Clue (all remote SaaS)", tags: ["remote", "saas", "role"], impactAreas: ["career"] }),
  mem({ id: "seed-founder-led", type: "preference", subject: "global", confidence: "medium",
    statement: "Founder-led companies are high-leverage for Dylan.",
    source: "manual", evidence: "Blake/Quext + OwnerLM engagement", tags: ["founder-led", "startup"], impactAreas: ["career", "revenue", "relationships"] }),
  mem({ id: "seed-construction-saas", type: "strategic_knowledge", subject: "construction saas", confidence: "medium",
    statement: "Construction SaaS is strategically aligned with Dylan's background.",
    source: "manual", evidence: "Clue (equipment/fleet), Quext/OwnerLM (property/real estate ops)", tags: ["construction", "saas", "proptech"], impactAreas: ["career", "revenue"] }),
  mem({ id: "seed-clue-priority", type: "strategic_knowledge", subject: "Clue Insights", confidence: "high",
    statement: "Clue Insights is a high-priority opportunity (construction SaaS + remote + founder-led GTM).",
    source: "manual", evidence: "Active AE/CS process; meeting completed; follow-up sent", tags: ["clue", "construction", "saas", "priority"], impactAreas: ["career", "revenue"] }),
  mem({ id: "seed-blake-relationship", type: "strategic_knowledge", subject: "Blake Miller", confidence: "high",
    statement: "Blake / Quext / OwnerLM is a high-priority relationship and potential career multiplier.",
    source: "manual", evidence: "Multiple meetings; 'NO ONE does this'; OwnerLM collaboration in motion", tags: ["blake", "quext", "ownerlm", "multiplier"], impactAreas: ["relationships", "revenue", "career"] }),
  mem({ id: "seed-ownerlm-consulting", type: "strategic_knowledge", subject: "Quext / OwnerLM", confidence: "low",
    statement: "OwnerLM may become consulting revenue.",
    source: "manual", evidence: "Dylan offered to help get OwnerLM 'rolling'; not yet contracted", tags: ["ownerlm", "consulting", "revenue"], impactAreas: ["revenue", "cashflow"] }),
  mem({ id: "seed-painting-cashflow", type: "strategic_knowledge", subject: "Preston / Painting", confidence: "medium",
    statement: "Painting/bidding work is short-term cash flow, not the long-term path; it should not outrank high-upside SaaS opportunities unless immediate cash need is severe.",
    source: "manual", evidence: "Preston bid thread; contrasted with SaaS pipeline", tags: ["painting", "cashflow", "short-term"], impactAreas: ["cashflow", "revenue"] }),
  mem({ id: "seed-revenue-over-tinkering", type: "preference", subject: "global", confidence: "high",
    statement: "Meridian should prefer revenue-producing actions over software tinkering.",
    source: "manual", evidence: "Founder direction: 'the goal is better decisions, not more software'", tags: ["revenue", "focus", "anti-busywork"], impactAreas: ["revenue", "product"] }),
  mem({ id: "seed-deterministic", type: "preference", subject: "self", confidence: "high",
    statement: "Meridian should stay deterministic and explainable, and say UNKNOWN when evidence is weak.",
    source: "manual", evidence: "MERIDIAN_TRUST_MODEL.md + MERIDIAN_DECISION_ENGINE.md", tags: ["deterministic", "explainable", "trust"], impactAreas: ["product"] }),
  mem({ id: "seed-kc", type: "fact", subject: "Dylan", confidence: "high",
    statement: "Dylan lives in Kansas City.",
    source: "manual", evidence: "KC-area leads, apartment tours (Reverb, The Wade), TIFEC/local roles", tags: ["location", "kansas city"], impactAreas: ["housing"] }),
  mem({ id: "seed-meridian-domain", type: "fact", subject: "Meridian", confidence: "high",
    statement: "Meridian runs on meridianai.work and is the long-term operating system and business asset.",
    source: "manual", evidence: "Deployed domain; canonical docs", tags: ["meridian", "domain", "asset"], impactAreas: ["product"] }),
];
