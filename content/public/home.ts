export const REQUEST_DEMO_HREF = "/intake/workspace-request?source=homepage";
export const START_AUDIT_HREF = "/intake/visibility-scan?source=visibility-scan";
export const EXPLORE_SYSTEMS_HREF = "#solutions";
export const REQUEST_WORKSPACE_HREF = REQUEST_DEMO_HREF;
export const VISIBILITY_SCAN_HREF = START_AUDIT_HREF;
export const ROOFING_INTELLIGENCE_HREF = "/roofing-intelligence";
export const ROOFING_DEMO_HREF = "/intake/roofing-demo?source=roofing-intelligence";
export const BOOK_STRATEGY_CALL_HREF = "/intake/strategy-call?source=homepage";
export const CLIENT_LOGIN_HREF = "/login?next=/operator";
export const SHOWCASE_HREF = "/showcase";
export const ABOUT_HREF = "/about";
export const RECOVERY_SAMPLE_BRIEF_HREF = "/#sample-brief-preview";
export const REQUEST_FIRST_BRIEF_HREF = "/intake/workspace-request?source=first-brief";

export const productLadder = [
  "Relationships",
  "Revenue risk",
  "Priority queue",
  "Next action",
] as const;

export const coreMeridianCategories = [
  {
    title: "Relationship Maintenance for Revenue Growth",
    description:
      "Protect revenue already sitting inside contacts, referrals, estimates, old CRM records, and warm conversations.",
    outcomes: [
      "Stale CRM recovery",
      "Relationship prioritization",
      "Follow-up execution",
      "Opportunity recovery",
      "Revenue protection",
      "Operator clarity",
    ],
  },
  {
    title: "Workspace / Demo Generation Systems",
    description:
      "Turn a messy workflow into a calm execution surface, then package it into demos people can understand quickly.",
    outcomes: [
      "Relationship-priority workspaces",
      "Cinematic vertical demos",
      "Operator desks",
      "Showcase systems",
      "Workflow visualization",
      "Execution surfaces",
    ],
  },
] as const;

export const fastUtilityProducts = [
  {
    title: "Priority Scan",
    pain: "The business has relationships, leads, referrals, and old opportunities, but no clear starting point.",
    outcome: "A ranked view of who matters, why now, what revenue is exposed, and the first recovery move.",
    cta: "Start priority scan",
    price: "Entry product",
    href: VISIBILITY_SCAN_HREF,
  },
  {
    title: "CRM Recovery Scan",
    pain: "Old deals, dormant estimates, and once-warm contacts are buried under stale records.",
    outcome: "A recovery list that separates real relationship value from dead entries and low-signal noise.",
    cta: "Recover stale CRM",
    price: "Entry product",
    href: VISIBILITY_SCAN_HREF,
  },
  {
    title: "Follow-Up Recovery",
    pain: "Promising conversations cool off because ownership, timing, and next steps are unclear.",
    outcome: "A follow-up queue with the relationship, reason, owner, channel, and message angle attached.",
    cta: "Tighten follow-up",
    price: "Entry product",
    href: VISIBILITY_SCAN_HREF,
  },
  {
    title: "Personal Relationship Queue",
    pain: "Solo operators carry too many relationships in memory and miss the ones most likely to move revenue.",
    outcome: "A personal daily desk for who to contact today, why now, and what should happen next.",
    cta: "Build personal queue",
    price: "Single-user system",
    href: REQUEST_WORKSPACE_HREF,
  },
  {
    title: "Team Relationship Workspace",
    pain: "Teams lose momentum when follow-up, routing, and relationship ownership split across people and tools.",
    outcome: "A shared queue for assignment, routing, recovery, coordination, and execution continuity.",
    cta: "Request team workspace",
    price: "Shared workspace",
    href: REQUEST_WORKSPACE_HREF,
  },
  {
    title: "Custom Operator System",
    pain: "The workflow is valuable, but too specific for a generic CRM, dashboard, or automation template.",
    outcome: "A custom execution surface that compresses workflow, relationship context, and revenue movement.",
    cta: "Plan custom system",
    price: "Strategic system",
    href: REQUEST_WORKSPACE_HREF,
  },
] as const;

