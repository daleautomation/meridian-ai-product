import assert from "node:assert/strict";
import { decideCompany } from "../lib/scoring/companyDecision";
import { decideLead, decideNormalizedLead } from "../lib/scoring/decision";
import { detectContactConflicts, classifyContactPathTrust } from "../lib/contacts/trust";
import { buildTasksFromLeads, rankTasks } from "../lib/calendar/tasks";
import { scoreLeadTask } from "../lib/calendar/leadScore";
import { classifyLeadServiceNeeds } from "../lib/services/serviceNeedClassifier";
import type { CompanySnapshot } from "../lib/state/companySnapshotStore";
import type { ContactResolution, ContactPath } from "../lib/contacts/types";
import type { NormalizedLead } from "../lib/leads/normalizedLead";

const now = new Date();
const nowIso = now.toISOString();
const oldIso = new Date(now.getTime() - 21 * 86_400_000).toISOString();

function websiteResult(phone: string | null = "(816) 555-2200") {
  return {
    tool: "inspect_website",
    timestamp: nowIso,
    confidence: 100,
    data: {
      reachable: true,
      https: false,
      hasViewport: false,
      responseMs: 5000,
      title: "Test Roofer",
      metaDescription: null,
      contentBytes: 1000,
      weaknesses: ["no mobile viewport", "thin content", "no contact form", "no meta description"],
      homepage_fetch_ok: true,
      has_title: true,
      has_meta_description: false,
      has_contact_form: false,
      phone_from_site: phone,
      email_from_site: null,
      last_checked: nowIso,
      issues: [
        { code: "thin_content", description: "Thin content", impact: "Weak conversion", severity: "high" },
        { code: "no_mobile_viewport", description: "No viewport", impact: "Mobile loss", severity: "high" },
      ],
      site_classification: "partial_content",
    },
  };
}

function snapshot(overrides: Record<string, unknown>): CompanySnapshot {
  return ({
    key: "test-roofer",
    company: { name: "Test Roofer", domain: "https://testroofer.example", location: "Kansas City, MO" },
    createdAt: nowIso,
    updatedAt: nowIso,
    lastCheckedAt: nowIso,
    latest: { inspect_website: websiteResult() },
    history: [],
    statusHistory: [],
    ...overrides,
  } as unknown) as CompanySnapshot;
}

function verifiedGoogleResolution(lastVerifiedAt: string): ContactResolution {
  const path: ContactPath = {
    method: "phone",
    value: "(816) 555-2200",
    source: "google_places",
    verified: true,
    confidence: "high",
    rank: 1,
    label: "Google Business Profile phone",
    lastVerifiedAt,
  };
  return {
    phone: path.value,
    email: null,
    fallbackRoute: null,
    fallbackUrl: "https://testroofer.example",
    source: "google_places",
    confidence: "high",
    checkedSources: ["google_places"],
    matchedName: "Test Roofer",
    lastCheckedAt: lastVerifiedAt,
    summary: "found",
    paths: [path],
  };
}

{
  const decision = decideCompany(snapshot({ contactResolution: undefined, contactResolutionCheckedAt: undefined }));
  assert.notEqual(decision.bucket, "CALL NOW", "unverified website phone cannot reach CALL NOW bucket");
  assert.notEqual(decision.recommendedAction, "CALL NOW", "unverified website phone cannot be recommended CALL NOW");
  assert.equal(decision.contacts.phoneTrust?.trustLevel, "WEAK");
  assert.equal(decision.nextAction.action, "VERIFY CONTACT");
}

{
  const staleResolution = verifiedGoogleResolution(oldIso);
  const staleSnapshot = snapshot({
    contactResolution: staleResolution,
    contactResolutionCheckedAt: oldIso,
    latest: { inspect_website: websiteResult(null) },
  });
  const decision = decideCompany(staleSnapshot);
  assert.equal(decision.contacts.phoneTrust?.trustLevel, "STALE");
  assert.notEqual(decision.bucket, "CALL NOW", "stale verified phone cannot reach CALL NOW bucket");
  assert.notEqual(decision.recommendedAction, "CALL NOW", "stale verified phone cannot be recommended CALL NOW");
  assert.notEqual(decideLead(decision, { snapshot: staleSnapshot }).bucket, "Call now", "stale phone cannot reach user-facing Call now");
}

{
  const paths: ContactPath[] = [
    { method: "phone", value: "(816) 555-2200", source: "google_places", verified: true, confidence: "high", rank: 1, label: "GBP phone", lastVerifiedAt: nowIso },
    { method: "phone", value: "(913) 555-2201", source: "yelp", verified: true, confidence: "high", rank: 2, label: "Yelp phone", lastVerifiedAt: nowIso },
  ];
  const conflict = detectContactConflicts({ paths, matchType: "exact" });
  const trust = classifyContactPathTrust(paths[0], {
    lastVerifiedAt: nowIso,
    conflictStatus: conflict.status,
    conflictReasons: conflict.reasons,
    rejectedAlternatives: conflict.rejectedAlternatives,
  });
  const conflictingResolution: ContactResolution = {
    ...verifiedGoogleResolution(nowIso),
    paths,
    phoneTrust: trust,
    contactTrust: trust,
    trustLevel: trust.trustLevel,
    conflictStatus: conflict.status,
    conflictReasons: conflict.reasons,
    rejectedContactAlternatives: conflict.rejectedAlternatives,
  };
  const conflictingSnapshot = snapshot({
    contactResolution: conflictingResolution,
    contactResolutionCheckedAt: nowIso,
    latest: { inspect_website: websiteResult(null) },
  });
  const decision = decideCompany(conflictingSnapshot);
  assert.equal(decision.contacts.phoneTrust?.trustLevel, "CONFLICTING");
  assert.notEqual(decision.bucket, "CALL NOW", "conflicting phones cannot silently resolve to CALL NOW");
  assert.notEqual(decideLead(decision, { snapshot: conflictingSnapshot }).bucket, "Call now", "conflicting phones cannot reach user-facing Call now");
  assert.ok((decision.contacts.rejectedContactAlternatives ?? []).length > 0, "conflict alternatives are surfaced");
}

