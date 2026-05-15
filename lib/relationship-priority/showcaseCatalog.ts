import type { DemoPresetId, ShowcaseVerticalId } from "@/lib/relationship-priority/showcase";

export type ShowcaseCategoryId =
  | "contractors-local-services"
  | "relationship-heavy-businesses"
  | "professional-b2b";

export type ShowcaseDemo = {
  id: string;
  category: ShowcaseCategoryId;
  route: {
    vertical: string;
    workflow: string;
  };
  vertical: ShowcaseVerticalId;
  verticalName: string;
  angle: string;
  preset: DemoPresetId;
  presetName: string;
  title: string;
  description: string;
  metadataDescription: string;
  signals: [string, string, string];
};

export type ShowcaseGroup = {
  id: ShowcaseCategoryId;
  label: string;
  description: string;
};

export const SHOWCASE_GROUPS: readonly ShowcaseGroup[] = [
  {
    id: "contractors-local-services",
    label: "Contractors / Local Services",
    description: "Recovery and follow-up demos for operators who win by moving fast on warm local relationships.",
  },
  {
    id: "relationship-heavy-businesses",
    label: "Relationship-Heavy Businesses",
    description: "Priority stories for teams where timing, trust, and next action matter more than dashboard volume.",
  },
  {
    id: "professional-b2b",
    label: "Professional / B2B",
    description: "Outbound, advisor, and revenue workflows built for tactical execution and high-trust conversations.",
  },
];