export const productLadderGroups = [
  {
    tier: "Entry products",
    text: "Small, focused starts that identify immediate relationship and revenue recovery moves.",
    products: ["Priority Scan", "CRM Recovery Scan", "Follow-Up Recovery"],
  },
  {
    tier: "Single-user systems",
    text: "Personal execution desks for operators who need clarity without adding team process.",
    products: [
      "Personal Relationship Queue",
      "Independent Sales Workspace",
      "Solo Operator Workspace",
      "Freelancer Relationship Desk",
    ],
  },
  {
    tier: "Shared workspaces",
    text: "Team surfaces for routing, ownership, continuity, and coordinated follow-up execution.",
    products: [
      "Team Relationship Workspace",
      "Shared Recovery Queue",
      "Operator Coordination",
      "Relationship Routing",
    ],
  },
  {
    tier: "Strategic systems",
    text: "Custom builds for businesses ready to turn operating logic into a real execution system.",
    products: ["Custom Operator Systems", "Workspace Builds", "Strategic Infrastructure"],
  },
] as const;

export const verticalWorkspaces = [
  {
    title: "Single-user systems",
    industry: "Independent operators",
    text: "Personal relationship workflows for consultants, freelancers, independent salespeople, founders, and solo operators who need one calm daily queue.",
    capabilities: ["Personal prioritization", "Solo follow-up", "Freelancer relationship desk"],
  },
  {
    title: "Shared workspaces",
    industry: "Teams and operators",
    text: "Shared queues that keep relationship ownership, routing, handoffs, and execution continuity visible across the team.",
    capabilities: ["Team coordination", "Relationship routing", "Shared recovery queue"],
  },
  {
    title: "Showcase workspaces",
    industry: "Sales and demo systems",
    text: "Screen-recording-safe demos and operator surfaces that show how Meridian applies to a specific workflow.",
    capabilities: ["Vertical overlays", "Cinematic demos", "Clean branded URLs"],
  },
  {
    title: "Example vertical: roofing",
    industry: "One showcase example",
    text: "Roofing remains a clear recovery demo for stale estimates and local service follow-up, not the center of the Meridian company.",
    capabilities: ["Estimate recovery", "Local service follow-up", "Priority demo"],
  },
] as const;

export const workspacePositioning = [
  {
    title: "Single-user systems",
    subtitle: "For one person who needs a calmer way to execute.",
    description:
      "A personal queue for independent operators, consultants, founders, sales reps, and freelancers who need to know which relationship deserves attention today.",
    examples: [
      "Personal Relationship Queue",
      "Independent Sales Workspace",
      "Solo Operator Workspace",
      "Freelancer Relationship Desk",
    ],
  },
  {
    title: "Shared workspaces",
    subtitle: "For teams that need coordination and continuity.",
    description:
      "A shared operating surface for routing, ownership, handoffs, and recovery work when multiple people touch the same relationships.",
    examples: [
      "Team Relationship Workspace",
      "Shared Recovery Queue",
      "Operator Coordination",
      "Relationship Routing",
    ],
  },
] as const;

export const showcaseHomepageCards = [
  {
    title: "Clean showcase routes",
    text: "Open a branded URL and show a vertical workflow without exposing internal operators, diagnostics, or setup noise.",
  },
  {
    title: "Cinematic vertical demos",
    text: "Screen-recording-safe layouts use orange urgency, Meridian blue, before/after panels, and calm hierarchy.",
  },
  {
    title: "Workflow applied to your market",
    text: "Roofing, restoration, real estate, agencies, recruiting, advisors, and B2B sales become understandable demos.",
  },
] as const;

