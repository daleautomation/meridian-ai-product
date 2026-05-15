import type {
  RelationshipPriorityCard,
  RelationshipPriorityNavId,
  RelationshipPriorityWorkspaceModel,
} from "@/lib/relationship-priority/workspace";

export type ShowcaseVerticalId =
  | "roofing"
  | "restoration"
  | "real-estate"
  | "agency"
  | "recruiting"
  | "solar"
  | "insurance"
  | "home-services"
  | "financial-advisors"
  | "saas-sales";

export type DemoPresetId =
  | "stale-crm"
  | "recovery-queue"
  | "follow-up-recovery"
  | "relationship-prioritization"
  | "outbound-execution";

export type RelationshipPriorityShowcaseConfig = {
  enabled: boolean;
  vertical: ShowcaseVerticalId;
  preset: DemoPresetId;
};

export type RelationshipPriorityShowcaseModel = {
  enabled: true;
  vertical: ShowcaseVertical;
  preset: DemoPreset;
  narratives: string[];
  beforeAfter: {
    beforeTitle: string;
    beforeItems: string[];
    afterTitle: string;
    afterItems: string[];
  };
  screenSafe: {
    label: string;
    detail: string;
  };
};

type SearchParamValue = string | string[] | undefined;

type ShowcaseVertical = {
  id: ShowcaseVerticalId;
  label: string;
  eyebrow: string;
  workspaceLabel: string;
  queueLabel: string;
  relationshipNoun: string;
  opportunityNoun: string;
  actionNoun: string;
  accent: string;
  glow: string;
  companies: string[];
  contactTitles: string[];
  signals: string[];
  narrative: string;
};

type DemoPreset = {
  id: DemoPresetId;
  label: string;
  heroFocus: string;
  storyline: string;
  initialNav: RelationshipPriorityNavId;
  stage: string;
  relationshipLabel: string;
  actions: RelationshipPriorityCard["recommendedAction"][];
  reasonTemplates: string[];
  nextStepTemplates: string[];
  signals: string[];
  beforeTitle: string;
  beforeItems: string[];
  afterTitle: string;
  afterItems: string[];
  narratives: string[];
};

export function parseShowcaseConfig(params: {
  mode?: SearchParamValue;
  showcase?: SearchParamValue;
  vertical?: SearchParamValue;
  preset?: SearchParamValue;
}): RelationshipPriorityShowcaseConfig | null {
  const vertical = normalizeVertical(firstParam(params.vertical));
  const preset = normalizePreset(firstParam(params.preset));
  const requestedMode = firstParam(params.mode);
  const requestedShowcase = firstParam(params.showcase);
  const enabled = requestedMode === "showcase"
    || requestedShowcase === "1"
    || requestedShowcase === "true"
    || Boolean(firstParam(params.vertical))
    || Boolean(firstParam(params.preset));

  if (!enabled) return null;
  return {
    enabled: true,
    vertical: vertical ?? "roofing",
    preset: preset ?? "relationship-prioritization",
  };
}

