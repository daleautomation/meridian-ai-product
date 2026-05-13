export const REQUEST_DEMO_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20workspace%20demo";
export const START_AUDIT_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20AI%20business%20audit";
export const CLIENT_LOGIN_HREF = "/login?next=/operator";

export const services = [
  {
    title: "AI Business Audit",
    text: "A focused review of where decisions, handoffs, and follow-up lose money.",
  },
  {
    title: "Lead Quality & Revenue Audit",
    text: "Find the leads worth pursuing, the ones draining time, and the gaps between both.",
  },
  {
    title: "Website + Conversion Audit",
    text: "Turn public traffic into cleaner actions, stronger intake, and better sales context.",
  },
  {
    title: "Sales Workflow Audit",
    text: "Map how opportunities move from first signal to close, then remove the friction.",
  },
  {
    title: "Custom Meridian Workspace Build",
    text: "A private command center shaped around your data, pipeline, team, and execution rules.",
  },
  {
    title: "AI Automation & Operator Systems",
    text: "Practical automations that route work, prepare calls, summarize context, and track outcomes.",
  },
  {
    title: "Client Portal / Internal Dashboard Buildout",
    text: "Client-facing or internal dashboards that make status, ownership, and next actions obvious.",
  },
] as const;

// Edit audit pricing and package copy here. The page renders from this data only.
export const auditTiers = [
  {
    name: "Starter Audit",
    price: "$250",
    bestFor: "Quick website, workflow, or lead-quality review.",
    points: ["Signal scan", "Priority fixes", "Next-step memo"],
  },
  {
    name: "Growth Audit",
    price: "$750",
    bestFor: "Deeper review of lead flow, customer journey, CRM gaps, and revenue leaks.",
    points: ["Journey map", "Leak diagnosis", "Workspace roadmap"],
  },
  {
    name: "Operator Audit",
    price: "$1,500+",
    bestFor: "Full operational intelligence review for teams ready to systemize execution.",
    points: ["Automation plan", "Dashboard spec", "Custom build path"],
  },
] as const;

export const workspaceAudiences = [
  "Agencies",
  "Real estate teams",
  "Contractors",
  "Service businesses",
  "Sales teams",
  "Founders",
  "Operations teams",
] as const;

export const workspaceExamples = [
  "LaborTech-style lead execution workspace",
  "Brookside real estate deal workspace",
  "Founder command center",
  "Revenue attribution workspace",
  "Client operations dashboard",
] as const;

export const platformModules = [
  "Lead Intelligence",
  "Closeability Scoring",
  "Deep Reports",
  "Call Planning",
  "Revenue Attribution",
  "Contact Verification",
  "Workflow Automation",
  "Client Portal",
] as const;

export const operatingSteps = [
  "Audit the business",
  "Identify the revenue leaks",
  "Build the workspace",
  "Train the operator flow",
  "Track execution and outcomes",
] as const;
