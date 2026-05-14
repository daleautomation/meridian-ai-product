export const REQUEST_ROOFING_DEMO_HREF =
  "mailto:hello@meridian.ai?subject=Roofing%20Lead%20Finder%20demo";
export const ROOFING_VISIBILITY_SCAN_HREF =
  "mailto:hello@meridian.ai?subject=Roofing%20visibility%20scan";
export const ROOFING_STRATEGY_CALL_HREF =
  "mailto:hello@meridian.ai?subject=Roofing%20strategy%20call";

export const roofingHero = {
  eyebrow: "Roofing Lead Finder",
  title: "Operator-grade roofing opportunity intelligence.",
  text: "Meridian helps roofing contractors find stronger opportunity areas earlier, reduce wasted canvassing, and turn local visibility signals into assigned lead execution.",
  proof: [
    "Territory priority",
    "Visibility gaps",
    "Follow-up ownership",
    "Neighborhood opportunity",
  ],
} as const;

export const roofingPainPoints = [
  {
    title: "Canvassing starts too cold",
    text: "Crews spend hours in areas with weak timing, weak fit, or no clear reason to knock.",
  },
  {
    title: "Local demand is hard to read",
    text: "Search visibility, reviews, websites, neighborhoods, and follow-up gaps do not sit in one usable view.",
  },
  {
    title: "Good leads lose momentum",
    text: "Estimate requests, callbacks, and neighborhood referrals cool off when no operator owns the next move.",
  },
] as const;

export const roofingLiveWorkflowQueue = [
  {
    territory: "North Ridge",
    signal: "Weak review density near active replacement demand",
    priority: "Route first",
    owner: "Sales owner",
    state: "Door route prepared",
  },
  {
    territory: "Westview",
    signal: "Poor website path on high-intent local searches",
    priority: "Visibility fix",
    owner: "Office lead",
    state: "Scan ready",
  },
  {
    territory: "Cedar Run",
    signal: "Dormant estimate follow-up and neighborhood referrals",
    priority: "Recover",
    owner: "Estimator",
    state: "Call window set",
  },
] as const;

export const roofingTerritoryGroups = [
  "Review weakness cluster",
  "High competition corridor",
  "Follow-up recovery pocket",
  "Website conversion gap",
] as const;

export const roofingRoutingSteps = [
  "Signal detected",
  "Territory grouped",
  "Owner assigned",
  "Follow-up scheduled",
  "Action tracked",
] as const;

export const roofingExampleOpportunities = [
  {
    title: "Weak review density",
    signal: "Nearby competitors show stronger public trust in the same service area.",
    impact: "Good prospects may never call if the visible proof gap is too wide.",
    action: "Prioritize review recovery and route canvassing around recent completed jobs.",
  },
  {
    title: "Poor website conversion",
    signal: "The page creates friction before a homeowner can request an inspection.",
    impact: "Paid, organic, and referral traffic can leak before the office sees intent.",
    action: "Tighten the service page, call path, proof blocks, and inspection CTA.",
  },
  {
    title: "Inconsistent follow-up",
    signal: "Estimate and callback opportunities do not have a clear owner or timing.",
    impact: "Warm intent gets replaced by a faster contractor.",
    action: "Assign an owner, set a call window, and prepare the next message.",
  },
  {
    title: "High local competition",
    signal: "Multiple roofers are stronger across maps, reviews, and service pages.",
    impact: "The team needs a sharper territory and visibility plan before spending field time.",
    action: "Focus on the strongest neighborhood wedge and build proof around that area.",
  },
  {
    title: "Neighborhood opportunity cluster",
    signal: "Several visibility and follow-up signals concentrate in one service pocket.",
    impact: "A focused route can outperform broad canvassing.",
    action: "Group the area, assign the route, and connect follow-up to the office queue.",
  },
] as const;

export const roofingExecutionLayer = [
  {
    title: "Prioritize",
    text: "Rank territories, visibility gaps, and follow-up work by practical execution value.",
  },
  {
    title: "Assign",
    text: "Attach every high-signal opportunity to an owner before it drifts.",
  },
  {
    title: "Follow up",
    text: "Keep estimates, callbacks, referrals, and scan requests tied to a next action.",
  },
  {
    title: "Organize",
    text: "Group opportunities by territory, signal type, owner, and execution path.",
  },
  {
    title: "Execute",
    text: "Turn intelligence into route plans, office tasks, visibility fixes, and call windows.",
  },
] as const;