export function applyShowcaseDemoPreset(
  model: RelationshipPriorityWorkspaceModel,
  config: RelationshipPriorityShowcaseConfig | null | undefined,
): RelationshipPriorityWorkspaceModel {
  if (!config?.enabled) return model;

  const vertical = SHOWCASE_VERTICALS[config.vertical];
  const preset = DEMO_PRESETS[config.preset];
  const priorityQueue = model.priorityQueue.slice(0, 6).map((card, index) =>
    overlayCard(card, index, vertical, preset),
  );
  const recoveryQueue = queueForPreset(priorityQueue, preset, "recovery");
  const followUpQueue = queueForPreset(priorityQueue, preset, "follow-up");
  const outcomeNotes = priorityQueue.slice(0, 4).map((card) => ({
    id: `showcase-outcome-${card.id}`,
    relationshipId: card.relationshipId,
    label: `${card.recommendedAction} ready`,
    detail: `${card.company}: ${card.nextStep}`,
  }));
  const readyNowCount = priorityQueue.filter((card) => card.urgency === "Now").length;

  return {
    ...model,
    demoMode: true,
    workspace: {
      ...model.workspace,
      name: vertical.workspaceLabel,
      accentLabel: `${vertical.label} showcase workspace`,
    },
    hero: {
      question: preset.storyline,
      focus: preset.heroFocus,
      answer: priorityQueue[0]
        ? `${priorityQueue[0].company} is first because ${lowercaseFirst(priorityQueue[0].topReasons[0])}`
        : "Meridian turns stale relationship data into the next best action.",
    },
    nav: [
      { id: "priority", label: vertical.queueLabel, count: priorityQueue.length },
      { id: "recovery", label: "Recovery", count: recoveryQueue.length },
      { id: "follow-up", label: "Follow-Up", count: followUpQueue.length },
      { id: "outcomes", label: "Before / After", count: 2 },
    ],
    summary: {
      ...model.summary,
      priorityCount: priorityQueue.length,
      readyNowCount,
      averageMarketFit: average(priorityQueue.map((card) => card.marketFit)),
      followUpsDue: followUpQueue.length,
      compressedSignals: priorityQueue.length * 4,
    },
    priorityQueue,
    recoveryQueue,
    followUpQueue,
    outcomeNotes,
    assistantPrompts: [
      `Draft the next ${vertical.actionNoun.toLowerCase()} for the selected ${vertical.relationshipNoun.toLowerCase()}.`,
      `Turn this ${preset.label.toLowerCase()} into a 30-second demo narration.`,
      `Explain why this ${vertical.opportunityNoun.toLowerCase()} is first in one sentence.`,
    ],
    simplificationNotes: [
      "Showcase Mode centers the priority queue and hides backend diagnostics.",
      "Vertical overlays change context and terminology without duplicating infrastructure.",
      "Demo presets reshape the same relationship-priority model into repeatable content stories.",
    ],
    deferred: [
      ...model.deferred,
      "Live exports for generated TikTok scripts and sales decks remain future workflow hooks.",
    ],
    showcase: {
      enabled: true,
      vertical,
      preset,
      narratives: [...preset.narratives, vertical.narrative],
      beforeAfter: {
        beforeTitle: preset.beforeTitle,
        beforeItems: preset.beforeItems,
        afterTitle: preset.afterTitle,
        afterItems: preset.afterItems,
      },
      screenSafe: {
        label: "9:16 safe center",
        detail: "Priority, why-now, contact, and next action stay inside the recording center.",
      },
    },
  };
}

function overlayCard(
  card: RelationshipPriorityCard,
  index: number,
  vertical: ShowcaseVertical,
  preset: DemoPreset,
): RelationshipPriorityCard {
  const company = vertical.companies[index % vertical.companies.length];
  const action = preset.actions[index % preset.actions.length];
  const topReason = fillTemplate(
    preset.reasonTemplates[index % preset.reasonTemplates.length],
    vertical,
    company,
  );
  const secondReason = fillTemplate(
    preset.reasonTemplates[(index + 1) % preset.reasonTemplates.length],
    vertical,
    company,
  );
  const nextStep = fillTemplate(
    preset.nextStepTemplates[index % preset.nextStepTemplates.length],
    vertical,
    company,
  );

  return {
    ...card,
    id: `showcase-${vertical.id}-${preset.id}-${index + 1}`,
    relationshipId: `showcase-${vertical.id}-${preset.id}-${index + 1}`,
    rank: index + 1,
    company,
    relationship: index === 0 ? preset.relationshipLabel : card.relationship,
    marketFit: [97, 93, 89, 86, 82, 78][index] ?? card.marketFit,
    urgency: index === 0 ? "Now" : index < 4 ? "Today" : "This week",
    importance: index === 0 ? "highest" : index < 3 ? "high" : "medium",
    stage: preset.stage,
    topReasons: [
      topReason,
      secondReason,
      `${vertical.signals[index % vertical.signals.length]} is active now.`,
    ],
    bestContact: {
      ...card.bestContact,
      title: vertical.contactTitles[index % vertical.contactTitles.length],
    },
    recommendedAction: action,
    nextStep,
    suggestedAngle: `Lead with the ${vertical.opportunityNoun.toLowerCase()} signal, then ask for one clear ${vertical.actionNoun.toLowerCase()}.`,
    topSignals: [
      ...preset.signals.slice(0, 2),
      vertical.signals[index % vertical.signals.length],
      `${vertical.label} overlay`,
    ],
    relationshipHistory: [
      `${vertical.relationshipNoun} context preserved from the relationship-priority workspace.`,
      `${preset.label} frames the demo without exposing backend diagnostics.`,
    ],
    followUpHistory: [
      index % 2 === 0
        ? "Prior touchpoint is ready for a clean recovery action."
        : "Follow-up window is still warm enough to act today.",
    ],
    source: {
      kind: "demo-generated",
      queueKind: `${vertical.id}_${preset.id}_showcase`,
      confidence: "high",
    },
  };
}

