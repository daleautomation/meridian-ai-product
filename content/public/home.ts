export const REQUEST_DEMO_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20workspace%20demo";
export const START_AUDIT_HREF =
  "mailto:hello@meridian.ai?subject=Meridian%20AI%20business%20audit";
export const CLIENT_LOGIN_HREF = "/login?next=/operator";

export const trustProofPoints = [
  "Built from real operational workflows",
  "Designed around execution",
  "Every workspace is custom-built",
  "Operator-first infrastructure",
  "Signal -> workflow -> execution -> attribution",
] as const;

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

export const audienceCards = [
  {
    title: "Agencies",
    pain: "Client work, lead response, fulfillment status, and reporting live in separate places.",
    fix: "Meridian connects intake, ownership, delivery queues, and client-ready visibility.",
    becomes: "A calmer agency operating room with every account, promise, and next action visible.",
  },
  {
    title: "Contractors",
    pain: "High-intent estimate requests get buried behind site visits, callbacks, and manual scheduling.",
    fix: "Meridian scores inquiries, prepares call plans, and keeps follow-up attached to an owner.",
    becomes: "A lead execution workspace that protects revenue from slow response and missed handoffs.",
  },
  {
    title: "Real estate teams",
    pain: "Deals, buyer signals, showing notes, lender steps, and follow-up reminders scatter fast.",
    fix: "Meridian turns relationship context into prioritized tasks, briefs, and deal visibility.",
    becomes: "A deal command center where the next move is clear before momentum cools.",
  },
  {
    title: "Founders",
    pain: "The business depends on founder memory for priorities, outreach, delivery, and decisions.",
    fix: "Meridian externalizes the operating logic into dashboards, queues, and accountable workflows.",
    becomes: "A founder command center that turns scattered judgment into repeatable execution.",
  },
  {
    title: "Sales organizations",
    pain: "Reps chase volume while strong-fit leads, stale opportunities, and next steps blur together.",
    fix: "Meridian adds closeability scoring, AI briefings, and attribution around what actually moves.",
    becomes: "A revenue workspace that ranks the day by signal, ownership, and expected impact.",
  },
  {
    title: "Service businesses",
    pain: "Intake, service delivery, customer updates, and repeat follow-up depend on manual coordination.",
    fix: "Meridian builds the routing, status, reporting, and follow-up layer around your service model.",
    becomes: "An execution system where customer work moves without disappearing between tools.",
  },
  {
    title: "Operations teams",
    pain: "Leaders cannot see where work stalls, who owns it, or which workflows create outcomes.",
    fix: "Meridian maps the workflow, assigns accountability, and reports movement back to the team.",
    becomes: "An operational visibility layer with fewer blind spots and cleaner ownership.",
  },
] as const;

export const notMeridianCards = [
  {
    title: "Generic CRM",
    not: "A database that waits for people to remember the next step.",
    meridian: "Execution infrastructure that scores, routes, prepares, and tracks the work.",
  },
  {
    title: "Noisy dashboard",
    not: "More charts without ownership, timing, or operational consequence.",
    meridian: "Operator visibility that shows what matters, who owns it, and what happens next.",
  },
  {
    title: "Disconnected AI tool",
    not: "A prompt box sitting outside the actual workflow.",
    meridian: "Operator intelligence embedded into lead queues, call plans, reports, and attribution.",
  },
  {
    title: "Templated automation agency",
    not: "Reusable zaps and generic playbooks forced onto a unique business.",
    meridian: "Custom workflow orchestration built from how your team really sells and executes.",
  },
] as const;

export const businessReasons = [
  {
    title: "Follow-up gaps",
    text: "High-fit opportunities stop leaking because every signal gets an owner, timing, and next action.",
  },
  {
    title: "Scattered workflows",
    text: "The work moves through one operating rhythm instead of inboxes, spreadsheets, and memory.",
  },
  {
    title: "Unclear ownership",
    text: "Leads, tasks, handoffs, and client promises show who is responsible before work stalls.",
  },
  {
    title: "Weak lead prioritization",
    text: "Closeability, urgency, fit, source quality, and timeline become visible before the team spends time.",
  },
  {
    title: "Disconnected systems",
    text: "Dashboards, queues, AI briefings, and reports align around the same operational truth.",
  },
  {
    title: "Operational blind spots",
    text: "Revenue leaks, stale handoffs, and workflow bottlenecks surface while they can still be fixed.",
  },
] as const;