export const roofingDealLossReasons = [
  {
    title: "Missed follow-up",
    text: "A homeowner asks for the next step, then waits while the estimate queue gets busy.",
  },
  {
    title: "Scattered territory focus",
    text: "Reps spread time across neighborhoods without a clear reason for the route.",
  },
  {
    title: "Inconsistent visibility",
    text: "Reviews, maps, pages, and proof do not support the areas the team wants to win.",
  },
  {
    title: "Poor operational organization",
    text: "Signals live in separate tools, notebooks, inboxes, and memory.",
  },
  {
    title: "Lack of prioritization",
    text: "The team stays active, but the strongest opportunities do not reliably go first.",
  },
  {
    title: "Lost inbound intent",
    text: "Website and call-path friction hides demand before it becomes a lead.",
  },
] as const;

export const roofingOpportunityWorkflow = [
  {
    stage: "01",
    title: "Detect the signal",
    text: "Review local presence, conversion paths, visibility gaps, density patterns, and follow-up risk.",
  },
  {
    stage: "02",
    title: "Prioritize the territory",
    text: "Rank neighborhoods and contractor actions by signal strength, urgency, and execution readiness.",
  },
  {
    stage: "03",
    title: "Route the work",
    text: "Turn the opportunity into a call, scan, estimate follow-up, canvassing plan, or visibility fix.",
  },
  {
    stage: "04",
    title: "Move the operator",
    text: "Give the owner a clear reason, next step, and follow-up rhythm before the lead goes stale.",
  },
] as const;

export const roofingAvailableSignals = [
  "Weak online presence",
  "Review gaps",
  "Poor conversion websites",
  "Local visibility weakness",
  "Inconsistent follow-up",
  "Neighborhood density opportunities",
] as const;

export const roofingFutureSignals = [
  "Satellite condition intelligence",
  "Storm-path opportunity overlays",
  "Property age and material signals",
  "Claim and restoration timing concepts",
] as const;

export const roofingContractorUses = [
  {
    title: "Territory prioritization",
    text: "Choose where reps, crews, and local campaigns should focus before spending field hours.",
  },
  {
    title: "Follow-up discipline",
    text: "Attach estimates, callbacks, and dormant opportunities to owners, timing, and next actions.",
  },
  {
    title: "Scheduling support",
    text: "Prepare the daily queue around inspections, estimates, call windows, and crew availability.",
  },
  {
    title: "Visibility improvement",
    text: "Find the public-facing gaps that make good roofing demand harder to convert.",
  },
] as const;

export const roofingVisualWorkflow = [
  {
    label: "Signal detection",
    title: "Local weakness found",
    text: "Visibility, review, website, and follow-up gaps surface as practical opportunities.",
  },
  {
    label: "Opportunity priority",
    title: "Area ranked for action",
    text: "Neighborhoods and lead paths are sorted by fit, density, and execution value.",
  },
  {
    label: "Execution flow",
    title: "Next move prepared",
    text: "The contractor sees the call, scan, visit, content fix, or follow-up that should happen.",
  },
  {
    label: "Lead routing",
    title: "Owner attached",
    text: "High-signal work is routed to the person responsible for moving it today.",
  },
  {
    label: "Operator action",
    title: "Work leaves the dashboard",
    text: "The outcome is a scheduled action, field route, quote follow-up, or visibility repair.",
  },
] as const;

export const roofingExecutionWorkflow = [
  "Scan market and public presence",
  "Cluster neighborhoods by opportunity",
  "Prioritize the strongest work",
  "Assign owner and next action",
  "Track follow-up through completion",
] as const;

export const roofingOperatorPoints = [
  {
    title: "Built from field experience",
    text: "The product starts from real contractor pressure: crews, estimates, callbacks, handoffs, and daily decisions.",
  },
  {
    title: "Operational clarity",
    text: "Every signal needs a reason, owner, and next action. Otherwise it is just another report.",
  },
  {
    title: "Workflow simplification",
    text: "Meridian keeps the funnel tactical so contractors know what to do next without digging through tools.",
  },
] as const;

export const roofingBuiltInPublicPoints = [
  "Actively evolving around contractor workflows",
  "Field-tested thinking before feature sprawl",
  "Operator-informed development",
  "Practical execution focus",
] as const;

export const roofingRoadmapConcepts = [
  {
    title: "Storm intelligence",
    text: "Future layers may help map affected areas and route timely inspection opportunities.",
  },
  {
    title: "Satellite and property signals",
    text: "Future analysis may support exterior condition, roof age, and material-change signals.",
  },
  {
    title: "Contractor workflow systems",
    text: "Future workspace depth may connect opportunity maps to scheduling, CRM state, and crew capacity.",
  },
] as const;
