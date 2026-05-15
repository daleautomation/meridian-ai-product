import type { IntakeFieldName, IntakeType } from "@/lib/intake/types";

export interface IntakeFieldConfig {
  name: IntakeFieldName;
  label: string;
  placeholder: string;
  required?: boolean;
  inputMode?: "email" | "tel" | "url";
  multiline?: boolean;
}

export interface IntakeFlowConfig {
  type: IntakeType;
  requestType: string;
  vertical: string;
  leadSource: string;
  eyebrow: string;
  title: string;
  text: string;
  queueLabel: string;
  pendingLabel: string;
  submitLabel: string;
  successTitle: string;
  successText: string;
  reviewBullets: string[];
  fields: IntakeFieldConfig[];
}

const baseContactFields: IntakeFieldConfig[] = [
  {
    name: "contactName",
    label: "Your name",
    placeholder: "Name",
    required: true,
  },
  {
    name: "email",
    label: "Work email",
    placeholder: "you@company.com",
    required: true,
    inputMode: "email",
  },
  {
    name: "phone",
    label: "Phone",
    placeholder: "(555) 555-0148",
    inputMode: "tel",
  },
];

const companyFields: IntakeFieldConfig[] = [
  {
    name: "companyName",
    label: "Company",
    placeholder: "Atlas Roofing Co.",
    required: true,
  },
  {
    name: "website",
    label: "Website",
    placeholder: "https://company.com",
    inputMode: "url",
  },
  {
    name: "market",
    label: "Market / location",
    placeholder: "Kansas City, MO",
    required: true,
  },
  {
    name: "teamSize",
    label: "Team size",
    placeholder: "Owner-led, 5-10, 20+",
  },
];

export const intakeFlows: Record<IntakeType, IntakeFlowConfig> = {
  "roofing-demo": {
    type: "roofing-demo",
    requestType: "Roofing demo request",
    vertical: "Roofing",
    leadSource: "roofing-intelligence",
    eyebrow: "Roofing demo request",
    title: "See how Meridian would turn roofing signals into owned execution.",
    text: "Share the market, workflow, and bottleneck. Meridian will review fit for the roofing intelligence path before scheduling a walkthrough.",
    queueLabel: "Operator review queue",
    pendingLabel: "Roofing demo review pending",
    submitLabel: "Request Roofing Demo",
    successTitle: "Roofing demo request received.",
    successText: "Meridian will review your market, website, and operational notes before responding with the best next step.",
    reviewBullets: [
      "Roofing market and service-area context",
      "Lead quality, follow-up, and estimate workflow",
      "Fit for property intelligence and opportunity mapping",
    ],
    fields: [
      ...companyFields,
      {
        name: "growthBottleneck",
        label: "Biggest roofing growth bottleneck",
        placeholder: "Lead quality, slow follow-up, local visibility, estimates, reviews...",
        required: true,
        multiline: true,
      },
      {
        name: "workflowProblems",
        label: "Current workflow problems",
        placeholder: "Where do leads, estimates, scheduling, or follow-up break down?",
        multiline: true,
      },
      ...baseContactFields,
    ],
  },
  "visibility-scan": {
    type: "visibility-scan",
    requestType: "Visibility scan",
    vertical: "Service business",
    leadSource: "visibility-scan",
    eyebrow: "Visibility scan",
    title: "Request a tactical scan of your public growth surface.",
    text: "Meridian reviews the site, local presence, review path, CTA clarity, and obvious follow-up leaks before recommending the fastest fix.",
    queueLabel: "Operator review queue",
    pendingLabel: "Visibility scan pending",
    submitLabel: "Get a Visibility Scan",
    successTitle: "Visibility scan queued.",
    successText: "Meridian will review your public presence and route the strongest findings into an operator-ready response.",
    reviewBullets: [
      "Website conversion path",
      "Local search and review surface",
      "Fastest visible revenue leak",
    ],
    fields: [
      ...companyFields,
      {
        name: "growthBottleneck",
        label: "What should the scan focus on?",
        placeholder: "More calls, better leads, local SEO, reviews, website conversion...",
        required: true,
        multiline: true,
      },
      ...baseContactFields,
    ],
  },
  "strategy-call": {
    type: "strategy-call",
    requestType: "Strategy call",
    vertical: "Service business",
    leadSource: "homepage",
    eyebrow: "Strategy call",
    title: "Book a focused operator strategy call.",
    text: "Use this when the problem is broader than one scan: revenue execution, relationship intelligence, follow-up, or workspace fit.",
    queueLabel: "Operator review queue",
    pendingLabel: "Strategy call request pending",
    submitLabel: "Book Strategy Call",
    successTitle: "Strategy call request received.",
    successText: "Meridian will review your notes before proposing the most useful conversation path.",
    reviewBullets: [
      "Growth bottleneck and timing",
      "Current systems and workflow drag",
      "Best-fit Meridian entry point",
    ],
    fields: [
      ...companyFields,
      {
        name: "growthBottleneck",
        label: "Biggest growth bottleneck",
        placeholder: "What needs to change first?",
        required: true,
        multiline: true,
      },
      {
        name: "notes",
        label: "Anything Meridian should know before the call?",
        placeholder: "Context, urgency, existing tools, or a specific workflow to review.",
        multiline: true,
      },
      ...baseContactFields,
    ],
  },
  "workspace-request": {
    type: "workspace-request",
    requestType: "Workspace request",
    vertical: "Service business",
    leadSource: "homepage",
    eyebrow: "Workspace request",
    title: "Request an operator workspace around the way your team actually works.",
    text: "Meridian reviews your workflow, handoffs, follow-up state, and revenue execution needs before shaping a workspace path.",
    queueLabel: "Operator review queue",
    pendingLabel: "Workspace request pending",
    submitLabel: "Request Workspace",
    successTitle: "Workspace request queued.",
    successText: "Meridian will review your request as an operator system candidate, not as a generic contact form.",
    reviewBullets: [
      "Workflow and ownership gaps",
      "Lead execution and follow-up requirements",
      "Workspace fit and first build path",
    ],
    fields: [
      ...companyFields,
      {
        name: "workflowProblems",
        label: "Current workflow problems",
        placeholder: "Where does ownership, follow-up, scheduling, or reporting break down?",
        required: true,
        multiline: true,
      },
      {
        name: "growthBottleneck",
        label: "Growth bottleneck",
        placeholder: "What revenue motion should the workspace improve?",
        multiline: true,
      },
      ...baseContactFields,
    ],
  },
};

export function getIntakeFlow(type: IntakeType): IntakeFlowConfig {
  return intakeFlows[type];
}