export const receiveGroups = [
  {
    title: "Audit deliverables",
    text: "A clear operating diagnosis that shows where revenue, ownership, and execution are breaking down.",
    items: [
      "Operator playbooks",
      "Workflow maps",
      "Lead scoring systems",
      "Revenue leak diagnosis",
      "Priority fix roadmap",
    ],
  },
  {
    title: "Workspace build deliverables",
    text: "A custom-built command center your team can use to run daily work with more confidence.",
    items: [
      "Execution queues",
      "AI briefings",
      "Reporting layers",
      "Attribution systems",
      "Dashboard infrastructure",
    ],
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

export const operatorWorkspaceStats = [
  {
    label: "Execution tasks generated",
    value: "22",
    detail: "Owner, due window, and source reason attached",
  },
  {
    label: "Revenue leaks detected",
    value: "3",
    detail: "Unowned follow-up and stale handoff risk",
  },
  {
    label: "AI briefings ready",
    value: "8",
    detail: "Call plan, objections, and next actions prepared",
  },
] as const;

export const leadQueuePreview = [
  {
    company: "Harbor View Remodels",
    request: "Kitchen addition estimate",
    score: 91,
    owner: "Maya Chen",
    state: "High closeability opportunity",
    nextAction: "Call in 18 min",
    signal: "Budget stated, timeline inside 45 days",
  },
  {
    company: "Northline Property Group",
    request: "Multi-site maintenance bid",
    score: 84,
    owner: "Jon Bell",
    state: "AI-prepared briefing ready",
    nextAction: "Send scope confirmation",
    signal: "Decision maker engaged twice",
  },
  {
    company: "Blue Oak Dental",
    request: "After-hours service inquiry",
    score: 76,
    owner: "Priya Shah",
    state: "Next action scheduled",
    nextAction: "Follow up at 2:40 PM",
    signal: "Urgency high, pricing question open",
  },
] as const;

export const deepReportPreview = {
  title: "Deep Report",
  subtitle: "Harbor View Remodels diagnostic brief",
  severity: "Signal severity: High",
  summary:
    "High-fit inbound request with visible urgency, clear budget language, and a follow-up gap from the last estimate cycle.",
  findings: [
    {
      label: "Revenue leak",
      value: "$18k estimate risk",
      detail: "Prior quote stalled after no owner was assigned for day-two follow-up.",
    },
    {
      label: "Lead quality",
      value: "Strong fit",
      detail: "Scope matches high-margin service line and timeline is inside the target window.",
    },
    {
      label: "Conversion bottleneck",
      value: "Scope clarity",
      detail: "Customer asked for phasing; operator needs a two-option talk track.",
    },
    {
      label: "Operational gap",
      value: "Handoff delay",
      detail: "Estimate review and consult scheduling live in separate owner queues.",
    },
  ],
  actions: [
    "Open with timeline confirmation",
    "Offer two-phase scope option",
    "Schedule consult before sending estimate",
  ],
} as const;

export const executionQueuePreview = [
  {
    time: "09:10",
    title: "Call plan generated",
    owner: "Maya Chen",
    status: "Ready",
    detail: "Qualification prompts and objection map attached",
  },
  {
    time: "10:30",
    title: "Estimate follow-up",
    owner: "Jon Bell",
    status: "In progress",
    detail: "Revenue leak flagged from dormant quote",
  },
  {
    time: "13:45",
    title: "Decision maker confirmation",
    owner: "Priya Shah",
    status: "Queued",
    detail: "Verify buying role before proposal draft",
  },
  {
    time: "16:20",
    title: "Next action scheduled",
    owner: "Maya Chen",
    status: "Scheduled",
    detail: "Follow-up state moves from prepared to booked",
  },
] as const;

export const followUpProgression = [
  "Captured",
  "Scored",
  "Briefed",
  "Assigned",
  "Scheduled",
] as const;

export const intelligenceLayerLinks = [
  {
    title: "Audits",
    text: "Find revenue leaks, quality signals, bottlenecks, and operational gaps.",
    output: "Diagnostic map",
  },
  {
    title: "Workflows",
    text: "Turn findings into owner-aware actions, routing rules, and follow-up timing.",
    output: "Execution logic",
  },
  {
    title: "Workspaces",
    text: "Surface live queues, briefs, call plans, and status in one operator console.",
    output: "Daily command view",
  },
  {
    title: "Operators",
    text: "Keep every high-signal opportunity attached to a human owner and next action.",
    output: "Accountability layer",
  },
  {
    title: "Reporting",
    text: "Measure generated work, completed actions, attribution, and remaining leaks.",
    output: "Proof of movement",
  },
] as const;

export const attributionSignals = [
  "Audit signal converted to workflow",
  "22 execution tasks generated",
  "3 revenue leaks detected",
  "High closeability opportunity routed",
  "AI-prepared briefing ready",
  "Next action scheduled",
] as const;

export const operatingSteps = [
  "Audit the business",
  "Identify the revenue leaks",
  "Build the workspace",
  "Train the operator flow",
  "Track execution and outcomes",
] as const;