export const showcasePreviewRows = [
  {
    label: "Clutter",
    title: "Stale CRM records, forgotten estimates, scattered notes",
  },
  {
    label: "Meridian",
    title: "Who matters, why now, what next",
  },
  {
    label: "Output",
    title: "A calm demo and operator queue anyone can understand",
  },
] as const;

export const roofingIntelligenceSignals = [
  {
    title: "Stale estimates",
    text: "Old proposals become a ranked recovery queue with the owner, reason, and next contact path visible.",
  },
  {
    title: "Warm relationships",
    text: "Existing customer and referral relationships are treated as revenue assets, not forgotten records.",
  },
  {
    title: "One example among many",
    text: "The same relationship-priority story applies across agencies, real estate, recruiting, advisors, and B2B sales.",
  },
] as const;

export const roofingFutureSignals = [
  "Stale pipeline",
  "Recovery queue",
  "Who matters",
  "What next",
] as const;

export const fieldFounderPoints = [
  {
    title: "Started with construction work",
    text: "Meridian comes from seeing how field work, handoffs, estimates, schedules, and customer promises break under real pressure.",
  },
  {
    title: "Felt the operational frustration",
    text: "The problem was never a lack of apps. It was work living across memory, texts, spreadsheets, and half-owned next steps.",
  },
  {
    title: "Learned software to build the missing layer",
    text: "The systems were built from the workflow backwards: what the operator needs to know, who owns it, and what should happen next.",
  },
  {
    title: "Built live operating systems",
    text: "Meridian now runs real workspace patterns for scheduling, relationship context, execution queues, and operational visibility.",
  },
] as const;

export const howMeridianWorks = [
  {
    stage: "01",
    title: "Start with owned relationships",
    text: "Contacts, leads, estimates, referrals, pipeline records, callbacks, and notes become the raw material.",
  },
  {
    stage: "02",
    title: "Detect revenue risk",
    text: "Meridian looks for staleness, urgency, fit, missing ownership, and timing signals that deserve attention.",
  },
  {
    stage: "03",
    title: "Surface who matters",
    text: "The operator sees the relationship, why now, what revenue is exposed, and the clearest contact path.",
  },
  {
    stage: "04",
    title: "Execute the next step",
    text: "Follow-up moves from scattered memory into one clean action with owner, timing, and recommended angle.",
  },
  {
    stage: "05",
    title: "Keep relationship continuity",
    text: "Outcomes, replies, misses, and wins feed the operating rhythm so the next priority becomes easier to see.",
  },
] as const;

export const liveSystemsProof = [
  {
    title: "Relationship-priority workspace",
    text: "The reusable workspace pattern already shows who matters, why now, and what next in a calm operator view.",
    proof: "Demoable now",
  },
  {
    title: "Showcase mode",
    text: "Clean routes, overlays, demo presets, and vertical examples turn workflow value into a sales-ready story.",
    proof: "Sales engine",
  },
  {
    title: "Execution guidance",
    text: "Queues compress relationship context into priority, reason, contact path, owner, and next move.",
    proof: "Operator clarity",
  },
  {
    title: "Workflow visualization",
    text: "Before/after panels, cinematic demos, and simple surfaces make clutter-to-clarity visible without exposing internals.",
    proof: "Visual storytelling",
  },
] as const;

export const trustProofPoints = [
  "Missed follow-up becomes owned execution",
  "Scattered systems become one operating rhythm",
  "Every workspace is custom-built",
  "Operator-first infrastructure",
  "Signal -> workflow -> assignment -> execution -> attribution",
] as const;

export const openingNarrative = {
  eyebrow: "Operational clarity",
  title: "Most teams do not need another dashboard. They need the work to make sense.",
  text: "Meridian starts where operators feel the drag: scattered workflows, stale leads, unclear ownership, noisy reporting, and teams reacting from memory instead of moving from a shared operating truth.",
  quote:
    "The goal is not more dashboards. The goal is operational clarity.",
  arc: [
    "Pain",
    "Diagnosis",
    "Visibility",
    "Workspace",
    "Execution",
    "Attribution",
    "Control",
  ],
} as const;