{
  const lead: NormalizedLead = {
    id: "seed-phone",
    workspaceSlug: "labortech",
    moduleId: "roofing",
    companyName: "Seed Phone Roofer",
    phone: "(816) 555-2200",
    source: "seed",
    sourceStatus: "available",
    lastChecked: nowIso,
    signals: { hasWebsite: false, reviewCount: 5 },
    crm: {},
    evidence: [],
  };
  const decision = decideNormalizedLead(lead);
  assert.equal(decision.bucket, "Watch", "seed phone without deterministic verification is not Call now");
}

{
  const trustedLead = {
    key: "trusted-phone-lead",
    name: "Trusted Phone Roofer",
    score: 80,
    bucket: "CALL NOW",
    recommendedAction: "CALL NOW",
    websiteProof: { homepage_fetch_ok: true, issues: ["weak quote path"] },
    contactPaths: [{
      method: "phone",
      value: "(816) 555-2200",
      source: "google_places",
      verified: true,
      confidence: "high",
      rank: 1,
      lastVerifiedAt: nowIso,
    }],
  };
  const weakLead = {
    key: "weak-contact-lead",
    name: "Weak Contact Roofer",
    score: 99,
    bucket: "CALL NOW",
    recommendedAction: "CALL NOW",
    phone: "(816) 555-2201",
    source: "seed",
    websiteProof: { homepage_fetch_ok: true, issues: ["website down"] },
  };
  const tasks = buildTasksFromLeads([weakLead, trustedLead], { now, maxLeads: 2 });
  const trustedTask = tasks.find((task) => task.id === "lead-trusted-phone-lead-call");
  const weakTask = tasks.find((task) => task.id === "lead-weak-contact-lead-verify-contact");
  assert.ok(trustedTask, "trusted phone lead gets a call task");
  assert.ok(weakTask, "weak contact lead gets verification work");
  assert.equal(trustedTask.phoneAuthority, "dialable", "trusted lead carries dial authority");
  assert.equal(weakTask.phoneAuthority, undefined, "weak contact lead does not carry dial authority");
  assert.equal(weakTask.category, "contact_verification", "weak contact lead is moved to contact verification lane");
  assert.ok(weakTask.title.startsWith("Needs contact verification:"), "weak contact lead is framed as contact verification");
  assert.ok(scoreLeadTask(trustedTask, { now }).taskScore > scoreLeadTask(weakTask, { now }).taskScore, "trusted phone outranks weak contact");
  assert.equal(rankTasks([weakTask, trustedTask], now)[0].id, trustedTask.id, "ranked call queue prefers executable contact paths");
}

{
  const googleLead: NormalizedLead = {
    id: "google-phone",
    workspaceSlug: "labortech",
    moduleId: "roofing",
    companyName: "Google Verified Roofer",
    phone: "(816) 222-2200",
    source: "google_places",
    sourceStatus: "connected",
    lastChecked: nowIso,
    signals: { hasWebsite: true, reviewCount: 12, rating: 4.3 },
    crm: {},
    evidence: [{ label: "Phone found", value: "(816) 222-2200", source: "google_places", confidence: "high" }],
  };
  const decision = decideNormalizedLead(googleLead);
  assert.notEqual(decision.bucket, "Watch", "fresh Google Places phone is callable even without prebuilt contactPaths");
  const tasks = buildTasksFromLeads([{ ...googleLead, decision, score: decision.score, bucket: "CALL NOW" }], { now, maxLeads: 1 });
  const callTask = tasks.find((task) => task.id === "lead-google-phone-call");
  assert.ok(callTask, "Google Places phone enters the call queue");
  assert.equal(callTask?.phoneAuthority, "dialable", "Google Places phone carries dial authority");
  assert.equal(callTask?.contactQualityState, "verified_phone", "call task exposes specific verified-phone contact state");
}

{
  const services = classifyLeadServiceNeeds({
    id: "service-coverage",
    workspaceSlug: "labortech",
    moduleId: "roofing",
    companyName: "Coverage Roofer",
    phone: "(816) 222-2200",
    website: "https://coverageroofer.example",
    source: "google_places",
    sourceStatus: "connected",
    lastChecked: nowIso,
    signals: { hasWebsite: true, reviewCount: 12, rating: 4.2 },
    crm: {},
    evidence: [],
  }, "roofing").map((need) => need.serviceId);
  for (const serviceId of [
    "seo",
    "reputation_management",
    "google_ads",
    "meta_ads",
    "media_production",
    "voice_ai_agent",
    "chat_ai_agent",
    "appointment_scheduler",
    "crm",
    "email_sms",
    "social_media_management",
    "blog_posting",
    "lead_generation",
  ]) {
    assert.ok(services.includes(serviceId), `service coverage includes ${serviceId}`);
  }
}

console.log("contact trust checks passed");