export const SHOWCASE_DEMOS: readonly ShowcaseDemo[] = [
  {
    id: "roofing-recovery",
    category: "contractors-local-services",
    route: { vertical: "roofing", workflow: "recovery" },
    vertical: "roofing",
    verticalName: "Roofing",
    angle: "Relationship Recovery",
    preset: "recovery-queue",
    presetName: "Recovery Queue Demo",
    title: "Roofing Relationship Recovery",
    description: "Turn stale roofing estimates into the next owner, estimator, and job follow-up to work today.",
    metadataDescription: "A cinematic Meridian showcase for roofing teams recovering warm estimates and knowing who to call first.",
    signals: ["Open estimate", "Storm-season demand", "Owner-ready next action"],
  },
  {
    id: "roofing-stale-pipeline",
    category: "contractors-local-services",
    route: { vertical: "roofing", workflow: "stale-pipeline" },
    vertical: "roofing",
    verticalName: "Roofing",
    angle: "Stale Pipeline",
    preset: "stale-crm",
    presetName: "Stale CRM Demo",
    title: "Roofing Stale Pipeline",
    description: "Show the before/after shift from buried estimate records to a clean roofing priority queue.",
    metadataDescription: "A Meridian roofing demo that turns stale CRM clutter into a prioritized estimate recovery workflow.",
    signals: ["Stale CRM", "Warm relationship", "Clutter to clarity"],
  },
  {
    id: "restoration-follow-up",
    category: "contractors-local-services",
    route: { vertical: "restoration", workflow: "follow-up" },
    vertical: "restoration",
    verticalName: "Restoration",
    angle: "Follow-Up Recovery",
    preset: "follow-up-recovery",
    presetName: "Follow-Up Recovery Demo",
    title: "Restoration Follow-Up Recovery",
    description: "Rank claim, adjuster, and property-loss relationships by who needs a recovery touchpoint now.",
    metadataDescription: "A Meridian showcase for restoration teams compressing claim follow-up into a clear execution queue.",
    signals: ["Claim aging", "Documentation gap", "Follow-up due"],
  },
  {
    id: "home-services-recovery",
    category: "contractors-local-services",
    route: { vertical: "home-services", workflow: "recovery" },
    vertical: "home-services",
    verticalName: "Home Services",
    angle: "Service Recovery",
    preset: "recovery-queue",
    presetName: "Recovery Queue Demo",
    title: "Home Services Recovery",
    description: "Recover missed service opportunities with one screen-safe queue for who matters, why now, and what next.",
    metadataDescription: "A Meridian home services demo for recovering missed estimates and repeat-customer service requests.",
    signals: ["Missed estimate", "Repeat customer", "Service window"],
  },
  {
    id: "solar-recovery",
    category: "contractors-local-services",
    route: { vertical: "solar", workflow: "recovery" },
    vertical: "solar",
    verticalName: "Solar",
    angle: "Proposal Recovery",
    preset: "recovery-queue",
    presetName: "Recovery Queue Demo",
    title: "Solar Proposal Recovery",
    description: "Turn warm solar proposals and incentive deadlines into a clean homeowner action queue.",
    metadataDescription: "A Meridian solar showcase for proposal recovery, homeowner timing, and next-best follow-up.",
    signals: ["Proposal viewed", "Incentive deadline", "Homeowner follow-up"],
  },
  {
    id: "recruiting-candidate-recovery",
    category: "relationship-heavy-businesses",
    route: { vertical: "recruiting", workflow: "candidate-recovery" },
    vertical: "recruiting",
    verticalName: "Recruiting",
    angle: "Candidate Recovery",
    preset: "recovery-queue",
    presetName: "Recovery Queue Demo",
    title: "Recruiting Candidate Recovery",
    description: "Prioritize candidate and hiring-manager relationships before warm momentum disappears.",
    metadataDescription: "A Meridian recruiting showcase for candidate recovery, interview lag, and relationship-priority execution.",
    signals: ["Candidate warmed", "Interview lag", "Role reopened"],
  },
  {
    id: "agency-pipeline-priority",
    category: "relationship-heavy-businesses",
    route: { vertical: "agency", workflow: "pipeline-priority" },
    vertical: "agency",
    verticalName: "Agency",
    angle: "Pipeline Priority",
    preset: "relationship-prioritization",
    presetName: "Relationship Prioritization Demo",
    title: "Agency Pipeline Priority",
    description: "Show dormant proposals becoming a focused priority queue for the next client relationship to move.",
    metadataDescription: "A Meridian agency showcase for proposal recovery, pipeline priority, and tactical client follow-up.",
    signals: ["Proposal stalled", "Decision-maker activity", "Next client move"],
  },
  {
    id: "insurance-follow-up",
    category: "relationship-heavy-businesses",
    route: { vertical: "insurance", workflow: "follow-up" },
    vertical: "insurance",
    verticalName: "Insurance",
    angle: "Policy Follow-Up",
    preset: "follow-up-recovery",
    presetName: "Follow-Up Recovery Demo",
    title: "Insurance Follow-Up Recovery",
    description: "Compress renewal, coverage, and referral signals into the policyholders that need action first.",
    metadataDescription: "A Meridian insurance showcase for policy follow-up, renewal timing, and relationship priority.",
    signals: ["Renewal window", "Coverage gap", "Advisor touchpoint"],
  },
  {
    id: "real-estate-client-recovery",
    category: "relationship-heavy-businesses",
    route: { vertical: "real-estate", workflow: "client-recovery" },
    vertical: "real-estate",
    verticalName: "Real Estate",
    angle: "Client Recovery",
    preset: "recovery-queue",
    presetName: "Recovery Queue Demo",
    title: "Real Estate Client Recovery",
    description: "Bring past clients, listing intent, and referral timing into one relationship-first recovery story.",
    metadataDescription: "A Meridian real estate showcase for client recovery, listing timing, and referral follow-up.",
    signals: ["Past-client timing", "Listing intent", "Referral path"],
  },
  {
    id: "saas-sales-outbound-execution",
    category: "professional-b2b",
    route: { vertical: "saas-sales", workflow: "outbound-execution" },
    vertical: "saas-sales",
    verticalName: "SaaS Sales",
    angle: "Outbound Execution",
    preset: "outbound-execution",
    presetName: "Outbound Execution Demo",
    title: "SaaS Sales Outbound Execution",
    description: "Turn account signals into a tactical outbound queue with the champion, why-now, and channel visible.",
    metadataDescription: "A Meridian SaaS sales showcase for outbound execution, champion activity, and revenue priority.",
    signals: ["Champion activity", "Buyer intent", "Sales action"],
  },
  {
    id: "advisors-client-priority",
    category: "professional-b2b",
    route: { vertical: "advisors", workflow: "client-priority" },
    vertical: "financial-advisors",
    verticalName: "Financial Advisors",
    angle: "Client Priority",
    preset: "relationship-prioritization",
    presetName: "Relationship Prioritization Demo",
    title: "Advisor Client Priority",
    description: "Rank client, household, and referral relationships by trust, timing, and next advisory action.",
    metadataDescription: "A Meridian financial advisor showcase for client priority, life-event timing, and high-trust follow-up.",
    signals: ["Life-event signal", "Review window", "Advisor follow-up"],
  },
];

export function getShowcasePath(demo: ShowcaseDemo): string {
  return `/showcase/${demo.route.vertical}/${demo.route.workflow}`;
}

export function getShowcaseDemoByRoute(
  vertical: string | undefined,
  workflow: string | undefined,
): ShowcaseDemo | null {
  const normalizedVertical = normalizeRouteSegment(vertical);
  const normalizedWorkflow = normalizeRouteSegment(workflow);
  return SHOWCASE_DEMOS.find((demo) =>
    demo.route.vertical === normalizedVertical && demo.route.workflow === normalizedWorkflow
  ) ?? null;
}

export function getShowcaseDemoRedirectHref(demo: ShowcaseDemo): string {
  const params = new URLSearchParams({
    mode: "showcase",
    showcase: "1",
    vertical: demo.vertical,
    preset: demo.preset,
  });
  return `/demo/priority/public?${params.toString()}`;
}

function normalizeRouteSegment(value: string | undefined): string {
  return value?.trim().toLowerCase().replaceAll("_", "-") ?? "";
}