export const beforeAfterStory = {
  eyebrow: "Before Meridian / After Meridian",
  title: "The shift is emotional before it is technical: chaos becomes calm execution.",
  text: "Meridian turns daily operational anxiety into a visible system of priority, ownership, preparation, and proof.",
  before: [
    {
      title: "Missed follow-up",
      text: "Good opportunities sit in inboxes, CRM notes, and founder memory until urgency cools.",
    },
    {
      title: "Scattered systems",
      text: "Dashboards, spreadsheets, calendars, and conversations each show part of the truth.",
    },
    {
      title: "Unclear priorities",
      text: "Teams stay busy without knowing which work is most likely to move revenue.",
    },
    {
      title: "Disconnected teams",
      text: "Handoffs happen without ownership, timing, or a reliable next action.",
    },
  ],
  after: [
    {
      title: "Owned workflows",
      text: "Every high-signal item has an owner, reason, due window, and next step.",
    },
    {
      title: "Prioritized queues",
      text: "Operators start from ranked work instead of searching through noise.",
    },
    {
      title: "AI-prepared execution",
      text: "Briefs, call plans, risks, and prompts arrive before the team acts.",
    },
    {
      title: "Operational calm",
      text: "Momentum, attribution, and bottlenecks become visible while they can still be managed.",
    },
  ],
} as const;

export const operatorPrinciples = [
  {
    title: "Good systems reduce cognitive load.",
    text: "The operator should not carry the whole business in their head.",
  },
  {
    title: "Execution should feel visible.",
    text: "Work needs state, owner, timing, and consequence before it can move with confidence.",
  },
  {
    title: "Momentum should be trackable.",
    text: "A team should know what moved, what stalled, and which actions created value.",
  },
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
    label: "Relationship",
    value: "Warm",
    detail: "Existing trust already exists",
  },
  {
    label: "Revenue",
    value: "At risk",
    detail: "Follow-up window is closing",
  },
  {
    label: "Action",
    value: "Today",
    detail: "Operator move is clear",
  },
] as const;

export const heroQueue = [
  {
    label: "Who matters",
    title: "Warm relationship with revenue potential",
    meta: "Existing context, recent signal, reachable contact",
  },
  {
    label: "Why now",
    title: "Momentum is starting to cool",
    meta: "The follow-up window is still recoverable",
  },
  {
    label: "What next",
    title: "Call with a specific recovery angle",
    meta: "Move the relationship before it disappears",
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
    label: "Who matters",
    value: "Ranked",
    detail: "The strongest relationship sits at the top",
  },
  {
    label: "Why now",
    value: "Visible",
    detail: "Risk, timing, and reason travel together",
  },
  {
    label: "What next",
    value: "Ready",
    detail: "The operator sees the next action immediately",
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

export const signalExecutionSteps = [
  {
    stage: "Signal",
    title: "A real business event enters the system",
    text: "Lead intent, customer context, source quality, urgency, and missing data become visible.",
  },
  {
    stage: "Workflow",
    title: "Meridian maps what should happen next",
    text: "Routing rules, qualification logic, and escalation paths turn signal into an operating path.",
  },
  {
    stage: "Assignment",
    title: "Ownership attaches before work can drift",
    text: "The right person receives the item with timing, reason, and expected outcome.",
  },
  {
    stage: "Execution",
    title: "AI prepares the operator for action",
    text: "Briefs, call plans, objections, and follow-up language are ready at the moment of work.",
  },
  {
    stage: "Reporting",
    title: "Movement becomes visible",
    text: "Completed actions, stale tasks, bottlenecks, and generated work roll back into the command view.",
  },
  {
    stage: "Attribution",
    title: "The business learns what created value",
    text: "Source, owner, workflow, and outcome connect so teams can repeat what works.",
  },
] as const;

export const operatingSteps = [
  "Audit the business",
  "Identify the revenue leaks",
  "Build the workspace",
  "Train the operator flow",
  "Track execution and outcomes",
] as const;