function queueForPreset(
  priorityQueue: RelationshipPriorityCard[],
  preset: DemoPreset,
  lane: "recovery" | "follow-up",
): RelationshipPriorityCard[] {
  if (preset.id === "recovery-queue") {
    return lane === "recovery" ? priorityQueue : priorityQueue.slice(1, 4);
  }
  if (preset.id === "follow-up-recovery") {
    return lane === "follow-up" ? priorityQueue : priorityQueue.slice(0, 4);
  }
  if (preset.id === "stale-crm") {
    return lane === "recovery" ? priorityQueue.slice(0, 5) : priorityQueue.slice(0, 3);
  }
  if (preset.id === "outbound-execution") {
    return lane === "follow-up" ? priorityQueue.slice(0, 2) : priorityQueue.slice(2, 5);
  }
  return lane === "recovery"
    ? priorityQueue.filter((card) => card.stage.toLowerCase().includes("recovery"))
    : priorityQueue.filter((card) => card.recommendedAction === "Follow Up");
}

function fillTemplate(template: string, vertical: ShowcaseVertical, company: string): string {
  return template
    .replaceAll("{company}", company)
    .replaceAll("{relationship}", vertical.relationshipNoun.toLowerCase())
    .replaceAll("{opportunity}", vertical.opportunityNoun.toLowerCase())
    .replaceAll("{action}", vertical.actionNoun.toLowerCase());
}

function firstParam(value: SearchParamValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim().toLowerCase() || undefined;
}

function normalizeVertical(value: string | undefined): ShowcaseVerticalId | null {
  if (!value) return null;
  const normalized = value.replaceAll("_", "-");
  return normalized in SHOWCASE_VERTICALS ? normalized as ShowcaseVerticalId : null;
}

