export const REQUEST_DEMO_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20workspace%20demo";
export const START_AUDIT_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20AI%20business%20audit";
export const CLIENT_LOGIN_HREF = "/login?next=/operator";

export const services = [
  {
    title: "AI Business Audit",
    text: "A focused review of where decisions, handoffs, and follow-up lose money.",
    outcome: "Diagnosis",
  },
  {
    title: "Lead Quality & Revenue Audit",
    text: "Find the leads worth pursuing, the ones draining time, and the gaps between both.",
    outcome: "Signal scoring",
  },
  {
    title: "Website + Conversion Audit",
    text: "Turn public traffic into cleaner actions, stronger intake, and better sales context.",
    outcome: "Conversion map",
  },
  {
    title: "Sales Workflow Audit",
    text: "Map how opportunities move from first signal to close, then remove the friction.",
    outcome: "Execution path",
  },
  {
    title: "Custom Meridian Workspace Build",
    text: "A private command center shaped around your data, pipeline, team, and execution rules.",
    outcome: "Workspace build",
  },
  {
    title: "AI Automation & Operator Systems",
    text: "Practical automations that route work, prepare calls, summarize context, and track outcomes.",
    outcome: "Operator flow",
  },
  {
    title: "Client Portal / Internal Dashboard Buildout",
    text: "Client-facing or internal dashboards that make status, ownership, and next actions obvious.",
    outcome: "Visibility layer",
  },
] as const;

// Edit audit pricing and package copy here. The page renders from this data only.
export const auditTiers = [
  {
    name: "Starter Audit",
    price: "$250",
    bestFor: "Quick website, workflow, or lead-quality review.",
    points: ["Signal scan", "Priority fixes", "Next-step memo"],
    signal: "2-3 high-confidence fixes",
  },
  {
    name: "Growth Audit",
    price: "$750",
    bestFor: "Deeper review of lead flow, customer journey, CRM gaps, and revenue leaks.",
    points: ["Journey map", "Leak diagnosis", "Workspace roadmap"],
    signal: "Pipeline friction mapped",
  },
  {
    name: "Operator Audit",
    price: "$1,500+",
    bestFor: "Full operational intelligence review for teams ready to systemize execution.",
    points: ["Automation plan", "Dashboard spec", "Custom build path"],
    signal: "Custom operating system spec",
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
  "Service lead execution workspace",
  "Real estate deal workspace",
  "Founder command center",
  "Revenue attribution workspace",
  "Client operations dashboard",
] as const;

export const platformModules = [
  {
    title: "Lead Intelligence",
    text: "Routes the strongest opportunities to the front of the day.",
  },
  {
    title: "Closeability Scoring",
    text: "Ranks fit, urgency, and readiness with visible reasoning.",
  },
  {
    title: "Deep Reports",
    text: "Turns scattered context into operator-ready briefs.",
  },
  {
    title: "Call Planning",
    text: "Prepares talk tracks, risks, and next-step prompts.",
  },
  {
    title: "Revenue Attribution",
    text: "Shows which motions create value and where deals leak.",
  },
  {
    title: "Contact Verification",
    text: "Keeps source, owner, and reachability confidence clear.",
  },
  {
    title: "Workflow Automation",
    text: "Moves routine routing and follow-up out of manual memory.",
  },
  {
    title: "Client Portal",
    text: "Gives clients and teams a clean status layer.",
  },
] as const;

export const heroMetrics = [
  {
    label: "Closeability",
    value: "87",
    detail: "High-fit request",
  },
  {
    label: "Revenue leak",
    value: "$18k",
    detail: "Follow-up gap",
  },
  {
    label: "Next action",
    value: "Call plan",
    detail: "Ready for owner",
  },
] as const;

export const heroQueue = [
  {
    label: "Lead queue",
    title: "Priority account moved to today",
    meta: "Score + owner + reason",
  },
  {
    label: "Deep Report",
    title: "Buying signals summarized",
    meta: "Intent, objections, fit",
  },
  {
    label: "Call plan",
    title: "Operator brief generated",
    meta: "Questions + next best action",
  },
] as const;

export const workspacePreviewCards = [
  {
    title: "Closeability score",
    value: "87/100",
    text: "Urgency, fit, source quality, and timeline weighted into one visible score.",
  },
  {
    title: "Deep Report",
    value: "5 signals",
    text: "A concise brief with context, objections, open questions, and recommended next step.",
  },
  {
    title: "Next best action",
    value: "Book consult",
    text: "Recommended action tied to owner, due window, and expected revenue impact.",
  },
  {
    title: "Lead queue",
    value: "14 ready",
    text: "A ranked operator queue that separates high-intent work from low-signal noise.",
  },
  {
    title: "Revenue leak",
    value: "3 gaps",
    text: "Missed handoffs, stale follow-up, and unowned opportunities surfaced before they disappear.",
  },
  {
    title: "Call plan",
    value: "Ready",
    text: "Talk track, qualification prompts, and next-step language prepared before the call.",
  },
] as const;

export const operatingSteps = [
  "Audit the business",
  "Identify the revenue leaks",
  "Build the workspace",
  "Train the operator flow",
  "Track execution and outcomes",
] as const;