function normalizePreset(value: string | undefined): DemoPresetId | null {
  if (!value) return null;
  const normalized = value.replaceAll("_", "-");
  return normalized in DEMO_PRESETS ? normalized as DemoPresetId : null;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function lowercaseFirst(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

const SHOWCASE_VERTICALS: Record<ShowcaseVerticalId, ShowcaseVertical> = {
  roofing: {
    id: "roofing",
    label: "Roofing",
    eyebrow: "Roofing estimates",
    workspaceLabel: "Meridian Roofing Showcase",
    queueLabel: "Estimate Priority Queue",
    relationshipNoun: "Contractor relationship",
    opportunityNoun: "estimate",
    actionNoun: "job follow-up",
    accent: "#EA7A21",
    glow: "rgba(234, 122, 33, 0.18)",
    companies: ["Northstar Roofing Group", "Summit Exterior Partners", "Prairie Commercial Roofing", "Atlas Building Envelope", "Harbor Restoration Roofline", "Blue Ridge Exteriors"],
    contactTitles: ["Owner", "General Manager", "Estimator", "Operations Lead", "Partner", "Sales Manager"],
    signals: ["storm-season demand", "open estimate", "review momentum", "inspection window"],
    narrative: "Stale roofing estimates become a calm call list with one next step.",
  },
  restoration: {
    id: "restoration",
    label: "Restoration",
    eyebrow: "Restoration recovery",
    workspaceLabel: "Meridian Restoration Showcase",
    queueLabel: "Claim Recovery Queue",
    relationshipNoun: "Property-loss relationship",
    opportunityNoun: "claim",
    actionNoun: "recovery touchpoint",
    accent: "#D97706",
    glow: "rgba(217, 119, 6, 0.18)",
    companies: ["Apex Restoration Co.", "Dryline Response Group", "Summit Mitigation Partners", "Harbor Property Recovery", "Clearwater Remediation", "FirstLight Restoration"],
    contactTitles: ["Claims Coordinator", "Owner", "Mitigation Lead", "Estimator", "Operations Manager", "Referral Partner"],
    signals: ["loss date aging", "adjuster response", "documentation gap", "referral warmth"],
    narrative: "A messy claim list turns into the relationships most likely to move today.",
  },
  "real-estate": {
    id: "real-estate",
    label: "Real Estate",
    eyebrow: "Agent follow-up",
    workspaceLabel: "Meridian Real Estate Showcase",
    queueLabel: "Client Priority Queue",
    relationshipNoun: "Client relationship",
    opportunityNoun: "listing opportunity",
    actionNoun: "client follow-up",
    accent: "#C76B1A",
    glow: "rgba(199, 107, 26, 0.16)",
    companies: ["Palmer Realty Collective", "Northline Homes", "Beacon Property Group", "Elm & Harbor Realty", "Crestview Listings", "Aster Residential"],
    contactTitles: ["Past Client", "Listing Lead", "Referral Partner", "Buyer Contact", "Investor Contact", "Agent Partner"],
    signals: ["valuation interest", "past-client timing", "listing intent", "referral path"],
    narrative: "The next client touchpoint is centered instead of buried in the CRM.",
  },
  agency: {
    id: "agency",
    label: "Agency",
    eyebrow: "Agency pipeline",
    workspaceLabel: "Meridian Agency Showcase",
    queueLabel: "Pipeline Recovery Queue",
    relationshipNoun: "Client relationship",
    opportunityNoun: "proposal",
    actionNoun: "pipeline action",
    accent: "#E67E22",
    glow: "rgba(230, 126, 34, 0.17)",
    companies: ["Northline Studio", "Signal & Co.", "Brightfield Creative", "Aster Growth Lab", "Copperline Digital", "Waypoint Agency"],
    contactTitles: ["Founder", "Marketing Lead", "Client Sponsor", "Revenue Lead", "Brand Director", "Operator"],
    signals: ["proposal stalled", "budget timing", "decision-maker activity", "scope question"],
    narrative: "Dormant proposals become a focused recovery sequence.",
  },
  recruiting: {
    id: "recruiting",
    label: "Recruiting",
    eyebrow: "Candidate recovery",
    workspaceLabel: "Meridian Recruiting Showcase",
    queueLabel: "Candidate Priority Queue",
    relationshipNoun: "Candidate relationship",
    opportunityNoun: "placement",
    actionNoun: "candidate touchpoint",
    accent: "#F08A24",
    glow: "rgba(240, 138, 36, 0.18)",
    companies: ["Horizon Talent Partners", "Mosaic Search", "Cobalt Recruiting", "Northstar Talent", "Beacon People Ops", "Apex Hiring Team"],
    contactTitles: ["Candidate", "Hiring Manager", "Recruiting Lead", "Passive Candidate", "Talent Partner", "Client Sponsor"],
    signals: ["candidate warmed", "interview lag", "role reopened", "reply window"],
    narrative: "Candidate and hiring-manager relationships are ranked by recovery potential.",
  },
  solar: {
    id: "solar",
    label: "Solar",
    eyebrow: "Solar outreach",
    workspaceLabel: "Meridian Solar Showcase",
    queueLabel: "Install Priority Queue",
    relationshipNoun: "Homeowner relationship",
    opportunityNoun: "solar install",
    actionNoun: "proposal follow-up",
    accent: "#E98A15",
    glow: "rgba(233, 138, 21, 0.18)",
    companies: ["Solara Home Energy", "Suncrest Advisors", "Helio Ridge", "BrightRoof Solar", "Cedar Volt", "NorthPeak Energy"],
    contactTitles: ["Homeowner", "Energy Advisor", "Install Lead", "Referral Partner", "Operations Lead", "Sales Manager"],
    signals: ["proposal viewed", "incentive deadline", "utility bill fit", "consult booked"],
    narrative: "Warm solar proposals become a clean next-best-action queue.",
  },
  insurance: {
    id: "insurance",
    label: "Insurance",
    eyebrow: "Policy relationships",
    workspaceLabel: "Meridian Insurance Showcase",
    queueLabel: "Policy Priority Queue",
    relationshipNoun: "Policyholder relationship",
    opportunityNoun: "coverage review",
    actionNoun: "advisor touchpoint",
    accent: "#D97822",
    glow: "rgba(217, 120, 34, 0.17)",
    companies: ["Crestview Risk Partners", "Harborline Insurance", "Beacon Coverage Group", "Aster Risk Advisors", "Northstar Benefits", "ClearPath Policy"],
    contactTitles: ["Policyholder", "Broker", "Account Manager", "Producer", "Referral Partner", "Client Sponsor"],
    signals: ["renewal window", "coverage gap", "claim activity", "referral warmth"],
    narrative: "Renewal and coverage signals are compressed into the relationships that need action.",
  },
  "home-services": {
    id: "home-services",
    label: "Home Services",
    eyebrow: "Home services follow-up",
    workspaceLabel: "Meridian Home Services Showcase",
    queueLabel: "Service Priority Queue",
    relationshipNoun: "Customer relationship",
    opportunityNoun: "service request",
    actionNoun: "service follow-up",
    accent: "#E87922",
    glow: "rgba(232, 121, 34, 0.17)",
    companies: ["Blue Ridge Home Services", "Oakline HVAC", "Summit Plumbing Co.", "Harbor Electric", "Apex Home Care", "Prairie Service Group"],
    contactTitles: ["Homeowner", "Dispatcher", "Operations Lead", "Service Manager", "Referral Partner", "Owner"],
    signals: ["missed estimate", "repeat customer", "seasonal demand", "service window"],
    narrative: "Every missed service opportunity becomes a clear recovery action.",
  },
  "financial-advisors": {
    id: "financial-advisors",
    label: "Financial Advisors",
    eyebrow: "Advisor relationships",
    workspaceLabel: "Meridian Advisor Showcase",
    queueLabel: "Relationship Priority Queue",
    relationshipNoun: "Client relationship",
    opportunityNoun: "planning opportunity",
    actionNoun: "advisor follow-up",
    accent: "#C96E1A",
    glow: "rgba(201, 110, 26, 0.16)",
    companies: ["Beacon Wealth Partners", "Northstar Advisory", "Harborline Capital", "Summit Family Office", "Aster Planning Group", "Crestview Advisors"],
    contactTitles: ["Client", "COI Partner", "Prospect", "Household Contact", "Advisor", "Referral Partner"],
    signals: ["life-event signal", "review window", "asset movement", "referral path"],
    narrative: "Advisor relationships are prioritized by trust, timing, and next action.",
  },
  "saas-sales": {
    id: "saas-sales",
    label: "SaaS Sales",
    eyebrow: "SaaS pipeline",
    workspaceLabel: "Meridian SaaS Showcase",
    queueLabel: "Revenue Priority Queue",
    relationshipNoun: "Account relationship",
    opportunityNoun: "pipeline opportunity",
    actionNoun: "sales action",
    accent: "#F08A24",
    glow: "rgba(240, 138, 36, 0.18)",
    companies: ["Cloudline Revenue Team", "Northstar Software", "BeaconOps", "Aster Data", "HarborStack", "Cobalt GTM"],
    contactTitles: ["VP Sales", "Champion", "RevOps Lead", "Economic Buyer", "Founder", "Sales Manager"],
    signals: ["champion activity", "deal aging", "buyer intent", "renewal timing"],
    narrative: "Sales teams see the next account to move, not another analytics wall.",
  },
};

const DEMO_PRESETS: Record<DemoPresetId, DemoPreset> = {
  "stale-crm": {
    id: "stale-crm",
    label: "Stale CRM Demo",
    heroFocus: "From stale CRM to priority queue",
    storyline: "Show the before-and-after shift from buried records to the relationships worth acting on now.",
    initialNav: "priority",
    stage: "Stale CRM recovery",
    relationshipLabel: "Stale but recoverable",
    actions: ["Call", "Follow Up", "Email", "Open Context"],
    reasonTemplates: [
      "{company} has a stale {opportunity} with a warm relationship signal.",
      "The last promised {action} is aging and still recoverable.",
      "CRM notes are noisy, but the next operator action is clear.",
    ],
    nextStepTemplates: [
      "Call {company} and reopen the {opportunity} with one practical next step.",
      "Send a concise follow-up that references the prior promise.",
      "Open context, confirm the signal, then execute the recovery action.",
    ],
    signals: ["Stale record", "Warm intent", "Recovery window"],
    beforeTitle: "Cluttered CRM",
    beforeItems: ["Rows sorted by last edited", "Notes hide the next step", "Operator hunts for who matters"],
    afterTitle: "Meridian Priority Queue",
    afterItems: ["Best relationship first", "Why-now explained plainly", "One next action visible"],
    narratives: ["Start on the messy CRM idea, then reveal the single relationship Meridian would work first."],
  },
  "recovery-queue": {
    id: "recovery-queue",
    label: "Recovery Queue Demo",
    heroFocus: "Recovery Queue",
    storyline: "Show the highest-value relationships that can still be recovered today.",
    initialNav: "recovery",
    stage: "Recovery queue",
    relationshipLabel: "Recovery opportunity",
    actions: ["Call", "Follow Up", "Assign", "Email"],
    reasonTemplates: [
      "{company} is slipping, but the recovery signal is still active.",
      "A missed {action} is creating avoidable relationship risk.",
      "The best contact is known, so execution can happen now.",
    ],
    nextStepTemplates: [
      "Call {company} with a direct recovery opener.",
      "Assign ownership, then complete the promised follow-up today.",
      "Send a short recovery note with one easy response path.",
    ],
    signals: ["Recovery risk", "Known contact", "Open promise"],
    beforeTitle: "At-risk relationships",
    beforeItems: ["Missed follow-ups spread across tools", "No clear owner", "Revenue leaks quietly"],
    afterTitle: "Recovery queue",
    afterItems: ["Risk ordered by urgency", "Owner and contact visible", "Action compressed into one card"],
    narratives: ["Frame the demo around saving relationships before momentum disappears."],
  },
  "follow-up-recovery": {
    id: "follow-up-recovery",
    label: "Follow-Up Recovery Demo",
    heroFocus: "Follow-up recovery",
    storyline: "Show promised follow-ups becoming a clean execution list.",
    initialNav: "follow-up",
    stage: "Follow-up recovery",
    relationshipLabel: "Follow-up due",
    actions: ["Follow Up", "Call", "Email", "Assign"],
    reasonTemplates: [
      "The promised {action} for {company} is due before momentum fades.",
      "A warm {opportunity} is waiting on a simple next step.",
      "The relationship is still active enough for a clean recovery.",
    ],
    nextStepTemplates: [
      "Close the loop with {company} before the follow-up window cools.",
      "Call the best contact and confirm the next committed step.",
      "Send the promised note with one direct ask.",
    ],
    signals: ["Follow-up due", "Warm relationship", "Momentum window"],
    beforeTitle: "Forgotten follow-ups",
    beforeItems: ["Tasks buried under activity logs", "No urgency hierarchy", "Operators rely on memory"],
    afterTitle: "Follow-up recovery",
    afterItems: ["Due work sorted by relationship value", "Best contact centered", "Next action ready"],
    narratives: ["Use this preset for content about recovering relationships that almost went cold."],
  },
  "relationship-prioritization": {
    id: "relationship-prioritization",
    label: "Relationship Prioritization Demo",
    heroFocus: "Who matters first",
    storyline: "Show Meridian ranking relationships by importance, urgency, and action clarity.",
    initialNav: "priority",
    stage: "Priority execution",
    relationshipLabel: "Highest-priority relationship",
    actions: ["Call", "Open Context", "Follow Up", "Email"],
    reasonTemplates: [
      "{company} combines strong fit, current timing, and a reachable contact.",
      "The relationship has enough context to act without opening diagnostics.",
      "This {opportunity} matters more than lower-signal activity.",
    ],
    nextStepTemplates: [
      "Call {company} and ask for the next committed step.",
      "Open context, confirm the angle, then execute.",
      "Send a concise note that advances the relationship.",
    ],
    signals: ["High fit", "Current timing", "Action clarity"],
    beforeTitle: "Everything looks equal",
    beforeItems: ["Dashboards create more questions", "Activity volume masks importance", "Operators triage manually"],
    afterTitle: "Priority hierarchy",
    afterItems: ["One dominant relationship", "Why now in plain English", "Action path visible"],
    narratives: ["Use this as the cleanest sales demo for Meridian's relationship-priority workspace."],
  },
  "outbound-execution": {
    id: "outbound-execution",
    label: "Outbound Execution Demo",
    heroFocus: "Outbound execution",
    storyline: "Show a tactical outbound list that tells the operator who to contact and why.",
    initialNav: "priority",
    stage: "Outbound execution",
    relationshipLabel: "Outbound-ready relationship",
    actions: ["Call", "Email", "Follow Up", "Open Context"],
    reasonTemplates: [
      "{company} has a timely {opportunity} and a direct contact path.",
      "Outbound timing is strong enough to justify action now.",
      "Meridian turns the signal into a contact-ready operator move.",
    ],
    nextStepTemplates: [
      "Call {company} with a short opener tied to the live signal.",
      "Send one outbound email with the clearest reason to respond.",
      "Open context, then execute the outbound touchpoint.",
    ],
    signals: ["Outbound ready", "Contact path", "Live signal"],
    beforeTitle: "Cold outbound list",
    beforeItems: ["Generic sequencing", "Weak account context", "No relationship priority"],
    afterTitle: "Execution queue",
    afterItems: ["Best account first", "Reason to contact visible", "Next channel selected"],
    narratives: ["This preset is built for tactical sales clips and outreach walkthroughs."],
  },
};
